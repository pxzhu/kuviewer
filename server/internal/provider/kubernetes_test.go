package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"kuviewer/server/internal/topology"
)

func TestKubernetesProviderResourceEventsConvertsCoreEvents(t *testing.T) {
	var gotPath string
	var gotSelector string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotSelector = r.URL.Query().Get("fieldSelector")
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("Authorization = %q, want bearer token", got)
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"items": []map[string]interface{}{
				{
					"type":               "Normal",
					"reason":             "Scheduled",
					"message":            "Assigned checkout/checkout-api to worker-a",
					"lastTimestamp":      "2026-06-15T09:00:00Z",
					"reportingComponent": "default-scheduler",
				},
				{
					"type":           "Warning",
					"reason":         "Unhealthy",
					"message":        "Readiness probe failed",
					"firstTimestamp": "2026-06-15T10:00:00Z",
					"source": map[string]interface{}{
						"component": "kubelet",
						"host":      "worker-a",
					},
				},
			},
		}); err != nil {
			t.Fatalf("write response: %v", err)
		}
	}))
	defer server.Close()

	provider := KubernetesProvider{
		client: &kubeAPIClient{
			baseURL:    server.URL,
			bearer:     "test-token",
			httpClient: server.Client(),
		},
	}
	events, err := provider.ResourceEvents(context.Background(), ResourceRef{Kind: "Pod", Namespace: "checkout", Name: "checkout-api"})
	if err != nil {
		t.Fatalf("ResourceEvents() error = %v", err)
	}

	if gotPath != "/api/v1/namespaces/checkout/events" {
		t.Fatalf("path = %q, want namespaced events path", gotPath)
	}
	if gotSelector != "involvedObject.kind=Pod,involvedObject.name=checkout-api" {
		t.Fatalf("fieldSelector = %q, want involvedObject selector", gotSelector)
	}
	if len(events.Items) != 2 {
		t.Fatalf("events = %d, want 2", len(events.Items))
	}
	if events.Items[0].Reason != "Unhealthy" || events.Items[0].Source != "kubelet@worker-a" {
		t.Fatalf("newest event = %+v, want warning kubelet event first", events.Items[0])
	}
	if events.Items[1].Reason != "Scheduled" || events.Items[1].Source != "default-scheduler" {
		t.Fatalf("older event = %+v, want scheduled event second", events.Items[1])
	}
}

