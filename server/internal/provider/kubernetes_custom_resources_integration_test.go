package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

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
