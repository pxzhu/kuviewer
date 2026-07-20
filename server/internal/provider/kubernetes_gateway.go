package provider

import (
	"encoding/json"
	"net/netip"
	"strconv"
	"strings"
)

const (
	maxGatewayListeners              = 64
	maxGatewayAddresses              = 16
	maxGatewayConditions             = 8
	maxGatewayListenerConditions     = 8
	maxGatewayAttachedRoutes         = 1_000_000
	maxGatewayAddressJSONSize        = 2048
	maxGatewayRouteHostnames         = 16
	maxGatewayRouteParentReferences  = 32
	maxGatewayRouteRules             = 16
	maxGatewayRouteBackendReferences = 16
	maxGatewayRouteReferenceResults  = 256
	maxGatewayRouteMatches           = 64
	maxGatewayRouteStatusParents     = 32
	maxGatewayRouteParentConditions  = 8
	maxGRPCMethodResults             = 256
)

func (address *gatewayAddress) UnmarshalJSON(value []byte) error {
	*address = gatewayAddress{}
	if len(value) == 0 || len(value) > maxGatewayAddressJSONSize {
		return nil
	}
	var raw struct {
		Type  string `json:"type"`
		Value string `json:"value"`
	}
	if json.Unmarshal(value, &raw) != nil || len(raw.Value) > 253 {
		return nil
	}
	kind, deprecated, valid := normalizedGatewayAddressType(raw.Type)
	if !valid {
		return nil
	}
	if raw.Value == "" {
		address.Valid = true
		address.Kind = kind
		address.Deprecated = deprecated
		return nil
	}
	switch kind {
	case "ip":
		parsed, err := netip.ParseAddr(raw.Value)
		if err != nil || parsed.Zone() != "" || parsed.String() != raw.Value {
			return nil
		}
	case "hostname":
		if !validDNSSubdomain(raw.Value) {
			return nil
		}
	case "named", "custom":
		if !validSafeGatewayAddressValue(raw.Value) {
			return nil
		}
	}
	address.Valid = true
	address.Configured = true
	address.Kind = kind
	address.Deprecated = deprecated
	return nil
}

func normalizedGatewayAddressType(value string) (string, bool, bool) {
	switch value {
	case "", "IPAddress":
		return "ip", false, true
	case "Hostname":
		return "hostname", false, true
	case "NamedAddress":
		return "named", true, true
	default:
		if validGatewayCustomType(value) {
			return "custom", false, true
		}
		return "", false, false
	}
}

func validGatewayCustomType(value string) bool {
	if len(value) == 0 || len(value) > 253 || strings.Count(value, "/") != 1 {
		return false
	}
	parts := strings.SplitN(value, "/", 2)
	if !validDNSSubdomain(parts[0]) || parts[1] == "" || len(parts[1]) > 128 {
		return false
	}
	for index := 0; index < len(parts[1]); index++ {
		character := parts[1][index]
		if !isASCIIAlphanumeric(character) && character != '-' && character != '.' && character != '_' && character != '~' {
			return false
		}
	}
	return true
}

func validSafeGatewayAddressValue(value string) bool {
	if value == "" || len(value) > 253 {
		return false
	}
	for index := 0; index < len(value); index++ {
		if value[index] < 0x21 || value[index] > 0x7e {
			return false
		}
	}
	return true
}

func validGatewaySpec(gateway gatewayResource) bool {
	if !validKubernetesReferenceName(gateway.Spec.GatewayClassName) || len(gateway.Spec.Listeners) == 0 || len(gateway.Spec.Listeners) > maxGatewayListeners || !validGatewayAddresses(gateway.Spec.Addresses, true) {
		return false
	}
	seenNames := map[string]bool{}
	for _, listener := range gateway.Spec.Listeners {
		if !validGatewaySectionName(listener.Name) || seenNames[listener.Name] || !validGatewayProtocol(listener.Protocol) || !validPortNumber(listener.Port) || (listener.Hostname != "" && !validKubernetesHostname(listener.Hostname)) {
			return false
		}
		seenNames[listener.Name] = true
	}
	return true
}

