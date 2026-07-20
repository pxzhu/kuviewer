package provider

import (
	"encoding/json"
	"net/netip"
	"strings"
)

const (
	maxIngressRules                     = 256
	maxIngressPathsPerRule              = 256
	maxIngressBackendResults            = 512
	maxIngressTLSConfigs                = 64
	maxIngressTLSHostsPerConfig         = 64
	maxIngressTLSHostResults            = 256
	maxIngressLoadBalancerPoints        = 64
	maxIngressLoadBalancerPorts         = 32
	maxIngressLoadBalancerPointJSONSize = 16 * 1024
)

func (point *ingressLoadBalancerPoint) UnmarshalJSON(value []byte) error {
	*point = ingressLoadBalancerPoint{}
	if len(value) == 0 || len(value) > maxIngressLoadBalancerPointJSONSize {
		return nil
	}
	var raw struct {
		IP       string `json:"ip"`
		Hostname string `json:"hostname"`
		Ports    []struct {
			Port     int    `json:"port"`
			Protocol string `json:"protocol"`
			Error    string `json:"error"`
		} `json:"ports"`
	}
	if json.Unmarshal(value, &raw) != nil || len(raw.Ports) > maxIngressLoadBalancerPorts {
		return nil
	}
	hasIP := raw.IP != ""
	hasHostname := raw.Hostname != ""
	if hasIP == hasHostname {
		return nil
	}
	if hasIP {
		address, err := netip.ParseAddr(raw.IP)
		if err != nil || address.Zone() != "" || address.String() != raw.IP {
			return nil
		}
		point.Kind = "ip"
	} else {
		if !validDNSSubdomain(raw.Hostname) {
			return nil
		}
		point.Kind = "hostname"
	}
	for _, port := range raw.Ports {
		if !validPortNumber(port.Port) || !validIngressPortProtocol(port.Protocol) {
			return nil
		}
		if port.Error != "" {
			point.ErrorCount++
		}
	}
	point.PortCount = len(raw.Ports)
	point.Valid = true
	return nil
}

func validIngressSpec(ingress ingressResource) bool {
	if ingress.Spec.IngressClassName != "" && !validKubernetesReferenceName(ingress.Spec.IngressClassName) {
		return false
	}
	if len(ingress.Spec.Rules) == 0 && ingress.Spec.DefaultBackend == nil {
		return false
	}
	if ingress.Spec.DefaultBackend != nil && !validIngressBackend(*ingress.Spec.DefaultBackend) {
		return false
	}
	if len(ingress.Spec.Rules) > maxIngressRules || len(ingress.Spec.TLS) > maxIngressTLSConfigs {
		return false
	}
	backendCount := 0
	if ingress.Spec.DefaultBackend != nil {
		backendCount = 1
	}
	for _, rule := range ingress.Spec.Rules {
		if (rule.Host != "" && !validKubernetesHostname(rule.Host)) || rule.HTTP == nil || len(rule.HTTP.Paths) == 0 || len(rule.HTTP.Paths) > maxIngressPathsPerRule {
			return false
		}
		for _, path := range rule.HTTP.Paths {
			if !validIngressPath(path.Path, path.PathType) || !validIngressBackend(path.Backend) {
				return false
			}
			backendCount++
			if backendCount > maxIngressBackendResults {
				return false
			}
		}
	}
	return validIngressTLSConfigs(ingress.Spec.TLS)
}

func validIngressBackend(backend ingressBackend) bool {
	if (backend.Service == nil) == (backend.Resource == nil) {
		return false
	}
	if backend.Service != nil {
		port := backend.Service.Port
		portValid := (port.Number == 0 && validIANAServiceName(port.Name)) || (port.Name == "" && validPortNumber(port.Number))
		return validKubernetesReferenceName(backend.Service.Name) && portValid
	}
	resource := backend.Resource
	return resource != nil && (resource.APIGroup == "" || validDNSSubdomain(resource.APIGroup)) && validKubernetesKind(resource.Kind) && validKubernetesReferenceName(resource.Name)
}

func validIngressPath(path string, pathType string) bool {
	if pathType != "Exact" && pathType != "Prefix" && pathType != "ImplementationSpecific" {
		return false
	}
	return (path == "" && pathType == "ImplementationSpecific") || (strings.HasPrefix(path, "/") && len(path) <= 2048)
}

func validIngressTLSConfigs(configs []ingressTLSConfig) bool {
	totalHosts := 0
	for _, config := range configs {
		if len(config.Hosts) > maxIngressTLSHostsPerConfig || (config.SecretName != "" && !validKubernetesReferenceName(config.SecretName)) {
			return false
		}
		for _, host := range config.Hosts {
			if !validKubernetesHostname(host) {
				return false
			}
			totalHosts++
			if totalHosts > maxIngressTLSHostResults {
				return false
			}
		}
	}
	return true
}

func validIngressLoadBalancerStatus(ingress ingressResource) bool {
	points := ingress.Status.LoadBalancer.Ingress
	if len(points) > maxIngressLoadBalancerPoints {
		return false
	}
	for _, point := range points {
		if !point.Valid {
			return false
		}
	}
	return true
}

