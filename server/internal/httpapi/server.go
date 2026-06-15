package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"kuviewer/server/internal/provider"
)

type Server struct {
	provider   provider.TopologyProvider
	adminToken string
	corsOrigin string
	staticDir  string
	source     string
	mux        *http.ServeMux
}

type ServerConfig struct {
	AdminToken string
	CORSOrigin string
	StaticDir  string
	Source     string
}

type statusResponse struct {
	Mode       string `json:"mode"`
	Source     string `json:"source"`
	ReadOnly   bool   `json:"readOnly"`
	Secrets    string `json:"secrets"`
	Static     bool   `json:"static"`
	ServerTime string `json:"serverTime"`
}

func NewServer(snapshotProvider provider.TopologyProvider, adminToken string, corsOrigin string, staticDir string) http.Handler {
	return NewServerWithConfig(snapshotProvider, ServerConfig{
		AdminToken: adminToken,
		CORSOrigin: corsOrigin,
		StaticDir:  staticDir,
	})
}

func NewServerWithConfig(snapshotProvider provider.TopologyProvider, config ServerConfig) http.Handler {
	source := strings.TrimSpace(config.Source)
	if source == "" {
		source = "mock"
	}

	server := &Server{
		provider:   snapshotProvider,
		adminToken: config.AdminToken,
		corsOrigin: config.CORSOrigin,
		staticDir:  config.StaticDir,
		source:     source,
		mux:        http.NewServeMux(),
	}

	server.routes()
	return server
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("recovered http panic: %v", recovered)
			writeError(w, http.StatusInternalServerError, "internal_server_error")
		}
	}()

	s.setSecurityHeaders(w)
	s.setCORS(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	s.mux.HandleFunc("/healthz", s.handleHealth)
	s.mux.HandleFunc("/api/status", s.requireAdmin(s.handleStatus))
	s.mux.HandleFunc("/api/topology", s.requireAdmin(s.handleTopology))
	if s.staticDir != "" {
		s.mux.HandleFunc("/", s.handleStatic)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	writeJSON(w, http.StatusOK, statusResponse{
		Mode:       "api",
		Source:     s.source,
		ReadOnly:   true,
		Secrets:    "hidden",
		Static:     s.staticDir != "",
		ServerTime: time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleTopology(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	snapshot, err := s.provider.Snapshot(r.Context())
	if err != nil {
		if errors.Is(err, provider.ErrProviderNotImplemented) {
			writeError(w, http.StatusNotImplemented, "provider_not_implemented")
			return
		}

		writeError(w, http.StatusInternalServerError, "topology_snapshot_failed")
		return
	}

	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	path := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if path == "." {
		path = "index.html"
	}

	requested := filepath.Join(s.staticDir, path)
	if !safePath(s.staticDir, requested) {
		writeError(w, http.StatusBadRequest, "invalid_static_path")
		return
	}

	info, err := os.Stat(requested)
	if err != nil || info.IsDir() {
		requested = filepath.Join(s.staticDir, "index.html")
	}

	http.ServeFile(w, r, requested)
}

func (s *Server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.authorized(r.Context(), r.Header.Get("Authorization")) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		next(w, r)
	}
}

func (s *Server) authorized(_ context.Context, header string) bool {
	if s.adminToken == "" {
		return false
	}

	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return false
	}

	return parts[1] == s.adminToken
}

func (s *Server) setCORS(w http.ResponseWriter) {
	if s.corsOrigin == "" {
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", s.corsOrigin)
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Vary", "Origin")
}

func (s *Server) setSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; form-action 'self'")
}

func safePath(root string, requested string) bool {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	requestAbs, err := filepath.Abs(requested)
	if err != nil {
		return false
	}
	return requestAbs == rootAbs || strings.HasPrefix(requestAbs, rootAbs+string(os.PathSeparator))
}

func writeJSON(w http.ResponseWriter, status int, value interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}
