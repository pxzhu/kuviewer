package provider

import (
	"context"
	"time"

	"kuviewer/server/internal/topology"
)

func (MockProvider) Capabilities(context.Context) (topology.CapabilityReport, error) {
	return topology.CapabilityReport{
		Source:    "mock",
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
		Items: []topology.ResourceCapability{
			{ID: "mock/resources", Group: "Mock", Resource: "Bundled resources", Required: true, Status: "available", Reason: "read_allowed"},
			{ID: "policy/secrets", Group: "Security", Resource: "Secret values", Status: "protected", Reason: "secret_values_hidden"},
		},
	}, nil
}

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
			node("Node", "", "worker-a", "healthy", map[string]string{"zone": "a"}, mockNodeStatusSummary("8", "7800m", "32Gi", "30Gi", 110, 100, true), 600, 80),
			node("Node", "", "worker-b", "healthy", map[string]string{"zone": "b"}, mockNodeStatusSummary("8", "7600m", "32Gi", "29Gi", 110, 96, true), 600, 260),
			node("Node", "", "worker-c", "warning", map[string]string{"zone": "c"}, mockNodeStatusSummary("4", "3800m", "16Gi", "14Gi", 80, 72, false), 600, 440),
			node("StorageClass", "", "local-path", "healthy", map[string]string{"provisioner": "rancher.io/local-path"}, mockStorageClassSummary("rancher.io/local-path", "Delete", "WaitForFirstConsumer", true), 1380, 700),
			node("PersistentVolume", "", "pv-checkout-db", "healthy", map[string]string{"storage": "local"}, mockPVSummary("20Gi", "local-path", "Delete"), 1380, 820),
			node("CustomResourceDefinition", "", "widgets.platform.example.com", "healthy", map[string]string{"group": "platform.example.com"}, map[string]interface{}{"group": "platform.example.com", "kind": "Widget", "plural": "widgets", "scope": "Namespaced", "servedVersions": "v1", "storageVersion": "v1"}, 1500, 120),
			node("CustomResource", "platform", "Widget:checkout-dashboard", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"apiVersion": "platform.example.com/v1", "kind": "Widget", "name": "checkout-dashboard", "crd": "widgets.platform.example.com", "group": "platform.example.com", "scope": "Namespaced", "version": "v1", "specFields": 2, "statusFields": 1, "conditions": "Ready=True"}, 1500, 260),
			node("Deployment", "platform", "kuviewer-api", "healthy", map[string]string{"app": "kuviewer", "tier": "api"}, map[string]interface{}{"replicas": "2/2", "containers": 1, "initContainers": 1, "imageCount": 1, "images": []string{"kuviewer/api:mock"}}, 900, 120),
			node("Service", "platform", "kuviewer-api", "healthy", map[string]string{"app": "kuviewer"}, map[string]interface{}{"type": "ClusterIP", "port": 8080}, 1160, 120),
			node("Pod", "platform", "kuviewer-api-6d9c4", "healthy", map[string]string{"app": "kuviewer"}, map[string]interface{}{"phase": "Running", "ready": "1/1", "restarts": 0, "runtimeStates": []string{"running:1", "terminated:1"}, "runtimeReasonCount": 1, "runtimeReasons": []string{"terminated:Completed"}, "runtimeImageCount": 2, "runtimeImages": []string{"kuviewer/api:mock", "kuviewer/migrate:mock"}, "node": "worker-a", "containerNames": []string{"api"}, "initContainers": []string{"migrate"}}, 920, 260),
			node("ConfigMap", "platform", "kuviewer-config", "healthy", map[string]string{"app": "kuviewer"}, map[string]interface{}{"keys": 4, "dataKeys": 4, "binaryKeys": 0, "immutable": "unset"}, 1170, 260),
			node("Secret", "platform", "kuviewer-admin-token", "unknown", map[string]string{"app": "kuviewer"}, map[string]interface{}{"type": "Opaque", "keys": 1, "values": "hidden"}, 1170, 390),
			node("Ingress", "checkout", "checkout-web", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"host": "checkout.internal", "tls": true}, 860, 520),
			node("Gateway", "checkout", "checkout-gateway", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"class": "example", "listeners": 1, "hosts": "checkout.internal"}, 860, 430),
			node("HTTPRoute", "checkout", "checkout-route", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"hosts": "checkout.internal", "rules": 1, "backends": 1}, 960, 430),
			node("GRPCRoute", "checkout", "checkout-grpc", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"hosts": "grpc.checkout.internal", "rules": 1, "backends": 1, "methods": "checkout.v1.Checkout/Get"}, 960, 340),
			node("TLSRoute", "checkout", "checkout-tls", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"hosts": "tls.checkout.internal", "rules": 1, "backends": 1}, 960, 250),
			node("TCPRoute", "checkout", "checkout-tcp", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"rules": 1, "backends": 1}, 960, 160),
			node("Service", "checkout", "checkout-api", "warning", map[string]string{"app": "checkout"}, map[string]interface{}{"type": "ClusterIP", "readyEndpoints": "2/3"}, 1080, 520),
			node("Service", "checkout", "checkout-canary", "error", map[string]string{"app": "checkout-canary"}, map[string]interface{}{"type": "ClusterIP", "readyEndpoints": "0/0"}, 1280, 610),
			node("HorizontalPodAutoscaler", "checkout", "checkout-api", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"target": "Deployment/checkout-api", "replicas": "3/3", "range": "2-6"}, 860, 610),
			node("NetworkPolicy", "checkout", "checkout-api-ingress", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"policyTypes": "Ingress,Egress", "selector": "app,1 expressions", "ingress": "1 rule: pod:app,1 expressions; TCP:80", "egress": "1 rule: ns:team,1 expressions, pod:app; TCP:5432", "ports": "TCP:80, TCP:5432"}, 1280, 520),
			node("CronJob", "checkout", "checkout-reconcile", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"schedule": "*/15 * * * *", "active": 0}, 860, 780),
			node("Job", "checkout", "checkout-reconcile-286", "healthy", map[string]string{"app": "checkout"}, map[string]interface{}{"completions": 1, "succeeded": 1, "failed": 0}, 1080, 780),
			node("StatefulSet", "checkout", "checkout-db", "healthy", map[string]string{"app": "checkout-db"}, map[string]interface{}{"replicas": "1/1", "storage": "20Gi"}, 860, 690),
			node("Pod", "checkout", "checkout-api-7c8f9", "warning", map[string]string{"app": "checkout"}, map[string]interface{}{"phase": "Running", "ready": "1/2", "restarts": 4, "runtimeStates": []string{"running:1", "waiting:1"}, "runtimeReasonCount": 1, "runtimeReasons": []string{"waiting:CrashLoopBackOff"}, "runtimeImageCount": 2, "runtimeImages": []string{"checkout/api:mock", "checkout/sidecar:mock"}, "node": "worker-c", "containerNames": []string{"api", "sidecar"}}, 1080, 690),
			node("PersistentVolumeClaim", "checkout", "checkout-db-data", "healthy", map[string]string{"app": "checkout-db"}, mockPVCSummary("20Gi", "pv-checkout-db", "local-path"), 1160, 820),
		},
		Edges: []topology.Edge{
			edge("cluster-platform", nodeID("Cluster", "", "native-dev"), nodeID("Namespace", "", "platform"), "owns", "metadata.namespace"),
			edge("cluster-checkout", nodeID("Cluster", "", "native-dev"), nodeID("Namespace", "", "checkout"), "owns", "metadata.namespace"),
			edge("crd-widget", nodeID("CustomResourceDefinition", "", "widgets.platform.example.com"), nodeID("CustomResource", "platform", "Widget:checkout-dashboard"), "owns", "CustomResourceDefinition.spec.names.kind"),
			edgeWithConfidence("widget-secret", nodeID("CustomResource", "platform", "Widget:checkout-dashboard"), nodeID("Secret", "platform", "kuviewer-admin-token"), "references", "spec.secretRef", "inferred"),
			edgeWithConfidence("widget-service", nodeID("CustomResource", "platform", "Widget:checkout-dashboard"), nodeID("Service", "platform", "kuviewer-api"), "references", "spec.serviceRef", "inferred"),
			edge("platform-worker-a", nodeID("Pod", "platform", "kuviewer-api-6d9c4"), nodeID("Node", "", "worker-a"), "scheduled-on", "Pod.spec.nodeName"),
			edge("checkout-worker-c", nodeID("Pod", "checkout", "checkout-api-7c8f9"), nodeID("Node", "", "worker-c"), "scheduled-on", "Pod.spec.nodeName"),
			edge("deploy-pod", nodeID("Deployment", "platform", "kuviewer-api"), nodeID("Pod", "platform", "kuviewer-api-6d9c4"), "owns", "metadata.ownerReferences"),
			edge("service-kuviewer-pod", nodeID("Service", "platform", "kuviewer-api"), nodeID("Pod", "platform", "kuviewer-api-6d9c4"), "service-endpoint", "EndpointSlice.endpoints.targetRef"),
			edge("pod-config", nodeID("Pod", "platform", "kuviewer-api-6d9c4"), nodeID("ConfigMap", "platform", "kuviewer-config"), "env-from", "Pod.spec.containers.envFrom.configMapRef"),
			edge("pod-secret", nodeID("Pod", "platform", "kuviewer-api-6d9c4"), nodeID("Secret", "platform", "kuviewer-admin-token"), "env-from", "Pod.spec.containers.envFrom.secretRef"),
			edge("ingress-service", nodeID("Ingress", "checkout", "checkout-web"), nodeID("Service", "checkout", "checkout-api"), "routes-to", "Ingress.spec.rules.http.paths.backend.service"),
			edge("ingress-canary-service", nodeID("Ingress", "checkout", "checkout-web"), nodeID("Service", "checkout", "checkout-canary"), "routes-to", "Ingress.spec.rules.http.paths.backend.service"),
			edge("httproute-gateway", nodeID("HTTPRoute", "checkout", "checkout-route"), nodeID("Gateway", "checkout", "checkout-gateway"), "attaches-to", "HTTPRoute.spec.parentRefs"),
			edge("httproute-service", nodeID("HTTPRoute", "checkout", "checkout-route"), nodeID("Service", "checkout", "checkout-api"), "routes-to", "HTTPRoute.spec.rules.backendRefs"),
			edge("grpcroute-gateway", nodeID("GRPCRoute", "checkout", "checkout-grpc"), nodeID("Gateway", "checkout", "checkout-gateway"), "attaches-to", "GRPCRoute.spec.parentRefs"),
			edge("grpcroute-service", nodeID("GRPCRoute", "checkout", "checkout-grpc"), nodeID("Service", "checkout", "checkout-api"), "routes-to", "GRPCRoute.spec.rules.backendRefs"),
			edge("tlsroute-gateway", nodeID("TLSRoute", "checkout", "checkout-tls"), nodeID("Gateway", "checkout", "checkout-gateway"), "attaches-to", "TLSRoute.spec.parentRefs"),
			edge("tlsroute-service", nodeID("TLSRoute", "checkout", "checkout-tls"), nodeID("Service", "checkout", "checkout-api"), "routes-to", "TLSRoute.spec.rules.backendRefs"),
			edge("tcproute-gateway", nodeID("TCPRoute", "checkout", "checkout-tcp"), nodeID("Gateway", "checkout", "checkout-gateway"), "attaches-to", "TCPRoute.spec.parentRefs"),
			edge("tcproute-service", nodeID("TCPRoute", "checkout", "checkout-tcp"), nodeID("Service", "checkout", "checkout-api"), "routes-to", "TCPRoute.spec.rules.backendRefs"),
			edge("hpa-deploy", nodeID("HorizontalPodAutoscaler", "checkout", "checkout-api"), nodeID("Deployment", "checkout", "checkout-api"), "targets-scale", "HorizontalPodAutoscaler.spec.scaleTargetRef"),
			edgeWithConfidence("policy-pod", nodeID("NetworkPolicy", "checkout", "checkout-api-ingress"), nodeID("Pod", "checkout", "checkout-api-7c8f9"), "applies-to", "NetworkPolicy.spec.podSelector", "inferred"),
			edgeWithConfidence("policy-ingress-platform", nodeID("NetworkPolicy", "checkout", "checkout-api-ingress"), nodeID("Pod", "platform", "kuviewer-api-6d9c4"), "allows-ingress", "NetworkPolicy.spec.ingress.from", "inferred"),
			edgeWithConfidence("policy-egress-db", nodeID("NetworkPolicy", "checkout", "checkout-api-ingress"), nodeID("Pod", "checkout", "checkout-db-0"), "allows-egress", "NetworkPolicy.spec.egress.to", "inferred"),
			edge("cronjob-job", nodeID("CronJob", "checkout", "checkout-reconcile"), nodeID("Job", "checkout", "checkout-reconcile-286"), "owns", "metadata.ownerReferences"),
			edge("service-checkout-pod", nodeID("Service", "checkout", "checkout-api"), nodeID("Pod", "checkout", "checkout-api-7c8f9"), "service-endpoint", "EndpointSlice.endpoints.targetRef"),
			edge("stateful-pvc", nodeID("StatefulSet", "checkout", "checkout-db"), nodeID("PersistentVolumeClaim", "checkout", "checkout-db-data"), "binds-storage", "volumeClaimTemplates"),
			edge("pvc-pv", nodeID("PersistentVolumeClaim", "checkout", "checkout-db-data"), nodeID("PersistentVolume", "", "pv-checkout-db"), "binds-storage", "PersistentVolumeClaim.spec.volumeName"),
			edge("pvc-storage-class", nodeID("PersistentVolumeClaim", "checkout", "checkout-db-data"), nodeID("StorageClass", "", "local-path"), "binds-storage", "PersistentVolumeClaim.spec.storageClassName"),
			edge("pv-storage-class", nodeID("PersistentVolume", "", "pv-checkout-db"), nodeID("StorageClass", "", "local-path"), "binds-storage", "PersistentVolume.spec.storageClassName"),
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

func mockNodeStatusSummary(capacityCPU string, allocatableCPU string, capacityMemory string, allocatableMemory string, capacityPods int, allocatablePods int, ready bool) map[string]interface{} {
	conditions := "Ready=False"
	if ready {
		conditions = "Ready=True"
	}
	return map[string]interface{}{
		"capacityCpu":                 capacityCPU,
		"allocatableCpu":              allocatableCPU,
		"capacityMemory":              capacityMemory,
		"allocatableMemory":           allocatableMemory,
		"capacityPods":                capacityPods,
		"allocatablePods":             allocatablePods,
		"capacityEphemeralStorage":    "100Gi",
		"allocatableEphemeralStorage": "90Gi",
		"capacityResourceCount":       4,
		"allocatableResourceCount":    4,
		"kubeletVersion":              "v1.30.4",
		"containerRuntime":            "containerd://1.7.27",
		"operatingSystem":             "linux",
		"architecture":                "amd64",
		"conditions":                  conditions,
	}
}

func mockPVCSummary(storage string, volume string, storageClass string) map[string]interface{} {
	return map[string]interface{}{
		"phase": "Bound", "requestedStorage": storage, "capacityStorage": storage,
		"accessModes": "ReadWriteOnce", "statusAccessModes": "ReadWriteOnce", "volumeMode": "Filesystem",
		"volume": volume, "storageClass": storageClass, "requestResourceCount": 1, "capacityResourceCount": 1,
	}
}

func mockPVSummary(storage string, storageClass string, reclaimPolicy string) map[string]interface{} {
	return map[string]interface{}{
		"phase": "Bound", "storage": storage, "accessModes": "ReadWriteOnce", "volumeMode": "Filesystem",
		"reclaimPolicy": reclaimPolicy, "storageClass": storageClass, "capacityResourceCount": 1,
	}
}

func mockStorageClassSummary(provisioner string, reclaimPolicy string, volumeBindingMode string, allowVolumeExpansion bool) map[string]interface{} {
	return map[string]interface{}{
		"provisioner": provisioner, "reclaimPolicy": reclaimPolicy,
		"volumeBindingMode": volumeBindingMode, "allowVolumeExpansion": allowVolumeExpansion,
	}
}

func edge(id string, source string, target string, edgeType string, sourceField string) topology.Edge {
	return edgeWithConfidence(id, source, target, edgeType, sourceField, "observed")
}

func edgeWithConfidence(id string, source string, target string, edgeType string, sourceField string, confidence string) topology.Edge {
	return topology.Edge{
		ID:          id,
		ClusterID:   clusterID,
		Source:      source,
		Target:      target,
		Type:        edgeType,
		Confidence:  confidence,
		SourceField: sourceField,
	}
}

func nodeID(kind string, namespace string, name string) string {
	if namespace == "" {
		return clusterID + ":" + kind + ":" + name
	}

	return clusterID + ":" + namespace + ":" + kind + ":" + name
}
