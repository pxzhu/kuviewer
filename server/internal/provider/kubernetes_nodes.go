package provider

import (
	"regexp"
	"strconv"
	"strings"
)

const (
	maxNodeResourceEntries = 128
	maxNodeVersionBytes    = 64
)

var (
	nodeQuantityPattern       = regexp.MustCompile(`^[0-9]+(?:\.[0-9]+)?(?:n|u|m|k|K|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei|[eE][+-]?[0-9]+)?$`)
	nodeKubeletVersionPattern = regexp.MustCompile(`^v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$`)
	nodeRuntimePattern        = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,31}://[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$`)
	nodeArchitecturePattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)
)

type nodeStatusAnalysis struct {
	valid    bool
	observed bool
	ready    bool
	summary  map[string]interface{}
}

func analyzeNodeStatus(status nodeStat) nodeStatusAnalysis {
	analysis := nodeStatusAnalysis{
		valid:    true,
		observed: nodeStatusObserved(status),
	}
	if !analysis.observed {
		analysis.summary = nodeStatusSummaryValues(status, false)
		return analysis
	}

	conditionsValid, ready := analyzeNodeConditions(status.Conditions)
	resourcesValid := validNodeResourceLists(status.Capacity, status.Allocatable)
	infoValid := validNodeSystemInfo(status.NodeInfo)
	analysis.valid = conditionsValid && resourcesValid && infoValid
	analysis.ready = ready
	analysis.summary = nodeStatusSummaryValues(status, analysis.valid)
	return analysis
}

func nodeStatusObserved(status nodeStat) bool {
	return len(status.Conditions) > 0 || status.Capacity != nil || status.Allocatable != nil ||
		status.NodeInfo.KubeletVersion != "" || status.NodeInfo.ContainerRuntimeVersion != "" ||
		status.NodeInfo.OperatingSystem != "" || status.NodeInfo.Architecture != ""
}

func analyzeNodeConditions(conditions []condition) (bool, bool) {
	if len(conditions) > maxConditionSummaryItems {
		return false, false
	}
	seen := map[string]bool{}
	ready := false
	for _, current := range conditions {
		if !validConditionType(current.Type) || !validConditionStatus(current.Status) || seen[current.Type] {
			return false, false
		}
		seen[current.Type] = true
		if current.Type == "Ready" {
			ready = current.Status == "True"
		}
	}
	return true, ready
}

func validNodeResourceLists(capacity map[string]string, allocatable map[string]string) bool {
	if len(capacity) > maxNodeResourceEntries || len(allocatable) > maxNodeResourceEntries {
		return false
	}
	for _, resources := range []map[string]string{capacity, allocatable} {
		for _, key := range []string{"cpu", "memory", "ephemeral-storage"} {
			if value, found := resources[key]; found && !validNodeQuantity(value) {
				return false
			}
		}
		if value, found := resources["pods"]; found {
			if _, valid := nodePodCapacity(value); !valid {
				return false
			}
		}
	}
	capacityPods, capacitySet := nodePodCapacity(capacity["pods"])
	allocatablePods, allocatableSet := nodePodCapacity(allocatable["pods"])
	return !capacitySet || !allocatableSet || allocatablePods <= capacityPods
}

func validNodeSystemInfo(info nodeSystemInfo) bool {
	return validOptionalNodeValue(info.KubeletVersion, nodeKubeletVersionPattern) &&
		validOptionalNodeValue(info.ContainerRuntimeVersion, nodeRuntimePattern) &&
		(info.OperatingSystem == "" || info.OperatingSystem == "linux" || info.OperatingSystem == "windows") &&
		(info.Architecture == "" || nodeArchitecturePattern.MatchString(info.Architecture))
}

func validOptionalNodeValue(value string, pattern *regexp.Regexp) bool {
	return value == "" || len(value) <= maxNodeVersionBytes && strings.TrimSpace(value) == value && pattern.MatchString(value)
}

func validNodeQuantity(value string) bool {
	return value != "" && len(value) <= maxNodeVersionBytes && strings.TrimSpace(value) == value && nodeQuantityPattern.MatchString(value)
}

func nodePodCapacity(value string) (int, bool) {
	if value == "" {
		return 0, false
	}
	if len(value) > 10 || strings.TrimSpace(value) != value {
		return 0, false
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || !validSummaryCount(parsed) {
		return 0, false
	}
	return parsed, true
}

func nodeStatusValue(analysis nodeStatusAnalysis) string {
	if !analysis.observed {
		return "unknown"
	}
	if !analysis.valid || !analysis.ready {
		return "warning"
	}
	return "healthy"
}

func nodeStatusSummaryValues(status nodeStat, valid bool) map[string]interface{} {
	if nodeStatusObserved(status) && !valid {
		return map[string]interface{}{
			"capacityCpu":                 "invalid",
			"allocatableCpu":              "invalid",
			"capacityMemory":              "invalid",
			"allocatableMemory":           "invalid",
			"capacityPods":                "invalid",
			"allocatablePods":             "invalid",
			"capacityEphemeralStorage":    "invalid",
			"allocatableEphemeralStorage": "invalid",
			"capacityResourceCount":       "invalid",
			"allocatableResourceCount":    "invalid",
			"kubeletVersion":              "invalid",
			"containerRuntime":            "invalid",
			"operatingSystem":             "invalid",
			"architecture":                "invalid",
			"conditions":                  "invalid",
		}
	}
	return map[string]interface{}{
		"capacityCpu":                 nodeQuantitySummary(status.Capacity, "cpu"),
		"allocatableCpu":              nodeQuantitySummary(status.Allocatable, "cpu"),
		"capacityMemory":              nodeQuantitySummary(status.Capacity, "memory"),
		"allocatableMemory":           nodeQuantitySummary(status.Allocatable, "memory"),
		"capacityPods":                nodePodCapacitySummary(status.Capacity),
		"allocatablePods":             nodePodCapacitySummary(status.Allocatable),
		"capacityEphemeralStorage":    nodeQuantitySummary(status.Capacity, "ephemeral-storage"),
		"allocatableEphemeralStorage": nodeQuantitySummary(status.Allocatable, "ephemeral-storage"),
		"capacityResourceCount":       len(status.Capacity),
		"allocatableResourceCount":    len(status.Allocatable),
		"kubeletVersion":              optionalNodeSummary(status.NodeInfo.KubeletVersion),
		"containerRuntime":            optionalNodeSummary(status.NodeInfo.ContainerRuntimeVersion),
		"operatingSystem":             optionalNodeSummary(status.NodeInfo.OperatingSystem),
		"architecture":                optionalNodeSummary(status.NodeInfo.Architecture),
		"conditions":                  nodeConditionSummary(status.Conditions),
	}
}

func nodeQuantitySummary(resources map[string]string, key string) string {
	if value, found := resources[key]; found {
		return value
	}
	return "unknown"
}

func nodePodCapacitySummary(resources map[string]string) interface{} {
	value, found := resources["pods"]
	if !found {
		return "unknown"
	}
	parsed, valid := nodePodCapacity(value)
	if !valid {
		return "invalid"
	}
	return parsed
}

func optionalNodeSummary(value string) string {
	if value == "" {
		return "unknown"
	}
	return value
}

func nodeConditionSummary(conditions []condition) string {
	if len(conditions) == 0 {
		return "unknown"
	}
	return conditionSummary(conditions)
}
