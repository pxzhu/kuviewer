package provider

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"kuviewer/server/internal/topology"
)

type customResourceReference struct {
	kind        string
	namespace   string
	name        string
	sourceField string
}

const (
	maxCustomResourceReferences          = 80
	maxCustomResourceReferenceDepth      = 24
	maxCustomResourceReferenceVisits     = 4096
	maxCustomResourceReferenceCollection = 256
	maxCustomResourceReferencePathBytes  = 512
	maxCustomResourceReferenceSegment    = 64
)

type customResourceReferenceTraversal struct {
	references []customResourceReference
	seen       map[string]struct{}
	visits     int
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
		resourcePath := customResourceListPath(crd, version)
		if resourcePath == "" || crd.Spec.Names.Kind == "" || len(crd.Spec.Names.Kind) > 80 {
			continue
		}
		itemIndex := index
		definition := crd
		selectedVersion := version
		selectedPath := resourcePath
		tasks = append(tasks, snapshotFetchTask{
			id:       "extensions/custom-resources",
			resource: "Custom resources",
			fetch: func() error {
				list := customResourceInstanceList{}
				found, err := getKubeListJSONStatus(ctx, p.client, selectedPath, &list, true)
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
	if !validKubernetesAPIPathSegment(crd.Spec.Group, true, 253) || !validKubernetesAPIPathSegment(version, false, 63) || !validKubernetesAPIPathSegment(crd.Spec.Names.Plural, false, 63) {
		return ""
	}
	return "/apis/" + url.PathEscape(crd.Spec.Group) + "/" + url.PathEscape(version) + "/" + url.PathEscape(crd.Spec.Names.Plural)
}

func validKubernetesAPIPathSegment(value string, allowDots bool, limit int) bool {
	if value == "" || len(value) > limit {
		return false
	}
	for index, character := range value {
		isAlphaNumeric := (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9')
		if isAlphaNumeric || character == '-' || (allowDots && character == '.') {
			if (index == 0 || index == len(value)-1) && !isAlphaNumeric {
				return false
			}
			continue
		}
		return false
	}
	return true
}

func customResourceReferences(spec map[string]interface{}, defaultNamespace string, source customResourceInstance, crds customResourceDefinitionList) []customResourceReference {
	state := customResourceReferenceTraversal{seen: map[string]struct{}{}}
	state.collect(spec, "spec", 0, defaultNamespace, source, crds)
	sort.SliceStable(state.references, func(i, j int) bool {
		left := state.references[i]
		right := state.references[j]
		if left.sourceField != right.sourceField {
			return left.sourceField < right.sourceField
		}
		if left.kind != right.kind {
			return left.kind < right.kind
		}
		if left.namespace != right.namespace {
			return left.namespace < right.namespace
		}
		return left.name < right.name
	})
	return append([]customResourceReference(nil), state.references...)
}

func (state *customResourceReferenceTraversal) collect(value interface{}, path string, depth int, defaultNamespace string, source customResourceInstance, crds customResourceDefinitionList) {
	if value == nil || len(state.references) >= maxCustomResourceReferences || depth > maxCustomResourceReferenceDepth || state.visits >= maxCustomResourceReferenceVisits || len(path) > maxCustomResourceReferencePathBytes {
		return
	}
	state.visits++
	switch typed := value.(type) {
	case []interface{}:
		for index, item := range typed {
			if index >= maxCustomResourceReferenceCollection || len(state.references) >= maxCustomResourceReferences {
				break
			}
			state.collect(item, fmt.Sprintf("%s[%d]", path, index), depth+1, defaultNamespace, source, crds)
		}
	case map[string]interface{}:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		if len(keys) > maxCustomResourceReferenceCollection {
			keys = keys[:maxCustomResourceReferenceCollection]
		}
		for _, key := range keys {
			if len(state.references) >= maxCustomResourceReferences {
				break
			}
			child := typed[key]
			childPath := path + "." + safeCustomResourceReferencePathSegment(key)
			if len(childPath) > maxCustomResourceReferencePathBytes {
				continue
			}
			fallbackKind := customResourceReferenceKindFromKey(key)
			if isCustomResourceReferenceField(key) {
				if childObject, ok := child.(map[string]interface{}); ok {
					if ref, ok := customResourceReferenceFromObject(childObject, fallbackKind, childPath, defaultNamespace, source, crds); ok {
						state.add(ref)
					}
				}
				if childList, ok := child.([]interface{}); ok {
					for index, item := range childList {
						if index >= maxCustomResourceReferenceCollection || len(state.references) >= maxCustomResourceReferences {
							break
						}
						if childObject, ok := item.(map[string]interface{}); ok {
							if ref, ok := customResourceReferenceFromObject(childObject, fallbackKind, fmt.Sprintf("%s[%d]", childPath, index), defaultNamespace, source, crds); ok {
								state.add(ref)
							}
						}
					}
				}
			}
			if nameKind := customResourceReferenceKindFromNameKey(key); nameKind != "" {
				if name, ok := child.(string); ok && strings.TrimSpace(name) != "" {
					state.add(customResourceReference{
						kind:        nameKind,
						namespace:   targetNamespaceForKind(nameKind, stringValue(typed["namespace"], defaultNamespace), source.CRDScope),
						name:        strings.TrimSpace(name),
						sourceField: childPath,
					})
				}
			}
			state.collect(child, childPath, depth+1, defaultNamespace, source, crds)
		}
	}
}

func (state *customResourceReferenceTraversal) add(reference customResourceReference) {
	if len(state.references) >= maxCustomResourceReferences || !validCustomResourceReferenceIdentity(reference) || len(reference.sourceField) > maxCustomResourceReferencePathBytes {
		return
	}
	key := reference.kind + "\x00" + reference.namespace + "\x00" + reference.name + "\x00" + reference.sourceField
	if _, exists := state.seen[key]; exists {
		return
	}
	state.seen[key] = struct{}{}
	state.references = append(state.references, reference)
}

func validCustomResourceReferenceIdentity(reference customResourceReference) bool {
	if !knownResourceKind(reference.kind) {
		return false
	}
	if reference.namespace != "" && !validKubernetesAPIPathSegment(reference.namespace, false, 63) {
		return false
	}
	if reference.kind == "CustomResource" {
		parts := strings.SplitN(reference.name, ":", 2)
		if len(parts) != 2 || !validCustomResourceKind(parts[0]) || !validKubernetesAPIPathSegment(parts[1], true, 253) {
			return false
		}
		return true
	}
	return validKubernetesAPIPathSegment(reference.name, true, 253)
}

func validCustomResourceKind(value string) bool {
	if value == "" || len(value) > 80 {
		return false
	}
	for _, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') {
			continue
		}
		return false
	}
	return true
}

func safeCustomResourceReferencePathSegment(value string) string {
	if value == "" || len(value) > maxCustomResourceReferenceSegment {
		return "field"
	}
	for _, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '_' || character == '-' {
			continue
		}
		return "field"
	}
	return value
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
