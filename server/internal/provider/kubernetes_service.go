package provider

import (
	"encoding/json"
	"fmt"
	"net/netip"
	"strconv"
	"strings"
)

const (
	maxServicePorts       = 256
	maxServiceClusterIPs  = 2
	maxTargetPortJSONSize = 128
)

func (target *serviceTargetPort) UnmarshalJSON(value []byte) error {
	*target = serviceTargetPort{Set: true}
	if len(value) == 0 || len(value) > maxTargetPortJSONSize || string(value) == "null" {
		return nil
	}
	if value[0] == '"' {
		var name string
		if json.Unmarshal(value, &name) == nil && validIANAServiceName(name) {
			target.Kind = "name"
			target.StringValue = name
			target.Valid = true
		}
		return nil
	}
	number, err := strconv.Atoi(string(value))
	if err == nil && validPortNumber(number) {
		target.Kind = "number"
		target.IntValue = number
		target.Valid = true
	}
	return nil
}

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
	if !valid || !validServiceIPConfiguration(serviceType, service) || !validServicePorts(serviceType, service.Spec.Ports) || !validServiceSelector(service.Spec.Selector) {
		return false
	}
	if serviceType == "ExternalName" {
		return validDNSSubdomain(service.Spec.ExternalName)
	}
	return service.Spec.ExternalName == ""
}

func normalizedIPFamilyPolicy(value string) (string, bool) {
	if value == "" {
		return "SingleStack", true
	}
	switch value {
	case "SingleStack", "PreferDualStack", "RequireDualStack":
		return value, true
	default:
		return "invalid", false
	}
}

func validServiceIPConfiguration(serviceType string, service serviceResource) bool {
	clusterIP := service.Spec.ClusterIP
	clusterIPs := service.Spec.ClusterIPs
	ipFamilies := service.Spec.IPFamilies
	policy, policyValid := normalizedIPFamilyPolicy(service.Spec.IPFamilyPolicy)
	if serviceType == "ExternalName" {
		return clusterIP == "" && len(clusterIPs) == 0 && len(ipFamilies) == 0 && service.Spec.IPFamilyPolicy == ""
	}
	if !policyValid || !validServiceClusterIP(serviceType, clusterIP) || len(clusterIPs) > maxServiceClusterIPs || len(ipFamilies) > maxServiceClusterIPs {
		return false
	}
	if len(clusterIPs) > 0 && (clusterIP == "" || clusterIPs[0] != clusterIP) {
		return false
	}
	if clusterIP == "None" {
		if len(clusterIPs) > 0 && (len(clusterIPs) != 1 || clusterIPs[0] != "None") {
			return false
		}
	} else if !validServiceClusterIPList(clusterIPs) {
		return false
	}
	if !validServiceIPFamilies(ipFamilies) || !serviceIPFamiliesMatch(clusterIP, clusterIPs, ipFamilies) {
		return false
	}
	if policy == "SingleStack" && (len(clusterIPs) > 1 || len(ipFamilies) > 1) {
		return false
	}
	if policy == "RequireDualStack" {
		if clusterIP == "None" {
			return len(clusterIPs) == 1 && len(ipFamilies) == 2
		}
		return len(clusterIPs) == 2 && len(ipFamilies) == 2
	}
	return true
}

func validServiceClusterIPList(values []string) bool {
	seen := map[string]bool{}
	families := map[string]bool{}
	for _, value := range values {
		address, err := netip.ParseAddr(value)
		if err != nil || address.String() != value || seen[value] {
			return false
		}
		family := serviceAddressFamily(address)
		if families[family] {
			return false
		}
		seen[value] = true
		families[family] = true
	}
	return true
}

