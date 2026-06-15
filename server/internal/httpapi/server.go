package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
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

	kind, namespace, name, action, ok := parseResourceRoute(strings.TrimPrefix(r.URL.Path, "/api/resources/"))
	if !ok {
		writeError(w, http.StatusNotFound, "resource_not_found")
		return
	}

	snapshot, err := s.provider.Snapshot(r.Context())
	if err != nil {
		writeProviderError(w, err)
		return
	}

	if action == "logs/stream" {
		s.handleResourceLogStream(w, r, snapshot, kind, namespace, name)
		return
	}

	if action == "events" {
		if !resourceExists(snapshot, kind, namespace, name) {
			writeError(w, http.StatusNotFound, "resource_not_found")
			return
		}
		eventProvider, ok := s.provider.(provider.EventProvider)
		if !ok {
			writeJSON(w, http.StatusOK, topology.ResourceEvents{Items: []topology.ResourceEvent{}})
			return
		}
		resourceEvents, err := eventProvider.ResourceEvents(r.Context(), provider.ResourceRef{Kind: kind, Namespace: namespace, Name: name})
		if err != nil {
			writeJSON(w, http.StatusOK, topology.ResourceEvents{Items: []topology.ResourceEvent{}, Warning: "events_unavailable"})
			return
		}
		if resourceEvents.Items == nil {
			resourceEvents.Items = []topology.ResourceEvent{}
		}
		writeJSON(w, http.StatusOK, resourceEvents)
		return
	}
	if action == "logs" {
		if kind != "Pod" || namespace == "" || !resourceExists(snapshot, kind, namespace, name) {
			writeError(w, http.StatusNotFound, "resource_not_found")
			return
		}
		logProvider, ok := s.provider.(provider.LogProvider)
		if !ok {
			writeJSON(w, http.StatusOK, topology.ResourceLogs{Lines: []string{}, Warning: "logs_unavailable", TailLines: 200})
			return
		}
		ref := logResourceRefFromRequest(kind, namespace, name, r)
		resourceLogs, err := logProvider.ResourceLogs(r.Context(), ref)
		if err != nil {
			writeJSON(w, http.StatusOK, topology.ResourceLogs{Lines: []string{}, Warning: "logs_unavailable", TailLines: 200})
			return
		}
		if resourceLogs.Lines == nil {
			resourceLogs.Lines = []string{}
		}
		writeJSON(w, http.StatusOK, resourceLogs)
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

func (s *Server) handleResourceLogStream(w http.ResponseWriter, r *http.Request, snapshot topology.Snapshot, kind string, namespace string, name string) {
	if kind != "Pod" || namespace == "" || !resourceExists(snapshot, kind, namespace, name) {
		writeError(w, http.StatusNotFound, "resource_not_found")
		return
	}

	logProvider, ok := s.provider.(provider.LogProvider)
	if !ok {
		writeJSON(w, http.StatusOK, topology.ResourceLogs{Lines: []string{}, Warning: "logs_unavailable", TailLines: 200})
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming_unsupported")
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	ref := logResourceRefFromRequest(kind, namespace, name, r)
	ref.Follow = true
	if err := logProvider.StreamLogs(r.Context(), ref, func(line string) error {
		return writeLogStreamMessage(w, flusher, logStreamMessage{Line: line})
	}); err != nil {
		_ = writeLogStreamMessage(w, flusher, logStreamMessage{Warning: "logs_unavailable"})
	}
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

func parseResourceRoute(path string) (string, string, string, string, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 3 && len(parts) != 4 && len(parts) != 5 {
		return "", "", "", "", false
	}
	action := ""
	if len(parts) == 4 {
		action = parts[3]
	}
	if len(parts) == 5 {
		if parts[3] != "logs" || parts[4] != "stream" {
			return "", "", "", "", false
		}
		action = "logs/stream"
	}
	if action != "" && action != "events" && action != "logs" && action != "logs/stream" {
		return "", "", "", "", false
	}
	kind, namespace, name := parts[0], parts[1], parts[2]
	if namespace == "-" {
		namespace = ""
	}
	if kind == "" || name == "" {
		return "", "", "", "", false
	}
	return kind, namespace, name, action, true
}

type logStreamMessage struct {
	Line    string `json:"line,omitempty"`
	Warning string `json:"warning,omitempty"`
}

func writeLogStreamMessage(w http.ResponseWriter, flusher http.Flusher, message logStreamMessage) error {
	payload, err := json.Marshal(message)
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	if _, err := w.Write(payload); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

func logResourceRefFromRequest(kind string, namespace string, name string, r *http.Request) provider.ResourceRef {
	tailLines := 200
	if rawTailLines := r.URL.Query().Get("tailLines"); rawTailLines != "" {
		if parsedTailLines, err := strconv.Atoi(rawTailLines); err == nil && parsedTailLines > 0 && parsedTailLines <= 200 {
			tailLines = parsedTailLines
		}
	}
	return provider.ResourceRef{
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
		Container: r.URL.Query().Get("container"),
		Previous:  strings.EqualFold(r.URL.Query().Get("previous"), "true"),
		TailLines: tailLines,
	}
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
			Annotations: safeAnnotations(node.Annotations),
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
		if lowerKey == "data" || lowerKey == "stringdata" || sensitiveField(lowerKey) {
			delete(summary, key)
		}
	}
	summary["values"] = "hidden"
	return summary
}

func safePreview(node topology.Node) map[string]interface{} {
	preview := map[string]interface{}{
		"metadata": map[string]interface{}{
			"kind":              node.Kind,
			"name":              node.Name,
			"namespace":         node.Namespace,
			"cluster":           node.ClusterID,
			"uid":               shortUID(node.UID),
			"age":               node.Age,
			"owners":            cloneStringSlice(node.Owners),
			"labels":            len(node.Labels),
			"safeAnnotations":   len(safeAnnotations(node.Annotations)),
			"hiddenAnnotations": hiddenAnnotationCount(node.Annotations),
		},
		"status":  statusPreview(node),
		"summary": safeSummary(node),
	}
	preview["safeYaml"] = safeYAMLPreview(node)
	if node.Kind == "Secret" {
		preview["secretValues"] = "hidden"
	}
	return preview
}

func statusPreview(node topology.Node) map[string]interface{} {
	preview := safeSummary(node)
	preview["status"] = node.Status
	return preview
}

func safeAnnotations(values map[string]string) map[string]string {
	if values == nil {
		return map[string]string{}
	}
	safe := map[string]string{}
	for key, value := range values {
		if sensitiveField(key) || sensitiveField(value) {
			safe[key] = "redacted"
			continue
		}
		safe[key] = value
	}
	return safe
}

func hiddenAnnotationCount(values map[string]string) int {
	count := 0
	for key, value := range values {
		if value == "redacted" || sensitiveField(key) || sensitiveField(value) {
			count++
		}
	}
	return count
}

func sensitiveField(value string) bool {
	lowerValue := strings.ToLower(value)
	return strings.Contains(lowerValue, "token") ||
		strings.Contains(lowerValue, "password") ||
		strings.Contains(lowerValue, "secret") ||
		strings.Contains(lowerValue, "credential") ||
		strings.Contains(lowerValue, "apikey") ||
		strings.Contains(lowerValue, "api-key") ||
		strings.Contains(lowerValue, "accesskey") ||
		strings.Contains(lowerValue, "access-key") ||
		strings.Contains(lowerValue, "private-key") ||
		strings.Contains(lowerValue, "client-key")
}

func safeYAMLPreview(node topology.Node) string {
	lines := []string{
		"apiVersion: kuviewer.io/v1",
		"kind: " + yamlScalar(node.Kind),
		"metadata:",
		"  name: " + yamlScalar(node.Name),
	}
	if node.Namespace != "" {
		lines = append(lines, "  namespace: "+yamlScalar(node.Namespace))
	}
	lines = append(lines, "  cluster: "+yamlScalar(node.ClusterID))
	if node.UID != "" {
		lines = append(lines, "  uid: "+yamlScalar(shortUID(node.UID)))
	}
	if node.Age != "" {
		lines = append(lines, "  age: "+yamlScalar(node.Age))
	}
	appendStringMapYAML(&lines, "  labels", node.Labels)
	appendStringMapYAML(&lines, "  annotations", safeAnnotations(node.Annotations))
	appendStringSliceYAML(&lines, "  owners", node.Owners)
	lines = append(lines, "status:")
	lines = append(lines, "  state: "+yamlScalar(node.Status))
	appendInterfaceMapYAML(&lines, "summary", safeSummary(node))
	if node.Kind == "Secret" {
		lines = append(lines, "secretValues: hidden")
	}
	return strings.Join(lines, "\n")
}

func appendStringMapYAML(lines *[]string, key string, values map[string]string) {
	if len(values) == 0 {
		*lines = append(*lines, key+": {}")
		return
	}
	*lines = append(*lines, key+":")
	for _, itemKey := range sortedStringKeys(values) {
		value := values[itemKey]
		if sensitiveField(itemKey) || sensitiveField(value) {
			value = "redacted"
		}
		*lines = append(*lines, fmt.Sprintf("    %s: %s", yamlKey(itemKey), yamlScalar(value)))
	}
}

func appendStringSliceYAML(lines *[]string, key string, values []string) {
	if len(values) == 0 {
		*lines = append(*lines, key+": []")
		return
	}
	*lines = append(*lines, key+":")
	for _, value := range values {
		*lines = append(*lines, "    - "+yamlScalar(value))
	}
}

func appendInterfaceMapYAML(lines *[]string, key string, values map[string]interface{}) {
	if len(values) == 0 {
		*lines = append(*lines, key+": {}")
		return
	}
	*lines = append(*lines, key+":")
	for _, itemKey := range sortedInterfaceKeys(values) {
		appendYAMLValue(lines, "  ", itemKey, values[itemKey])
	}
}

func appendYAMLValue(lines *[]string, indent string, key string, value interface{}) {
	if sensitiveField(key) {
		*lines = append(*lines, fmt.Sprintf("%s%s: redacted", indent, yamlKey(key)))
		return
	}
	switch typed := value.(type) {
	case []string:
		if len(typed) == 0 {
			*lines = append(*lines, fmt.Sprintf("%s%s: []", indent, yamlKey(key)))
			return
		}
		*lines = append(*lines, fmt.Sprintf("%s%s:", indent, yamlKey(key)))
		for _, item := range typed {
			*lines = append(*lines, indent+"  - "+safeYAMLScalar(item))
		}
	case []interface{}:
		if len(typed) == 0 {
			*lines = append(*lines, fmt.Sprintf("%s%s: []", indent, yamlKey(key)))
			return
		}
		*lines = append(*lines, fmt.Sprintf("%s%s:", indent, yamlKey(key)))
		for _, item := range typed {
			*lines = append(*lines, indent+"  - "+safeYAMLScalar(item))
		}
	default:
		*lines = append(*lines, fmt.Sprintf("%s%s: %s", indent, yamlKey(key), safeYAMLScalar(typed)))
	}
}

func safeYAMLScalar(value interface{}) string {
	if text, ok := value.(string); ok && sensitiveField(text) {
		return "redacted"
	}
	return yamlScalar(value)
}

func yamlScalar(value interface{}) string {
	switch typed := value.(type) {
	case nil:
		return "''"
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return fmt.Sprint(typed)
	default:
		text := fmt.Sprint(typed)
		if text == "" {
			return "''"
		}
		if yamlBareScalar(text) {
			return text
		}
		return "'" + strings.ReplaceAll(text, "'", "''") + "'"
	}
}

func yamlBareScalar(value string) bool {
	if value == "true" || value == "false" || value == "null" {
		return false
	}
	for _, character := range value {
		if !(character == '-' || character == '_' || character == '.' || character == '/' || character == ':' || (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9')) {
			return false
		}
	}
	return true
}

func yamlKey(value string) string {
	if yamlBareScalar(value) {
		return value
	}
	return yamlScalar(value)
}

func sortedStringKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedInterfaceKeys(values map[string]interface{}) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func shortUID(uid string) string {
	if len(uid) <= 12 {
		return uid
	}
	return uid[:12]
}

func cloneStringSlice(values []string) []string {
	if values == nil {
		return []string{}
	}
	cloned := make([]string, len(values))
	copy(cloned, values)
	return cloned
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
