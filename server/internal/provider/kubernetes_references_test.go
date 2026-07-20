package provider

import (
	"encoding/json"
	"fmt"
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
	valid := endpointSliceResource{Metadata: metadata{Name: "api-a", Namespace: "app", Labels: map[string]string{"kubernetes.io/service-name": "api"}}, AddressType: "IPv4"}
	readyEndpoint := endpoint{Addresses: []string{"10.0.0.2"}}
	readyEndpoint.Conditions.Ready = &ready
	valid.Endpoints = []endpoint{{Addresses: []string{"10.0.0.1"}}, readyEndpoint}
	malformed := endpointSliceResource{Metadata: metadata{Name: "unsafe", Namespace: "bad namespace", Labels: map[string]string{"kubernetes.io/service-name": "unsafe"}}, Endpoints: []endpoint{{}}}
	oversized := endpointSliceResource{Metadata: metadata{Name: "oversized", Namespace: "app", Labels: map[string]string{"kubernetes.io/service-name": "oversized"}}, AddressType: "IPv4", Endpoints: make([]endpoint, maxEndpointSliceEndpoints+1)}

	counts := endpointCounts(endpointSliceList{Items: []endpointSliceResource{valid, malformed, oversized}})
	if got := counts["app/api"]; got.ready != 2 || got.total != 2 {
		t.Fatalf("endpointCounts() = %+v, want two ready endpoints", got)
	}
	if len(counts) != 1 {
		t.Fatalf("endpointCounts() retained invalid slices: %#v", counts)
	}
}

func TestEndpointSliceAnalysisPreservesReadyServingAndTerminatingSemantics(t *testing.T) {
	readyFalse := false
	servingTrue := true
	terminatingTrue := true
	terminating := endpoint{Addresses: []string{"10.0.0.1"}, TargetRef: &objectReference{Kind: "Pod", Name: "api-old"}}
	terminating.Conditions.Ready = &readyFalse
	terminating.Conditions.Serving = &servingTrue
	terminating.Conditions.Terminating = &terminatingTrue
	defaulted := endpoint{Addresses: []string{"10.0.0.2"}, TargetRef: &objectReference{Kind: "Pod", Name: "api-new"}}
	slice := endpointSliceResource{
		Metadata:    metadata{Name: "api-a", Namespace: "app", Labels: map[string]string{"kubernetes.io/service-name": "api"}},
		AddressType: "IPv4",
		Endpoints:   []endpoint{terminating, defaulted},
	}

	analysis := analyzeEndpointSlices(endpointSliceList{Items: []endpointSliceResource{slice}})
	counts := analysis.counts["app/api"]
	if counts.ready != 1 || counts.serving != 2 || counts.terminating != 1 || counts.total != 2 {
		t.Fatalf("EndpointSlice condition counts = %+v, want ready=1 serving=2 terminating=1 total=2", counts)
	}
	if len(analysis.references) != 2 || analysis.references[0].ready || !analysis.references[1].ready {
		t.Fatalf("EndpointSlice relation readiness = %#v", analysis.references)
	}

	mergeCounts := map[string]endpointCounter{}
	mergeReferenceEndpointCounts(mergeCounts, []serviceEndpointReference{{namespace: "app", service: "api", pod: "api", confidence: "inferred", ready: true}})
	if got := mergeCounts["app/api"]; got.ready != 1 || got.serving != 1 || got.terminating != 0 || got.total != 1 {
		t.Fatalf("inferred endpoint counts = %+v", got)
	}
}

func TestEndpointSliceAnalysisDeduplicatesIdentityAndRejectsMalformedAddresses(t *testing.T) {
	first := endpointSliceResource{
		Metadata:    metadata{Name: "api-a", Namespace: "app", Labels: map[string]string{"kubernetes.io/service-name": "api"}},
		AddressType: "IPv4",
		Endpoints: []endpoint{
			{Addresses: []string{"10.0.0.1"}, TargetRef: &objectReference{Kind: "Pod", Name: "api-a"}},
			{Addresses: []string{"10.0.0.2"}},
			{Addresses: []string{"10.00.0.3"}},
			{Addresses: []string{"10.0.0.4"}, TargetRef: &objectReference{Kind: "Pod", Namespace: "other", Name: "cross-namespace"}},
			{Addresses: []string{"10.0.0.5", "10.0.0.5"}},
		},
	}
	second := endpointSliceResource{
		Metadata:    metadata{Name: "api-b", Namespace: "app", Labels: map[string]string{"kubernetes.io/service-name": "api"}},
		AddressType: "IPv4",
		Endpoints: []endpoint{
			{Addresses: []string{"10.0.0.9"}, TargetRef: &objectReference{Kind: "Pod", Name: "api-a"}},
			{Addresses: []string{"10.0.0.2"}},
			{Addresses: []string{"10.0.0.3"}},
		},
	}

	analysis := analyzeEndpointSlices(endpointSliceList{Items: []endpointSliceResource{first, second}})
	if got := analysis.counts["app/api"]; got.total != 3 || got.ready != 3 || got.serving != 3 {
		t.Fatalf("deduplicated endpoint counts = %+v", got)
	}
	if analysis.invalidItems != 5 || len(analysis.references) != 1 || analysis.references[0].pod != "api-a" {
		t.Fatalf("endpoint identity analysis = %+v", analysis)
	}
}

