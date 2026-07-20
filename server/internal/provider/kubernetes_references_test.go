package provider

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

func TestPodReferencesAreValidatedDeduplicatedAndBounded(t *testing.T) {
	pod := podResource{Spec: podSpec{
		ImagePullSecret: []localObjectRef{{Name: "registry"}, {Name: "registry"}, {Name: "bad name"}},
		Volumes: []volume{
			{Secret: &secretVolumeSource{SecretName: "runtime-secret"}},
			{ConfigMap: &configMapVolumeSource{Name: "app-config"}},
		},
		Containers: []container{{
			Name: "api",
			EnvFrom: []envFrom{
				{SecretRef: &localObjectRef{Name: "runtime-secret"}},
				{SecretRef: &localObjectRef{Name: "bad\nsecret"}},
			},
		}},
	}}
	refs := podRefs(pod)
	if len(refs) != 4 {
		t.Fatalf("podRefs() = %#v, want four distinct source references", refs)
	}
	for _, ref := range refs {
		if strings.Contains(ref.name, "bad") {
			t.Fatalf("podRefs() retained malformed name: %#v", ref)
		}
	}

	pod.Spec.Volumes = make([]volume, maxPodReferenceCollectionItems+1)
	if got := podRefs(pod); len(got) != 0 {
		t.Fatalf("podRefs() = %#v, want oversized collection rejected", got)
	}
}

func TestEndpointCountsRejectMalformedAndOversizedSlices(t *testing.T) {
	ready := true
	valid := endpointSliceResource{Metadata: metadata{Namespace: "app", Labels: map[string]string{"kubernetes.io/service-name": "api"}}}
	valid.Endpoints = []endpoint{{}, {Conditions: struct {
		Ready *bool `json:"ready"`
	}{Ready: &ready}}}
	malformed := endpointSliceResource{Metadata: metadata{Namespace: "bad namespace", Labels: map[string]string{"kubernetes.io/service-name": "unsafe"}}, Endpoints: []endpoint{{}}}
	oversized := endpointSliceResource{Metadata: metadata{Namespace: "app", Labels: map[string]string{"kubernetes.io/service-name": "oversized"}}, Endpoints: make([]endpoint, maxEndpointSliceEndpoints+1)}

	counts := endpointCounts(endpointSliceList{Items: []endpointSliceResource{valid, malformed, oversized}})
	if got := counts["app/api"]; got.ready != 2 || got.total != 2 {
		t.Fatalf("endpointCounts() = %+v, want two ready endpoints", got)
	}
	if len(counts) != 1 {
		t.Fatalf("endpointCounts() retained invalid slices: %#v", counts)
	}
}

func TestSelectorEndpointFallbackIsAtomicWhenComparisonBudgetIsExceeded(t *testing.T) {
	services := make([]serviceResource, 501)
	for index := range services {
		services[index].Metadata = metadata{Name: "service-" + paddedNumber(index), Namespace: "app"}
		services[index].Spec.Selector = map[string]string{"app": "api"}
	}
	pods := make([]podResource, 500)
	for index := range pods {
		pods[index].Metadata = metadata{Name: "pod-" + paddedNumber(index), Namespace: "app", Labels: map[string]string{"app": "api"}}
		pods[index].Status.Phase = "Running"
		pods[index].Status.ContainerStatuses = []containerStatus{{Ready: true}}
	}

	references := serviceEndpointReferences(endpointSliceList{}, serviceList{Items: services}, podList{Items: pods})
	if len(references) != 0 {
		t.Fatalf("serviceEndpointReferences() partially returned an over-budget inferred scan: %d entries", len(references))
	}

	observedSlice := endpointSliceResource{Metadata: metadata{Namespace: "app", Labels: map[string]string{"kubernetes.io/service-name": "observed"}}}
	observedSlice.Endpoints = []endpoint{{TargetRef: &objectReference{Kind: "Pod", Name: "pod-aa"}}}
	references = serviceEndpointReferences(endpointSliceList{Items: []endpointSliceResource{observedSlice}}, serviceList{Items: services}, podList{Items: pods})
	if len(references) != 1 || references[0].service != "observed" || references[0].confidence != "observed" {
		t.Fatalf("serviceEndpointReferences() = %#v, want observed edge preserved without partial inferred edges", references)
	}

	counts := map[string]endpointCounter{}
	mergeReferenceEndpointCounts(counts, []serviceEndpointReference{
		{namespace: "app", service: "api", pod: "ready", confidence: "inferred", ready: true},
		{namespace: "app", service: "api", pod: "pending", confidence: "inferred", ready: false},
		{namespace: "app", service: "api", pod: "observed", confidence: "observed", ready: true},
	})
	if got := counts["app/api"]; got.ready != 1 || got.total != 2 {
		t.Fatalf("mergeReferenceEndpointCounts() = %+v, want inferred 1/2", got)
	}
}

