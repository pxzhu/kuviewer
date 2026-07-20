package provider

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestNodeStatusAnalysisSummarizesSafeCapacityAndRuntimeInfo(t *testing.T) {
	var node nodeResource
	const raw = `{
		"metadata":{"name":"worker-a"},
		"status":{
			"conditions":[{"type":"Ready","status":"True","message":"token=must-not-survive"},{"type":"MemoryPressure","status":"False"}],
			"capacity":{"cpu":"8","memory":"32Gi","pods":"110","ephemeral-storage":"100Gi","example.com/gpu":"1"},
			"allocatable":{"cpu":"7800m","memory":"30Gi","pods":"100","ephemeral-storage":"90Gi","example.com/gpu":"1"},
			"addresses":[{"type":"InternalIP","address":"must-not-survive"}],
			"nodeInfo":{"kubeletVersion":"v1.30.4","containerRuntimeVersion":"containerd://1.7.27","operatingSystem":"linux","architecture":"amd64","machineID":"must-not-survive","systemUUID":"must-not-survive","bootID":"must-not-survive"}
		}
	}`
	if err := json.Unmarshal([]byte(raw), &node); err != nil {
		t.Fatalf("decode Node: %v", err)
	}

	analysis := analyzeNodeStatus(node.Status)
	if !analysis.valid || !analysis.observed || !analysis.ready || nodeStatusValue(analysis) != "healthy" {
		t.Fatalf("analysis = %+v", analysis)
	}
	for key, expected := range map[string]interface{}{
		"capacityCpu": "8", "allocatableCpu": "7800m", "capacityMemory": "32Gi", "allocatableMemory": "30Gi",
		"capacityPods": 110, "allocatablePods": 100, "capacityEphemeralStorage": "100Gi", "allocatableEphemeralStorage": "90Gi",
		"capacityResourceCount": 5, "allocatableResourceCount": 5, "kubeletVersion": "v1.30.4",
		"containerRuntime": "containerd://1.7.27", "operatingSystem": "linux", "architecture": "amd64",
		"conditions": "MemoryPressure=False, Ready=True",
	} {
		if got := analysis.summary[key]; got != expected {
			t.Fatalf("summary[%q] = %#v, want %#v", key, got, expected)
		}
	}
	encoded, err := json.Marshal(node)
	if err != nil {
		t.Fatalf("marshal Node: %v", err)
	}
	for _, forbidden := range []string{"must-not-survive", "machineID", "systemUUID", "bootID", "addresses", "message"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("Node schema retained %q: %s", forbidden, encoded)
		}
	}
}

func TestNodeStatusAnalysisHandlesUnobservedAndNotReadyNodes(t *testing.T) {
	unobserved := analyzeNodeStatus(nodeStat{})
	if !unobserved.valid || unobserved.observed || nodeStatusValue(unobserved) != "unknown" ||
		unobserved.summary["capacityCpu"] != "unknown" || unobserved.summary["conditions"] != "unknown" {
		t.Fatalf("unobserved analysis = %+v", unobserved)
	}
	notReady := analyzeNodeStatus(nodeStat{Conditions: []condition{{Type: "Ready", Status: "False"}}})
	if !notReady.valid || !notReady.observed || notReady.ready || nodeStatusValue(notReady) != "warning" {
		t.Fatalf("not-ready analysis = %+v", notReady)
	}
}

func TestNodeStatusAnalysisRejectsMalformedRemoteFieldsFailClosed(t *testing.T) {
	valid := validNodeStatusFixture()
	tests := []nodeStat{
		{Conditions: []condition{{Type: "Ready", Status: "True"}, {Type: "Ready", Status: "False"}}},
		{Conditions: []condition{{Type: "Ready=token", Status: "True"}}},
		withNodeCapacity(valid, "cpu", "8?token=fixture"),
		withNodeAllocatable(valid, "pods", "111"),
		withNodeInfo(valid, nodeSystemInfo{KubeletVersion: "token=fixture", ContainerRuntimeVersion: "containerd://1.7.27", OperatingSystem: "linux", Architecture: "amd64"}),
		withNodeInfo(valid, nodeSystemInfo{KubeletVersion: "v1.30.4", ContainerRuntimeVersion: "containerd://1.7.27?token", OperatingSystem: "linux", Architecture: "amd64"}),
		withNodeInfo(valid, nodeSystemInfo{KubeletVersion: "v1.30.4", ContainerRuntimeVersion: "containerd://1.7.27", OperatingSystem: "darwin", Architecture: "amd64"}),
		withNodeInfo(valid, nodeSystemInfo{KubeletVersion: "v1.30.4", ContainerRuntimeVersion: "containerd://1.7.27", OperatingSystem: "linux", Architecture: "amd64?token"}),
		withNodeCapacityMap(valid, nodeResourceMap(maxNodeResourceEntries+1)),
	}
	for index, status := range tests {
		analysis := analyzeNodeStatus(status)
		if analysis.valid || nodeStatusValue(analysis) != "warning" || analysis.summary["capacityCpu"] != "invalid" {
			t.Fatalf("case %d did not fail closed: %+v", index, analysis)
		}
		encoded, err := json.Marshal(analysis.summary)
		if err != nil {
			t.Fatalf("marshal case %d: %v", index, err)
		}
		if strings.Contains(string(encoded), "fixture") || strings.Contains(string(encoded), "?token") {
			t.Fatalf("case %d leaked malformed value: %s", index, encoded)
		}
	}
}