func TestEndpointAddressValidationIsCanonicalAndBounded(t *testing.T) {
	tests := []struct {
		addressType string
		address     string
		valid       bool
	}{
		{addressType: "IPv4", address: "10.0.0.1", valid: true},
		{addressType: "IPv4", address: "10.00.0.1", valid: false},
		{addressType: "IPv4", address: "2001:db8::1", valid: false},
		{addressType: "IPv6", address: "2001:db8::1", valid: true},
		{addressType: "IPv6", address: "2001:0db8::1", valid: false},
		{addressType: "FQDN", address: "api.example.com", valid: true},
		{addressType: "FQDN", address: "API.example.com", valid: false},
		{addressType: "unknown", address: "10.0.0.1", valid: false},
	}
	for _, test := range tests {
		if got := validEndpointAddress(test.addressType, test.address); got != test.valid {
			t.Fatalf("validEndpointAddress(%q, %q) = %t", test.addressType, test.address, got)
		}
	}
	if _, valid := endpointPrimaryAddress("IPv4", nil); valid {
		t.Fatal("empty endpoint addresses were accepted")
	}
	if _, valid := endpointPrimaryAddress("IPv4", make([]string, maxEndpointAddresses+1)); valid {
		t.Fatal("oversized endpoint addresses were accepted")
	}
}

func TestEndpointSliceAnalysisRejectsDuplicatesAndFailsClosedOnGlobalBudget(t *testing.T) {
	first := endpointSliceResource{Metadata: metadata{Name: "api-a", Namespace: "app", Labels: map[string]string{"kubernetes.io/service-name": "api"}}, AddressType: "IPv4", Endpoints: []endpoint{{Addresses: []string{"10.0.0.1"}, TargetRef: &objectReference{Kind: "Pod", Name: "api-a"}}}}
	duplicate := endpointSliceResource{Metadata: metadata{Name: "api-a", Namespace: "app", Labels: map[string]string{"kubernetes.io/service-name": "other"}}, AddressType: "IPv4", Endpoints: []endpoint{{Addresses: []string{"10.0.0.2"}, TargetRef: &objectReference{Kind: "Pod", Name: "other-a"}}}}
	analysis := analyzeEndpointSlices(endpointSliceList{Items: []endpointSliceResource{first, duplicate}})
	if analysis.invalidItems != 1 || analysis.processingLimited || len(analysis.counts) != 1 || analysis.counts["app/api"].total != 1 || len(analysis.references) != 1 {
		t.Fatalf("duplicate EndpointSlice analysis = %+v", analysis)
	}

	items := make([]endpointSliceResource, maxEndpointSliceEndpointVisits/maxEndpointSliceEndpoints+1)
	for index := range items {
		items[index].Metadata = metadata{Name: "slice-" + paddedNumber(index), Namespace: "app", Labels: map[string]string{"kubernetes.io/service-name": "api"}}
		items[index].AddressType = "IPv6"
		items[index].Endpoints = make([]endpoint, maxEndpointSliceEndpoints)
		for endpointIndex := range items[index].Endpoints {
			items[index].Endpoints[endpointIndex].Addresses = []string{fmt.Sprintf("2001:db8:%x::%x", index+1, endpointIndex+1)}
		}
	}
	analysis = analyzeEndpointSlices(endpointSliceList{Items: items})
	if !analysis.processingLimited || len(analysis.counts) != 0 || len(analysis.references) != 0 {
		t.Fatalf("over-budget EndpointSlice analysis was not atomic: counts=%d refs=%d limited=%t", len(analysis.counts), len(analysis.references), analysis.processingLimited)
	}
	diagnostics := analysis.diagnostics()
	if len(diagnostics) != 1 || diagnostics[0].Reason != "processing_limit" || diagnostics[0].Resource != "EndpointSlices" {
		t.Fatalf("EndpointSlice processing diagnostic = %+v", diagnostics)
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

	observedSlice := endpointSliceResource{Metadata: metadata{Name: "observed-a", Namespace: "app", Labels: map[string]string{"kubernetes.io/service-name": "observed"}}, AddressType: "IPv4"}
	observedSlice.Endpoints = []endpoint{{Addresses: []string{"10.0.0.1"}, TargetRef: &objectReference{Kind: "Pod", Name: "pod-aa"}}}
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
	if err := json.Unmarshal([]byte(`{"metadata":{"namespace":"edge"},"spec":{"rules":[{"host":"api.example.com","http":{"paths":[{"path":"/","pathType":"Prefix","backend":{"service":{"name":"api","port":{"number":80}}}}]}}]}}`), &ingress); err != nil {
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
