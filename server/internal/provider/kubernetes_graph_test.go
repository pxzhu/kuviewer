package provider

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGraphBuilderRejectsEmptyDuplicateAndDanglingGraphItems(t *testing.T) {
	builder := newKubeGraphBuilder("test")
	if id := builder.addNode("Pod", "checkout", "", "healthy", nil, nil); id != "" || len(builder.nodes) != 0 {
		t.Fatalf("empty node = %q, nodes %d", id, len(builder.nodes))
	}

	source := builder.addNode("Service", "checkout", "api", "healthy", nil, nil)
	target := builder.addNode("Pod", "checkout", "api-1", "healthy", nil, nil)
	builder.addNode("Pod", "checkout", "api-1", "warning", nil, nil)
	if len(builder.nodes) != 2 || builder.nodes[1].Status != "healthy" {
		t.Fatalf("duplicate node changed graph: %+v", builder.nodes)
	}

	edgeID := builder.addEdge("service-endpoint", source, target, "Service.spec.selector", "inferred")
	if edgeID == "" {
		t.Fatal("valid edge was not added")
	}
	builder.addEdge("service-endpoint", source, target, "Service.spec.selector", "inferred")
	if id := builder.addEdge("service-endpoint", source, "test:checkout:Pod:missing", "Service.spec.selector", "inferred"); id != "" {
		t.Fatalf("dangling edge id = %q", id)
	}
	if len(builder.edges) != 1 {
		t.Fatalf("edges = %d, want one deduplicated edge", len(builder.edges))
	}
}

func TestGraphBuilderReferenceNodesRemainSafeAndBounded(t *testing.T) {
	builder := newKubeGraphBuilder("test")
	secretID := builder.ensureReferenceNode("Secret", "checkout", "app-secret")
	builder.ensureReferenceNode("Secret", "checkout", "app-secret")
	builder.ensureReferenceNode("Secret", "checkout", "")
	builder.ensureReferenceNode("Secret", "checkout", "   ")

	if secretID != "test:checkout:Secret:app-secret" || len(builder.nodes) != 1 {
		t.Fatalf("reference nodes = %q / %d", secretID, len(builder.nodes))
	}
	secret := builder.nodes[0]
	if secret.Status != "unknown" || secret.Summary["referenced"] != true || secret.Summary["values"] != "hidden" {
		t.Fatalf("secret reference summary = %#v", secret.Summary)
	}
	if len(secret.Labels) != 0 || len(secret.Annotations) != 0 {
		t.Fatalf("secret reference metadata must remain empty: %+v", secret)
	}
}

func TestGraphBuilderLayoutUsesStableLanes(t *testing.T) {
	builder := newKubeGraphBuilder("test")
	builder.addNode("Pod", "checkout", "api-1", "healthy", nil, nil)
	builder.addNode("Pod", "checkout", "api-2", "healthy", nil, nil)
	builder.addNode("UnknownKind", "checkout", "custom", "unknown", nil, nil)

	if got := builder.nodes[0]; got.X != 1080 || got.Y != 80 {
		t.Fatalf("first Pod position = %d,%d", got.X, got.Y)
	}
	if got := builder.nodes[1]; got.X != 1080 || got.Y != 172 {
		t.Fatalf("second Pod position = %d,%d", got.X, got.Y)
	}
	if got := builder.nodes[2]; got.X != 980 || got.Y != 80 {
		t.Fatalf("fallback position = %d,%d", got.X, got.Y)
	}
}

func TestGraphBuilderClonesMutableNodeMetadata(t *testing.T) {
	labels := map[string]string{"app": "api"}
	summary := map[string]interface{}{"replicas": 2}
	owners := []string{"Deployment/api"}
	builder := newKubeGraphBuilder("test")
	builder.addNodeWithMetadata("Pod", "checkout", "api-1", "healthy", labels, nil, "uid", "1m", owners, summary)

	labels["app"] = "mutated"
	summary["replicas"] = 99
	owners[0] = "Deployment/mutated"
	node := builder.nodes[0]
	if node.Labels["app"] != "api" || node.Summary["replicas"] != 2 || node.Owners[0] != "Deployment/api" {
		t.Fatalf("graph node metadata was aliased: %+v", node)
	}
}

