package provider

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPodSchemaKeepsReferencesWithoutCapturingRawValues(t *testing.T) {
	const raw = `{
		"metadata":{"name":"api","namespace":"app"},
		"spec":{
			"imagePullSecrets":[{"name":"registry"}],
			"volumes":[{"secret":{"secretName":"volume-secret"}}],
			"containers":[{
				"name":"api",
				"envFrom":[{"secretRef":{"name":"runtime-secret"}}],
				"env":[
					{"name":"SAFE_REF","valueFrom":{"secretKeyRef":{"name":"key-secret","key":"password"}}},
					{"name":"RAW_VALUE","value":"must-not-survive"}
				]
			}]
		},
		"stringData":{"password":"must-not-survive"}
	}`

	pod := podResource{}
	if err := json.Unmarshal([]byte(raw), &pod); err != nil {
		t.Fatalf("decode pod schema: %v", err)
	}
	refs := podRefs(pod)
	for _, name := range []string{"key-secret", "registry", "runtime-secret", "volume-secret"} {
		if !podReferencesName(refs, "Secret", name) {
			t.Fatalf("expected Secret reference %q in %+v", name, refs)
		}
	}

	encoded, err := json.Marshal(pod)
	if err != nil {
		t.Fatalf("encode pod schema: %v", err)
	}
	if strings.Contains(string(encoded), "must-not-survive") || strings.Contains(string(encoded), `"stringData"`) {
		t.Fatalf("pod schema retained a raw value field: %s", encoded)
	}
}

func TestKubeListSchemaPreservesPaginationMetadata(t *testing.T) {
	list := podList{}
	if err := json.Unmarshal([]byte(`{"metadata":{"continue":"next-page"},"items":[{"metadata":{"name":"api","namespace":"app"}}]}`), &list); err != nil {
		t.Fatalf("decode pod list: %v", err)
	}
	if list.Metadata.Continue != "next-page" || len(list.Items) != 1 {
		t.Fatalf("unexpected list metadata: %+v", list)
	}
	if list.Items[0].Metadata.Name != "api" || list.Items[0].Metadata.Namespace != "app" {
		t.Fatalf("unexpected pod identity: %+v", list.Items[0].Metadata)
	}
}

func podReferencesName(refs []podReference, kind string, name string) bool {
	for _, ref := range refs {
		if ref.kind == kind && ref.name == name {
			return true
		}
	}
	return false
}
