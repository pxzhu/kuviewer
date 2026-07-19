package provider

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"kuviewer/server/internal/topology"
)

const (
	serviceAccountTokenFile = "/var/run/secrets/kubernetes.io/serviceaccount/token"
	serviceAccountCAFile    = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
	podLogTailLines         = 200
	podLogMaxBytes          = 256 * 1024
	podLogMaxLineBytes      = 4096
	kubeJSONMaxBytes        = 16 * 1024 * 1024
	kubeListPageSize        = 500
	kubeListMaxPages        = 200
	kubeListMaxItems        = 100_000
	kubeListMaxTotalBytes   = 128 * 1024 * 1024
	kubeListMaxTokenBytes   = 4096
	kubeSnapshotConcurrency = 6
)

var (
	errKubeAPIInvalidRequest      = errors.New("kubernetes_api_request_invalid")
	errKubeAPIInvalidResponse     = errors.New("kubernetes_api_invalid_response")
	errKubeAPIReadFailed          = errors.New("kubernetes_api_read_failed")
	errKubeAPIUnavailable         = errors.New("kubernetes_api_unavailable")
	errKubeAPIResponseTooLarge    = errors.New("kubernetes_api_response_too_large")
	errKubeAPIListIncomplete      = errors.New("kubernetes_api_list_incomplete")
	errKubeAPIListTokenLoop       = errors.New("kubernetes_api_list_token_loop")
	errKubeAPIListTokenInvalid    = errors.New("kubernetes_api_list_token_invalid")
	errKubeAPIListPageLimit       = errors.New("kubernetes_api_list_page_limit")
	errKubeAPIListItemLimit       = errors.New("kubernetes_api_list_item_limit")
	errKubeAPIListTotalBytesLimit = errors.New("kubernetes_api_list_total_bytes_limit")
)

type kubeListLimits struct {
	PageSize      int
	MaxPages      int
	MaxItems      int
	MaxPageBytes  int64
	MaxTotalBytes int64
}

type KubernetesProvider struct {
	client      *kubeAPIClient
	clusterID   string
	clusterName string
}

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