func TestGraphBuilderRedactsSensitiveAnnotations(t *testing.T) {
	builder := newKubeGraphBuilder("test")
	builder.addResourceNode("ConfigMap", metadata{
		Name: "app-config",
		Annotations: map[string]string{
			"owner":             "platform",
			"example.com/token": "redaction-fixture",
		},
	}, "healthy", nil)

	if len(builder.nodes) != 1 {
		t.Fatalf("nodes = %d, want 1", len(builder.nodes))
	}
	if got := builder.nodes[0].Annotations["owner"]; got != "platform" {
		t.Fatalf("owner annotation = %q, want platform", got)
	}
	if got := builder.nodes[0].Annotations["example.com/token"]; got != "redacted" {
		t.Fatalf("token annotation = %q, want redacted", got)
	}
}

func TestCustomResourceReferenceEdgesInferSafeExistingTargets(t *testing.T) {
	builder := newKubeGraphBuilder("test")
	builder.addNode("CustomResourceDefinition", "", "widgets.platform.example.com", "healthy", nil, nil)
	builder.addNode("CustomResourceDefinition", "", "backends.platform.example.com", "healthy", nil, nil)
	builder.addNode("CustomResource", "checkout", "Widget:checkout-dashboard", "healthy", nil, nil)
	builder.addNode("Secret", "checkout", "checkout-api-secret", "unknown", nil, nil)
	builder.addNode("ConfigMap", "checkout", "checkout-config", "healthy", nil, nil)
	builder.addNode("Service", "checkout", "checkout-api", "healthy", nil, nil)
	builder.addNode("CustomResource", "checkout", "Backend:checkout-backend", "healthy", nil, nil)

	resource := customResourceInstance{
		customResourceInstanceResource: customResourceInstanceResource{
			APIVersion: "platform.example.com/v1",
			Kind:       "Widget",
			Metadata:   metadata{Name: "checkout-dashboard", Namespace: "checkout"},
			Spec: map[string]interface{}{
				"secretRef": map[string]interface{}{"name": "checkout-api-secret"},
				"configMapRefs": []interface{}{
					map[string]interface{}{"name": "checkout-config"},
					map[string]interface{}{"name": "missing-config"},
				},
				"backendRef": map[string]interface{}{
					"apiVersion": "v1",
					"kind":       "Service",
					"name":       "checkout-api",
				},
				"widgetBackendRef": map[string]interface{}{
					"apiVersion": "platform.example.com/v1",
					"kind":       "Backend",
					"name":       "checkout-backend",
				},
				"serviceAccountName": "missing-service-account",
			},
			Status: map[string]interface{}{"raw": "not-used-for-relations"},
		},
		CRDName:    "widgets.platform.example.com",
		CRDGroup:   "platform.example.com",
		CRDVersion: "v1",
		CRDScope:   "Namespaced",
	}

	builder.addCustomResourceReferenceEdges(resource, testCustomResourceRelationCRDs(t))

	assertEdge := func(target string, sourceField string) {
		t.Helper()
		for _, edge := range builder.edges {
			if edge.Type == "references" && edge.Target == target && edge.SourceField == sourceField && edge.Confidence == "inferred" {
				return
			}
		}
		t.Fatalf("references edge to %s via %s not found: %+v", target, sourceField, builder.edges)
	}
	assertEdge(builder.nodeID("Secret", "checkout", "checkout-api-secret"), "spec.secretRef")
	assertEdge(builder.nodeID("ConfigMap", "checkout", "checkout-config"), "spec.configMapRefs[0]")
	assertEdge(builder.nodeID("Service", "checkout", "checkout-api"), "spec.backendRef")
	assertEdge(builder.nodeID("CustomResource", "checkout", "Backend:checkout-backend"), "spec.widgetBackendRef")

	for _, edge := range builder.edges {
		if strings.Contains(edge.Target, "missing") {
			t.Fatalf("unexpected phantom target edge: %+v", edge)
		}
		if strings.Contains(edge.SourceField, "status") {
			t.Fatalf("unexpected status-based relation: %+v", edge)
		}
	}
}

