package provider

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	serviceAccountTokenFile = "/var/run/secrets/kubernetes.io/serviceaccount/token"
	serviceAccountCAFile    = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
	kubeJSONMaxBytes        = 16 * 1024 * 1024
)

var (
	errKubeConfigInvalid       = errors.New("kubernetes_config_invalid")
	errKubeTokenFileRead       = errors.New("kubernetes_token_file_unavailable")
	errKubeBearerRequired      = errors.New("kubernetes_bearer_token_required")
	errKubeCAFileRead          = errors.New("kubernetes_ca_file_unavailable")
	errKubeCAInvalid           = errors.New("kubernetes_ca_invalid")
	errKubeAPIInvalidRequest   = errors.New("kubernetes_api_request_invalid")
	errKubeAPIInvalidResponse  = errors.New("kubernetes_api_invalid_response")
	errKubeAPIReadFailed       = errors.New("kubernetes_api_read_failed")
	errKubeAPIUnavailable      = errors.New("kubernetes_api_unavailable")
	errKubeAPIResponseTooLarge = errors.New("kubernetes_api_response_too_large")
)

type kubeProviderConfig struct {
	client      *kubeAPIClient
	clusterID   string
	clusterName string
}

type kubeAPIClient struct {
	baseURL    string
	bearer     string
	httpClient *http.Client
}

func kubeConfigFromEnv() (kubeProviderConfig, error) {
	apiServer := strings.TrimSpace(os.Getenv("KUVIEWER_KUBE_API_SERVER"))
	token := strings.TrimSpace(os.Getenv("KUVIEWER_KUBE_BEARER_TOKEN"))
	tokenFile := strings.TrimSpace(os.Getenv("KUVIEWER_KUBE_TOKEN_FILE"))
	caFile := strings.TrimSpace(os.Getenv("KUVIEWER_KUBE_CA_FILE"))

	if apiServer == "" {
		host := strings.TrimSpace(os.Getenv("KUBERNETES_SERVICE_HOST"))
		port := strings.TrimSpace(os.Getenv("KUBERNETES_SERVICE_PORT"))
		if port == "" {
			port = "443"
		}
		if host == "" {
			return kubeProviderConfig{}, errKubeConfigInvalid
		}

		apiServer = "https://" + net.JoinHostPort(host, port)
		if tokenFile == "" {
			tokenFile = serviceAccountTokenFile
		}
		if caFile == "" {
			caFile = serviceAccountCAFile
		}
	}

	baseURL, err := normalizeKubeAPIServer(apiServer)
	if err != nil {
		return kubeProviderConfig{}, err
	}
	if token == "" && tokenFile != "" {
		data, readErr := os.ReadFile(tokenFile)
		if readErr != nil {
			return kubeProviderConfig{}, errKubeTokenFileRead
		}
		token = strings.TrimSpace(string(data))
	}
	if token == "" {
		return kubeProviderConfig{}, errKubeBearerRequired
	}

	httpClient, err := kubeHTTPClient(baseURL, caFile)
	if err != nil {
		return kubeProviderConfig{}, err
	}

	clusterID := envOrDefault("KUVIEWER_CLUSTER_ID", "in-cluster")
	clusterName := envOrDefault("KUVIEWER_CLUSTER_NAME", clusterID)
	return kubeProviderConfig{
		client:      &kubeAPIClient{baseURL: baseURL, bearer: token, httpClient: httpClient},
		clusterID:   clusterID,
		clusterName: clusterName,
	}, nil
}

func normalizeKubeAPIServer(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errKubeConfigInvalid
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawPath = strings.TrimRight(parsed.RawPath, "/")
	return parsed.String(), nil
}

func kubeHTTPClient(apiServer string, caFile string) (*http.Client, error) {
	normalized, err := normalizeKubeAPIServer(apiServer)
	if err != nil {
		return nil, err
	}
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}
	if insecure, _ := strconv.ParseBool(os.Getenv("KUVIEWER_KUBE_INSECURE_SKIP_TLS_VERIFY")); insecure {
		tlsConfig.InsecureSkipVerify = true //nolint:gosec // Explicit local-development escape hatch, disabled by default.
	}

	if strings.HasPrefix(normalized, "https://") && caFile != "" {
		data, readErr := os.ReadFile(caFile)
		if readErr != nil {
			if caFile != serviceAccountCAFile {
				return nil, errKubeCAFileRead
			}
		} else {
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM(data) {
				return nil, errKubeCAInvalid
			}
			tlsConfig.RootCAs = pool
		}
	}

	return &http.Client{
		Timeout:   15 * time.Second,
		Transport: &http.Transport{TLSClientConfig: tlsConfig},
	}, nil
}

func (c *kubeAPIClient) getJSON(ctx context.Context, path string, out interface{}, optional bool) error {
	_, err := c.getJSONStatus(ctx, path, out, optional)
	return err
}

func (c *kubeAPIClient) probeCapability(ctx context.Context, paths []string) (string, string) {
	bestStatus := "missing"
	bestReason := "api_not_installed"
	for _, path := range paths {
		status, reason := c.probeCapabilityPath(ctx, path)
		if status == "available" {
			return status, reason
		}
		if capabilityStatusPriority(status) > capabilityStatusPriority(bestStatus) {
			bestStatus = status
			bestReason = reason
		}
	}
	return bestStatus, bestReason
}

