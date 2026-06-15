package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestKubernetesProviderResourceLogsReadsPodLog(t *testing.T) {
	var gotPath string
	var gotTailLines string
	var gotContainer string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotTailLines = r.URL.Query().Get("tailLines")
		gotContainer = r.URL.Query().Get("container")
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("Authorization = %q, want bearer token", got)
		}
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("line-1\nline-2\n"))
	}))
	defer server.Close()

	provider := KubernetesProvider{
		client: &kubeAPIClient{
			baseURL:    server.URL,
			bearer:     "test-token",
			httpClient: server.Client(),
		},
	}
	logs, err := provider.ResourceLogs(context.Background(), ResourceRef{Kind: "Pod", Namespace: "checkout", Name: "checkout-api", Container: "api"})
	if err != nil {
		t.Fatalf("ResourceLogs() error = %v", err)
	}

	if gotPath != "/api/v1/namespaces/checkout/pods/checkout-api/log" {
		t.Fatalf("path = %q, want pod log path", gotPath)
	}
	if gotTailLines != "200" {
		t.Fatalf("tailLines = %q, want 200", gotTailLines)
	}
	if gotContainer != "api" {
		t.Fatalf("container = %q, want api", gotContainer)
	}
	if logs.Warning != "" || logs.Container != "api" || logs.TailLines != 200 || len(logs.Lines) != 2 || logs.Lines[1] != "line-2" {
		t.Fatalf("logs = %+v, want two lines", logs)
	}
}

func TestKubernetesProviderResourceLogsForbiddenFallsBack(t *testing.T) {
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
	logs, err := provider.ResourceLogs(context.Background(), ResourceRef{Kind: "Pod", Namespace: "checkout", Name: "checkout-api"})
	if err != nil {
		t.Fatalf("ResourceLogs() error = %v", err)
	}
	if logs.Warning != "logs_unavailable" || len(logs.Lines) != 0 || logs.TailLines != 200 {
		t.Fatalf("logs = %+v, want unavailable warning and empty list", logs)
	}
}

func TestCappedLogLinesLimitsLinesAndLineLength(t *testing.T) {
	longLine := strings.Repeat("x", podLogMaxLineBytes+20)
	lines := cappedLogLines(strings.Repeat("old\n", 5) + strings.Repeat("line\n", podLogTailLines) + longLine + "\n")

	if len(lines) != podLogTailLines {
		t.Fatalf("len(lines) = %d, want %d", len(lines), podLogTailLines)
	}
	if got := lines[len(lines)-1]; len(got) != podLogMaxLineBytes+3 || !strings.HasSuffix(got, "...") {
		t.Fatalf("last line length/suffix = %d/%q, want truncated suffix", len(got), got[len(got)-3:])
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

func TestKubernetesProviderCustomResourceInstancesUsesStorageVersion(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("Authorization = %q, want bearer token", got)
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"items": []map[string]interface{}{
				{
					"apiVersion": "platform.example.com/v1",
					"kind":       "Widget",
					"metadata": map[string]interface{}{
						"name":      "checkout-dashboard",
						"namespace": "platform",
						"labels":    map[string]string{"app": "checkout"},
					},
					"spec": map[string]interface{}{
						"replicas": 2,
						"size":     "small",
					},
					"status": map[string]interface{}{
						"conditions": []map[string]string{{"type": "Ready", "status": "True"}},
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
	resources := provider.customResourceInstances(context.Background(), testCustomResourceDefinitionList(t))

	if gotPath != "/apis/platform.example.com/v1/widgets" {
		t.Fatalf("path = %q, want storage-version custom resource path", gotPath)
	}
	if len(resources) != 1 {
		t.Fatalf("resources = %d, want 1", len(resources))
	}
	resource := resources[0]
	if resource.CRDName != "widgets.platform.example.com" || resource.CRDGroup != "platform.example.com" || resource.CRDVersion != "v1" || resource.CRDScope != "Namespaced" {
		t.Fatalf("resource CRD context = %+v", resource)
	}
	if got := customResourceDisplayName(resource); got != "Widget:checkout-dashboard" {
		t.Fatalf("customResourceDisplayName() = %q, want Widget:checkout-dashboard", got)
	}
	if got := customResourceStatus(resource); got != "healthy" {
		t.Fatalf("customResourceStatus() = %q, want healthy", got)
	}
	if got := genericConditionSummary(resource.Status); got != "Ready=True" {
		t.Fatalf("genericConditionSummary() = %q, want Ready=True", got)
	}
}

func TestKubernetesProviderCustomResourceInstancesForbiddenFallsBack(t *testing.T) {
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
	if resources := provider.customResourceInstances(context.Background(), testCustomResourceDefinitionList(t)); len(resources) != 0 {
		t.Fatalf("resources = %d, want 0 on optional forbidden custom resource list", len(resources))
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
				"secretRef": map[string]interface{}{
					"name": "checkout-api-secret",
				},
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

func testCustomResourceDefinitionList(t *testing.T) customResourceDefinitionList {
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
					"versions": [
						{"name": "v1beta1", "served": true},
						{"name": "v1", "served": true, "storage": true}
					]
				}
			}
		]
	}`), &crds); err != nil {
		t.Fatalf("decode test CRD: %v", err)
	}
	return crds
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
