package provider

import (
	"regexp"
	"sort"
	"strings"
)

const (
	maxWorkloadContainers       = 64
	maxWorkloadContainerEntries = 128
	maxWorkloadImageBytes       = 512
	maxWorkloadSummaryImages    = 8
	maxWorkloadScheduleBytes    = 128
)

var (
	workloadImageNamePattern   = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9._:/-]{0,510}[A-Za-z0-9])?$`)
	workloadImageDigestPattern = regexp.MustCompile(`^[a-z0-9]+(?:[+._-][a-z0-9]+)*:[A-Fa-f0-9]{32,128}$`)
)

type workloadTemplateAnalysis struct {
	valid               bool
	containers          int
	initContainers      int
	images              []string
	serviceAccount      string
	serviceAccountField string
	references          []podReference
}

func analyzeWorkloadTemplate(spec podSpec, sourcePrefix string) workloadTemplateAnalysis {
	analysis := workloadTemplateAnalysis{
		containers:     len(spec.Containers),
		initContainers: len(spec.InitContainers),
	}
	if !validWorkloadPodSpec(spec) {
		return analysis
	}

	seenImages := map[string]bool{}
	for _, current := range append(append([]container(nil), spec.InitContainers...), spec.Containers...) {
		if current.Image == "" || seenImages[current.Image] {
			continue
		}
		seenImages[current.Image] = true
		analysis.images = append(analysis.images, current.Image)
	}
	sort.Strings(analysis.images)
	analysis.references = podSpecRefs(spec, sourcePrefix)
	analysis.serviceAccount = spec.ServiceAccountName
	analysis.serviceAccountField = sourcePrefix + ".serviceAccountName"
	analysis.valid = true
	return analysis
}

func validWorkloadPodSpec(spec podSpec) bool {
	if len(spec.Containers) == 0 || len(spec.Containers) > maxWorkloadContainers ||
		len(spec.InitContainers) > maxWorkloadContainers ||
		len(spec.Containers)+len(spec.InitContainers) > maxWorkloadContainers ||
		len(spec.ImagePullSecret) > maxWorkloadContainerEntries ||
		len(spec.Volumes) > maxWorkloadContainerEntries ||
		(spec.ServiceAccountName != "" && !validKubernetesReferenceName(spec.ServiceAccountName)) {
		return false
	}

	seenNames := map[string]bool{}
	for _, current := range append(append([]container(nil), spec.InitContainers...), spec.Containers...) {
		if !validKubernetesNamespace(current.Name) || seenNames[current.Name] || !validWorkloadImage(current.Image) ||
			len(current.EnvFrom) > maxWorkloadContainerEntries || len(current.Env) > maxWorkloadContainerEntries {
			return false
		}
		seenNames[current.Name] = true
		for _, envFrom := range current.EnvFrom {
			if !validRequiredExclusiveLocalReferences(envFrom.ConfigMapRef, envFrom.SecretRef) {
				return false
			}
		}
		for _, env := range current.Env {
			if env.ValueFrom != nil && !validEnvVarSource(*env.ValueFrom) {
				return false
			}
		}
	}

	for _, reference := range spec.ImagePullSecret {
		if !validKubernetesReferenceName(reference.Name) {
			return false
		}
	}
	for _, volume := range spec.Volumes {
		references := []string{}
		if volume.ConfigMap != nil {
			references = append(references, volume.ConfigMap.Name)
		}
		if volume.Secret != nil {
			references = append(references, volume.Secret.SecretName)
		}
		if volume.PersistentVolumeClaim != nil {
			references = append(references, volume.PersistentVolumeClaim.ClaimName)
		}
		if len(references) > 1 {
			return false
		}
		for _, reference := range references {
			if !validKubernetesReferenceName(reference) {
				return false
			}
		}
	}
	return true
}

func validRequiredExclusiveLocalReferences(values ...*localObjectRef) bool {
	count := 0
	for _, value := range values {
		if value == nil {
			continue
		}
		count++
		if !validKubernetesReferenceName(value.Name) {
			return false
		}
	}
	return count == 1
}

func validEnvVarSource(source envVarSource) bool {
	localSources := 0
	if source.FieldRef != nil {
		localSources++
	}
	if source.ResourceFieldRef != nil {
		localSources++
	}
	referenceSources := 0
	for _, value := range []*localObjectRef{source.ConfigMapKeyRef, source.SecretKeyRef} {
		if value == nil {
			continue
		}
		referenceSources++
		if !validKubernetesReferenceName(value.Name) {
			return false
		}
	}
	return localSources+referenceSources == 1
}

func validWorkloadImage(value string) bool {
	if value == "" {
		return true
	}
	if len(value) > maxWorkloadImageBytes || strings.TrimSpace(value) != value || strings.Contains(value, "://") || strings.ContainsAny(value, "=?#\\") {
		return false
	}
	name := value
	if strings.Count(value, "@") > 1 {
		return false
	}
	if before, digest, found := strings.Cut(value, "@"); found {
		if !workloadImageDigestPattern.MatchString(digest) {
			return false
		}
		name = before
	}
	if !workloadImageNamePattern.MatchString(name) || strings.Contains(name, "//") || strings.Contains(name, "..") {
		return false
	}
	return true
}

func workloadTemplateSummary(analysis workloadTemplateAnalysis) map[string]interface{} {
	if !analysis.valid {
		return map[string]interface{}{
			"containers":     "invalid",
			"initContainers": "invalid",
			"imageCount":     "invalid",
			"images":         []string{},
		}
	}
	images := append([]string(nil), analysis.images...)
	if len(images) > maxWorkloadSummaryImages {
		images = images[:maxWorkloadSummaryImages]
	}
	return map[string]interface{}{
		"containers":     analysis.containers,
		"initContainers": analysis.initContainers,
		"imageCount":     len(analysis.images),
		"images":         images,
	}
}

func addWorkloadTemplateSummary(summary map[string]interface{}, analysis workloadTemplateAnalysis) map[string]interface{} {
	for key, value := range workloadTemplateSummary(analysis) {
		summary[key] = value
	}
	return summary
}

func workloadStatus(base string, analysis workloadTemplateAnalysis) string {
	if !analysis.valid {
		return "warning"
	}
	return base
}

func validReplicaWorkload(replicas *int, status replicaStatus) bool {
	_, valid := desiredReplicaCount(replicas, 1)
	return valid && validReplicaStatus(status)
}

func validDaemonSetWorkload(desired int, ready int) bool {
	return validSummaryCount(desired) && validSummaryCount(ready) && ready <= desired
}

func validJobWorkload(job jobResource) bool {
	_, valid := desiredReplicaCount(job.Spec.Completions, 1)
	return valid && validSummaryCount(job.Status.Active) && validSummaryCount(job.Status.Succeeded) && validSummaryCount(job.Status.Failed)
}

func validCronJobWorkload(cronJob cronJobResource) bool {
	if !validWorkloadSchedule(cronJob.Spec.Schedule) || len(cronJob.Status.Active) > maxWorkloadContainerEntries {
		return false
	}
	for _, reference := range cronJob.Status.Active {
		if reference.Kind != "" && !validKubernetesKind(reference.Kind) ||
			reference.Namespace != "" && !validKubernetesNamespace(reference.Namespace) ||
			!validKubernetesReferenceName(reference.Name) {
			return false
		}
	}
	return true
}

func cronJobActiveSummary(cronJob cronJobResource) interface{} {
	if !validCronJobWorkload(cronJob) {
		return "invalid"
	}
	return len(cronJob.Status.Active)
}

func validWorkloadSchedule(value string) bool {
	if value == "" || len(value) > maxWorkloadScheduleBytes || looksSensitiveMetadataValue(value) {
		return false
	}
	sanitized, ok := safeVisibleText(value, maxWorkloadScheduleBytes)
	return ok && sanitized == value
}

func workloadScheduleSummary(value string) string {
	if !validWorkloadSchedule(value) {
		return "invalid"
	}
	return value
}

func (builder *graphBuilder) addWorkloadTemplateEdges(kind string, resourceMetadata metadata, analysis workloadTemplateAnalysis) {
	if !analysis.valid {
		return
	}
	sourceID := builder.nodeID(kind, resourceMetadata.Namespace, resourceMetadata.Name)
	if analysis.serviceAccount != "" {
		builder.ensureReferenceNode("ServiceAccount", resourceMetadata.Namespace, analysis.serviceAccount)
		builder.addEdge("uses-service-account", sourceID, builder.nodeID("ServiceAccount", resourceMetadata.Namespace, analysis.serviceAccount), analysis.serviceAccountField, "observed")
	}
	for _, reference := range analysis.references {
		builder.ensureReferenceNode(reference.kind, resourceMetadata.Namespace, reference.name)
		builder.addEdge(reference.edgeType, sourceID, builder.nodeID(reference.kind, resourceMetadata.Namespace, reference.name), reference.sourceField, "observed")
	}
}
