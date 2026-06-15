package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestKubernetesProviderResourceEventsConvertsCoreEvents(t *testing.T) {
	var gotPath string
	var gotSelector string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotSelector = r.URL.Query().Get("fieldSelector")
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("Authorization = %q, want bearer token", got)
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"items": []map[string]interface{}{
				{
					"type":               "Normal",
					"reason":             "Scheduled",
					"message":            "Assigned checkout/checkout-api to worker-a",
					"lastTimestamp":      "2026-06-15T09:00:00Z",
					"reportingComponent": "default-scheduler",
				},
				{
					"type":           "Warning",
					"reason":         "Unhealthy",
					"message":        "Readiness probe failed",
					"firstTimestamp": "2026-06-15T10:00:00Z",
					"source": map[string]interface{}{
						"component": "kubelet",
						"host":      "worker-a",
					},
				},
			},
		}); err != nil {
			t.Fatalf("write response: %v", err)
		}
	}))
	defer server.Close()

	provider := KubernetesProvider{
		client: &kubeAPIClient{
			baseURL:    server.URL,
			bearer:     "test-token",
			httpClient: server.Client(),
		},
	}
	events, err := provider.ResourceEvents(context.Background(), ResourceRef{Kind: "Pod", Namespace: "checkout", Name: "checkout-api"})
	if err != nil {
		t.Fatalf("ResourceEvents() error = %v", err)
	}

	if gotPath != "/api/v1/namespaces/checkout/events" {
		t.Fatalf("path = %q, want namespaced events path", gotPath)
	}
	if gotSelector != "involvedObject.kind=Pod,involvedObject.name=checkout-api" {
		t.Fatalf("fieldSelector = %q, want involvedObject selector", gotSelector)
	}
	if len(events.Items) != 2 {
		t.Fatalf("events = %d, want 2", len(events.Items))
	}
	if events.Items[0].Reason != "Unhealthy" || events.Items[0].Source != "kubelet@worker-a" {
		t.Fatalf("newest event = %+v, want warning kubelet event first", events.Items[0])
	}
	if events.Items[1].Reason != "Scheduled" || events.Items[1].Source != "default-scheduler" {
		t.Fatalf("older event = %+v, want scheduled event second", events.Items[1])
	}
}

func TestKubernetesProviderResourceEventsForbiddenFallsBack(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	defer server.Close()

	provider := KubernetesProvider{
		client: &kubeAPIClient{
			baseURL:    server.URL,
			bearer:     "test-token",
			httpClient: server.Client(),
		},
	}
	events, err := provider.ResourceEvents(context.Background(), ResourceRef{Kind: "Node", Name: "worker-a"})
	if err != nil {
		t.Fatalf("ResourceEvents() error = %v", err)
	}
	if events.Warning != "events_unavailable" || len(events.Items) != 0 {
		t.Fatalf("events = %+v, want unavailable warning and empty list", events)
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

func TestCustomResourceDefinitionSummaryHelpers(t *testing.T) {
	crd := customResourceDefinitionResource{}
	crd.Spec.Versions = append(crd.Spec.Versions,
		struct {
			Name    string `json:"name"`
			Served  bool   `json:"served"`
			Storage bool   `json:"storage"`
		}{Name: "v1beta1", Served: false},
		struct {
			Name    string `json:"name"`
			Served  bool   `json:"served"`
			Storage bool   `json:"storage"`
		}{Name: "v1", Served: true, Storage: true},
	)
	crd.Status.Conditions = []condition{{Type: "Established", Status: "True"}}

	if got := crdStatus(crd); got != "healthy" {
		t.Fatalf("crdStatus() = %q, want healthy", got)
	}
	if got := crdStorageVersion(crd); got != "v1" {
		t.Fatalf("crdStorageVersion() = %q, want v1", got)
	}
	served := crdServedVersions(crd)
	if len(served) != 1 || served[0] != "v1" {
		t.Fatalf("crdServedVersions() = %#v, want v1", served)
	}
}

func TestNetworkPolicyTypesDefaultEgressWhenRulesExist(t *testing.T) {
	policy := networkPolicyResource{}
	if got := networkPolicyTypes(policy); len(got) != 1 || got[0] != "Ingress" {
		t.Fatalf("networkPolicyTypes() = %#v, want Ingress", got)
	}

	policy.Spec.Egress = []networkPolicyEgressRule{{}}
	if got := networkPolicyTypes(policy); len(got) != 2 || got[0] != "Ingress" || got[1] != "Egress" {
		t.Fatalf("networkPolicyTypes() = %#v, want Ingress,Egress", got)
	}
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
		{
			NamespaceSelector: &labelSelector{MatchExpressions: []labelSelectorMatchExpression{{Key: "team", Operator: "In", Values: []string{"platform"}}}},
			PodSelector:       &labelSelector{MatchExpressions: []labelSelectorMatchExpression{{Key: "app", Operator: "In", Values: []string{"frontend"}}}},
		},
		{
			PodSelector: &labelSelector{
				MatchExpressions: []labelSelectorMatchExpression{{Key: "app", Operator: "In", Values: []string{"db"}}},
			},
		},
		{
			PodSelector: &labelSelector{
				MatchLabels:      map[string]string{"app": "metrics"},
				MatchExpressions: []labelSelectorMatchExpression{{Key: "scrape", Operator: "Exists"}, {Key: "legacy", Operator: "DoesNotExist"}},
			},
		},
		{
			PodSelector: &labelSelector{
				MatchLabels:      map[string]string{"app": "worker"},
				MatchExpressions: []labelSelectorMatchExpression{{Key: "env", Operator: "NotIn", Values: []string{"prod"}}},
			},
		},
		{
			PodSelector: &labelSelector{
				MatchLabels:      map[string]string{"app": "worker"},
				MatchExpressions: []labelSelectorMatchExpression{{Key: "env", Operator: "Unknown", Values: []string{"prod"}}},
			},
		},
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