func validGatewayAddresses(addresses []gatewayAddress, requireConfigured bool) bool {
	if len(addresses) > maxGatewayAddresses {
		return false
	}
	for _, address := range addresses {
		if !address.Valid || (requireConfigured && !address.Configured) {
			return false
		}
	}
	return true
}

func validGatewayProtocol(value string) bool {
	return value == "HTTP" || value == "HTTPS" || value == "TLS" || value == "TCP" || value == "UDP" || validGatewayCustomType(value)
}

func validGatewaySectionName(value string) bool {
	if value == "" || len(value) > 253 || !isASCIILowerAlphanumeric(value[0]) || !isASCIILowerAlphanumeric(value[len(value)-1]) {
		return false
	}
	for index := 1; index < len(value)-1; index++ {
		if !isASCIILowerAlphanumeric(value[index]) && value[index] != '-' {
			return false
		}
	}
	return true
}

func validGatewayStatus(gateway gatewayResource) bool {
	if !validGatewayAddresses(gateway.Status.Addresses, true) || !validGatewayConditions(gateway.Status.Conditions, maxGatewayConditions) || len(gateway.Status.Listeners) > maxGatewayListeners {
		return false
	}
	seenNames := map[string]bool{}
	for _, listener := range gateway.Status.Listeners {
		if !validGatewaySectionName(listener.Name) || seenNames[listener.Name] || listener.AttachedRoutes < 0 || listener.AttachedRoutes > maxGatewayAttachedRoutes || !validGatewayConditions(listener.Conditions, maxGatewayListenerConditions) {
			return false
		}
		seenNames[listener.Name] = true
	}
	return true
}

func validGatewayConditions(conditions []condition, limit int) bool {
	if len(conditions) > limit {
		return false
	}
	seen := map[string]bool{}
	for _, item := range conditions {
		if !validConditionType(item.Type) || !validConditionStatus(item.Status) || seen[item.Type] {
			return false
		}
		seen[item.Type] = true
	}
	return true
}

func gatewayStatus(gateway gatewayResource) string {
	if !validGatewaySpec(gateway) || !validGatewayStatus(gateway) || gatewayPositiveConditionWarning(gateway.Status.Conditions) {
		return "warning"
	}
	return "healthy"
}

func gatewayPositiveConditionWarning(conditions []condition) bool {
	for _, item := range conditions {
		if (item.Type == "Accepted" || item.Type == "Programmed" || item.Type == "Ready") && item.Status != "True" {
			return true
		}
	}
	return false
}

func gatewaySummary(gateway gatewayResource) map[string]interface{} {
	specValid := validGatewaySpec(gateway)
	statusValid := validGatewayStatus(gateway)
	if !specValid {
		return map[string]interface{}{
			"class": "invalid", "listeners": "invalid", "hosts": "invalid",
			"requestedAddresses":    gatewayAddressCountSummary(gateway.Spec.Addresses, false, true),
			"requestedAddressTypes": gatewayAddressTypesSummary(gateway.Spec.Addresses, false, true),
			"deprecatedAddresses":   gatewayDeprecatedAddressSummary(gateway.Spec.Addresses, false, true),
			"assignedAddresses":     gatewayAddressCountSummary(gateway.Status.Addresses, statusValid, true),
			"assignedAddressTypes":  gatewayAddressTypesSummary(gateway.Status.Addresses, statusValid, true),
			"conditions":            gatewayConditionSummary(gateway.Status.Conditions, statusValid),
			"listenerStatuses":      gatewayListenerStatusCountSummary(gateway, statusValid),
			"attachedRoutes":        gatewayAttachedRoutesSummary(gateway, statusValid),
		}
	}
	return map[string]interface{}{
		"class":                 gateway.Spec.GatewayClassName,
		"listeners":             len(gateway.Spec.Listeners),
		"hosts":                 joinSafeSummary(gatewayHosts(gateway), 8, ""),
		"requestedAddresses":    gatewayAddressCountSummary(gateway.Spec.Addresses, true, true),
		"requestedAddressTypes": gatewayAddressTypesSummary(gateway.Spec.Addresses, true, true),
		"deprecatedAddresses":   gatewayDeprecatedAddressSummary(gateway.Spec.Addresses, true, true),
		"assignedAddresses":     gatewayAddressCountSummary(gateway.Status.Addresses, statusValid, true),
		"assignedAddressTypes":  gatewayAddressTypesSummary(gateway.Status.Addresses, statusValid, true),
		"conditions":            gatewayConditionSummary(gateway.Status.Conditions, statusValid),
		"listenerStatuses":      gatewayListenerStatusCountSummary(gateway, statusValid),
		"attachedRoutes":        gatewayAttachedRoutesSummary(gateway, statusValid),
	}
}

