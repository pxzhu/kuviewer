package provider

import (
	"strings"
	"testing"
)

func TestSafeMetadataLabelsValidateRedactCloneAndCap(t *testing.T) {
	values := map[string]string{
		"app":               "api",
		"example.com/token": "fixture-token",
		"bad key":           "ignored",
	}
	safe := safeMetadataLabels(values)
	values["app"] = "mutated"
	if safe["app"] != "api" || safe["example.com/token"] != "redacted" {
		t.Fatalf("safeMetadataLabels() = %#v", safe)
	}
	if _, exists := safe["bad key"]; exists {
		t.Fatalf("safeMetadataLabels() retained malformed key: %#v", safe)
	}

	oversized := make(map[string]string, maxMetadataEntries+1)
	for index := 0; index <= maxMetadataEntries; index++ {
		oversized["key-"+metadataTestSuffix(index)] = "value"
	}
	if got := safeMetadataLabels(oversized); len(got) != 0 {
		t.Fatalf("safeMetadataLabels() retained oversized metadata: %d", len(got))
	}
}

func TestSafeMetadataAnnotationsRedactRiskyAndOmitUnsafeValues(t *testing.T) {
	longValue := strings.Repeat("x", maxAnnotationValueBytes+1)
	values := map[string]string{
		"owner": "platform",
		"kubectl.kubernetes.io/last-applied-configuration": `{"data":{"opaque":"fixture"}}`,
		"example.com/password":                             "fixture",
		"example.com/long":                                 longValue,
		"example.com/control":                              "line\nbreak",
		"bad key":                                          "ignored",
	}
	safe := safeMetadataAnnotations(values)
	if safe["owner"] != "platform" {
		t.Fatalf("owner annotation = %q", safe["owner"])
	}
	if safe["kubectl.kubernetes.io/last-applied-configuration"] != "redacted" || safe["example.com/password"] != "redacted" {
		t.Fatalf("risky annotations were not redacted: %#v", safe)
	}
	if safe["example.com/long"] != "omitted" || safe["example.com/control"] != "omitted" {
		t.Fatalf("unsafe annotations were not omitted: %#v", safe)
	}
	if _, exists := safe["bad key"]; exists {
		t.Fatalf("malformed annotation key survived: %#v", safe)
	}

	oversized := make(map[string]string, maxMetadataEntries+1)
	for index := 0; index <= maxMetadataEntries; index++ {
		oversized["example.com/key-"+metadataTestSuffix(index)] = "value"
	}
	if got := safeMetadataAnnotations(oversized); len(got) != 0 {
		t.Fatalf("safeMetadataAnnotations() retained oversized metadata: %d", len(got))
	}
}

func TestSafeSummaryMapKeepsSafeScalarsAndRejectsUnsafeShapes(t *testing.T) {
	names := []string{"api", "worker"}
	input := map[string]interface{}{
		"phase":       " Running ",
		"replicas":    2,
		"ready":       true,
		"containers":  names,
		"password":    "fixture",
		"remote":      "token=fixture-value",
		"long":        strings.Repeat("x", maxSummaryStringBytes+1),
		"nested":      map[string]string{"unsafe": "value"},
		"huge":        int64(maxSummaryInteger + 1),
		"invalid key": "ignored",
	}
	safe := safeSummaryMap(input)
	names[0] = "mutated"
	if safe["phase"] != "Running" || safe["replicas"] != 2 || safe["ready"] != true {
		t.Fatalf("safe summary scalars = %#v", safe)
	}
	if got := safe["containers"].([]string); len(got) != 2 || got[0] != "api" {
		t.Fatalf("safe summary list = %#v", got)
	}
	for _, key := range []string{"password", "remote"} {
		if safe[key] != "redacted" {
			t.Fatalf("summary %s = %#v, want redacted", key, safe[key])
		}
	}
	for _, key := range []string{"long", "nested"} {
		if safe[key] != "omitted" {
			t.Fatalf("summary %s = %#v, want omitted", key, safe[key])
		}
	}
	if safe["huge"] != "invalid" {
		t.Fatalf("summary huge = %#v, want invalid", safe["huge"])
	}
	if _, exists := safe["invalid key"]; exists {
		t.Fatalf("malformed summary key survived: %#v", safe)
	}

	oversized := make(map[string]interface{}, maxSummaryEntries+1)
	for index := 0; index <= maxSummaryEntries; index++ {
		oversized["key_"+metadataTestSuffix(index)] = "value"
	}
	if got := safeSummaryMap(oversized); len(got) != 0 {
		t.Fatalf("safeSummaryMap() retained oversized summary: %d", len(got))
	}

	tooManyItems := make([]string, maxSummaryStringItems+1)
	if got := safeSummaryMap(map[string]interface{}{"items": tooManyItems})["items"].([]string); len(got) != 0 {
		t.Fatalf("safeSummaryMap() retained oversized string list: %d", len(got))
	}
}

