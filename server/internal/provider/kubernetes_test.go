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
