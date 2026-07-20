package provider

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestConfigMapSchemaIndexesKeysWithoutRetainingValues(t *testing.T) {
	var configMap configMapResource
	const raw = `{
		"metadata":{"name":"app-config","namespace":"app"},
		"data":{"app.properties":"token=must-not-survive","FEATURE_FLAG":"enabled"},
		"binaryData":{"logo.bin":"cHJpdmF0ZS1rZXktbXVzdC1ub3Qtc3Vydml2ZQ=="},
		"immutable":true
	}`
	if err := json.Unmarshal([]byte(raw), &configMap); err != nil {
		t.Fatalf("decode ConfigMap: %v", err)
	}
	analysis := analyzeConfigMap(configMap)
	if !analysis.valid || analysis.status != "healthy" || analysis.summary["keys"] != 3 || analysis.summary["dataKeys"] != 2 || analysis.summary["binaryKeys"] != 1 || analysis.summary["immutable"] != true {
		t.Fatalf("ConfigMap analysis = %+v", analysis)
	}
	encoded := fmt.Sprintf("%#v", configMap)
	for _, forbidden := range []string{"must-not-survive", "enabled", "cHJpdmF0ZS1rZXk"} {
		if strings.Contains(encoded, forbidden) {
			t.Fatalf("ConfigMap schema retained value %q: %s", forbidden, encoded)
		}
	}
}

func TestConfigMapAnalysisRejectsMalformedAndOversizedKeySets(t *testing.T) {
	tests := []string{
		`{"metadata":{"name":"bad"},"data":{".":"fixture"}}`,
		`{"metadata":{"name":"bad"},"data":{"../token":"fixture"}}`,
		`{"metadata":{"name":"bad"},"data":{"shared":"one"},"binaryData":{"shared":"dHdv"}}`,
		`{"metadata":{"name":"bad"},"data":{"duplicate":"one","duplicate":"two"}}`,
		`{"metadata":{"name":"bad"},"data":{"valid":42}}`,
		`{"metadata":{"name":"bad"},"immutable":"true"}`,
		oversizedConfigMapJSON(),
	}
	for index, raw := range tests {
		var configMap configMapResource
		if err := json.Unmarshal([]byte(raw), &configMap); err != nil {
			t.Fatalf("decode malformed fixture %d: %v", index, err)
		}
		analysis := analyzeConfigMap(configMap)
		if analysis.valid || analysis.status != "warning" || analysis.summary["keys"] != "invalid" {
			t.Fatalf("malformed ConfigMap %d did not fail closed: %+v", index, analysis)
		}
		if strings.Contains(fmt.Sprintf("%#v", configMap), "fixture") {
			t.Fatalf("malformed ConfigMap %d retained raw value", index)
		}
	}
}

func TestConfigMapScannerHandlesEscapedStringValuesWithoutRetainingThem(t *testing.T) {
	var configMap configMapResource
	const raw = `{"metadata":{"name":"escaped"},"data":{"escaped":"line\\nquote\\\"slash\\\\unicode\\u0041"}}`
	if err := json.Unmarshal([]byte(raw), &configMap); err != nil {
		t.Fatal(err)
	}
	analysis := analyzeConfigMap(configMap)
	if !analysis.valid || analysis.summary["keys"] != 1 {
		t.Fatalf("escaped ConfigMap analysis = %+v", analysis)
	}
	if strings.Contains(fmt.Sprintf("%#v", configMap), "line") {
		t.Fatal("escaped ConfigMap value was retained")
	}
}

func TestConfigMapNullableFieldsUseUnsetSummary(t *testing.T) {
	var configMap configMapResource
	if err := json.Unmarshal([]byte(`{"metadata":{"name":"empty"},"data":null,"binaryData":null,"immutable":null}`), &configMap); err != nil {
		t.Fatal(err)
	}
	analysis := analyzeConfigMap(configMap)
	if !analysis.valid || analysis.summary["keys"] != 0 || analysis.summary["immutable"] != "unset" {
		t.Fatalf("nullable ConfigMap analysis = %+v", analysis)
	}
}

func TestBuildKubernetesSnapshotAddsConfigMapDiagnostic(t *testing.T) {
	resources := newKubernetesSnapshotResources()
	var valid, invalid configMapResource
	if err := json.Unmarshal([]byte(`{"metadata":{"name":"valid","namespace":"app"},"data":{"a":"one"}}`), &valid); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(`{"metadata":{"name":"invalid","namespace":"app"},"data":{"..data":"must-not-survive"}}`), &invalid); err != nil {
		t.Fatal(err)
	}
	resources.configMaps.Items = []configMapResource{valid, invalid}

	snapshot := buildKubernetesSnapshot("cluster-a", "Cluster A", resources)
	validNode := snapshotNode(t, snapshot, "ConfigMap", "app", "valid")
	invalidNode := snapshotNode(t, snapshot, "ConfigMap", "app", "invalid")
	if validNode.Status != "healthy" || validNode.Summary["keys"] != 1 {
		t.Fatalf("valid ConfigMap node = %+v", validNode)
	}
	if invalidNode.Status != "warning" || invalidNode.Summary["keys"] != "invalid" {
		t.Fatalf("invalid ConfigMap node = %+v", invalidNode)
	}
	if diagnostic := findSnapshotDiagnostic(snapshot.Diagnostics, "snapshot/configmaps"); diagnostic.Reason != "invalid_item" || diagnostic.Count != 1 {
		t.Fatalf("ConfigMap diagnostic = %+v", diagnostic)
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "must-not-survive") {
		t.Fatalf("snapshot retained ConfigMap value: %s", encoded)
	}
}

func oversizedConfigMapJSON() string {
	var builder strings.Builder
	builder.WriteString(`{"metadata":{"name":"oversized"},"data":{`)
	for index := 0; index <= maxConfigMapEntries; index++ {
		if index > 0 {
			builder.WriteByte(',')
		}
		fmt.Fprintf(&builder, `"key-%04d":"value"`, index)
	}
	builder.WriteString(`}}`)
	return builder.String()
}