func TestKubernetesProviderCapabilitiesClassifiesSafeAccessResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("limit"); got != "1" {
			t.Fatalf("limit = %q, want 1", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("Authorization = %q, want bearer token", got)
		}
		switch r.URL.Path {
		case "/api/v1/namespaces", "/api/v1/nodes", "/api/v1/pods", "/api/v1/services":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"items":[]}`))
		case "/apis/gateway.networking.k8s.io/v1/gateways":
			http.Error(w, "forbidden", http.StatusForbidden)
		case "/apis/gateway.networking.k8s.io/v1/tlsroutes":
			http.NotFound(w, r)
		case "/apis/gateway.networking.k8s.io/v1alpha2/tlsroutes":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"items":[]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := KubernetesProvider{client: &kubeAPIClient{baseURL: server.URL, bearer: "test-token", httpClient: server.Client()}}
	report, err := provider.Capabilities(context.Background())
	if err != nil {
		t.Fatalf("Capabilities() error = %v", err)
	}
	if report.Source != "kubernetes" || report.CheckedAt == "" {
		t.Fatalf("unexpected report metadata: %+v", report)
	}
	capabilities := make(map[string]topology.ResourceCapability, len(report.Items))
	for _, capability := range report.Items {
		capabilities[capability.ID] = capability
	}
	if capability := capabilities["core/pods"]; capability.Status != "available" || !capability.Required {
		t.Fatalf("core pods capability = %+v", capability)
	}
	if capability := capabilities["gateway/gateways"]; capability.Status != "forbidden" || capability.Reason != "rbac_denied" {
		t.Fatalf("gateway capability = %+v", capability)
	}
	if capability := capabilities["gateway/tlsroutes"]; capability.Status != "available" {
		t.Fatalf("TLSRoute fallback capability = %+v", capability)
	}
	if capability := capabilities["policy/secret-values"]; capability.Status != "protected" || capability.Reason != "secret_values_hidden" {
		t.Fatalf("Secret policy capability = %+v", capability)
	}
}

func TestKubernetesProviderCapabilitiesRejectsCanceledContextBeforeProbing(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	provider := KubernetesProvider{}
	_, err := provider.Capabilities(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Capabilities() error = %v, want context cancellation", err)
	}
}

func TestKubernetesProviderSnapshotPaginatesRequiredLists(t *testing.T) {
	namespaceRequests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("Authorization = %q, want bearer token", got)
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/version" {
			_, _ = w.Write([]byte(`{"gitVersion":"v1.test"}`))
			return
		}
		if got := r.URL.Query().Get("limit"); got != "500" {
			t.Fatalf("%s limit = %q, want 500", r.URL.Path, got)
		}
		switch r.URL.Path {
		case "/api/v1/namespaces":
			namespaceRequests++
			if r.URL.Query().Get("continue") == "" {
				_, _ = w.Write([]byte(`{"metadata":{"continue":"namespace-next"},"items":[{"metadata":{"name":"checkout"}}]}`))
				return
			}
			if r.URL.Query().Get("continue") != "namespace-next" {
				t.Fatalf("namespace continue = %q", r.URL.Query().Get("continue"))
			}
			_, _ = w.Write([]byte(`{"items":[{"metadata":{"name":"platform"}}]}`))
		case "/api/v1/nodes", "/api/v1/pods", "/api/v1/services":
			_, _ = w.Write([]byte(`{"items":[]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := KubernetesProvider{
		client:      &kubeAPIClient{baseURL: server.URL, bearer: "test-token", httpClient: server.Client()},
		clusterID:   "live-test",
		clusterName: "Live Test",
	}
	snapshot, err := provider.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	if namespaceRequests != 2 || len(snapshot.Clusters) != 1 || snapshot.Clusters[0].Namespaces != 2 || snapshot.Clusters[0].Version != "v1.test" {
		t.Fatalf("snapshot summary = requests %d clusters %+v", namespaceRequests, snapshot.Clusters)
	}
	namespaceNames := map[string]bool{}
	for _, node := range snapshot.Nodes {
		if node.Kind == "Namespace" {
			namespaceNames[node.Name] = true
		}
	}
	if !namespaceNames["checkout"] || !namespaceNames["platform"] || len(namespaceNames) != 2 {
		t.Fatalf("namespace nodes = %#v, want both paginated namespaces", namespaceNames)
	}
}

func TestCollectSnapshotFetchesBoundsConcurrencyAndOrdersDiagnostics(t *testing.T) {
	const taskCount = 12
	var mutex sync.Mutex
	active := 0
	maxActive := 0
	tasks := make([]snapshotFetchTask, 0, taskCount)
	for index := 0; index < taskCount; index++ {
		taskIndex := index
		tasks = append(tasks, snapshotFetchTask{
			id:       "task-" + strconv.Itoa(taskIndex),
			resource: "Resource " + strconv.Itoa(taskIndex),
			fetch: func() error {
				mutex.Lock()
				active++
				if active > maxActive {
					maxActive = active
				}
				mutex.Unlock()
				time.Sleep(time.Duration(1+taskIndex%3) * 5 * time.Millisecond)
				mutex.Lock()
				active--
				mutex.Unlock()
				switch taskIndex {
				case 1:
					return errKubeAPIUnavailable
				case 8:
					return errKubeAPIResponseTooLarge
				default:
					return nil
				}
			},
		})
	}

	diagnostics, err := collectSnapshotFetches(context.Background(), 3, tasks)
	if err != nil {
		t.Fatalf("collectSnapshotFetches() error = %v", err)
	}
	if maxActive < 2 || maxActive > 3 {
		t.Fatalf("max concurrency = %d, want between 2 and 3", maxActive)
	}
	if len(diagnostics) != 2 || diagnostics[0].ID != "task-1" || diagnostics[0].Reason != "api_unavailable" || diagnostics[1].ID != "task-8" || diagnostics[1].Reason != "response_too_large" {
		t.Fatalf("diagnostics = %+v, want deterministic task order and safe reasons", diagnostics)
	}
}

func TestKubernetesProviderSnapshotReportsSafeOptionalCollectionDiagnostics(t *testing.T) {
	var mutex sync.Mutex
	active := 0
	maxActive := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/namespaces", "/api/v1/nodes", "/api/v1/pods", "/api/v1/services":
			_, _ = w.Write([]byte(`{"items":[]}`))
			return
		}

		mutex.Lock()
		active++
		if active > maxActive {
			maxActive = active
		}
		mutex.Unlock()
		defer func() {
			mutex.Lock()
			active--
			mutex.Unlock()
		}()
		time.Sleep(10 * time.Millisecond)

		switch r.URL.Path {
		case "/api/v1/configmaps":
			_, _ = w.Write([]byte(`{"items":`))
		case "/apis/apps/v1/deployments":
			http.Error(w, "sensitive-upstream-body", http.StatusBadGateway)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := KubernetesProvider{
		client:      &kubeAPIClient{baseURL: server.URL, bearer: "test-token", httpClient: server.Client()},
		clusterID:   "live-test",
		clusterName: "Live Test",
	}
	snapshot, err := provider.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	if maxActive < 2 || maxActive > kubeSnapshotConcurrency {
		t.Fatalf("optional max concurrency = %d, want between 2 and %d", maxActive, kubeSnapshotConcurrency)
	}
	diagnostics := make(map[string]topology.SnapshotDiagnostic, len(snapshot.Diagnostics))
	for _, diagnostic := range snapshot.Diagnostics {
		diagnostics[diagnostic.ID] = diagnostic
	}
	if diagnostic := diagnostics["core/configmaps"]; diagnostic.Reason != "invalid_response" || diagnostic.Resource != "ConfigMaps" || diagnostic.Count != 1 {
		t.Fatalf("ConfigMap diagnostic = %+v", diagnostic)
	}
	if diagnostic := diagnostics["workloads/deployments"]; diagnostic.Reason != "request_failed" || diagnostic.Resource != "Deployments" || diagnostic.Count != 1 {
		t.Fatalf("Deployment diagnostic = %+v", diagnostic)
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	if body := string(encoded); strings.Contains(body, "sensitive-upstream-body") || strings.Contains(body, "/apis/apps/v1/deployments") || strings.Contains(body, "502") {
		t.Fatalf("snapshot diagnostics leaked remote detail: %s", body)
	}
}

func TestKubeAPIClientGatewayRouteUsesV1WithoutAlphaFallback(t *testing.T) {
	requestedPaths := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPaths = append(requestedPaths, r.URL.Path)
		if r.URL.Path != "/apis/gateway.networking.k8s.io/v1/tlsroutes" {
			t.Fatalf("unexpected fallback request: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"metadata":{"name":"tls-v1","namespace":"edge"}}]}`))
	}))
	defer server.Close()

	client := &kubeAPIClient{baseURL: server.URL, bearer: "test-token", httpClient: server.Client()}
	routes := gatewayRouteList{}
	if err := client.getGatewayRouteJSON(context.Background(), "tlsroutes", &routes); err != nil {
		t.Fatalf("getGatewayRouteJSON() error = %v", err)
	}
	if len(requestedPaths) != 1 || len(routes.Items) != 1 || routes.Items[0].Metadata.Name != "tls-v1" {
		t.Fatalf("paths/routes = %#v/%+v, want one v1 response", requestedPaths, routes.Items)
	}
}

func TestKubeAPIClientGatewayRouteFallsBackToV1Alpha2(t *testing.T) {
	requestedPaths := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPaths = append(requestedPaths, r.URL.Path)
		switch r.URL.Path {
		case "/apis/gateway.networking.k8s.io/v1/tcproutes":
			http.NotFound(w, r)
		case "/apis/gateway.networking.k8s.io/v1alpha2/tcproutes":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"items":[{"metadata":{"name":"tcp-alpha","namespace":"edge"}}]}`))
		default:
			t.Fatalf("unexpected request: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := &kubeAPIClient{baseURL: server.URL, bearer: "test-token", httpClient: server.Client()}
	routes := gatewayRouteList{}
	if err := client.getGatewayRouteJSON(context.Background(), "tcproutes", &routes); err != nil {
		t.Fatalf("getGatewayRouteJSON() error = %v", err)
	}
	wantPaths := []string{
		"/apis/gateway.networking.k8s.io/v1/tcproutes",
		"/apis/gateway.networking.k8s.io/v1alpha2/tcproutes",
	}
	if len(requestedPaths) != len(wantPaths) || strings.Join(requestedPaths, ",") != strings.Join(wantPaths, ",") {
		t.Fatalf("paths = %#v, want %#v", requestedPaths, wantPaths)
	}
	if len(routes.Items) != 1 || routes.Items[0].Metadata.Name != "tcp-alpha" {
		t.Fatalf("routes = %+v, want v1alpha2 response", routes.Items)
	}
}

func TestKubeAPIClientListPaginationPreservesQueryAndItems(t *testing.T) {
	const continueToken = "opaque/token+value="
	type requestQuery struct {
		Continue      string
		FieldSelector string
		Limit         string
	}
	requests := []requestQuery{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		requests = append(requests, requestQuery{
			Continue:      query.Get("continue"),
			FieldSelector: query.Get("fieldSelector"),
			Limit:         query.Get("limit"),
		})
		w.Header().Set("Content-Type", "application/json")
		if query.Get("continue") == "" {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"metadata": map[string]string{"continue": continueToken},
				"items":    []map[string]interface{}{{"metadata": map[string]string{"name": "first"}}},
			})
			return
		}
		if query.Get("continue") != continueToken {
			t.Fatalf("continue = %q, want opaque token", query.Get("continue"))
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"metadata": map[string]string{"continue": ""},
			"items":    []map[string]interface{}{{"metadata": map[string]string{"name": "second"}}},
		})
	}))
	defer server.Close()

	client := &kubeAPIClient{baseURL: server.URL, bearer: "test-token", httpClient: server.Client()}
	list := namespaceList{}
	limits := kubeListLimits{PageSize: 2, MaxPages: 3, MaxItems: 4, MaxPageBytes: 1024, MaxTotalBytes: 2048}
	found, err := getKubeListJSONStatusWithLimits(context.Background(), client, "/api/v1/namespaces?fieldSelector=metadata.name%21%3Dsystem", &list, false, limits)
	if err != nil || !found {
		t.Fatalf("paginated list = found %t error %v, want success", found, err)
	}
	if len(requests) != 2 {
		t.Fatalf("requests = %d, want 2", len(requests))
	}
	for _, request := range requests {
		if request.FieldSelector != "metadata.name!=system" || request.Limit != "2" {
			t.Fatalf("request query = %+v, want preserved selector and limit", request)
		}
	}
	if requests[0].Continue != "" || requests[1].Continue != continueToken {
		t.Fatalf("continue sequence = %#v, want empty then opaque token", requests)
	}
	if len(list.Items) != 2 || list.Items[0].Metadata.Name != "first" || list.Items[1].Metadata.Name != "second" || list.Metadata.Continue != "" {
		t.Fatalf("list = %+v, want merged completed pages", list)
	}
}

func TestKubeAPIClientListPaginationRejectsTokenLoops(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"metadata":{"continue":"repeat"},"items":[{"metadata":{"name":"partial"}}]}`))
	}))
	defer server.Close()

	client := &kubeAPIClient{baseURL: server.URL, bearer: "test-token", httpClient: server.Client()}
	list := namespaceList{Items: []namespace{{Metadata: metadata{Name: "stale"}}}}
	limits := kubeListLimits{PageSize: 1, MaxPages: 4, MaxItems: 10, MaxPageBytes: 1024, MaxTotalBytes: 4096}
	_, err := getKubeListJSONStatusWithLimits(context.Background(), client, "/api/v1/namespaces", &list, false, limits)
	if !errors.Is(err, errKubeAPIListTokenLoop) || requests != 2 {
		t.Fatalf("pagination = requests %d error %v, want token loop after two pages", requests, err)
	}
	if len(list.Items) != 0 {
		t.Fatalf("list = %+v, want no stale or partial items after failure", list)
	}
}