func (p KubernetesProvider) Capabilities(ctx context.Context) (topology.CapabilityReport, error) {
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

func (p KubernetesProvider) Snapshot(ctx context.Context) (topology.Snapshot, error) {
	version := kubeVersion{GitVersion: "unknown"}

	namespaces := namespaceList{}
	nodes := nodeList{}
	pods := podList{}
	serviceAccounts := serviceAccountList{}
	services := serviceList{}
	endpointSlices := endpointSliceList{}
	configMaps := configMapList{}
	deployments := deploymentList{}
	replicaSets := replicaSetList{}
	statefulSets := statefulSetList{}
	daemonSets := daemonSetList{}
	jobs := jobList{}
	cronJobs := cronJobList{}
	hpas := horizontalPodAutoscalerList{}
	ingresses := ingressList{}
	gateways := gatewayList{}
	httpRoutes := gatewayRouteList{}
	grpcRoutes := gatewayRouteList{}
	tlsRoutes := gatewayRouteList{}
	tcpRoutes := gatewayRouteList{}
	networkPolicies := networkPolicyList{}
	pvcs := pvcList{}
	pvs := pvList{}
	storageClasses := storageClassList{}
	crds := customResourceDefinitionList{}

	if err := getKubeListJSON(ctx, p.client, "/api/v1/namespaces", &namespaces, false); err != nil {
		return topology.Snapshot{}, err
	}
	if err := getKubeListJSON(ctx, p.client, "/api/v1/nodes", &nodes, false); err != nil {
		return topology.Snapshot{}, err
	}
	if err := getKubeListJSON(ctx, p.client, "/api/v1/pods", &pods, false); err != nil {
		return topology.Snapshot{}, err
	}
	if err := getKubeListJSON(ctx, p.client, "/api/v1/services", &services, false); err != nil {
		return topology.Snapshot{}, err
	}

	diagnostics, err := collectSnapshotFetches(ctx, kubeSnapshotConcurrency, []snapshotFetchTask{
		{id: "core/version", resource: "Kubernetes version", fetch: func() error { return p.client.getJSON(ctx, "/version", &version, true) }},
		{id: "core/serviceaccounts", resource: "ServiceAccounts", fetch: func() error { return getKubeListJSON(ctx, p.client, "/api/v1/serviceaccounts", &serviceAccounts, true) }},
		{id: "core/configmaps", resource: "ConfigMaps", fetch: func() error { return getKubeListJSON(ctx, p.client, "/api/v1/configmaps", &configMaps, true) }},
		{id: "networking/endpointslices", resource: "EndpointSlices", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/discovery.k8s.io/v1/endpointslices", &endpointSlices, true)
		}},
		{id: "workloads/deployments", resource: "Deployments", fetch: func() error { return getKubeListJSON(ctx, p.client, "/apis/apps/v1/deployments", &deployments, true) }},
		{id: "workloads/replicasets", resource: "ReplicaSets", fetch: func() error { return getKubeListJSON(ctx, p.client, "/apis/apps/v1/replicasets", &replicaSets, true) }},
		{id: "workloads/statefulsets", resource: "StatefulSets", fetch: func() error { return getKubeListJSON(ctx, p.client, "/apis/apps/v1/statefulsets", &statefulSets, true) }},
		{id: "workloads/daemonsets", resource: "DaemonSets", fetch: func() error { return getKubeListJSON(ctx, p.client, "/apis/apps/v1/daemonsets", &daemonSets, true) }},
		{id: "workloads/jobs", resource: "Jobs", fetch: func() error { return getKubeListJSON(ctx, p.client, "/apis/batch/v1/jobs", &jobs, true) }},
		{id: "workloads/cronjobs", resource: "CronJobs", fetch: func() error { return getKubeListJSON(ctx, p.client, "/apis/batch/v1/cronjobs", &cronJobs, true) }},
		{id: "workloads/hpas", resource: "HorizontalPodAutoscalers", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/autoscaling/v2/horizontalpodautoscalers", &hpas, true)
		}},
		{id: "networking/ingresses", resource: "Ingresses", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/networking.k8s.io/v1/ingresses", &ingresses, true)
		}},
		{id: "gateway/gateways", resource: "Gateways", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/gateway.networking.k8s.io/v1/gateways", &gateways, true)
		}},
		{id: "gateway/httproutes", resource: "HTTPRoutes", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/gateway.networking.k8s.io/v1/httproutes", &httpRoutes, true)
		}},
		{id: "gateway/grpcroutes", resource: "GRPCRoutes", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/gateway.networking.k8s.io/v1/grpcroutes", &grpcRoutes, true)
		}},
		{id: "gateway/tlsroutes", resource: "TLSRoutes", fetch: func() error { return p.client.getGatewayRouteJSON(ctx, "tlsroutes", &tlsRoutes) }},
		{id: "gateway/tcproutes", resource: "TCPRoutes", fetch: func() error { return p.client.getGatewayRouteJSON(ctx, "tcproutes", &tcpRoutes) }},
		{id: "networking/networkpolicies", resource: "NetworkPolicies", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/networking.k8s.io/v1/networkpolicies", &networkPolicies, true)
		}},
		{id: "storage/pvcs", resource: "PersistentVolumeClaims", fetch: func() error { return getKubeListJSON(ctx, p.client, "/api/v1/persistentvolumeclaims", &pvcs, true) }},
		{id: "storage/pvs", resource: "PersistentVolumes", fetch: func() error { return getKubeListJSON(ctx, p.client, "/api/v1/persistentvolumes", &pvs, true) }},
		{id: "storage/storageclasses", resource: "StorageClasses", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/storage.k8s.io/v1/storageclasses", &storageClasses, true)
		}},
		{id: "extensions/crds", resource: "CustomResourceDefinitions", fetch: func() error {
			return getKubeListJSON(ctx, p.client, "/apis/apiextensions.k8s.io/v1/customresourcedefinitions", &crds, true)
		}},
	})
	if err != nil {
		return topology.Snapshot{}, err
	}
	customResources, customResourceDiagnostics, err := p.customResourceInstancesWithDiagnostics(ctx, crds)
	if err != nil {
		return topology.Snapshot{}, err
	}
	diagnostics = append(diagnostics, customResourceDiagnostics...)

	builder := newKubeGraphBuilder(p.clusterID)
	readyNodes := 0
	podRunning := 0
	podWarning := 0
	serviceEndpointCounts := endpointCounts(endpointSlices)
	mergeSelectorEndpointCounts(serviceEndpointCounts, services, pods)
	namespaceIndex := namespaceRecords(namespaces)

	for _, node := range nodes.Items {
		if nodeReady(node.Status.Conditions) {
			readyNodes++
		}
	}

	for _, pod := range pods.Items {
		if pod.Status.Phase == "Running" || pod.Status.Phase == "Succeeded" {
			podRunning++
		}
		if podStatus(pod) != "healthy" {
			podWarning++
		}
	}

	clusterSummary := topology.ClusterSummary{
		ID:         p.clusterID,
		Name:       p.clusterName,
		Provider:   "Kubernetes",
		Version:    version.GitVersion,
		NodeReady:  readyNodes,
		NodeTotal:  len(nodes.Items),
		PodRunning: podRunning,
		PodWarning: podWarning,
		Namespaces: len(namespaces.Items),
	}

	builder.addNode("Cluster", "", p.clusterName, "healthy", map[string]string{"provider": "native"}, map[string]interface{}{
		"version":    version.GitVersion,
		"nodes":      len(nodes.Items),
		"namespaces": len(namespaces.Items),
	})

	for _, namespace := range namespaces.Items {
		builder.addResourceNode("Namespace", namespace.Metadata, "healthy", map[string]interface{}{
			"age": age(namespace.Metadata.CreationTimestamp),
		})
		builder.addEdge("owns", clusterNodeID(p.clusterID, p.clusterName), builder.nodeID("Namespace", "", namespace.Metadata.Name), "metadata.namespace", "observed")
	}

	for _, node := range nodes.Items {
		builder.addResourceNode("Node", node.Metadata, nodeStatus(node), map[string]interface{}{
			"kubeletVersion": node.Status.NodeInfo.KubeletVersion,
			"cpu":            node.Status.Capacity["cpu"],
			"memory":         node.Status.Capacity["memory"],
		})
	}

	for _, deployment := range deployments.Items {
		builder.addResourceNode("Deployment", deployment.Metadata, deploymentStatus(deployment), map[string]interface{}{
			"replicas":          formatReplicas(deployment.Status.ReadyReplicas, valueOrZero(deployment.Spec.Replicas)),
			"availableReplicas": deployment.Status.AvailableReplicas,
		})
	}

	for _, replicaSet := range replicaSets.Items {
		builder.addResourceNode("ReplicaSet", replicaSet.Metadata, replicaSetStatus(replicaSet), map[string]interface{}{
			"replicas": formatReplicas(replicaSet.Status.ReadyReplicas, valueOrZero(replicaSet.Spec.Replicas)),
		})
	}

	for _, statefulSet := range statefulSets.Items {
		builder.addResourceNode("StatefulSet", statefulSet.Metadata, statefulSetStatus(statefulSet), map[string]interface{}{
			"replicas": formatReplicas(statefulSet.Status.ReadyReplicas, valueOrZero(statefulSet.Spec.Replicas)),
		})
	}

	for _, daemonSet := range daemonSets.Items {
		builder.addResourceNode("DaemonSet", daemonSet.Metadata, daemonSetStatus(daemonSet), map[string]interface{}{
			"ready": fmt.Sprintf("%d/%d", daemonSet.Status.NumberReady, daemonSet.Status.DesiredNumberScheduled),
		})
	}

	for _, job := range jobs.Items {
		builder.addResourceNode("Job", job.Metadata, jobStatus(job), map[string]interface{}{
			"completions": valueOrDefault(job.Spec.Completions, 1),
			"succeeded":   job.Status.Succeeded,
			"failed":      job.Status.Failed,
			"active":      job.Status.Active,
		})
	}

	for _, cronJob := range cronJobs.Items {
		builder.addResourceNode("CronJob", cronJob.Metadata, "healthy", map[string]interface{}{
			"schedule": cronJob.Spec.Schedule,
			"suspend":  boolSummary(cronJob.Spec.Suspend),
			"active":   len(cronJob.Status.Active),
		})
	}

	for _, hpa := range hpas.Items {
		builder.addResourceNode("HorizontalPodAutoscaler", hpa.Metadata, hpaStatus(hpa), map[string]interface{}{
			"target":   hpa.Spec.ScaleTargetRef.Kind + "/" + hpa.Spec.ScaleTargetRef.Name,
			"replicas": formatReplicas(hpa.Status.CurrentReplicas, hpa.Status.DesiredReplicas),
			"range":    fmt.Sprintf("%d-%d", valueOrDefault(hpa.Spec.MinReplicas, 1), hpa.Spec.MaxReplicas),
		})
	}

	for _, serviceAccount := range serviceAccounts.Items {
		builder.addResourceNode("ServiceAccount", serviceAccount.Metadata, "healthy", map[string]interface{}{
			"age": age(serviceAccount.Metadata.CreationTimestamp),
		})
	}

	for _, configMap := range configMaps.Items {
		builder.addResourceNode("ConfigMap", configMap.Metadata, "healthy", map[string]interface{}{
			"keys":      len(configMap.Data) + len(configMap.BinaryData),
			"immutable": boolSummary(configMap.Immutable),
		})
	}

	for _, storageClass := range storageClasses.Items {
		builder.addResourceNode("StorageClass", storageClass.Metadata, "healthy", map[string]interface{}{
			"provisioner":          storageClass.Provisioner,
			"volumeBindingMode":    storageClass.VolumeBindingMode,
			"allowVolumeExpansion": boolSummary(storageClass.AllowVolumeExpansion),
		})
	}

	for _, crd := range crds.Items {
		builder.addResourceNode("CustomResourceDefinition", crd.Metadata, crdStatus(crd), map[string]interface{}{
			"group":          crd.Spec.Group,
			"kind":           crd.Spec.Names.Kind,
			"plural":         crd.Spec.Names.Plural,
			"scope":          crd.Spec.Scope,
			"servedVersions": strings.Join(crdServedVersions(crd), ","),
			"storageVersion": crdStorageVersion(crd),
			"categories":     strings.Join(crd.Spec.Names.Categories, ","),
		})
	}

	for _, resource := range customResources {
		displayName := customResourceDisplayName(resource)
		meta := resource.Metadata
		meta.Name = displayName
		builder.addResourceNode("CustomResource", meta, customResourceStatus(resource), map[string]interface{}{
			"apiVersion":   resource.APIVersion,
			"kind":         resource.Kind,
			"name":         resource.Metadata.Name,
			"crd":          resource.CRDName,
			"group":        resource.CRDGroup,
			"scope":        resource.CRDScope,
			"version":      resource.CRDVersion,
			"specFields":   len(resource.Spec),
			"statusFields": len(resource.Status),
			"conditions":   genericConditionSummary(resource.Status),
		})
		if resource.Metadata.Namespace != "" {
			builder.addEdge("owns", builder.nodeID("Namespace", "", resource.Metadata.Namespace), builder.nodeID("CustomResource", resource.Metadata.Namespace, displayName), "metadata.namespace", "observed")
		}
		builder.addEdge("owns", builder.nodeID("CustomResourceDefinition", "", resource.CRDName), builder.nodeID("CustomResource", resource.Metadata.Namespace, displayName), "CustomResourceDefinition.spec.names.kind", "observed")
	}

	for _, pv := range pvs.Items {
		builder.addResourceNode("PersistentVolume", pv.Metadata, pvStatus(pv), map[string]interface{}{
			"phase":        pv.Status.Phase,
			"storage":      pv.Spec.Capacity["storage"],
			"storageClass": pv.Spec.StorageClassName,
		})
	}

	for _, pvc := range pvcs.Items {
		builder.addResourceNode("PersistentVolumeClaim", pvc.Metadata, pvcStatus(pvc), map[string]interface{}{
			"phase":        pvc.Status.Phase,
			"storage":      pvc.Spec.Resources.Requests["storage"],
			"volume":       pvc.Spec.VolumeName,
			"storageClass": pvc.Spec.StorageClassName,
		})
	}

	for _, service := range services.Items {
		counts := serviceEndpointCounts[serviceKey(service.Metadata.Namespace, service.Metadata.Name)]
		status := serviceStatus(service, counts)
		builder.addResourceNode("Service", service.Metadata, status, map[string]interface{}{
			"type":           service.Spec.Type,
			"clusterIP":      service.Spec.ClusterIP,
			"ports":          len(service.Spec.Ports),
			"readyEndpoints": fmt.Sprintf("%d/%d", counts.ready, counts.total),
		})
	}

	for _, ingress := range ingresses.Items {
		builder.addResourceNode("Ingress", ingress.Metadata, "healthy", map[string]interface{}{
			"hosts": strings.Join(ingressHosts(ingress), ", "),
			"rules": len(ingress.Spec.Rules),
		})
	}

	for _, gateway := range gateways.Items {
		builder.addResourceNode("Gateway", gateway.Metadata, "healthy", map[string]interface{}{
			"class":     gateway.Spec.GatewayClassName,
			"listeners": len(gateway.Spec.Listeners),
			"hosts":     strings.Join(gatewayHosts(gateway), ", "),
		})
	}

	builder.addGatewayRouteNodes("HTTPRoute", httpRoutes)
	builder.addGatewayRouteNodes("GRPCRoute", grpcRoutes)
	builder.addGatewayRouteNodes("TLSRoute", tlsRoutes)
	builder.addGatewayRouteNodes("TCPRoute", tcpRoutes)

	for _, networkPolicy := range networkPolicies.Items {
		policyTypes := networkPolicyTypes(networkPolicy)
		intent := networkPolicyIntentSummary(networkPolicy, policyTypes)
		builder.addResourceNode("NetworkPolicy", networkPolicy.Metadata, "healthy", map[string]interface{}{
			"policyTypes": strings.Join(policyTypes, ","),
			"selector":    labelSelectorSummary(networkPolicy.Spec.PodSelector),
			"ingress":     intent.ingress,
			"egress":      intent.egress,
			"ports":       intent.ports,
		})
	}

	for _, pod := range pods.Items {
		builder.addResourceNode("Pod", pod.Metadata, podStatus(pod), map[string]interface{}{
			"phase":          pod.Status.Phase,
			"ready":          formatReplicas(readyContainers(pod.Status.ContainerStatuses), len(pod.Status.ContainerStatuses)),
			"restarts":       restartCount(pod.Status.ContainerStatuses),
			"node":           pod.Spec.NodeName,
			"conditions":     conditionSummary(pod.Status.Conditions),
			"containerNames": containerNames(pod.Spec.Containers),
			"initContainers": containerNames(pod.Spec.InitContainers),
		})
	}

	for _, resource := range customResources {
		builder.addCustomResourceReferenceEdges(resource, crds)
	}

	for _, deployment := range deployments.Items {
		builder.addOwnerEdge("Deployment", deployment.Metadata)
	}
	for _, replicaSet := range replicaSets.Items {
		builder.addOwnerEdge("ReplicaSet", replicaSet.Metadata)
	}
	for _, statefulSet := range statefulSets.Items {
		builder.addOwnerEdge("StatefulSet", statefulSet.Metadata)
	}
	for _, daemonSet := range daemonSets.Items {
		builder.addOwnerEdge("DaemonSet", daemonSet.Metadata)
	}
	for _, cronJob := range cronJobs.Items {
		builder.addOwnerEdge("CronJob", cronJob.Metadata)
	}
	for _, job := range jobs.Items {
		builder.addOwnerEdge("Job", job.Metadata)
	}
	for _, pod := range pods.Items {
		builder.addOwnerEdge("Pod", pod.Metadata)
	}

	for _, pod := range pods.Items {
		podID := builder.nodeID("Pod", pod.Metadata.Namespace, pod.Metadata.Name)
		if pod.Spec.NodeName != "" {
			builder.addEdge("scheduled-on", podID, builder.nodeID("Node", "", pod.Spec.NodeName), "Pod.spec.nodeName", "observed")
		}
		if pod.Spec.ServiceAccountName != "" {
			builder.ensureReferenceNode("ServiceAccount", pod.Metadata.Namespace, pod.Spec.ServiceAccountName)
			builder.addEdge("uses-service-account", podID, builder.nodeID("ServiceAccount", pod.Metadata.Namespace, pod.Spec.ServiceAccountName), "Pod.spec.serviceAccountName", "observed")
		}

		for _, ref := range podRefs(pod) {
			builder.ensureReferenceNode(ref.kind, pod.Metadata.Namespace, ref.name)
			builder.addEdge(ref.edgeType, podID, builder.nodeID(ref.kind, pod.Metadata.Namespace, ref.name), ref.sourceField, "observed")
		}
	}

	for _, pvc := range pvcs.Items {
		pvcID := builder.nodeID("PersistentVolumeClaim", pvc.Metadata.Namespace, pvc.Metadata.Name)
		if pvc.Spec.VolumeName != "" {
			builder.addEdge("binds-storage", pvcID, builder.nodeID("PersistentVolume", "", pvc.Spec.VolumeName), "PersistentVolumeClaim.spec.volumeName", "observed")
		}
		if pvc.Spec.StorageClassName != "" {
			builder.addEdge("binds-storage", pvcID, builder.nodeID("StorageClass", "", pvc.Spec.StorageClassName), "PersistentVolumeClaim.spec.storageClassName", "observed")
		}
	}

	for _, pv := range pvs.Items {
		if pv.Spec.StorageClassName != "" {
			builder.addEdge("binds-storage", builder.nodeID("PersistentVolume", "", pv.Metadata.Name), builder.nodeID("StorageClass", "", pv.Spec.StorageClassName), "PersistentVolume.spec.storageClassName", "observed")
		}
	}

	for _, ingress := range ingresses.Items {
		ingressID := builder.nodeID("Ingress", ingress.Metadata.Namespace, ingress.Metadata.Name)
		for _, serviceName := range ingressServiceNames(ingress) {
			builder.addEdge("routes-to", ingressID, builder.nodeID("Service", ingress.Metadata.Namespace, serviceName), "Ingress.spec.rules.http.paths.backend.service", "observed")
		}
	}

	builder.addGatewayRouteEdges("HTTPRoute", httpRoutes)
	builder.addGatewayRouteEdges("GRPCRoute", grpcRoutes)
	builder.addGatewayRouteEdges("TLSRoute", tlsRoutes)
	builder.addGatewayRouteEdges("TCPRoute", tcpRoutes)

	for _, hpa := range hpas.Items {
		hpaID := builder.nodeID("HorizontalPodAutoscaler", hpa.Metadata.Namespace, hpa.Metadata.Name)
		targetKind := hpa.Spec.ScaleTargetRef.Kind
		targetName := hpa.Spec.ScaleTargetRef.Name
		if targetKind == "" || targetName == "" {
			continue
		}
		builder.ensureReferenceNode(targetKind, hpa.Metadata.Namespace, targetName)
		builder.addEdge("targets-scale", hpaID, builder.nodeID(targetKind, hpa.Metadata.Namespace, targetName), "HorizontalPodAutoscaler.spec.scaleTargetRef", "observed")
	}

	for _, networkPolicy := range networkPolicies.Items {
		networkPolicyID := builder.nodeID("NetworkPolicy", networkPolicy.Metadata.Namespace, networkPolicy.Metadata.Name)
		matches := 0
		for _, pod := range pods.Items {
			if pod.Metadata.Namespace != networkPolicy.Metadata.Namespace || !labelSelectorMatches(&networkPolicy.Spec.PodSelector, pod.Metadata.Labels) {
				continue
			}
			matches++
			builder.addEdge("applies-to", networkPolicyID, builder.nodeID("Pod", pod.Metadata.Namespace, pod.Metadata.Name), "NetworkPolicy.spec.podSelector", "inferred")
		}
		if matches == 0 && networkPolicy.Metadata.Namespace != "" {
			builder.addEdge("applies-to", networkPolicyID, builder.nodeID("Namespace", "", networkPolicy.Metadata.Namespace), "NetworkPolicy.spec.podSelector", "observed")
		}
		policyTypes := networkPolicyTypes(networkPolicy)
		if containsString(policyTypes, "Ingress") {
			for _, rule := range networkPolicy.Spec.Ingress {
				builder.addNetworkPolicyPeerEdges(networkPolicyID, networkPolicy.Metadata.Namespace, rule.From, "allows-ingress", "NetworkPolicy.spec.ingress.from", pods, namespaceIndex)
			}
		}
		if containsString(policyTypes, "Egress") {
			for _, rule := range networkPolicy.Spec.Egress {
				builder.addNetworkPolicyPeerEdges(networkPolicyID, networkPolicy.Metadata.Namespace, rule.To, "allows-egress", "NetworkPolicy.spec.egress.to", pods, namespaceIndex)
			}
		}
	}

	serviceEndpointEdges := map[string]bool{}
	for _, endpointSlice := range endpointSlices.Items {
		serviceName := endpointSlice.Metadata.Labels["kubernetes.io/service-name"]
		if serviceName == "" {
			continue
		}

		serviceID := builder.nodeID("Service", endpointSlice.Metadata.Namespace, serviceName)
		for _, endpoint := range endpointSlice.Endpoints {
			if endpoint.TargetRef == nil || endpoint.TargetRef.Kind != "Pod" || endpoint.TargetRef.Name == "" {
				continue
			}

			podID := builder.nodeID("Pod", endpointSlice.Metadata.Namespace, endpoint.TargetRef.Name)
			edgeID := builder.addEdge("service-endpoint", serviceID, podID, "EndpointSlice.endpoints.targetRef", "observed")
			serviceEndpointEdges[serviceID+"->"+podID] = edgeID != ""
		}
	}

	for _, service := range services.Items {
		if len(service.Spec.Selector) == 0 {
			continue
		}
		serviceID := builder.nodeID("Service", service.Metadata.Namespace, service.Metadata.Name)
		for _, pod := range pods.Items {
			if pod.Metadata.Namespace != service.Metadata.Namespace || !labelsMatch(service.Spec.Selector, pod.Metadata.Labels) {
				continue
			}
			podID := builder.nodeID("Pod", pod.Metadata.Namespace, pod.Metadata.Name)
			if serviceEndpointEdges[serviceID+"->"+podID] {
				continue
			}
			builder.addEdge("service-endpoint", serviceID, podID, "Service.spec.selector", "inferred")
		}
	}

	return topology.Snapshot{
		Clusters:    []topology.ClusterSummary{clusterSummary},
		Nodes:       builder.nodes,
		Edges:       builder.edges,
		Diagnostics: diagnostics,
	}, nil
}

