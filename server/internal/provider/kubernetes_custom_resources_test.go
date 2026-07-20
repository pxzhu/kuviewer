package provider

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestCustomResourceReferencesAreDeterministicAndBounded(t *testing.T) {
	list := make([]interface{}, 100)
	for index := range list {
		list[index] = map[string]interface{}{"name": fmt.Sprintf("secret-%03d", index)}
	}
	spec := map[string]interface{}{
		"z":          map[string]interface{}{"secretRef": map[string]interface{}{"name": "z-secret"}},
		"secretRefs": list,
		"a":          map[string]interface{}{"secretRef": map[string]interface{}{"name": "a-secret"}},
	}
	source := customResourceInstance{CRDScope: "Namespaced"}

	first := customResourceReferences(spec, "checkout", source, customResourceDefinitionList{})
	second := customResourceReferences(spec, "checkout", source, customResourceDefinitionList{})

	if len(first) != maxCustomResourceReferences {
		t.Fatalf("reference count = %d, want bounded %d", len(first), maxCustomResourceReferences)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("reference traversal is not deterministic:\nfirst=%+v\nsecond=%+v", first, second)
	}
	if first[0].sourceField != "spec.a.secretRef" || first[0].name != "a-secret" {
		t.Fatalf("sorted first reference = %+v, want spec.a.secretRef", first[0])
	}
	for _, reference := range first {
		if reference.kind != "Secret" || reference.namespace != "checkout" || len(reference.sourceField) > maxCustomResourceReferencePathBytes {
			t.Fatalf("unexpected bounded reference: %+v", reference)
		}
	}
}

func TestCustomResourceReferencesFailClosedForDeepAndUnsafeInput(t *testing.T) {
	deep := map[string]interface{}{}
	cursor := deep
	for index := 0; index < maxCustomResourceReferenceDepth+8; index++ {
		next := map[string]interface{}{}
		cursor["child"] = next
		cursor = next
	}
	cursor["secretRef"] = map[string]interface{}{"name": "too-deep"}

	cycle := map[string]interface{}{}
	cycle["self"] = cycle
	unsafeParent := strings.Repeat("x", maxCustomResourceReferenceSegment+1)
	spec := map[string]interface{}{
		"cycle": cycle,
		"deep":  deep,
		unsafeParent: map[string]interface{}{
			"secretRef": map[string]interface{}{"name": "safe-secret"},
		},
		"serviceRef":         map[string]interface{}{"name": "invalid/name"},
		"serviceAccountName": "invalid identity",
	}

	references := customResourceReferences(spec, "checkout", customResourceInstance{CRDScope: "Namespaced"}, customResourceDefinitionList{})
	if len(references) != 1 {
		t.Fatalf("references = %+v, want only sanitized safe reference", references)
	}
	if got := references[0]; got.sourceField != "spec.field.secretRef" || got.name != "safe-secret" || strings.Contains(got.sourceField, unsafeParent) {
		t.Fatalf("unsafe path was not sanitized: %+v", got)
	}
}

func TestCustomResourceListPathRejectsUnsafeSegments(t *testing.T) {
	crd := customResourceDefinitionResource{}
	crd.Spec.Group = "platform.example.com"
	crd.Spec.Names.Plural = "widgets"
	if got := customResourceListPath(crd, "v1alpha1"); got != "/apis/platform.example.com/v1alpha1/widgets" {
		t.Fatalf("valid custom resource path = %q", got)
	}

	invalidValues := []struct {
		group   string
		version string
		plural  string
	}{
		{group: "../platform", version: "v1", plural: "widgets"},
		{group: "platform.example.com", version: "v1/beta", plural: "widgets"},
		{group: "platform.example.com", version: "v1", plural: "widgets/list"},
		{group: "Platform.example.com", version: "v1", plural: "widgets"},
	}
	for _, fixture := range invalidValues {
		crd.Spec.Group = fixture.group
		crd.Spec.Names.Plural = fixture.plural
		if got := customResourceListPath(crd, fixture.version); got != "" {
			t.Fatalf("unsafe custom resource path was accepted: %q", got)
		}
	}
}
