package provider

import (
	"sort"

	"kuviewer/server/internal/topology"
)

const (
	maxSnapshotDiagnosticInputs = 256
	maxSnapshotDiagnostics      = 64
	maxSnapshotDiagnosticCount  = 1_000_000
)

type snapshotResourceDescriptor struct {
	id       string
	resource string
}

var snapshotResourceDescriptors = map[string]snapshotResourceDescriptor{
	"ConfigMap":                {id: "snapshot/configmaps", resource: "ConfigMaps"},
	"CronJob":                  {id: "snapshot/cronjobs", resource: "CronJobs"},
	"CustomResource":           {id: "snapshot/custom-resources", resource: "Custom resources"},
	"CustomResourceDefinition": {id: "snapshot/crds", resource: "CustomResourceDefinitions"},
	"DaemonSet":                {id: "snapshot/daemonsets", resource: "DaemonSets"},
	"Deployment":               {id: "snapshot/deployments", resource: "Deployments"},
	"Gateway":                  {id: "snapshot/gateways", resource: "Gateways"},
	"GRPCRoute":                {id: "snapshot/grpcroutes", resource: "GRPCRoutes"},
	"HorizontalPodAutoscaler":  {id: "snapshot/hpas", resource: "HorizontalPodAutoscalers"},
	"HTTPRoute":                {id: "snapshot/httproutes", resource: "HTTPRoutes"},
	"Ingress":                  {id: "snapshot/ingresses", resource: "Ingresses"},
	"Job":                      {id: "snapshot/jobs", resource: "Jobs"},
	"Namespace":                {id: "snapshot/namespaces", resource: "Namespaces"},
	"NetworkPolicy":            {id: "snapshot/networkpolicies", resource: "NetworkPolicies"},
	"Node":                     {id: "snapshot/nodes", resource: "Nodes"},
	"PersistentVolume":         {id: "snapshot/pvs", resource: "PersistentVolumes"},
	"PersistentVolumeClaim":    {id: "snapshot/pvcs", resource: "PersistentVolumeClaims"},
	"Pod":                      {id: "snapshot/pods", resource: "Pods"},
	"ReplicaSet":               {id: "snapshot/replicasets", resource: "ReplicaSets"},
	"Service":                  {id: "snapshot/services", resource: "Services"},
	"ServiceAccount":           {id: "snapshot/serviceaccounts", resource: "ServiceAccounts"},
	"StatefulSet":              {id: "snapshot/statefulsets", resource: "StatefulSets"},
	"StorageClass":             {id: "snapshot/storageclasses", resource: "StorageClasses"},
	"TCPRoute":                 {id: "snapshot/tcproutes", resource: "TCPRoutes"},
	"TLSRoute":                 {id: "snapshot/tlsroutes", resource: "TLSRoutes"},
}

var snapshotDiagnosticReasons = map[string]bool{
	"api_unavailable":          true,
	"forbidden":                true,
	"invalid_item":             true,
	"invalid_response":         true,
	"pagination_byte_limit":    true,
	"pagination_incomplete":    true,
	"pagination_item_limit":    true,
	"pagination_page_limit":    true,
	"pagination_token_invalid": true,
	"request_failed":           true,
	"request_invalid":          true,
	"response_read_failed":     true,
	"response_too_large":       true,
}

var snapshotDiagnosticResources = map[string]bool{
	"ConfigMaps":                true,
	"CronJobs":                  true,
	"Custom resources":          true,
	"CustomResourceDefinitions": true,
	"DaemonSets":                true,
	"Deployments":               true,
	"EndpointSlices":            true,
	"Gateways":                  true,
	"GRPCRoutes":                true,
	"HorizontalPodAutoscalers":  true,
	"HTTPRoutes":                true,
	"Ingresses":                 true,
	"Jobs":                      true,
	"Kubernetes version":        true,
	"Namespaces":                true,
	"NetworkPolicies":           true,
	"Nodes":                     true,
	"PersistentVolumeClaims":    true,
	"PersistentVolumes":         true,
	"Pods":                      true,
	"ReplicaSets":               true,
	"Resources":                 true,
	"ServiceAccounts":           true,
	"Services":                  true,
	"StatefulSets":              true,
	"StorageClasses":            true,
	"TCPRoutes":                 true,
	"TLSRoutes":                 true,
}

func (b *graphBuilder) recordResourceIssue(kind string) {
	descriptor, exists := snapshotResourceDescriptors[kind]
	if !exists {
		descriptor = snapshotResourceDescriptor{id: "snapshot/resources", resource: "Resources"}
	}
	if b.resourceIssueCount[descriptor.id] < maxSnapshotDiagnosticCount {
		b.resourceIssueCount[descriptor.id]++
	}
}

func (b *graphBuilder) resourceIssueDiagnostics() []topology.SnapshotDiagnostic {
	ids := make([]string, 0, len(b.resourceIssueCount))
	for id := range b.resourceIssueCount {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	diagnostics := make([]topology.SnapshotDiagnostic, 0, len(ids))
	for _, id := range ids {
		descriptor := snapshotResourceDescriptor{id: id, resource: "Resources"}
		for _, candidate := range snapshotResourceDescriptors {
			if candidate.id == id {
				descriptor = candidate
				break
			}
		}
		diagnostics = append(diagnostics, topology.SnapshotDiagnostic{
			ID:       descriptor.id,
			Resource: descriptor.resource,
			Reason:   "invalid_item",
			Count:    b.resourceIssueCount[id],
		})
	}
	return diagnostics
}

func (b *graphBuilder) replaceNodeSummary(id string, summary map[string]interface{}) {
	if id == "" || !b.nodeSet[id] {
		return
	}
	for index := range b.nodes {
		if b.nodes[index].ID == id {
			b.nodes[index].Summary = safeSummaryMap(summary)
			return
		}
	}
}

func safeSnapshotDiagnostics(values []topology.SnapshotDiagnostic) []topology.SnapshotDiagnostic {
	if len(values) > maxSnapshotDiagnosticInputs {
		values = values[:maxSnapshotDiagnosticInputs]
	}
	valid := make([]topology.SnapshotDiagnostic, 0, len(values))
	for _, value := range values {
		if !validSnapshotDiagnosticID(value.ID) || !validSnapshotDiagnosticResource(value.Resource) || !snapshotDiagnosticReasons[value.Reason] {
			continue
		}
		count := value.Count
		if count < 1 {
			count = 1
		}
		if count > maxSnapshotDiagnosticCount {
			count = maxSnapshotDiagnosticCount
		}
		valid = append(valid, topology.SnapshotDiagnostic{ID: value.ID, Resource: value.Resource, Reason: value.Reason, Count: count})
	}
	valid = aggregateSnapshotDiagnostics(valid)
	for index := range valid {
		if valid[index].Count > maxSnapshotDiagnosticCount {
			valid[index].Count = maxSnapshotDiagnosticCount
		}
	}
	if len(valid) > maxSnapshotDiagnostics {
		valid = valid[:maxSnapshotDiagnostics]
	}
	return valid
}

func validSnapshotDiagnosticID(value string) bool {
	if value == "" || len(value) > 128 || value[0] < 'a' || value[0] > 'z' {
		return false
	}
	for index := 1; index < len(value); index++ {
		character := value[index]
		if !(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') && character != '-' && character != '/' {
			return false
		}
	}
	return true
}

func validSnapshotDiagnosticResource(value string) bool {
	return snapshotDiagnosticResources[value]
}