func gatewayAddressCountSummary(addresses []gatewayAddress, valid bool, requireConfigured bool) interface{} {
	if !valid || !validGatewayAddresses(addresses, requireConfigured) {
		return "invalid"
	}
	return len(addresses)
}

func gatewayAddressTypesSummary(addresses []gatewayAddress, valid bool, requireConfigured bool) interface{} {
	if !valid || !validGatewayAddresses(addresses, requireConfigured) {
		return "invalid"
	}
	counts := map[string]int{"ip": 0, "hostname": 0, "named": 0, "custom": 0}
	for _, address := range addresses {
		counts[address.Kind]++
	}
	return "ip:" + boundedCountString(counts["ip"]) + ",hostname:" + boundedCountString(counts["hostname"]) + ",named:" + boundedCountString(counts["named"]) + ",custom:" + boundedCountString(counts["custom"])
}

func boundedCountString(value int) string {
	if value < 0 || value > maxGatewayAttachedRoutes {
		return "invalid"
	}
	return strconv.Itoa(value)
}

func gatewayDeprecatedAddressSummary(addresses []gatewayAddress, valid bool, requireConfigured bool) interface{} {
	if !valid || !validGatewayAddresses(addresses, requireConfigured) {
		return "invalid"
	}
	count := 0
	for _, address := range addresses {
		if address.Deprecated {
			count++
		}
	}
	return count
}

func gatewayConditionSummary(conditions []condition, valid bool) string {
	if !valid {
		return "invalid"
	}
	return conditionSummary(conditions)
}

func gatewayListenerStatusCountSummary(gateway gatewayResource, valid bool) interface{} {
	if !valid {
		return "invalid"
	}
	return len(gateway.Status.Listeners)
}

func gatewayAttachedRoutesSummary(gateway gatewayResource, valid bool) interface{} {
	if !valid {
		return "invalid"
	}
	count := 0
	for _, listener := range gateway.Status.Listeners {
		count += listener.AttachedRoutes
		if count > maxGatewayAttachedRoutes {
			return "invalid"
		}
	}
	return count
}

func gatewayHosts(gateway gatewayResource) []string {
	if !validGatewaySpec(gateway) {
		return nil
	}
	hosts := []string{}
	for _, listener := range gateway.Spec.Listeners {
		if listener.Hostname != "" {
			hosts = append(hosts, listener.Hostname)
		}
	}
	return uniqueStrings(hosts)
}

