package provider

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestServiceTypeClusterIPAndExternalNameValidation(t *testing.T) {
	if got, valid := normalizedServiceType(""); got != "ClusterIP" || !valid {
		t.Fatalf("normalized default Service type = %q/%t", got, valid)
	}
	for _, serviceType := range []string{"ClusterIP", "NodePort", "LoadBalancer", "ExternalName"} {
		if got, valid := normalizedServiceType(serviceType); got != serviceType || !valid {
			t.Fatalf("normalized Service type %q = %q/%t", serviceType, got, valid)
		}
	}
	if got, valid := normalizedServiceType("Injected"); got != "invalid" || valid {
		t.Fatalf("invalid Service type = %q/%t", got, valid)
	}

	for _, clusterIP := range []string{"", "None", "10.0.0.1", "2001:db8::1"} {
		if !validServiceClusterIP("ClusterIP", clusterIP) {
			t.Fatalf("valid ClusterIP %q was rejected", clusterIP)
		}
	}
	for _, clusterIP := range []string{"10.00.0.1", "2001:0db8::1", "token=value"} {
		if validServiceClusterIP("ClusterIP", clusterIP) {
			t.Fatalf("invalid ClusterIP %q was accepted", clusterIP)
		}
	}
	if validServiceClusterIP("NodePort", "None") || validServiceClusterIP("ExternalName", "10.0.0.1") {
		t.Fatal("Service type-specific ClusterIP constraint was not enforced")
	}

	external := serviceResource{}
	external.Spec.Type = "ExternalName"
	external.Spec.ExternalName = "api.example.com"
	if !validServiceSpec(external) || serviceStatus(external, endpointCounter{}) != "healthy" {
		t.Fatalf("valid ExternalName Service was rejected: %+v", external)
	}
	if summary := serviceSummary(external, endpointCounter{}); summary["clusterIP"] != "unset" || summary["ipFamilyPolicy"] != "unset" {
		t.Fatalf("ExternalName IP summary = %+v", summary)
	}
	external.Spec.ExternalName = "API.example.com"
	if validServiceSpec(external) || serviceStatus(external, endpointCounter{}) != "warning" {
		t.Fatalf("malformed ExternalName Service was accepted: %+v", external)
	}
}

