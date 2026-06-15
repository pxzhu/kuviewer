package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kuviewer/server/internal/provider"
	"kuviewer/server/internal/topology"
)

type stubProvider struct {
	snapshot topology.Snapshot
	err      error
}

func (p stubProvider) Snapshot(context.Context) (topology.Snapshot, error) {
	return p.snapshot, p.err
}

type eventStubProvider struct {
	stubProvider
	events   topology.ResourceEvents
	eventErr error
}

func (p eventStubProvider) ResourceEvents(context.Context, provider.ResourceRef) (topology.ResourceEvents, error) {
	return p.events, p.eventErr
}

type logStubProvider struct {
	stubProvider
	logs   topology.ResourceLogs
	logErr error
	ref    *provider.ResourceRef
}

func (p logStubProvider) ResourceLogs(_ context.Context, ref provider.ResourceRef) (topology.ResourceLogs, error) {
	if p.ref != nil {
		*p.ref = ref
	}
	return p.logs, p.logErr
}

type panicProvider struct{}

func (panicProvider) Snapshot(context.Context) (topology.Snapshot, error) {
	panic("boom")
}

func TestTopologyRequiresAdminBearerToken(t *testing.T) {
	handler := NewServer(stubProvider{snapshot: testSnapshot()}, "secret-token", "", "")

	tests := []struct {
		name          string
		authorization string
		wantStatus    int
	}{
		{name: "missing token", wantStatus: http.StatusUnauthorized},
		{name: "wrong token", authorization: "Bearer wrong", wantStatus: http.StatusUnauthorized},
		{name: "wrong scheme", authorization: "Basic secret-token", wantStatus: http.StatusUnauthorized},
		{name: "valid token", authorization: "Bearer secret-token", wantStatus: http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/topology", nil)
			if tt.authorization != "" {
				request.Header.Set("Authorization", tt.authorization)
			}

			handler.ServeHTTP(recorder, request)

			if recorder.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, tt.wantStatus)
			}
		})
	}
}

func TestTopologyReturnsSnapshot(t *testing.T) {
	handler := NewServer(stubProvider{snapshot: testSnapshot()}, "secret-token", "", "")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/topology", nil)
	request.Header.Set("Authorization", "Bearer secret-token")

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var snapshot topology.Snapshot
	if err := json.NewDecoder(recorder.Body).Decode(&snapshot); err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	if len(snapshot.Clusters) != 1 || snapshot.Clusters[0].Name != "test-cluster" {
		t.Fatalf("unexpected snapshot: %+v", snapshot)
	}
}

func TestTopologyRecoversProviderPanic(t *testing.T) {
	handler := NewServer(panicProvider{}, "secret-token", "", "")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/topology", nil)
	request.Header.Set("Authorization", "Bearer secret-token")

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	if !strings.Contains(recorder.Body.String(), "internal_server_error") {
		t.Fatalf("body = %q, want internal_server_error", recorder.Body.String())
	}
}

func TestStatusRequiresAdminBearerToken(t *testing.T) {
	handler := NewServerWithConfig(stubProvider{snapshot: testSnapshot()}, ServerConfig{
		AdminToken: "secret-token",
		Source:     "kubernetes",
	})

	tests := []struct {
		name          string
		authorization string
		wantStatus    int
	}{
		{name: "missing token", wantStatus: http.StatusUnauthorized},
		{name: "wrong token", authorization: "Bearer wrong", wantStatus: http.StatusUnauthorized},
		{name: "valid token", authorization: "Bearer secret-token", wantStatus: http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/status", nil)
			if tt.authorization != "" {
				request.Header.Set("Authorization", tt.authorization)
			}

			handler.ServeHTTP(recorder, request)

			if recorder.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, tt.wantStatus)
			}
		})
	}
}

