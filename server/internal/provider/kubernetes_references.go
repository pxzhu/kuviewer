package provider

import (
	"net/netip"
	"sort"
	"strings"
)

const (
	maxEndpointSliceEndpoints      = 1000
	maxEndpointAddresses           = 100
	maxEndpointSliceEndpointVisits = 100_000
	maxSelectorFallbackComparisons = 250_000
	maxPodReferenceResults         = 256
	maxPodReferenceCollectionItems = 256
	maxServiceEndpointResults      = 8192
	maxGRPCServiceNameBytes        = 256
	maxGRPCMethodNameBytes         = 128
)

type endpointCounter struct {
	ready       int
	serving     int
	terminating int
	total       int
}

type podReference struct {
	kind        string
	name        string
	edgeType    string
	sourceField string
}

type serviceEndpointReference struct {
	namespace   string
	service     string
	pod         string
	sourceField string
	confidence  string
	ready       bool
}

type endpointSliceAnalysis struct {
	counts            map[string]endpointCounter
	references        []serviceEndpointReference
	invalidItems      int
	processingLimited bool
}

type endpointReadiness struct {
	ready       bool
	serving     bool
	terminating bool
}

func boundedEndpointSliceEndpoints(endpoints []endpoint) ([]endpoint, bool) {
	return endpoints, len(endpoints) <= maxEndpointSliceEndpoints
}

func endpointCounts(endpointSlices endpointSliceList) map[string]endpointCounter {
	return analyzeEndpointSlices(endpointSlices).counts
}

func analyzeEndpointSlices(endpointSlices endpointSliceList) endpointSliceAnalysis {
	analysis := endpointSliceAnalysis{counts: map[string]endpointCounter{}}
	seenSlices := map[string]bool{}
	seenEndpoints := map[string]bool{}
	seenReferences := map[string]bool{}
	endpointVisits := 0
	for _, slice := range endpointSlices.Items {
		serviceName := slice.Metadata.Labels["kubernetes.io/service-name"]
		endpoints, valid := boundedEndpointSliceEndpoints(slice.Endpoints)
		if !validKubernetesReferenceName(slice.Metadata.Name) || !validKubernetesReferenceName(serviceName) || !validKubernetesNamespace(slice.Metadata.Namespace) || !validEndpointAddressType(slice.AddressType) || !valid {
			analysis.invalidItems++
			continue
		}
		sliceKey := serviceKey(slice.Metadata.Namespace, slice.Metadata.Name)
		if seenSlices[sliceKey] {
			analysis.invalidItems++
			continue
		}
		seenSlices[sliceKey] = true
		endpointVisits += len(endpoints)
		if endpointVisits > maxEndpointSliceEndpointVisits {
			return endpointSliceAnalysis{counts: map[string]endpointCounter{}, invalidItems: analysis.invalidItems, processingLimited: true}
		}
		key := serviceKey(slice.Metadata.Namespace, serviceName)
		counter := analysis.counts[key]
		for _, endpoint := range endpoints {
			identity, valid := endpointIdentityKey(slice.Metadata.Namespace, slice.AddressType, endpoint)
			if !valid {
				analysis.invalidItems++
				continue
			}
			identity = key + "\x00" + identity
			if seenEndpoints[identity] {
				analysis.invalidItems++
				continue
			}
			seenEndpoints[identity] = true
			readiness := endpointConditionState(endpoint)
			counter.total++
			if readiness.ready {
				counter.ready++
			}
			if readiness.serving {
				counter.serving++
			}
			if readiness.terminating {
				counter.terminating++
			}
			if endpoint.TargetRef == nil || endpoint.TargetRef.Kind != "Pod" || !validKubernetesReferenceName(endpoint.TargetRef.Name) {
				continue
			}
			referenceKey := key + "\x00" + endpoint.TargetRef.Name
			if seenReferences[referenceKey] {
				continue
			}
			if analysis.processingLimited {
				continue
			}
			if len(analysis.references) >= maxServiceEndpointResults {
				analysis.references = nil
				analysis.processingLimited = true
				continue
			}
			seenReferences[referenceKey] = true
			analysis.references = append(analysis.references, serviceEndpointReference{
				namespace:   slice.Metadata.Namespace,
				service:     serviceName,
				pod:         endpoint.TargetRef.Name,
				sourceField: "EndpointSlice.endpoints.targetRef",
				confidence:  "observed",
				ready:       readiness.ready,
			})
		}
		analysis.counts[key] = counter
	}
	return analysis
}

