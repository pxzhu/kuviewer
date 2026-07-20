package provider

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGatewaySummaryValidatesBoundariesWithoutRetainingAddresses(t *testing.T) {
	gateway := gatewayResource{}
	input := `{"metadata":{"name":"public","namespace":"edge"},"spec":{"gatewayClassName":"managed","addresses":[{"type":"IPAddress","value":"192.0.2.40"},{"type":"NamedAddress","value":"private-pool"}],"listeners":[{"name":"https","protocol":"HTTPS","port":443,"hostname":"api.example.com"}]},"status":{"addresses":[{"type":"Hostname","value":"assigned.example.com"}],"conditions":[{"type":"Programmed","status":"True","message":"credential=remote"}],"listeners":[{"name":"https","attachedRoutes":2,"conditions":[{"type":"Programmed","status":"True"}]}]}}`
	if err := json.Unmarshal([]byte(input), &gateway); err != nil {
		t.Fatalf("decode Gateway: %v", err)
	}
	if !validGatewaySpec(gateway) || !validGatewayStatus(gateway) || gatewayStatus(gateway) != "healthy" {
		t.Fatalf("Gateway validation/status failed: %#v", gatewaySummary(gateway))
	}
	summary := gatewaySummary(gateway)
	if summary["requestedAddresses"] != 2 || summary["assignedAddresses"] != 1 || summary["deprecatedAddresses"] != 1 || summary["attachedRoutes"] != 2 {
		t.Fatalf("Gateway summary = %#v", summary)
	}
	encoded, err := json.Marshal(struct {
		Gateway gatewayResource
		Summary map[string]interface{}
	}{gateway, summary})
	if err != nil {
		t.Fatalf("marshal Gateway: %v", err)
	}
	for _, forbidden := range []string{"192.0.2.40", "private-pool", "assigned.example.com", "credential=remote"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("Gateway retained address or condition detail %q: %s", forbidden, encoded)
		}
	}
}

func TestGatewayValidationFailsClosedForMalformedSpecAndStatus(t *testing.T) {
	fixtures := []struct {
		input       string
		validSpec   bool
		validStatus bool
	}{
		{`{"spec":{"gatewayClassName":"managed","listeners":[]}}`, false, true},
		{`{"spec":{"gatewayClassName":"managed","listeners":[{"name":"UPPER","protocol":"HTTP","port":80}]}}`, false, true},
		{`{"spec":{"gatewayClassName":"managed","addresses":[{"type":"IPAddress","value":"credential=value"}],"listeners":[{"name":"http","protocol":"HTTP","port":80}]}}`, false, true},
		{`{"spec":{"gatewayClassName":"managed","listeners":[{"name":"http","protocol":"HTTP","port":80}]},"status":{"conditions":[{"type":"Ready","status":"Maybe"}]}}`, true, false},
	}
	for index, fixture := range fixtures {
		gateway := gatewayResource{}
		if err := json.Unmarshal([]byte(fixture.input), &gateway); err != nil {
			t.Fatalf("fixture %d decode: %v", index, err)
		}
		if validGatewaySpec(gateway) != fixture.validSpec || validGatewayStatus(gateway) != fixture.validStatus || gatewayStatus(gateway) != "warning" {
			t.Fatalf("fixture %d validation mismatch: spec=%t status=%t summary=%#v", index, validGatewaySpec(gateway), validGatewayStatus(gateway), gatewaySummary(gateway))
		}
	}
}

