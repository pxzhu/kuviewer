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