func validGatewayRouteSpec(kind string, route gatewayRouteResource) bool {
	if !validGatewayRouteKind(kind) || !validKubernetesNamespace(route.Metadata.Namespace) || len(route.Spec.Hostnames) > maxGatewayRouteHostnames || len(route.Spec.ParentRefs) > maxGatewayRouteParentReferences || len(route.Spec.Rules) > maxGatewayRouteRules {
		return false
	}
	if (kind == "TLSRoute" || kind == "TCPRoute") && len(route.Spec.Rules) == 0 || kind == "TCPRoute" && len(route.Spec.Hostnames) > 0 {
		return false
	}
	for _, hostname := range route.Spec.Hostnames {
		if !validKubernetesHostname(hostname) {
			return false
		}
	}
	for _, ref := range route.Spec.ParentRefs {
		if !validGatewayParentReference(ref, route.Metadata.Namespace) {
			return false
		}
	}
	results := 0
	for _, rule := range route.Spec.Rules {
		if len(rule.BackendRefs) > maxGatewayRouteBackendReferences || len(rule.Matches) > maxGatewayRouteMatches || ((kind == "TLSRoute" || kind == "TCPRoute") && len(rule.BackendRefs) == 0) {
			return false
		}
		for _, ref := range rule.BackendRefs {
			if !validGatewayBackendReference(ref, route.Metadata.Namespace) {
				return false
			}
			results++
			if results > maxGatewayRouteReferenceResults {
				return false
			}
		}
		if kind == "GRPCRoute" {
			for _, match := range rule.Matches {
				if (match.Method.Service != "" && !validGRPCServiceName(match.Method.Service)) || (match.Method.Method != "" && !validGRPCMethodName(match.Method.Method)) {
					return false
				}
			}
		}
	}
	return true
}

func validGatewayRouteKind(kind string) bool {
	return kind == "HTTPRoute" || kind == "GRPCRoute" || kind == "TLSRoute" || kind == "TCPRoute"
}

func validGatewayParentReference(ref gatewayReference, defaultNamespace string) bool {
	if !validGatewayReferenceIdentity(ref, defaultNamespace) || (ref.SectionName != "" && !validGatewaySectionName(ref.SectionName)) || ref.Port != 0 {
		return false
	}
	if ref.Group == "" && ref.Kind == "" {
		return true
	}
	group := ref.Group
	if group == "" {
		group = "gateway.networking.k8s.io"
	}
	kind := ref.Kind
	if kind == "" {
		kind = "Gateway"
	}
	return (group == "gateway.networking.k8s.io" && kind == "Gateway") || (validDNSSubdomain(group) && validKubernetesKind(kind))
}

func validGatewayBackendReference(ref gatewayReference, defaultNamespace string) bool {
	if !validGatewayReferenceIdentity(ref, defaultNamespace) || ref.SectionName != "" {
		return false
	}
	group := ref.Group
	kind := ref.Kind
	if group == "" && (kind == "" || kind == "Service") {
		return validPortNumber(ref.Port)
	}
	return validDNSSubdomain(group) && validKubernetesKind(kind) && (ref.Port == 0 || validPortNumber(ref.Port))
}

func validGatewayReferenceIdentity(ref gatewayReference, defaultNamespace string) bool {
	namespace := ref.Namespace
	if namespace == "" {
		namespace = defaultNamespace
	}
	return validKubernetesReferenceName(ref.Name) && validKubernetesNamespace(namespace)
}

func validGatewayRouteStatus(route gatewayRouteResource) bool {
	if len(route.Status.Parents) > maxGatewayRouteStatusParents {
		return false
	}
	for _, parent := range route.Status.Parents {
		if !validGatewayConditions(parent.Conditions, maxGatewayRouteParentConditions) {
			return false
		}
	}
	return true
}

func gatewayRouteStatus(kind string, route gatewayRouteResource) string {
	if !validGatewayRouteSpec(kind, route) || !validGatewayRouteStatus(route) {
		return "warning"
	}
	for _, parent := range route.Status.Parents {
		for _, item := range parent.Conditions {
			if (item.Type == "Accepted" || item.Type == "ResolvedRefs") && item.Status != "True" {
				return "warning"
			}
		}
	}
	return "healthy"
}

