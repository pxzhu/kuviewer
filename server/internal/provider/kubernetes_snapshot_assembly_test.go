package provider

import (
	"encoding/json"
	"strings"
	"testing"

	"kuviewer/server/internal/topology"
)

func TestBuildKubernetesSnapshotSummarizesSafeResources(t *testing.T) {
	resources := newKubernetesSnapshotResources()
	resources.version.GitVersion = "v1.30.4"
	resources.namespaces.Items = []namespace{
		{Metadata: metadata{Name: "app"}},
		{Metadata: metadata{}},
	}
	readyNode := nodeResource{Metadata: metadata{Name: "node-a"}}
	readyNode.Status.Conditions = []condition{{Type: "Ready", Status: "True"}}
	resources.nodes.Items = []nodeResource{readyNode, {}}
	resources.pods.Items = []podResource{
		{
			Metadata: metadata{Name: "api", Namespace: "app", Labels: map[string]string{"app": "api"}},
			Spec: podSpec{Containers: []container{{
				Name:    "api",
				EnvFrom: []envFrom{{SecretRef: &localObjectRef{Name: "database"}}},
			}}},
			Status: podStat{Phase: "Running", ContainerStatuses: []containerStatus{{Ready: true}}},
		},
		{},
	}
	service := serviceResource{Metadata: metadata{Name: "api", Namespace: "app"}}
	service.Spec.Selector = map[string]string{"app": "api"}
	resources.services.Items = []serviceResource{service}

	snapshot := buildKubernetesSnapshot("cluster-a", "Cluster A", resources)

	if len(snapshot.Clusters) != 1 {
		t.Fatalf("expected one cluster summary, got %d", len(snapshot.Clusters))
	}
	cluster := snapshot.Clusters[0]
	if cluster.Version != "v1.30.4" || cluster.NodeReady != 1 || cluster.PodRunning != 1 {
		t.Fatalf("unexpected cluster summary: %+v", cluster)
	}
	for _, node := range snapshot.Nodes {
		if strings.TrimSpace(node.Name) == "" {
			t.Fatalf("snapshot contains a resource with an empty identity: %+v", node)
		}
	}

	secret := snapshotNode(t, snapshot, "Secret", "app", "database")
	if secret.Status != "unknown" || secret.Summary["values"] != "hidden" {
		t.Fatalf("secret placeholder is not safely redacted: %+v", secret)
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	if strings.Contains(string(encoded), `"data":`) || strings.Contains(string(encoded), `"stringData":`) {
		t.Fatalf("snapshot unexpectedly exposes secret value fields: %s", encoded)
	}

	serviceID := "cluster-a:app:Service:api"
	podID := "cluster-a:app:Pod:api"
	if !snapshotHasEdge(snapshot, "service-endpoint", serviceID, podID) {
		t.Fatal("expected selector-inferred Service to Pod edge")
	}
}

func TestBuildKubernetesSnapshotCopiesDiagnosticsAndMetadata(t *testing.T) {
	resources := newKubernetesSnapshotResources()
	resources.diagnostics = []topology.SnapshotDiagnostic{{
		ID:       "optional/gateways",
		Resource: "Gateways",
		Reason:   "forbidden",
		Count:    1,
	}}
	resources.pods.Items = []podResource{{
		Metadata: metadata{
			Name:        "api",
			Namespace:   "app",
			Labels:      map[string]string{"tier": "backend"},
			Annotations: map[string]string{"description": "safe"},
		},
		Status: podStat{Phase: "Pending"},
	}}

	snapshot := buildKubernetesSnapshot("cluster-a", "Cluster A", resources)
	resources.diagnostics[0].Reason = "changed"
	resources.pods.Items[0].Metadata.Labels["tier"] = "changed"
	resources.pods.Items[0].Metadata.Annotations["description"] = "changed"

	if got := snapshot.Diagnostics[0].Reason; got != "forbidden" {
		t.Fatalf("diagnostics aliased the input slice: %q", got)
	}
	pod := snapshotNode(t, snapshot, "Pod", "app", "api")
	if got := pod.Labels["tier"]; got != "backend" {
		t.Fatalf("labels aliased the input map: %q", got)
	}
	if got := pod.Annotations["description"]; got != "safe" {
		t.Fatalf("annotations aliased the input map: %q", got)
	}
}

func snapshotNode(t *testing.T, snapshot topology.Snapshot, kind string, namespace string, name string) topology.Node {
	t.Helper()
	for _, node := range snapshot.Nodes {
		if node.Kind == kind && node.Namespace == namespace && node.Name == name {
			return node
		}
	}
	t.Fatalf("node not found: %s/%s/%s", kind, namespace, name)
	return topology.Node{}
}

func snapshotHasEdge(snapshot topology.Snapshot, edgeType string, source string, target string) bool {
	for _, edge := range snapshot.Edges {
		if edge.Type == edgeType && edge.Source == source && edge.Target == target {
			return true
		}
	}
	return false
}