func (p KubernetesProvider) ResourceEvents(ctx context.Context, ref ResourceRef) (topology.ResourceEvents, error) {
	events := eventList{}
	selector := url.QueryEscape("involvedObject.kind=" + ref.Kind + ",involvedObject.name=" + ref.Name)
	path := "/api/v1/events?fieldSelector=" + selector
	if ref.Namespace != "" {
		path = "/api/v1/namespaces/" + url.PathEscape(ref.Namespace) + "/events?fieldSelector=" + selector
	}
	found, err := getKubeListJSONStatus(ctx, p.client, path, &events, true)
	if err != nil {
		return topology.ResourceEvents{}, err
	}
	if !found {
		return topology.ResourceEvents{Items: []topology.ResourceEvent{}, Warning: "events_unavailable"}, nil
	}

	items := make([]topology.ResourceEvent, 0, len(events.Items))
	for _, event := range events.Items {
		items = append(items, topology.ResourceEvent{
			Type:      event.Type,
			Reason:    event.Reason,
			Message:   event.Message,
			Source:    eventSource(event),
			Timestamp: eventTimestamp(event),
		})
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].Timestamp > items[j].Timestamp
	})
	return topology.ResourceEvents{Items: items}, nil
}

func (p KubernetesProvider) ResourceLogs(ctx context.Context, ref ResourceRef) (topology.ResourceLogs, error) {
	if ref.Kind != "Pod" || ref.Namespace == "" || ref.Name == "" {
		return topology.ResourceLogs{Lines: []string{}, Warning: "logs_unavailable", TailLines: podLogTailLines}, nil
	}

	found, body, err := p.client.getTextStatus(ctx, podLogPath(ref), true, podLogMaxBytes)
	if err != nil || !found {
		return topology.ResourceLogs{Lines: []string{}, Warning: "logs_unavailable", TailLines: effectivePodLogTailLines(ref)}, nil
	}

	return topology.ResourceLogs{Lines: cappedLogLines(body), Container: ref.Container, Previous: ref.Previous, TailLines: effectivePodLogTailLines(ref)}, nil
}

func (p KubernetesProvider) StreamLogs(ctx context.Context, ref ResourceRef, onLine func(string) error) error {
	if ref.Kind != "Pod" || ref.Namespace == "" || ref.Name == "" {
		return fmt.Errorf("logs stream unavailable")
	}

	ref.Follow = true
	found, err := p.client.streamText(ctx, podLogPath(ref), true, podLogMaxBytes, func(line string) error {
		return onLine(capLogLine(line))
	})
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("logs stream unavailable")
	}
	return nil
}

func podLogPath(ref ResourceRef) string {
	return "/api/v1/namespaces/" + url.PathEscape(ref.Namespace) + "/pods/" + url.PathEscape(ref.Name) + "/log?" + podLogQuery(ref).Encode()
}

func podLogQuery(ref ResourceRef) url.Values {
	query := url.Values{}
	query.Set("tailLines", strconv.Itoa(effectivePodLogTailLines(ref)))
	if ref.Container != "" {
		query.Set("container", ref.Container)
	}
	if ref.Previous {
		query.Set("previous", "true")
	}
	if ref.Follow {
		query.Set("follow", "true")
	}
	return query
}

func effectivePodLogTailLines(ref ResourceRef) int {
	if ref.TailLines > 0 && ref.TailLines <= podLogTailLines {
		return ref.TailLines
	}
	return podLogTailLines
}

func (p KubernetesProvider) customResourceInstances(ctx context.Context, crds customResourceDefinitionList) []customResourceInstance {
	resources, _, _ := p.customResourceInstancesWithDiagnostics(ctx, crds)
	return resources
}

func (p KubernetesProvider) customResourceInstancesWithDiagnostics(ctx context.Context, crds customResourceDefinitionList) ([]customResourceInstance, []topology.SnapshotDiagnostic, error) {
	results := make([][]customResourceInstance, len(crds.Items))
	tasks := make([]snapshotFetchTask, 0, len(crds.Items))
	for index, crd := range crds.Items {
		version := crdPreferredVersion(crd)
		if crd.Spec.Group == "" || version == "" || crd.Spec.Names.Plural == "" || crd.Spec.Names.Kind == "" {
			continue
		}
		itemIndex := index
		definition := crd
		selectedVersion := version
		tasks = append(tasks, snapshotFetchTask{
			id:       "extensions/custom-resources",
			resource: "Custom resources",
			fetch: func() error {
				list := customResourceInstanceList{}
				found, err := getKubeListJSONStatus(ctx, p.client, customResourceListPath(definition, selectedVersion), &list, true)
				if err != nil || !found {
					return err
				}
				items := make([]customResourceInstance, 0, len(list.Items))
				for _, item := range list.Items {
					if item.Metadata.Name == "" {
						continue
					}
					if item.Kind == "" {
						item.Kind = definition.Spec.Names.Kind
					}
					if item.APIVersion == "" {
						item.APIVersion = definition.Spec.Group + "/" + selectedVersion
					}
					items = append(items, customResourceInstance{
						customResourceInstanceResource: item,
						CRDName:                        definition.Metadata.Name,
						CRDGroup:                       definition.Spec.Group,
						CRDVersion:                     selectedVersion,
						CRDScope:                       definition.Spec.Scope,
					})
				}
				results[itemIndex] = items
				return nil
			},
		})
	}
	diagnostics, err := collectSnapshotFetches(ctx, kubeSnapshotConcurrency, tasks)
	if err != nil {
		return nil, nil, err
	}
	resources := make([]customResourceInstance, 0)
	for _, items := range results {
		resources = append(resources, items...)
	}
	return resources, aggregateSnapshotDiagnostics(diagnostics), nil
}

func customResourceListPath(crd customResourceDefinitionResource, version string) string {
	return "/apis/" + url.PathEscape(crd.Spec.Group) + "/" + url.PathEscape(version) + "/" + url.PathEscape(crd.Spec.Names.Plural)
}

type kubeProviderConfig struct {
	client      *kubeAPIClient
	clusterID   string
	clusterName string
}

type kubeAPIClient struct {
	baseURL    string
	bearer     string
	httpClient *http.Client
}

func kubeConfigFromEnv() (kubeProviderConfig, error) {
	apiServer := os.Getenv("KUVIEWER_KUBE_API_SERVER")
	token := os.Getenv("KUVIEWER_KUBE_BEARER_TOKEN")
	tokenFile := os.Getenv("KUVIEWER_KUBE_TOKEN_FILE")
	caFile := os.Getenv("KUVIEWER_KUBE_CA_FILE")

	if apiServer == "" {
		host := os.Getenv("KUBERNETES_SERVICE_HOST")
		port := os.Getenv("KUBERNETES_SERVICE_PORT")
		if port == "" {
			port = "443"
		}
		if host == "" {
			return kubeProviderConfig{}, fmt.Errorf("KUVIEWER_SOURCE=kubernetes requires in-cluster service account or KUVIEWER_KUBE_API_SERVER")
		}

		apiServer = "https://" + net.JoinHostPort(host, port)
		if tokenFile == "" {
			tokenFile = serviceAccountTokenFile
		}
		if caFile == "" {
			caFile = serviceAccountCAFile
		}
	}

	if token == "" && tokenFile != "" {
		data, err := os.ReadFile(tokenFile)
		if err != nil {
			return kubeProviderConfig{}, fmt.Errorf("read Kubernetes token file: %w", err)
		}
		token = strings.TrimSpace(string(data))
	}
	if token == "" {
		return kubeProviderConfig{}, fmt.Errorf("Kubernetes bearer token is required")
	}

	httpClient, err := kubeHTTPClient(apiServer, caFile)
	if err != nil {
		return kubeProviderConfig{}, err
	}

	clusterID := envOrDefault("KUVIEWER_CLUSTER_ID", "in-cluster")
	clusterName := envOrDefault("KUVIEWER_CLUSTER_NAME", clusterID)

	return kubeProviderConfig{
		client: &kubeAPIClient{
			baseURL:    strings.TrimRight(apiServer, "/"),
			bearer:     token,
			httpClient: httpClient,
		},
		clusterID:   clusterID,
		clusterName: clusterName,
	}, nil
}

