package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

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

func TestKubernetesProviderResourceLogsReadsPodLog(t *testing.T) {
	var gotPath string
	var gotTailLines string
	var gotContainer string
	var gotPrevious string
	var gotFollow string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotTailLines = r.URL.Query().Get("tailLines")
		gotContainer = r.URL.Query().Get("container")
		gotPrevious = r.URL.Query().Get("previous")
		gotFollow = r.URL.Query().Get("follow")
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("Authorization = %q, want bearer token", got)
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
	longLine := strings.Repeat("x", podLogMaxLineBytes+20)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotTailLines = r.URL.Query().Get("tailLines")
		gotContainer = r.URL.Query().Get("container")
		gotPrevious = r.URL.Query().Get("previous")
		gotFollow = r.URL.Query().Get("follow")
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("Authorization = %q, want bearer token", got)
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

func TestGraphBuilderRedactsSensitiveAnnotations(t *testing.T) {
	builder := newKubeGraphBuilder("test")
	builder.addResourceNode("ConfigMap", metadata{
		Name: "app-config",
		Annotations: map[string]string{
			"owner":             "platform",
			"example.com/token": "redaction-fixture",
		},
	}, "healthy", nil)

	if len(builder.nodes) != 1 {
		t.Fatalf("nodes = %d, want 1", len(builder.nodes))
	}
	if got := builder.nodes[0].Annotations["owner"]; got != "platform" {
		t.Fatalf("owner annotation = %q, want platform", got)
	}
	if got := builder.nodes[0].Annotations["example.com/token"]; got != "redacted" {
		t.Fatalf("token annotation = %q, want redacted", got)
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

func TestCustomResourceReferenceEdgesInferSafeExistingTargets(t *testing.T) {
	builder := newKubeGraphBuilder("test")
	builder.addNode("CustomResourceDefinition", "", "widgets.platform.example.com", "healthy", nil, nil)
	builder.addNode("CustomResourceDefinition", "", "backends.platform.example.com", "healthy", nil, nil)
	builder.addNode("CustomResource", "checkout", "Widget:checkout-dashboard", "healthy", nil, nil)
	builder.addNode("Secret", "checkout", "checkout-api-secret", "unknown", nil, nil)
	builder.addNode("ConfigMap", "checkout", "checkout-config", "healthy", nil, nil)
	builder.addNode("Service", "checkout", "checkout-api", "healthy", nil, nil)
	builder.addNode("CustomResource", "checkout", "Backend:checkout-backend", "healthy", nil, nil)

	resource := customResourceInstance{
		customResourceInstanceResource: customResourceInstanceResource{
			APIVersion: "platform.example.com/v1",
			Kind:       "Widget",
			Metadata:   metadata{Name: "checkout-dashboard", Namespace: "checkout"},
			Spec: map[string]interface{}{
				"secretRef": map[string]interface{}{
					"name": "checkout-api-secret",
				},
				"configMapRefs": []interface{}{
					map[string]interface{}{"name": "checkout-config"},
					map[string]interface{}{"name": "missing-config"},
				},
				"backendRef": map[string]interface{}{
					"apiVersion": "v1",
					"kind":       "Service",
					"name":       "checkout-api",
				},
				"widgetBackendRef": map[string]interface{}{
					"apiVersion": "platform.example.com/v1",
					"kind":       "Backend",
					"name":       "checkout-backend",
				},
				"serviceAccountName": "missing-service-account",
			},
			Status: map[string]interface{}{"raw": "not-used-for-relations"},
		},
		CRDName:    "widgets.platform.example.com",
		CRDGroup:   "platform.example.com",
		CRDVersion: "v1",
		CRDScope:   "Namespaced",
	}

	builder.addCustomResourceReferenceEdges(resource, testCustomResourceRelationCRDs(t))

	assertEdge := func(target string, sourceField string) {
		t.Helper()
		for _, edge := range builder.edges {
			if edge.Type == "references" && edge.Target == target && edge.SourceField == sourceField && edge.Confidence == "inferred" {
				return
			}
		}
		t.Fatalf("references edge to %s via %s not found: %+v", target, sourceField, builder.edges)
	}
	assertEdge(builder.nodeID("Secret", "checkout", "checkout-api-secret"), "spec.secretRef")
	assertEdge(builder.nodeID("ConfigMap", "checkout", "checkout-config"), "spec.configMapRefs[0]")
	assertEdge(builder.nodeID("Service", "checkout", "checkout-api"), "spec.backendRef")
	assertEdge(builder.nodeID("CustomResource", "checkout", "Backend:checkout-backend"), "spec.widgetBackendRef")

	for _, edge := range builder.edges {
		if strings.Contains(edge.Target, "missing") {
			t.Fatalf("unexpected phantom target edge: %+v", edge)
		}
		if strings.Contains(edge.SourceField, "status") {
			t.Fatalf("unexpected status-based relation: %+v", edge)
		}
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

func testCustomResourceRelationCRDs(t *testing.T) customResourceDefinitionList {
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
					"versions": [{"name": "v1", "served": true, "storage": true}]
				}
			},
			{
				"metadata": {"name": "backends.platform.example.com"},
				"spec": {
					"group": "platform.example.com",
					"scope": "Namespaced",
					"names": {"kind": "Backend", "plural": "backends"},
					"versions": [{"name": "v1", "served": true, "storage": true}]
				}
			}
		]
	}`), &crds); err != nil {
		t.Fatalf("decode test CRDs: %v", err)
	}
	return crds
}

func TestNetworkPolicyPeerEdgesInferPodsWithMatchExpressions(t *testing.T) {
	builder := newKubeGraphBuilder("test")
	policyID := builder.addNode("NetworkPolicy", "checkout", "checkout-api", "healthy", nil, nil)
	builder.addNode("Pod", "platform", "frontend", "healthy", map[string]string{"app": "frontend"}, nil)
	builder.addNode("Pod", "checkout", "db", "healthy", map[string]string{"app": "db"}, nil)
	builder.addNode("Pod", "checkout", "metrics", "healthy", map[string]string{"app": "metrics", "scrape": "true"}, nil)
	builder.addNode("Pod", "checkout", "worker", "healthy", map[string]string{"app": "worker"}, nil)

	pods := podList{Items: []podResource{
		{Metadata: metadata{Name: "frontend", Namespace: "platform", Labels: map[string]string{"app": "frontend"}}},
		{Metadata: metadata{Name: "db", Namespace: "checkout", Labels: map[string]string{"app": "db"}}},
		{Metadata: metadata{Name: "metrics", Namespace: "checkout", Labels: map[string]string{"app": "metrics", "scrape": "true"}}},
		{Metadata: metadata{Name: "worker", Namespace: "checkout", Labels: map[string]string{"app": "worker"}}},
	}}
	namespaces := []namespaceRecord{
		{name: "platform", labels: map[string]string{"team": "platform"}},
		{name: "checkout", labels: map[string]string{"team": "commerce"}},
	}

	builder.addNetworkPolicyPeerEdges(policyID, "checkout", []networkPolicyPeer{
		{
			NamespaceSelector: &labelSelector{MatchExpressions: []labelSelectorMatchExpression{{Key: "team", Operator: "In", Values: []string{"platform"}}}},
			PodSelector:       &labelSelector{MatchExpressions: []labelSelectorMatchExpression{{Key: "app", Operator: "In", Values: []string{"frontend"}}}},
		},
		{
			PodSelector: &labelSelector{
				MatchExpressions: []labelSelectorMatchExpression{{Key: "app", Operator: "In", Values: []string{"db"}}},
			},
		},
		{
			PodSelector: &labelSelector{
				MatchLabels:      map[string]string{"app": "metrics"},
				MatchExpressions: []labelSelectorMatchExpression{{Key: "scrape", Operator: "Exists"}, {Key: "legacy", Operator: "DoesNotExist"}},
			},
		},
		{
			PodSelector: &labelSelector{
				MatchLabels:      map[string]string{"app": "worker"},
				MatchExpressions: []labelSelectorMatchExpression{{Key: "env", Operator: "NotIn", Values: []string{"prod"}}},
			},
		},
		{
			PodSelector: &labelSelector{
				MatchLabels:      map[string]string{"app": "worker"},
				MatchExpressions: []labelSelectorMatchExpression{{Key: "env", Operator: "Unknown", Values: []string{"prod"}}},
			},
		},
	}, "allows-ingress", "NetworkPolicy.spec.ingress.from", pods, namespaces)

	if len(builder.edges) != 4 {
		t.Fatalf("len(edges) = %d, want 4: %#v", len(builder.edges), builder.edges)
	}
	wantTargets := map[string]bool{
		"test:platform:Pod:frontend": false,
		"test:checkout:Pod:db":       false,
		"test:checkout:Pod:metrics":  false,
		"test:checkout:Pod:worker":   false,
	}
	for _, edge := range builder.edges {
		if edge.Type != "allows-ingress" || edge.Confidence != "inferred" {
			t.Fatalf("unexpected edge: %#v", edge)
		}
		if _, ok := wantTargets[edge.Target]; !ok {
			t.Fatalf("unexpected target: %#v", edge)
		}
		wantTargets[edge.Target] = true
	}
	for target, seen := range wantTargets {
		if !seen {
			t.Fatalf("missing target %s in %#v", target, builder.edges)
		}
	}
}