func TestKubeAPIClientListPaginationRejectsInvalidInputsBeforeRequest(t *testing.T) {
	validLimits := kubeListLimits{PageSize: 1, MaxPages: 1, MaxItems: 1, MaxPageBytes: 1024, MaxTotalBytes: 1024}

	t.Run("nil client", func(t *testing.T) {
		list := namespaceList{Items: []namespace{{Metadata: metadata{Name: "stale"}}}}
		_, err := getKubeListJSONStatusWithLimits(context.Background(), nil, "/api/v1/namespaces", &list, false, validLimits)
		if !errors.Is(err, errKubeAPIInvalidRequest) || len(list.Items) != 0 {
			t.Fatalf("nil client = error %v list %+v, want invalid request and cleared output", err, list)
		}
	})

	t.Run("nil output", func(t *testing.T) {
		_, err := getKubeListJSONStatusWithLimits[namespace](context.Background(), &kubeAPIClient{}, "/api/v1/namespaces", nil, false, validLimits)
		if !errors.Is(err, errKubeAPIInvalidRequest) {
			t.Fatalf("nil output error = %v, want invalid request", err)
		}
	})

	t.Run("nil HTTP client", func(t *testing.T) {
		list := namespaceList{}
		_, err := getKubeListJSONStatusWithLimits(context.Background(), &kubeAPIClient{}, "/api/v1/namespaces", &list, false, validLimits)
		if !errors.Is(err, errKubeAPIInvalidRequest) {
			t.Fatalf("nil HTTP client error = %v, want invalid request", err)
		}
	})

	t.Run("invalid limits", func(t *testing.T) {
		list := namespaceList{Items: []namespace{{Metadata: metadata{Name: "stale"}}}}
		_, err := getKubeListJSONStatusWithLimits(context.Background(), &kubeAPIClient{httpClient: http.DefaultClient}, "/api/v1/namespaces", &list, false, kubeListLimits{})
		if !errors.Is(err, errKubeAPIInvalidRequest) || len(list.Items) != 0 {
			t.Fatalf("invalid limits = error %v list %+v, want invalid request and cleared output", err, list)
		}
	})

	t.Run("malformed path", func(t *testing.T) {
		list := namespaceList{}
		_, err := getKubeListJSONStatusWithLimits(context.Background(), &kubeAPIClient{httpClient: http.DefaultClient}, "/api/v1/namespaces?continue=%zz", &list, false, validLimits)
		if !errors.Is(err, errKubeAPIInvalidRequest) {
			t.Fatalf("malformed path error = %v, want invalid request", err)
		}
	})

	t.Run("invalid page size", func(t *testing.T) {
		_, err := kubeListPagePath("/api/v1/namespaces", "", 0)
		if !errors.Is(err, errKubeAPIInvalidRequest) {
			t.Fatalf("page path error = %v, want invalid request", err)
		}
	})
}

