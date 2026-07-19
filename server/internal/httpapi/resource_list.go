package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"kuviewer/server/internal/topology"
)

const maxResourceListPageSize = 200

type resourceListQuery struct {
	query     string
	cluster   string
	namespace string
	kind      string
	status    string
	sort      string
	direction string
	limit     int
	offset    int
}

func parseResourceListQuery(r *http.Request) (resourceListQuery, error) {
	values := r.URL.Query()
	query := resourceListQuery{
		query:     strings.TrimSpace(values.Get("query")),
		cluster:   strings.TrimSpace(values.Get("cluster")),
		namespace: strings.TrimSpace(values.Get("namespace")),
		kind:      strings.TrimSpace(values.Get("kind")),
		status:    strings.TrimSpace(values.Get("status")),
		sort:      strings.TrimSpace(values.Get("sort")),
		direction: strings.TrimSpace(values.Get("direction")),
	}
	if len(query.query) > 160 || len(query.cluster) > 120 || len(query.namespace) > 120 || len(query.kind) > 120 || len(query.status) > 120 {
		return resourceListQuery{}, errors.New("resource filter too long")
	}
	if query.sort != "" && query.sort != "name" && query.sort != "kind" && query.sort != "namespace" && query.sort != "status" && query.sort != "cluster" {
		return resourceListQuery{}, errors.New("invalid resource sort")
	}
	if query.direction == "" {
		query.direction = "asc"
	}
	if query.direction != "asc" && query.direction != "desc" {
		return resourceListQuery{}, errors.New("invalid resource sort direction")
	}

	rawLimit := strings.TrimSpace(values.Get("limit"))
	if rawLimit == "" {
		if values.Get("cursor") != "" {
			return resourceListQuery{}, errors.New("cursor requires limit")
		}
		return query, nil
	}
	limit, err := strconv.Atoi(rawLimit)
	if err != nil || limit < 1 || limit > maxResourceListPageSize {
		return resourceListQuery{}, errors.New("invalid resource limit")
	}
	query.limit = limit

	rawCursor := strings.TrimSpace(values.Get("cursor"))
	if rawCursor == "" {
		return query, nil
	}
	if len(rawCursor) > 32 {
		return resourceListQuery{}, errors.New("resource cursor too long")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(rawCursor)
	if err != nil {
		return resourceListQuery{}, errors.New("invalid resource cursor")
	}
	cursorParts := strings.Split(string(decoded), ".")
	if len(cursorParts) != 2 || cursorParts[1] != resourceListCursorSignature(query) {
		return resourceListQuery{}, errors.New("resource cursor does not match filters")
	}
	offset, err := strconv.Atoi(cursorParts[0])
	if err != nil || offset < 0 {
		return resourceListQuery{}, errors.New("invalid resource cursor")
	}
	query.offset = offset
	return query, nil
}

func resourceListFromSnapshot(snapshot topology.Snapshot, query resourceListQuery) topology.ResourceList {
	return resourceListFromResources(resourcesFromSnapshot(snapshot), query)
}

func resourceListFromResources(resources []topology.Resource, query resourceListQuery) topology.ResourceList {
	filtered := make([]topology.Resource, 0, len(resources))
	for _, resource := range resources {
		if resourceMatchesListQuery(resource, query) {
			filtered = append(filtered, resource)
		}
	}
	if query.sort != "" {
		sort.SliceStable(filtered, func(leftIndex int, rightIndex int) bool {
			left := strings.ToLower(resourceListSortValue(filtered[leftIndex], query.sort))
			right := strings.ToLower(resourceListSortValue(filtered[rightIndex], query.sort))
			if left == right {
				left = filtered[leftIndex].ID
				right = filtered[rightIndex].ID
			}
			if query.direction == "desc" {
				return left > right
			}
			return left < right
		})
	}

	start := query.offset
	if start > len(filtered) {
		start = len(filtered)
	}
	end := len(filtered)
	if query.limit > 0 && start+query.limit < end {
		end = start + query.limit
	}
	nextCursor := ""
	if end < len(filtered) {
		nextCursor = base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(end) + "." + resourceListCursorSignature(query)))
	}
	items := make([]topology.Resource, end-start)
	copy(items, filtered[start:end])
	return topology.ResourceList{
		Items: items,
		Metadata: &topology.ResourceListMetadata{
			Total:      len(resources),
			Filtered:   len(filtered),
			Returned:   len(items),
			Limit:      query.limit,
			NextCursor: nextCursor,
			Facets:     resourceListFacets(resources),
		},
	}
}

func resourceListCursorSignature(query resourceListQuery) string {
	value := strings.Join([]string{query.query, query.cluster, query.namespace, query.kind, query.status, query.sort, query.direction}, "\x00")
	digest := sha256.Sum256([]byte(value))
	return fmt.Sprintf("%x", digest[:6])
}

func resourceMatchesListQuery(resource topology.Resource, query resourceListQuery) bool {
	if query.cluster != "" && query.cluster != "all" && resource.ClusterID != query.cluster {
		return false
	}
	if query.namespace != "" && query.namespace != "all" && resource.Namespace != query.namespace && !(resource.Kind == "Namespace" && resource.Name == query.namespace) {
		return false
	}
	if query.kind != "" && query.kind != "all" && resource.Kind != query.kind {
		return false
	}
	if query.status != "" && query.status != "all" && resource.Status != query.status {
		return false
	}
	normalizedQuery := strings.ToLower(strings.TrimSpace(query.query))
	if normalizedQuery == "" {
		return true
	}
	for _, value := range []string{resource.Name, resource.Kind, resource.Namespace, resource.ClusterID, resource.Status} {
		if strings.Contains(strings.ToLower(value), normalizedQuery) {
			return true
		}
	}
	for key, value := range resource.Labels {
		if strings.Contains(strings.ToLower(key+" "+value), normalizedQuery) {
			return true
		}
	}
	for key, value := range resource.Summary {
		if strings.Contains(strings.ToLower(key+" "+fmt.Sprint(value)), normalizedQuery) {
			return true
		}
	}
	return false
}

func resourceListSortValue(resource topology.Resource, field string) string {
	switch field {
	case "name":
		return resource.Name
	case "namespace":
		return resource.Namespace
	case "status":
		return resource.Status
	case "cluster":
		return resource.ClusterID
	default:
		return resource.Kind
	}
}

func resourceListFacets(resources []topology.Resource) topology.ResourceListFacets {
	clusters := map[string]struct{}{}
	namespaces := map[string]struct{}{}
	kinds := map[string]struct{}{}
	statuses := map[string]struct{}{}
	for _, resource := range resources {
		clusters[resource.ClusterID] = struct{}{}
		if resource.Namespace != "" {
			namespaces[resource.Namespace] = struct{}{}
		}
		kinds[resource.Kind] = struct{}{}
		statuses[resource.Status] = struct{}{}
	}
	return topology.ResourceListFacets{
		Clusters:   sortedStringSet(clusters),
		Namespaces: sortedStringSet(namespaces),
		Kinds:      sortedStringSet(kinds),
		Statuses:   sortedStringSet(statuses),
	}
}

func sortedStringSet(values map[string]struct{}) []string {
	items := make([]string, 0, len(values))
	for value := range values {
		items = append(items, value)
	}
	sort.Strings(items)
	return items
}
