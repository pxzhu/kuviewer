package provider

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestPodRuntimeAnalysisSummarizesSafeBoundedState(t *testing.T) {
	var pod podResource
	const raw = `{
		"metadata":{"name":"api","namespace":"app"},
		"status":{
			"phase":"Running",
			"containerStatuses":[
				{"name":"api","ready":true,"restartCount":2,"image":"registry.example.com/api:v1","imageID":"docker-pullable://must-not-survive","containerID":"containerd://must-not-survive","state":{"running":{"startedAt":"2026-01-01T00:00:00Z"}},"lastState":{"terminated":{"exitCode":1,"reason":"Error","message":"credential=must-not-survive"}}},
				{"name":"sidecar","ready":false,"restartCount":4,"image":"registry.example.com/sidecar:v1","state":{"waiting":{"reason":"CrashLoopBackOff","message":"token=must-not-survive"}}}
			],
			"initContainerStatuses":[{"name":"migrate","ready":true,"restartCount":0,"image":"registry.example.com/migrate:v1","state":{"terminated":{"exitCode":0,"reason":"Completed"}}}],
			"ephemeralContainerStatuses":[{"name":"debug","ready":false,"restartCount":0,"image":"registry.example.com/debug:v1","state":{"running":{}}}]
		}
	}`
	if err := json.Unmarshal([]byte(raw), &pod); err != nil {
		t.Fatalf("decode Pod: %v", err)
	}

	analysis := analyzePodRuntime(pod.Status)
	if !analysis.valid || analysis.ready != 1 || analysis.containers != 2 || analysis.restarts != 6 {
		t.Fatalf("analysis = %+v", analysis)
	}
	if got := podRuntimeStatus(analysis); got != "warning" {
		t.Fatalf("podRuntimeStatus() = %q", got)
	}
	summary := podRuntimeSummary(analysis)
	if summary["ready"] != "1/2" || summary["restarts"] != 6 || summary["runtimeImageCount"] != 4 || summary["runtimeReasonCount"] != 3 {
		t.Fatalf("summary = %#v", summary)
	}
	if got := strings.Join(summary["runtimeStates"].([]string), ","); got != "running:2,waiting:1,terminated:1" {
		t.Fatalf("runtimeStates = %q", got)
	}
	if got := strings.Join(summary["runtimeReasons"].([]string), ","); got != "last:Error,terminated:Completed,waiting:CrashLoopBackOff" {
		t.Fatalf("runtimeReasons = %q", got)
	}
	encoded, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("marshal summary: %v", err)
	}
	for _, forbidden := range []string{"must-not-survive", "imageID", "containerID", "message"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("Pod runtime summary retained %q: %s", forbidden, encoded)
		}
	}
}

func TestPodRuntimeStatusUsesPhaseAndRunningContainerState(t *testing.T) {
	running := podStat{Phase: "Running", ContainerStatuses: []containerStatus{{
		Name: "api", Ready: true, Image: "api:v1", State: containerState{Running: &struct{}{}},
	}}}
	if got := podRuntimeStatus(analyzePodRuntime(running)); got != "healthy" {
		t.Fatalf("running status = %q", got)
	}
	running.ContainerStatuses[0].State = containerState{Terminated: &containerStateTerminated{ExitCode: intPointer(0), Reason: "Completed"}}
	if got := podRuntimeStatus(analyzePodRuntime(running)); got != "warning" {
		t.Fatalf("terminated Running Pod status = %q", got)
	}
	if got := podRuntimeStatus(analyzePodRuntime(podStat{Phase: "Succeeded"})); got != "healthy" {
		t.Fatalf("succeeded status = %q", got)
	}
	if got := podRuntimeStatus(analyzePodRuntime(podStat{Phase: "Failed"})); got != "error" {
		t.Fatalf("failed status = %q", got)
	}
	if got := podRuntimeStatus(analyzePodRuntime(podStat{})); got != "unknown" {
		t.Fatalf("missing phase status = %q", got)
	}
}