func TestKubeAPIClientListPaginationEnforcesBounds(t *testing.T) {
	t.Run("items", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"items":[{"metadata":{"name":"one"}},{"metadata":{"name":"two"}}]}`))
		}))
		defer server.Close()

		client := &kubeAPIClient{baseURL: server.URL, httpClient: server.Client()}
		list := namespaceList{}
		limits := kubeListLimits{PageSize: 2, MaxPages: 2, MaxItems: 1, MaxPageBytes: 1024, MaxTotalBytes: 2048}
		_, err := getKubeListJSONStatusWithLimits(context.Background(), client, "/api/v1/namespaces", &list, false, limits)
		if !errors.Is(err, errKubeAPIListItemLimit) || len(list.Items) != 0 {
			t.Fatalf("items bound = error %v list %+v", err, list)
		}
	})

	t.Run("pages", func(t *testing.T) {
		requests := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			requests++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"metadata":{"continue":"next-` + strconv.Itoa(requests) + `"},"items":[]}`))
		}))
		defer server.Close()

		client := &kubeAPIClient{baseURL: server.URL, httpClient: server.Client()}
		list := namespaceList{}
		limits := kubeListLimits{PageSize: 1, MaxPages: 2, MaxItems: 10, MaxPageBytes: 1024, MaxTotalBytes: 2048}
		_, err := getKubeListJSONStatusWithLimits(context.Background(), client, "/api/v1/namespaces", &list, false, limits)
		if !errors.Is(err, errKubeAPIListPageLimit) || requests != 2 {
			t.Fatalf("page bound = requests %d error %v", requests, err)
		}
	})

	t.Run("total bytes", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"items":[{"metadata":{"name":"long-enough-for-total-limit"}}]}`))
		}))
		defer server.Close()

		client := &kubeAPIClient{baseURL: server.URL, httpClient: server.Client()}
		list := namespaceList{}
		limits := kubeListLimits{PageSize: 1, MaxPages: 2, MaxItems: 10, MaxPageBytes: 1024, MaxTotalBytes: 32}
		_, err := getKubeListJSONStatusWithLimits(context.Background(), client, "/api/v1/namespaces", &list, false, limits)
		if !errors.Is(err, errKubeAPIListTotalBytesLimit) {
			t.Fatalf("total byte bound error = %v", err)
		}
	})

	t.Run("incomplete", func(t *testing.T) {
		requests := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requests++
			if r.URL.Query().Get("continue") != "" {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"metadata":{"continue":"next"},"items":[{"metadata":{"name":"partial"}}]}`))
		}))
		defer server.Close()

		client := &kubeAPIClient{baseURL: server.URL, httpClient: server.Client()}
		list := namespaceList{}
		limits := kubeListLimits{PageSize: 1, MaxPages: 3, MaxItems: 10, MaxPageBytes: 1024, MaxTotalBytes: 2048}
		_, err := getKubeListJSONStatusWithLimits(context.Background(), client, "/api/v1/namespaces", &list, false, limits)
		if !errors.Is(err, errKubeAPIListIncomplete) || requests != 2 || len(list.Items) != 0 {
			t.Fatalf("incomplete list = requests %d error %v list %+v", requests, err, list)
		}
	})

	t.Run("continue token", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"metadata": map[string]string{"continue": strings.Repeat("x", kubeListMaxTokenBytes+1)},
				"items":    []interface{}{},
			})
		}))
		defer server.Close()

		client := &kubeAPIClient{baseURL: server.URL, httpClient: server.Client()}
		list := namespaceList{}
		limits := kubeListLimits{PageSize: 1, MaxPages: 2, MaxItems: 10, MaxPageBytes: 8192, MaxTotalBytes: 8192}
		_, err := getKubeListJSONStatusWithLimits(context.Background(), client, "/api/v1/namespaces", &list, false, limits)
		if !errors.Is(err, errKubeAPIListTokenInvalid) {
			t.Fatalf("continue token bound error = %v", err)
		}
	})
}

