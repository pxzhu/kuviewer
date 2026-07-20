package provider

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestIngressSchemaSummaryAndStatusAddressesAreBoundedAndRedacted(t *testing.T) {
	ingress := decodeIngressResource(t, `{
		"metadata":{"name":"public","namespace":"edge"},
		"spec":{
			"ingressClassName":"nginx",
			"defaultBackend":{"service":{"name":"fallback","port":{"name":"http"}}},
			"rules":[{"host":"api.example.com","http":{"paths":[
				{"path":"/","pathType":"Prefix","backend":{"service":{"name":"api","port":{"number":80}}}},
				{"path":"/assets","pathType":"Prefix","backend":{"resource":{"apiGroup":"storage.example.com","kind":"Bucket","name":"assets"}}}
			]}}],
			"tls":[{"hosts":["api.example.com","*.example.com"],"secretName":"public-tls"}]
		},
		"status":{"loadBalancer":{"ingress":[
			{"ip":"192.0.2.40","ports":[{"port":443,"protocol":"TCP","error":"ProviderError"}]},
			{"hostname":"public-lb.example.com"}
		]}}
	}`)
	if !validIngressSpec(ingress) || !validIngressLoadBalancerStatus(ingress) || ingressStatus(ingress) != "healthy" {
		t.Fatal("valid Ingress schema or load balancer status was rejected")
	}
	if got := strings.Join(ingressServiceNames(ingress), ","); got != "api,fallback" {
		t.Fatalf("ingressServiceNames() = %q", got)
	}
	summary := ingressSummary(ingress)
	if summary["class"] != "nginx" || summary["hosts"] != "api.example.com" || summary["rules"] != 1 || summary["backends"] != 2 || summary["defaultBackend"] != "Service" || summary["tls"] != 1 || summary["tlsHosts"] != 2 || summary["tlsSecrets"] != 1 || summary["loadBalancerAddresses"] != 2 || summary["loadBalancerIPs"] != 1 || summary["loadBalancerHostnames"] != 1 || summary["loadBalancerPorts"] != 1 || summary["loadBalancerPortErrors"] != 1 {
		t.Fatalf("Ingress summary = %+v", summary)
	}
	encoded := fmt.Sprintf("%+v", ingress.Status.LoadBalancer.Ingress)
	if strings.Contains(encoded, "192.0.2.40") || strings.Contains(encoded, "public-lb.example.com") {
		t.Fatalf("Ingress load balancer address was retained: %s", encoded)
	}
}

func TestIngressSchemaRejectsMalformedSpecAndSuppressesEdges(t *testing.T) {
	fixtures := []string{
		`{"spec":{}}`,
		`{"spec":{"ingressClassName":"Bad Class","defaultBackend":{"service":{"name":"api","port":{"number":80}}}}}`,
		`{"spec":{"defaultBackend":{"service":{"name":"api","port":{"number":80}},"resource":{"kind":"Bucket","name":"assets"}}}}`,
		`{"spec":{"defaultBackend":{"service":{"name":"api","port":{}}}}}`,
		`{"spec":{"rules":[{"host":"api.example.com","http":{"paths":[{"path":"/","backend":{"service":{"name":"api","port":{"number":80}}}}]}}]}}`,
		`{"spec":{"rules":[{"host":"TOKEN.EXAMPLE.COM","http":{"paths":[{"path":"/","pathType":"Prefix","backend":{"service":{"name":"api","port":{"number":80}}}}]}}]}}`,
		`{"spec":{"defaultBackend":{"resource":{"apiGroup":"bad group","kind":"Bucket","name":"assets"}}}}`,
		`{"spec":{"defaultBackend":{"service":{"name":"api","port":{"number":80}}},"tls":[{"hosts":["TOKEN.EXAMPLE.COM"],"secretName":"public-tls"}]}}`,
		`{"spec":{"defaultBackend":{"service":{"name":"api","port":{"number":80}}},"tls":[{"hosts":["api.example.com"],"secretName":"bad name"}]}}`,
	}
	for index, fixture := range fixtures {
		ingress := decodeIngressResource(t, fixture)
		if validIngressSpec(ingress) || len(ingressServiceNames(ingress)) != 0 || ingressStatus(ingress) != "warning" {
			t.Fatalf("invalid Ingress fixture %d was accepted", index)
		}
		if encoded := fmt.Sprintf("%+v", ingressSummary(ingress)); strings.Contains(encoded, "TOKEN") || strings.Contains(encoded, "bad group") || strings.Contains(encoded, "bad name") {
			t.Fatalf("invalid Ingress values leaked: %s", encoded)
		}
	}

	oversized := decodeIngressResource(t, `{"spec":{"defaultBackend":{"service":{"name":"api","port":{"number":80}}}}}`)
	oversized.Spec.Rules = make([]ingressRule, maxIngressRules+1)
	if validIngressSpec(oversized) {
		t.Fatal("oversized Ingress rules were accepted")
	}
}

