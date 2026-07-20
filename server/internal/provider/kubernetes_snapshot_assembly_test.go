package provider

import (
	"encoding/json"
	"fmt"
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
		{
			Spec: podSpec{
				ServiceAccountName: "phantom-service-account",
				Containers: []container{{
					Name:    "invalid",
					EnvFrom: []envFrom{{SecretRef: &localObjectRef{Name: "phantom-secret"}}},
				}},
			},
		},
	}
	service := serviceResource{Metadata: metadata{Name: "api", Namespace: "app"}}
	service.Spec.Selector = map[string]string{"app": "api"}
	resources.services.Items = []serviceResource{service}
	resources.customResources = []customResourceInstance{{
		customResourceInstanceResource: customResourceInstanceResource{
			APIVersion: "example.io/v1",
			Kind:       "Widget",
			Metadata:   metadata{Name: "checkout", Namespace: "app"},
			Spec:       map[string]interface{}{"password": "raw-cr-value-must-not-survive"},
			Status:     map[string]interface{}{"token": "raw-cr-value-must-not-survive"},
		},
		CRDName:    "widgets.example.io",
		CRDGroup:   "example.io",
		CRDVersion: "v1",
		CRDScope:   "Namespaced",
	}}

	snapshot := buildKubernetesSnapshot("cluster-a", "Cluster A", resources)

	if len(snapshot.Clusters) != 1 {
		t.Fatalf("expected one cluster summary, got %d", len(snapshot.Clusters))
	}
	cluster := snapshot.Clusters[0]
	if cluster.Version != "v1.30.4" || cluster.NodeReady != 1 || cluster.NodeTotal != 1 || cluster.PodRunning != 1 || cluster.PodWarning != 0 || cluster.Namespaces != 1 {
		t.Fatalf("unexpected cluster summary: %+v", cluster)
	}
	diagnostics := make(map[string]topology.SnapshotDiagnostic, len(snapshot.Diagnostics))
	for _, diagnostic := range snapshot.Diagnostics {
		diagnostics[diagnostic.ID] = diagnostic
	}
	for _, id := range []string{"snapshot/namespaces", "snapshot/nodes", "snapshot/pods"} {
		if diagnostic := diagnostics[id]; diagnostic.Reason != "invalid_item" || diagnostic.Count != 1 {
			t.Fatalf("invalid item diagnostic %q = %+v", id, diagnostic)
		}
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
	if strings.Contains(string(encoded), "raw-cr-value-must-not-survive") {
		t.Fatalf("snapshot unexpectedly exposes raw custom resource values: %s", encoded)
	}
	if strings.Contains(string(encoded), "phantom-service-account") || strings.Contains(string(encoded), "phantom-secret") {
		t.Fatalf("invalid Pod created reference placeholders: %s", encoded)
	}

	serviceID := "cluster-a:app:Service:api"
	podID := "cluster-a:app:Pod:api"
	if !snapshotHasEdge(snapshot, "service-endpoint", serviceID, podID) {
		t.Fatal("expected selector-inferred Service to Pod edge")
	}
}

func TestBuildKubernetesSnapshotCountsUniqueResourcesAndIgnoresDuplicateEdges(t *testing.T) {
	resources := newKubernetesSnapshotResources()
	first := podResource{Metadata: metadata{Name: "api", Namespace: "app"}, Status: podStat{Phase: "Succeeded"}}
	duplicate := first
	duplicate.Spec.ServiceAccountName = "duplicate-only-account"
	resources.pods.Items = []podResource{first, duplicate}

	snapshot := buildKubernetesSnapshot("cluster-a", "Cluster A", resources)
	cluster := snapshot.Clusters[0]
	if cluster.PodRunning != 1 || cluster.PodWarning != 0 {
		t.Fatalf("duplicate Pod affected summary: %+v", cluster)
	}
	diagnostic := findSnapshotDiagnostic(snapshot.Diagnostics, "snapshot/pods")
	if diagnostic.Reason != "invalid_item" || diagnostic.Count != 1 {
		t.Fatalf("duplicate Pod diagnostic = %+v", diagnostic)
	}
	if snapshotHasNode(snapshot, "ServiceAccount", "app", "duplicate-only-account") {
		t.Fatal("duplicate Pod contributed a reference placeholder")
	}
}

func TestSafeSnapshotDiagnosticsValidateAggregateAndBoundOutput(t *testing.T) {
	values := []topology.SnapshotDiagnostic{
		{ID: "snapshot/pods", Resource: "Pods", Reason: "invalid_item", Count: maxSnapshotDiagnosticCount},
		{ID: "snapshot/pods", Resource: "Pods", Reason: "invalid_item", Count: maxSnapshotDiagnosticCount},
		{ID: "BAD ID", Resource: "Pods", Reason: "invalid_item", Count: 1},
		{ID: "snapshot/nodes", Resource: "unsafe resource", Reason: "invalid_item", Count: 1},
		{ID: "snapshot/nodes", Resource: "Nodes", Reason: "remote_body", Count: 1},
	}
	for index := 0; index < maxSnapshotDiagnostics+4; index++ {
		values = append(values, topology.SnapshotDiagnostic{ID: fmt.Sprintf("snapshot/test-%02d", index), Resource: "Resources", Reason: "invalid_item", Count: 0})
	}

	safe := safeSnapshotDiagnostics(values)
	if len(safe) != maxSnapshotDiagnostics {
		t.Fatalf("safe diagnostics = %d, want cap %d", len(safe), maxSnapshotDiagnostics)
	}
	if diagnostic := findSnapshotDiagnostic(safe, "snapshot/pods"); diagnostic.Count != maxSnapshotDiagnosticCount {
		t.Fatalf("aggregated diagnostic count = %+v", diagnostic)
	}
	for _, diagnostic := range safe {
		if diagnostic.ID == "BAD ID" || diagnostic.Resource == "unsafe resource" || diagnostic.Reason == "remote_body" {
			t.Fatalf("unsafe diagnostic survived: %+v", diagnostic)
		}
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

func snapshotHasNode(snapshot topology.Snapshot, kind string, namespace string, name string) bool {
	for _, node := range snapshot.Nodes {
		if node.Kind == kind && node.Namespace == namespace && node.Name == name {
			return true
		}
	}
	return false
}

func findSnapshotDiagnostic(diagnostics []topology.SnapshotDiagnostic, id string) topology.SnapshotDiagnostic {
	for _, diagnostic := range diagnostics {
		if diagnostic.ID == id {
			return diagnostic
		}
	}
	return topology.SnapshotDiagnostic{}
}