func TestKubeAPIClientJSONResponseSizeIsBounded(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"value":"` + strings.Repeat("x", 64) + `"}`))
	}))
	defer server.Close()

	client := &kubeAPIClient{baseURL: server.URL, httpClient: server.Client()}
	found, bytesRead, err := client.getJSONStatusBounded(context.Background(), "/oversized", &map[string]interface{}{}, false, 32)
	if found || !errors.Is(err, errKubeAPIResponseTooLarge) || bytesRead != 33 {
		t.Fatalf("bounded JSON = found %t bytes %d error %v", found, bytesRead, err)
	}
}

func TestKubeAPIClientErrorsDoNotExposeEndpointOrResponseBody(t *testing.T) {
	const responseMarker = "private upstream token=redaction-fixture"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, responseMarker, http.StatusBadGateway)
	}))
	defer server.Close()

	client := &kubeAPIClient{baseURL: server.URL, bearer: "test-token", httpClient: server.Client()}
	tests := []struct {
		name string
		call func() error
	}{
		{
			name: "json",
			call: func() error {
				_, err := client.getJSONStatus(context.Background(), "/private-json", &map[string]interface{}{}, false)
				return err
			},
		},
		{
			name: "text",
			call: func() error {
				_, _, err := client.getTextStatus(context.Background(), "/private-text", false, 1024)
				return err
			},
		},
		{
			name: "stream",
			call: func() error {
				_, err := client.streamText(context.Background(), "/private-stream", false, 1024, func(string) error { return nil })
				return err
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := test.call()
			if err == nil || err.Error() != "kubernetes_api_status_502" {
				t.Fatalf("error = %v, want bounded status code", err)
			}
			for _, forbidden := range []string{server.URL, "private-", responseMarker, "redaction-fixture"} {
				if strings.Contains(err.Error(), forbidden) {
					t.Fatalf("error %q exposes %q", err, forbidden)
				}
			}
		})
	}
}

func TestKubeAPIClientInvalidJSONReturnsSafeError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"secret":"redaction-fixture"`))
	}))
	defer server.Close()

	client := &kubeAPIClient{baseURL: server.URL, bearer: "test-token", httpClient: server.Client()}
	_, err := client.getJSONStatus(context.Background(), "/invalid-json", &map[string]interface{}{}, false)
	if !errors.Is(err, errKubeAPIInvalidResponse) || strings.Contains(err.Error(), "redaction-fixture") {
		t.Fatalf("error = %v, want safe invalid response code", err)
	}
}

