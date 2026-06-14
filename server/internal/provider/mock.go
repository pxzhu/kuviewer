package provider

import (
	"context"

	"kuviewer/server/internal/topology"
)

const clusterID = "local-native"

func (MockProvider) Snapshot(_ context.Context) (topology.Snapshot, error) {
	return topology.Snapshot{
		Clusters: []topology.ClusterSummary{
			{
				ID:         clusterID,
				Name:       "native-dev",
				Provider:   "Kubernetes",
				Version:    "v1.30.x",
				NodeReady:  3,
				NodeTotal:  3,
				PodRunning: 18,
				PodWarning: 2,
				Namespaces: 5,
			},
		},
		Nodes: []topology.Node{
			node("Cluster", "", "native-dev", "healthy", map[string]string{"provider": "native"}, map[string]interface{}{"version": "v1.30.x", "nodes": 3, "namespaces": 5}, 80, 260),
			node("Namespace", "", "platform", "healthy", map[string]string{"team": "platform"}, map[string]interface{}{"workloads": 4, "services": 3}, 300, 120),
			node("Namespace", "", "checkout", "warning", map[string]string{"team": "commerce"}, map[string]interface{}{"workloads": 5, "services": 5}, 300, 390),
			node("Node", "", "worker-a", "healthy", map[string]string{"zone": "a"}, map[string]interface{}{"cpu": "61%", "memory": "72%", "pods": 8}, 600, 80),
			node("Node", "", "worker-b", "healthy", map[string]string{"zone": "b"}, map[string]interface{}{"cpu": "48%", "memory": "58%", "pods": 7}, 600, 260),
			node("Node", "", "worker-c", "warning", map[string]string{"zone": "c"}, map[string]interface{}{"cpu": "82%", "memory": "86%", "pods": 5}, 600, 440),
			node("Deployment", "platform", "kuviewer-api", "healthy", map[string]string{"app": "kuviewer", "tier": "api"}, map[string]interface{}{"replicas": "2/2", "image": "kuviewer/api:mock"}, 900, 120),
			node("Service", "platform", "kuviewer-api", "healthy", map[string]string{"app": "kuviewer"}, map[string]interface{}{"type": "ClusterIP", "port": 8080}, 1160, 120),
			node("Pod", "platform", "kuviewer-api-6d9c4", "healthy", map[string]string{"app": "kuviewer"}, map[string]interface{}{"ready": true, "restarts": 0, "node": "worker-a"}, 920, 260),
			node("ConfigMap", "platform", "kuviewer-config", "healthy", map[string]string{"app": "kuviewer"}, map[string]interface{}{"keys": 4}, 1170, 260),
			node("Secret", "platform", "kuviewer-admin-token", "unknown", map[string]string{"app": "kuviewer"}, map[string]interface{}{"type": "Opaque", "keys": 1, "values": "hidden"}, 1170, 390),
			node("Ingress", "checkout", "checkout-web", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"host": "checkout.internal", "tls": true}, 860, 520),
			node("Service", "checkout", "checkout-api", "warning", map[string]string{"app": "checkout"}, map[string]interface{}{"type": "ClusterIP", "readyEndpoints": "2/3"}, 1080, 520),
			node("Service", "checkout", "checkout-canary", "error", map[string]string{"app": "checkout-canary"}, map[string]interface{}{"type": "ClusterIP", "readyEndpoints": "0/0"}, 1280, 610),
			node("HorizontalPodAutoscaler", "checkout", "checkout-api", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"target": "Deployment/checkout-api", "replicas": "3/3", "range": "2-6"}, 860, 610),
			node("NetworkPolicy", "checkout", "checkout-api-ingress", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"policyTypes": "Ingress", "selector": "app"}, 1280, 520),
			node("CronJob", "checkout", "checkout-reconcile", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"schedule": "*/15 * * * *", "active": 0}, 860, 780),
			node("Job", "checkout", "checkout-reconcile-286", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"completions": 1, "succeeded": 1, "failed": 0}, 1080, 780),
			node("StatefulSet", "checkout", "checkout-db", "healthy", map[string]string{"app": "checkout-db"}, map[string]interface{}{"replicas": "1/1", "storage": "20Gi"}, 860, 690),
			node("Pod", "checkout", "checkout-api-7c8f9", "warning", map[string]string{"app": "checkout"}, map[string]interface{}{"ready": false, "restarts": 4, "node": "worker-c"}, 1080, 690),
			node("PersistentVolumeClaim", "checkout", "checkout-db-data", "healthy", map[string]string{"app": "checkout-db"}, map[string]interface{}{"capacity": "20Gi", "mode": "ReadWriteOnce"}, 1160, 820),
		},
		Edges: []topology.Edge{
			edge("cluster-platform", nodeID("Cluster", "", "native-dev"), nodeID("Namespace", "", "platform"), "owns", "metadata.namespace"),
			edge("cluster-checkout", nodeID("Cluster", "", "native-dev"), nodeID("Namespace", "", "checkout"), "owns", "metadata.namespace"),
			edge("platform-worker-a", nodeID("Pod", "platform", "kuviewer-api-6d9c4"), nodeID("Node", "", "worker-a"), "scheduled-on", "Pod.spec.nodeName"),
			edge("checkout-worker-c", nodeID("Pod", "checkout", "checkout-api-7c8f9"), nodeID("Node", "", "worker-c"), "scheduled-on", "Pod.spec.nodeName"),
			edge("deploy-pod", nodeID("Deployment", "platform", "kuviewer-api"), nodeID("Pod", "platform", "kuviewer-api-6d9c4"), "owns", "metadata.ownerReferences"),
			edge("service-kuviewer-pod", nodeID("Service", "platform", "kuviewer-api"), nodeID("Pod", "platform", "kuviewer-api-6d9c4"), "service-endpoint", "EndpointSlice.endpoints.targetRef"),
			edge("pod-config", nodeID("Pod", "platform", "kuviewer-api-6d9c4"), nodeID("ConfigMap", "platform", "kuviewer-config"), "env-from", "Pod.spec.containers.envFrom.configMapRef"),
			edge("pod-secret", nodeID("Pod", "platform", "kuviewer-api-6d9c4"), nodeID("Secret", "platform", "kuviewer-admin-token"), "env-from", "Pod.spec.containers.envFrom.secretRef"),
			edge("ingress-service", nodeID("Ingress", "checkout", "checkout-web"), nodeID("Service", "checkout", "checkout-api"), "routes-to", "Ingress.spec.rules.http.paths.backend.service"),
			edge("ingress-canary-service", nodeID("Ingress", "checkout", "checkout-web"), nodeID("Service", "checkout", "checkout-canary"), "routes-to", "Ingress.spec.rules.http.paths.backend.service"),
			edge("hpa-deploy", nodeID("HorizontalPodAutoscaler", "checkout", "checkout-api"), nodeID("Deployment", "checkout", "checkout-api"), "targets-scale", "HorizontalPodAutoscaler.spec.scaleTargetRef"),
			edge("policy-pod", nodeID("NetworkPolicy", "checkout", "checkout-api-ingress"), nodeID("Pod", "checkout", "checkout-api-7c8f9"), "applies-to", "NetworkPolicy.spec.podSelector"),
			edge("cronjob-job", nodeID("CronJob", "checkout", "checkout-reconcile"), nodeID("Job", "checkout", "checkout-reconcile-286"), "owns", "metadata.ownerReferences"),
			edge("service-checkout-pod", nodeID("Service", "checkout", "checkout-api"), nodeID("Pod", "checkout", "checkout-api-7c8f9"), "service-endpoint", "EndpointSlice.endpoints.targetRef"),
			edge("stateful-pvc", nodeID("StatefulSet", "checkout", "checkout-db"), nodeID("PersistentVolumeClaim", "checkout", "checkout-db-data"), "binds-storage", "volumeClaimTemplates"),
		},
	}, nil
}

type MockProvider struct{}

func node(kind string, namespace string, name string, status string, labels map[string]string, summary map[string]interface{}, x int, y int) topology.Node {
	return topology.Node{
		ID:        nodeID(kind, namespace, name),
		ClusterID: clusterID,
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
		Status:    status,
		Labels:    labels,
		Summary:   summary,
		X:         x,
		Y:         y,
	}
}

func edge(id string, source string, target string, edgeType string, sourceField string) topology.Edge {
	return topology.Edge{
		ID:          id,
		ClusterID:   clusterID,
		Source:      source,
		Target:      target,
		Type:        edgeType,
		Confidence:  "observed",
		SourceField: sourceField,
	}
}

func nodeID(kind string, namespace string, name string) string {
	if namespace == "" {
		return clusterID + ":" + kind + ":" + name
	}

	return clusterID + ":" + namespace + ":" + kind + ":" + name
}
