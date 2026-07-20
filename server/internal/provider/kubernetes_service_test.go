package provider

import (
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
	external.Spec.ExternalName = "API.example.com"
	if validServiceSpec(external) || serviceStatus(external, endpointCounter{}) != "warning" {
		t.Fatalf("malformed ExternalName Service was accepted: %+v", external)
	}
}

func TestServicePortAndSelectorValidationIsBounded(t *testing.T) {
	if !validServicePorts([]servicePort{{Port: 80}}) {
		t.Fatal("single default-protocol Service port was rejected")
	}
	if !validServicePorts([]servicePort{{Name: "http", Protocol: "TCP", Port: 80}, {Name: "dns", Protocol: "UDP", Port: 53}}) {
		t.Fatal("valid named Service ports were rejected")
	}
	invalidPorts := [][]servicePort{
		{{Port: 0}},
		{{Port: 65536}},
		{{Protocol: "HTTP", Port: 80}},
		{{Name: "Bad", Port: 80}},
		{{Port: 80}, {Name: "metrics", Port: 9090}},
		{{Name: "http", Port: 80}, {Name: "http", Port: 8080}},
		make([]servicePort, maxServicePorts+1),
	}
	for index, ports := range invalidPorts {
		if validServicePorts(ports) {
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

func TestServiceSummaryAndSnapshotFailClosedForMalformedSpec(t *testing.T) {
	service := serviceResource{Metadata: metadata{Name: "api", Namespace: "app"}}
	service.Spec.Type = "Injected"
	service.Spec.ClusterIP = "token=remote-value"
	service.Spec.ExternalName = "credential.example.com"
	service.Spec.Ports = []servicePort{{Protocol: "HTTP", Port: -1}}
	service.Spec.Selector = map[string]string{"bad key": "value"}

	summary := serviceSummary(service, endpointCounter{})
	for _, key := range []string{"type", "clusterIP", "externalName", "ports", "selector"} {
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
	if strings.Contains(encoded, "remote-value") || strings.Contains(encoded, "credential.example.com") {
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
