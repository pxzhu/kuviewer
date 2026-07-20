package provider

import (
	"fmt"
	"sort"
)

const (
	maxPodRuntimeStatuses     = 64
	maxPodRuntimeSummaryItems = 8
	maxRestartCount           = 1_000_000_000
)

type podRuntimeAnalysis struct {
	valid                bool
	phase                string
	ready                int
	containers           int
	restarts             int
	allContainersRunning bool
	stateCounts          map[string]int
	reasons              []string
	images               []string
}

func analyzePodRuntime(status podStat) podRuntimeAnalysis {
	analysis := podRuntimeAnalysis{
		phase:                status.Phase,
		allContainersRunning: len(status.ContainerStatuses) > 0,
		stateCounts:          map[string]int{},
	}
	if !validPodPhase(status.Phase) || len(status.ContainerStatuses) > maxPodRuntimeStatuses ||
		len(status.InitContainerStatuses) > maxPodRuntimeStatuses || len(status.EphemeralContainerStatuses) > maxPodRuntimeStatuses ||
		len(status.ContainerStatuses)+len(status.InitContainerStatuses)+len(status.EphemeralContainerStatuses) > maxPodRuntimeStatuses {
		return analysis
	}

	seenNames := map[string]bool{}
	seenReasons := map[string]bool{}
	seenImages := map[string]bool{}
	sets := []struct {
		statuses []containerStatus
		regular  bool
	}{
		{statuses: status.ContainerStatuses, regular: true},
		{statuses: status.InitContainerStatuses},
		{statuses: status.EphemeralContainerStatuses},
	}
	for _, set := range sets {
		for _, current := range set.statuses {
			state, reasons, valid := analyzeContainerRuntimeStatus(current, seenNames)
			if !valid {
				return analysis
			}
			analysis.stateCounts[state]++
			for _, reason := range reasons {
				seenReasons[reason] = true
			}
			if current.Image != "" {
				seenImages[current.Image] = true
			}
			if !set.regular {
				continue
			}
			analysis.containers++
			if current.Ready {
				analysis.ready++
			}
			if state != "running" {
				analysis.allContainersRunning = false
			}
			if current.RestartCount > maxRestartCount-analysis.restarts {
				analysis.restarts = maxRestartCount
			} else {
				analysis.restarts += current.RestartCount
			}
		}
	}

	analysis.reasons = sortedPodRuntimeValues(seenReasons)
	analysis.images = sortedPodRuntimeValues(seenImages)
	analysis.valid = true
	return analysis
}

func analyzeContainerRuntimeStatus(status containerStatus, seenNames map[string]bool) (string, []string, bool) {
	if !validKubernetesNamespace(status.Name) || seenNames[status.Name] || !validSummaryCount(status.RestartCount) || !validWorkloadImage(status.Image) {
		return "", nil, false
	}
	seenNames[status.Name] = true
	state, currentReason, valid := analyzeContainerState(status.State)
	if !valid {
		return "", nil, false
	}
	_, lastReason, valid := analyzeContainerState(status.LastState)
	if !valid {
		return "", nil, false
	}
	reasons := make([]string, 0, 2)
	if currentReason != "" {
		reasons = append(reasons, state+":"+currentReason)
	}
	if lastReason != "" {
		reasons = append(reasons, "last:"+lastReason)
	}
	return state, reasons, true
}

func analyzeContainerState(state containerState) (string, string, bool) {
	set := 0
	if state.Waiting != nil {
		set++
	}
	if state.Running != nil {
		set++
	}
	if state.Terminated != nil {
		set++
	}
	if set == 0 {
		return "unknown", "", true
	}
	if set != 1 {
		return "", "", false
	}
	if state.Waiting != nil {
		if !validContainerRuntimeReason(state.Waiting.Reason) {
			return "", "", false
		}
		return "waiting", state.Waiting.Reason, true
	}
	if state.Running != nil {
		return "running", "", true
	}
	terminated := state.Terminated
	if terminated.ExitCode == nil || !validSummaryCount(*terminated.ExitCode) || !validSummaryCount(terminated.Signal) || !validContainerRuntimeReason(terminated.Reason) {
		return "", "", false
	}
	return "terminated", terminated.Reason, true
}

func validPodPhase(value string) bool {
	switch value {
	case "", "Pending", "Running", "Succeeded", "Failed", "Unknown":
		return true
	default:
		return false
	}
}

func validContainerRuntimeReason(value string) bool {
	return value == "" || validConditionType(value)
}

func podRuntimeStatus(analysis podRuntimeAnalysis) string {
	if !analysis.valid {
		return "warning"
	}
	switch analysis.phase {
	case "":
		return "unknown"
	case "Failed":
		return "error"
	case "Succeeded":
		return "healthy"
	case "Running":
		if analysis.allContainersRunning && analysis.ready == analysis.containers {
			return "healthy"
		}
	}
	return "warning"
}

func podRuntimeSummary(analysis podRuntimeAnalysis) map[string]interface{} {
	if !analysis.valid {
		return map[string]interface{}{
			"phase":              "invalid",
			"ready":              "invalid",
			"restarts":           "invalid",
			"runtimeStates":      []string{},
			"runtimeReasonCount": "invalid",
			"runtimeReasons":     []string{},
			"runtimeImageCount":  "invalid",
			"runtimeImages":      []string{},
		}
	}
	phase := analysis.phase
	if phase == "" {
		phase = "unknown"
	}
	return map[string]interface{}{
		"phase":              phase,
		"ready":              formatReplicas(analysis.ready, analysis.containers),
		"restarts":           analysis.restarts,
		"runtimeStates":      podRuntimeStateSummary(analysis.stateCounts),
		"runtimeReasonCount": len(analysis.reasons),
		"runtimeReasons":     limitPodRuntimeSummaryStrings(analysis.reasons),
		"runtimeImageCount":  len(analysis.images),
		"runtimeImages":      limitPodRuntimeSummaryStrings(analysis.images),
	}
}

func podRuntimeStateSummary(counts map[string]int) []string {
	order := []string{"running", "waiting", "terminated", "unknown"}
	result := make([]string, 0, len(order))
	for _, state := range order {
		if counts[state] > 0 {
			result = append(result, fmt.Sprintf("%s:%d", state, counts[state]))
		}
	}
	return result
}

func sortedPodRuntimeValues(values map[string]bool) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func limitPodRuntimeSummaryStrings(values []string) []string {
	result := append([]string(nil), values...)
	if len(result) > maxPodRuntimeSummaryItems {
		result = result[:maxPodRuntimeSummaryItems]
	}
	return result
}