func gatewayRouteSummary(kind string, route gatewayRouteResource) map[string]interface{} {
	specValid := validGatewayRouteSpec(kind, route)
	statusValid := validGatewayRouteStatus(route)
	if !specValid {
		return map[string]interface{}{
			"hosts": "invalid", "rules": "invalid", "parents": "invalid", "backends": "invalid", "methods": "invalid",
			"statusParents":    gatewayRouteStatusParentSummary(route, statusValid),
			"acceptedParents":  gatewayRouteConditionCountSummary(route, statusValid, "Accepted"),
			"resolvedParents":  gatewayRouteConditionCountSummary(route, statusValid, "ResolvedRefs"),
			"statusConditions": gatewayRouteStatusConditionSummary(route, statusValid),
		}
	}
	summary := map[string]interface{}{
		"rules":            len(route.Spec.Rules),
		"parents":          len(gatewayRouteParentRefs(route)),
		"backends":         len(gatewayRouteBackendRefs(route)),
		"statusParents":    gatewayRouteStatusParentSummary(route, statusValid),
		"acceptedParents":  gatewayRouteConditionCountSummary(route, statusValid, "Accepted"),
		"resolvedParents":  gatewayRouteConditionCountSummary(route, statusValid, "ResolvedRefs"),
		"statusConditions": gatewayRouteStatusConditionSummary(route, statusValid),
	}
	if kind != "TCPRoute" {
		summary["hosts"] = joinSafeSummary(gatewayRouteHosts(route), 8, "")
	}
	if kind == "GRPCRoute" {
		summary["methods"] = joinSafeSummary(grpcRouteMethods(route), 8, "")
	}
	return summary
}

func gatewayRouteStatusParentSummary(route gatewayRouteResource, valid bool) interface{} {
	if !valid {
		return "invalid"
	}
	return len(route.Status.Parents)
}

func gatewayRouteConditionCountSummary(route gatewayRouteResource, valid bool, conditionType string) interface{} {
	if !valid {
		return "invalid"
	}
	count := 0
	for _, parent := range route.Status.Parents {
		for _, item := range parent.Conditions {
			if item.Type == conditionType && item.Status == "True" {
				count++
			}
		}
	}
	return count
}

func gatewayRouteStatusConditionSummary(route gatewayRouteResource, valid bool) interface{} {
	if !valid {
		return "invalid"
	}
	count := 0
	for _, parent := range route.Status.Parents {
		count += len(parent.Conditions)
	}
	return count
}

func gatewayRouteHosts(route gatewayRouteResource) []string {
	if !validAnyGatewayRouteSpec(route) {
		return nil
	}
	return uniqueStrings(route.Spec.Hostnames)
}

func gatewayRouteParentRefs(route gatewayRouteResource) []gatewayReference {
	if !validAnyGatewayRouteSpec(route) {
		return nil
	}
	refs := []gatewayReference{}
	for _, ref := range route.Spec.ParentRefs {
		group := ref.Group
		kind := ref.Kind
		if group == "" {
			group = "gateway.networking.k8s.io"
		}
		if kind == "" {
			kind = "Gateway"
		}
		if group != "gateway.networking.k8s.io" || kind != "Gateway" {
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
	if !validAnyGatewayRouteSpec(route) {
		return nil
	}
	refs := []gatewayReference{}
	for _, rule := range route.Spec.Rules {
		for _, ref := range rule.BackendRefs {
			if ref.Group != "" || (ref.Kind != "" && ref.Kind != "Service") {
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

func validAnyGatewayRouteSpec(route gatewayRouteResource) bool {
	return validGatewayRouteSpec("HTTPRoute", route) ||
		validGatewayRouteSpec("GRPCRoute", route) ||
		validGatewayRouteSpec("TLSRoute", route) ||
		validGatewayRouteSpec("TCPRoute", route)
}

func grpcRouteMethods(route gatewayRouteResource) []string {
	if !validGatewayRouteSpec("GRPCRoute", route) {
		return nil
	}
	methods := []string{}
	for _, rule := range route.Spec.Rules {
		for _, match := range rule.Matches {
			service := match.Method.Service
			method := match.Method.Method
			if service != "" && method != "" {
				methods = append(methods, service+"/"+method)
			} else if service != "" {
				methods = append(methods, service)
			} else if method != "" {
				methods = append(methods, method)
			}
			if len(methods) > maxGRPCMethodResults {
				return nil
			}
		}
	}
	return uniqueStrings(methods)
}