func TestGatewayRouteValidationAndStatusSummary(t *testing.T) {
	route := gatewayRouteResource{}
	input := `{"metadata":{"name":"checkout","namespace":"edge"},"spec":{"hostnames":["grpc.example.com"],"parentRefs":[{"name":"public"}],"rules":[{"backendRefs":[{"name":"checkout","port":8443}],"matches":[{"method":{"service":"checkout.v1.Cart","method":"GetCart"}}]}]},"status":{"parents":[{"conditions":[{"type":"Accepted","status":"True"},{"type":"ResolvedRefs","status":"False","message":"remote detail"}]}]}}`
	if err := json.Unmarshal([]byte(input), &route); err != nil {
		t.Fatalf("decode GRPCRoute: %v", err)
	}
	if !validGatewayRouteSpec("GRPCRoute", route) || !validGatewayRouteStatus(route) || gatewayRouteStatus("GRPCRoute", route) != "warning" {
		t.Fatalf("GRPCRoute validation/status failed: %#v", gatewayRouteSummary("GRPCRoute", route))
	}
	summary := gatewayRouteSummary("GRPCRoute", route)
	if summary["acceptedParents"] != 1 || summary["resolvedParents"] != 0 || summary["statusConditions"] != 2 {
		t.Fatalf("GRPCRoute summary = %#v", summary)
	}
	encoded, _ := json.Marshal(summary)
	if strings.Contains(string(encoded), "remote detail") {
		t.Fatalf("GRPCRoute summary leaked condition message: %s", encoded)
	}
}

func TestGatewayRouteMalformedSpecSuppressesReferences(t *testing.T) {
	fixtures := []string{
		`{"metadata":{"namespace":"edge"},"spec":{"parentRefs":[{"name":"public"}],"rules":[{"backendRefs":[{"name":"api"}]}]}}`,
		`{"metadata":{"namespace":"edge"},"spec":{"parentRefs":[{"name":"bad name"}],"rules":[{"backendRefs":[{"name":"api","port":80}]}]}}`,
		`{"metadata":{"namespace":"edge"},"spec":{"parentRefs":[{"name":"public"}],"rules":[{"backendRefs":[{"name":"api","port":80}],"matches":[{"method":{"service":"credential value"}}]}]}}`,
	}
	for index, input := range fixtures {
		route := gatewayRouteResource{}
		if err := json.Unmarshal([]byte(input), &route); err != nil {
			t.Fatalf("fixture %d decode: %v", index, err)
		}
		if validGatewayRouteSpec("GRPCRoute", route) || (index < 2 && (len(gatewayRouteParentRefs(route)) != 0 || len(gatewayRouteBackendRefs(route)) != 0)) {
			t.Fatalf("fixture %d did not fail closed: %#v", index, gatewayRouteSummary("GRPCRoute", route))
		}
	}
}

func TestGatewayRouteMalformedSpecDoesNotCreatePlaceholderEdges(t *testing.T) {
	resources := newKubernetesSnapshotResources()
	resources.namespaces.Items = []namespace{{Metadata: metadata{Name: "edge"}}}
	valid := gatewayRouteResource{Metadata: metadata{Name: "valid", Namespace: "edge"}}
	valid.Spec.ParentRefs = []gatewayReference{{Name: "public"}}
	valid.Spec.Rules = []gatewayRouteRule{{BackendRefs: []gatewayReference{{Name: "api", Port: 80}}}}
	invalid := gatewayRouteResource{Metadata: metadata{Name: "invalid", Namespace: "edge"}}
	invalid.Spec.ParentRefs = []gatewayReference{{Name: "private"}}
	invalid.Spec.Rules = []gatewayRouteRule{{BackendRefs: []gatewayReference{{Name: "credential-backend"}}}}
	resources.httpRoutes.Items = []gatewayRouteResource{valid, invalid}

	snapshot := buildKubernetesSnapshot("cluster", "cluster", resources)
	invalidNode := snapshotNode(t, snapshot, "HTTPRoute", "edge", "invalid")
	if invalidNode.Status != "warning" || invalidNode.Summary["backends"] != "invalid" {
		t.Fatalf("malformed HTTPRoute node = %+v", invalidNode)
	}
	for _, node := range snapshot.Nodes {
		if node.Name == "credential-backend" || node.Name == "private" {
			t.Fatalf("malformed HTTPRoute created placeholder node: %+v", node)
		}
	}
	diagnostic := findSnapshotDiagnostic(snapshot.Diagnostics, "snapshot/httproutes")
	if diagnostic.Reason != "invalid_item" || diagnostic.Count != 1 {
		t.Fatalf("malformed HTTPRoute diagnostic = %+v", diagnostic)
	}
}
