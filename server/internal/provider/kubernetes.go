package provider

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strconv"
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