func TestGraphBuilderSanitizesNodeAndEdgeMetadata(t *testing.T) {
	builder := newKubeGraphBuilder("bad:cluster")
	if builder.clusterID != "in-cluster" {
		t.Fatalf("cluster id = %q, want fallback", builder.clusterID)
	}

	source := builder.addNodeWithMetadata("Pod", "app", "api", "injected", map[string]string{"app": "api"}, nil, "bad uid", "1h0m0s", []string{"ReplicaSet/api-abc", "Bad Kind/unsafe"}, map[string]interface{}{"phase": "Running"})
	target := builder.addNode("Service", "app", "api", "healthy", nil, nil)
	if source == "" || target == "" {
		t.Fatalf("valid nodes were rejected: %q/%q", source, target)
	}
	node := builder.nodes[0]
	if node.Status != "unknown" || node.UID != "" || len(node.Owners) != 1 || node.Owners[0] != "ReplicaSet/api-abc" {
		t.Fatalf("sanitized node = %+v", node)
	}

	if id := builder.addNode("Pod", "bad namespace", "unsafe", "healthy", nil, nil); id != "" {
		t.Fatalf("malformed namespace node id = %q", id)
	}
	if id := builder.addNode("Injected Kind", "app", "unsafe", "healthy", nil, nil); id != "" {
		t.Fatalf("malformed kind node id = %q", id)
	}
	if id := builder.addNode("CustomResource", "app", "Widget:sample", "healthy", nil, nil); id == "" {
		t.Fatal("valid custom resource display identity was rejected")
	}

	if id := builder.addEdge("BAD EDGE", source, target, "spec.selector", "observed"); id != "" {
		t.Fatalf("malformed edge type id = %q", id)
	}
	if id := builder.addEdge("routes-to", source, target, " spec.selector ", "observed"); id != "" {
		t.Fatalf("untrimmed edge source field id = %q", id)
	}
	if id := builder.addEdge("routes-to", source, target, "spec.selector", "trusted"); id != "" {
		t.Fatalf("malformed edge confidence id = %q", id)
	}
	if id := builder.addEdge("routes-to", source, target, "spec.selector", "observed"); id == "" {
		t.Fatal("valid edge was rejected")
	}
}

func TestSnapshotSanitizesClusterAndResourceMetadata(t *testing.T) {
	resources := newKubernetesSnapshotResources()
	resources.version.GitVersion = "token=fixture"
	resources.configMaps.Items = []configMapResource{{Metadata: metadata{
		Name:      "app-config",
		Namespace: "app",
		UID:       "uid with spaces",
		Labels: map[string]string{
			"app":                    "api",
			"example.com/credential": "fixture",
		},
		Annotations: map[string]string{
			"kubectl.kubernetes.io/last-applied-configuration": `{"data":{"opaque":"fixture"}}`,
		},
	}}}

	snapshot := buildKubernetesSnapshot("bad:cluster", "bad\ncluster", resources)
	if len(snapshot.Clusters) != 1 || snapshot.Clusters[0].ID != "in-cluster" || snapshot.Clusters[0].Name != "in-cluster" || snapshot.Clusters[0].Version != "unknown" {
		t.Fatalf("cluster summary = %+v", snapshot.Clusters)
	}
	if len(snapshot.Nodes) != 2 {
		t.Fatalf("nodes = %d, want cluster and ConfigMap", len(snapshot.Nodes))
	}
	configMap := snapshot.Nodes[1]
	if configMap.UID != "" || configMap.Labels["example.com/credential"] != "redacted" || configMap.Annotations["kubectl.kubernetes.io/last-applied-configuration"] != "redacted" {
		t.Fatalf("sanitized ConfigMap = %+v", configMap)
	}
}

func metadataTestSuffix(value int) string {
	return string(rune('a'+value/26%26)) + string(rune('a'+value%26))
}