func TestServiceDualStackConfigurationValidation(t *testing.T) {
	dualStack := serviceResource{}
	dualStack.Spec.Type = "ClusterIP"
	dualStack.Spec.ClusterIP = "10.0.0.8"
	dualStack.Spec.ClusterIPs = []string{"10.0.0.8", "2001:db8::8"}
	dualStack.Spec.IPFamilies = []string{"IPv4", "IPv6"}
	dualStack.Spec.IPFamilyPolicy = "RequireDualStack"
	if !validServiceSpec(dualStack) {
		t.Fatal("valid dual-stack Service was rejected")
	}
	summary := serviceSummary(dualStack, endpointCounter{})
	if summary["clusterIPs"] != 2 || summary["ipFamilies"] != "IPv4,IPv6" || summary["ipFamilyPolicy"] != "RequireDualStack" {
		t.Fatalf("dual-stack summary = %+v", summary)
	}

	fixtures := []struct {
		name       string
		clusterIP  string
		clusterIPs []string
		families   []string
		policy     string
	}{
		{name: "primary mismatch", clusterIP: "10.0.0.8", clusterIPs: []string{"10.0.0.9"}, families: []string{"IPv4"}},
		{name: "same family twice", clusterIP: "10.0.0.8", clusterIPs: []string{"10.0.0.8", "10.0.0.9"}, families: []string{"IPv4", "IPv4"}, policy: "PreferDualStack"},
		{name: "family mismatch", clusterIP: "10.0.0.8", clusterIPs: []string{"10.0.0.8"}, families: []string{"IPv6"}},
		{name: "single policy with two addresses", clusterIP: "10.0.0.8", clusterIPs: []string{"10.0.0.8", "2001:db8::8"}, families: []string{"IPv4", "IPv6"}, policy: "SingleStack"},
		{name: "require policy with one address", clusterIP: "10.0.0.8", clusterIPs: []string{"10.0.0.8"}, families: []string{"IPv4"}, policy: "RequireDualStack"},
		{name: "noncanonical address", clusterIP: "10.0.0.8", clusterIPs: []string{"10.0.0.8", "2001:0db8::8"}, families: []string{"IPv4", "IPv6"}, policy: "PreferDualStack"},
		{name: "invalid policy", clusterIP: "10.0.0.8", clusterIPs: []string{"10.0.0.8"}, families: []string{"IPv4"}, policy: "Automatic"},
	}
	for _, fixture := range fixtures {
		service := serviceResource{}
		service.Spec.ClusterIP = fixture.clusterIP
		service.Spec.ClusterIPs = fixture.clusterIPs
		service.Spec.IPFamilies = fixture.families
		service.Spec.IPFamilyPolicy = fixture.policy
		if validServiceSpec(service) {
			t.Fatalf("invalid dual-stack fixture %q was accepted", fixture.name)
		}
	}

	headless := serviceResource{}
	headless.Spec.ClusterIP = "None"
	headless.Spec.ClusterIPs = []string{"None"}
	headless.Spec.IPFamilies = []string{"IPv6"}
	if !validServiceSpec(headless) {
		t.Fatal("valid headless Service IP configuration was rejected")
	}
	headless.Spec.IPFamilies = []string{"IPv4", "IPv6"}
	headless.Spec.IPFamilyPolicy = "RequireDualStack"
	if !validServiceSpec(headless) {
		t.Fatal("valid dual-stack headless Service was rejected")
	}
	external := serviceResource{}
	external.Spec.Type = "ExternalName"
	external.Spec.ExternalName = "api.example.com"
	external.Spec.ClusterIPs = []string{"10.0.0.8"}
	if validServiceSpec(external) {
		t.Fatal("ExternalName Service with clusterIPs was accepted")
	}
}

func TestServicePortAndSelectorValidationIsBounded(t *testing.T) {
	if !validServicePorts("ClusterIP", []servicePort{{Port: 80}}) {
		t.Fatal("single default-protocol Service port was rejected")
	}
	if !validServicePorts("ClusterIP", []servicePort{{Name: "http", Protocol: "TCP", Port: 80}, {Name: "dns", Protocol: "UDP", Port: 53}}) {
		t.Fatal("valid named Service ports were rejected")
	}
	invalidPorts := [][]servicePort{
		{{Port: 0}},
		{{Port: 65536}},
		{{Protocol: "HTTP", Port: 80}},
		{{Name: "Bad", Port: 80}},
		{{Port: 80}, {Name: "metrics", Port: 9090}},
		{{Name: "http", Port: 80}, {Name: "http", Port: 8080}},
		{{Name: "http", Protocol: "TCP", Port: 80}, {Name: "http-alt", Port: 80}},
		make([]servicePort, maxServicePorts+1),
	}
	for index, ports := range invalidPorts {
		if validServicePorts("ClusterIP", ports) {
			t.Fatalf("invalid Service ports fixture %d was accepted", index)
		}
	}

	if !validServiceSelector(map[string]string{"app": "api"}) || validServiceSelector(map[string]string{"bad key": "api"}) {
		t.Fatal("Service selector syntax validation mismatch")
	}
	oversized := make(map[string]string, maxLabelSelectorLabels+1)
	for index := 0; index <= maxLabelSelectorLabels; index++ {
		oversized[fmt.Sprintf("key-%02d", index)] = "value"
	}
	if validServiceSelector(oversized) || serviceSelectorSummary(oversized) != "invalid" {
		t.Fatal("oversized Service selector was accepted")
	}
}