func kubeHTTPClient(apiServer string, caFile string) (*http.Client, error) {
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}

	if insecure, _ := strconv.ParseBool(os.Getenv("KUVIEWER_KUBE_INSECURE_SKIP_TLS_VERIFY")); insecure {
		tlsConfig.InsecureSkipVerify = true //nolint:gosec // Local development escape hatch, disabled by default.
	}

	if strings.HasPrefix(apiServer, "https://") && caFile != "" {
		if data, err := os.ReadFile(caFile); err == nil {
			pool := x509.NewCertPool()
			if pool.AppendCertsFromPEM(data) {
				tlsConfig.RootCAs = pool
			}
		} else if caFile != serviceAccountCAFile {
			return nil, fmt.Errorf("read Kubernetes CA file: %w", err)
		}
	}

	return &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: tlsConfig,
		},
	}, nil
}

func (c *kubeAPIClient) getJSON(ctx context.Context, path string, out interface{}, optional bool) error {
	_, err := c.getJSONStatus(ctx, path, out, optional)
	return err
}

func (c *kubeAPIClient) probeCapability(ctx context.Context, paths []string) (string, string) {
	bestStatus := "missing"
	bestReason := "api_not_installed"
	for _, path := range paths {
		status, reason := c.probeCapabilityPath(ctx, path)
		if status == "available" {
			return status, reason
		}
		if capabilityStatusPriority(status) > capabilityStatusPriority(bestStatus) {
			bestStatus = status
			bestReason = reason
		}
	}
	return bestStatus, bestReason
}

func (c *kubeAPIClient) probeCapabilityPath(ctx context.Context, path string) (string, string) {
	separator := "?"
	if strings.Contains(path, "?") {
		separator = "&"
	}
	request, err := c.newRequest(ctx, path+separator+"limit=1", "application/json")
	if err != nil {
		return "unavailable", "request_failed"
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		return "unavailable", "request_failed"
	}
	defer response.Body.Close()
	discardKubeAPIResponseBody(response.Body)

	switch response.StatusCode {
	case http.StatusUnauthorized:
		return "unauthorized", "authentication_failed"
	case http.StatusForbidden:
		return "forbidden", "rbac_denied"
	case http.StatusNotFound:
		return "missing", "api_not_installed"
	default:
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			return "available", "read_allowed"
		}
		return "unavailable", "request_failed"
	}
}

func capabilityStatusPriority(status string) int {
	switch status {
	case "available":
		return 4
	case "unauthorized", "forbidden":
		return 3
	case "unavailable":
		return 2
	default:
		return 1
	}
}

func (c *kubeAPIClient) getJSONStatus(ctx context.Context, path string, out interface{}, optional bool) (bool, error) {
	found, _, err := c.getJSONStatusBounded(ctx, path, out, optional, kubeJSONMaxBytes)
	return found, err
}

