package provider

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"

	"kuviewer/server/internal/topology"
)

const (
	podLogTailLines         = 200
	podLogMaxBytes          = 256 * 1024
	podLogMaxLineBytes      = 4096
	kubeSnapshotConcurrency = 6
)

type KubernetesProvider struct {
	client      *kubeAPIClient
	clusterID   string
	clusterName string
}

func NewKubernetesProviderFromEnv() (TopologyProvider, error) {
	config, err := kubeConfigFromEnv()
	if err != nil {
		return nil, err
	}

	return KubernetesProvider{
		client:      config.client,
		clusterID:   config.clusterID,
		clusterName: config.clusterName,
	}, nil
}

func (p KubernetesProvider) Snapshot(ctx context.Context) (topology.Snapshot, error) {
	resources := newKubernetesSnapshotResources()

	if err := getKubeListJSON(ctx, p.client, "/api/v1/namespaces", &resources.namespaces, false); err != nil {
		return topology.Snapshot{}, err
	}
	if err := getKubeListJSON(ctx, p.client, "/api/v1/nodes", &resources.nodes, false); err != nil {
		return topology.Snapshot{}, err
	}
	if err := getKubeListJSON(ctx, p.client, "/api/v1/pods", &resources.pods, false); err != nil {
		return topology.Snapshot{}, err
	}
	if err := getKubeListJSON(ctx, p.client, "/api/v1/services", &resources.services, false); err != nil {
		return topology.Snapshot{}, err
	}

	diagnostics, err := collectSnapshotFetches(ctx, kubeSnapshotConcurrency, []snapshotFetchTask{
		{id: "core/version", resource: "Kubernetes version", fetch: func() error { return p.client.getJSON(ctx, "/version", &resources.version, true) }},
		{id: "core/serviceaccounts", resource: "ServiceAccounts", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/api/v1/serviceaccounts", &resources.serviceAccounts, true)
		}},
		{id: "core/configmaps", resource: "ConfigMaps", fetch: func() error { return getKubeListJSON(ctx, p.client, "/api/v1/configmaps", &resources.configMaps, true) }},
		{id: "networking/endpointslices", resource: "EndpointSlices", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/discovery.k8s.io/v1/endpointslices", &resources.endpointSlices, true)
		}},
		{id: "workloads/deployments", resource: "Deployments", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/apps/v1/deployments", &resources.deployments, true)
		}},
		{id: "workloads/replicasets", resource: "ReplicaSets", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/apps/v1/replicasets", &resources.replicaSets, true)
		}},
		{id: "workloads/statefulsets", resource: "StatefulSets", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/apps/v1/statefulsets", &resources.statefulSets, true)
		}},
		{id: "workloads/daemonsets", resource: "DaemonSets", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/apps/v1/daemonsets", &resources.daemonSets, true)
		}},
		{id: "workloads/jobs", resource: "Jobs", fetch: func() error { return getKubeListJSON(ctx, p.client, "/apis/batch/v1/jobs", &resources.jobs, true) }},
		{id: "workloads/cronjobs", resource: "CronJobs", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/batch/v1/cronjobs", &resources.cronJobs, true)
		}},
		{id: "workloads/hpas", resource: "HorizontalPodAutoscalers", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/autoscaling/v2/horizontalpodautoscalers", &resources.hpas, true)
		}},
		{id: "networking/ingresses", resource: "Ingresses", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/networking.k8s.io/v1/ingresses", &resources.ingresses, true)
		}},
		{id: "gateway/gateways", resource: "Gateways", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/gateway.networking.k8s.io/v1/gateways", &resources.gateways, true)
		}},
		{id: "gateway/httproutes", resource: "HTTPRoutes", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/gateway.networking.k8s.io/v1/httproutes", &resources.httpRoutes, true)
		}},
		{id: "gateway/grpcroutes", resource: "GRPCRoutes", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/gateway.networking.k8s.io/v1/grpcroutes", &resources.grpcRoutes, true)
		}},
		{id: "gateway/tlsroutes", resource: "TLSRoutes", fetch: func() error { return p.client.getGatewayRouteJSON(ctx, "tlsroutes", &resources.tlsRoutes) }},
		{id: "gateway/tcproutes", resource: "TCPRoutes", fetch: func() error { return p.client.getGatewayRouteJSON(ctx, "tcproutes", &resources.tcpRoutes) }},
		{id: "networking/networkpolicies", resource: "NetworkPolicies", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/networking.k8s.io/v1/networkpolicies", &resources.networkPolicies, true)
		}},
		{id: "storage/pvcs", resource: "PersistentVolumeClaims", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/api/v1/persistentvolumeclaims", &resources.pvcs, true)
		}},
		{id: "storage/pvs", resource: "PersistentVolumes", fetch: func() error { return getKubeListJSON(ctx, p.client, "/api/v1/persistentvolumes", &resources.pvs, true) }},
		{id: "storage/storageclasses", resource: "StorageClasses", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/storage.k8s.io/v1/storageclasses", &resources.storageClasses, true)
		}},
		{id: "extensions/crds", resource: "CustomResourceDefinitions", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/apiextensions.k8s.io/v1/customresourcedefinitions", &resources.crds, true)
		}},
	})
	if err != nil {
		return topology.Snapshot{}, err
	}
	var customResourceDiagnostics []topology.SnapshotDiagnostic
	resources.customResources, customResourceDiagnostics, err = p.customResourceInstancesWithDiagnostics(ctx, resources.crds)
	if err != nil {
		return topology.Snapshot{}, err
	}
	resources.diagnostics = append(diagnostics, customResourceDiagnostics...)

	return buildKubernetesSnapshot(p.clusterID, p.clusterName, resources), nil
}

func clusterNodeID(clusterID string, clusterName string) string {
	return clusterID + ":Cluster:" + clusterName
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func limitSummary(values []string, limit int, fallback string) string {
	if len(values) == 0 {
		return fallback
	}
	if len(values) <= limit {
		return strings.Join(values, ", ")
	}
	return fmt.Sprintf("%s +%d", strings.Join(values[:limit], ", "), len(values)-limit)
}

func pluralSuffix(count int) string {
	if count == 1 {
		return ""
	}
	return "s"
}

func envOrDefault(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
