package provider

import (
	"fmt"
	"net/netip"
)

const maxServicePorts = 256

func normalizedServiceType(value string) (string, bool) {
	if value == "" {
		return "ClusterIP", true
	}
	switch value {
	case "ClusterIP", "NodePort", "LoadBalancer", "ExternalName":
		return value, true
	default:
		return "invalid", false
	}
}

func validServiceSpec(service serviceResource) bool {
	serviceType, valid := normalizedServiceType(service.Spec.Type)
	if !valid || !validServiceClusterIP(serviceType, service.Spec.ClusterIP) || !validServicePorts(service.Spec.Ports) || !validServiceSelector(service.Spec.Selector) {
		return false
	}
	if serviceType == "ExternalName" {
		return validDNSSubdomain(service.Spec.ExternalName)
	}
	return service.Spec.ExternalName == ""
}

func validServiceClusterIP(serviceType string, value string) bool {
	if serviceType == "ExternalName" {
		return value == ""
	}
	if value == "" {
		return true
	}
	if value == "None" {
		return serviceType == "ClusterIP"
	}
	address, err := netip.ParseAddr(value)
	return err == nil && address.String() == value
}

func validServicePorts(ports []servicePort) bool {
	if len(ports) > maxServicePorts {
		return false
	}
	seenNames := map[string]bool{}
	for _, port := range ports {
		if port.Port < 1 || port.Port > 65535 || !validServicePortProtocol(port.Protocol) {
			return false
		}
		if port.Name == "" {
			if len(ports) > 1 {
				return false
			}
			continue
		}
		if !validKubernetesNamespace(port.Name) || seenNames[port.Name] {
			return false
		}
		seenNames[port.Name] = true
	}
	return true
}

func validServicePortProtocol(value string) bool {
	return value == "" || value == "TCP" || value == "UDP" || value == "SCTP"
}

func validServiceSelector(selector map[string]string) bool {
	if len(selector) > maxLabelSelectorLabels {
		return false
	}
	for key, value := range selector {
		if !validLabelKey(key) || !validLabelValue(value) {
			return false
		}
	}
	return true
}

func serviceSupportsSelectorInference(service serviceResource) bool {
	serviceType, valid := normalizedServiceType(service.Spec.Type)
	return valid && serviceType != "ExternalName" && len(service.Spec.Selector) > 0 && validServiceSpec(service)
}

func serviceStatus(service serviceResource, counts endpointCounter) string {
	if !validServiceSpec(service) {
		return "warning"
	}
	serviceType, _ := normalizedServiceType(service.Spec.Type)
	if serviceType == "ExternalName" {
		return "healthy"
	}
	if len(service.Spec.Selector) == 0 {
		return "unknown"
	}
	if counts.total == 0 || serviceTrafficReadyCount(service, counts) < counts.total {
		return "warning"
	}
	return "healthy"
}

func serviceTrafficReadyCount(service serviceResource, counts endpointCounter) int {
	if service.Spec.PublishNotReadyAddresses {
		return counts.total
	}
	return counts.ready
}

func serviceSummary(service serviceResource, counts endpointCounter) map[string]interface{} {
	serviceType, typeValid := normalizedServiceType(service.Spec.Type)
	trafficReady := serviceTrafficReadyCount(service, counts)
	summary := map[string]interface{}{
		"type":                     serviceType,
		"clusterIP":                serviceClusterIPSummary(serviceType, typeValid, service.Spec.ClusterIP),
		"ports":                    servicePortCountSummary(service.Spec.Ports),
		"selector":                 serviceSelectorSummary(service.Spec.Selector),
		"readyEndpoints":           formatReplicas(counts.ready, counts.total),
		"trafficReadyEndpoints":    formatReplicas(trafficReady, counts.total),
		"servingEndpoints":         formatReplicas(counts.serving, counts.total),
		"terminatingEndpoints":     summaryCount(counts.terminating),
		"publishNotReadyAddresses": service.Spec.PublishNotReadyAddresses,
	}
	if serviceType == "ExternalName" || service.Spec.ExternalName != "" {
		if typeValid && serviceType == "ExternalName" && validDNSSubdomain(service.Spec.ExternalName) {
			summary["externalName"] = service.Spec.ExternalName
		} else {
			summary["externalName"] = "invalid"
		}
	}
	return summary
}

func serviceClusterIPSummary(serviceType string, typeValid bool, value string) string {
	if !typeValid || !validServiceClusterIP(serviceType, value) {
		return "invalid"
	}
	if value == "" {
		return "unset"
	}
	return value
}

func servicePortCountSummary(ports []servicePort) interface{} {
	if !validServicePorts(ports) {
		return "invalid"
	}
	return len(ports)
}

func serviceSelectorSummary(selector map[string]string) string {
	if !validServiceSelector(selector) {
		return "invalid"
	}
	if len(selector) == 0 {
		return "none"
	}
	return fmt.Sprintf("%d labels", len(selector))
}
