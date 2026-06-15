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
	"kuviewer/server/internal/topology"
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
	s.mux.HandleFunc("/api/resources", s.requireAdmin(s.handleResources))
	s.mux.HandleFunc("/api/resources/", s.requireAdmin(s.handleResourceRoute))
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

func (s *Server) handleResources(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	snapshot, err := s.provider.Snapshot(r.Context())
	if err != nil {
		writeProviderError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, topology.ResourceList{Items: resourcesFromSnapshot(snapshot)})
}

func (s *Server) handleResourceRoute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}

	kind, namespace, name, events, ok := parseResourceRoute(strings.TrimPrefix(r.URL.Path, "/api/resources/"))
	if !ok {
		writeError(w, http.StatusNotFound, "resource_not_found")
		return
	}

	snapshot, err := s.provider.Snapshot(r.Context())
	if err != nil {
		writeProviderError(w, err)
		return
	}

	if events {
		if !resourceExists(snapshot, kind, namespace, name) {
			writeError(w, http.StatusNotFound, "resource_not_found")
			return
		}
		writeJSON(w, http.StatusOK, topology.ResourceEvents{Items: []topology.ResourceEvent{}})
		return
	}

	for _, resource := range resourcesFromSnapshot(snapshot) {
		if resource.Kind == kind && resource.Namespace == namespace && resource.Name == name {
			writeJSON(w, http.StatusOK, resource)
			return
		}
	}

	writeError(w, http.StatusNotFound, "resource_not_found")
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

	responsePath := path
	requested := filepath.Join(s.staticDir, path)
	if !safePath(s.staticDir, requested) {
		writeError(w, http.StatusBadRequest, "invalid_static_path")
		return
	}

	info, err := os.Stat(requested)
	if err != nil || info.IsDir() {
		requested = filepath.Join(s.staticDir, "index.html")
		responsePath = "index.html"
	}

	setStaticCacheHeaders(w, responsePath)
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

func setStaticCacheHeaders(w http.ResponseWriter, path string) {
	if path == "index.html" || strings.HasSuffix(path, ".html") {
		w.Header().Set("Cache-Control", "no-store")
		return
	}
	if strings.HasPrefix(path, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
}

func writeJSON(w http.ResponseWriter, status int, value interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func writeProviderError(w http.ResponseWriter, err error) {
	if errors.Is(err, provider.ErrProviderNotImplemented) {
		writeError(w, http.StatusNotImplemented, "provider_not_implemented")
		return
	}
	writeError(w, http.StatusInternalServerError, "topology_snapshot_failed")
}

func parseResourceRoute(path string) (string, string, string, bool, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 3 && len(parts) != 4 {
		return "", "", "", false, false
	}
	if len(parts) == 4 && parts[3] != "events" {
		return "", "", "", false, false
	}
	kind, namespace, name := parts[0], parts[1], parts[2]
	if namespace == "-" {
		namespace = ""
	}
	if kind == "" || name == "" {
		return "", "", "", false, false
	}
	return kind, namespace, name, len(parts) == 4, true
}

func resourceExists(snapshot topology.Snapshot, kind string, namespace string, name string) bool {
	for _, node := range snapshot.Nodes {
		if node.Kind == kind && node.Namespace == namespace && node.Name == name {
			return true
		}
	}
	return false
}

func resourcesFromSnapshot(snapshot topology.Snapshot) []topology.Resource {
	nodeByID := make(map[string]topology.Node, len(snapshot.Nodes))
	for _, node := range snapshot.Nodes {
		nodeByID[node.ID] = node
	}

	resources := make([]topology.Resource, 0, len(snapshot.Nodes))
	for _, node := range snapshot.Nodes {
		resources = append(resources, topology.Resource{
			ID:          node.ID,
			ClusterID:   node.ClusterID,
			Kind:        node.Kind,
			Namespace:   node.Namespace,
			Name:        node.Name,
			Status:      node.Status,
			Labels:      cloneStringMap(node.Labels),
			Annotations: map[string]string{},
			Summary:     safeSummary(node),
			Preview:     safePreview(node),
			Related:     relatedResources(node.ID, snapshot.Edges, nodeByID),
		})
	}
	return resources
}

func relatedResources(nodeID string, edges []topology.Edge, nodeByID map[string]topology.Node) []topology.RelatedResource {
	related := []topology.RelatedResource{}
	for _, edge := range edges {
		direction := ""
		relatedID := ""
		if edge.Source == nodeID {
			direction = "outgoing"
			relatedID = edge.Target
		}
		if edge.Target == nodeID {
			direction = "incoming"
			relatedID = edge.Source
		}
		if relatedID == "" {
			continue
		}
		node, ok := nodeByID[relatedID]
		if !ok {
			continue
		}
		related = append(related, topology.RelatedResource{
			NodeID:      relatedID,
			Kind:        node.Kind,
			Namespace:   node.Namespace,
			Name:        node.Name,
			EdgeType:    edge.Type,
			Direction:   direction,
			SourceField: edge.SourceField,
		})
	}
	return related
}

func safeSummary(node topology.Node) map[string]interface{} {
	if node.Kind != "Secret" {
		return cloneInterfaceMap(node.Summary)
	}

	summary := cloneInterfaceMap(node.Summary)
	for key := range summary {
		lowerKey := strings.ToLower(key)
		if lowerKey == "data" || lowerKey == "stringdata" || strings.Contains(lowerKey, "token") || strings.Contains(lowerKey, "password") || strings.Contains(lowerKey, "key") {
			delete(summary, key)
		}
	}
	summary["values"] = "hidden"
	return summary
}

func safePreview(node topology.Node) map[string]interface{} {
	preview := map[string]interface{}{
		"kind":      node.Kind,
		"name":      node.Name,
		"namespace": node.Namespace,
		"status":    node.Status,
		"labels":    cloneStringMap(node.Labels),
		"summary":   safeSummary(node),
	}
	if node.Kind == "Secret" {
		preview["secretValues"] = "hidden"
	}
	return preview
}

func cloneStringMap(values map[string]string) map[string]string {
	if values == nil {
		return map[string]string{}
	}
	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func cloneInterfaceMap(values map[string]interface{}) map[string]interface{} {
	if values == nil {
		return map[string]interface{}{}
	}
	cloned := make(map[string]interface{}, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}
