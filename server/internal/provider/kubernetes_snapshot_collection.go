package provider

import (
	"context"
	"errors"
	"sort"
	"sync"

	"kuviewer/server/internal/topology"
)

type snapshotFetchTask struct {
	id       string
	resource string
	fetch    func() error
}

func collectSnapshotFetches(ctx context.Context, concurrency int, tasks []snapshotFetchTask) ([]topology.SnapshotDiagnostic, error) {
	if len(tasks) == 0 {
		return nil, nil
	}
	if concurrency < 1 {
		concurrency = 1
	}
	if concurrency > len(tasks) {
		concurrency = len(tasks)
	}

	taskErrors := make([]error, len(tasks))
	semaphore := make(chan struct{}, concurrency)
	var waitGroup sync.WaitGroup
	for index, task := range tasks {
		waitGroup.Add(1)
		go func(index int, task snapshotFetchTask) {
			defer waitGroup.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				return
			}
			taskErrors[index] = task.fetch()
		}(index, task)
	}
	waitGroup.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	diagnostics := make([]topology.SnapshotDiagnostic, 0)
	for index, err := range taskErrors {
		if err == nil {
			continue
		}
		diagnostics = append(diagnostics, topology.SnapshotDiagnostic{
			ID:       tasks[index].id,
			Resource: tasks[index].resource,
			Reason:   snapshotDiagnosticReason(err),
			Count:    1,
		})
	}
	return diagnostics, nil
}

func snapshotDiagnosticReason(err error) string {
	switch {
	case errors.Is(err, errKubeAPIResponseTooLarge):
		return "response_too_large"
	case errors.Is(err, errKubeAPIListIncomplete):
		return "pagination_incomplete"
	case errors.Is(err, errKubeAPIListTokenLoop), errors.Is(err, errKubeAPIListTokenInvalid):
		return "pagination_token_invalid"
	case errors.Is(err, errKubeAPIListPageLimit):
		return "pagination_page_limit"
	case errors.Is(err, errKubeAPIListItemLimit):
		return "pagination_item_limit"
	case errors.Is(err, errKubeAPIListTotalBytesLimit):
		return "pagination_byte_limit"
	case errors.Is(err, errKubeAPIInvalidResponse):
		return "invalid_response"
	case errors.Is(err, errKubeAPIReadFailed):
		return "response_read_failed"
	case errors.Is(err, errKubeAPIUnavailable):
		return "api_unavailable"
	case errors.Is(err, errKubeAPIInvalidRequest):
		return "request_invalid"
	default:
		return "request_failed"
	}
}

func aggregateSnapshotDiagnostics(diagnostics []topology.SnapshotDiagnostic) []topology.SnapshotDiagnostic {
	if len(diagnostics) < 2 {
		return diagnostics
	}
	type diagnosticKey struct {
		id       string
		resource string
		reason   string
	}
	counts := make(map[diagnosticKey]int, len(diagnostics))
	keys := make([]diagnosticKey, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		key := diagnosticKey{id: diagnostic.ID, resource: diagnostic.Resource, reason: diagnostic.Reason}
		if _, exists := counts[key]; !exists {
			keys = append(keys, key)
		}
		count := diagnostic.Count
		if count < 1 {
			count = 1
		}
		counts[key] += count
	}
	sort.SliceStable(keys, func(i, j int) bool {
		if keys[i].id != keys[j].id {
			return keys[i].id < keys[j].id
		}
		if keys[i].resource != keys[j].resource {
			return keys[i].resource < keys[j].resource
		}
		return keys[i].reason < keys[j].reason
	})
	aggregated := make([]topology.SnapshotDiagnostic, 0, len(keys))
	for _, key := range keys {
		aggregated = append(aggregated, topology.SnapshotDiagnostic{ID: key.id, Resource: key.resource, Reason: key.reason, Count: counts[key]})
	}
	return aggregated
}