func TestStatusReturnsProviderMetadata(t *testing.T) {
	handler := NewServerWithConfig(stubProvider{snapshot: testSnapshot()}, ServerConfig{
		AdminToken: "secret-token",
		StaticDir:  "/app/static",
		Source:     "kubernetes",
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	request.Header.Set("Authorization", "Bearer secret-token")

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var status statusResponse
	if err := json.NewDecoder(recorder.Body).Decode(&status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if status.Mode != "api" {
		t.Fatalf("mode = %q, want api", status.Mode)
	}
	if status.Source != "kubernetes" {
		t.Fatalf("source = %q, want kubernetes", status.Source)
	}
	if !status.ReadOnly {
		t.Fatal("readOnly = false, want true")
	}
	if status.Secrets != "hidden" {
		t.Fatalf("secrets = %q, want hidden", status.Secrets)
	}
	if !status.Static {
		t.Fatal("static = false, want true")
	}
	if _, err := time.Parse(time.RFC3339, status.ServerTime); err != nil {
		t.Fatalf("serverTime is not RFC3339: %q", status.ServerTime)
	}
}

func TestTopologyProviderErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
	}{
		{name: "not implemented", err: provider.ErrProviderNotImplemented, wantStatus: http.StatusNotImplemented},
		{name: "snapshot failure", err: errors.New("boom"), wantStatus: http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := NewServer(stubProvider{err: tt.err}, "secret-token", "", "")
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/topology", nil)
			request.Header.Set("Authorization", "Bearer secret-token")

			handler.ServeHTTP(recorder, request)

			if recorder.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, tt.wantStatus)
			}
		})
	}
}

func TestResourcesRequireAdminBearerToken(t *testing.T) {
	handler := NewServer(stubProvider{snapshot: resourceTestSnapshot()}, "secret-token", "", "")

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/resources", nil)
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}

func TestResourcesReturnSafeResourceList(t *testing.T) {
	handler := NewServer(stubProvider{snapshot: resourceTestSnapshot()}, "secret-token", "", "")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/resources", nil)
	request.Header.Set("Authorization", "Bearer secret-token")

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var resources topology.ResourceList
	if err := json.NewDecoder(recorder.Body).Decode(&resources); err != nil {
		t.Fatalf("decode resources: %v", err)
	}
	if len(resources.Items) != 3 {
		t.Fatalf("resources = %d, want 3", len(resources.Items))
	}

	var secret topology.Resource
	var pod topology.Resource
	for _, resource := range resources.Items {
		if resource.Kind == "Secret" {
			secret = resource
		}
		if resource.Kind == "Pod" {
			pod = resource
		}
	}
	if pod.Name != "checkout-api" {
		t.Fatalf("pod resource not found: %+v", resources.Items)
	}
	if got := pod.Annotations["owner"]; got != "checkout" {
		t.Fatalf("pod annotation owner = %q, want checkout", got)
	}
	metadata, ok := pod.Preview["metadata"].(map[string]interface{})
	if !ok {
		t.Fatalf("pod metadata preview missing: %+v", pod.Preview)
	}
	if got := metadata["uid"]; got != "12345678-abc" {
		t.Fatalf("pod preview uid = %v, want short uid", got)
	}
	owners, ok := metadata["owners"].([]interface{})
	if !ok || len(owners) != 1 || owners[0] != "ReplicaSet/checkout-api-abc" {
		t.Fatalf("pod preview owners = %#v, want ReplicaSet owner", metadata["owners"])
	}
	podSummary, ok := pod.Preview["summary"].(map[string]interface{})
	if !ok {
		t.Fatalf("pod summary preview missing: %+v", pod.Preview)
	}
	containers, ok := podSummary["containerNames"].([]interface{})
	if !ok || len(containers) != 2 || containers[0] != "app" || containers[1] != "sidecar" {
		t.Fatalf("pod containerNames = %#v, want app and sidecar", podSummary["containerNames"])
	}
	podYAML, ok := pod.Preview["safeYaml"].(string)
	if !ok || !strings.Contains(podYAML, "kind: Pod") || !strings.Contains(podYAML, "containerNames:") || !strings.Contains(podYAML, "- app") {
		t.Fatalf("pod safeYaml = %q, want pod YAML preview with containers", pod.Preview["safeYaml"])
	}
	if secret.Name != "checkout-secret" {
		t.Fatalf("secret resource not found: %+v", resources.Items)
	}
	if _, ok := secret.Summary["token"]; ok {
		t.Fatalf("secret token leaked in summary: %+v", secret.Summary)
	}
	if got := secret.Preview["secretValues"]; got != "hidden" {
		t.Fatalf("secretValues = %v, want hidden", got)
	}
	secretYAML, ok := secret.Preview["safeYaml"].(string)
	if !ok || !strings.Contains(secretYAML, "kind: Secret") || !strings.Contains(secretYAML, "secretValues: hidden") {
		t.Fatalf("secret safeYaml = %q, want hidden Secret YAML preview", secret.Preview["safeYaml"])
	}
	if strings.Contains(secretYAML, "\n  data:") || strings.Contains(secretYAML, "\n  stringData:") || strings.Contains(secretYAML, "redaction-fixture") {
		t.Fatalf("secret safeYaml leaked sensitive fields: %q", secretYAML)
	}
	if got := secret.Annotations["token"]; got != "redacted" {
		t.Fatalf("secret token annotation = %q, want redacted", got)
	}
	if strings.Contains(string(mustMarshalJSON(t, secret)), "redaction-fixture") {
		t.Fatalf("secret value leaked in resource response: %+v", secret)
	}
}

