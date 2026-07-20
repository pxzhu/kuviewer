package provider

import (
	"strings"
	"testing"
)

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

func TestNetworkPolicyTypesAllowlistExplicitValues(t *testing.T) {
	policy := networkPolicyResource{Spec: networkPolicySpec{PolicyTypes: []string{"Ingress", "Injected", "Egress", "Ingress"}}}
	got := networkPolicyTypes(policy)
	if len(got) != 2 || got[0] != "Egress" || got[1] != "Ingress" {
		t.Fatalf("networkPolicyTypes() = %#v, want allowlisted deterministic values", got)
	}

	policy.Spec.PolicyTypes = []string{"Injected"}
	if got := networkPolicyTypes(policy); len(got) != 0 {
		t.Fatalf("networkPolicyTypes() = %#v, want malformed-only list rejected", got)
	}
}

func TestLabelSelectorMatchesSupportedOperators(t *testing.T) {
	labels := map[string]string{"app": "api", "env": "stage", "scrape": "true"}
	tests := []struct {
		name       string
		expression labelSelectorMatchExpression
		want       bool
	}{
		{name: "in", expression: labelSelectorMatchExpression{Key: "app", Operator: "In", Values: []string{"api", "worker"}}, want: true},
		{name: "not in", expression: labelSelectorMatchExpression{Key: "env", Operator: "NotIn", Values: []string{"prod"}}, want: true},
		{name: "not in missing", expression: labelSelectorMatchExpression{Key: "missing", Operator: "NotIn", Values: []string{"prod"}}, want: true},
		{name: "exists", expression: labelSelectorMatchExpression{Key: "scrape", Operator: "Exists"}, want: true},
		{name: "does not exist", expression: labelSelectorMatchExpression{Key: "legacy", Operator: "DoesNotExist"}, want: true},
		{name: "unknown", expression: labelSelectorMatchExpression{Key: "app", Operator: "Unknown", Values: []string{"api"}}, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			selector := labelSelector{MatchExpressions: []labelSelectorMatchExpression{test.expression}}
			if got := labelSelectorMatches(&selector, labels); got != test.want {
				t.Fatalf("labelSelectorMatches() = %v, want %v", got, test.want)
			}
		})
	}

	empty := labelSelector{}
	if !labelSelectorMatches(&empty, labels) {
		t.Fatal("empty selector must match all labels")
	}
}

func TestLabelSelectorRejectsMalformedAndOversizedInput(t *testing.T) {
	missingKeyIn := labelSelector{MatchExpressions: []labelSelectorMatchExpression{{Key: "missing", Operator: "In", Values: []string{""}}}}
	if labelSelectorMatches(&missingKeyIn, map[string]string{}) {
		t.Fatal("In must not match a missing key even when values contains an empty string")
	}

	tests := []labelSelector{
		{MatchLabels: map[string]string{"bad key": "value"}},
		{MatchLabels: map[string]string{"app": strings.Repeat("x", 64)}},
		{MatchExpressions: []labelSelectorMatchExpression{{Key: "app", Operator: "Exists", Values: []string{"unexpected"}}}},
		{MatchExpressions: []labelSelectorMatchExpression{{Key: "app", Operator: "In"}}},
	}
	for _, selector := range tests {
		if labelSelectorMatches(&selector, map[string]string{"app": "api"}) {
			t.Fatalf("malformed selector matched: %#v", selector)
		}
		if got := labelSelectorSummary(selector); got != "invalid selector" {
			t.Fatalf("labelSelectorSummary() = %q, want safe invalid marker", got)
		}
	}

	tooManyLabels := make(map[string]string, maxLabelSelectorLabels+1)
	for index := 0; index <= maxLabelSelectorLabels; index++ {
		tooManyLabels["key-"+strings.Repeat("a", index%8)+string(rune('a'+index%26))] = "value"
	}
	selector := labelSelector{MatchLabels: tooManyLabels}
	if validLabelSelector(selector) {
		t.Fatal("oversized matchLabels selector must be rejected")
	}

	tooManyValues := make([]string, maxLabelSelectorValues+1)
	for index := range tooManyValues {
		tooManyValues[index] = "value"
	}
	selector = labelSelector{MatchExpressions: []labelSelectorMatchExpression{{Key: "app", Operator: "In", Values: tooManyValues}}}
	if validLabelSelector(selector) {
		t.Fatal("oversized expression values must be rejected")
	}

	objectLabels := make(map[string]string, maxObjectLabels+1)
	for index := 0; index <= maxObjectLabels; index++ {
		objectLabels[string(rune(0x1000+index))] = "value"
	}
	selector = labelSelector{MatchLabels: map[string]string{"app": "api"}}
	if labelSelectorMatches(&selector, objectLabels) {
		t.Fatal("oversized object labels must fail closed")
	}
}