func (c *kubeAPIClient) probeCapabilityPath(ctx context.Context, path string) (string, string) {
	separator := "?"
	if strings.Contains(path, "?") {
		separator = "&"
	}
	request, err := c.newRequest(ctx, path+separator+"limit=1", "application/json")
	if err != nil {
		return "unavailable", "request_failed"
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return "unavailable", "request_failed"
	}
	defer response.Body.Close()
	discardKubeAPIResponseBody(response.Body)

	switch response.StatusCode {
	case http.StatusUnauthorized:
		return "unauthorized", "authentication_failed"
	case http.StatusForbidden:
		return "forbidden", "rbac_denied"
	case http.StatusNotFound:
		return "missing", "api_not_installed"
	default:
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			return "available", "read_allowed"
		}
		return "unavailable", "request_failed"
	}
}

func capabilityStatusPriority(status string) int {
	switch status {
	case "available":
		return 4
	case "unauthorized", "forbidden":
		return 3
	case "unavailable":
		return 2
	default:
		return 1
	}
}

func (c *kubeAPIClient) getJSONStatus(ctx context.Context, path string, out interface{}, optional bool) (bool, error) {
	found, _, err := c.getJSONStatusBounded(ctx, path, out, optional, kubeJSONMaxBytes)
	return found, err
}

func (c *kubeAPIClient) getJSONStatusBounded(ctx context.Context, path string, out interface{}, optional bool, maxBytes int64) (bool, int64, error) {
	if out == nil || !validKubeResponseLimit(maxBytes) {
		return false, 0, errKubeAPIInvalidRequest
	}
	request, err := c.newRequest(ctx, path, "application/json")
	if err != nil {
		return false, 0, err
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return false, 0, safeKubeAPITransportError(ctx)
	}
	defer response.Body.Close()

	if optional && (response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusForbidden) {
		discardKubeAPIResponseBody(response.Body)
		return false, 0, nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		discardKubeAPIResponseBody(response.Body)
		return false, 0, kubeAPIStatusError(response.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return false, 0, errKubeAPIReadFailed
	}
	if int64(len(body)) > maxBytes {
		return false, int64(len(body)), errKubeAPIResponseTooLarge
	}
	if err := json.Unmarshal(body, out); err != nil {
		return false, int64(len(body)), errKubeAPIInvalidResponse
	}
	return true, int64(len(body)), nil
}

func (c *kubeAPIClient) getTextStatus(ctx context.Context, path string, optional bool, maxBytes int64) (bool, string, error) {
	if !validKubeResponseLimit(maxBytes) {
		return false, "", errKubeAPIInvalidRequest
	}
	request, err := c.newRequest(ctx, path, "*/*")
	if err != nil {
		return false, "", err
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return false, "", safeKubeAPITransportError(ctx)
	}
	defer response.Body.Close()

	if optional && (response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusForbidden || response.StatusCode == http.StatusBadRequest) {
		discardKubeAPIResponseBody(response.Body)
		return false, "", nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		discardKubeAPIResponseBody(response.Body)
		return false, "", kubeAPIStatusError(response.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return false, "", errKubeAPIReadFailed
	}
	if int64(len(body)) > maxBytes {
		body = body[:maxBytes]
	}
	return true, string(body), nil
}

func (c *kubeAPIClient) streamText(ctx context.Context, path string, optional bool, maxBytes int64, onLine func(string) error) (bool, error) {
	if !validKubeResponseLimit(maxBytes) || onLine == nil {
		return false, errKubeAPIInvalidRequest
	}
	request, err := c.newRequest(ctx, path, "*/*")
	if err != nil {
		return false, err
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return false, safeKubeAPITransportError(ctx)
	}
	defer response.Body.Close()

	if optional && (response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusForbidden || response.StatusCode == http.StatusBadRequest) {
		discardKubeAPIResponseBody(response.Body)
		return false, nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		discardKubeAPIResponseBody(response.Body)
		return false, kubeAPIStatusError(response.StatusCode)
	}

	scanner := bufio.NewScanner(io.LimitReader(response.Body, maxBytes+1))
	scanner.Buffer(make([]byte, 0, 64*1024), int(maxBytes)+1)
	for scanner.Scan() {
		if err := onLine(scanner.Text()); err != nil {
			return true, err
		}
	}
	if err := scanner.Err(); err != nil {
		return true, errKubeAPIReadFailed
	}
	return true, nil
}

func (c *kubeAPIClient) getGatewayRouteJSON(ctx context.Context, resource string, out *gatewayRouteList) error {
	found, err := getKubeListJSONStatus(ctx, c, "/apis/gateway.networking.k8s.io/v1/"+resource, out, true)
	if err != nil || found {
		return err
	}
	_, err = getKubeListJSONStatus(ctx, c, "/apis/gateway.networking.k8s.io/v1alpha2/"+resource, out, true)
	return err
}

func validKubeResponseLimit(maxBytes int64) bool {
	return maxBytes > 0 && maxBytes <= kubeJSONMaxBytes
}

func (c *kubeAPIClient) newRequest(ctx context.Context, path string, accept string) (*http.Request, error) {
	if c == nil || c.httpClient == nil || ctx == nil || !strings.HasPrefix(path, "/") || (accept != "application/json" && accept != "*/*") {
		return nil, errKubeAPIInvalidRequest
	}
	baseURL, err := normalizeKubeAPIServer(c.baseURL)
	if err != nil {
		return nil, errKubeAPIInvalidRequest
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+path, nil)
	if err != nil {
		return nil, errKubeAPIInvalidRequest
	}
	if c.bearer != "" {
		request.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	request.Header.Set("Accept", accept)
	return request, nil
}

func safeKubeAPITransportError(ctx context.Context) error {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	return errKubeAPIUnavailable
}

func kubeAPIStatusError(statusCode int) error {
	return fmt.Errorf("kubernetes_api_status_%d", statusCode)
}

func discardKubeAPIResponseBody(body io.Reader) {
	_, _ = io.Copy(io.Discard, io.LimitReader(body, 4096))
}
