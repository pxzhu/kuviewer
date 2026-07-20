package provider

import (
	"context"
	"sync"
	"time"

	"kuviewer/server/internal/topology"
)

type capabilityProbe struct {
	id       string
	group    string
	resource string
	required bool
	paths    []string
}

var kubernetesCapabilityProbes = []capabilityProbe{
	{id: "core/namespaces", group: "Core", resource: "Namespaces", required: true, paths: []string{"/api/v1/namespaces"}},
	{id: "core/nodes", group: "Core", resource: "Nodes", required: true, paths: []string{"/api/v1/nodes"}},
	{id: "core/pods", group: "Core", resource: "Pods", required: true, paths: []string{"/api/v1/pods"}},
	{id: "core/services", group: "Core", resource: "Services", required: true, paths: []string{"/api/v1/services"}},
	{id: "core/serviceaccounts", group: "Core", resource: "ServiceAccounts", paths: []string{"/api/v1/serviceaccounts"}},
	{id: "core/configmaps", group: "Core", resource: "ConfigMaps", paths: []string{"/api/v1/configmaps"}},
	{id: "workloads/deployments", group: "Workloads", resource: "Deployments", paths: []string{"/apis/apps/v1/deployments"}},
	{id: "workloads/replicasets", group: "Workloads", resource: "ReplicaSets", paths: []string{"/apis/apps/v1/replicasets"}},
	{id: "workloads/statefulsets", group: "Workloads", resource: "StatefulSets", paths: []string{"/apis/apps/v1/statefulsets"}},
	{id: "workloads/daemonsets", group: "Workloads", resource: "DaemonSets", paths: []string{"/apis/apps/v1/daemonsets"}},
	{id: "workloads/jobs", group: "Workloads", resource: "Jobs", paths: []string{"/apis/batch/v1/jobs"}},
	{id: "workloads/cronjobs", group: "Workloads", resource: "CronJobs", paths: []string{"/apis/batch/v1/cronjobs"}},
	{id: "workloads/hpas", group: "Workloads", resource: "HorizontalPodAutoscalers", paths: []string{"/apis/autoscaling/v2/horizontalpodautoscalers"}},
	{id: "networking/endpointslices", group: "Networking", resource: "EndpointSlices", paths: []string{"/apis/discovery.k8s.io/v1/endpointslices"}},
	{id: "networking/ingresses", group: "Networking", resource: "Ingresses", paths: []string{"/apis/networking.k8s.io/v1/ingresses"}},
	{id: "networking/networkpolicies", group: "Networking", resource: "NetworkPolicies", paths: []string{"/apis/networking.k8s.io/v1/networkpolicies"}},
	{id: "gateway/gateways", group: "Gateway API", resource: "Gateways", paths: []string{"/apis/gateway.networking.k8s.io/v1/gateways"}},
	{id: "gateway/httproutes", group: "Gateway API", resource: "HTTPRoutes", paths: []string{"/apis/gateway.networking.k8s.io/v1/httproutes"}},
	{id: "gateway/grpcroutes", group: "Gateway API", resource: "GRPCRoutes", paths: []string{"/apis/gateway.networking.k8s.io/v1/grpcroutes"}},
	{id: "gateway/tlsroutes", group: "Gateway API", resource: "TLSRoutes", paths: []string{"/apis/gateway.networking.k8s.io/v1/tlsroutes", "/apis/gateway.networking.k8s.io/v1alpha2/tlsroutes"}},
	{id: "gateway/tcproutes", group: "Gateway API", resource: "TCPRoutes", paths: []string{"/apis/gateway.networking.k8s.io/v1/tcproutes", "/apis/gateway.networking.k8s.io/v1alpha2/tcproutes"}},
	{id: "storage/pvcs", group: "Storage", resource: "PersistentVolumeClaims", paths: []string{"/api/v1/persistentvolumeclaims"}},
	{id: "storage/pvs", group: "Storage", resource: "PersistentVolumes", paths: []string{"/api/v1/persistentvolumes"}},
	{id: "storage/storageclasses", group: "Storage", resource: "StorageClasses", paths: []string{"/apis/storage.k8s.io/v1/storageclasses"}},
	{id: "extensions/crds", group: "Extensions", resource: "CustomResourceDefinitions", paths: []string{"/apis/apiextensions.k8s.io/v1/customresourcedefinitions"}},
	{id: "observability/events", group: "Observability", resource: "Events", paths: []string{"/api/v1/events"}},
}

func (p KubernetesProvider) Capabilities(ctx context.Context) (topology.CapabilityReport, error) {
	if err := ctx.Err(); err != nil {
		return topology.CapabilityReport{}, err
	}

	items := make([]topology.ResourceCapability, len(kubernetesCapabilityProbes))
	semaphore := make(chan struct{}, 6)
	var waitGroup sync.WaitGroup

	for index, probe := range kubernetesCapabilityProbes {
		waitGroup.Add(1)
		go func(index int, probe capabilityProbe) {
			defer waitGroup.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				return
			}
			status, reason := p.client.probeCapability(ctx, probe.paths)
			items[index] = topology.ResourceCapability{
				ID:       probe.id,
				Group:    probe.group,
				Resource: probe.resource,
				Required: probe.required,
				Status:   status,
				Reason:   reason,
			}
		}(index, probe)
	}
	waitGroup.Wait()
	if err := ctx.Err(); err != nil {
		return topology.CapabilityReport{}, err
	}

	items = append(items, topology.ResourceCapability{
		ID:       "policy/secret-values",
		Group:    "Security",
		Resource: "Secret values",
		Status:   "protected",
		Reason:   "secret_values_hidden",
	})
	return topology.CapabilityReport{
		Source:    "kubernetes",
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
		Items:     items,
	}, nil
}