func TestServiceTargetNodePortAndAppProtocolValidation(t *testing.T) {
	numeric := decodeServiceTargetPort(t, "8080")
	named := decodeServiceTargetPort(t, `"http-web"`)
	if !numeric.Valid || numeric.Kind != "number" || numeric.IntValue != 8080 {
		t.Fatalf("numeric targetPort = %+v", numeric)
	}
	if !named.Valid || named.Kind != "name" || named.StringValue != "http-web" {
		t.Fatalf("named targetPort = %+v", named)
	}
	for _, value := range []string{"null", "0", "65536", "80.5", `""`, `"UPPER"`, `"1234"`, `"name-that-is-too-long"`, fmt.Sprintf(`"%s"`, strings.Repeat("a", maxTargetPortJSONSize)), `{"name":"http"}`} {
		if target := decodeServiceTargetPort(t, value); target.Valid || !target.Set {
			t.Fatalf("invalid targetPort %s = %+v", value, target)
		}
	}

	clusterPort := servicePort{Port: 80, TargetPort: named, AppProtocol: "kubernetes.io/h2c"}
	if !validServicePorts("ClusterIP", []servicePort{clusterPort}) {
		t.Fatal("valid targetPort and appProtocol were rejected")
	}
	portSummary := serviceSummary(serviceResourceWithPorts(clusterPort), endpointCounter{})
	if portSummary["ports"] != 1 || portSummary["targetPorts"] != 1 || portSummary["nodePorts"] != 0 || portSummary["appProtocols"] != 1 {
		t.Fatalf("Service port summary = %+v", portSummary)
	}
	clusterPort.NodePort = 30080
	if validServicePorts("ClusterIP", []servicePort{clusterPort}) {
		t.Fatal("ClusterIP Service nodePort was accepted")
	}
	nodePort := servicePort{Port: 80, TargetPort: numeric, NodePort: 30080, AppProtocol: "example.com/http"}
	if !validServicePorts("NodePort", []servicePort{nodePort}) || validServicePorts("NodePort", []servicePort{{Port: 80}}) {
		t.Fatal("NodePort allocation policy mismatch")
	}
	if !validServicePorts("LoadBalancer", []servicePort{{Port: 443}}) {
		t.Fatal("LoadBalancer port without nodePort was rejected")
	}
	if !validServicePorts("NodePort", []servicePort{{Name: "dns-tcp", Protocol: "TCP", Port: 53, NodePort: 30053}, {Name: "dns-udp", Protocol: "UDP", Port: 53, NodePort: 30053}}) {
		t.Fatal("same Service and node port across distinct protocols was rejected")
	}
	if validServicePorts("NodePort", []servicePort{{Name: "http", Port: 80, NodePort: 30080}, {Name: "metrics", Port: 9090, NodePort: 30080}}) {
		t.Fatal("duplicate nodePort and protocol was accepted")
	}
	if validServicePorts("ClusterIP", []servicePort{{Port: 80, AppProtocol: "bad key"}}) {
		t.Fatal("invalid appProtocol was accepted")
	}
}

func serviceResourceWithPorts(ports ...servicePort) serviceResource {
	service := serviceResource{}
	service.Spec.Ports = ports
	return service
}

func decodeServiceTargetPort(t *testing.T, value string) serviceTargetPort {
	t.Helper()
	var target serviceTargetPort
	if err := json.Unmarshal([]byte(value), &target); err != nil {
		t.Fatalf("decode targetPort %s: %v", value, err)
	}
	return target
}

