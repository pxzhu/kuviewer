package provider

import (
	"context"
	"errors"
	"net/url"
	"strconv"
)

const (
	kubeListPageSize      = 500
	kubeListMaxPages      = 200
	kubeListMaxItems      = 100_000
	kubeListMaxTotalBytes = 128 * 1024 * 1024
	kubeListMaxTokenBytes = 4096
)

var (
	errKubeAPIListIncomplete      = errors.New("kubernetes_api_list_incomplete")
	errKubeAPIListTokenLoop       = errors.New("kubernetes_api_list_token_loop")
	errKubeAPIListTokenInvalid    = errors.New("kubernetes_api_list_token_invalid")
	errKubeAPIListPageLimit       = errors.New("kubernetes_api_list_page_limit")
	errKubeAPIListItemLimit       = errors.New("kubernetes_api_list_item_limit")
	errKubeAPIListTotalBytesLimit = errors.New("kubernetes_api_list_total_bytes_limit")
)

type kubeListLimits struct {
	PageSize      int
	MaxPages      int
	MaxItems      int
	MaxPageBytes  int64
	MaxTotalBytes int64
}

func getKubeListJSON[T any](ctx context.Context, client *kubeAPIClient, path string, out *kubeList[T], optional bool) error {
	_, err := getKubeListJSONStatus(ctx, client, path, out, optional)
	return err
}

func getKubeListJSONStatus[T any](ctx context.Context, client *kubeAPIClient, path string, out *kubeList[T], optional bool) (bool, error) {
	return getKubeListJSONStatusWithLimits(ctx, client, path, out, optional, defaultKubeListLimits())
}

func defaultKubeListLimits() kubeListLimits {
	return kubeListLimits{
		PageSize:      kubeListPageSize,
		MaxPages:      kubeListMaxPages,
		MaxItems:      kubeListMaxItems,
		MaxPageBytes:  kubeJSONMaxBytes,
		MaxTotalBytes: kubeListMaxTotalBytes,
	}
}

func getKubeListJSONStatusWithLimits[T any](ctx context.Context, client *kubeAPIClient, path string, out *kubeList[T], optional bool, limits kubeListLimits) (bool, error) {
	if out == nil {
		return false, errKubeAPIInvalidRequest
	}
	*out = kubeList[T]{}
	if client == nil || client.httpClient == nil || limits.PageSize < 1 || limits.MaxPages < 1 || limits.MaxItems < 1 || limits.MaxPageBytes < 1 || limits.MaxTotalBytes < 1 {
		return false, errKubeAPIInvalidRequest
	}

	items := make([]T, 0)
	seenTokens := map[string]struct{}{}
	nextToken := ""
	totalBytes := int64(0)
	for pageIndex := 0; pageIndex < limits.MaxPages; pageIndex++ {
		pagePath, err := kubeListPagePath(path, nextToken, limits.PageSize)
		if err != nil {
			return false, err
		}
		page := kubeList[T]{}
		requestOptional := optional || pageIndex > 0
		found, pageBytes, err := client.getJSONStatusBounded(ctx, pagePath, &page, requestOptional, limits.MaxPageBytes)
		if err != nil {
			return false, err
		}
		if !found {
			if pageIndex == 0 {
				return false, nil
			}
			return false, errKubeAPIListIncomplete
		}

		totalBytes += pageBytes
		if totalBytes > limits.MaxTotalBytes {
			return false, errKubeAPIListTotalBytesLimit
		}
		if len(items)+len(page.Items) > limits.MaxItems {
			return false, errKubeAPIListItemLimit
		}
		items = append(items, page.Items...)
		if page.Metadata.Continue == "" {
			out.Metadata = page.Metadata
			out.Items = items
			return true, nil
		}
		if len(page.Metadata.Continue) > kubeListMaxTokenBytes {
			return false, errKubeAPIListTokenInvalid
		}
		if _, exists := seenTokens[page.Metadata.Continue]; exists {
			return false, errKubeAPIListTokenLoop
		}
		seenTokens[page.Metadata.Continue] = struct{}{}
		nextToken = page.Metadata.Continue
	}
	return false, errKubeAPIListPageLimit
}

func kubeListPagePath(path string, continueToken string, pageSize int) (string, error) {
	parsed, err := url.Parse(path)
	if err != nil || pageSize < 1 {
		return "", errKubeAPIInvalidRequest
	}
	query, err := url.ParseQuery(parsed.RawQuery)
	if err != nil {
		return "", errKubeAPIInvalidRequest
	}
	query.Set("limit", strconv.Itoa(pageSize))
	if continueToken == "" {
		query.Del("continue")
	} else {
		query.Set("continue", continueToken)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}