func endpointIdentityKey(namespace string, addressType string, endpoint endpoint) (string, bool) {
	address, valid := endpointPrimaryAddress(addressType, endpoint.Addresses)
	if !valid {
		return "", false
	}
	if endpoint.TargetRef == nil {
		return "address\x00" + addressType + "\x00" + address, true
	}
	if !validKubernetesKind(endpoint.TargetRef.Kind) || !validKubernetesReferenceName(endpoint.TargetRef.Name) {
		return "", false
	}
	if endpoint.TargetRef.Namespace != "" && endpoint.TargetRef.Namespace != namespace {
		return "", false
	}
	return "target\x00" + endpoint.TargetRef.Kind + "\x00" + endpoint.TargetRef.Name, true
}

func endpointPrimaryAddress(addressType string, addresses []string) (string, bool) {
	if len(addresses) == 0 || len(addresses) > maxEndpointAddresses {
		return "", false
	}
	seen := map[string]bool{}
	for _, address := range addresses {
		if seen[address] || !validEndpointAddress(addressType, address) {
			return "", false
		}
		seen[address] = true
	}
	return addresses[0], true
}

func validEndpointAddress(addressType string, value string) bool {
	switch addressType {
	case "IPv4", "IPv6":
		address, err := netip.ParseAddr(value)
		if err != nil || address.String() != value {
			return false
		}
		return addressType == "IPv4" && address.Is4() || addressType == "IPv6" && address.Is6()
	case "FQDN":
		return validDNSSubdomain(value)
	default:
		return false
	}
}

func validEndpointAddressType(value string) bool {
	return value == "IPv4" || value == "IPv6" || value == "FQDN"
}

func endpointConditionState(endpoint endpoint) endpointReadiness {
	return endpointReadiness{
		ready:       conditionValue(endpoint.Conditions.Ready, true),
		serving:     conditionValue(endpoint.Conditions.Serving, true),
		terminating: conditionValue(endpoint.Conditions.Terminating, false),
	}
}

func conditionValue(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func serviceEndpointReferences(endpointSlices endpointSliceList, services serviceList, pods podList) []serviceEndpointReference {
	analysis := analyzeEndpointSlices(endpointSlices)
	return serviceEndpointReferencesFromObserved(analysis.references, services, pods)
}

func serviceEndpointReferencesFromObserved(observedReferences []serviceEndpointReference, services serviceList, pods podList) []serviceEndpointReference {
	references := append([]serviceEndpointReference(nil), observedReferences...)
	seen := map[string]bool{}
	for _, reference := range references {
		seen[reference.namespace+"\x00"+reference.service+"\x00"+reference.pod] = true
	}
	add := func(namespace string, service string, pod string, sourceField string, confidence string, ready bool) bool {
		if !validKubernetesNamespace(namespace) || !validKubernetesReferenceName(service) || !validKubernetesReferenceName(pod) {
			return true
		}
		key := namespace + "\x00" + service + "\x00" + pod
		if seen[key] {
			return true
		}
		if len(references) >= maxServiceEndpointResults {
			return false
		}
		seen[key] = true
		references = append(references, serviceEndpointReference{namespace: namespace, service: service, pod: pod, sourceField: sourceField, confidence: confidence, ready: ready})
		return true
	}

	observed := append([]serviceEndpointReference(nil), references...)
	comparisons := 0
	seenServices := map[string]bool{}
	validPods := uniqueValidPods(pods.Items)
	for _, service := range services.Items {
		serviceID := serviceKey(service.Metadata.Namespace, service.Metadata.Name)
		if seenServices[serviceID] || !serviceSupportsSelectorInference(service) || !validKubernetesNamespace(service.Metadata.Namespace) || !validKubernetesReferenceName(service.Metadata.Name) {
			continue
		}
		seenServices[serviceID] = true
		for _, pod := range validPods {
			if pod.Metadata.Namespace != service.Metadata.Namespace {
				continue
			}
			comparisons++
			if comparisons > maxSelectorFallbackComparisons {
				return observed
			}
			if !labelsMatch(service.Spec.Selector, pod.Metadata.Labels) {
				continue
			}
			if !add(service.Metadata.Namespace, service.Metadata.Name, pod.Metadata.Name, "Service.spec.selector", "inferred", podStatus(pod) == "healthy") {
				return observed
			}
		}
	}
	return references
}

func uniqueValidPods(pods []podResource) []podResource {
	result := make([]podResource, 0, len(pods))
	seen := map[string]bool{}
	for _, pod := range pods {
		if !validKubernetesNamespace(pod.Metadata.Namespace) || !validKubernetesReferenceName(pod.Metadata.Name) {
			continue
		}
		key := serviceKey(pod.Metadata.Namespace, pod.Metadata.Name)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, pod)
	}
	return result
}