func testCustomResourceRelationCRDs(t *testing.T) customResourceDefinitionList {
	t.Helper()
	var crds customResourceDefinitionList
	if err := json.Unmarshal([]byte(`{
		"items": [
			{
				"metadata": {"name": "widgets.platform.example.com"},
				"spec": {
					"group": "platform.example.com",
					"scope": "Namespaced",
					"names": {"kind": "Widget", "plural": "widgets"},
					"versions": [{"name": "v1", "served": true, "storage": true}]
				}
			},
			{
				"metadata": {"name": "backends.platform.example.com"},
				"spec": {
					"group": "platform.example.com",
					"scope": "Namespaced",
					"names": {"kind": "Backend", "plural": "backends"},
					"versions": [{"name": "v1", "served": true, "storage": true}]
				}
			}
		]
	}`), &crds); err != nil {
		t.Fatalf("decode test CRDs: %v", err)
	}
	return crds
}

func TestNetworkPolicyPeerEdgesInferPodsWithMatchExpressions(t *testing.T) {
	builder := newKubeGraphBuilder("test")
	policyID := builder.addNode("NetworkPolicy", "checkout", "checkout-api", "healthy", nil, nil)
	builder.addNode("Pod", "platform", "frontend", "healthy", map[string]string{"app": "frontend"}, nil)
	builder.addNode("Pod", "checkout", "db", "healthy", map[string]string{"app": "db"}, nil)
	builder.addNode("Pod", "checkout", "metrics", "healthy", map[string]string{"app": "metrics", "scrape": "true"}, nil)
	builder.addNode("Pod", "checkout", "worker", "healthy", map[string]string{"app": "worker"}, nil)

	pods := podList{Items: []podResource{
		{Metadata: metadata{Name: "frontend", Namespace: "platform", Labels: map[string]string{"app": "frontend"}}},
		{Metadata: metadata{Name: "db", Namespace: "checkout", Labels: map[string]string{"app": "db"}}},
		{Metadata: metadata{Name: "metrics", Namespace: "checkout", Labels: map[string]string{"app": "metrics", "scrape": "true"}}},
		{Metadata: metadata{Name: "worker", Namespace: "checkout", Labels: map[string]string{"app": "worker"}}},
	}}
	namespaces := []namespaceRecord{
		{name: "platform", labels: map[string]string{"team": "platform"}},
		{name: "checkout", labels: map[string]string{"team": "commerce"}},
	}

	builder.addNetworkPolicyPeerEdges(policyID, "checkout", []networkPolicyPeer{
		{NamespaceSelector: &labelSelector{MatchExpressions: []labelSelectorMatchExpression{{Key: "team", Operator: "In", Values: []string{"platform"}}}}, PodSelector: &labelSelector{MatchExpressions: []labelSelectorMatchExpression{{Key: "app", Operator: "In", Values: []string{"frontend"}}}}},
		{PodSelector: &labelSelector{MatchExpressions: []labelSelectorMatchExpression{{Key: "app", Operator: "In", Values: []string{"db"}}}}},
		{PodSelector: &labelSelector{MatchLabels: map[string]string{"app": "metrics"}, MatchExpressions: []labelSelectorMatchExpression{{Key: "scrape", Operator: "Exists"}, {Key: "legacy", Operator: "DoesNotExist"}}}},
		{PodSelector: &labelSelector{MatchLabels: map[string]string{"app": "worker"}, MatchExpressions: []labelSelectorMatchExpression{{Key: "env", Operator: "NotIn", Values: []string{"prod"}}}}},
		{PodSelector: &labelSelector{MatchLabels: map[string]string{"app": "worker"}, MatchExpressions: []labelSelectorMatchExpression{{Key: "env", Operator: "Unknown", Values: []string{"prod"}}}}},
	}, "allows-ingress", "NetworkPolicy.spec.ingress.from", pods, namespaces)

	if len(builder.edges) != 4 {
		t.Fatalf("len(edges) = %d, want 4: %#v", len(builder.edges), builder.edges)
	}
	wantTargets := map[string]bool{
		"test:platform:Pod:frontend": false,
		"test:checkout:Pod:db":       false,
		"test:checkout:Pod:metrics":  false,
		"test:checkout:Pod:worker":   false,
	}
	for _, edge := range builder.edges {
		if edge.Type != "allows-ingress" || edge.Confidence != "inferred" {
			t.Fatalf("unexpected edge: %#v", edge)
		}
		if _, ok := wantTargets[edge.Target]; !ok {
			t.Fatalf("unexpected target: %#v", edge)
		}
		wantTargets[edge.Target] = true
	}
	for target, seen := range wantTargets {
		if !seen {
			t.Fatalf("missing target %s in %#v", target, builder.edges)
		}
	}
}