func (c *kubeAPIClient) getJSONStatusBounded(ctx context.Context, path string, out interface{}, optional bool, maxBytes int64) (bool, int64, error) {
	request, err := c.newRequest(ctx, path, "application/json")
	if err != nil {
		return false, 0, err
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		return false, 0, safeKubeAPITransportError(ctx)
	}
	defer response.Body.Close()

	if optional && (response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusForbidden) {
		discardKubeAPIResponseBody(response.Body)
		return false, 0, nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		discardKubeAPIResponseBody(response.Body)
		return false, 0, kubeAPIStatusError(response.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return false, 0, errKubeAPIReadFailed
	}
	if int64(len(body)) > maxBytes {
		return false, int64(len(body)), errKubeAPIResponseTooLarge
	}
	if err := json.Unmarshal(body, out); err != nil {
		return false, int64(len(body)), errKubeAPIInvalidResponse
	}
	return true, int64(len(body)), nil
}

func (c *kubeAPIClient) getTextStatus(ctx context.Context, path string, optional bool, maxBytes int64) (bool, string, error) {
	request, err := c.newRequest(ctx, path, "*/*")
	if err != nil {
		return false, "", err
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		return false, "", safeKubeAPITransportError(ctx)
	}
	defer response.Body.Close()

	if optional && (response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusForbidden || response.StatusCode == http.StatusBadRequest) {
		discardKubeAPIResponseBody(response.Body)
		return false, "", nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		discardKubeAPIResponseBody(response.Body)
		return false, "", kubeAPIStatusError(response.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return false, "", errKubeAPIReadFailed
	}
	if int64(len(body)) > maxBytes {
		body = body[:maxBytes]
	}
	return true, string(body), nil
}

func (c *kubeAPIClient) streamText(ctx context.Context, path string, optional bool, maxBytes int64, onLine func(string) error) (bool, error) {
	request, err := c.newRequest(ctx, path, "*/*")
	if err != nil {
		return false, err
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		return false, safeKubeAPITransportError(ctx)
	}
	defer response.Body.Close()

	if optional && (response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusForbidden || response.StatusCode == http.StatusBadRequest) {
		discardKubeAPIResponseBody(response.Body)
		return false, nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		discardKubeAPIResponseBody(response.Body)
		return false, kubeAPIStatusError(response.StatusCode)
	}

	scanner := bufio.NewScanner(io.LimitReader(response.Body, maxBytes+1))
	scanner.Buffer(make([]byte, 0, 64*1024), int(maxBytes)+1)
	for scanner.Scan() {
		if err := onLine(scanner.Text()); err != nil {
			return true, err
		}
	}
	if err := scanner.Err(); err != nil {
		return true, errKubeAPIReadFailed
	}
	return true, nil
}

func (c *kubeAPIClient) getGatewayRouteJSON(ctx context.Context, resource string, out *gatewayRouteList) error {
	found, err := getKubeListJSONStatus(ctx, c, "/apis/gateway.networking.k8s.io/v1/"+resource, out, true)
	if err != nil || found {
		return err
	}
	_, err = getKubeListJSONStatus(ctx, c, "/apis/gateway.networking.k8s.io/v1alpha2/"+resource, out, true)
	return err
}

func getKubeListJSON[T any](ctx context.Context, client *kubeAPIClient, path string, out *kubeList[T], optional bool) error {
	_, err := getKubeListJSONStatus(ctx, client, path, out, optional)
	return err
}

func getKubeListJSONStatus[T any](ctx context.Context, client *kubeAPIClient, path string, out *kubeList[T], optional bool) (bool, error) {
	return getKubeListJSONStatusWithLimits(ctx, client, path, out, optional, defaultKubeListLimits())
}

func defaultKubeListLimits() kubeListLimits {
	return kubeListLimits{
		PageSize:      kubeListPageSize,
		MaxPages:      kubeListMaxPages,
		MaxItems:      kubeListMaxItems,
		MaxPageBytes:  kubeJSONMaxBytes,
		MaxTotalBytes: kubeListMaxTotalBytes,
	}
}

func getKubeListJSONStatusWithLimits[T any](ctx context.Context, client *kubeAPIClient, path string, out *kubeList[T], optional bool, limits kubeListLimits) (bool, error) {
	*out = kubeList[T]{}
	if limits.PageSize < 1 || limits.MaxPages < 1 || limits.MaxItems < 1 || limits.MaxPageBytes < 1 || limits.MaxTotalBytes < 1 {
		return false, errKubeAPIInvalidRequest
	}

	items := make([]T, 0)
	seenTokens := map[string]struct{}{}
	nextToken := ""
	totalBytes := int64(0)
	for pageIndex := 0; pageIndex < limits.MaxPages; pageIndex++ {
		pagePath, err := kubeListPagePath(path, nextToken, limits.PageSize)
		if err != nil {
			return false, err
		}
		page := kubeList[T]{}
		requestOptional := optional || pageIndex > 0
		found, pageBytes, err := client.getJSONStatusBounded(ctx, pagePath, &page, requestOptional, limits.MaxPageBytes)
		if err != nil {
			return false, err
		}
		if !found {
			if pageIndex == 0 {
				return false, nil
			}
			return false, errKubeAPIListIncomplete
		}

		totalBytes += pageBytes
		if totalBytes > limits.MaxTotalBytes {
			return false, errKubeAPIListTotalBytesLimit
		}
		if len(items)+len(page.Items) > limits.MaxItems {
			return false, errKubeAPIListItemLimit
		}
		items = append(items, page.Items...)
		if page.Metadata.Continue == "" {
			out.Metadata = page.Metadata
			out.Items = items
			return true, nil
		}
		if len(page.Metadata.Continue) > kubeListMaxTokenBytes {
			return false, errKubeAPIListTokenInvalid
		}
		if _, exists := seenTokens[page.Metadata.Continue]; exists {
			return false, errKubeAPIListTokenLoop
		}
		seenTokens[page.Metadata.Continue] = struct{}{}
		nextToken = page.Metadata.Continue
	}
	return false, errKubeAPIListPageLimit
}

func kubeListPagePath(path string, continueToken string, pageSize int) (string, error) {
	parsed, err := url.Parse(path)
	if err != nil {
		return "", errKubeAPIInvalidRequest
	}
	query := parsed.Query()
	query.Set("limit", strconv.Itoa(pageSize))
	if continueToken == "" {
		query.Del("continue")
	} else {
		query.Set("continue", continueToken)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func (c *kubeAPIClient) newRequest(ctx context.Context, path string, accept string) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, errKubeAPIInvalidRequest
	}
	request.Header.Set("Authorization", "Bearer "+c.bearer)
	request.Header.Set("Accept", accept)
	return request, nil
}

func safeKubeAPITransportError(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return errKubeAPIUnavailable
}

func kubeAPIStatusError(statusCode int) error {
	return fmt.Errorf("kubernetes_api_status_%d", statusCode)
}

func discardKubeAPIResponseBody(body io.Reader) {
	_, _ = io.Copy(io.Discard, io.LimitReader(body, 4096))
}

type graphBuilder struct {
	clusterID string
	layout    map[string]int
	nodeSet   map[string]bool
	edgeSet   map[string]bool
	nodes     []topology.Node
	edges     []topology.Edge
}

func newKubeGraphBuilder(clusterID string) *graphBuilder {
	return &graphBuilder{
		clusterID: clusterID,
		layout:    map[string]int{},
		nodeSet:   map[string]bool{},
		edgeSet:   map[string]bool{},
	}
}

func (b *graphBuilder) addNode(kind string, namespace string, name string, status string, labels map[string]string, summary map[string]interface{}) string {
	return b.addNodeWithMetadata(kind, namespace, name, status, labels, map[string]string{}, "", "", nil, summary)
}

func (b *graphBuilder) addResourceNode(kind string, meta metadata, status string, summary map[string]interface{}) string {
	return b.addNodeWithMetadata(kind, meta.Namespace, meta.Name, status, meta.Labels, meta.Annotations, meta.UID, age(meta.CreationTimestamp), ownerSummaries(meta.OwnerReferences), summary)
}

func (b *graphBuilder) addNodeWithMetadata(kind string, namespace string, name string, status string, labels map[string]string, annotations map[string]string, uid string, ageValue string, owners []string, summary map[string]interface{}) string {
	id := b.nodeID(kind, namespace, name)
	if name == "" || b.nodeSet[id] {
		return id
	}
	x, y := b.nextPosition(kind)
	b.nodes = append(b.nodes, topology.Node{
		ID:          id,
		ClusterID:   b.clusterID,
		Kind:        kind,
		Namespace:   namespace,
		Name:        name,
		Status:      status,
		Labels:      labelsOrEmpty(labels),
		Annotations: safeMetadataAnnotations(annotations),
		Summary:     summaryOrEmpty(summary),
		UID:         uid,
		Age:         ageValue,
		Owners:      owners,
		X:           x,
		Y:           y,
	})
	b.nodeSet[id] = true
	return id
}

func (b *graphBuilder) ensureReferenceNode(kind string, namespace string, name string) string {
	status := "unknown"
	summary := map[string]interface{}{"referenced": true}
	if kind == "Secret" {
		summary["values"] = "hidden"
	}
	return b.addNode(kind, namespace, name, status, map[string]string{}, summary)
}

func (b *graphBuilder) addEdge(edgeType string, source string, target string, sourceField string, confidence string) string {
	if source == "" || target == "" || !b.nodeSet[source] || !b.nodeSet[target] {
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
	for _, owner := range meta.OwnerReferences {
		ownerID := b.nodeID(owner.Kind, meta.Namespace, owner.Name)
		b.addEdge("owns", ownerID, childID, "metadata.ownerReferences", "observed")
	}
}

func (b *graphBuilder) addGatewayRouteNodes(kind string, routes gatewayRouteList) {
	for _, route := range routes.Items {
		summary := map[string]interface{}{
			"rules":    len(route.Spec.Rules),
			"backends": len(gatewayRouteBackendRefs(route)),
		}
		if kind != "TCPRoute" {
			summary["hosts"] = strings.Join(route.Spec.Hostnames, ", ")
		}
		if kind == "GRPCRoute" {
			summary["methods"] = strings.Join(grpcRouteMethods(route), ", ")
		}
		builderStatus := "healthy"
		b.addResourceNode(kind, route.Metadata, builderStatus, summary)
	}
}

func (b *graphBuilder) addGatewayRouteEdges(kind string, routes gatewayRouteList) {
	for _, route := range routes.Items {
		routeID := b.nodeID(kind, route.Metadata.Namespace, route.Metadata.Name)
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
	for _, peer := range peers {
		if peer.IPBlock != nil && peer.PodSelector == nil && peer.NamespaceSelector == nil {
			continue
		}
		if peer.PodSelector == nil && peer.NamespaceSelector == nil {
			continue
		}

		matchingNamespaces := matchingNetworkPolicyNamespaces(namespaces, policyNamespace, peer.NamespaceSelector)
		if peer.PodSelector != nil {
			for _, pod := range pods.Items {
				if !matchingNamespaces[pod.Metadata.Namespace] || !labelSelectorMatches(peer.PodSelector, pod.Metadata.Labels) {
					continue
				}
				b.addEdge(edgeType, networkPolicyID, b.nodeID("Pod", pod.Metadata.Namespace, pod.Metadata.Name), sourceField, "inferred")
			}
			continue
		}

		for namespace := range matchingNamespaces {
			b.addEdge(edgeType, networkPolicyID, b.nodeID("Namespace", "", namespace), sourceField, "inferred")
		}
	}
}

type customResourceReference struct {
	kind        string
	namespace   string
	name        string
	sourceField string
}

func (b *graphBuilder) addCustomResourceReferenceEdges(resource customResourceInstance, crds customResourceDefinitionList) {
	sourceID := b.nodeID("CustomResource", resource.Metadata.Namespace, customResourceDisplayName(resource))
	for _, ref := range customResourceReferences(resource.Spec, resource.Metadata.Namespace, resource, crds) {
		b.addEdge("references", sourceID, b.nodeID(ref.kind, ref.namespace, ref.name), ref.sourceField, "inferred")
	}
}

func customResourceReferences(spec map[string]interface{}, defaultNamespace string, source customResourceInstance, crds customResourceDefinitionList) []customResourceReference {
	references := []customResourceReference{}
	collectCustomResourceReferences(spec, "spec", defaultNamespace, source, crds, &references)
	return references
}

func collectCustomResourceReferences(value interface{}, path string, defaultNamespace string, source customResourceInstance, crds customResourceDefinitionList, references *[]customResourceReference) {
	if len(*references) >= 80 || value == nil {
		return
	}
	switch typed := value.(type) {
	case []interface{}:
		for index, item := range typed {
			collectCustomResourceReferences(item, fmt.Sprintf("%s[%d]", path, index), defaultNamespace, source, crds, references)
		}
	case map[string]interface{}:
		for key, child := range typed {
			childPath := path + "." + key
			fallbackKind := customResourceReferenceKindFromKey(key)
			if isCustomResourceReferenceField(key) {
				if childObject, ok := child.(map[string]interface{}); ok {
					if ref, ok := customResourceReferenceFromObject(childObject, fallbackKind, childPath, defaultNamespace, source, crds); ok {
						*references = append(*references, ref)
					}
				}
				if childList, ok := child.([]interface{}); ok {
					for index, item := range childList {
						if childObject, ok := item.(map[string]interface{}); ok {
							if ref, ok := customResourceReferenceFromObject(childObject, fallbackKind, fmt.Sprintf("%s[%d]", childPath, index), defaultNamespace, source, crds); ok {
								*references = append(*references, ref)
							}
						}
					}
				}
			}
			if nameKind := customResourceReferenceKindFromNameKey(key); nameKind != "" {
				if name, ok := child.(string); ok && strings.TrimSpace(name) != "" {
					*references = append(*references, customResourceReference{
						kind:        nameKind,
						namespace:   targetNamespaceForKind(nameKind, stringValue(typed["namespace"], defaultNamespace), source.CRDScope),
						name:        strings.TrimSpace(name),
						sourceField: childPath,
					})
				}
			}
			collectCustomResourceReferences(child, childPath, defaultNamespace, source, crds, references)
		}
	}
}

func customResourceReferenceFromObject(value map[string]interface{}, fallbackKind string, sourceField string, defaultNamespace string, source customResourceInstance, crds customResourceDefinitionList) (customResourceReference, bool) {
	name := strings.TrimSpace(stringValue(value["name"], ""))
	if name == "" {
		return customResourceReference{}, false
	}
	apiVersion := stringValue(value["apiVersion"], "")
	kindName := stringValue(value["kind"], "")
	customDefinition, hasCustomDefinition := customResourceDefinitionForReference(apiVersion, kindName, crds)
	kind := fallbackKind
	scope := source.CRDScope
	if hasCustomDefinition {
		kind = "CustomResource"
		scope = customDefinition.Spec.Scope
		name = kindName + ":" + name
	} else if knownResourceKind(kindName) {
		kind = kindName
	}
	if kind == "" {
		return customResourceReference{}, false
	}
	return customResourceReference{
		kind:        kind,
		namespace:   targetNamespaceForKind(kind, stringValue(value["namespace"], defaultNamespace), scope),
		name:        name,
		sourceField: sourceField,
	}, true
}

func isCustomResourceReferenceField(key string) bool {
	return strings.HasSuffix(key, "Ref") || strings.HasSuffix(key, "Refs") || strings.HasSuffix(key, "Reference") || strings.HasSuffix(key, "References")
}

func customResourceReferenceKindFromKey(key string) string {
	switch strings.ToLower(key) {
	case "secretref", "secretrefs":
		return "Secret"
	case "configmapref", "configmaprefs":
		return "ConfigMap"
	case "serviceaccountref", "serviceaccountrefs":
		return "ServiceAccount"
	case "serviceref", "servicerefs", "backendref", "backendrefs":
		return "Service"
	default:
		return ""
	}
}

func customResourceReferenceKindFromNameKey(key string) string {
	switch strings.ToLower(key) {
	case "secretname":
		return "Secret"
	case "configmapname":
		return "ConfigMap"
	case "serviceaccountname":
		return "ServiceAccount"
	case "servicename":
		return "Service"
	default:
		return ""
	}
}

func customResourceDefinitionForReference(apiVersion string, kind string, crds customResourceDefinitionList) (customResourceDefinitionResource, bool) {
	group, version := apiVersionGroupVersion(apiVersion)
	if group == "" || version == "" || kind == "" {
		return customResourceDefinitionResource{}, false
	}
	for _, crd := range crds.Items {
		if crd.Spec.Group != group || crd.Spec.Names.Kind != kind {
			continue
		}
		for _, candidate := range crd.Spec.Versions {
			if candidate.Name == version && candidate.Served {
				return crd, true
			}
		}
	}
	return customResourceDefinitionResource{}, false
}

func apiVersionGroupVersion(apiVersion string) (string, string) {
	parts := strings.Split(apiVersion, "/")
	if len(parts) < 2 {
		return "", apiVersion
	}
	return strings.Join(parts[:len(parts)-1], "/"), parts[len(parts)-1]
}

func targetNamespaceForKind(kind string, namespace string, customResourceScope string) string {
	if kind == "CustomResource" && customResourceScope == "Cluster" {
		return ""
	}
	if clusterScopedKind(kind) {
		return ""
	}
	return namespace
}

func clusterScopedKind(kind string) bool {
	switch kind {
	case "Cluster", "Namespace", "Node", "PersistentVolume", "StorageClass", "CustomResourceDefinition":
		return true
	default:
		return false
	}
}

func knownResourceKind(kind string) bool {
	switch kind {
	case "Cluster", "Namespace", "Node", "Deployment", "ReplicaSet", "StatefulSet", "DaemonSet", "Job", "CronJob", "HorizontalPodAutoscaler", "Pod", "ServiceAccount", "Service", "EndpointSlice", "Ingress", "Gateway", "HTTPRoute", "GRPCRoute", "TLSRoute", "TCPRoute", "NetworkPolicy", "ConfigMap", "Secret", "PersistentVolumeClaim", "PersistentVolume", "StorageClass", "CustomResourceDefinition", "CustomResource":
		return true
	default:
		return false
	}
}

func stringValue(value interface{}, fallback string) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return fallback
}

func (b *graphBuilder) nodeID(kind string, namespace string, name string) string {
	if namespace == "" {
		return b.clusterID + ":" + kind + ":" + name
	}
	return b.clusterID + ":" + namespace + ":" + kind + ":" + name
}

func (b *graphBuilder) nextPosition(kind string) (int, int) {
	xByKind := map[string]int{
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
	x := xByKind[kind]
	if x == 0 {
		x = 980
	}
	index := b.layout[kind]
	b.layout[kind]++
	return x, 80 + index*92
}

func clusterNodeID(clusterID string, clusterName string) string {
	return clusterID + ":Cluster:" + clusterName
}

type kubeVersion struct {
	GitVersion string `json:"gitVersion"`
}

type metadata struct {
	Name              string            `json:"name"`
	Namespace         string            `json:"namespace"`
	UID               string            `json:"uid"`
	Labels            map[string]string `json:"labels"`
	Annotations       map[string]string `json:"annotations"`
	CreationTimestamp string            `json:"creationTimestamp"`
	OwnerReferences   []ownerReference  `json:"ownerReferences"`
}

type ownerReference struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
	UID  string `json:"uid"`
}

type condition struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}

type kubeListMetadata struct {
	Continue string `json:"continue"`
}

type kubeList[T any] struct {
	Metadata kubeListMetadata `json:"metadata"`
	Items    []T              `json:"items"`
}

type eventList = kubeList[eventResource]

type eventResource struct {
	Metadata           metadata `json:"metadata"`
	Type               string   `json:"type"`
	Reason             string   `json:"reason"`
	Message            string   `json:"message"`
	FirstTimestamp     string   `json:"firstTimestamp"`
	LastTimestamp      string   `json:"lastTimestamp"`
	EventTime          string   `json:"eventTime"`
	ReportingComponent string   `json:"reportingComponent"`
	Source             struct {
		Component string `json:"component"`
		Host      string `json:"host"`
	} `json:"source"`
}

type namespaceList = kubeList[namespace]

type namespace struct {
	Metadata metadata `json:"metadata"`
}

type nodeList = kubeList[nodeResource]

type nodeResource struct {
	Metadata metadata `json:"metadata"`
	Status   struct {
		Conditions []condition       `json:"conditions"`
		Capacity   map[string]string `json:"capacity"`
		NodeInfo   struct {
			KubeletVersion string `json:"kubeletVersion"`
		} `json:"nodeInfo"`
	} `json:"status"`
}

type podList = kubeList[podResource]

type podResource struct {
	Metadata metadata `json:"metadata"`
	Spec     podSpec  `json:"spec"`
	Status   podStat  `json:"status"`
}

type podSpec struct {
	NodeName           string           `json:"nodeName"`
	ServiceAccountName string           `json:"serviceAccountName"`
	Containers         []container      `json:"containers"`
	InitContainers     []container      `json:"initContainers"`
	Volumes            []volume         `json:"volumes"`
	ImagePullSecret    []localObjectRef `json:"imagePullSecrets"`
}

type serviceAccountList = kubeList[serviceAccountResource]

type serviceAccountResource struct {
	Metadata metadata `json:"metadata"`
}

type configMapList = kubeList[configMapResource]

type configMapResource struct {
	Metadata   metadata          `json:"metadata"`
	Data       map[string]string `json:"data"`
	BinaryData map[string]string `json:"binaryData"`
	Immutable  *bool             `json:"immutable"`
}

type container struct {
	Name    string    `json:"name"`
	Env     []envVar  `json:"env"`
	EnvFrom []envFrom `json:"envFrom"`
}

type envFrom struct {
	ConfigMapRef *localObjectRef `json:"configMapRef"`
	SecretRef    *localObjectRef `json:"secretRef"`
}

type envVar struct {
	ValueFrom *envVarSource `json:"valueFrom"`
}

type envVarSource struct {
	ConfigMapKeyRef *localObjectRef `json:"configMapKeyRef"`
	SecretKeyRef    *localObjectRef `json:"secretKeyRef"`
}

type volume struct {
	ConfigMap             *configMapVolumeSource             `json:"configMap"`
	Secret                *secretVolumeSource                `json:"secret"`
	PersistentVolumeClaim *persistentVolumeClaimVolumeSource `json:"persistentVolumeClaim"`
}

type configMapVolumeSource struct {
	Name string `json:"name"`
}

type secretVolumeSource struct {
	SecretName string `json:"secretName"`
}

type persistentVolumeClaimVolumeSource struct {
	ClaimName string `json:"claimName"`
}

type localObjectRef struct {
	Name string `json:"name"`
}

type podStat struct {
	Phase             string            `json:"phase"`
	Conditions        []condition       `json:"conditions"`
	ContainerStatuses []containerStatus `json:"containerStatuses"`
}

type containerStatus struct {
	Ready        bool `json:"ready"`
	RestartCount int  `json:"restartCount"`
}

type serviceList = kubeList[serviceResource]

type serviceResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Type      string            `json:"type"`
		ClusterIP string            `json:"clusterIP"`
		Selector  map[string]string `json:"selector"`
		Ports     []struct {
			Port int `json:"port"`
		} `json:"ports"`
	} `json:"spec"`
}

