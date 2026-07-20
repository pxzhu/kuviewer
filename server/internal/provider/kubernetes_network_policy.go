package provider

import (
	"fmt"
	"math"
	"net"
	"sort"
	"strconv"
	"strings"
)

const (
	maxNetworkPolicyRules       = 64
	maxNetworkPolicyPeers       = 64
	maxNetworkPolicyPorts       = 64
	maxNetworkPolicyPolicyTypes = 8
	maxLabelSelectorLabels      = 64
	maxLabelSelectorExpressions = 64
	maxLabelSelectorValues      = 64
	maxObjectLabels             = 256
	maxNetworkPolicyIPExcept    = 64
)

type networkPolicyIntent struct {
	ingress string
	egress  string
	ports   string
}

type namespaceRecord struct {
	name   string
	labels map[string]string
}

func labelsMatch(selector map[string]string, labels map[string]string) bool {
	return len(selector) > 0 && selectorMatchesLabels(selector, labels)
}

func selectorMatchesLabels(selector map[string]string, labels map[string]string) bool {
	if len(selector) > maxLabelSelectorLabels || len(labels) > maxObjectLabels {
		return false
	}
	for key, value := range selector {
		if !validLabelKey(key) || !validLabelValue(value) {
			return false
		}
		actual, exists := labels[key]
		if !exists || !validLabelValue(actual) || actual != value {
			return false
		}
	}
	return true
}

func labelSelectorMatches(selector *labelSelector, labels map[string]string) bool {
	if selector == nil {
		return true
	}
	if !validLabelSelector(*selector) || !selectorMatchesLabels(selector.MatchLabels, labels) {
		return false
	}
	for _, expression := range selector.MatchExpressions {
		if !labelSelectorExpressionMatches(expression, labels) {
			return false
		}
	}
	return true
}

func validLabelSelector(selector labelSelector) bool {
	if len(selector.MatchLabels) > maxLabelSelectorLabels || len(selector.MatchExpressions) > maxLabelSelectorExpressions {
		return false
	}
	for key, value := range selector.MatchLabels {
		if !validLabelKey(key) || !validLabelValue(value) {
			return false
		}
	}
	for _, expression := range selector.MatchExpressions {
		if !validLabelSelectorExpression(expression) {
			return false
		}
	}
	return true
}

func validLabelSelectorExpression(expression labelSelectorMatchExpression) bool {
	if !validLabelKey(expression.Key) || len(expression.Values) > maxLabelSelectorValues {
		return false
	}
	for _, value := range expression.Values {
		if !validLabelValue(value) {
			return false
		}
	}
	switch expression.Operator {
	case "In", "NotIn":
		return len(expression.Values) > 0
	case "Exists", "DoesNotExist":
		return len(expression.Values) == 0
	default:
		return false
	}
}