func TestIngressStatusRejectsMalformedAddressesWithoutRetainingValues(t *testing.T) {
	fixtures := []string{
		`{"spec":{"defaultBackend":{"service":{"name":"api","port":{"number":80}}}},"status":{"loadBalancer":{"ingress":[{"ip":"192.00.2.40"}]}}}`,
		`{"spec":{"defaultBackend":{"service":{"name":"api","port":{"number":80}}}},"status":{"loadBalancer":{"ingress":[{"hostname":"TOKEN.EXAMPLE.COM"}]}}}`,
		`{"spec":{"defaultBackend":{"service":{"name":"api","port":{"number":80}}}},"status":{"loadBalancer":{"ingress":[{"ip":"192.0.2.40","hostname":"public.example.com"}]}}}`,
		`{"spec":{"defaultBackend":{"service":{"name":"api","port":{"number":80}}}},"status":{"loadBalancer":{"ingress":[{"ip":"credential=remote-value"}]}}}`,
		`{"spec":{"defaultBackend":{"service":{"name":"api","port":{"number":80}}}},"status":{"loadBalancer":{"ingress":[{"ip":"192.0.2.40","ports":[{"port":0,"protocol":"TCP"}]}]}}}`,
	}
	for index, fixture := range fixtures {
		ingress := decodeIngressResource(t, fixture)
		if !validIngressSpec(ingress) || validIngressLoadBalancerStatus(ingress) || ingressStatus(ingress) != "warning" {
			t.Fatalf("invalid Ingress status fixture %d was accepted", index)
		}
		encoded := fmt.Sprintf("%+v", ingress)
		if strings.Contains(encoded, "remote-value") || strings.Contains(encoded, "TOKEN") || strings.Contains(encoded, "192.00.2.40") {
			t.Fatalf("invalid Ingress status value was retained: %s", encoded)
		}
		if summary := ingressSummary(ingress); summary["loadBalancerAddresses"] != "invalid" {
			t.Fatalf("invalid Ingress status summary = %+v", summary)
		}
	}

	oversized := decodeIngressResource(t, `{"spec":{"defaultBackend":{"service":{"name":"api","port":{"number":80}}}}}`)
	oversized.Status.LoadBalancer.Ingress = make([]ingressLoadBalancerPoint, maxIngressLoadBalancerPoints+1)
	if validIngressLoadBalancerStatus(oversized) {
		t.Fatal("oversized Ingress load balancer status was accepted")
	}
}

func TestIngressSnapshotRejectsMalformedEdgesAndRecordsSafeDiagnostic(t *testing.T) {
	valid := decodeIngressResource(t, `{
		"metadata":{"name":"public","namespace":"edge"},
		"spec":{"defaultBackend":{"service":{"name":"api","port":{"number":80}}}}
	}`)
	invalid := decodeIngressResource(t, `{
		"metadata":{"name":"invalid","namespace":"edge"},
		"spec":{"rules":[{"host":"credential.example.com","http":{"paths":[{"path":"/","backend":{"service":{"name":"secret-backend","port":{"number":80}}}}]}}]}
	}`)
	resources := newKubernetesSnapshotResources()
	resources.namespaces.Items = []namespace{{Metadata: metadata{Name: "edge"}}}
	resources.services.Items = []serviceResource{{Metadata: metadata{Name: "api", Namespace: "edge"}}}
	resources.ingresses.Items = []ingressResource{valid, invalid}

	snapshot := buildKubernetesSnapshot("cluster-a", "Cluster A", resources)
	edges := 0
	for _, edge := range snapshot.Edges {
		if edge.Type == "routes-to" {
			edges++
			if strings.Contains(edge.Source, "invalid") || strings.Contains(edge.Target, "secret-backend") {
				t.Fatalf("malformed Ingress created an edge: %+v", edge)
			}
		}
	}
	if edges != 1 {
		t.Fatalf("Ingress route edge count = %d, want 1", edges)
	}
	foundWarning := false
	for _, node := range snapshot.Nodes {
		if node.Kind == "Ingress" && node.Name == "invalid" {
			foundWarning = node.Status == "warning" && node.Summary["hosts"] == "invalid"
			if strings.Contains(fmt.Sprintf("%+v", node.Summary), "credential.example.com") {
				t.Fatalf("malformed Ingress host leaked: %+v", node.Summary)
			}
		}
	}
	if !foundWarning {
		t.Fatal("malformed Ingress warning node was not preserved")
	}
	foundDiagnostic := false
	for _, diagnostic := range snapshot.Diagnostics {
		if diagnostic.ID == "snapshot/ingresses" {
			foundDiagnostic = diagnostic.Reason == "invalid_item" && diagnostic.Count == 1
		}
	}
	if !foundDiagnostic {
		t.Fatalf("Ingress invalid-item diagnostic missing: %+v", snapshot.Diagnostics)
	}
}

func decodeIngressResource(t *testing.T, value string) ingressResource {
	t.Helper()
	var ingress ingressResource
	if err := json.Unmarshal([]byte(value), &ingress); err != nil {
		t.Fatalf("decode Ingress resource: %v", err)
	}
	return ingress
}