func TestNetworkPolicySummariesBoundAndRedactInvalidInput(t *testing.T) {
	invalidCIDR := "credential.example/not-a-cidr"
	peerValues := peerSummaries([]networkPolicyPeer{{IPBlock: &networkPolicyIPBlock{CIDR: invalidCIDR}}})
	if len(peerValues) != 1 || peerValues[0] != "invalid peer" || strings.Contains(strings.Join(peerValues, " "), invalidCIDR) {
		t.Fatalf("peerSummaries() = %#v, want safe invalid marker", peerValues)
	}

	tooManyPeers := make([]networkPolicyPeer, maxNetworkPolicyPeers+1)
	if got := peerSummaries(tooManyPeers); len(got) != 1 || got[0] != "invalid peers" {
		t.Fatalf("peerSummaries() = %#v, want bounded marker", got)
	}

	invalidProtocol := "TOKEN-TRANSPORT"
	ports := networkPolicyPortSummaries([]networkPolicyPort{
		{Protocol: "TCP", Port: float64(443)},
		{Protocol: invalidProtocol, Port: float64(80)},
		{Protocol: "TCP", Port: float64(70000)},
	})
	if len(ports) != 3 || ports[0] != "TCP:443" || ports[1] != "invalid port" || ports[2] != "invalid port" {
		t.Fatalf("networkPolicyPortSummaries() = %#v", ports)
	}
	if strings.Contains(strings.Join(ports, " "), invalidProtocol) {
		t.Fatalf("invalid protocol leaked in summary: %#v", ports)
	}

	tooManyPorts := make([]networkPolicyPort, maxNetworkPolicyPorts+1)
	if got := networkPolicyPortSummaries(tooManyPorts); len(got) != 1 || got[0] != "invalid ports" {
		t.Fatalf("networkPolicyPortSummaries() = %#v, want bounded marker", got)
	}

	tooManyRules := make([]networkPolicyIngressRule, maxNetworkPolicyRules+1)
	intent := networkPolicyIntentSummary(networkPolicyResource{Spec: networkPolicySpec{PolicyTypes: []string{"Ingress"}, Ingress: tooManyRules}}, []string{"Ingress"})
	if intent.ingress != "invalid rules" || !strings.Contains(intent.ports, "invalid rules") {
		t.Fatalf("networkPolicyIntentSummary() = %#v, want bounded markers", intent)
	}
}

func TestLabelSelectorSummaryIsDeterministicAndBounded(t *testing.T) {
	selector := labelSelector{MatchLabels: map[string]string{
		"zeta":  "value",
		"beta":  "value",
		"alpha": "value",
		"delta": "value",
		"gamma": "value",
	}}
	if got := labelSelectorSummary(selector); got != "alpha, beta, delta, gamma +1" {
		t.Fatalf("labelSelectorSummary() = %q, want sorted bounded keys", got)
	}
}

func TestNetworkPolicyPeerEdgesRejectOversizedAndMalformedPeers(t *testing.T) {
	builder := newKubeGraphBuilder("test")
	policyID := builder.addNode("NetworkPolicy", "checkout", "policy", "healthy", nil, nil)
	builder.addResourceNode("Pod", metadata{Name: "api", Namespace: "checkout", Labels: map[string]string{"app": "api"}}, "healthy", nil)
	pods := podList{Items: []podResource{{Metadata: metadata{Name: "api", Namespace: "checkout", Labels: map[string]string{"app": "api"}}}}}

	tooManyPeers := make([]networkPolicyPeer, maxNetworkPolicyPeers+1)
	for index := range tooManyPeers {
		tooManyPeers[index] = networkPolicyPeer{PodSelector: &labelSelector{MatchLabels: map[string]string{"app": "api"}}}
	}
	builder.addNetworkPolicyPeerEdges(policyID, "checkout", tooManyPeers, "allows-ingress", "NetworkPolicy.spec.ingress.from", pods, nil)

	malformed := []networkPolicyPeer{{PodSelector: &labelSelector{MatchLabels: map[string]string{"bad key": "api"}}}}
	builder.addNetworkPolicyPeerEdges(policyID, "checkout", malformed, "allows-ingress", "NetworkPolicy.spec.ingress.from", pods, nil)
	if len(builder.edges) != 0 {
		t.Fatalf("invalid peers created inferred edges: %#v", builder.edges)
	}
}

func TestNetworkPolicyPeerEdgesUseFirstAcceptedUniqueTargets(t *testing.T) {
	builder := newKubeGraphBuilder("test")
	policyID := builder.addNode("NetworkPolicy", "checkout", "policy", "healthy", nil, nil)
	first := podResource{Metadata: metadata{Name: "api", Namespace: "checkout", Labels: map[string]string{"app": "worker"}}}
	duplicate := podResource{Metadata: metadata{Name: "api", Namespace: "checkout", Labels: map[string]string{"app": "api"}}}
	invalid := podResource{Metadata: metadata{Name: "bad name", Namespace: "checkout", Labels: map[string]string{"app": "api"}}}
	builder.addResourceNode("Pod", first.Metadata, "healthy", nil)

	builder.addNetworkPolicyPeerEdges(policyID, "checkout", []networkPolicyPeer{{
		PodSelector: &labelSelector{MatchLabels: map[string]string{"app": "api"}},
	}}, "allows-ingress", "NetworkPolicy.spec.ingress.from", podList{Items: []podResource{first, duplicate, invalid}}, nil)
	if len(builder.edges) != 0 {
		t.Fatalf("duplicate or invalid peer target created edges: %+v", builder.edges)
	}

	namespaces := namespaceRecords(namespaceList{Items: []namespace{
		{Metadata: metadata{Name: "checkout", Labels: map[string]string{"team": "first"}}},
		{Metadata: metadata{Name: "checkout", Labels: map[string]string{"team": "duplicate"}}},
		{Metadata: metadata{Name: "bad namespace", Labels: map[string]string{"team": "invalid"}}},
	}})
	if len(namespaces) != 1 || namespaces[0].labels["team"] != "first" {
		t.Fatalf("namespaceRecords() = %+v, want first valid unique namespace", namespaces)
	}
}