func TestKubeAPIClientRequestAndTransportErrorsAreBounded(t *testing.T) {
	client := &kubeAPIClient{baseURL: "://private-host"}
	if _, err := client.newRequest(context.Background(), "/private-path", "application/json"); !errors.Is(err, errKubeAPIInvalidRequest) {
		t.Fatalf("newRequest() error = %v, want safe invalid request code", err)
	}
	if err := safeKubeAPITransportError(context.Background()); !errors.Is(err, errKubeAPIUnavailable) {
		t.Fatalf("transport error = %v, want safe unavailable code", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := safeKubeAPITransportError(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled transport error = %v, want context cancellation", err)
	}
}

func TestNormalizeKubeAPIServerRejectsUnsafeURLs(t *testing.T) {
	got, err := normalizeKubeAPIServer(" https://127.0.0.1:6443/proxy/ ")
	if err != nil || got != "https://127.0.0.1:6443/proxy" {
		t.Fatalf("normalize safe URL = %q, %v", got, err)
	}

	for _, raw := range []string{
		"",
		"ftp://cluster.internal",
		"https:///missing-host",
		"https://user:pass@cluster.internal",
		"https://cluster.internal?token=private",
		"https://cluster.internal#private",
	} {
		if _, err := normalizeKubeAPIServer(raw); !errors.Is(err, errKubeConfigInvalid) {
			t.Errorf("normalizeKubeAPIServer(%q) error = %v", raw, err)
		}
	}
}

func TestKubeConfigFileErrorsDoNotExposePaths(t *testing.T) {
	resetKubeConfigEnv(t)
	t.Setenv("KUVIEWER_KUBE_API_SERVER", "https://cluster.internal")

	privateTokenPath := t.TempDir() + "/private-token-path"
	t.Setenv("KUVIEWER_KUBE_TOKEN_FILE", privateTokenPath)
	_, err := kubeConfigFromEnv()
	if !errors.Is(err, errKubeTokenFileRead) || strings.Contains(err.Error(), privateTokenPath) {
		t.Fatalf("token file error = %v, want bounded error without path", err)
	}

	t.Setenv("KUVIEWER_KUBE_TOKEN_FILE", "")
	t.Setenv("KUVIEWER_KUBE_BEARER_TOKEN", "test-token")
	privateCAPath := t.TempDir() + "/private-ca-path"
	t.Setenv("KUVIEWER_KUBE_CA_FILE", privateCAPath)
	_, err = kubeConfigFromEnv()
	if !errors.Is(err, errKubeCAFileRead) || strings.Contains(err.Error(), privateCAPath) {
		t.Fatalf("CA file error = %v, want bounded error without path", err)
	}
}

func TestKubeHTTPClientRejectsInvalidCA(t *testing.T) {
	caPath := t.TempDir() + "/invalid-ca.pem"
	if err := os.WriteFile(caPath, []byte("not a certificate"), 0o600); err != nil {
		t.Fatalf("write CA fixture: %v", err)
	}
	_, err := kubeHTTPClient("https://cluster.internal", caPath)
	if !errors.Is(err, errKubeCAInvalid) || strings.Contains(err.Error(), caPath) {
		t.Fatalf("invalid CA error = %v, want bounded error without path", err)
	}
}

func TestKubeAPIClientRejectsInvalidInputsBeforeRequest(t *testing.T) {
	client := &kubeAPIClient{baseURL: "https://cluster.internal", httpClient: http.DefaultClient}
	var nilClient *kubeAPIClient
	requestTests := []struct {
		name   string
		client *kubeAPIClient
		ctx    context.Context
		path   string
		accept string
	}{
		{name: "nil client", client: nilClient, ctx: context.Background(), path: "/api", accept: "application/json"},
		{name: "nil context", client: client, path: "/api", accept: "application/json"},
		{name: "relative path", client: client, ctx: context.Background(), path: "api", accept: "application/json"},
		{name: "unsupported accept", client: client, ctx: context.Background(), path: "/api", accept: "text/html"},
		{name: "nil HTTP client", client: &kubeAPIClient{baseURL: "https://cluster.internal"}, ctx: context.Background(), path: "/api", accept: "application/json"},
	}
	for _, test := range requestTests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := test.client.newRequest(test.ctx, test.path, test.accept); !errors.Is(err, errKubeAPIInvalidRequest) {
				t.Fatalf("newRequest() error = %v", err)
			}
		})
	}

	if _, _, err := client.getJSONStatusBounded(context.Background(), "/api", nil, false, 1024); !errors.Is(err, errKubeAPIInvalidRequest) {
		t.Fatalf("nil JSON output error = %v", err)
	}
	if _, _, err := client.getJSONStatusBounded(context.Background(), "/api", &map[string]interface{}{}, false, 0); !errors.Is(err, errKubeAPIInvalidRequest) {
		t.Fatalf("zero JSON bound error = %v", err)
	}
	if _, _, err := client.getJSONStatusBounded(context.Background(), "/api", &map[string]interface{}{}, false, kubeJSONMaxBytes+1); !errors.Is(err, errKubeAPIInvalidRequest) {
		t.Fatalf("oversized JSON bound error = %v", err)
	}
	if _, _, err := client.getTextStatus(context.Background(), "/api", false, 0); !errors.Is(err, errKubeAPIInvalidRequest) {
		t.Fatalf("zero text bound error = %v", err)
	}
	if _, _, err := client.getTextStatus(context.Background(), "/api", false, kubeJSONMaxBytes+1); !errors.Is(err, errKubeAPIInvalidRequest) {
		t.Fatalf("oversized text bound error = %v", err)
	}
	if _, err := client.streamText(context.Background(), "/api", false, 1024, nil); !errors.Is(err, errKubeAPIInvalidRequest) {
		t.Fatalf("nil stream callback error = %v", err)
	}
	if _, err := client.streamText(context.Background(), "/api", false, kubeJSONMaxBytes+1, func(string) error { return nil }); !errors.Is(err, errKubeAPIInvalidRequest) {
		t.Fatalf("oversized stream bound error = %v", err)
	}
}

func resetKubeConfigEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"KUVIEWER_KUBE_API_SERVER",
		"KUVIEWER_KUBE_BEARER_TOKEN",
		"KUVIEWER_KUBE_TOKEN_FILE",
		"KUVIEWER_KUBE_CA_FILE",
		"KUVIEWER_KUBE_INSECURE_SKIP_TLS_VERIFY",
		"KUBERNETES_SERVICE_HOST",
		"KUBERNETES_SERVICE_PORT",
	} {
		t.Setenv(key, "")
	}
}

func TestKubernetesProviderResourceEventsForbiddenFallsBack(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	defer server.Close()

	provider := KubernetesProvider{
		client: &kubeAPIClient{
			baseURL:    server.URL,
			bearer:     "test-token",
			httpClient: server.Client(),
		},
	}
	events, err := provider.ResourceEvents(context.Background(), ResourceRef{Kind: "Node", Name: "worker-a"})
	if err != nil {
		t.Fatalf("ResourceEvents() error = %v", err)
	}
	if events.Warning != "events_unavailable" || len(events.Items) != 0 {
		t.Fatalf("events = %+v, want unavailable warning and empty list", events)
	}
}

func TestKubernetesProviderResourceEventsRejectsEmptyReference(t *testing.T) {
	provider := KubernetesProvider{}
	events, err := provider.ResourceEvents(context.Background(), ResourceRef{})
	if err != nil {
		t.Fatalf("ResourceEvents() error = %v", err)
	}
	if events.Warning != "events_unavailable" || len(events.Items) != 0 {
		t.Fatalf("events = %+v, want unavailable warning and empty list", events)
	}
}

