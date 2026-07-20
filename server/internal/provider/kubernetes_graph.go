package provider

import (
	"sort"

	"kuviewer/server/internal/topology"
)

type graphBuilder struct {
	clusterID          string
	layout             map[string]int
	nodeSet            map[string]bool
	resourceNodeSet    map[string]bool
	resourceIssueCount map[string]int
	edgeSet            map[string]bool
	nodes              []topology.Node
	edges              []topology.Edge
}

func newKubeGraphBuilder(clusterID string) *graphBuilder {
	return &graphBuilder{
		clusterID:          safeClusterID(clusterID),
		layout:             map[string]int{},
		nodeSet:            map[string]bool{},
		resourceNodeSet:    map[string]bool{},
		resourceIssueCount: map[string]int{},
		edgeSet:            map[string]bool{},
	}
}

func (b *graphBuilder) addNode(kind string, namespace string, name string, status string, labels map[string]string, summary map[string]interface{}) string {
	return b.addNodeWithMetadata(kind, namespace, name, status, labels, map[string]string{}, "", "", nil, summary)
}

func (b *graphBuilder) addResourceNode(kind string, meta metadata, status string, summary map[string]interface{}) string {
	id, _ := b.addTrackedResourceNode(kind, meta, status, summary)
	return id
}

func (b *graphBuilder) addTrackedResourceNode(kind string, meta metadata, status string, summary map[string]interface{}) (string, bool) {
	id := b.addNodeWithMetadata(kind, meta.Namespace, meta.Name, status, meta.Labels, meta.Annotations, meta.UID, age(meta.CreationTimestamp), ownerSummaries(meta.OwnerReferences), summary)
	if id == "" || b.resourceNodeSet[id] {
		b.recordResourceIssue(kind)
		return id, false
	}
	b.resourceNodeSet[id] = true
	return id, true
}

func (b *graphBuilder) hasResourceNode(id string) bool {
	return id != "" && b.resourceNodeSet[id]
}

func (b *graphBuilder) claimResourceNode(id string, seen map[string]bool) bool {
	if !b.hasResourceNode(id) || seen[id] {
		return false
	}
	seen[id] = true
	return true
}

func (b *graphBuilder) addNodeWithMetadata(kind string, namespace string, name string, status string, labels map[string]string, annotations map[string]string, uid string, ageValue string, owners []string, summary map[string]interface{}) string {
	if kind == "Cluster" {
		name = safeClusterName(name, b.clusterID)
	}
	if !validGraphNodeIdentity(kind, namespace, name) {
		return ""
	}
	id := b.nodeID(kind, namespace, name)
	if b.nodeSet[id] {
		return id
	}
	x, y := b.nextPosition(kind)
	b.nodes = append(b.nodes, topology.Node{
		ID:          id,
		ClusterID:   b.clusterID,
		Kind:        kind,
		Namespace:   namespace,
		Name:        name,
		Status:      safeNodeStatus(status),
		Labels:      safeMetadataLabels(labels),
		Annotations: safeMetadataAnnotations(annotations),
		Summary:     safeSummaryMap(summary),
		UID:         safeUID(uid),
		Age:         safeAgeSummary(ageValue),
		Owners:      safeOwnerSummaries(owners),
		X:           x,
		Y:           y,
	})
	b.nodeSet[id] = true
	return id
}

func (b *graphBuilder) ensureReferenceNode(kind string, namespace string, name string) string {
	summary := map[string]interface{}{"referenced": true}
	if kind == "Secret" {
		summary["values"] = "hidden"
	}
	return b.addNode(kind, namespace, name, "unknown", map[string]string{}, summary)
}

func (b *graphBuilder) addEdge(edgeType string, source string, target string, sourceField string, confidence string) string {
	if source == "" || target == "" || !b.nodeSet[source] || !b.nodeSet[target] || !validGraphEdgeMetadata(edgeType, sourceField, confidence) {
		return ""
	}
	id := source + "->" + target + ":" + edgeType + ":" + sourceField
	if b.edgeSet[id] {
		return id
	}
	b.edges = append(b.edges, topology.Edge{
		ID:          id,
		ClusterID:   b.clusterID,
		Source:      source,
		Target:      target,
		Type:        edgeType,
		Confidence:  confidence,
		SourceField: sourceField,
	})
	b.edgeSet[id] = true
	return id
}

func (b *graphBuilder) addOwnerEdge(kind string, meta metadata) {
	childID := b.nodeID(kind, meta.Namespace, meta.Name)
	for _, owner := range boundedOwnerReferences(meta.OwnerReferences) {
		if !validKubernetesKind(owner.Kind) || !validKubernetesReferenceName(owner.Name) {
			continue
		}
		ownerID := b.nodeID(owner.Kind, meta.Namespace, owner.Name)
		b.addEdge("owns", ownerID, childID, "metadata.ownerReferences", "observed")
	}
}

func (b *graphBuilder) addGatewayRouteNodes(kind string, routes gatewayRouteList) {
	for _, route := range routes.Items {
		_, added := b.addTrackedResourceNode(kind, route.Metadata, gatewayRouteStatus(kind, route), gatewayRouteSummary(kind, route))
		if added && (!validGatewayRouteSpec(kind, route) || !validGatewayRouteStatus(route)) {
			b.recordResourceIssue(kind)
		}
	}
}