func validIngressPortProtocol(value string) bool {
	return value == "TCP" || value == "UDP" || value == "SCTP"
}

func ingressStatus(ingress ingressResource) string {
	if !validIngressSpec(ingress) || !validIngressLoadBalancerStatus(ingress) {
		return "warning"
	}
	return "healthy"
}

func ingressSummary(ingress ingressResource) map[string]interface{} {
	specValid := validIngressSpec(ingress)
	statusValid := validIngressLoadBalancerStatus(ingress)
	if !specValid {
		return map[string]interface{}{
			"class":                  "invalid",
			"hosts":                  "invalid",
			"rules":                  "invalid",
			"backends":               "invalid",
			"defaultBackend":         "invalid",
			"tls":                    "invalid",
			"tlsHosts":               "invalid",
			"tlsSecrets":             "invalid",
			"loadBalancerAddresses":  ingressLoadBalancerCountSummary(ingress, statusValid, "all"),
			"loadBalancerIPs":        ingressLoadBalancerCountSummary(ingress, statusValid, "ip"),
			"loadBalancerHostnames":  ingressLoadBalancerCountSummary(ingress, statusValid, "hostname"),
			"loadBalancerPorts":      ingressLoadBalancerPortSummary(ingress, statusValid),
			"loadBalancerPortErrors": ingressLoadBalancerPortErrorSummary(ingress, statusValid),
		}
	}
	return map[string]interface{}{
		"class":                  ingressClassSummary(ingress.Spec.IngressClassName),
		"hosts":                  joinSafeSummary(ingressHosts(ingress), 8, ""),
		"rules":                  len(ingress.Spec.Rules),
		"backends":               len(ingressServiceNames(ingress)),
		"defaultBackend":         ingressDefaultBackendSummary(ingress.Spec.DefaultBackend),
		"tls":                    len(ingress.Spec.TLS),
		"tlsHosts":               ingressTLSHostCount(ingress.Spec.TLS),
		"tlsSecrets":             ingressTLSSecretCount(ingress.Spec.TLS),
		"loadBalancerAddresses":  ingressLoadBalancerCountSummary(ingress, statusValid, "all"),
		"loadBalancerIPs":        ingressLoadBalancerCountSummary(ingress, statusValid, "ip"),
		"loadBalancerHostnames":  ingressLoadBalancerCountSummary(ingress, statusValid, "hostname"),
		"loadBalancerPorts":      ingressLoadBalancerPortSummary(ingress, statusValid),
		"loadBalancerPortErrors": ingressLoadBalancerPortErrorSummary(ingress, statusValid),
	}
}

func ingressClassSummary(value string) string {
	if value == "" {
		return "default"
	}
	return value
}

func ingressDefaultBackendSummary(backend *ingressBackend) string {
	if backend == nil {
		return "unset"
	}
	if backend.Service != nil {
		return "Service"
	}
	return "Resource"
}

func ingressTLSHostCount(configs []ingressTLSConfig) int {
	count := 0
	for _, config := range configs {
		count += len(config.Hosts)
	}
	return count
}

func ingressTLSSecretCount(configs []ingressTLSConfig) int {
	count := 0
	for _, config := range configs {
		if config.SecretName != "" {
			count++
		}
	}
	return count
}

func ingressLoadBalancerCountSummary(ingress ingressResource, valid bool, kind string) interface{} {
	if !valid {
		return "invalid"
	}
	count := 0
	for _, point := range ingress.Status.LoadBalancer.Ingress {
		if kind == "all" || point.Kind == kind {
			count++
		}
	}
	return count
}

func ingressLoadBalancerPortSummary(ingress ingressResource, valid bool) interface{} {
	if !valid {
		return "invalid"
	}
	count := 0
	for _, point := range ingress.Status.LoadBalancer.Ingress {
		count += point.PortCount
	}
	return count
}

func ingressLoadBalancerPortErrorSummary(ingress ingressResource, valid bool) interface{} {
	if !valid {
		return "invalid"
	}
	count := 0
	for _, point := range ingress.Status.LoadBalancer.Ingress {
		count += point.ErrorCount
	}
	return count
}

func ingressServiceNames(ingress ingressResource) []string {
	if !validIngressSpec(ingress) {
		return nil
	}
	names := []string{}
	if ingress.Spec.DefaultBackend != nil && ingress.Spec.DefaultBackend.Service != nil {
		names = append(names, ingress.Spec.DefaultBackend.Service.Name)
	}
	for _, rule := range ingress.Spec.Rules {
		for _, path := range rule.HTTP.Paths {
			if path.Backend.Service != nil {
				names = append(names, path.Backend.Service.Name)
			}
		}
	}
	return uniqueStrings(names)
}

func ingressHosts(ingress ingressResource) []string {
	if !validIngressSpec(ingress) {
		return nil
	}
	hosts := []string{}
	for _, rule := range ingress.Spec.Rules {
		if rule.Host != "" {
			hosts = append(hosts, rule.Host)
		}
	}
	return uniqueStrings(hosts)
}
