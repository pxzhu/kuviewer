package provider

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"kuviewer/server/internal/topology"
)

const (
	serviceAccountTokenFile = "/var/run/secrets/kubernetes.io/serviceaccount/token"
	serviceAccountCAFile    = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
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
	version := kubeVersion{GitVersion: "unknown"}
	_ = p.client.getJSON(ctx, "/version", &version, true)

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
	httpRoutes := httpRouteList{}
	networkPolicies := networkPolicyList{}
	pvcs := pvcList{}
	pvs := pvList{}
	storageClasses := storageClassList{}

	if err := p.client.getJSON(ctx, "/api/v1/namespaces", &namespaces, false); err != nil {
		return topology.Snapshot{}, err
	}
	if err := p.client.getJSON(ctx, "/api/v1/nodes", &nodes, false); err != nil {
		return topology.Snapshot{}, err
	}
	if err := p.client.getJSON(ctx, "/api/v1/pods", &pods, false); err != nil {
		return topology.Snapshot{}, err
	}
	if err := p.client.getJSON(ctx, "/api/v1/services", &services, false); err != nil {
		return topology.Snapshot{}, err
	}

	_ = p.client.getJSON(ctx, "/api/v1/serviceaccounts", &serviceAccounts, true)
	_ = p.client.getJSON(ctx, "/api/v1/configmaps", &configMaps, true)
	_ = p.client.getJSON(ctx, "/apis/discovery.k8s.io/v1/endpointslices", &endpointSlices, true)
	_ = p.client.getJSON(ctx, "/apis/apps/v1/deployments", &deployments, true)
	_ = p.client.getJSON(ctx, "/apis/apps/v1/replicasets", &replicaSets, true)
	_ = p.client.getJSON(ctx, "/apis/apps/v1/statefulsets", &statefulSets, true)
	_ = p.client.getJSON(ctx, "/apis/apps/v1/daemonsets", &daemonSets, true)
	_ = p.client.getJSON(ctx, "/apis/batch/v1/jobs", &jobs, true)
	_ = p.client.getJSON(ctx, "/apis/batch/v1/cronjobs", &cronJobs, true)
	_ = p.client.getJSON(ctx, "/apis/autoscaling/v2/horizontalpodautoscalers", &hpas, true)
	_ = p.client.getJSON(ctx, "/apis/networking.k8s.io/v1/ingresses", &ingresses, true)
	_ = p.client.getJSON(ctx, "/apis/gateway.networking.k8s.io/v1/gateways", &gateways, true)
	_ = p.client.getJSON(ctx, "/apis/gateway.networking.k8s.io/v1/httproutes", &httpRoutes, true)
	_ = p.client.getJSON(ctx, "/apis/networking.k8s.io/v1/networkpolicies", &networkPolicies, true)
	_ = p.client.getJSON(ctx, "/api/v1/persistentvolumeclaims", &pvcs, true)
	_ = p.client.getJSON(ctx, "/api/v1/persistentvolumes", &pvs, true)
	_ = p.client.getJSON(ctx, "/apis/storage.k8s.io/v1/storageclasses", &storageClasses, true)

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
		builder.addNode("Namespace", "", namespace.Metadata.Name, "healthy", namespace.Metadata.Labels, map[string]interface{}{
			"age": age(namespace.Metadata.CreationTimestamp),
		})
		builder.addEdge("owns", clusterNodeID(p.clusterID, p.clusterName), builder.nodeID("Namespace", "", namespace.Metadata.Name), "metadata.namespace", "observed")
	}

	for _, node := range nodes.Items {
		builder.addNode("Node", "", node.Metadata.Name, nodeStatus(node), node.Metadata.Labels, map[string]interface{}{
			"kubeletVersion": node.Status.NodeInfo.KubeletVersion,
			"cpu":            node.Status.Capacity["cpu"],
			"memory":         node.Status.Capacity["memory"],
		})
	}

	for _, deployment := range deployments.Items {
		builder.addNode("Deployment", deployment.Metadata.Namespace, deployment.Metadata.Name, deploymentStatus(deployment), deployment.Metadata.Labels, map[string]interface{}{
			"replicas":          formatReplicas(deployment.Status.ReadyReplicas, valueOrZero(deployment.Spec.Replicas)),
			"availableReplicas": deployment.Status.AvailableReplicas,
		})
	}

	for _, replicaSet := range replicaSets.Items {
		builder.addNode("ReplicaSet", replicaSet.Metadata.Namespace, replicaSet.Metadata.Name, replicaSetStatus(replicaSet), replicaSet.Metadata.Labels, map[string]interface{}{
			"replicas": formatReplicas(replicaSet.Status.ReadyReplicas, valueOrZero(replicaSet.Spec.Replicas)),
		})
	}

	for _, statefulSet := range statefulSets.Items {
		builder.addNode("StatefulSet", statefulSet.Metadata.Namespace, statefulSet.Metadata.Name, statefulSetStatus(statefulSet), statefulSet.Metadata.Labels, map[string]interface{}{
			"replicas": formatReplicas(statefulSet.Status.ReadyReplicas, valueOrZero(statefulSet.Spec.Replicas)),
		})
	}

	for _, daemonSet := range daemonSets.Items {
		builder.addNode("DaemonSet", daemonSet.Metadata.Namespace, daemonSet.Metadata.Name, daemonSetStatus(daemonSet), daemonSet.Metadata.Labels, map[string]interface{}{
			"ready": fmt.Sprintf("%d/%d", daemonSet.Status.NumberReady, daemonSet.Status.DesiredNumberScheduled),
		})
	}

	for _, job := range jobs.Items {
		builder.addNode("Job", job.Metadata.Namespace, job.Metadata.Name, jobStatus(job), job.Metadata.Labels, map[string]interface{}{
			"completions": valueOrDefault(job.Spec.Completions, 1),
			"succeeded":   job.Status.Succeeded,
			"failed":      job.Status.Failed,
			"active":      job.Status.Active,
		})
	}

	for _, cronJob := range cronJobs.Items {
		builder.addNode("CronJob", cronJob.Metadata.Namespace, cronJob.Metadata.Name, "healthy", cronJob.Metadata.Labels, map[string]interface{}{
			"schedule": cronJob.Spec.Schedule,
			"suspend":  boolSummary(cronJob.Spec.Suspend),
			"active":   len(cronJob.Status.Active),
		})
	}

	for _, hpa := range hpas.Items {
		builder.addNode("HorizontalPodAutoscaler", hpa.Metadata.Namespace, hpa.Metadata.Name, hpaStatus(hpa), hpa.Metadata.Labels, map[string]interface{}{
			"target":   hpa.Spec.ScaleTargetRef.Kind + "/" + hpa.Spec.ScaleTargetRef.Name,
			"replicas": formatReplicas(hpa.Status.CurrentReplicas, hpa.Status.DesiredReplicas),
			"range":    fmt.Sprintf("%d-%d", valueOrDefault(hpa.Spec.MinReplicas, 1), hpa.Spec.MaxReplicas),
		})
	}

	for _, serviceAccount := range serviceAccounts.Items {
		builder.addNode("ServiceAccount", serviceAccount.Metadata.Namespace, serviceAccount.Metadata.Name, "healthy", serviceAccount.Metadata.Labels, map[string]interface{}{
			"age": age(serviceAccount.Metadata.CreationTimestamp),
		})
	}

	for _, configMap := range configMaps.Items {
		builder.addNode("ConfigMap", configMap.Metadata.Namespace, configMap.Metadata.Name, "healthy", configMap.Metadata.Labels, map[string]interface{}{
			"keys":      len(configMap.Data) + len(configMap.BinaryData),
			"immutable": boolSummary(configMap.Immutable),
		})
	}

	for _, storageClass := range storageClasses.Items {
		builder.addNode("StorageClass", "", storageClass.Metadata.Name, "healthy", storageClass.Metadata.Labels, map[string]interface{}{
			"provisioner":          storageClass.Provisioner,
			"volumeBindingMode":    storageClass.VolumeBindingMode,
			"allowVolumeExpansion": boolSummary(storageClass.AllowVolumeExpansion),
		})
	}

	for _, pv := range pvs.Items {
		builder.addNode("PersistentVolume", "", pv.Metadata.Name, pvStatus(pv), pv.Metadata.Labels, map[string]interface{}{
			"phase":        pv.Status.Phase,
			"storage":      pv.Spec.Capacity["storage"],
			"storageClass": pv.Spec.StorageClassName,
		})
	}

	for _, pvc := range pvcs.Items {
		builder.addNode("PersistentVolumeClaim", pvc.Metadata.Namespace, pvc.Metadata.Name, pvcStatus(pvc), pvc.Metadata.Labels, map[string]interface{}{
			"phase":        pvc.Status.Phase,
			"storage":      pvc.Spec.Resources.Requests["storage"],
			"volume":       pvc.Spec.VolumeName,
			"storageClass": pvc.Spec.StorageClassName,
		})
	}

	for _, service := range services.Items {
		counts := serviceEndpointCounts[serviceKey(service.Metadata.Namespace, service.Metadata.Name)]
		status := serviceStatus(service, counts)
		builder.addNode("Service", service.Metadata.Namespace, service.Metadata.Name, status, service.Metadata.Labels, map[string]interface{}{
			"type":           service.Spec.Type,
			"clusterIP":      service.Spec.ClusterIP,
			"ports":          len(service.Spec.Ports),
			"readyEndpoints": fmt.Sprintf("%d/%d", counts.ready, counts.total),
		})
	}

	for _, ingress := range ingresses.Items {
		builder.addNode("Ingress", ingress.Metadata.Namespace, ingress.Metadata.Name, "healthy", ingress.Metadata.Labels, map[string]interface{}{
			"hosts": strings.Join(ingressHosts(ingress), ", "),
			"rules": len(ingress.Spec.Rules),
		})
	}

	for _, gateway := range gateways.Items {
		builder.addNode("Gateway", gateway.Metadata.Namespace, gateway.Metadata.Name, "healthy", gateway.Metadata.Labels, map[string]interface{}{
			"class":     gateway.Spec.GatewayClassName,
			"listeners": len(gateway.Spec.Listeners),
			"hosts":     strings.Join(gatewayHosts(gateway), ", "),
		})
	}

	for _, httpRoute := range httpRoutes.Items {
		builder.addNode("HTTPRoute", httpRoute.Metadata.Namespace, httpRoute.Metadata.Name, "healthy", httpRoute.Metadata.Labels, map[string]interface{}{
			"hosts":    strings.Join(httpRoute.Spec.Hostnames, ", "),
			"rules":    len(httpRoute.Spec.Rules),
			"backends": len(httpRouteBackendRefs(httpRoute)),
		})
	}

	for _, networkPolicy := range networkPolicies.Items {
		policyTypes := networkPolicyTypes(networkPolicy)
		intent := networkPolicyIntentSummary(networkPolicy, policyTypes)
		builder.addNode("NetworkPolicy", networkPolicy.Metadata.Namespace, networkPolicy.Metadata.Name, "healthy", networkPolicy.Metadata.Labels, map[string]interface{}{
			"policyTypes": strings.Join(policyTypes, ","),
			"selector":    labelSelectorSummary(networkPolicy.Spec.PodSelector),
			"ingress":     intent.ingress,
			"egress":      intent.egress,
			"ports":       intent.ports,
		})
	}

	for _, pod := range pods.Items {
		builder.addNode("Pod", pod.Metadata.Namespace, pod.Metadata.Name, podStatus(pod), pod.Metadata.Labels, map[string]interface{}{
			"phase":    pod.Status.Phase,
			"ready":    formatReplicas(readyContainers(pod.Status.ContainerStatuses), len(pod.Status.ContainerStatuses)),
			"restarts": restartCount(pod.Status.ContainerStatuses),
			"node":     pod.Spec.NodeName,
		})
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

	for _, httpRoute := range httpRoutes.Items {
		httpRouteID := builder.nodeID("HTTPRoute", httpRoute.Metadata.Namespace, httpRoute.Metadata.Name)
		for _, parentRef := range httpRouteGatewayParentRefs(httpRoute) {
			builder.ensureReferenceNode("Gateway", parentRef.Namespace, parentRef.Name)
			builder.addEdge("attaches-to", httpRouteID, builder.nodeID("Gateway", parentRef.Namespace, parentRef.Name), "HTTPRoute.spec.parentRefs", "observed")
		}
		for _, backendRef := range httpRouteBackendRefs(httpRoute) {
			builder.ensureReferenceNode("Service", backendRef.Namespace, backendRef.Name)
			builder.addEdge("routes-to", httpRouteID, builder.nodeID("Service", backendRef.Namespace, backendRef.Name), "HTTPRoute.spec.rules.backendRefs", "observed")
		}
	}

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
		if !labelSelectorHasExpressions(&networkPolicy.Spec.PodSelector) {
			for _, pod := range pods.Items {
				if pod.Metadata.Namespace != networkPolicy.Metadata.Namespace || !selectorMatchesLabels(networkPolicy.Spec.PodSelector.MatchLabels, pod.Metadata.Labels) {
					continue
				}
				matches++
				builder.addEdge("applies-to", networkPolicyID, builder.nodeID("Pod", pod.Metadata.Namespace, pod.Metadata.Name), "NetworkPolicy.spec.podSelector", "inferred")
			}
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
		Clusters: []topology.ClusterSummary{clusterSummary},
		Nodes:    builder.nodes,
		Edges:    builder.edges,
	}, nil
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
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+c.bearer)
	request.Header.Set("Accept", "application/json")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if optional && (response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusForbidden) {
		return nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return fmt.Errorf("kubernetes api %s returned %s: %s", path, response.Status, strings.TrimSpace(string(body)))
	}

	return json.NewDecoder(response.Body).Decode(out)
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
	id := b.nodeID(kind, namespace, name)
	if name == "" || b.nodeSet[id] {
		return id
	}
	x, y := b.nextPosition(kind)
	b.nodes = append(b.nodes, topology.Node{
		ID:        id,
		ClusterID: b.clusterID,
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
		Status:    status,
		Labels:    labelsOrEmpty(labels),
		Summary:   summaryOrEmpty(summary),
		X:         x,
		Y:         y,
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

func (b *graphBuilder) addNetworkPolicyPeerEdges(networkPolicyID string, policyNamespace string, peers []networkPolicyPeer, edgeType string, sourceField string, pods podList, namespaces []namespaceRecord) {
	for _, peer := range peers {
		if peer.IPBlock != nil && peer.PodSelector == nil && peer.NamespaceSelector == nil {
			continue
		}
		if peer.PodSelector == nil && peer.NamespaceSelector == nil {
			continue
		}
		if labelSelectorHasExpressions(peer.PodSelector) || labelSelectorHasExpressions(peer.NamespaceSelector) {
			continue
		}

		matchingNamespaces := matchingNetworkPolicyNamespaces(namespaces, policyNamespace, peer.NamespaceSelector)
		if peer.PodSelector != nil {
			for _, pod := range pods.Items {
				if !matchingNamespaces[pod.Metadata.Namespace] || !selectorMatchesLabels(peer.PodSelector.MatchLabels, pod.Metadata.Labels) {
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

func (b *graphBuilder) nodeID(kind string, namespace string, name string) string {
	if namespace == "" {
		return b.clusterID + ":" + kind + ":" + name
	}
	return b.clusterID + ":" + namespace + ":" + kind + ":" + name
}

func (b *graphBuilder) nextPosition(kind string) (int, int) {
	xByKind := map[string]int{
		"Cluster":                 90,
		"Namespace":               280,
		"Node":                    520,
		"Ingress":                 720,
		"Gateway":                 720,
		"HTTPRoute":               840,
		"Deployment":              760,
		"ReplicaSet":              900,
		"StatefulSet":             760,
		"DaemonSet":               760,
		"Job":                     900,
		"CronJob":                 760,
		"HorizontalPodAutoscaler": 720,
		"Service":                 980,
		"Pod":                     1080,
		"NetworkPolicy":           1180,
		"ServiceAccount":          1220,
		"ConfigMap":               1220,
		"Secret":                  1220,
		"PersistentVolumeClaim":   1220,
		"PersistentVolume":        1380,
		"StorageClass":            1380,
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

type namespaceList struct {
	Items []namespace `json:"items"`
}

type namespace struct {
	Metadata metadata `json:"metadata"`
}

type nodeList struct {
	Items []nodeResource `json:"items"`
}

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

type podList struct {
	Items []podResource `json:"items"`
}

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

type serviceAccountList struct {
	Items []serviceAccountResource `json:"items"`
}

type serviceAccountResource struct {
	Metadata metadata `json:"metadata"`
}

type configMapList struct {
	Items []configMapResource `json:"items"`
}

type configMapResource struct {
	Metadata   metadata          `json:"metadata"`
	Data       map[string]string `json:"data"`
	BinaryData map[string]string `json:"binaryData"`
	Immutable  *bool             `json:"immutable"`
}

type container struct {
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

type serviceList struct {
	Items []serviceResource `json:"items"`
}

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

type endpointSliceList struct {
	Items []endpointSliceResource `json:"items"`
}

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

type deploymentList struct {
	Items []deploymentResource `json:"items"`
}

type deploymentResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Replicas *int `json:"replicas"`
	} `json:"spec"`
	Status replicaStatus `json:"status"`
}

type replicaSetList struct {
	Items []replicaSetResource `json:"items"`
}

type replicaSetResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Replicas *int `json:"replicas"`
	} `json:"spec"`
	Status replicaStatus `json:"status"`
}

type statefulSetList struct {
	Items []statefulSetResource `json:"items"`
}

type statefulSetResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Replicas *int `json:"replicas"`
	} `json:"spec"`
	Status replicaStatus `json:"status"`
}

type daemonSetList struct {
	Items []daemonSetResource `json:"items"`
}

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

type jobList struct {
	Items []jobResource `json:"items"`
}

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

type cronJobList struct {
	Items []cronJobResource `json:"items"`
}

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

type horizontalPodAutoscalerList struct {
	Items []horizontalPodAutoscalerResource `json:"items"`
}

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

type ingressList struct {
	Items []ingressResource `json:"items"`
}

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

type gatewayList struct {
	Items []gatewayResource `json:"items"`
}

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

type httpRouteList struct {
	Items []httpRouteResource `json:"items"`
}

type httpRouteResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Hostnames  []string           `json:"hostnames"`
		ParentRefs []gatewayReference `json:"parentRefs"`
		Rules      []httpRouteRule    `json:"rules"`
	} `json:"spec"`
}

type gatewayReference struct {
	Group     string `json:"group"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

type httpRouteRule struct {
	BackendRefs []gatewayReference `json:"backendRefs"`
}

type pvcList struct {
	Items []pvcResource `json:"items"`
}

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

type pvList struct {
	Items []pvResource `json:"items"`
}

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

type storageClassList struct {
	Items []storageClassResource `json:"items"`
}

type storageClassResource struct {
	Metadata             metadata `json:"metadata"`
	Provisioner          string   `json:"provisioner"`
	VolumeBindingMode    string   `json:"volumeBindingMode"`
	AllowVolumeExpansion *bool    `json:"allowVolumeExpansion"`
}

type networkPolicyList struct {
	Items []networkPolicyResource `json:"items"`
}

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

func httpRouteGatewayParentRefs(httpRoute httpRouteResource) []gatewayReference {
	refs := []gatewayReference{}
	for _, ref := range httpRoute.Spec.ParentRefs {
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
			ref.Namespace = httpRoute.Metadata.Namespace
		}
		refs = append(refs, ref)
	}
	return uniqueGatewayReferences(refs)
}

func httpRouteBackendRefs(httpRoute httpRouteResource) []gatewayReference {
	refs := []gatewayReference{}
	for _, rule := range httpRoute.Spec.Rules {
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
				ref.Namespace = httpRoute.Metadata.Namespace
			}
			refs = append(refs, ref)
		}
	}
	return uniqueGatewayReferences(refs)
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
		if selectorMatchesLabels(namespaceSelector.MatchLabels, namespace.labels) {
			matches[namespace.name] = true
		}
	}
	return matches
}

func labelSelectorHasExpressions(selector *labelSelector) bool {
	return selector != nil && len(selector.MatchExpressions) > 0
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