type endpointSliceList = kubeList[endpointSliceResource]

type endpointSliceResource struct {
	Metadata  metadata   `json:"metadata"`
	Endpoints []endpoint `json:"endpoints"`
}

type endpoint struct {
	Conditions struct {
		Ready *bool `json:"ready"`
	} `json:"conditions"`
	TargetRef *objectReference `json:"targetRef"`
}

type objectReference struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type deploymentList = kubeList[deploymentResource]

type deploymentResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Replicas *int `json:"replicas"`
	} `json:"spec"`
	Status replicaStatus `json:"status"`
}

type replicaSetList = kubeList[replicaSetResource]

type replicaSetResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Replicas *int `json:"replicas"`
	} `json:"spec"`
	Status replicaStatus `json:"status"`
}

type statefulSetList = kubeList[statefulSetResource]

type statefulSetResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Replicas *int `json:"replicas"`
	} `json:"spec"`
	Status replicaStatus `json:"status"`
}

type daemonSetList = kubeList[daemonSetResource]

type daemonSetResource struct {
	Metadata metadata `json:"metadata"`
	Status   struct {
		DesiredNumberScheduled int `json:"desiredNumberScheduled"`
		NumberReady            int `json:"numberReady"`
	} `json:"status"`
}

type replicaStatus struct {
	Replicas          int `json:"replicas"`
	ReadyReplicas     int `json:"readyReplicas"`
	AvailableReplicas int `json:"availableReplicas"`
}

type jobList = kubeList[jobResource]

type jobResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Completions *int `json:"completions"`
	} `json:"spec"`
	Status struct {
		Active    int `json:"active"`
		Succeeded int `json:"succeeded"`
		Failed    int `json:"failed"`
	} `json:"status"`
}

type cronJobList = kubeList[cronJobResource]

type cronJobResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Schedule string `json:"schedule"`
		Suspend  *bool  `json:"suspend"`
	} `json:"spec"`
	Status struct {
		Active []objectReference `json:"active"`
	} `json:"status"`
}

type horizontalPodAutoscalerList = kubeList[horizontalPodAutoscalerResource]

type horizontalPodAutoscalerResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		ScaleTargetRef objectReference `json:"scaleTargetRef"`
		MinReplicas    *int            `json:"minReplicas"`
		MaxReplicas    int             `json:"maxReplicas"`
	} `json:"spec"`
	Status struct {
		CurrentReplicas int `json:"currentReplicas"`
		DesiredReplicas int `json:"desiredReplicas"`
	} `json:"status"`
}

type ingressList = kubeList[ingressResource]

type ingressResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		DefaultBackend *ingressBackend `json:"defaultBackend"`
		Rules          []ingressRule   `json:"rules"`
	} `json:"spec"`
}

type ingressRule struct {
	Host string `json:"host"`
	HTTP *struct {
		Paths []struct {
			Backend ingressBackend `json:"backend"`
		} `json:"paths"`
	} `json:"http"`
}

type ingressBackend struct {
	Service *struct {
		Name string `json:"name"`
	} `json:"service"`
}

type gatewayList = kubeList[gatewayResource]

type gatewayResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		GatewayClassName string `json:"gatewayClassName"`
		Listeners        []struct {
			Name     string `json:"name"`
			Protocol string `json:"protocol"`
			Port     int    `json:"port"`
			Hostname string `json:"hostname"`
		} `json:"listeners"`
	} `json:"spec"`
}

type gatewayRouteList = kubeList[gatewayRouteResource]

type gatewayRouteResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Hostnames  []string           `json:"hostnames"`
		ParentRefs []gatewayReference `json:"parentRefs"`
		Rules      []gatewayRouteRule `json:"rules"`
	} `json:"spec"`
}