func labelSelectorExpressionMatches(expression labelSelectorMatchExpression, labels map[string]string) bool {
	if !validLabelSelectorExpression(expression) || len(labels) > maxObjectLabels {
		return false
	}
	value, exists := labels[expression.Key]
	if exists && !validLabelValue(value) {
		return false
	}
	switch expression.Operator {
	case "In":
		return exists && containsString(expression.Values, value)
	case "NotIn":
		return !exists || !containsString(expression.Values, value)
	case "Exists":
		return exists
	case "DoesNotExist":
		return !exists
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
		if len(policy.Spec.PolicyTypes) > maxNetworkPolicyPolicyTypes {
			return nil
		}
		values := make([]string, 0, 2)
		for _, value := range policy.Spec.PolicyTypes {
			if value == "Ingress" || value == "Egress" {
				values = append(values, value)
			}
		}
		return uniqueStrings(values)
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
	if ruleCount > maxNetworkPolicyRules {
		return "invalid rules"
	}
	if ruleCount == 0 {
		return "deny all"
	}

	peers := limitSummary(uniqueStrings(peerValues), 3, "all peers")
	ports := limitSummary(uniqueStrings(portValues), 3, "all ports")
	return fmt.Sprintf("%d rule%s: %s; %s", ruleCount, pluralSuffix(ruleCount), peers, ports)
}

func boundedNetworkPolicyIngressRules(rules []networkPolicyIngressRule) ([]networkPolicyIngressRule, bool) {
	return rules, len(rules) <= maxNetworkPolicyRules
}

func boundedNetworkPolicyEgressRules(rules []networkPolicyEgressRule) ([]networkPolicyEgressRule, bool) {
	return rules, len(rules) <= maxNetworkPolicyRules
}

func ingressPeers(rules []networkPolicyIngressRule) []string {
	if len(rules) == 0 {
		return nil
	}
	if len(rules) > maxNetworkPolicyRules {
		return []string{"invalid rules"}
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
	if len(rules) > maxNetworkPolicyRules {
		return []string{"invalid rules"}
	}
	values := []string{}
	for _, rule := range rules {
		values = append(values, peerSummaries(rule.To)...)
	}
	return values
}

func validNetworkPolicyPeer(peer networkPolicyPeer) bool {
	if peer.IPBlock != nil {
		return peer.PodSelector == nil && peer.NamespaceSelector == nil && validNetworkPolicyIPBlock(*peer.IPBlock)
	}
	return (peer.PodSelector == nil || validLabelSelector(*peer.PodSelector)) &&
		(peer.NamespaceSelector == nil || validLabelSelector(*peer.NamespaceSelector))
}

func validNetworkPolicyIPBlock(block networkPolicyIPBlock) bool {
	if len(block.Except) > maxNetworkPolicyIPExcept {
		return false
	}
	if _, _, err := net.ParseCIDR(block.CIDR); err != nil {
		return false
	}
	for _, except := range block.Except {
		if _, _, err := net.ParseCIDR(except); err != nil {
			return false
		}
	}
	return true
}

func peerSummaries(peers []networkPolicyPeer) []string {
	if len(peers) == 0 {
		return []string{"all peers"}
	}
	if len(peers) > maxNetworkPolicyPeers {
		return []string{"invalid peers"}
	}

	values := []string{}
	for _, peer := range peers {
		if !validNetworkPolicyPeer(peer) {
			values = append(values, "invalid peer")
			continue
		}
		parts := []string{}
		if peer.NamespaceSelector != nil {
			parts = append(parts, "ns:"+labelSelectorSummaryWithFallback(*peer.NamespaceSelector, "all namespaces"))
		}
		if peer.PodSelector != nil {
			parts = append(parts, "pod:"+labelSelectorSummary(*peer.PodSelector))
		}
		if peer.IPBlock != nil {
			parts = append(parts, "ip:"+peer.IPBlock.CIDR)
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
	if len(rules) > maxNetworkPolicyRules {
		return []string{"invalid rules"}
	}
	values := []string{}
	for _, rule := range rules {
		values = append(values, networkPolicyPortSummaries(rule.Ports)...)
	}
	return values
}

func networkPolicyEgressPortSummaries(rules []networkPolicyEgressRule) []string {
	if len(rules) > maxNetworkPolicyRules {
		return []string{"invalid rules"}
	}
	values := []string{}
	for _, rule := range rules {
		values = append(values, networkPolicyPortSummaries(rule.Ports)...)
	}
	return values
}

func networkPolicyPortSummaries(ports []networkPolicyPort) []string {
	if len(ports) > maxNetworkPolicyPorts {
		return []string{"invalid ports"}
	}
	values := []string{}
	for _, port := range ports {
		value, ok := networkPolicyPortSummary(port)
		if !ok {
			values = append(values, "invalid port")
			continue
		}
		values = append(values, value)
	}
	return values
}

func networkPolicyPortSummary(port networkPolicyPort) (string, bool) {
	protocol := port.Protocol
	if protocol == "" {
		protocol = "TCP"
	}
	if protocol != "TCP" && protocol != "UDP" && protocol != "SCTP" {
		return "", false
	}

	portValue := "*"
	startPort := 0
	switch value := port.Port.(type) {
	case nil:
	case string:
		if !validNetworkPolicyNamedPort(value) {
			return "", false
		}
		portValue = value
	case float64:
		if value != math.Trunc(value) || value < 1 || value > 65535 {
			return "", false
		}
		startPort = int(value)
		portValue = strconv.Itoa(startPort)
	default:
		return "", false
	}

	if port.EndPort != nil {
		if startPort == 0 || *port.EndPort < startPort || *port.EndPort > 65535 {
			return "", false
		}
		portValue = fmt.Sprintf("%s-%d", portValue, *port.EndPort)
	}
	return protocol + ":" + portValue, true
}

func validNetworkPolicyNamedPort(value string) bool {
	if value == "" || len(value) > 15 || !isASCIILowerAlphanumeric(value[0]) || !isASCIILowerAlphanumeric(value[len(value)-1]) {
		return false
	}
	for index := 1; index < len(value)-1; index++ {
		if !isASCIILowerAlphanumeric(value[index]) && value[index] != '-' {
			return false
		}
	}
	return true
}

func labelSelectorSummary(selector labelSelector) string {
	return labelSelectorSummaryWithFallback(selector, "all pods")
}

func labelSelectorSummaryWithFallback(selector labelSelector, fallback string) string {
	if !validLabelSelector(selector) {
		return "invalid selector"
	}
	expressions := len(selector.MatchExpressions)
	if len(selector.MatchLabels) == 0 && expressions == 0 {
		return fallback
	}

	parts := selectorSummaryParts(selector.MatchLabels)
	if expressions > 0 {
		parts = append(parts, fmt.Sprintf("%d expressions", expressions))
	}
	return limitSummary(parts, 4, fallback)
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

func labelsOrEmpty(labels map[string]string) map[string]string {
	if labels == nil {
		return map[string]string{}
	}
	return labels
}
