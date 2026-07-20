package provider

import (
	"fmt"
	"strings"

	"kuviewer/server/internal/topology"
)

type kubernetesSnapshotResources struct {
	version         kubeVersion
	namespaces      namespaceList
	nodes           nodeList
	pods            podList
	serviceAccounts serviceAccountList
	services        serviceList
	endpointSlices  endpointSliceList
	configMaps      configMapList
	deployments     deploymentList
	replicaSets     replicaSetList
	statefulSets    statefulSetList
	daemonSets      daemonSetList
	jobs            jobList
	cronJobs        cronJobList
	hpas            horizontalPodAutoscalerList
	ingresses       ingressList
	gateways        gatewayList
	httpRoutes      gatewayRouteList
	grpcRoutes      gatewayRouteList
	tlsRoutes       gatewayRouteList
	tcpRoutes       gatewayRouteList
	networkPolicies networkPolicyList
	pvcs            pvcList
	pvs             pvList
	storageClasses  storageClassList
	crds            customResourceDefinitionList
	customResources []customResourceInstance
	diagnostics     []topology.SnapshotDiagnostic
}

func newKubernetesSnapshotResources() kubernetesSnapshotResources {
	return kubernetesSnapshotResources{version: kubeVersion{GitVersion: "unknown"}}
}