func TestServiceSummaryAndSnapshotFailClosedForMalformedSpec(t *testing.T) {
	service := serviceResource{Metadata: metadata{Name: "api", Namespace: "app"}}
	service.Spec.Type = "Injected"
	service.Spec.ClusterIP = "token=remote-value"
	service.Spec.ClusterIPs = []string{"credential=remote-value"}
	service.Spec.IPFamilies = []string{"UnsafeFamily"}
	service.Spec.IPFamilyPolicy = "InjectedPolicy"
	service.Spec.ExternalName = "credential.example.com"
	service.Spec.Ports = []servicePort{{Protocol: "HTTP", Port: -1, NodePort: -1, AppProtocol: "credential/value"}}
	service.Spec.Selector = map[string]string{"bad key": "value"}

	summary := serviceSummary(service, endpointCounter{})
	for _, key := range []string{"type", "clusterIP", "clusterIPs", "ipFamilies", "ipFamilyPolicy", "externalName", "ports", "targetPorts", "nodePorts", "appProtocols", "selector"} {
		if summary[key] != "invalid" {
			t.Fatalf("Service summary %s = %#v", key, summary[key])
		}
	}

	resources := newKubernetesSnapshotResources()
	resources.services.Items = []serviceResource{service}
	snapshot := buildKubernetesSnapshot("cluster-a", "Cluster A", resources)
	node := snapshotNode(t, snapshot, "Service", "app", "api")
	if node.Status != "warning" {
		t.Fatalf("malformed Service status = %q", node.Status)
	}
	diagnostic := findSnapshotDiagnostic(snapshot.Diagnostics, "snapshot/services")
	if diagnostic.Reason != "invalid_item" || diagnostic.Count != 1 {
		t.Fatalf("malformed Service diagnostic = %+v", diagnostic)
	}
	encoded := fmt.Sprintf("%+v", node.Summary)
	if strings.Contains(encoded, "remote-value") || strings.Contains(encoded, "credential.example.com") || strings.Contains(encoded, "UnsafeFamily") || strings.Contains(encoded, "InjectedPolicy") {
		t.Fatalf("malformed Service values leaked: %s", encoded)
	}
}

func TestServiceStatusHonorsPublishNotReadyAddressPolicy(t *testing.T) {
	service := serviceResource{}
	service.Spec.Selector = map[string]string{"app": "api"}
	counts := endpointCounter{ready: 0, serving: 1, total: 1}
	if got := serviceStatus(service, counts); got != "warning" {
		t.Fatalf("serviceStatus() = %q, want warning for observed not-ready endpoint", got)
	}
	service.Spec.PublishNotReadyAddresses = true
	if got := serviceStatus(service, counts); got != "healthy" {
		t.Fatalf("serviceStatus() = %q, want healthy when readiness is intentionally ignored", got)
	}
	if got := serviceTrafficReadyCount(service, counts); got != 1 {
		t.Fatalf("serviceTrafficReadyCount() = %d, want total endpoints", got)
	}
}

func TestServiceSelectorInferenceRejectsInvalidOrExternalServices(t *testing.T) {
	pod := podResource{Metadata: metadata{Name: "api-a", Namespace: "app", Labels: map[string]string{"app": "api"}}}
	pod.Status.Phase = "Running"
	pod.Status.ContainerStatuses = []containerStatus{{Ready: true}}
	valid := serviceResource{Metadata: metadata{Name: "valid", Namespace: "app"}}
	valid.Spec.Selector = map[string]string{"app": "api"}
	invalid := serviceResource{Metadata: metadata{Name: "invalid", Namespace: "app"}}
	invalid.Spec.Selector = map[string]string{"app": "api"}
	invalid.Spec.Ports = []servicePort{{Protocol: "HTTP", Port: 80}}
	external := serviceResource{Metadata: metadata{Name: "external", Namespace: "app"}}
	external.Spec.Type = "ExternalName"
	external.Spec.ExternalName = "api.example.com"
	external.Spec.Selector = map[string]string{"app": "api"}

	references := serviceEndpointReferences(endpointSliceList{}, serviceList{Items: []serviceResource{valid, invalid, external}}, podList{Items: []podResource{pod}})
	if len(references) != 1 || references[0].service != "valid" || references[0].pod != "api-a" {
		t.Fatalf("Service selector references = %#v", references)
	}
}
