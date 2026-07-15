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
	"sync"
	"testing"
	"time"

	"kuviewer/server/internal/provider"
	"kuviewer/server/internal/topology"
)

type stubProvider struct {
	snapshot topology.Snapshot
	err      error
}

type countingProvider struct {
	mu       sync.Mutex
	snapshot topology.Snapshot
	delay    time.Duration
	calls    int
}

func (p *countingProvider) Snapshot(ctx context.Context) (topology.Snapshot, error) {
	if p.delay > 0 {
		select {
		case <-ctx.Done():
			return topology.Snapshot{}, ctx.Err()
		case <-time.After(p.delay):
		}
	}
	p.mu.Lock()
	p.calls++
	p.mu.Unlock()
	return p.snapshot, nil
}

func (p *countingProvider) callCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls
}

func (p stubProvider) Snapshot(context.Context) (topology.Snapshot, error) {
	return p.snapshot, p.err
}

type eventStubProvider struct {
	stubProvider
	events   topology.ResourceEvents
	eventErr error
}

type capabilityStubProvider struct {
	stubProvider
	report topology.CapabilityReport
	err    error
}

func (p capabilityStubProvider) Capabilities(context.Context) (topology.CapabilityReport, error) {
	return p.report, p.err
}

func (p eventStubProvider) ResourceEvents(context.Context, provider.ResourceRef) (topology.ResourceEvents, error) {
	return p.events, p.eventErr
}

type logStubProvider struct {
	stubProvider
	logs        topology.ResourceLogs
	logErr      error
	ref         *provider.ResourceRef
	streamLines []string
	streamErr   error
	streamRef   *provider.ResourceRef
}

func (p logStubProvider) ResourceLogs(_ context.Context, ref provider.ResourceRef) (topology.ResourceLogs, error) {
	if p.ref != nil {
		*p.ref = ref
	}
	return p.logs, p.logErr
}