func TestIngressAndGatewaySummariesValidateRemoteStrings(t *testing.T) {
	ingress := ingressResource{}
	if err := json.Unmarshal([]byte(`{"metadata":{"namespace":"edge"},"spec":{"rules":[{"host":"api.example.com","http":{"paths":[{"backend":{"service":{"name":"api"}}},{"backend":{"service":{"name":"bad name"}}}]}},{"host":"TOKEN.EXAMPLE.COM"}]}}`), &ingress); err != nil {
		t.Fatalf("decode ingress: %v", err)
	}
	if got := strings.Join(ingressHosts(ingress), ","); got != "api.example.com" {
		t.Fatalf("ingressHosts() = %q, want validated host", got)
	}
	if got := strings.Join(ingressServiceNames(ingress), ","); got != "api" {
		t.Fatalf("ingressServiceNames() = %q, want validated service", got)
	}

	route := gatewayRouteResource{}
	if err := json.Unmarshal([]byte(`{"metadata":{"namespace":"edge"},"spec":{"hostnames":["api.example.com","BAD.EXAMPLE.COM"],"parentRefs":[{"name":"public","kind":"Gateway"},{"name":"bad name"}],"rules":[{"backendRefs":[{"name":"api"},{"name":"bad name"}],"matches":[{"method":{"service":"checkout.v1.Cart","method":"GetCart"}},{"method":{"service":"credential\nvalue","method":"Bad"}}]}]}}`), &route); err != nil {
		t.Fatalf("decode route: %v", err)
	}
	if got := strings.Join(gatewayRouteHosts(route), ","); got != "api.example.com" {
		t.Fatalf("gatewayRouteHosts() = %q, want validated host", got)
	}
	if refs := gatewayRouteParentRefs(route); len(refs) != 1 || refs[0].Name != "public" || refs[0].Namespace != "edge" {
		t.Fatalf("gatewayRouteParentRefs() = %#v", refs)
	}
	if refs := gatewayRouteBackendRefs(route); len(refs) != 1 || refs[0].Name != "api" || refs[0].Namespace != "edge" {
		t.Fatalf("gatewayRouteBackendRefs() = %#v", refs)
	}
	if got := grpcRouteMethods(route); len(got) != 1 || got[0] != "checkout.v1.Cart/GetCart" {
		t.Fatalf("grpcRouteMethods() = %#v, want safe method only", got)
	}
}

func TestGatewayReferenceCollectionsAreBoundedAndDeterministic(t *testing.T) {
	route := gatewayRouteResource{Metadata: metadata{Namespace: "edge"}}
	route.Spec.ParentRefs = []gatewayReference{
		{Name: "zeta"},
		{Name: "alpha"},
		{Name: "zeta"},
	}
	refs := gatewayRouteParentRefs(route)
	if len(refs) != 2 || refs[0].Name != "alpha" || refs[1].Name != "zeta" {
		t.Fatalf("gatewayRouteParentRefs() = %#v, want unique deterministic refs", refs)
	}

	route.Spec.ParentRefs = make([]gatewayReference, maxGatewayRouteParentReferences+1)
	if got := gatewayRouteParentRefs(route); len(got) != 0 {
		t.Fatalf("gatewayRouteParentRefs() = %#v, want oversized collection rejected", got)
	}

	route.Spec.ParentRefs = nil
	route.Spec.Rules = make([]gatewayRouteRule, 3)
	for ruleIndex := range route.Spec.Rules {
		route.Spec.Rules[ruleIndex].BackendRefs = make([]gatewayReference, maxGatewayRouteBackendReferences)
		for refIndex := range route.Spec.Rules[ruleIndex].BackendRefs {
			index := ruleIndex*maxGatewayRouteBackendReferences + refIndex
			route.Spec.Rules[ruleIndex].BackendRefs[refIndex] = gatewayReference{Name: "service-" + strconv.Itoa(index)}
		}
	}
	if got := gatewayRouteBackendRefs(route); len(got) != 0 {
		t.Fatalf("gatewayRouteBackendRefs() returned %d refs, want total result cap rejection", len(got))
	}
}

func TestSnapshotDoesNotCreateMalformedReferencePlaceholders(t *testing.T) {
	resources := newKubernetesSnapshotResources()
	resources.namespaces.Items = []namespace{{Metadata: metadata{Name: "app"}}}
	pod := podResource{Metadata: metadata{Name: "api", Namespace: "app"}}
	pod.Spec.NodeName = "bad node"
	pod.Spec.ServiceAccountName = "bad account"
	pod.Spec.ImagePullSecret = []localObjectRef{{Name: "bad secret"}}
	pod.Status.Phase = "Running"
	pod.Status.ContainerStatuses = []containerStatus{{Ready: true}}
	resources.pods.Items = []podResource{pod}
	hpa := horizontalPodAutoscalerResource{Metadata: metadata{Name: "api", Namespace: "app"}}
	hpa.Spec.ScaleTargetRef.Kind = "Injected Kind"
	hpa.Spec.ScaleTargetRef.Name = "bad target"
	resources.hpas.Items = []horizontalPodAutoscalerResource{hpa}

	snapshot := buildKubernetesSnapshot("cluster", "cluster", resources)
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	body := string(encoded)
	for _, forbidden := range []string{"bad node", "bad account", "bad secret", "bad target", "Injected Kind"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("snapshot retained malformed reference %q: %s", forbidden, body)
		}
	}
}

func paddedNumber(value int) string {
	return string(rune('a'+value/26%26)) + string(rune('a'+value%26))
}
