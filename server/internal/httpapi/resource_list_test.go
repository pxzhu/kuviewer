package httpapi

import (
	"encoding/base64"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"kuviewer/server/internal/topology"
)

func TestParseResourceListQueryNormalizesAndBindsCursor(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/resources?query=%20Sidecar%20&cluster=%20all%20&limit=2&sort=name", nil)
	query, err := parseResourceListQuery(request)
	if err != nil {
		t.Fatalf("parse first query: %v", err)
	}
	if query.query != "Sidecar" || query.cluster != "all" || query.limit != 2 || query.sort != "name" || query.direction != "asc" || query.offset != 0 {
		t.Fatalf("normalized query=%+v", query)
	}

	page := resourceListFromResources(resourceListTestResources(), resourceListQuery{limit: 2, sort: "name", direction: "asc"})
	if page.Metadata == nil || page.Metadata.NextCursor == "" {
		t.Fatalf("first page metadata=%+v, want cursor", page.Metadata)
	}
	nextRequest := httptest.NewRequest("GET", "/api/resources?limit=2&sort=name&cursor="+page.Metadata.NextCursor, nil)
	nextQuery, err := parseResourceListQuery(nextRequest)
	if err != nil {
		t.Fatalf("parse next query: %v", err)
	}
	if nextQuery.offset != 2 {
		t.Fatalf("next offset=%d, want 2", nextQuery.offset)
	}

	mismatch := httptest.NewRequest("GET", "/api/resources?limit=2&sort=kind&cursor="+page.Metadata.NextCursor, nil)
	if _, err := parseResourceListQuery(mismatch); err == nil {
		t.Fatal("cursor reused with different sort, want error")
	}
}

func TestParseResourceListQueryRejectsInvalidInputs(t *testing.T) {
	baseQuery := resourceListQuery{limit: 10, direction: "asc"}
	negativeCursor := base64.RawURLEncoding.EncodeToString([]byte("-1." + resourceListCursorSignature(baseQuery)))
	paths := []string{
		"/api/resources?query=" + strings.Repeat("q", 161),
		"/api/resources?cluster=" + strings.Repeat("c", 121),
		"/api/resources?limit=0",
		"/api/resources?limit=201",
		"/api/resources?limit=word",
		"/api/resources?cursor=MA",
		"/api/resources?limit=10&cursor=not-base64!",
		"/api/resources?limit=10&cursor=" + strings.Repeat("a", 33),
		"/api/resources?limit=10&cursor=" + negativeCursor,
		"/api/resources?sort=unknown",
		"/api/resources?direction=sideways",
	}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			if _, err := parseResourceListQuery(httptest.NewRequest("GET", path, nil)); err == nil {
				t.Fatal("parseResourceListQuery error=nil, want rejection")
			}
		})
	}
}