func TestBuildKubernetesSnapshotAddsNodeStatusDiagnosticAndCountsOnlyValidReadyNodes(t *testing.T) {
	resources := newKubernetesSnapshotResources()
	valid := nodeResource{Metadata: metadata{Name: "worker-a"}, Status: validNodeStatusFixture()}
	invalid := nodeResource{Metadata: metadata{Name: "worker-b"}, Status: withNodeCapacity(validNodeStatusFixture(), "memory", "32Gi?credential=fixture")}
	resources.nodes.Items = []nodeResource{valid, invalid}

	snapshot := buildKubernetesSnapshot("cluster-a", "Cluster A", resources)
	if snapshot.Clusters[0].NodeTotal != 2 || snapshot.Clusters[0].NodeReady != 1 {
		t.Fatalf("cluster summary = %+v", snapshot.Clusters[0])
	}
	validNode := snapshotNode(t, snapshot, "Node", "", "worker-a")
	if validNode.Status != "healthy" || validNode.Summary["allocatablePods"] != 100 {
		t.Fatalf("valid Node = %+v", validNode)
	}
	invalidNode := snapshotNode(t, snapshot, "Node", "", "worker-b")
	if invalidNode.Status != "warning" || invalidNode.Summary["capacityMemory"] != "invalid" {
		t.Fatalf("invalid Node = %+v", invalidNode)
	}
	if diagnostic := findSnapshotDiagnostic(snapshot.Diagnostics, "snapshot/nodes"); diagnostic.Reason != "invalid_item" || diagnostic.Count != 1 {
		t.Fatalf("Node diagnostic = %+v", diagnostic)
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	if strings.Contains(string(encoded), "credential=fixture") {
		t.Fatalf("snapshot retained malformed Node value: %s", encoded)
	}
}

func validNodeStatusFixture() nodeStat {
	return nodeStat{
		Conditions:  []condition{{Type: "Ready", Status: "True"}},
		Capacity:    map[string]string{"cpu": "8", "memory": "32Gi", "pods": "110", "ephemeral-storage": "100Gi"},
		Allocatable: map[string]string{"cpu": "7800m", "memory": "30Gi", "pods": "100", "ephemeral-storage": "90Gi"},
		NodeInfo: nodeSystemInfo{
			KubeletVersion: "v1.30.4", ContainerRuntimeVersion: "containerd://1.7.27", OperatingSystem: "linux", Architecture: "amd64",
		},
	}
}

func withNodeCapacity(status nodeStat, key string, value string) nodeStat {
	status.Capacity = cloneNodeResourceMap(status.Capacity)
	status.Capacity[key] = value
	return status
}

func withNodeAllocatable(status nodeStat, key string, value string) nodeStat {
	status.Allocatable = cloneNodeResourceMap(status.Allocatable)
	status.Allocatable[key] = value
	return status
}

func withNodeInfo(status nodeStat, info nodeSystemInfo) nodeStat {
	status.NodeInfo = info
	return status
}

func withNodeCapacityMap(status nodeStat, capacity map[string]string) nodeStat {
	status.Capacity = capacity
	return status
}

func cloneNodeResourceMap(values map[string]string) map[string]string {
	result := make(map[string]string, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}

func nodeResourceMap(count int) map[string]string {
	result := make(map[string]string, count)
	for index := 0; index < count; index++ {
		result[fmt.Sprintf("example.com/resource-%d", index)] = "1"
	}
	return result
}