func TestKubernetesProviderResourceLogsReadsPodLog(t *testing.T) {
	var gotPath string
	var gotTailLines string
	var gotContainer string
	var gotPrevious string
	var gotFollow string
	var gotAccept string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotTailLines = r.URL.Query().Get("tailLines")
		gotContainer = r.URL.Query().Get("container")
		gotPrevious = r.URL.Query().Get("previous")
		gotFollow = r.URL.Query().Get("follow")
		gotAccept = r.Header.Get("Accept")
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("Authorization = %q, want bearer token", got)
		}
		if gotAccept != "*/*" {
			http.Error(w, "not acceptable", http.StatusNotAcceptable)
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("line-1\nline-2\n"))
	}))
	defer server.Close()

	provider := KubernetesProvider{
		client: &kubeAPIClient{
			baseURL:    server.URL,
			bearer:     "test-token",
			httpClient: server.Client(),
		},
	}
	logs, err := provider.ResourceLogs(context.Background(), ResourceRef{Kind: "Pod", Namespace: "checkout", Name: "checkout-api", Container: "api", Previous: true})
	if err != nil {
		t.Fatalf("ResourceLogs() error = %v", err)
	}

	if gotPath != "/api/v1/namespaces/checkout/pods/checkout-api/log" {
		t.Fatalf("path = %q, want pod log path", gotPath)
	}
	if gotTailLines != "200" {
		t.Fatalf("tailLines = %q, want 200", gotTailLines)
	}
	if gotContainer != "api" {
		t.Fatalf("container = %q, want api", gotContainer)
	}
	if gotPrevious != "true" {
		t.Fatalf("previous = %q, want true", gotPrevious)
	}
	if gotFollow != "" {
		t.Fatalf("follow = %q, want empty for fixed log read", gotFollow)
	}
	if gotAccept != "*/*" {
		t.Fatalf("Accept = %q, want Kubernetes-compatible wildcard", gotAccept)
	}
	if logs.Warning != "" || logs.Container != "api" || !logs.Previous || logs.TailLines != 200 || len(logs.Lines) != 2 || logs.Lines[1] != "line-2" {
		t.Fatalf("logs = %+v, want two lines", logs)
	}
}

func TestKubernetesProviderStreamLogs(t *testing.T) {
	var gotPath string
	var gotTailLines string
	var gotContainer string
	var gotPrevious string
	var gotFollow string
	var gotAccept string
	longLine := strings.Repeat("x", podLogMaxLineBytes+20)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotTailLines = r.URL.Query().Get("tailLines")
		gotContainer = r.URL.Query().Get("container")
		gotPrevious = r.URL.Query().Get("previous")
		gotFollow = r.URL.Query().Get("follow")
		gotAccept = r.Header.Get("Accept")
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("Authorization = %q, want bearer token", got)
		}
		if gotAccept != "*/*" {
			http.Error(w, "not acceptable", http.StatusNotAcceptable)
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("line-1\n" + longLine + "\n"))
	}))
	defer server.Close()

	provider := KubernetesProvider{
		client: &kubeAPIClient{
			baseURL:    server.URL,
			bearer:     "test-token",
			httpClient: server.Client(),
		},
	}
	lines := []string{}
	err := provider.StreamLogs(context.Background(), ResourceRef{Kind: "Pod", Namespace: "checkout", Name: "checkout-api", Container: "api", Previous: true, TailLines: 3}, func(line string) error {
		lines = append(lines, line)
		return nil
	})
	if err != nil {
		t.Fatalf("StreamLogs() error = %v", err)
	}

	if gotPath != "/api/v1/namespaces/checkout/pods/checkout-api/log" {
		t.Fatalf("path = %q, want pod log path", gotPath)
	}
	if gotTailLines != "3" {
		t.Fatalf("tailLines = %q, want 3", gotTailLines)
	}
	if gotContainer != "api" {
		t.Fatalf("container = %q, want api", gotContainer)
	}
	if gotPrevious != "true" {
		t.Fatalf("previous = %q, want true", gotPrevious)
	}
	if gotFollow != "true" {
		t.Fatalf("follow = %q, want true", gotFollow)
	}
	if gotAccept != "*/*" {
		t.Fatalf("Accept = %q, want Kubernetes-compatible wildcard", gotAccept)
	}
	if len(lines) != 2 || lines[0] != "line-1" {
		t.Fatalf("lines = %+v, want two stream lines", lines)
	}
	if got := lines[1]; len(got) != podLogMaxLineBytes+3 || !strings.HasSuffix(got, "...") {
		t.Fatalf("truncated line length/suffix = %d/%q, want capped suffix", len(got), got[len(got)-3:])
	}
}

func TestKubernetesProviderResourceLogsForbiddenFallsBack(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	defer server.Close()

	provider := KubernetesProvider{
		client: &kubeAPIClient{
			baseURL:    server.URL,
			bearer:     "test-token",
			httpClient: server.Client(),
		},
	}
	logs, err := provider.ResourceLogs(context.Background(), ResourceRef{Kind: "Pod", Namespace: "checkout", Name: "checkout-api"})
	if err != nil {
		t.Fatalf("ResourceLogs() error = %v", err)
	}
	if logs.Warning != "logs_unavailable" || len(logs.Lines) != 0 || logs.TailLines != 200 {
		t.Fatalf("logs = %+v, want unavailable warning and empty list", logs)
	}
}

func TestKubernetesProviderResourceLogsRejectsInvalidReferenceWithDefaultLimit(t *testing.T) {
	provider := KubernetesProvider{}
	logs, err := provider.ResourceLogs(context.Background(), ResourceRef{Kind: "Service", TailLines: 3})
	if err != nil {
		t.Fatalf("ResourceLogs() error = %v", err)
	}
	if logs.Warning != "logs_unavailable" || len(logs.Lines) != 0 || logs.TailLines != podLogTailLines {
		t.Fatalf("logs = %+v, want safe unavailable response with default limit", logs)
	}
}

func TestKubernetesProviderStreamLogsRejectsNilCallback(t *testing.T) {
	provider := KubernetesProvider{}
	err := provider.StreamLogs(context.Background(), ResourceRef{Kind: "Pod", Namespace: "checkout", Name: "checkout-api"}, nil)
	if !errors.Is(err, errKubeLogStreamUnavailable) {
		t.Fatalf("StreamLogs() error = %v, want safe unavailable code", err)
	}
}