func TestResourceDetailAndEvents(t *testing.T) {
	handler := NewServer(stubProvider{snapshot: resourceTestSnapshot()}, "secret-token", "", "")

	t.Run("detail", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/checkout-api", nil)
		request.Header.Set("Authorization", "Bearer secret-token")
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		var resource topology.Resource
		if err := json.NewDecoder(recorder.Body).Decode(&resource); err != nil {
			t.Fatalf("decode detail: %v", err)
		}
		if resource.Kind != "Pod" || resource.Name != "checkout-api" || len(resource.Related) == 0 {
			t.Fatalf("unexpected resource detail: %+v", resource)
		}
	})

	t.Run("events", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/checkout-api/events", nil)
		request.Header.Set("Authorization", "Bearer secret-token")
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		var events topology.ResourceEvents
		if err := json.NewDecoder(recorder.Body).Decode(&events); err != nil {
			t.Fatalf("decode events: %v", err)
		}
		if len(events.Items) != 0 {
			t.Fatalf("events = %d, want 0", len(events.Items))
		}
	})

	t.Run("events require token", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/checkout-api/events", nil)
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
		}
	})

	t.Run("provider events", func(t *testing.T) {
		eventHandler := NewServer(eventStubProvider{
			stubProvider: stubProvider{snapshot: resourceTestSnapshot()},
			events: topology.ResourceEvents{Items: []topology.ResourceEvent{
				{
					Type:      "Warning",
					Reason:    "Unhealthy",
					Message:   "Readiness probe failed",
					Source:    "kubelet",
					Timestamp: "2026-06-15T11:00:00Z",
				},
			}},
		}, "secret-token", "", "")
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/checkout-api/events", nil)
		request.Header.Set("Authorization", "Bearer secret-token")
		eventHandler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		var events topology.ResourceEvents
		if err := json.NewDecoder(recorder.Body).Decode(&events); err != nil {
			t.Fatalf("decode events: %v", err)
		}
		if len(events.Items) != 1 || events.Items[0].Reason != "Unhealthy" {
			t.Fatalf("events = %+v, want converted provider event", events.Items)
		}
	})

	t.Run("provider events fallback warning", func(t *testing.T) {
		eventHandler := NewServer(eventStubProvider{
			stubProvider: stubProvider{snapshot: resourceTestSnapshot()},
			eventErr:     errors.New("forbidden"),
		}, "secret-token", "", "")
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/checkout-api/events", nil)
		request.Header.Set("Authorization", "Bearer secret-token")
		eventHandler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		var events topology.ResourceEvents
		if err := json.NewDecoder(recorder.Body).Decode(&events); err != nil {
			t.Fatalf("decode events: %v", err)
		}
		if events.Warning != "events_unavailable" || len(events.Items) != 0 {
			t.Fatalf("events fallback = %+v, want warning and empty items", events)
		}
	})

	t.Run("not found", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/missing/events", nil)
		request.Header.Set("Authorization", "Bearer secret-token")
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
		}
	})
}