func mergeReferenceEndpointCounts(counts map[string]endpointCounter, references []serviceEndpointReference) {
	if counts == nil {
		return
	}
	observed := map[string]bool{}
	for key, counter := range counts {
		observed[key] = counter.total > 0
	}
	for _, reference := range references {
		if reference.confidence != "inferred" {
			continue
		}
		key := serviceKey(reference.namespace, reference.service)
		if observed[key] {
			continue
		}
		counter := counts[key]
		counter.total++
		if reference.ready {
			counter.ready++
			counter.serving++
		}
		counts[key] = counter
	}
}

func serviceKey(namespace string, name string) string {
	return namespace + "/" + name
}

func podRefs(pod podResource) []podReference {
	if len(pod.Spec.ImagePullSecret) > maxPodReferenceCollectionItems ||
		len(pod.Spec.Volumes) > maxPodReferenceCollectionItems ||
		len(pod.Spec.InitContainers) > maxPodReferenceCollectionItems ||
		len(pod.Spec.Containers) > maxPodReferenceCollectionItems ||
		len(pod.Spec.InitContainers)+len(pod.Spec.Containers) > maxPodReferenceCollectionItems {
		return nil
	}

	refs := []podReference{}
	seen := map[string]bool{}
	add := func(kind string, name string, edgeType string, sourceField string) {
		if len(refs) >= maxPodReferenceResults || !validKubernetesReferenceName(name) {
			return
		}
		key := kind + "\x00" + name + "\x00" + edgeType + "\x00" + sourceField
		if seen[key] {
			return
		}
		seen[key] = true
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

	containers := make([]container, 0, len(pod.Spec.InitContainers)+len(pod.Spec.Containers))
	containers = append(containers, pod.Spec.InitContainers...)
	containers = append(containers, pod.Spec.Containers...)
	for _, container := range containers {
		if len(container.EnvFrom) > maxPodReferenceCollectionItems || len(container.Env) > maxPodReferenceCollectionItems {
			return nil
		}
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
			if refs[i].name == refs[j].name {
				return refs[i].sourceField < refs[j].sourceField
			}
			return refs[i].name < refs[j].name
		}
		return refs[i].kind < refs[j].kind
	})
	return refs
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
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Namespace == result[j].Namespace {
			return result[i].Name < result[j].Name
		}
		return result[i].Namespace < result[j].Namespace
	})
	return result
}

func validKubernetesReferenceName(value string) bool {
	return len(value) <= 253 && validDNSSubdomain(value)
}

func kubernetesReferenceSummary(value string) string {
	if validKubernetesReferenceName(value) {
		return value
	}
	return ""
}

func kubernetesScaleTargetSummary(kind string, name string) string {
	if !validKubernetesKind(kind) || !validKubernetesReferenceName(name) {
		return ""
	}
	return kind + "/" + name
}

func validKubernetesNamespace(value string) bool {
	if value == "" || len(value) > 63 || strings.Contains(value, ".") {
		return false
	}
	return validDNSSubdomain(value)
}

func validKubernetesKind(value string) bool {
	if value == "" || len(value) > 63 || !isASCIIAlpha(value[0]) {
		return false
	}
	for index := 1; index < len(value); index++ {
		if !isASCIIAlphanumeric(value[index]) {
			return false
		}
	}
	return true
}

func validKubernetesHostname(value string) bool {
	if value == "" || len(value) > 253 || value != strings.ToLower(value) {
		return false
	}
	if strings.HasPrefix(value, "*.") {
		value = strings.TrimPrefix(value, "*.")
	}
	return validDNSSubdomain(strings.ToLower(value))
}

func validGRPCServiceName(value string) bool {
	return validDottedIdentifier(value, maxGRPCServiceNameBytes)
}

func validGRPCMethodName(value string) bool {
	return validIdentifier(value, maxGRPCMethodNameBytes)
}

func validDottedIdentifier(value string, maxBytes int) bool {
	if value == "" || len(value) > maxBytes {
		return false
	}
	for _, part := range strings.Split(value, ".") {
		if !validIdentifier(part, maxBytes) {
			return false
		}
	}
	return true
}

func validIdentifier(value string, maxBytes int) bool {
	if value == "" || len(value) > maxBytes || !(value[0] >= 'A' && value[0] <= 'Z' || value[0] >= 'a' && value[0] <= 'z' || value[0] == '_') {
		return false
	}
	for index := 1; index < len(value); index++ {
		character := value[index]
		if !isASCIIAlphanumeric(character) && character != '_' {
			return false
		}
	}
	return true
}