func TestResourceListFromResourcesFiltersSortsPaginatesAndBuildsFacets(t *testing.T) {
	resources := resourceListTestResources()
	firstPage := resourceListFromResources(resources, resourceListQuery{
		namespace: "checkout",
		kind:      "Pod",
		sort:      "name",
		direction: "asc",
		limit:     1,
	})
	if len(firstPage.Items) != 1 || firstPage.Items[0].ID != "pod-alpha" {
		t.Fatalf("first page items=%+v, want pod-alpha", firstPage.Items)
	}
	if firstPage.Metadata == nil {
		t.Fatal("metadata=nil")
	}
	if firstPage.Metadata.Total != 4 || firstPage.Metadata.Filtered != 2 || firstPage.Metadata.Returned != 1 || firstPage.Metadata.NextCursor == "" {
		t.Fatalf("metadata=%+v", firstPage.Metadata)
	}
	wantFacets := topology.ResourceListFacets{
		Clusters:   []string{"cluster-a", "cluster-b"},
		Namespaces: []string{"checkout"},
		Kinds:      []string{"Namespace", "Pod", "Service"},
		Statuses:   []string{"healthy", "warning"},
	}
	if !reflect.DeepEqual(firstPage.Metadata.Facets, wantFacets) {
		t.Fatalf("facets=%+v, want %+v", firstPage.Metadata.Facets, wantFacets)
	}

	nextQuery := resourceListQuery{namespace: "checkout", kind: "Pod", sort: "name", direction: "asc", limit: 1, offset: 1}
	secondPage := resourceListFromResources(resources, nextQuery)
	if len(secondPage.Items) != 1 || secondPage.Items[0].ID != "pod-beta" || secondPage.Metadata == nil || secondPage.Metadata.NextCursor != "" {
		t.Fatalf("second page=%+v metadata=%+v", secondPage.Items, secondPage.Metadata)
	}

	beyondEnd := resourceListFromResources(resources, resourceListQuery{offset: 99, direction: "asc"})
	if len(beyondEnd.Items) != 0 || beyondEnd.Metadata == nil || beyondEnd.Metadata.Filtered != len(resources) {
		t.Fatalf("beyond end=%+v metadata=%+v", beyondEnd.Items, beyondEnd.Metadata)
	}
}

func TestResourceMatchesListQuerySearchesSafeMetadata(t *testing.T) {
	resources := resourceListTestResources()
	tests := []struct {
		name       string
		resourceID string
		query      resourceListQuery
		want       bool
	}{
		{name: "label value", resourceID: "pod-alpha", query: resourceListQuery{query: "FRONTEND"}, want: true},
		{name: "summary key", resourceID: "pod-beta", query: resourceListQuery{query: "containers"}, want: true},
		{name: "summary value", resourceID: "pod-beta", query: resourceListQuery{query: "sidecar"}, want: true},
		{name: "namespace node special case", resourceID: "namespace-checkout", query: resourceListQuery{namespace: "checkout"}, want: true},
		{name: "cluster mismatch", resourceID: "pod-alpha", query: resourceListQuery{cluster: "cluster-b"}, want: false},
		{name: "status mismatch", resourceID: "pod-beta", query: resourceListQuery{status: "healthy"}, want: false},
		{name: "no match", resourceID: "service-api", query: resourceListQuery{query: "missing"}, want: false},
	}
	byID := make(map[string]topology.Resource, len(resources))
	for _, resource := range resources {
		byID[resource.ID] = resource
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := resourceMatchesListQuery(byID[test.resourceID], test.query); got != test.want {
				t.Fatalf("resourceMatchesListQuery()=%t, want %t", got, test.want)
			}
		})
	}
}

func resourceListTestResources() []topology.Resource {
	return []topology.Resource{
		{
			ID:        "pod-beta",
			ClusterID: "cluster-b",
			Kind:      "Pod",
			Namespace: "checkout",
			Name:      "beta",
			Status:    "warning",
			Labels:    map[string]string{"tier": "backend"},
			Summary:   map[string]interface{}{"containers": []string{"app", "sidecar"}},
		},
		{
			ID:        "namespace-checkout",
			ClusterID: "cluster-a",
			Kind:      "Namespace",
			Name:      "checkout",
			Status:    "healthy",
			Labels:    map[string]string{},
			Summary:   map[string]interface{}{},
		},
		{
			ID:        "pod-alpha",
			ClusterID: "cluster-a",
			Kind:      "Pod",
			Namespace: "checkout",
			Name:      "alpha",
			Status:    "healthy",
			Labels:    map[string]string{"tier": "frontend"},
			Summary:   map[string]interface{}{"containers": []string{"app"}},
		},
		{
			ID:        "service-api",
			ClusterID: "cluster-a",
			Kind:      "Service",
			Namespace: "checkout",
			Name:      "api",
			Status:    "healthy",
			Labels:    map[string]string{"app": "checkout"},
			Summary:   map[string]interface{}{"ports": []string{"80/TCP"}},
		},
	}
}