func validServiceIPFamilies(values []string) bool {
	seen := map[string]bool{}
	for _, value := range values {
		if (value != "IPv4" && value != "IPv6") || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}

func serviceIPFamiliesMatch(clusterIP string, clusterIPs []string, families []string) bool {
	if clusterIP == "None" {
		return true
	}
	addresses := clusterIPs
	if len(addresses) == 0 && clusterIP != "" && clusterIP != "None" {
		addresses = []string{clusterIP}
	}
	if len(families) == 0 || len(addresses) == 0 {
		return true
	}
	if len(addresses) != len(families) {
		return false
	}
	for index, value := range addresses {
		address, err := netip.ParseAddr(value)
		if err != nil || serviceAddressFamily(address) != families[index] {
			return false
		}
	}
	return true
}

func serviceAddressFamily(address netip.Addr) string {
	if address.Is4() {
		return "IPv4"
	}
	return "IPv6"
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

func validServicePorts(serviceType string, ports []servicePort) bool {
	if len(ports) > maxServicePorts {
		return false
	}
	seenNames := map[string]bool{}
	seenPorts := map[string]bool{}
	seenNodePorts := map[string]bool{}
	for _, port := range ports {
		if !validPortNumber(port.Port) || !validServicePortProtocol(port.Protocol) || !validServiceTargetPort(port.TargetPort) || !validServiceNodePort(serviceType, port.NodePort) || !validServiceAppProtocol(port.AppProtocol) {
			return false
		}
		protocol := port.Protocol
		if protocol == "" {
			protocol = "TCP"
		}
		portKey := fmt.Sprintf("%s/%d", protocol, port.Port)
		if seenPorts[portKey] {
			return false
		}
		seenPorts[portKey] = true
		if port.NodePort > 0 {
			nodePortKey := fmt.Sprintf("%s/%d", protocol, port.NodePort)
			if seenNodePorts[nodePortKey] {
				return false
			}
			seenNodePorts[nodePortKey] = true
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
	if serviceType == "NodePort" && len(ports) == 0 {
		return false
	}
	return true
}

func validPortNumber(value int) bool {
	return value >= 1 && value <= 65535
}

func validServiceTargetPort(target serviceTargetPort) bool {
	return !target.Set || target.Valid && (target.Kind == "number" || target.Kind == "name")
}

func validServiceNodePort(serviceType string, value int) bool {
	if value < 0 || value > 65535 {
		return false
	}
	if serviceType == "ClusterIP" || serviceType == "ExternalName" {
		return value == 0
	}
	if serviceType == "NodePort" {
		return validPortNumber(value)
	}
	return value == 0 || validPortNumber(value)
}

func validServiceAppProtocol(value string) bool {
	return value == "" || validLabelKey(value)
}

func validIANAServiceName(value string) bool {
	if value == "" || len(value) > 15 || !isASCIILowerAlphanumeric(value[0]) || !isASCIILowerAlphanumeric(value[len(value)-1]) {
		return false
	}
	hasLetter := false
	for index := 0; index < len(value); index++ {
		character := value[index]
		if character >= 'a' && character <= 'z' {
			hasLetter = true
			continue
		}
		if character < '0' || character > '9' {
			if character != '-' {
				return false
			}
		}
	}
	return hasLetter
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
	ipFamilyPolicy, policyValid := normalizedIPFamilyPolicy(service.Spec.IPFamilyPolicy)
	ipConfigurationValid := typeValid && validServiceIPConfiguration(serviceType, service)
	portsValid := typeValid && validServicePorts(serviceType, service.Spec.Ports)
	trafficReady := serviceTrafficReadyCount(service, counts)
	summary := map[string]interface{}{
		"type":                     serviceType,
		"clusterIP":                serviceClusterIPSummary(ipConfigurationValid, service.Spec.ClusterIP),
		"clusterIPs":               serviceCollectionCountSummary(len(service.Spec.ClusterIPs), ipConfigurationValid),
		"ipFamilies":               serviceIPFamiliesSummary(service.Spec.IPFamilies, ipConfigurationValid),
		"ipFamilyPolicy":           serviceIPFamilyPolicySummary(serviceType, ipFamilyPolicy, policyValid, ipConfigurationValid),
		"ports":                    serviceCollectionCountSummary(len(service.Spec.Ports), portsValid),
		"targetPorts":              servicePortAttributeCountSummary(service.Spec.Ports, portsValid, func(port servicePort) bool { return port.TargetPort.Set }),
		"nodePorts":                servicePortAttributeCountSummary(service.Spec.Ports, portsValid, func(port servicePort) bool { return port.NodePort > 0 }),
		"appProtocols":             servicePortAttributeCountSummary(service.Spec.Ports, portsValid, func(port servicePort) bool { return port.AppProtocol != "" }),
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

func serviceClusterIPSummary(valid bool, value string) string {
	if !valid {
		return "invalid"
	}
	if value == "" {
		return "unset"
	}
	return value
}

func serviceCollectionCountSummary(count int, valid bool) interface{} {
	if !valid {
		return "invalid"
	}
	return count
}

func serviceIPFamiliesSummary(families []string, valid bool) string {
	if !valid {
		return "invalid"
	}
	if len(families) == 0 {
		return "unset"
	}
	return strings.Join(families, ",")
}

func serviceIPFamilyPolicySummary(serviceType string, policy string, policyValid bool, configurationValid bool) string {
	if !policyValid || !configurationValid {
		return "invalid"
	}
	if serviceType == "ExternalName" {
		return "unset"
	}
	return policy
}

func servicePortAttributeCountSummary(ports []servicePort, valid bool, matches func(servicePort) bool) interface{} {
	if !valid {
		return "invalid"
	}
	count := 0
	for _, port := range ports {
		if matches(port) {
			count++
		}
	}
	return count
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
