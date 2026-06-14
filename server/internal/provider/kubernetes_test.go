package provider

import "testing"

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

func TestNetworkPolicyPeerEdgesInferPodsAndSkipExpressions(t *testing.T) {
	builder := newKubeGraphBuilder("test")
	policyID := builder.addNode("NetworkPolicy", "checkout", "checkout-api", "healthy", nil, nil)
	builder.addNode("Pod", "platform", "frontend", "healthy", map[string]string{"app": "frontend"}, nil)
	builder.addNode("Pod", "checkout", "db", "healthy", map[string]string{"app": "db"}, nil)

	pods := podList{Items: []podResource{
		{Metadata: metadata{Name: "frontend", Namespace: "platform", Labels: map[string]string{"app": "frontend"}}},
		{Metadata: metadata{Name: "db", Namespace: "checkout", Labels: map[string]string{"app": "db"}}},
	}}
	namespaces := []namespaceRecord{
		{name: "platform", labels: map[string]string{"team": "platform"}},
		{name: "checkout", labels: map[string]string{"team": "commerce"}},
	}

	builder.addNetworkPolicyPeerEdges(policyID, "checkout", []networkPolicyPeer{
		{
			NamespaceSelector: &labelSelector{MatchLabels: map[string]string{"team": "platform"}},
			PodSelector:       &labelSelector{MatchLabels: map[string]string{"app": "frontend"}},
		},
		{
			PodSelector: &labelSelector{
				MatchExpressions: []labelSelectorMatchExpression{{Key: "app", Operator: "In", Values: []string{"db"}}},
			},
		},
	}, "allows-ingress", "NetworkPolicy.spec.ingress.from", pods, namespaces)

	if len(builder.edges) != 1 {
		t.Fatalf("len(edges) = %d, want 1: %#v", len(builder.edges), builder.edges)
	}
	if builder.edges[0].Type != "allows-ingress" || builder.edges[0].Target != "test:platform:Pod:frontend" || builder.edges[0].Confidence != "inferred" {
		t.Fatalf("unexpected edge: %#v", builder.edges[0])
	}
}