func (b *graphBuilder) addGatewayRouteEdges(kind string, routes gatewayRouteList) {
	seen := map[string]bool{}
	for _, route := range routes.Items {
		routeID := b.nodeID(kind, route.Metadata.Namespace, route.Metadata.Name)
		if !b.claimResourceNode(routeID, seen) {
			continue
		}
		if !validGatewayRouteSpec(kind, route) {
			continue
		}
		for _, parentRef := range gatewayRouteParentRefs(route) {
			b.ensureReferenceNode("Gateway", parentRef.Namespace, parentRef.Name)
			b.addEdge("attaches-to", routeID, b.nodeID("Gateway", parentRef.Namespace, parentRef.Name), kind+".spec.parentRefs", "observed")
		}
		for _, backendRef := range gatewayRouteBackendRefs(route) {
			b.ensureReferenceNode("Service", backendRef.Namespace, backendRef.Name)
			b.addEdge("routes-to", routeID, b.nodeID("Service", backendRef.Namespace, backendRef.Name), kind+".spec.rules.backendRefs", "observed")
		}
	}
}

func (b *graphBuilder) addNetworkPolicyPeerEdges(networkPolicyID string, policyNamespace string, peers []networkPolicyPeer, edgeType string, sourceField string, pods podList, namespaces []namespaceRecord) {
	if len(peers) > maxNetworkPolicyPeers {
		return
	}
	for _, peer := range peers {
		if !validNetworkPolicyPeer(peer) {
			continue
		}
		if peer.IPBlock != nil && peer.PodSelector == nil && peer.NamespaceSelector == nil {
			continue
		}
		if peer.PodSelector == nil && peer.NamespaceSelector == nil {
			continue
		}

		matchingNamespaces := matchingNetworkPolicyNamespaces(namespaces, policyNamespace, peer.NamespaceSelector)
		if peer.PodSelector != nil {
			seenPods := map[string]bool{}
			for _, pod := range pods.Items {
				podID := b.nodeID("Pod", pod.Metadata.Namespace, pod.Metadata.Name)
				if !b.claimResourceNode(podID, seenPods) {
					continue
				}
				if !matchingNamespaces[pod.Metadata.Namespace] || !labelSelectorMatches(peer.PodSelector, pod.Metadata.Labels) {
					continue
				}
				b.addEdge(edgeType, networkPolicyID, podID, sourceField, "inferred")
			}
			continue
		}

		namespaceNames := make([]string, 0, len(matchingNamespaces))
		for namespace := range matchingNamespaces {
			namespaceNames = append(namespaceNames, namespace)
		}
		sort.Strings(namespaceNames)
		for _, namespace := range namespaceNames {
			namespaceID := b.nodeID("Namespace", "", namespace)
			if b.hasResourceNode(namespaceID) {
				b.addEdge(edgeType, networkPolicyID, namespaceID, sourceField, "inferred")
			}
		}
	}
}

func (b *graphBuilder) addCustomResourceReferenceEdges(resource customResourceInstance, crds customResourceDefinitionList) {
	sourceID := b.nodeID("CustomResource", resource.Metadata.Namespace, customResourceDisplayName(resource))
	for _, ref := range customResourceReferences(resource.Spec, resource.Metadata.Namespace, resource, crds) {
		b.addEdge("references", sourceID, b.nodeID(ref.kind, ref.namespace, ref.name), ref.sourceField, "inferred")
	}
}

func (b *graphBuilder) nodeID(kind string, namespace string, name string) string {
	if namespace == "" {
		return b.clusterID + ":" + kind + ":" + name
	}
	return b.clusterID + ":" + namespace + ":" + kind + ":" + name
}

func (b *graphBuilder) nextPosition(kind string) (int, int) {
	x := kubeGraphLaneX[kind]
	if x == 0 {
		x = kubeGraphLaneX["default"]
	}
	index := b.layout[kind]
	b.layout[kind]++
	return x, 80 + index*92
}

var kubeGraphLaneX = map[string]int{
	"default":                  980,
	"Cluster":                  90,
	"Namespace":                280,
	"Node":                     520,
	"Ingress":                  720,
	"Gateway":                  720,
	"HTTPRoute":                840,
	"GRPCRoute":                840,
	"TLSRoute":                 840,
	"TCPRoute":                 840,
	"Deployment":               760,
	"ReplicaSet":               900,
	"StatefulSet":              760,
	"DaemonSet":                760,
	"Job":                      900,
	"CronJob":                  760,
	"HorizontalPodAutoscaler":  720,
	"Service":                  980,
	"Pod":                      1080,
	"NetworkPolicy":            1180,
	"ServiceAccount":           1220,
	"ConfigMap":                1220,
	"Secret":                   1220,
	"PersistentVolumeClaim":    1220,
	"PersistentVolume":         1380,
	"StorageClass":             1380,
	"CustomResourceDefinition": 1540,
	"CustomResource":           1540,
}