func buildKubernetesSnapshot(clusterID string, clusterName string, resources kubernetesSnapshotResources) topology.Snapshot {
	clusterID = safeClusterID(clusterID)
	clusterName = safeClusterName(clusterName, clusterID)
	clusterVersion := safeClusterVersion(resources.version.GitVersion)
	builder := newKubeGraphBuilder(clusterID)
	readyNodes := 0
	totalNodes := 0
	podRunning := 0
	podWarning := 0
	namespaceCount := 0
	endpointAnalysis := analyzeEndpointSlices(resources.endpointSlices)
	serviceEndpointCounts := endpointAnalysis.counts
	serviceEndpointRefs := serviceEndpointReferencesFromObserved(endpointAnalysis.references, resources.services, resources.pods)
	mergeReferenceEndpointCounts(serviceEndpointCounts, serviceEndpointRefs)
	namespaceIndex := namespaceRecords(resources.namespaces)

	clusterNode := builder.addNode("Cluster", "", clusterName, "healthy", map[string]string{"provider": "native"}, map[string]interface{}{"version": clusterVersion})

	for _, namespace := range resources.namespaces.Items {
		namespaceID, added := builder.addTrackedResourceNode("Namespace", namespace.Metadata, "healthy", map[string]interface{}{
			"age": age(namespace.Metadata.CreationTimestamp),
		})
		if added {
			namespaceCount++
		}
		builder.addEdge("owns", clusterNode, namespaceID, "metadata.namespace", "observed")
	}
	for _, node := range resources.nodes.Items {
		_, added := builder.addTrackedResourceNode("Node", node.Metadata, nodeStatus(node), map[string]interface{}{
			"kubeletVersion": node.Status.NodeInfo.KubeletVersion,
			"cpu":            node.Status.Capacity["cpu"],
			"memory":         node.Status.Capacity["memory"],
		})
		if added {
			totalNodes++
			if nodeReady(node.Status.Conditions) {
				readyNodes++
			}
		}
	}
	for _, deployment := range resources.deployments.Items {
		builder.addResourceNode("Deployment", deployment.Metadata, deploymentStatus(deployment), map[string]interface{}{
			"replicas":          formatReplicas(deployment.Status.ReadyReplicas, valueOrZero(deployment.Spec.Replicas)),
			"availableReplicas": deployment.Status.AvailableReplicas,
		})
	}
	for _, replicaSet := range resources.replicaSets.Items {
		builder.addResourceNode("ReplicaSet", replicaSet.Metadata, replicaSetStatus(replicaSet), map[string]interface{}{
			"replicas": formatReplicas(replicaSet.Status.ReadyReplicas, valueOrZero(replicaSet.Spec.Replicas)),
		})
	}
	for _, statefulSet := range resources.statefulSets.Items {
		builder.addResourceNode("StatefulSet", statefulSet.Metadata, statefulSetStatus(statefulSet), map[string]interface{}{
			"replicas": formatReplicas(statefulSet.Status.ReadyReplicas, valueOrZero(statefulSet.Spec.Replicas)),
		})
	}
	for _, daemonSet := range resources.daemonSets.Items {
		builder.addResourceNode("DaemonSet", daemonSet.Metadata, daemonSetStatus(daemonSet), map[string]interface{}{
			"ready": fmt.Sprintf("%d/%d", daemonSet.Status.NumberReady, daemonSet.Status.DesiredNumberScheduled),
		})
	}
	for _, job := range resources.jobs.Items {
		builder.addResourceNode("Job", job.Metadata, jobStatus(job), map[string]interface{}{
			"completions": valueOrDefault(job.Spec.Completions, 1),
			"succeeded":   job.Status.Succeeded,
			"failed":      job.Status.Failed,
			"active":      job.Status.Active,
		})
	}
	for _, cronJob := range resources.cronJobs.Items {
		builder.addResourceNode("CronJob", cronJob.Metadata, "healthy", map[string]interface{}{
			"schedule": cronJob.Spec.Schedule,
			"suspend":  boolSummary(cronJob.Spec.Suspend),
			"active":   len(cronJob.Status.Active),
		})
	}
	for _, hpa := range resources.hpas.Items {
		builder.addResourceNode("HorizontalPodAutoscaler", hpa.Metadata, hpaStatus(hpa), map[string]interface{}{
			"target":   kubernetesScaleTargetSummary(hpa.Spec.ScaleTargetRef.Kind, hpa.Spec.ScaleTargetRef.Name),
			"replicas": formatReplicas(hpa.Status.CurrentReplicas, hpa.Status.DesiredReplicas),
			"range":    fmt.Sprintf("%d-%d", valueOrDefault(hpa.Spec.MinReplicas, 1), hpa.Spec.MaxReplicas),
		})
	}
	for _, serviceAccount := range resources.serviceAccounts.Items {
		builder.addResourceNode("ServiceAccount", serviceAccount.Metadata, "healthy", map[string]interface{}{
			"age": age(serviceAccount.Metadata.CreationTimestamp),
		})
	}
	for _, configMap := range resources.configMaps.Items {
		builder.addResourceNode("ConfigMap", configMap.Metadata, "healthy", map[string]interface{}{
			"keys":      len(configMap.Data) + len(configMap.BinaryData),
			"immutable": boolSummary(configMap.Immutable),
		})
	}
	for _, storageClass := range resources.storageClasses.Items {
		builder.addResourceNode("StorageClass", storageClass.Metadata, "healthy", map[string]interface{}{
			"provisioner":          storageClass.Provisioner,
			"volumeBindingMode":    storageClass.VolumeBindingMode,
			"allowVolumeExpansion": boolSummary(storageClass.AllowVolumeExpansion),
		})
	}
	for _, crd := range resources.crds.Items {
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
	for _, resource := range resources.customResources {
		displayName := customResourceDisplayName(resource)
		meta := resource.Metadata
		meta.Name = displayName
		resourceID, added := builder.addTrackedResourceNode("CustomResource", meta, customResourceStatus(resource), map[string]interface{}{
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
		if !added {
			continue
		}
		if resource.Metadata.Namespace != "" {
			builder.addEdge("owns", builder.nodeID("Namespace", "", resource.Metadata.Namespace), resourceID, "metadata.namespace", "observed")
		}
		builder.addEdge("owns", builder.nodeID("CustomResourceDefinition", "", resource.CRDName), resourceID, "CustomResourceDefinition.spec.names.kind", "observed")
	}
	for _, pv := range resources.pvs.Items {
		builder.addResourceNode("PersistentVolume", pv.Metadata, pvStatus(pv), map[string]interface{}{
			"phase":        pv.Status.Phase,
			"storage":      pv.Spec.Capacity["storage"],
			"storageClass": kubernetesReferenceSummary(pv.Spec.StorageClassName),
		})
	}
	for _, pvc := range resources.pvcs.Items {
		builder.addResourceNode("PersistentVolumeClaim", pvc.Metadata, pvcStatus(pvc), map[string]interface{}{
			"phase":        pvc.Status.Phase,
			"storage":      pvc.Spec.Resources.Requests["storage"],
			"volume":       kubernetesReferenceSummary(pvc.Spec.VolumeName),
			"storageClass": kubernetesReferenceSummary(pvc.Spec.StorageClassName),
		})
	}
	for _, service := range resources.services.Items {
		counts := serviceEndpointCounts[serviceKey(service.Metadata.Namespace, service.Metadata.Name)]
		builder.addResourceNode("Service", service.Metadata, serviceStatus(service, counts), map[string]interface{}{
			"type":           service.Spec.Type,
			"clusterIP":      service.Spec.ClusterIP,
			"ports":          len(service.Spec.Ports),
			"readyEndpoints": fmt.Sprintf("%d/%d", counts.ready, counts.total),
		})
	}
	for _, ingress := range resources.ingresses.Items {
		builder.addResourceNode("Ingress", ingress.Metadata, "healthy", map[string]interface{}{
			"hosts": joinSafeSummary(ingressHosts(ingress), 8, ""),
			"rules": len(ingress.Spec.Rules),
		})
	}
	for _, gateway := range resources.gateways.Items {
		builder.addResourceNode("Gateway", gateway.Metadata, "healthy", map[string]interface{}{
			"class":     kubernetesReferenceSummary(gateway.Spec.GatewayClassName),
			"listeners": len(gateway.Spec.Listeners),
			"hosts":     joinSafeSummary(gatewayHosts(gateway), 8, ""),
		})
	}

	builder.addGatewayRouteNodes("HTTPRoute", resources.httpRoutes)
	builder.addGatewayRouteNodes("GRPCRoute", resources.grpcRoutes)
	builder.addGatewayRouteNodes("TLSRoute", resources.tlsRoutes)
	builder.addGatewayRouteNodes("TCPRoute", resources.tcpRoutes)

	for _, networkPolicy := range resources.networkPolicies.Items {
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
	for _, pod := range resources.pods.Items {
		status := podStatus(pod)
		_, added := builder.addTrackedResourceNode("Pod", pod.Metadata, status, map[string]interface{}{
			"phase":          pod.Status.Phase,
			"ready":          formatReplicas(readyContainers(pod.Status.ContainerStatuses), len(pod.Status.ContainerStatuses)),
			"restarts":       restartCount(pod.Status.ContainerStatuses),
			"node":           kubernetesReferenceSummary(pod.Spec.NodeName),
			"conditions":     conditionSummary(pod.Status.Conditions),
			"containerNames": containerNames(pod.Spec.Containers),
			"initContainers": containerNames(pod.Spec.InitContainers),
		})
		if added {
			if pod.Status.Phase == "Running" || pod.Status.Phase == "Succeeded" {
				podRunning++
			}
			if status != "healthy" {
				podWarning++
			}
		}
	}

	addKubernetesSnapshotEdges(builder, resources, namespaceIndex, serviceEndpointRefs)
	clusterSummary := topology.ClusterSummary{
		ID:         clusterID,
		Name:       clusterName,
		Provider:   "Kubernetes",
		Version:    clusterVersion,
		NodeReady:  readyNodes,
		NodeTotal:  totalNodes,
		PodRunning: podRunning,
		PodWarning: podWarning,
		Namespaces: namespaceCount,
	}
	builder.replaceNodeSummary(clusterNode, map[string]interface{}{
		"version":    clusterVersion,
		"nodes":      totalNodes,
		"namespaces": namespaceCount,
	})
	diagnostics := append([]topology.SnapshotDiagnostic(nil), resources.diagnostics...)
	diagnostics = append(diagnostics, builder.resourceIssueDiagnostics()...)
	diagnostics = append(diagnostics, endpointAnalysis.diagnostics()...)
	return topology.Snapshot{
		Clusters:    []topology.ClusterSummary{clusterSummary},
		Nodes:       builder.nodes,
		Edges:       builder.edges,
		Diagnostics: safeSnapshotDiagnostics(diagnostics),
	}
}

func addKubernetesSnapshotEdges(builder *graphBuilder, resources kubernetesSnapshotResources, namespaceIndex []namespaceRecord, serviceEndpointRefs []serviceEndpointReference) {
	seenCustomResources := map[string]bool{}
	for _, resource := range resources.customResources {
		resourceID := builder.nodeID("CustomResource", resource.Metadata.Namespace, customResourceDisplayName(resource))
		if !builder.claimResourceNode(resourceID, seenCustomResources) {
			continue
		}
		builder.addCustomResourceReferenceEdges(resource, resources.crds)
	}
	seenOwnerSources := map[string]bool{}
	for _, deployment := range resources.deployments.Items {
		if !builder.claimResourceNode(builder.nodeID("Deployment", deployment.Metadata.Namespace, deployment.Metadata.Name), seenOwnerSources) {
			continue
		}
		builder.addOwnerEdge("Deployment", deployment.Metadata)
	}
	for _, replicaSet := range resources.replicaSets.Items {
		if !builder.claimResourceNode(builder.nodeID("ReplicaSet", replicaSet.Metadata.Namespace, replicaSet.Metadata.Name), seenOwnerSources) {
			continue
		}
		builder.addOwnerEdge("ReplicaSet", replicaSet.Metadata)
	}
	for _, statefulSet := range resources.statefulSets.Items {
		if !builder.claimResourceNode(builder.nodeID("StatefulSet", statefulSet.Metadata.Namespace, statefulSet.Metadata.Name), seenOwnerSources) {
			continue
		}
		builder.addOwnerEdge("StatefulSet", statefulSet.Metadata)
	}
	for _, daemonSet := range resources.daemonSets.Items {
		if !builder.claimResourceNode(builder.nodeID("DaemonSet", daemonSet.Metadata.Namespace, daemonSet.Metadata.Name), seenOwnerSources) {
			continue
		}
		builder.addOwnerEdge("DaemonSet", daemonSet.Metadata)
	}
	for _, cronJob := range resources.cronJobs.Items {
		if !builder.claimResourceNode(builder.nodeID("CronJob", cronJob.Metadata.Namespace, cronJob.Metadata.Name), seenOwnerSources) {
			continue
		}
		builder.addOwnerEdge("CronJob", cronJob.Metadata)
	}
	for _, job := range resources.jobs.Items {
		if !builder.claimResourceNode(builder.nodeID("Job", job.Metadata.Namespace, job.Metadata.Name), seenOwnerSources) {
			continue
		}
		builder.addOwnerEdge("Job", job.Metadata)
	}
	for _, pod := range resources.pods.Items {
		if !builder.claimResourceNode(builder.nodeID("Pod", pod.Metadata.Namespace, pod.Metadata.Name), seenOwnerSources) {
			continue
		}
		builder.addOwnerEdge("Pod", pod.Metadata)
	}

	seenPods := map[string]bool{}
	for _, pod := range resources.pods.Items {
		podID := builder.nodeID("Pod", pod.Metadata.Namespace, pod.Metadata.Name)
		if !builder.claimResourceNode(podID, seenPods) {
			continue
		}
		if validKubernetesReferenceName(pod.Spec.NodeName) {
			builder.addEdge("scheduled-on", podID, builder.nodeID("Node", "", pod.Spec.NodeName), "Pod.spec.nodeName", "observed")
		}
		if validKubernetesReferenceName(pod.Spec.ServiceAccountName) {
			builder.ensureReferenceNode("ServiceAccount", pod.Metadata.Namespace, pod.Spec.ServiceAccountName)
			builder.addEdge("uses-service-account", podID, builder.nodeID("ServiceAccount", pod.Metadata.Namespace, pod.Spec.ServiceAccountName), "Pod.spec.serviceAccountName", "observed")
		}
		for _, ref := range podRefs(pod) {
			builder.ensureReferenceNode(ref.kind, pod.Metadata.Namespace, ref.name)
			builder.addEdge(ref.edgeType, podID, builder.nodeID(ref.kind, pod.Metadata.Namespace, ref.name), ref.sourceField, "observed")
		}
	}

	seenStorageSources := map[string]bool{}
	for _, pvc := range resources.pvcs.Items {
		pvcID := builder.nodeID("PersistentVolumeClaim", pvc.Metadata.Namespace, pvc.Metadata.Name)
		if !builder.claimResourceNode(pvcID, seenStorageSources) {
			continue
		}
		if validKubernetesReferenceName(pvc.Spec.VolumeName) {
			builder.addEdge("binds-storage", pvcID, builder.nodeID("PersistentVolume", "", pvc.Spec.VolumeName), "PersistentVolumeClaim.spec.volumeName", "observed")
		}
		if validKubernetesReferenceName(pvc.Spec.StorageClassName) {
			builder.addEdge("binds-storage", pvcID, builder.nodeID("StorageClass", "", pvc.Spec.StorageClassName), "PersistentVolumeClaim.spec.storageClassName", "observed")
		}
	}
	for _, pv := range resources.pvs.Items {
		pvID := builder.nodeID("PersistentVolume", "", pv.Metadata.Name)
		if !builder.claimResourceNode(pvID, seenStorageSources) {
			continue
		}
		if validKubernetesReferenceName(pv.Spec.StorageClassName) {
			builder.addEdge("binds-storage", pvID, builder.nodeID("StorageClass", "", pv.Spec.StorageClassName), "PersistentVolume.spec.storageClassName", "observed")
		}
	}
	seenIngresses := map[string]bool{}
	for _, ingress := range resources.ingresses.Items {
		ingressID := builder.nodeID("Ingress", ingress.Metadata.Namespace, ingress.Metadata.Name)
		if !builder.claimResourceNode(ingressID, seenIngresses) {
			continue
		}
		for _, serviceName := range ingressServiceNames(ingress) {
			builder.addEdge("routes-to", ingressID, builder.nodeID("Service", ingress.Metadata.Namespace, serviceName), "Ingress.spec.rules.http.paths.backend.service", "observed")
		}
	}

	builder.addGatewayRouteEdges("HTTPRoute", resources.httpRoutes)
	builder.addGatewayRouteEdges("GRPCRoute", resources.grpcRoutes)
	builder.addGatewayRouteEdges("TLSRoute", resources.tlsRoutes)
	builder.addGatewayRouteEdges("TCPRoute", resources.tcpRoutes)

	seenHPAs := map[string]bool{}
	for _, hpa := range resources.hpas.Items {
		hpaID := builder.nodeID("HorizontalPodAutoscaler", hpa.Metadata.Namespace, hpa.Metadata.Name)
		if !builder.claimResourceNode(hpaID, seenHPAs) {
			continue
		}
		targetKind := hpa.Spec.ScaleTargetRef.Kind
		targetName := hpa.Spec.ScaleTargetRef.Name
		if !validKubernetesKind(targetKind) || !validKubernetesReferenceName(targetName) {
			continue
		}
		builder.ensureReferenceNode(targetKind, hpa.Metadata.Namespace, targetName)
		builder.addEdge("targets-scale", hpaID, builder.nodeID(targetKind, hpa.Metadata.Namespace, targetName), "HorizontalPodAutoscaler.spec.scaleTargetRef", "observed")
	}

	seenNetworkPolicies := map[string]bool{}
	for _, networkPolicy := range resources.networkPolicies.Items {
		networkPolicyID := builder.nodeID("NetworkPolicy", networkPolicy.Metadata.Namespace, networkPolicy.Metadata.Name)
		if !builder.claimResourceNode(networkPolicyID, seenNetworkPolicies) {
			continue
		}
		matches := 0
		selectorValid := validLabelSelector(networkPolicy.Spec.PodSelector)
		if selectorValid {
			seenTargetPods := map[string]bool{}
			for _, pod := range resources.pods.Items {
				podID := builder.nodeID("Pod", pod.Metadata.Namespace, pod.Metadata.Name)
				if !builder.claimResourceNode(podID, seenTargetPods) {
					continue
				}
				if pod.Metadata.Namespace != networkPolicy.Metadata.Namespace || !labelSelectorMatches(&networkPolicy.Spec.PodSelector, pod.Metadata.Labels) {
					continue
				}
				matches++
				builder.addEdge("applies-to", networkPolicyID, podID, "NetworkPolicy.spec.podSelector", "inferred")
			}
		}
		if selectorValid && matches == 0 && networkPolicy.Metadata.Namespace != "" {
			builder.addEdge("applies-to", networkPolicyID, builder.nodeID("Namespace", "", networkPolicy.Metadata.Namespace), "NetworkPolicy.spec.podSelector", "observed")
		}
		policyTypes := networkPolicyTypes(networkPolicy)
		if containsString(policyTypes, "Ingress") {
			if rules, valid := boundedNetworkPolicyIngressRules(networkPolicy.Spec.Ingress); valid {
				for _, rule := range rules {
					builder.addNetworkPolicyPeerEdges(networkPolicyID, networkPolicy.Metadata.Namespace, rule.From, "allows-ingress", "NetworkPolicy.spec.ingress.from", resources.pods, namespaceIndex)
				}
			}
		}
		if containsString(policyTypes, "Egress") {
			if rules, valid := boundedNetworkPolicyEgressRules(networkPolicy.Spec.Egress); valid {
				for _, rule := range rules {
					builder.addNetworkPolicyPeerEdges(networkPolicyID, networkPolicy.Metadata.Namespace, rule.To, "allows-egress", "NetworkPolicy.spec.egress.to", resources.pods, namespaceIndex)
				}
			}
		}
	}

	for _, reference := range serviceEndpointRefs {
		builder.addEdge(
			"service-endpoint",
			builder.nodeID("Service", reference.namespace, reference.service),
			builder.nodeID("Pod", reference.namespace, reference.pod),
			reference.sourceField,
			reference.confidence,
		)
	}
}
