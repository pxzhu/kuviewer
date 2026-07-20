package provider

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

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