func TestResourceLogs(t *testing.T) {
	handler := NewServer(stubProvider{snapshot: resourceTestSnapshot()}, "secret-token", "", "")

	t.Run("logs require token", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/checkout-api/logs", nil)
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
		}
	})

	t.Run("non pod not found", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Secret/checkout/checkout-secret/logs", nil)
		request.Header.Set("Authorization", "Bearer secret-token")
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
		}
	})

	t.Run("missing log provider fallback", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/checkout-api/logs", nil)
		request.Header.Set("Authorization", "Bearer secret-token")
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		var logs topology.ResourceLogs
		if err := json.NewDecoder(recorder.Body).Decode(&logs); err != nil {
			t.Fatalf("decode logs: %v", err)
		}
		if logs.Warning != "logs_unavailable" || len(logs.Lines) != 0 || logs.TailLines != 200 {
			t.Fatalf("logs = %+v, want unavailable warning", logs)
		}
	})

	t.Run("provider logs", func(t *testing.T) {
		var gotRef provider.ResourceRef
		logHandler := NewServer(logStubProvider{
			stubProvider: stubProvider{snapshot: resourceTestSnapshot()},
			logs:         topology.ResourceLogs{Lines: []string{"started", "ready"}, TailLines: 200},
			ref:          &gotRef,
		}, "secret-token", "", "")
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/checkout-api/logs?container=api", nil)
		request.Header.Set("Authorization", "Bearer secret-token")
		logHandler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		var logs topology.ResourceLogs
		if err := json.NewDecoder(recorder.Body).Decode(&logs); err != nil {
			t.Fatalf("decode logs: %v", err)
		}
		if len(logs.Lines) != 2 || logs.Lines[1] != "ready" {
			t.Fatalf("logs = %+v, want provider lines", logs)
		}
		if gotRef.Container != "api" {
			t.Fatalf("container = %q, want api", gotRef.Container)
		}
	})

	t.Run("provider logs fallback warning", func(t *testing.T) {
		logHandler := NewServer(logStubProvider{
			stubProvider: stubProvider{snapshot: resourceTestSnapshot()},
			logErr:       errors.New("forbidden"),
		}, "secret-token", "", "")
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/checkout-api/logs", nil)
		request.Header.Set("Authorization", "Bearer secret-token")
		logHandler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		var logs topology.ResourceLogs
		if err := json.NewDecoder(recorder.Body).Decode(&logs); err != nil {
			t.Fatalf("decode logs: %v", err)
		}
		if logs.Warning != "logs_unavailable" || len(logs.Lines) != 0 {
			t.Fatalf("logs fallback = %+v, want warning and empty lines", logs)
		}
	})
}

func TestCORSPreflight(t *testing.T) {
	handler := NewServer(stubProvider{snapshot: testSnapshot()}, "secret-token", "http://127.0.0.1:5174", "")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodOptions, "/api/topology", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:5174" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
	if got := recorder.Header().Get("Vary"); got != "Origin" {
		t.Fatalf("Vary = %q, want Origin", got)
	}
}

func TestSecurityHeaders(t *testing.T) {
	handler := NewServer(stubProvider{snapshot: testSnapshot()}, "secret-token", "", "")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	handler.ServeHTTP(recorder, request)

	expectedHeaders := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy":        "no-referrer",
		"X-Frame-Options":        "DENY",
		"Permissions-Policy":     "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
	}
	for header, want := range expectedHeaders {
		if got := recorder.Header().Get(header); got != want {
			t.Fatalf("%s = %q, want %q", header, got, want)
		}
	}

	csp := recorder.Header().Get("Content-Security-Policy")
	for _, fragment := range []string{"default-src 'self'", "frame-ancestors 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'"} {
		if !strings.Contains(csp, fragment) {
			t.Fatalf("Content-Security-Policy missing %q: %q", fragment, csp)
		}
	}
}

