package provider

import (
	"strings"
	"testing"
	"time"
)

func TestWorkloadStatusesFailClosedForMissingOrInvalidCounts(t *testing.T) {
	runningWithoutStatuses := podResource{}
	runningWithoutStatuses.Status.Phase = "Running"
	if got := podStatus(runningWithoutStatuses); got != "warning" {
		t.Fatalf("podStatus() = %q, want warning without container status", got)
	}

	deployment := deploymentResource{}
	if got := deploymentStatus(deployment); got != "warning" {
		t.Fatalf("deploymentStatus() = %q, want default desired replica to be one", got)
	}
	deployment.Status = replicaStatus{Replicas: 1, AvailableReplicas: 1}
	if got := deploymentStatus(deployment); got != "healthy" {
		t.Fatalf("deploymentStatus() = %q, want healthy at default replica count", got)
	}

	negative := -1
	deployment.Spec.Replicas = &negative
	if got := deploymentStatus(deployment); got != "warning" {
		t.Fatalf("deploymentStatus() = %q, want negative desired count rejected", got)
	}

	oversized := maxSummaryInteger + 1
	deployment.Spec.Replicas = &oversized
	deployment.Status = replicaStatus{Replicas: oversized, ReadyReplicas: oversized, AvailableReplicas: oversized}
	if got := deploymentStatus(deployment); got != "warning" {
		t.Fatalf("deploymentStatus() = %q, want oversized counts rejected", got)
	}
	if got := formatReplicaSummary(deployment.Status.ReadyReplicas, deployment.Spec.Replicas, 1); got != "invalid" {
		t.Fatalf("formatReplicaSummary() = %q, want invalid", got)
	}

	one := 1
	deployment.Spec.Replicas = &one
	deployment.Status = replicaStatus{Replicas: 1, ReadyReplicas: 2, AvailableReplicas: 1}
	if got := deploymentStatus(deployment); got != "warning" {
		t.Fatalf("deploymentStatus() = %q, want impossible ready count rejected", got)
	}
	daemonSet := daemonSetResource{}
	daemonSet.Status.DesiredNumberScheduled = 1
	daemonSet.Status.NumberReady = 2
	if got := daemonSetStatus(daemonSet); got != "warning" {
		t.Fatalf("daemonSetStatus() = %q, want impossible ready count rejected", got)
	}
}

func TestSummaryCountHelpersRejectMalformedRemoteScalars(t *testing.T) {
	negative := -1
	tooLarge := maxSummaryInteger + 1
	if got := summaryCount(negative); got != "invalid" {
		t.Fatalf("summaryCount(-1) = %#v", got)
	}
	if got := summaryOptionalCount(&tooLarge, 1); got != "invalid" {
		t.Fatalf("summaryOptionalCount(oversized) = %#v", got)
	}
	if got := formatReplicas(-1, 1); got != "invalid" {
		t.Fatalf("formatReplicas(-1, 1) = %q", got)
	}
	if got := formatReplicaRange(&negative, 10); got != "invalid" {
		t.Fatalf("formatReplicaRange(-1, 10) = %q", got)
	}
	minimum := 5
	if got := formatReplicaRange(&minimum, 4); got != "invalid" {
		t.Fatalf("formatReplicaRange(5, 4) = %q", got)
	}
	if got := formatReplicaRange(nil, 10); got != "1-10" {
		t.Fatalf("formatReplicaRange(nil, 10) = %q", got)
	}
}

func TestPodSummariesRejectMalformedContainerStatusCounts(t *testing.T) {
	statuses := []containerStatus{{Ready: true, RestartCount: -1}}
	pod := podResource{Status: podStat{Phase: "Running", ContainerStatuses: statuses}}
	if got := podStatus(pod); got != "warning" {
		t.Fatalf("podStatus() = %q, want warning", got)
	}
	if got := containerReadinessSummary(statuses); got != "invalid" {
		t.Fatalf("containerReadinessSummary() = %q", got)
	}
	if got := restartSummary(statuses); got != "invalid" {
		t.Fatalf("restartSummary() = %#v", got)
	}
}

func TestConditionSummaryIsBoundedAndDoesNotEchoMalformedValues(t *testing.T) {
	malformed := "Ready=token-like\nvalue"
	conditions := []condition{
		{Type: "Ready", Status: "True"},
		{Type: "DiskPressure", Status: "False"},
		{Type: malformed, Status: "True"},
		{Type: "Injected", Status: "credential-value"},
	}
	got := conditionSummary(conditions)
	if got != "DiskPressure=False, Ready=True" {
		t.Fatalf("conditionSummary() = %q, want sorted safe conditions", got)
	}
	if strings.Contains(got, malformed) || strings.Contains(got, "credential-value") {
		t.Fatalf("conditionSummary() leaked malformed input: %q", got)
	}

	tooMany := make([]condition, maxConditionSummaryItems+1)
	if got := conditionSummary(tooMany); got != "invalid conditions" {
		t.Fatalf("conditionSummary() = %q, want bounded marker", got)
	}
}

func TestContainerAndOwnerSummariesAreValidatedBoundedAndDeterministic(t *testing.T) {
	containers := []container{{Name: "worker"}, {Name: "api"}, {Name: "worker"}, {Name: "bad.name"}, {Name: "Bad"}}
	gotNames := containerNames(containers)
	if strings.Join(gotNames, ",") != "api,worker" {
		t.Fatalf("containerNames() = %#v, want validated unique names", gotNames)
	}

	owners := []ownerReference{
		{Kind: "ReplicaSet", Name: "api-7c9f"},
		{Kind: "Deployment", Name: "api"},
		{Kind: "Injected Kind", Name: "unsafe"},
		{Kind: "Secret", Name: "bad name"},
	}
	gotOwners := ownerSummaries(owners)
	if strings.Join(gotOwners, ",") != "Deployment/api,ReplicaSet/api-7c9f" {
		t.Fatalf("ownerSummaries() = %#v, want validated deterministic owners", gotOwners)
	}

	if got := ownerSummaries(make([]ownerReference, maxOwnerSummaryItems+1)); len(got) != 0 {
		t.Fatalf("ownerSummaries() = %#v, want oversized input rejected", got)
	}
}

func TestRestartAndAgeSummariesRemainBounded(t *testing.T) {
	statuses := []containerStatus{{RestartCount: maxRestartCount}, {RestartCount: 10}, {RestartCount: -10}}
	if got := restartCount(statuses); got != maxRestartCount {
		t.Fatalf("restartCount() = %d, want cap %d", got, maxRestartCount)
	}

	future := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
	if got := age(future); got != "unknown" {
		t.Fatalf("age() = %q, want future timestamp rejected", got)
	}
}
