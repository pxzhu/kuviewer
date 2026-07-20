package provider

import (
	"fmt"
	"sort"
	"time"
)

const (
	maxConditionSummaryItems = 64
	maxContainerSummaryItems = 256
	maxOwnerSummaryItems     = 64
)

func conditionSummary(conditions []condition) string {
	if len(conditions) == 0 {
		return ""
	}
	if len(conditions) > maxConditionSummaryItems {
		return "invalid conditions"
	}
	values := make([]string, 0, len(conditions))
	for _, condition := range conditions {
		if !validConditionType(condition.Type) || !validConditionStatus(condition.Status) {
			continue
		}
		values = append(values, condition.Type+"="+condition.Status)
	}
	sort.Strings(values)
	return limitSummary(uniqueStrings(values), 8, "")
}

func validConditionType(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for index := 0; index < len(value); index++ {
		character := value[index]
		if !isASCIIAlphanumeric(character) && character != '-' && character != '_' && character != '.' && character != '/' {
			return false
		}
	}
	return true
}

func validConditionStatus(value string) bool {
	return value == "True" || value == "False" || value == "Unknown"
}

func deploymentStatus(deployment deploymentResource) string {
	desired, valid := desiredReplicaCount(deployment.Spec.Replicas, 1)
	if valid && validReplicaStatus(deployment.Status) && deployment.Status.AvailableReplicas >= desired {
		return "healthy"
	}
	return "warning"
}

func replicaSetStatus(replicaSet replicaSetResource) string {
	desired, valid := desiredReplicaCount(replicaSet.Spec.Replicas, 1)
	if valid && validReplicaStatus(replicaSet.Status) && replicaSet.Status.ReadyReplicas >= desired {
		return "healthy"
	}
	return "warning"
}

func statefulSetStatus(statefulSet statefulSetResource) string {
	desired, valid := desiredReplicaCount(statefulSet.Spec.Replicas, 1)
	if valid && validReplicaStatus(statefulSet.Status) && statefulSet.Status.ReadyReplicas >= desired {
		return "healthy"
	}
	return "warning"
}

func desiredReplicaCount(value *int, fallback int) (int, bool) {
	if value == nil {
		return fallback, validSummaryCount(fallback)
	}
	return *value, validSummaryCount(*value)
}

func validReplicaStatus(status replicaStatus) bool {
	return validSummaryCount(status.Replicas) && validSummaryCount(status.ReadyReplicas) && validSummaryCount(status.AvailableReplicas) &&
		status.ReadyReplicas <= status.Replicas && status.AvailableReplicas <= status.Replicas
}

func daemonSetStatus(daemonSet daemonSetResource) string {
	if validDaemonSetWorkload(daemonSet.Status.DesiredNumberScheduled, daemonSet.Status.NumberReady) && daemonSet.Status.NumberReady >= daemonSet.Status.DesiredNumberScheduled {
		return "healthy"
	}
	return "warning"
}

func jobStatus(job jobResource) string {
	if !validSummaryCount(job.Status.Active) || !validSummaryCount(job.Status.Succeeded) || !validSummaryCount(job.Status.Failed) {
		return "warning"
	}
	if job.Status.Failed > 0 {
		return "error"
	}
	desired, valid := desiredReplicaCount(job.Spec.Completions, 1)
	if valid && job.Status.Succeeded >= desired {
		return "healthy"
	}
	return "warning"
}

func containerNames(containers []container) []string {
	if len(containers) > maxContainerSummaryItems {
		return []string{}
	}
	names := make([]string, 0, len(containers))
	for _, container := range containers {
		if validKubernetesNamespace(container.Name) {
			names = append(names, container.Name)
		}
	}
	return uniqueStrings(names)
}

func formatReplicas(ready int, desired int) string {
	if !validSummaryCount(ready) || !validSummaryCount(desired) {
		return "invalid"
	}
	return fmt.Sprintf("%d/%d", ready, desired)
}

func formatReplicaSummary(ready int, desired *int, fallback int) string {
	count, valid := desiredReplicaCount(desired, fallback)
	if !valid {
		return "invalid"
	}
	return formatReplicas(ready, count)
}

func summaryCount(value int) interface{} {
	if !validSummaryCount(value) {
		return "invalid"
	}
	return value
}

func summaryOptionalCount(value *int, fallback int) interface{} {
	count, valid := desiredReplicaCount(value, fallback)
	if !valid {
		return "invalid"
	}
	return count
}

func formatReplicaRange(minimum *int, maximum int) string {
	minValue, valid := desiredReplicaCount(minimum, 1)
	if !valid || !validSummaryCount(maximum) || minValue > maximum {
		return "invalid"
	}
	return fmt.Sprintf("%d-%d", minValue, maximum)
}

func validSummaryCount(value int) bool {
	return value >= 0 && int64(value) <= maxSummaryInteger
}

func boolSummary(value *bool) string {
	if value == nil {
		return "unset"
	}
	if *value {
		return "true"
	}
	return "false"
}

func age(timestamp string) string {
	if timestamp == "" {
		return "unknown"
	}
	createdAt, err := time.Parse(time.RFC3339, timestamp)
	if err != nil || createdAt.After(time.Now().Add(time.Minute)) {
		return "unknown"
	}
	return time.Since(createdAt).Round(time.Hour).String()
}

func ownerSummaries(owners []ownerReference) []string {
	if len(owners) == 0 || len(owners) > maxOwnerSummaryItems {
		return []string{}
	}
	values := make([]string, 0, len(owners))
	for _, owner := range owners {
		if !validKubernetesKind(owner.Kind) || !validKubernetesReferenceName(owner.Name) {
			continue
		}
		values = append(values, owner.Kind+"/"+owner.Name)
	}
	return uniqueStrings(values)
}

func boundedOwnerReferences(owners []ownerReference) []ownerReference {
	if len(owners) > maxOwnerSummaryItems {
		return nil
	}
	return owners
}

func joinSafeSummary(values []string, limit int, fallback string) string {
	return limitSummary(uniqueStrings(values), limit, fallback)
}