func (p logStubProvider) StreamLogs(_ context.Context, ref provider.ResourceRef, onLine func(string) error) error {
	if p.streamRef != nil {
		*p.streamRef = ref
	}
	if p.streamErr != nil {
		return p.streamErr
	}
	for _, line := range p.streamLines {
		if err := onLine(line); err != nil {
			return err
		}
	}
	return nil
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

func TestCapabilitiesRequiresAdminBearerToken(t *testing.T) {
	handler := NewServer(capabilityStubProvider{}, "secret-token", "", "")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/capabilities", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}

func TestCapabilitiesReturnsSafeProviderReport(t *testing.T) {
	handler := NewServerWithConfig(capabilityStubProvider{
		report: topology.CapabilityReport{
			Source:    "kubernetes",
			CheckedAt: "2026-07-15T00:00:00Z",
			Items: []topology.ResourceCapability{
				{ID: "core/pods", Group: "Core", Resource: "Pods", Required: true, Status: "available", Reason: "read_allowed"},
				{ID: "gateway/gateways", Group: "Gateway API", Resource: "Gateways", Status: "forbidden", Reason: "rbac_denied"},
			},
		},
	}, ServerConfig{AdminToken: "secret-token", Source: "kubernetes"})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/capabilities", nil)
	request.Header.Set("Authorization", "Bearer secret-token")

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	var report topology.CapabilityReport
	if err := json.NewDecoder(recorder.Body).Decode(&report); err != nil {
		t.Fatalf("decode capabilities: %v", err)
	}
	if report.Source != "kubernetes" || len(report.Items) != 2 {
		t.Fatalf("unexpected report: %+v", report)
	}
	if report.Items[1].Reason != "rbac_denied" {
		t.Fatalf("reason = %q, want rbac_denied", report.Items[1].Reason)
	}
}

func TestCapabilitiesUnsupportedProviderFallsBack(t *testing.T) {
	handler := NewServerWithConfig(stubProvider{snapshot: testSnapshot()}, ServerConfig{AdminToken: "secret-token", Source: "custom"})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/capabilities", nil)
	request.Header.Set("Authorization", "Bearer secret-token")

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	var report topology.CapabilityReport
	if err := json.NewDecoder(recorder.Body).Decode(&report); err != nil {
		t.Fatalf("decode capabilities: %v", err)
	}
	if report.Warning != "capability_probe_unsupported" || len(report.Items) != 0 {
		t.Fatalf("unexpected fallback: %+v", report)
	}
}

func TestCapabilitiesProviderErrorReturnsSafeWarning(t *testing.T) {
	handler := NewServerWithConfig(capabilityStubProvider{err: errors.New("sensitive provider detail")}, ServerConfig{AdminToken: "secret-token", Source: "kubernetes"})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/capabilities", nil)
	request.Header.Set("Authorization", "Bearer secret-token")

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if strings.Contains(recorder.Body.String(), "sensitive provider detail") {
		t.Fatal("provider error leaked into capability response")
	}
	var report topology.CapabilityReport
	if err := json.NewDecoder(recorder.Body).Decode(&report); err != nil {
		t.Fatalf("decode capabilities: %v", err)
	}
	if report.Warning != "capability_probe_unavailable" || len(report.Items) != 0 {
		t.Fatalf("unexpected fallback: %+v", report)
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

func TestSnapshotCacheReusesSnapshotAcrossEndpointsAndSupportsRefresh(t *testing.T) {
	provider := &countingProvider{snapshot: resourceTestSnapshot()}
	handler := NewServerWithConfig(provider, ServerConfig{AdminToken: "secret-token", SnapshotCacheTTL: time.Minute})

	first := authenticatedRequest(t, handler, "/api/topology")
	if first.Code != http.StatusOK || first.Header().Get("X-Kuviewer-Snapshot-Cache") != "miss" {
		t.Fatalf("first snapshot status=%d cache=%q", first.Code, first.Header().Get("X-Kuviewer-Snapshot-Cache"))
	}
	second := authenticatedRequest(t, handler, "/api/resources")
	if second.Code != http.StatusOK || second.Header().Get("X-Kuviewer-Snapshot-Cache") != "hit" {
		t.Fatalf("second snapshot status=%d cache=%q", second.Code, second.Header().Get("X-Kuviewer-Snapshot-Cache"))
	}
	if got := provider.callCount(); got != 1 {
		t.Fatalf("provider calls=%d, want 1", got)
	}

	refreshed := authenticatedRequest(t, handler, "/api/topology?refresh=true")
	if refreshed.Code != http.StatusOK || refreshed.Header().Get("X-Kuviewer-Snapshot-Cache") != "miss" {
		t.Fatalf("refresh status=%d cache=%q", refreshed.Code, refreshed.Header().Get("X-Kuviewer-Snapshot-Cache"))
	}
	if got := provider.callCount(); got != 2 {
		t.Fatalf("provider calls after refresh=%d, want 2", got)
	}
}

func TestSnapshotCacheSharesConcurrentLoads(t *testing.T) {
	provider := &countingProvider{snapshot: resourceTestSnapshot(), delay: 25 * time.Millisecond}
	handler := NewServerWithConfig(provider, ServerConfig{AdminToken: "secret-token", SnapshotCacheTTL: time.Minute})

	const requestCount = 8
	var waitGroup sync.WaitGroup
	statuses := make(chan int, requestCount)
	cacheStatuses := make(chan string, requestCount)
	for index := 0; index < requestCount; index++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			recorder := authenticatedRequest(t, handler, "/api/resources?limit=1")
			statuses <- recorder.Code
			cacheStatuses <- recorder.Header().Get("X-Kuviewer-Snapshot-Cache")
		}()
	}
	waitGroup.Wait()
	close(statuses)
	close(cacheStatuses)
	for status := range statuses {
		if status != http.StatusOK {
			t.Fatalf("concurrent request status=%d, want 200", status)
		}
	}
	shared := 0
	for cacheStatus := range cacheStatuses {
		if cacheStatus == "shared" {
			shared++
		}
	}
	if shared == 0 {
		t.Fatal("expected at least one concurrent request to share the in-flight snapshot")
	}
	if got := provider.callCount(); got != 1 {
		t.Fatalf("provider calls=%d, want 1", got)
	}
}

func TestSnapshotCacheExpires(t *testing.T) {
	provider := &countingProvider{snapshot: resourceTestSnapshot()}
	handler := NewServerWithConfig(provider, ServerConfig{AdminToken: "secret-token", SnapshotCacheTTL: 10 * time.Millisecond})

	if recorder := authenticatedRequest(t, handler, "/api/topology"); recorder.Code != http.StatusOK {
		t.Fatalf("first request status=%d", recorder.Code)
	}
	time.Sleep(30 * time.Millisecond)
	if recorder := authenticatedRequest(t, handler, "/api/topology"); recorder.Code != http.StatusOK {
		t.Fatalf("second request status=%d", recorder.Code)
	}
	if got := provider.callCount(); got != 2 {
		t.Fatalf("provider calls=%d, want 2 after TTL expiry", got)
	}
}

func TestResourcesSupportFilteringSortingAndCursorPagination(t *testing.T) {
	handler := NewServerWithConfig(stubProvider{snapshot: resourceTestSnapshot()}, ServerConfig{AdminToken: "secret-token", SnapshotCacheTTL: time.Minute})

	first := authenticatedRequest(t, handler, "/api/resources?limit=1&sort=name&direction=asc")
	var firstPage topology.ResourceList
	if err := json.NewDecoder(first.Body).Decode(&firstPage); err != nil {
		t.Fatalf("decode first page: %v", err)
	}
	if len(firstPage.Items) != 1 || firstPage.Items[0].Name != "checkout" {
		t.Fatalf("first page=%+v, want Namespace checkout", firstPage.Items)
	}
	if firstPage.Metadata == nil || firstPage.Metadata.Total != 3 || firstPage.Metadata.Filtered != 3 || firstPage.Metadata.Returned != 1 || firstPage.Metadata.NextCursor == "" {
		t.Fatalf("first page metadata=%+v", firstPage.Metadata)
	}
	if len(firstPage.Metadata.Facets.Kinds) != 3 || len(firstPage.Metadata.Facets.Namespaces) != 1 {
		t.Fatalf("facets=%+v", firstPage.Metadata.Facets)
	}

	second := authenticatedRequest(t, handler, "/api/resources?limit=1&sort=name&direction=asc&cursor="+firstPage.Metadata.NextCursor)
	var secondPage topology.ResourceList
	if err := json.NewDecoder(second.Body).Decode(&secondPage); err != nil {
		t.Fatalf("decode second page: %v", err)
	}
	if len(secondPage.Items) != 1 || secondPage.Items[0].Name != "checkout-api" {
		t.Fatalf("second page=%+v, want Pod checkout-api", secondPage.Items)
	}
	mismatchedCursor := authenticatedRequest(t, handler, "/api/resources?limit=1&sort=kind&direction=asc&cursor="+firstPage.Metadata.NextCursor)
	if mismatchedCursor.Code != http.StatusBadRequest {
		t.Fatalf("mismatched cursor status=%d, want 400", mismatchedCursor.Code)
	}

	filtered := authenticatedRequest(t, handler, "/api/resources?limit=20&kind=Pod&query=sidecar")
	var filteredPage topology.ResourceList
	if err := json.NewDecoder(filtered.Body).Decode(&filteredPage); err != nil {
		t.Fatalf("decode filtered page: %v", err)
	}
	if len(filteredPage.Items) != 1 || filteredPage.Items[0].Kind != "Pod" || filteredPage.Metadata == nil || filteredPage.Metadata.Filtered != 1 {
		t.Fatalf("filtered page=%+v metadata=%+v", filteredPage.Items, filteredPage.Metadata)
	}
}

func TestResourcesRejectInvalidPaginationQueries(t *testing.T) {
	handler := NewServer(stubProvider{snapshot: resourceTestSnapshot()}, "secret-token", "", "")
	for _, path := range []string{
		"/api/resources?limit=0",
		"/api/resources?limit=201",
		"/api/resources?limit=20&cursor=not-base64!",
		"/api/resources?cursor=MA",
		"/api/resources?sort=unknown",
		"/api/resources?direction=sideways",
	} {
		recorder := authenticatedRequest(t, handler, path)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("path=%q status=%d, want 400", path, recorder.Code)
		}
	}
}

func authenticatedRequest(t *testing.T, handler http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Header.Set("Authorization", "Bearer secret-token")
	handler.ServeHTTP(recorder, request)
	return recorder
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

	t.Run("stream logs require token", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/checkout-api/logs/stream", nil)
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
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/checkout-api/logs?container=api&previous=true&tailLines=150", nil)
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
		if !gotRef.Previous {
			t.Fatalf("previous = false, want true")
		}
		if gotRef.TailLines != 150 {
			t.Fatalf("tailLines = %d, want 150", gotRef.TailLines)
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

	t.Run("provider stream logs", func(t *testing.T) {
		var gotRef provider.ResourceRef
		logHandler := NewServer(logStubProvider{
			stubProvider: stubProvider{snapshot: resourceTestSnapshot()},
			streamLines:  []string{"line-1", "line-2"},
			streamRef:    &gotRef,
		}, "secret-token", "", "")
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/checkout-api/logs/stream?container=api&previous=true&tailLines=25", nil)
		request.Header.Set("Authorization", "Bearer secret-token")
		logHandler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		if got := recorder.Header().Get("Content-Type"); got != "application/x-ndjson" {
			t.Fatalf("content-type = %q, want ndjson", got)
		}
		if gotRef.Container != "api" {
			t.Fatalf("container = %q, want api", gotRef.Container)
		}
		if !gotRef.Previous {
			t.Fatalf("previous = false, want true")
		}
		if !gotRef.Follow {
			t.Fatalf("follow = false, want true")
		}
		if gotRef.TailLines != 25 {
			t.Fatalf("tailLines = %d, want 25", gotRef.TailLines)
		}
		body := recorder.Body.String()
		if !strings.Contains(body, `"line":"line-1"`) || !strings.Contains(body, `"line":"line-2"`) {
			t.Fatalf("stream body = %q, want line messages", body)
		}
	})

	t.Run("provider stream logs fallback warning", func(t *testing.T) {
		logHandler := NewServer(logStubProvider{
			stubProvider: stubProvider{snapshot: resourceTestSnapshot()},
			streamErr:    errors.New("forbidden"),
		}, "secret-token", "", "")
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resources/Pod/checkout/checkout-api/logs/stream", nil)
		request.Header.Set("Authorization", "Bearer secret-token")
		logHandler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		if body := recorder.Body.String(); !strings.Contains(body, `"warning":"logs_unavailable"`) {
			t.Fatalf("stream body = %q, want warning message", body)
		}
	})
}

func TestResourceViewPresetsRequireAdminBearerToken(t *testing.T) {
	handler := NewServer(stubProvider{snapshot: testSnapshot()}, "secret-token", "", "")

	for _, method := range []string{http.MethodGet, http.MethodPut} {
		t.Run(method, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(method, "/api/resource-views", strings.NewReader(`{"items":[]}`))
			handler.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestResourceViewPresetsMemoryStore(t *testing.T) {
	handler := NewServerWithConfig(stubProvider{snapshot: testSnapshot()}, ServerConfig{AdminToken: "secret-token"})

	t.Run("empty by default", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/resource-views", nil)
		request.Header.Set("Authorization", "Bearer secret-token")
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		var list resourceViewPresetList
		if err := json.NewDecoder(recorder.Body).Decode(&list); err != nil {
			t.Fatalf("decode list: %v", err)
		}
		if len(list.Items) != 0 {
			t.Fatalf("items = %+v, want empty", list.Items)
		}
		if list.Metadata.Storage != "memory" || list.Metadata.Count != 0 {
			t.Fatalf("metadata = %+v, want empty memory snapshot", list.Metadata)
		}
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/resource-views", strings.NewReader(`{
		"items": [
			{"name":" Pods ","group":" Workloads ","query":"checkout","cluster":"","namespace":"checkout","kind":"Pod","status":"healthy","order":1,"updatedAt":1000},
			{"name":"Pods","query":"duplicate","cluster":"test","namespace":"checkout","kind":"Service","status":"warning","updatedAt":2000},
			{"name":"Services","query":42,"cluster":"test","namespace":"","kind":"Service","status":"","updatedAt":"bad"},
			{"name":"","query":"skip","cluster":"test","namespace":"checkout","kind":"Pod","status":"healthy","updatedAt":3000},
			{"name":"Three","query":"","cluster":"test","namespace":"checkout","kind":"Pod","status":"healthy","updatedAt":3000},
			{"name":"Four","query":"","cluster":"test","namespace":"checkout","kind":"Pod","status":"healthy","updatedAt":4000},
			{"name":"Five","query":"","cluster":"test","namespace":"checkout","kind":"Pod","status":"healthy","updatedAt":5000},
			{"name":"Six","query":"","cluster":"test","namespace":"checkout","kind":"Pod","status":"healthy","updatedAt":6000},
			{"name":"Seven","query":"","cluster":"test","namespace":"checkout","kind":"Pod","status":"healthy","updatedAt":7000},
			{"name":"Eight","query":"","cluster":"test","namespace":"checkout","kind":"Pod","status":"healthy","updatedAt":8000},
			{"name":"Nine","query":"","cluster":"test","namespace":"checkout","kind":"Pod","status":"healthy","updatedAt":9000}
		]
	}`))
	request.Header.Set("Authorization", "Bearer secret-token")
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var saved resourceViewPresetList
	if err := json.NewDecoder(recorder.Body).Decode(&saved); err != nil {
		t.Fatalf("decode saved: %v", err)
	}
	if len(saved.Items) != 8 {
		t.Fatalf("items = %d, want 8: %+v", len(saved.Items), saved.Items)
	}
	if saved.Metadata.Storage != "memory" || saved.Metadata.Count != 8 || saved.Metadata.Version <= 0 || saved.Metadata.UpdatedAt <= 0 {
		t.Fatalf("metadata = %+v, want saved memory snapshot metadata", saved.Metadata)
	}
	if saved.Items[0].Name != "Pods" || saved.Items[0].Group != "Workloads" || saved.Items[0].Cluster != "all" || saved.Items[0].Query != "checkout" || saved.Items[0].Order != 1 {
		t.Fatalf("first item = %+v, want trimmed first Pods preset", saved.Items[0])
	}
	if saved.Items[1].Name != "Services" || saved.Items[1].Group != "General" || saved.Items[1].Query != "" || saved.Items[1].Namespace != "all" || saved.Items[1].Status != "all" || saved.Items[1].Order != 2 || saved.Items[1].UpdatedAt <= 0 {
		t.Fatalf("second item = %+v, want normalized Services preset", saved.Items[1])
	}
	for index, item := range saved.Items {
		if item.Order != int64(index+1) {
			t.Fatalf("item order = %d for index %d, want contiguous order: %+v", item.Order, index, saved.Items)
		}
		if item.Name == "Nine" {
			t.Fatalf("item Nine was not truncated: %+v", saved.Items)
		}
	}
}

func TestResourceViewPresetsFileStore(t *testing.T) {
	viewsPath := filepath.Join(t.TempDir(), "nested", "resource-views.json")
	handler := NewServerWithConfig(stubProvider{snapshot: testSnapshot()}, ServerConfig{
		AdminToken:        "secret-token",
		ResourceViewsFile: viewsPath,
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/resource-views", nil)
	request.Header.Set("Authorization", "Bearer secret-token")
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	var empty resourceViewPresetList
	if err := json.NewDecoder(recorder.Body).Decode(&empty); err != nil {
		t.Fatalf("decode empty list: %v", err)
	}
	if len(empty.Items) != 0 {
		t.Fatalf("items = %+v, want empty", empty.Items)
	}
	if empty.Metadata.Storage != "file" || empty.Metadata.Count != 0 {
		t.Fatalf("metadata = %+v, want empty file snapshot", empty.Metadata)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPut, "/api/resource-views", strings.NewReader(`{"items":[{"name":"Team Pods","group":"Team","query":"checkout","cluster":"test","namespace":"checkout","kind":"Pod","status":"healthy","order":20,"updatedAt":1234}]}`))
	request.Header.Set("Authorization", "Bearer secret-token")
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var saved resourceViewPresetList
	if err := json.NewDecoder(recorder.Body).Decode(&saved); err != nil {
		t.Fatalf("decode saved list: %v", err)
	}
	if saved.Metadata.Storage != "file" || saved.Metadata.Count != 1 || saved.Metadata.Version <= 0 || saved.Metadata.UpdatedAt <= 0 {
		t.Fatalf("saved metadata = %+v, want saved file snapshot metadata", saved.Metadata)
	}
	info, err := os.Stat(viewsPath)
	if err != nil {
		t.Fatalf("stat views file: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("mode = %o, want 0600", got)
	}

	reloadedHandler := NewServerWithConfig(stubProvider{snapshot: testSnapshot()}, ServerConfig{
		AdminToken:        "secret-token",
		ResourceViewsFile: viewsPath,
	})
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/resource-views", nil)
	request.Header.Set("Authorization", "Bearer secret-token")
	reloadedHandler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	var reloaded resourceViewPresetList
	if err := json.NewDecoder(recorder.Body).Decode(&reloaded); err != nil {
		t.Fatalf("decode reloaded list: %v", err)
	}
	if len(reloaded.Items) != 1 || reloaded.Items[0].Name != "Team Pods" || reloaded.Items[0].Group != "Team" || reloaded.Items[0].Order != 1 {
		t.Fatalf("reloaded = %+v, want persisted Team Pods", reloaded.Items)
	}
	if reloaded.Metadata.Storage != "file" || reloaded.Metadata.Count != 1 || reloaded.Metadata.Version != saved.Metadata.Version || reloaded.Metadata.UpdatedAt != saved.Metadata.UpdatedAt {
		t.Fatalf("reloaded metadata = %+v, want persisted metadata %+v", reloaded.Metadata, saved.Metadata)
	}
}

func TestResourceViewPresetsFileStoreReadsLegacyItemsPayload(t *testing.T) {
	viewsPath := filepath.Join(t.TempDir(), "resource-views.json")
	if err := os.WriteFile(viewsPath, []byte(`{"items":[{"name":"Legacy Pods","group":"Team","query":"legacy","cluster":"test","namespace":"default","kind":"Pod","status":"healthy","updatedAt":1234}]}`), 0o600); err != nil {
		t.Fatalf("write legacy views file: %v", err)
	}
	handler := NewServerWithConfig(stubProvider{snapshot: testSnapshot()}, ServerConfig{
		AdminToken:        "secret-token",
		ResourceViewsFile: viewsPath,
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/resource-views", nil)
	request.Header.Set("Authorization", "Bearer secret-token")
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var list resourceViewPresetList
	if err := json.NewDecoder(recorder.Body).Decode(&list); err != nil {
		t.Fatalf("decode legacy list: %v", err)
	}
	if len(list.Items) != 1 || list.Items[0].Name != "Legacy Pods" {
		t.Fatalf("items = %+v, want legacy preset", list.Items)
	}
	if list.Metadata.Storage != "file" || list.Metadata.Count != 1 || list.Metadata.Version != 1234 || list.Metadata.UpdatedAt != 1234 {
		t.Fatalf("metadata = %+v, want fallback metadata from legacy preset timestamp", list.Metadata)
	}
}

func TestResourceViewPresetsCorruptFileReturnsSafeError(t *testing.T) {
	viewsPath := filepath.Join(t.TempDir(), "resource-views.json")
	if err := os.WriteFile(viewsPath, []byte(`{"items":[{"name":"leaky-token-value"`), 0o600); err != nil {
		t.Fatalf("write corrupt file: %v", err)
	}
	handler := NewServerWithConfig(stubProvider{snapshot: testSnapshot()}, ServerConfig{
		AdminToken:        "secret-token",
		ResourceViewsFile: viewsPath,
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/resource-views", nil)
	request.Header.Set("Authorization", "Bearer secret-token")
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "resource_views_unavailable") {
		t.Fatalf("body = %q, want safe resource_views_unavailable error", body)
	}
	if strings.Contains(body, "leaky-token-value") {
		t.Fatalf("body leaked corrupt file contents: %q", body)
	}
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
	if got := recorder.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, http.MethodPut) {
		t.Fatalf("Access-Control-Allow-Methods = %q, want PUT", got)
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

func TestAuthenticatedAPIResponsesDisableBrowserCaching(t *testing.T) {
	handler := NewServer(stubProvider{snapshot: testSnapshot()}, "secret-token", "", "")
	recorder := authenticatedRequest(t, handler, "/api/status")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control=%q, want no-store", got)
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
