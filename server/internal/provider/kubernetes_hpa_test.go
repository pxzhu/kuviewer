package provider

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestHPASummaryUsesMetricMarkersWithoutRetainingValues(t *testing.T) {
	hpa := horizontalPodAutoscalerResource{}
	input := `{"metadata":{"name":"checkout","namespace":"app"},"spec":{"scaleTargetRef":{"apiVersion":"apps/v1","kind":"Deployment","name":"checkout"},"minReplicas":2,"maxReplicas":8,"metrics":[{"type":"Resource","resource":{"name":"cpu","target":{"type":"Utilization","averageUtilization":70}}},{"type":"External","external":{"metric":{"name":"queue_depth","selector":{"matchLabels":{"queue":"credential-value"}}},"target":{"type":"AverageValue","averageValue":"30"}}}]},"status":{"currentReplicas":3,"desiredReplicas":3,"currentMetrics":[{"type":"Resource","resource":{"name":"cpu","current":{"averageUtilization":55}}},{"type":"External","external":{"metric":{"name":"queue_depth","selector":{"matchLabels":{"queue":"credential-value"}}},"current":{"averageValue":"18"}}}],"conditions":[{"type":"AbleToScale","status":"True","reason":"SafeReason","message":"token=remote-value"},{"type":"ScalingActive","status":"True"}]}}`
	if err := json.Unmarshal([]byte(input), &hpa); err != nil {
		t.Fatalf("decode HPA: %v", err)
	}
	if !validHPASpec(hpa) || !validHPAStatus(hpa) || hpaStatus(hpa) != "healthy" {
		t.Fatalf("HPA validation/status failed: %#v", hpaSummary(hpa))
	}
	summary := hpaSummary(hpa)
	if summary["target"] != "Deployment/checkout" || summary["range"] != "2-8" || summary["metrics"] != 2 || summary["metricTypes"] != "External:1,Resource:1" || summary["metricTargets"] != "AverageValue:1,Utilization:1" || summary["replicas"] != "3/3" || summary["currentValues"] != "averageValue:1,utilization:1" {
		t.Fatalf("HPA summary = %#v", summary)
	}
	encoded, err := json.Marshal(struct {
		HPA     horizontalPodAutoscalerResource
		Summary map[string]interface{}
	}{hpa, summary})
	if err != nil {
		t.Fatalf("marshal HPA: %v", err)
	}
	for _, forbidden := range []string{"queue_depth", "credential-value", "token=remote-value", "\"30\"", "\"18\""} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("HPA retained metric or condition value %q: %s", forbidden, encoded)
		}
	}
}

func TestHPASchemaFailsClosedForMalformedSpecAndStatus(t *testing.T) {
	fixtures := []struct {
		input       string
		validSpec   bool
		validStatus bool
	}{
		{`{"spec":{"scaleTargetRef":{"apiVersion":"apps/v1","kind":"Deployment","name":"api"},"maxReplicas":5},"status":{"currentReplicas":1,"desiredReplicas":1}}`, true, true},
		{`{"spec":{"scaleTargetRef":{"apiVersion":"credential/value/extra","kind":"Deployment","name":"api"},"maxReplicas":5},"status":{"currentReplicas":1,"desiredReplicas":1}}`, false, true},
		{`{"spec":{"scaleTargetRef":{"apiVersion":"apps/v1","kind":"Deployment","name":"api"},"minReplicas":0,"maxReplicas":5,"metrics":[{"type":"Resource","resource":{"name":"cpu","target":{"type":"Utilization","averageUtilization":70}}}]},"status":{"currentReplicas":1,"desiredReplicas":1}}`, false, true},
		{`{"spec":{"scaleTargetRef":{"apiVersion":"apps/v1","kind":"Deployment","name":"api"},"maxReplicas":5,"metrics":[{"type":"Resource","resource":{"name":"cpu","target":{"type":"AverageValue","averageValue":"credential123"}}}]},"status":{"currentReplicas":1,"desiredReplicas":1}}`, false, true},
		{`{"spec":{"scaleTargetRef":{"apiVersion":"apps/v1","kind":"Deployment","name":"api"},"maxReplicas":5,"metrics":[{"type":"External","external":{"metric":{"name":"queue_depth","selector":{"matchLabels":{"bad key":"value"}}},"target":{"type":"AverageValue","averageValue":"30"}}}]},"status":{"currentReplicas":1,"desiredReplicas":1}}`, false, true},
		{`{"spec":{"scaleTargetRef":{"apiVersion":"apps/v1","kind":"Deployment","name":"api"},"maxReplicas":5},"status":{"currentReplicas":1,"desiredReplicas":1,"conditions":[{"type":"Injected","status":"True"}]}}`, true, false},
		{`{"spec":{"scaleTargetRef":{"apiVersion":"apps/v1","kind":"Deployment","name":"api"},"maxReplicas":5},"status":{"currentReplicas":-1,"desiredReplicas":1}}`, true, false},
	}
	for index, fixture := range fixtures {
		hpa := horizontalPodAutoscalerResource{}
		if err := json.Unmarshal([]byte(fixture.input), &hpa); err != nil {
			t.Fatalf("fixture %d decode: %v", index, err)
		}
		if validHPASpec(hpa) != fixture.validSpec || validHPAStatus(hpa) != fixture.validStatus {
			t.Fatalf("fixture %d mismatch: spec=%t status=%t summary=%#v", index, validHPASpec(hpa), validHPAStatus(hpa), hpaSummary(hpa))
		}
		if index > 0 && hpaStatus(hpa) != "warning" {
			t.Fatalf("fixture %d status = %q, want warning", index, hpaStatus(hpa))
		}
	}
}

func TestMalformedHPADoesNotCreateScaleTargetPlaceholder(t *testing.T) {
	resources := newKubernetesSnapshotResources()
	resources.namespaces.Items = []namespace{{Metadata: metadata{Name: "app"}}}
	invalid := horizontalPodAutoscalerResource{Metadata: metadata{Name: "api", Namespace: "app"}}
	invalid.Spec.ScaleTargetRef = hpaScaleTargetReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "credential-target"}
	maximum := 5
	current := 1
	desired := 1
	invalid.Spec.MaxReplicas = &maximum
	invalid.Status.CurrentReplicas = &current
	invalid.Status.DesiredReplicas = &desired
	invalid.Spec.Metrics = []hpaMetricSpec{{Valid: false}}
	resources.hpas.Items = []horizontalPodAutoscalerResource{invalid}

	snapshot := buildKubernetesSnapshot("cluster", "cluster", resources)
	node := snapshotNode(t, snapshot, "HorizontalPodAutoscaler", "app", "api")
	if node.Status != "warning" || node.Summary["target"] != "invalid" {
		t.Fatalf("malformed HPA node = %+v", node)
	}
	for _, candidate := range snapshot.Nodes {
		if candidate.Name == "credential-target" {
			t.Fatalf("malformed HPA created target placeholder: %+v", candidate)
		}
	}
	diagnostic := findSnapshotDiagnostic(snapshot.Diagnostics, "snapshot/hpas")
	if diagnostic.Reason != "invalid_item" || diagnostic.Count != 1 {
		t.Fatalf("malformed HPA diagnostic = %+v", diagnostic)
	}
}
