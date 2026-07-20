package provider

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var hpaQuantityPattern = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+|[numkKMGTPE](?:i)?)?$`)

const (
	maxHPAMetrics        = 64
	maxHPAConditions     = 16
	maxHPAMetricJSONSize = 16 * 1024
	maxHPAQuantityBytes  = 64
	maxHPAMetricName     = 253
	maxHPAUtilization    = 1_000_000
)

type hpaMetricTargetMarker struct {
	valid bool
	kind  string
}

type hpaMetricCurrentMarker struct {
	valid bool
	kind  string
}

type hpaQuantityMarker struct {
	set   bool
	valid bool
}

func (metric *hpaMetricSpec) UnmarshalJSON(value []byte) error {
	*metric = hpaMetricSpec{}
	if len(value) == 0 || len(value) > maxHPAMetricJSONSize {
		return nil
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(value, &raw) != nil {
		return nil
	}
	sourceType, valid := hpaMetricType(raw["type"])
	if !valid || !onlyHPAMetricSource(raw, sourceType) {
		return nil
	}
	target, valid := decodeHPAMetricSource(raw[sourceFieldForHPAType(sourceType)], sourceType, false)
	if !valid {
		return nil
	}
	metric.Valid = true
	metric.SourceType = sourceType
	metric.TargetType = target
	return nil
}

func (metric *hpaMetricStatus) UnmarshalJSON(value []byte) error {
	*metric = hpaMetricStatus{}
	if len(value) == 0 || len(value) > maxHPAMetricJSONSize {
		return nil
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(value, &raw) != nil {
		return nil
	}
	sourceType, valid := hpaMetricType(raw["type"])
	if !valid || !onlyHPAMetricSource(raw, sourceType) {
		return nil
	}
	current, valid := decodeHPAMetricSource(raw[sourceFieldForHPAType(sourceType)], sourceType, true)
	if !valid {
		return nil
	}
	metric.Valid = true
	metric.SourceType = sourceType
	metric.CurrentType = current
	return nil
}

func hpaMetricType(value json.RawMessage) (string, bool) {
	var metricType string
	if json.Unmarshal(value, &metricType) != nil {
		return "", false
	}
	switch metricType {
	case "ContainerResource", "External", "Object", "Pods", "Resource":
		return metricType, true
	default:
		return "", false
	}
}

func onlyHPAMetricSource(raw map[string]json.RawMessage, sourceType string) bool {
	want := sourceFieldForHPAType(sourceType)
	for _, field := range []string{"containerResource", "external", "object", "pods", "resource"} {
		_, set := raw[field]
		if set != (field == want) {
			return false
		}
	}
	return true
}

func sourceFieldForHPAType(sourceType string) string {
	return strings.ToLower(sourceType[:1]) + sourceType[1:]
}

func decodeHPAMetricSource(value json.RawMessage, sourceType string, status bool) (string, bool) {
	if len(value) == 0 || len(value) > maxHPAMetricJSONSize {
		return "", false
	}
	var source struct {
		Name            string                  `json:"name"`
		Container       string                  `json:"container"`
		Metric          hpaMetricIdentifier     `json:"metric"`
		DescribedObject hpaScaleTargetReference `json:"describedObject"`
		Target          json.RawMessage         `json:"target"`
		Current         json.RawMessage         `json:"current"`
	}
	if json.Unmarshal(value, &source) != nil {
		return "", false
	}
	if !validHPAMetricSourceIdentity(sourceType, source) {
		return "", false
	}
	if status {
		return decodeHPAMetricCurrent(source.Current, sourceType)
	}
	return decodeHPAMetricTarget(source.Target, sourceType)
}

type hpaMetricIdentifier struct {
	Name     string         `json:"name"`
	Selector *labelSelector `json:"selector"`
}

func validHPAMetricSourceIdentity(sourceType string, source struct {
	Name            string                  `json:"name"`
	Container       string                  `json:"container"`
	Metric          hpaMetricIdentifier     `json:"metric"`
	DescribedObject hpaScaleTargetReference `json:"describedObject"`
	Target          json.RawMessage         `json:"target"`
	Current         json.RawMessage         `json:"current"`
}) bool {
	switch sourceType {
	case "Resource":
		return validHPAMetricName(source.Name) && source.Container == "" && source.Metric.Name == ""
	case "ContainerResource":
		return validHPAMetricName(source.Name) && validKubernetesNamespace(source.Container) && source.Metric.Name == ""
	case "Pods", "External":
		return source.Name == "" && source.Container == "" && validHPAMetricIdentifier(source.Metric)
	case "Object":
		return source.Name == "" && source.Container == "" && validHPAMetricIdentifier(source.Metric) && validHPAScaleTarget(source.DescribedObject)
	default:
		return false
	}
}

func validHPAMetricIdentifier(identifier hpaMetricIdentifier) bool {
	return validHPAMetricName(identifier.Name) && (identifier.Selector == nil || validLabelSelector(*identifier.Selector))
}

func validHPAMetricName(value string) bool {
	if value == "" || len(value) > maxHPAMetricName {
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

func decodeHPAMetricTarget(value json.RawMessage, sourceType string) (string, bool) {
	var raw struct {
		Type               string            `json:"type"`
		Value              hpaQuantityMarker `json:"value"`
		AverageValue       hpaQuantityMarker `json:"averageValue"`
		AverageUtilization *int              `json:"averageUtilization"`
	}
	if len(value) == 0 || json.Unmarshal(value, &raw) != nil {
		return "", false
	}
	utilization := raw.AverageUtilization != nil && *raw.AverageUtilization > 0 && *raw.AverageUtilization <= maxHPAUtilization
	if raw.Value.set && !raw.Value.valid || raw.AverageValue.set && !raw.AverageValue.valid || raw.AverageUtilization != nil && !utilization {
		return "", false
	}
	switch raw.Type {
	case "Utilization":
		return raw.Type, utilization && !raw.Value.set && !raw.AverageValue.set && (sourceType == "Resource" || sourceType == "ContainerResource")
	case "Value":
		return raw.Type, raw.Value.valid && !raw.AverageValue.set && raw.AverageUtilization == nil && (sourceType == "Object" || sourceType == "External")
	case "AverageValue":
		return raw.Type, raw.AverageValue.valid && !raw.Value.set && raw.AverageUtilization == nil
	default:
		return "", false
	}
}

func decodeHPAMetricCurrent(value json.RawMessage, sourceType string) (string, bool) {
	var raw struct {
		Value              hpaQuantityMarker `json:"value"`
		AverageValue       hpaQuantityMarker `json:"averageValue"`
		AverageUtilization *int              `json:"averageUtilization"`
	}
	if len(value) == 0 || json.Unmarshal(value, &raw) != nil {
		return "", false
	}
	utilization := raw.AverageUtilization != nil && *raw.AverageUtilization >= 0 && *raw.AverageUtilization <= maxHPAUtilization
	if raw.Value.set && !raw.Value.valid || raw.AverageValue.set && !raw.AverageValue.valid || raw.AverageUtilization != nil && !utilization {
		return "", false
	}
	set := 0
	kind := ""
	if raw.Value.valid {
		set++
		kind = "value"
	}
	if raw.AverageValue.valid {
		set++
		kind = "averageValue"
	}
	if utilization {
		set++
		kind = "utilization"
	}
	if set != 1 || !validHPACurrentType(sourceType, kind) {
		return "", false
	}
	return kind, true
}

func validHPACurrentType(sourceType string, kind string) bool {
	switch sourceType {
	case "Resource", "ContainerResource":
		return kind == "averageValue" || kind == "utilization"
	case "Pods":
		return kind == "averageValue"
	case "Object", "External":
		return kind == "value" || kind == "averageValue"
	default:
		return false
	}
}

func (quantity *hpaQuantityMarker) UnmarshalJSON(value []byte) error {
	*quantity = hpaQuantityMarker{set: true}
	var raw string
	if len(value) == 0 || len(value) > maxHPAQuantityBytes+2 || json.Unmarshal(value, &raw) != nil || len(raw) == 0 || len(raw) > maxHPAQuantityBytes {
		return nil
	}
	quantity.valid = hpaQuantityPattern.MatchString(raw)
	return nil
}

func validHPASpec(hpa horizontalPodAutoscalerResource) bool {
	if !validHPAScaleTarget(hpa.Spec.ScaleTargetRef) || hpa.Spec.MaxReplicas == nil || len(hpa.Spec.Metrics) > maxHPAMetrics {
		return false
	}
	minimum, valid := desiredReplicaCount(hpa.Spec.MinReplicas, 1)
	maximum := *hpa.Spec.MaxReplicas
	if !valid || minimum < 0 || maximum <= 0 || !validSummaryCount(maximum) || minimum > maximum {
		return false
	}
	hasScaleToZeroMetric := false
	for _, metric := range hpa.Spec.Metrics {
		if !metric.Valid {
			return false
		}
		if metric.SourceType == "Object" || metric.SourceType == "External" {
			hasScaleToZeroMetric = true
		}
	}
	return minimum != 0 || hasScaleToZeroMetric
}

func validHPAStatus(hpa horizontalPodAutoscalerResource) bool {
	if hpa.Status.CurrentReplicas == nil || hpa.Status.DesiredReplicas == nil || !validSummaryCount(*hpa.Status.CurrentReplicas) || !validSummaryCount(*hpa.Status.DesiredReplicas) || len(hpa.Status.CurrentMetrics) > maxHPAMetrics || len(hpa.Status.Conditions) > maxHPAConditions {
		return false
	}
	for _, metric := range hpa.Status.CurrentMetrics {
		if !metric.Valid {
			return false
		}
	}
	seenConditions := map[string]bool{}
	for _, item := range hpa.Status.Conditions {
		if (item.Type != "AbleToScale" && item.Type != "ScalingActive" && item.Type != "ScalingLimited") || !validConditionStatus(item.Status) || seenConditions[item.Type] {
			return false
		}
		seenConditions[item.Type] = true
	}
	return true
}

func validHPAScaleTarget(target hpaScaleTargetReference) bool {
	return validKubernetesAPIVersion(target.APIVersion) && validKubernetesKind(target.Kind) && validKubernetesReferenceName(target.Name)
}

func validKubernetesAPIVersion(value string) bool {
	if value == "v1" {
		return true
	}
	parts := strings.Split(value, "/")
	return len(parts) == 2 && validDNSSubdomain(parts[0]) && validKubernetesVersion(parts[1])
}

func validKubernetesVersion(value string) bool {
	if len(value) < 2 || len(value) > 63 || value[0] != 'v' {
		return false
	}
	for index := 1; index < len(value); index++ {
		if !isASCIILowerAlphanumeric(value[index]) {
			return false
		}
	}
	return true
}

func hpaStatus(hpa horizontalPodAutoscalerResource) string {
	if !validHPASpec(hpa) || !validHPAStatus(hpa) {
		return "warning"
	}
	for _, item := range hpa.Status.Conditions {
		if (item.Type == "AbleToScale" || item.Type == "ScalingActive") && item.Status != "True" {
			return "warning"
		}
	}
	if *hpa.Status.DesiredReplicas == 0 || *hpa.Status.CurrentReplicas >= *hpa.Status.DesiredReplicas {
		return "healthy"
	}
	return "warning"
}

func hpaSummary(hpa horizontalPodAutoscalerResource) map[string]interface{} {
	specValid := validHPASpec(hpa)
	statusValid := validHPAStatus(hpa)
	summary := map[string]interface{}{
		"target":         "invalid",
		"range":          "invalid",
		"metrics":        "invalid",
		"metricTypes":    "invalid",
		"metricTargets":  "invalid",
		"replicas":       "invalid",
		"currentMetrics": "invalid",
		"currentTypes":   "invalid",
		"currentValues":  "invalid",
		"conditions":     "invalid",
	}
	if specValid {
		summary["target"] = kubernetesScaleTargetSummary(hpa.Spec.ScaleTargetRef.Kind, hpa.Spec.ScaleTargetRef.Name)
		summary["range"] = formatHPAReplicaRange(hpa.Spec.MinReplicas, hpa.Spec.MaxReplicas)
		summary["metrics"] = len(hpa.Spec.Metrics)
		summary["metricTypes"] = hpaMetricSummary(hpa.Spec.Metrics, func(metric hpaMetricSpec) string { return metric.SourceType })
		summary["metricTargets"] = hpaMetricSummary(hpa.Spec.Metrics, func(metric hpaMetricSpec) string { return metric.TargetType })
	}
	if statusValid {
		summary["replicas"] = formatReplicas(*hpa.Status.CurrentReplicas, *hpa.Status.DesiredReplicas)
		summary["currentMetrics"] = len(hpa.Status.CurrentMetrics)
		summary["currentTypes"] = hpaStatusMetricSummary(hpa.Status.CurrentMetrics, func(metric hpaMetricStatus) string { return metric.SourceType })
		summary["currentValues"] = hpaStatusMetricSummary(hpa.Status.CurrentMetrics, func(metric hpaMetricStatus) string { return metric.CurrentType })
		summary["conditions"] = conditionSummary(hpa.Status.Conditions)
	}
	return summary
}

func formatHPAReplicaRange(minimum *int, maximum *int) string {
	if maximum == nil {
		return "invalid"
	}
	return formatReplicaRange(minimum, *maximum)
}

func hpaMetricSummary(metrics []hpaMetricSpec, value func(hpaMetricSpec) string) string {
	counts := map[string]int{}
	for _, metric := range metrics {
		counts[value(metric)]++
	}
	return countSummary(counts)
}

func hpaStatusMetricSummary(metrics []hpaMetricStatus, value func(hpaMetricStatus) string) string {
	counts := map[string]int{}
	for _, metric := range metrics {
		counts[value(metric)]++
	}
	return countSummary(counts)
}

func countSummary(counts map[string]int) string {
	if len(counts) == 0 {
		return ""
	}
	keys := make([]string, 0, len(counts))
	for key := range counts {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	values := make([]string, 0, len(keys))
	for _, key := range keys {
		values = append(values, fmt.Sprintf("%s:%d", key, counts[key]))
	}
	return strings.Join(values, ",")
}