func TestCappedLogLinesLimitsLinesAndLineLength(t *testing.T) {
	longLine := strings.Repeat("x", podLogMaxLineBytes+20)
	lines := cappedLogLines(strings.Repeat("old\n", 5) + strings.Repeat("line\n", podLogTailLines) + longLine + "\n")

	if len(lines) != podLogTailLines {
		t.Fatalf("len(lines) = %d, want %d", len(lines), podLogTailLines)
	}
	if got := lines[len(lines)-1]; len(got) != podLogMaxLineBytes+3 || !strings.HasSuffix(got, "...") {
		t.Fatalf("last line length/suffix = %d/%q, want truncated suffix", len(got), got[len(got)-3:])
	}
}

func TestCustomResourceDefinitionSummaryHelpers(t *testing.T) {
	crd := customResourceDefinitionResource{}
	crd.Spec.Versions = append(crd.Spec.Versions,
		struct {
			Name    string `json:"name"`
			Served  bool   `json:"served"`
			Storage bool   `json:"storage"`
		}{Name: "v1beta1", Served: false},
		struct {
			Name    string `json:"name"`
			Served  bool   `json:"served"`
			Storage bool   `json:"storage"`
		}{Name: "v1", Served: true, Storage: true},
	)
	crd.Status.Conditions = []condition{{Type: "Established", Status: "True"}}

	if got := crdStatus(crd); got != "healthy" {
		t.Fatalf("crdStatus() = %q, want healthy", got)
	}
	if got := crdStorageVersion(crd); got != "v1" {
		t.Fatalf("crdStorageVersion() = %q, want v1", got)
	}
	served := crdServedVersions(crd)
	if len(served) != 1 || served[0] != "v1" {
		t.Fatalf("crdServedVersions() = %#v, want v1", served)
	}
}

func TestKubernetesProviderCustomResourceInstancesUsesStorageVersion(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("Authorization = %q, want bearer token", got)
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"items": []map[string]interface{}{
				{
					"apiVersion": "platform.example.com/v1",
					"kind":       "Widget",
					"metadata": map[string]interface{}{
						"name":      "checkout-dashboard",
						"namespace": "platform",
						"labels":    map[string]string{"app": "checkout"},
					},
					"spec": map[string]interface{}{
						"replicas": 2,
						"size":     "small",
					},
					"status": map[string]interface{}{
						"conditions": []map[string]string{{"type": "Ready", "status": "True"}},
					},
				},
			},
		}); err != nil {
			t.Fatalf("write response: %v", err)
		}
	}))
	defer server.Close()

	provider := KubernetesProvider{
		client: &kubeAPIClient{
			baseURL:    server.URL,
			bearer:     "test-token",
			httpClient: server.Client(),
		},
	}
	resources := provider.customResourceInstances(context.Background(), testCustomResourceDefinitionList(t))

	if gotPath != "/apis/platform.example.com/v1/widgets" {
		t.Fatalf("path = %q, want storage-version custom resource path", gotPath)
	}
	if len(resources) != 1 {
		t.Fatalf("resources = %d, want 1", len(resources))
	}
	resource := resources[0]
	if resource.CRDName != "widgets.platform.example.com" || resource.CRDGroup != "platform.example.com" || resource.CRDVersion != "v1" || resource.CRDScope != "Namespaced" {
		t.Fatalf("resource CRD context = %+v", resource)
	}
	if got := customResourceDisplayName(resource); got != "Widget:checkout-dashboard" {
		t.Fatalf("customResourceDisplayName() = %q, want Widget:checkout-dashboard", got)
	}
	if got := customResourceStatus(resource); got != "healthy" {
		t.Fatalf("customResourceStatus() = %q, want healthy", got)
	}
	if got := genericConditionSummary(resource.Status); got != "Ready=True" {
		t.Fatalf("genericConditionSummary() = %q, want Ready=True", got)
	}
}

func TestKubernetesProviderCustomResourceInstancesForbiddenFallsBack(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	defer server.Close()

	provider := KubernetesProvider{
		client: &kubeAPIClient{
			baseURL:    server.URL,
			bearer:     "test-token",
			httpClient: server.Client(),
		},
	}
	if resources := provider.customResourceInstances(context.Background(), testCustomResourceDefinitionList(t)); len(resources) != 0 {
		t.Fatalf("resources = %d, want 0 on optional forbidden custom resource list", len(resources))
	}
}

func TestNetworkPolicyTypesDefaultEgressWhenRulesExist(t *testing.T) {
	policy := networkPolicyResource{}
	if got := networkPolicyTypes(policy); len(got) != 1 || got[0] != "Ingress" {
		t.Fatalf("networkPolicyTypes() = %#v, want Ingress", got)
	}

	policy.Spec.Egress = []networkPolicyEgressRule{{}}
	if got := networkPolicyTypes(policy); len(got) != 2 || got[0] != "Ingress" || got[1] != "Egress" {
		t.Fatalf("networkPolicyTypes() = %#v, want Ingress,Egress", got)
	}
}

func testCustomResourceDefinitionList(t *testing.T) customResourceDefinitionList {
	t.Helper()
	var crds customResourceDefinitionList
	if err := json.Unmarshal([]byte(`{
		"items": [
			{
				"metadata": {"name": "widgets.platform.example.com"},
				"spec": {
					"group": "platform.example.com",
					"scope": "Namespaced",
					"names": {"kind": "Widget", "plural": "widgets"},
					"versions": [
						{"name": "v1beta1", "served": true},
						{"name": "v1", "served": true, "storage": true}
					]
				}
			}
		]
	}`), &crds); err != nil {
		t.Fatalf("decode test CRD: %v", err)
	}
	return crds
}