func TestStaticSPAFallback(t *testing.T) {
	staticDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(staticDir, "assets"), 0o755); err != nil {
		t.Fatalf("mkdir assets: %v", err)
	}
	writeFile(t, filepath.Join(staticDir, "index.html"), "kuviewer index")
	writeFile(t, filepath.Join(staticDir, "asset.txt"), "asset")
	writeFile(t, filepath.Join(staticDir, "assets", "index-abc.js"), "asset js")

	handler := NewServer(stubProvider{snapshot: testSnapshot()}, "secret-token", "", staticDir)

	tests := []struct {
		path             string
		wantBody         string
		wantCacheControl string
	}{
		{path: "/", wantBody: "kuviewer index", wantCacheControl: "no-store"},
		{path: "/asset.txt", wantBody: "asset", wantCacheControl: "no-cache"},
		{path: "/assets/index-abc.js", wantBody: "asset js", wantCacheControl: "public, max-age=31536000, immutable"},
		{path: "/topology/deep-link", wantBody: "kuviewer index", wantCacheControl: "no-store"},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, tt.path, nil)

			handler.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
			}
			if strings.TrimSpace(recorder.Body.String()) != tt.wantBody {
				t.Fatalf("body = %q, want %q", recorder.Body.String(), tt.wantBody)
			}
			if got := recorder.Header().Get("Cache-Control"); got != tt.wantCacheControl {
				t.Fatalf("Cache-Control = %q, want %q", got, tt.wantCacheControl)
			}
		})
	}
}

func TestSafePath(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "index.html")
	outside := filepath.Join(filepath.Dir(root), "outside.html")

	if !safePath(root, inside) {
		t.Fatal("inside path was rejected")
	}
	if safePath(root, outside) {
		t.Fatal("outside path was accepted")
	}
}

func writeFile(t *testing.T, path string, contents string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func mustMarshalJSON(t *testing.T, value interface{}) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal json: %v", err)
	}
	return data
}

func testSnapshot() topology.Snapshot {
	return topology.Snapshot{
		Clusters: []topology.ClusterSummary{
			{
				ID:         "test",
				Name:       "test-cluster",
				Provider:   "Kubernetes",
				Version:    "v1.30.0",
				NodeReady:  1,
				NodeTotal:  1,
				PodRunning: 1,
				Namespaces: 1,
			},
		},
	}
}

func resourceTestSnapshot() topology.Snapshot {
	snapshot := testSnapshot()
	snapshot.Nodes = []topology.Node{
		{
			ID:        "test:Namespace:checkout",
			ClusterID: "test",
			Kind:      "Namespace",
			Name:      "checkout",
			Status:    "healthy",
			Labels:    map[string]string{"team": "commerce"},
			UID:       "namespace-uid",
			Age:       "24h0m0s",
			Summary:   map[string]interface{}{"workloads": 1},
		},
		{
			ID:        "test:checkout:Pod:checkout-api",
			ClusterID: "test",
			Kind:      "Pod",
			Namespace: "checkout",
			Name:      "checkout-api",
			Status:    "healthy",
			Labels:    map[string]string{"app": "checkout-api"},
			Annotations: map[string]string{
				"owner": "checkout",
			},
			UID:     "12345678-abcd-ef00-9876-abcdefghijkl",
			Age:     "2h0m0s",
			Owners:  []string{"ReplicaSet/checkout-api-abc"},
			Summary: map[string]interface{}{"phase": "Running", "ready": "1/1", "conditions": "Ready=True", "containerNames": []string{"app", "sidecar"}, "initContainers": []string{"migrate"}},
		},
		{
			ID:        "test:checkout:Secret:checkout-secret",
			ClusterID: "test",
			Kind:      "Secret",
			Namespace: "checkout",
			Name:      "checkout-secret",
			Status:    "healthy",
			Labels:    map[string]string{"app": "checkout-api"},
			Annotations: map[string]string{
				"token": "redaction-fixture",
				"owner": "checkout",
			},
			Summary: map[string]interface{}{"type": "Opaque", "token": "redaction-fixture", "data": "redaction-fixture", "stringData": "redaction-fixture"},
		},
	}
	snapshot.Edges = []topology.Edge{
		{
			ID:          "pod-secret",
			ClusterID:   "test",
			Source:      "test:checkout:Pod:checkout-api",
			Target:      "test:checkout:Secret:checkout-secret",
			Type:        "env-from",
			Confidence:  "observed",
			SourceField: "Pod.spec.containers.envFrom.secretRef",
		},
	}
	return snapshot
}