type gatewayReference struct {
	Group     string `json:"group"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

type gatewayRouteRule struct {
	BackendRefs []gatewayReference `json:"backendRefs"`
	Matches     []struct {
		Method struct {
			Service string `json:"service"`
			Method  string `json:"method"`
		} `json:"method"`
	} `json:"matches"`
}

type pvcList = kubeList[pvcResource]

type pvcResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Resources struct {
			Requests map[string]string `json:"requests"`
		} `json:"resources"`
		VolumeName       string `json:"volumeName"`
		StorageClassName string `json:"storageClassName"`
	} `json:"spec"`
	Status struct {
		Phase string `json:"phase"`
	} `json:"status"`
}

type pvList = kubeList[pvResource]

type pvResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Capacity         map[string]string `json:"capacity"`
		StorageClassName string            `json:"storageClassName"`
	} `json:"spec"`
	Status struct {
		Phase string `json:"phase"`
	} `json:"status"`
}

type storageClassList = kubeList[storageClassResource]

type storageClassResource struct {
	Metadata             metadata `json:"metadata"`
	Provisioner          string   `json:"provisioner"`
	VolumeBindingMode    string   `json:"volumeBindingMode"`
	AllowVolumeExpansion *bool    `json:"allowVolumeExpansion"`
}

type customResourceDefinitionList = kubeList[customResourceDefinitionResource]

type customResourceDefinitionResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Group string `json:"group"`
		Names struct {
			Kind       string   `json:"kind"`
			Plural     string   `json:"plural"`
			Singular   string   `json:"singular"`
			Categories []string `json:"categories"`
			ShortNames []string `json:"shortNames"`
		} `json:"names"`
		Scope    string `json:"scope"`
		Versions []struct {
			Name    string `json:"name"`
			Served  bool   `json:"served"`
			Storage bool   `json:"storage"`
		} `json:"versions"`
	} `json:"spec"`
	Status struct {
		Conditions []condition `json:"conditions"`
	} `json:"status"`
}

type customResourceInstanceList = kubeList[customResourceInstanceResource]

type customResourceInstanceResource struct {
	APIVersion string                 `json:"apiVersion"`
	Kind       string                 `json:"kind"`
	Metadata   metadata               `json:"metadata"`
	Spec       map[string]interface{} `json:"spec"`
	Status     map[string]interface{} `json:"status"`
}

type customResourceInstance struct {
	customResourceInstanceResource
	CRDName    string
	CRDGroup   string
	CRDVersion string
	CRDScope   string
}

type networkPolicyList = kubeList[networkPolicyResource]

type networkPolicyResource struct {
	Metadata metadata          `json:"metadata"`
	Spec     networkPolicySpec `json:"spec"`
}

type networkPolicySpec struct {
	PodSelector labelSelector              `json:"podSelector"`
	PolicyTypes []string                   `json:"policyTypes"`
	Ingress     []networkPolicyIngressRule `json:"ingress"`
	Egress      []networkPolicyEgressRule  `json:"egress"`
}

type networkPolicyIngressRule struct {
	From  []networkPolicyPeer `json:"from"`
	Ports []networkPolicyPort `json:"ports"`
}

type networkPolicyEgressRule struct {
	To    []networkPolicyPeer `json:"to"`
	Ports []networkPolicyPort `json:"ports"`
}

type networkPolicyPeer struct {
	PodSelector       *labelSelector        `json:"podSelector"`
	NamespaceSelector *labelSelector        `json:"namespaceSelector"`
	IPBlock           *networkPolicyIPBlock `json:"ipBlock"`
}

type networkPolicyIPBlock struct {
	CIDR   string   `json:"cidr"`
	Except []string `json:"except"`
}

type networkPolicyPort struct {
	Protocol string      `json:"protocol"`
	Port     interface{} `json:"port"`
	EndPort  *int        `json:"endPort"`
}

type labelSelector struct {
	MatchLabels      map[string]string              `json:"matchLabels"`
	MatchExpressions []labelSelectorMatchExpression `json:"matchExpressions"`
}

type labelSelectorMatchExpression struct {
	Key      string   `json:"key"`
	Operator string   `json:"operator"`
	Values   []string `json:"values"`
}

type namespaceRecord struct {
	name   string
	labels map[string]string
}

type endpointCounter struct {
	ready int
	total int
}

type podReference struct {
	kind        string
	name        string
	edgeType    string
	sourceField string
}

func endpointCounts(endpointSlices endpointSliceList) map[string]endpointCounter {
	counts := map[string]endpointCounter{}
	for _, slice := range endpointSlices.Items {
		serviceName := slice.Metadata.Labels["kubernetes.io/service-name"]
		if serviceName == "" {
			continue
		}
		key := serviceKey(slice.Metadata.Namespace, serviceName)
		counter := counts[key]
		for _, endpoint := range slice.Endpoints {
			counter.total++
			if endpoint.Conditions.Ready == nil || *endpoint.Conditions.Ready {
				counter.ready++
			}
		}
		counts[key] = counter
	}
	return counts
}

func mergeSelectorEndpointCounts(counts map[string]endpointCounter, services serviceList, pods podList) {
	for _, service := range services.Items {
		key := serviceKey(service.Metadata.Namespace, service.Metadata.Name)
		if counts[key].total > 0 || len(service.Spec.Selector) == 0 {
			continue
		}

		counter := endpointCounter{}
		for _, pod := range pods.Items {
			if pod.Metadata.Namespace != service.Metadata.Namespace || !labelsMatch(service.Spec.Selector, pod.Metadata.Labels) {
				continue
			}
			counter.total++
			if podStatus(pod) == "healthy" {
				counter.ready++
			}
		}
		if counter.total > 0 {
			counts[key] = counter
		}
	}
}

func serviceKey(namespace string, name string) string {
	return namespace + "/" + name
}

func nodeStatus(node nodeResource) string {
	if nodeReady(node.Status.Conditions) {
		return "healthy"
	}
	return "warning"
}

func nodeReady(conditions []condition) bool {
	for _, condition := range conditions {
		if condition.Type == "Ready" {
			return condition.Status == "True"
		}
	}
	return false
}

func podStatus(pod podResource) string {
	if pod.Status.Phase == "Failed" {
		return "error"
	}
	if pod.Status.Phase == "Succeeded" {
		return "healthy"
	}
	if pod.Status.Phase != "Running" || readyContainers(pod.Status.ContainerStatuses) != len(pod.Status.ContainerStatuses) {
		return "warning"
	}
	return "healthy"
}

func conditionSummary(conditions []condition) string {
	if len(conditions) == 0 {
		return ""
	}
	values := make([]string, 0, len(conditions))
	for _, condition := range conditions {
		if condition.Type == "" {
			continue
		}
		values = append(values, condition.Type+"="+condition.Status)
	}
	sort.Strings(values)
	return strings.Join(values, ", ")
}

func crdStatus(crd customResourceDefinitionResource) string {
	if len(crd.Status.Conditions) == 0 {
		return "unknown"
	}
	for _, condition := range crd.Status.Conditions {
		if condition.Type != "Established" {
			continue
		}
		if condition.Status == "True" {
			return "healthy"
		}
		return "warning"
	}
	return "unknown"
}

func crdServedVersions(crd customResourceDefinitionResource) []string {
	versions := []string{}
	for _, version := range crd.Spec.Versions {
		if version.Served {
			versions = append(versions, version.Name)
		}
	}
	sort.Strings(versions)
	return versions
}

func crdStorageVersion(crd customResourceDefinitionResource) string {
	for _, version := range crd.Spec.Versions {
		if version.Storage {
			return version.Name
		}
	}
	return ""
}

func crdPreferredVersion(crd customResourceDefinitionResource) string {
	if version := crdStorageVersion(crd); version != "" {
		return version
	}
	served := crdServedVersions(crd)
	if len(served) > 0 {
		return served[0]
	}
	return ""
}

func customResourceDisplayName(resource customResourceInstance) string {
	kind := resource.Kind
	if kind == "" {
		kind = "CustomResource"
	}
	return kind + ":" + resource.Metadata.Name
}

func customResourceStatus(resource customResourceInstance) string {
	conditions := genericConditions(resource.Status)
	if len(conditions) == 0 {
		return "unknown"
	}
	for _, condition := range conditions {
		if (condition.Type == "Ready" || condition.Type == "Synced" || condition.Type == "Reconciled") && condition.Status == "True" {
			return "healthy"
		}
	}
	for _, condition := range conditions {
		if (condition.Type == "Ready" || condition.Type == "Synced" || condition.Type == "Reconciled") && condition.Status == "False" {
			return "warning"
		}
	}
	return "unknown"
}

func genericConditionSummary(status map[string]interface{}) string {
	conditions := genericConditions(status)
	if len(conditions) == 0 {
		return ""
	}
	values := make([]string, 0, len(conditions))
	for _, condition := range conditions {
		if condition.Type == "" {
			continue
		}
		values = append(values, condition.Type+"="+condition.Status)
	}
	sort.Strings(values)
	return strings.Join(values, ", ")
}

func genericConditions(status map[string]interface{}) []condition {
	rawConditions, ok := status["conditions"].([]interface{})
	if !ok {
		return nil
	}
	conditions := []condition{}
	for _, rawCondition := range rawConditions {
		conditionMap, ok := rawCondition.(map[string]interface{})
		if !ok {
			continue
		}
		conditionType, _ := conditionMap["type"].(string)
		conditionStatus, _ := conditionMap["status"].(string)
		if conditionType == "" {
			continue
		}
		conditions = append(conditions, condition{Type: conditionType, Status: conditionStatus})
	}
	return conditions
}

func cappedLogLines(body string) []string {
	trimmed := strings.TrimSuffix(body, "\n")
	if trimmed == "" {
		return []string{}
	}
	lines := strings.Split(trimmed, "\n")
	if len(lines) > podLogTailLines {
		lines = lines[len(lines)-podLogTailLines:]
	}
	for index, line := range lines {
		lines[index] = capLogLine(line)
	}
	return lines
}

func capLogLine(line string) string {
	if len(line) > podLogMaxLineBytes {
		return line[:podLogMaxLineBytes] + "..."
	}
	return line
}

func deploymentStatus(deployment deploymentResource) string {
	if deployment.Status.AvailableReplicas >= valueOrZero(deployment.Spec.Replicas) {
		return "healthy"
	}
	return "warning"
}

func replicaSetStatus(replicaSet replicaSetResource) string {
	if replicaSet.Status.ReadyReplicas >= valueOrZero(replicaSet.Spec.Replicas) {
		return "healthy"
	}
	return "warning"
}

func statefulSetStatus(statefulSet statefulSetResource) string {
	if statefulSet.Status.ReadyReplicas >= valueOrZero(statefulSet.Spec.Replicas) {
		return "healthy"
	}
	return "warning"
}

func daemonSetStatus(daemonSet daemonSetResource) string {
	if daemonSet.Status.NumberReady >= daemonSet.Status.DesiredNumberScheduled {
		return "healthy"
	}
	return "warning"
}

func jobStatus(job jobResource) string {
	if job.Status.Failed > 0 {
		return "error"
	}
	if job.Status.Succeeded >= valueOrDefault(job.Spec.Completions, 1) {
		return "healthy"
	}
	return "warning"
}

func hpaStatus(hpa horizontalPodAutoscalerResource) string {
	if hpa.Status.DesiredReplicas == 0 || hpa.Status.CurrentReplicas >= hpa.Status.DesiredReplicas {
		return "healthy"
	}
	return "warning"
}

func pvcStatus(pvc pvcResource) string {
	if pvc.Status.Phase == "Bound" {
		return "healthy"
	}
	if pvc.Status.Phase == "Lost" {
		return "error"
	}
	return "warning"
}

func pvStatus(pv pvResource) string {
	if pv.Status.Phase == "Bound" || pv.Status.Phase == "Available" {
		return "healthy"
	}
	if pv.Status.Phase == "Failed" {
		return "error"
	}
	return "warning"
}

func serviceStatus(service serviceResource, counts endpointCounter) string {
	if len(service.Spec.Selector) == 0 {
		return "unknown"
	}
	if counts.total == 0 || counts.ready < counts.total {
		return "warning"
	}
	return "healthy"
}

func podRefs(pod podResource) []podReference {
	refs := []podReference{}
	add := func(kind string, name string, edgeType string, sourceField string) {
		if name == "" {
			return
		}
		refs = append(refs, podReference{kind: kind, name: name, edgeType: edgeType, sourceField: sourceField})
	}

	for _, imagePullSecret := range pod.Spec.ImagePullSecret {
		add("Secret", imagePullSecret.Name, "env-from", "Pod.spec.imagePullSecrets")
	}
	for _, volume := range pod.Spec.Volumes {
		if volume.ConfigMap != nil {
			add("ConfigMap", volume.ConfigMap.Name, "mounts", "Pod.spec.volumes.configMap")
		}
		if volume.Secret != nil {
			add("Secret", volume.Secret.SecretName, "mounts", "Pod.spec.volumes.secret")
		}
		if volume.PersistentVolumeClaim != nil {
			add("PersistentVolumeClaim", volume.PersistentVolumeClaim.ClaimName, "mounts", "Pod.spec.volumes.persistentVolumeClaim")
		}
	}

	containers := append([]container{}, pod.Spec.InitContainers...)
	containers = append(containers, pod.Spec.Containers...)
	for _, container := range containers {
		for _, envFrom := range container.EnvFrom {
			if envFrom.ConfigMapRef != nil {
				add("ConfigMap", envFrom.ConfigMapRef.Name, "env-from", "Pod.spec.containers.envFrom.configMapRef")
			}
			if envFrom.SecretRef != nil {
				add("Secret", envFrom.SecretRef.Name, "env-from", "Pod.spec.containers.envFrom.secretRef")
			}
		}
		for _, env := range container.Env {
			if env.ValueFrom == nil {
				continue
			}
			if env.ValueFrom.ConfigMapKeyRef != nil {
				add("ConfigMap", env.ValueFrom.ConfigMapKeyRef.Name, "env-from", "Pod.spec.containers.env.valueFrom.configMapKeyRef")
			}
			if env.ValueFrom.SecretKeyRef != nil {
				add("Secret", env.ValueFrom.SecretKeyRef.Name, "env-from", "Pod.spec.containers.env.valueFrom.secretKeyRef")
			}
		}
	}

	sort.SliceStable(refs, func(i, j int) bool {
		if refs[i].kind == refs[j].kind {
			return refs[i].name < refs[j].name
		}
		return refs[i].kind < refs[j].kind
	})
	return refs
}

func ingressServiceNames(ingress ingressResource) []string {
	names := []string{}
	if ingress.Spec.DefaultBackend != nil && ingress.Spec.DefaultBackend.Service != nil {
		names = append(names, ingress.Spec.DefaultBackend.Service.Name)
	}
	for _, rule := range ingress.Spec.Rules {
		if rule.HTTP == nil {
			continue
		}
		for _, path := range rule.HTTP.Paths {
			if path.Backend.Service != nil {
				names = append(names, path.Backend.Service.Name)
			}
		}
	}
	return uniqueStrings(names)
}

func ingressHosts(ingress ingressResource) []string {
	hosts := []string{}
	for _, rule := range ingress.Spec.Rules {
		if rule.Host != "" {
			hosts = append(hosts, rule.Host)
		}
	}
	return uniqueStrings(hosts)
}

func gatewayHosts(gateway gatewayResource) []string {
	hosts := []string{}
	for _, listener := range gateway.Spec.Listeners {
		if listener.Hostname != "" {
			hosts = append(hosts, listener.Hostname)
		}
	}
	return uniqueStrings(hosts)
}

func gatewayRouteParentRefs(route gatewayRouteResource) []gatewayReference {
	refs := []gatewayReference{}
	for _, ref := range route.Spec.ParentRefs {
		if ref.Name == "" {
			continue
		}
		if ref.Kind != "" && ref.Kind != "Gateway" {
			continue
		}
		if ref.Group != "" && ref.Group != "gateway.networking.k8s.io" {
			continue
		}
		if ref.Namespace == "" {
			ref.Namespace = route.Metadata.Namespace
		}
		refs = append(refs, ref)
	}
	return uniqueGatewayReferences(refs)
}

func gatewayRouteBackendRefs(route gatewayRouteResource) []gatewayReference {
	refs := []gatewayReference{}
	for _, rule := range route.Spec.Rules {
		for _, ref := range rule.BackendRefs {
			if ref.Name == "" {
				continue
			}
			if ref.Kind != "" && ref.Kind != "Service" {
				continue
			}
			if ref.Group != "" {
				continue
			}
			if ref.Namespace == "" {
				ref.Namespace = route.Metadata.Namespace
			}
			refs = append(refs, ref)
		}
	}
	return uniqueGatewayReferences(refs)
}

func grpcRouteMethods(route gatewayRouteResource) []string {
	methods := []string{}
	for _, rule := range route.Spec.Rules {
		for _, match := range rule.Matches {
			service := match.Method.Service
			method := match.Method.Method
			if service != "" && method != "" {
				methods = append(methods, service+"/"+method)
				continue
			}
			if service != "" {
				methods = append(methods, service)
			}
			if method != "" {
				methods = append(methods, method)
			}
		}
	}
	return uniqueStrings(methods)
}

func labelsMatch(selector map[string]string, labels map[string]string) bool {
	for key, value := range selector {
		if labels[key] != value {
			return false
		}
	}
	return len(selector) > 0
}

func selectorMatchesLabels(selector map[string]string, labels map[string]string) bool {
	for key, value := range selector {
		if labels[key] != value {
			return false
		}
	}
	return true
}

func labelSelectorMatches(selector *labelSelector, labels map[string]string) bool {
	if selector == nil {
		return true
	}
	if !selectorMatchesLabels(selector.MatchLabels, labels) {
		return false
	}
	for _, expression := range selector.MatchExpressions {
		if !labelSelectorExpressionMatches(expression, labels) {
			return false
		}
	}
	return true
}

func labelSelectorExpressionMatches(expression labelSelectorMatchExpression, labels map[string]string) bool {
	if expression.Key == "" {
		return false
	}
	_, exists := labels[expression.Key]
	switch expression.Operator {
	case "In":
		return len(expression.Values) > 0 && containsString(expression.Values, labels[expression.Key])
	case "NotIn":
		return len(expression.Values) > 0 && !containsString(expression.Values, labels[expression.Key])
	case "Exists":
		return len(expression.Values) == 0 && exists
	case "DoesNotExist":
		return len(expression.Values) == 0 && !exists
	default:
		return false
	}
}

func namespaceRecords(namespaces namespaceList) []namespaceRecord {
	records := make([]namespaceRecord, 0, len(namespaces.Items))
	for _, namespace := range namespaces.Items {
		records = append(records, namespaceRecord{
			name:   namespace.Metadata.Name,
			labels: labelsOrEmpty(namespace.Metadata.Labels),
		})
	}
	return records
}

func matchingNetworkPolicyNamespaces(namespaces []namespaceRecord, policyNamespace string, namespaceSelector *labelSelector) map[string]bool {
	if namespaceSelector == nil {
		return map[string]bool{policyNamespace: true}
	}

	matches := map[string]bool{}
	for _, namespace := range namespaces {
		if labelSelectorMatches(namespaceSelector, namespace.labels) {
			matches[namespace.name] = true
		}
	}
	return matches
}

func networkPolicyTypes(policy networkPolicyResource) []string {
	if len(policy.Spec.PolicyTypes) > 0 {
		return uniqueStrings(policy.Spec.PolicyTypes)
	}

	types := []string{"Ingress"}
	if len(policy.Spec.Egress) > 0 {
		types = append(types, "Egress")
	}
	return types
}

type networkPolicyIntent struct {
	ingress string
	egress  string
	ports   string
}

func networkPolicyIntentSummary(policy networkPolicyResource, policyTypes []string) networkPolicyIntent {
	ports := uniqueStrings(append(networkPolicyIngressPortSummaries(policy.Spec.Ingress), networkPolicyEgressPortSummaries(policy.Spec.Egress)...))
	return networkPolicyIntent{
		ingress: networkPolicyDirectionSummary(containsString(policyTypes, "Ingress"), len(policy.Spec.Ingress), ingressPeers(policy.Spec.Ingress), networkPolicyIngressPortSummaries(policy.Spec.Ingress)),
		egress:  networkPolicyDirectionSummary(containsString(policyTypes, "Egress"), len(policy.Spec.Egress), egressPeers(policy.Spec.Egress), networkPolicyEgressPortSummaries(policy.Spec.Egress)),
		ports:   limitSummary(ports, 4, "-"),
	}
}

func networkPolicyDirectionSummary(isIsolated bool, ruleCount int, peerValues []string, portValues []string) string {
	if !isIsolated {
		return "not isolated"
	}
	if ruleCount == 0 {
		return "deny all"
	}

	peers := limitSummary(uniqueStrings(peerValues), 3, "all peers")
	ports := limitSummary(uniqueStrings(portValues), 3, "all ports")
	return fmt.Sprintf("%d rule%s: %s; %s", ruleCount, pluralSuffix(ruleCount), peers, ports)
}

func ingressPeers(rules []networkPolicyIngressRule) []string {
	if len(rules) == 0 {
		return nil
	}
	values := []string{}
	for _, rule := range rules {
		values = append(values, peerSummaries(rule.From)...)
	}
	return values
}

func egressPeers(rules []networkPolicyEgressRule) []string {
	if len(rules) == 0 {
		return nil
	}
	values := []string{}
	for _, rule := range rules {
		values = append(values, peerSummaries(rule.To)...)
	}
	return values
}

func peerSummaries(peers []networkPolicyPeer) []string {
	if len(peers) == 0 {
		return []string{"all peers"}
	}

	values := []string{}
	for _, peer := range peers {
		parts := []string{}
		if peer.NamespaceSelector != nil {
			parts = append(parts, "ns:"+labelSelectorSummaryWithFallback(*peer.NamespaceSelector, "all namespaces"))
		}
		if peer.PodSelector != nil {
			parts = append(parts, "pod:"+labelSelectorSummary(*peer.PodSelector))
		}
		if peer.IPBlock != nil {
			cidr := peer.IPBlock.CIDR
			if cidr == "" {
				cidr = "cidr"
			}
			parts = append(parts, "ip:"+cidr)
		}
		if len(parts) == 0 {
			values = append(values, "all peers")
			continue
		}
		values = append(values, strings.Join(parts, "+"))
	}
	return values
}

func networkPolicyIngressPortSummaries(rules []networkPolicyIngressRule) []string {
	values := []string{}
	for _, rule := range rules {
		values = append(values, networkPolicyPortSummaries(rule.Ports)...)
	}
	return values
}

func networkPolicyEgressPortSummaries(rules []networkPolicyEgressRule) []string {
	values := []string{}
	for _, rule := range rules {
		values = append(values, networkPolicyPortSummaries(rule.Ports)...)
	}
	return values
}

func networkPolicyPortSummaries(ports []networkPolicyPort) []string {
	values := []string{}
	for _, port := range ports {
		protocol := port.Protocol
		if protocol == "" {
			protocol = "TCP"
		}
		portValue := "*"
		switch value := port.Port.(type) {
		case string:
			if value != "" {
				portValue = value
			}
		case float64:
			portValue = strconv.Itoa(int(value))
		}
		if port.EndPort != nil {
			portValue = fmt.Sprintf("%s-%d", portValue, *port.EndPort)
		}
		values = append(values, protocol+":"+portValue)
	}
	return values
}

func readyContainers(statuses []containerStatus) int {
	ready := 0
	for _, status := range statuses {
		if status.Ready {
			ready++
		}
	}
	return ready
}

func restartCount(statuses []containerStatus) int {
	restarts := 0
	for _, status := range statuses {
		restarts += status.RestartCount
	}
	return restarts
}

func containerNames(containers []container) []string {
	names := make([]string, 0, len(containers))
	for _, container := range containers {
		if container.Name != "" {
			names = append(names, container.Name)
		}
	}
	sort.Strings(names)
	return names
}

func formatReplicas(ready int, desired int) string {
	return fmt.Sprintf("%d/%d", ready, desired)
}

func valueOrZero(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func valueOrDefault(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}

func boolSummary(value *bool) string {
	if value == nil {
		return "unset"
	}
	if *value {
		return "true"
	}
	return "false"
}

func labelSelectorSummary(selector labelSelector) string {
	return labelSelectorSummaryWithFallback(selector, "all pods")
}

func labelSelectorSummaryWithFallback(selector labelSelector, fallback string) string {
	expressions := len(selector.MatchExpressions)
	if len(selector.MatchLabels) == 0 && expressions == 0 {
		return fallback
	}

	parts := selectorSummaryParts(selector.MatchLabels)
	if expressions > 0 {
		parts = append(parts, fmt.Sprintf("%d expressions", expressions))
	}
	return strings.Join(parts, ",")
}

func selectorSummaryParts(selector map[string]string) []string {
	if len(selector) == 0 {
		return []string{}
	}
	keys := make([]string, 0, len(selector))
	for key := range selector {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func age(timestamp string) string {
	if timestamp == "" {
		return "unknown"
	}
	createdAt, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		return "unknown"
	}
	return time.Since(createdAt).Round(time.Hour).String()
}

func eventSource(event eventResource) string {
	if event.ReportingComponent != "" {
		return event.ReportingComponent
	}
	if event.Source.Component != "" && event.Source.Host != "" {
		return event.Source.Component + "@" + event.Source.Host
	}
	if event.Source.Component != "" {
		return event.Source.Component
	}
	return event.Source.Host
}

func eventTimestamp(event eventResource) string {
	for _, value := range []string{event.EventTime, event.LastTimestamp, event.FirstTimestamp, event.Metadata.CreationTimestamp} {
		if value != "" {
			return value
		}
	}
	return ""
}

func ownerSummaries(owners []ownerReference) []string {
	if len(owners) == 0 {
		return []string{}
	}
	values := make([]string, 0, len(owners))
	for _, owner := range owners {
		if owner.Kind == "" || owner.Name == "" {
			continue
		}
		values = append(values, owner.Kind+"/"+owner.Name)
	}
	sort.Strings(values)
	return values
}

func safeMetadataAnnotations(values map[string]string) map[string]string {
	if values == nil {
		return map[string]string{}
	}
	safe := make(map[string]string, len(values))
	for key, value := range values {
		if sensitiveMetadataField(key) || sensitiveMetadataField(value) {
			safe[key] = "redacted"
			continue
		}
		safe[key] = value
	}
	return safe
}

func sensitiveMetadataField(value string) bool {
	normalized := strings.ToLower(value)
	return strings.Contains(normalized, "token") ||
		strings.Contains(normalized, "password") ||
		strings.Contains(normalized, "secret") ||
		strings.Contains(normalized, "credential") ||
		strings.Contains(normalized, "apikey") ||
		strings.Contains(normalized, "api-key") ||
		strings.Contains(normalized, "accesskey") ||
		strings.Contains(normalized, "access-key") ||
		strings.Contains(normalized, "private-key") ||
		strings.Contains(normalized, "client-key")
}

func labelsOrEmpty(labels map[string]string) map[string]string {
	if labels == nil {
		return map[string]string{}
	}
	return labels
}

func summaryOrEmpty(summary map[string]interface{}) map[string]interface{} {
	if summary == nil {
		return map[string]interface{}{}
	}
	return summary
}

func uniqueGatewayReferences(values []gatewayReference) []gatewayReference {
	seen := map[string]bool{}
	result := []gatewayReference{}
	for _, value := range values {
		key := value.Namespace + "/" + value.Name
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, value)
	}
	return result
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