func TestPodRuntimeAnalysisRejectsMalformedStatusFailClosed(t *testing.T) {
	valid := containerStatus{Name: "api", Ready: true, Image: "secret:v1", State: containerState{Running: &struct{}{}}}
	tooManyAcrossSets := podStat{Phase: "Running", ContainerStatuses: runtimeStatuses("app", 33), InitContainerStatuses: runtimeStatuses("init", 32)}
	tests := []podStat{
		{Phase: "Injected", ContainerStatuses: []containerStatus{valid}},
		{Phase: "Running", ContainerStatuses: []containerStatus{{Name: "bad name", State: containerState{Running: &struct{}{}}}}},
		{Phase: "Running", ContainerStatuses: []containerStatus{valid, valid}},
		{Phase: "Running", ContainerStatuses: []containerStatus{{Name: "api", RestartCount: -1, State: containerState{Running: &struct{}{}}}}},
		{Phase: "Running", ContainerStatuses: []containerStatus{{Name: "api", Image: "image:v1?token=fixture", State: containerState{Running: &struct{}{}}}}},
		{Phase: "Running", ContainerStatuses: []containerStatus{{Name: "api", State: containerState{Running: &struct{}{}, Waiting: &containerStateWaiting{Reason: "Starting"}}}}},
		{Phase: "Running", ContainerStatuses: []containerStatus{{Name: "api", State: containerState{Waiting: &containerStateWaiting{Reason: "password=fixture"}}}}},
		{Phase: "Running", ContainerStatuses: []containerStatus{{Name: "api", State: containerState{Terminated: &containerStateTerminated{Reason: "Error"}}}}},
		{Phase: "Running", ContainerStatuses: make([]containerStatus, maxPodRuntimeStatuses+1)},
		tooManyAcrossSets,
	}
	for index, status := range tests {
		analysis := analyzePodRuntime(status)
		if analysis.valid || podRuntimeStatus(analysis) != "warning" {
			t.Fatalf("case %d did not fail closed: %+v", index, analysis)
		}
		encoded, err := json.Marshal(podRuntimeSummary(analysis))
		if err != nil {
			t.Fatalf("marshal case %d: %v", index, err)
		}
		if strings.Contains(string(encoded), "fixture") {
			t.Fatalf("case %d leaked malformed value: %s", index, encoded)
		}
	}
}

func TestBuildKubernetesSnapshotAddsPodRuntimeDiagnosticWithoutRawDetail(t *testing.T) {
	resources := newKubernetesSnapshotResources()
	valid := podResource{Metadata: metadata{Name: "api", Namespace: "app"}}
	valid.Spec.Containers = []container{{Name: "api", Image: "api:v1"}}
	valid.Status = podStat{Phase: "Running", ContainerStatuses: []containerStatus{{Name: "api", Ready: true, Image: "api:v1", State: containerState{Running: &struct{}{}}}}}
	invalid := podResource{Metadata: metadata{Name: "invalid", Namespace: "app"}}
	invalid.Spec.Containers = []container{{Name: "api", Image: "api:v1"}}
	invalid.Status = podStat{Phase: "Running", ContainerStatuses: []containerStatus{{Name: "api", Image: "api:v1?credential=fixture", State: containerState{Waiting: &containerStateWaiting{Reason: "token=fixture"}}}}}
	resources.pods.Items = []podResource{valid, invalid}

	snapshot := buildKubernetesSnapshot("cluster-a", "Cluster A", resources)
	validNode := snapshotNode(t, snapshot, "Pod", "app", "api")
	if validNode.Status != "healthy" || validNode.Summary["runtimeImageCount"] != 1 {
		t.Fatalf("valid Pod node = %+v", validNode)
	}
	invalidNode := snapshotNode(t, snapshot, "Pod", "app", "invalid")
	if invalidNode.Status != "warning" || invalidNode.Summary["ready"] != "invalid" {
		t.Fatalf("invalid Pod node = %+v", invalidNode)
	}
	if diagnostic := findSnapshotDiagnostic(snapshot.Diagnostics, "snapshot/pods"); diagnostic.Reason != "invalid_item" || diagnostic.Count != 1 {
		t.Fatalf("Pod diagnostic = %+v", diagnostic)
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	if strings.Contains(string(encoded), "fixture") {
		t.Fatalf("snapshot retained malformed Pod runtime detail: %s", encoded)
	}
}

func intPointer(value int) *int {
	return &value
}

func runtimeStatuses(prefix string, count int) []containerStatus {
	result := make([]containerStatus, 0, count)
	for index := 0; index < count; index++ {
		result = append(result, containerStatus{Name: fmt.Sprintf("%s-%d", prefix, index), Ready: true, State: containerState{Running: &struct{}{}}})
	}
	return result
}
