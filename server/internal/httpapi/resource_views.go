package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	maxResourceViewPresets  = 8
	maxResourceViewNameLen  = 80
	maxResourceViewGroupLen = 40
	maxResourceViewQueryLen = 160
)

var errResourceViewsUnavailable = errors.New("resource views unavailable")

type resourceViewPreset struct {
	Name      string `json:"name"`
	Group     string `json:"group"`
	Query     string `json:"query"`
	Cluster   string `json:"cluster"`
	Namespace string `json:"namespace"`
	Kind      string `json:"kind"`
	Status    string `json:"status"`
	Order     int64  `json:"order"`
	UpdatedAt int64  `json:"updatedAt"`
}

type resourceViewPresetList struct {
	Items    []resourceViewPreset      `json:"items"`
	Metadata resourceViewStoreMetadata `json:"metadata"`
}

type resourceViewStoreMetadata struct {
	Version   int64  `json:"version"`
	UpdatedAt int64  `json:"updatedAt"`
	Count     int    `json:"count"`
	Storage   string `json:"storage"`
}

type resourceViewSnapshot struct {
	Items    []resourceViewPreset
	Metadata resourceViewStoreMetadata
}

type resourceViewPresetInput struct {
	Name      interface{} `json:"name"`
	Group     interface{} `json:"group"`
	Query     interface{} `json:"query"`
	Cluster   interface{} `json:"cluster"`
	Namespace interface{} `json:"namespace"`
	Kind      interface{} `json:"kind"`
	Status    interface{} `json:"status"`
	Order     interface{} `json:"order"`
	UpdatedAt interface{} `json:"updatedAt"`
}

type resourceViewPresetInputList struct {
	Items    []resourceViewPresetInput      `json:"items"`
	Metadata resourceViewStoreMetadataInput `json:"metadata"`
}

type resourceViewStoreMetadataInput struct {
	Version   interface{} `json:"version"`
	UpdatedAt interface{} `json:"updatedAt"`
	Count     interface{} `json:"count"`
	Storage   interface{} `json:"storage"`
}

type resourceViewStore interface {
	List(context.Context) (resourceViewSnapshot, error)
	Save(context.Context, []resourceViewPreset) (resourceViewSnapshot, error)
}

func newResourceViewStore(path string) resourceViewStore {
	if strings.TrimSpace(path) == "" {
		return &memoryResourceViewStore{}
	}
	return &fileResourceViewStore{path: path}
}

type memoryResourceViewStore struct {
	mu       sync.Mutex
	items    []resourceViewPreset
	metadata resourceViewStoreMetadata
}

func (s *memoryResourceViewStore) List(context.Context) (resourceViewSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return resourceViewSnapshot{
		Items:    cloneResourceViewPresets(s.items),
		Metadata: snapshotResourceViewStoreMetadata(s.metadata, len(s.items), "memory"),
	}, nil
}

func (s *memoryResourceViewStore) Save(_ context.Context, items []resourceViewPreset) (resourceViewSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items = cloneResourceViewPresets(items)
	s.metadata = nextResourceViewStoreMetadata(s.metadata, len(s.items), "memory", time.Now())
	return resourceViewSnapshot{
		Items:    cloneResourceViewPresets(s.items),
		Metadata: s.metadata,
	}, nil
}

type fileResourceViewStore struct {
	path string
	mu   sync.Mutex
}

func (s *fileResourceViewStore) List(context.Context) (resourceViewSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	file, err := os.Open(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return resourceViewSnapshot{
				Items:    []resourceViewPreset{},
				Metadata: snapshotResourceViewStoreMetadata(resourceViewStoreMetadata{}, 0, "file"),
			}, nil
		}
		return resourceViewSnapshot{}, fmt.Errorf("%w: read", errResourceViewsUnavailable)
	}
	defer file.Close()

	snapshot, err := decodeResourceViewPresetSnapshot(file, "file", time.Now())
	if err != nil {
		return resourceViewSnapshot{}, fmt.Errorf("%w: decode", errResourceViewsUnavailable)
	}
	return snapshot, nil
}

func (s *fileResourceViewStore) Save(_ context.Context, items []resourceViewPreset) (resourceViewSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return resourceViewSnapshot{}, fmt.Errorf("%w: mkdir", errResourceViewsUnavailable)
	}

	snapshot := resourceViewSnapshot{
		Items:    cloneResourceViewPresets(items),
		Metadata: nextResourceViewStoreMetadata(resourceViewStoreMetadata{}, len(items), "file", time.Now()),
	}
	payload, err := json.MarshalIndent(resourceViewPresetList{Items: snapshot.Items, Metadata: snapshot.Metadata}, "", "  ")
	if err != nil {
		return resourceViewSnapshot{}, fmt.Errorf("%w: encode", errResourceViewsUnavailable)
	}
	payload = append(payload, '\n')

	tmpFile, err := os.OpenFile(filepath.Join(dir, "."+filepath.Base(s.path)+".tmp"), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return resourceViewSnapshot{}, fmt.Errorf("%w: open", errResourceViewsUnavailable)
	}
	tmpName := tmpFile.Name()
	ok := false
	defer func() {
		if !ok {
			_ = os.Remove(tmpName)
		}
	}()

	if _, err := tmpFile.Write(payload); err != nil {
		_ = tmpFile.Close()
		return resourceViewSnapshot{}, fmt.Errorf("%w: write", errResourceViewsUnavailable)
	}
	if err := tmpFile.Close(); err != nil {
		return resourceViewSnapshot{}, fmt.Errorf("%w: close", errResourceViewsUnavailable)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		return resourceViewSnapshot{}, fmt.Errorf("%w: rename", errResourceViewsUnavailable)
	}
	ok = true
	return snapshot, nil
}

func decodeResourceViewPresetInputs(reader io.Reader) ([]resourceViewPresetInput, error) {
	snapshot, err := decodeResourceViewPresetInputSnapshot(reader)
	if err != nil {
		return nil, err
	}
	return snapshot.Items, nil
}

func decodeResourceViewPresetInputSnapshot(reader io.Reader) (resourceViewPresetInputList, error) {
	var payload resourceViewPresetInputList
	decoder := json.NewDecoder(reader)
	if err := decoder.Decode(&payload); err != nil {
		return resourceViewPresetInputList{}, err
	}
	return payload, nil
}

func decodeResourceViewPresetSnapshot(reader io.Reader, storage string, now time.Time) (resourceViewSnapshot, error) {
	payload, err := decodeResourceViewPresetInputSnapshot(reader)
	if err != nil {
		return resourceViewSnapshot{}, err
	}
	items := sanitizeResourceViewPresetInputs(payload.Items, now)
	metadata := metadataInput(payload.Metadata, items, storage)
	return resourceViewSnapshot{
		Items:    items,
		Metadata: metadata,
	}, nil
}

func sanitizeResourceViewPresetInputs(inputs []resourceViewPresetInput, now time.Time) []resourceViewPreset {
	seenNames := map[string]bool{}
	presets := []resourceViewPreset{}
	nowMillis := now.UnixMilli()
	for _, input := range inputs {
		name := truncateString(strings.TrimSpace(stringInput(input.Name, "")), maxResourceViewNameLen)
		if name == "" || seenNames[name] {
			continue
		}
		fallbackOrder := int64(len(presets) + 1)
		seenNames[name] = true
		presets = append(presets, resourceViewPreset{
			Name:      name,
			Group:     groupInput(input.Group),
			Query:     truncateString(stringInput(input.Query, ""), maxResourceViewQueryLen),
			Cluster:   filterInput(input.Cluster),
			Namespace: filterInput(input.Namespace),
			Kind:      filterInput(input.Kind),
			Status:    filterInput(input.Status),
			Order:     orderInput(input.Order, fallbackOrder),
			UpdatedAt: timestampInput(input.UpdatedAt, nowMillis),
		})
		if len(presets) >= maxResourceViewPresets {
			break
		}
	}
	return normalizeResourceViewPresetOrders(presets)
}

func groupInput(value interface{}) string {
	text := truncateString(strings.TrimSpace(stringInput(value, "")), maxResourceViewGroupLen)
	if text == "" {
		return "General"
	}
	return text
}

func stringInput(value interface{}, fallback string) string {
	text, ok := value.(string)
	if !ok {
		return fallback
	}
	return text
}

func filterInput(value interface{}) string {
	text := strings.TrimSpace(stringInput(value, ""))
	if text == "" {
		return "all"
	}
	return text
}

func timestampInput(value interface{}, fallback int64) int64 {
	switch typed := value.(type) {
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) || typed <= 0 {
			return fallback
		}
		return int64(typed)
	case int64:
		if typed <= 0 {
			return fallback
		}
		return typed
	case int:
		if typed <= 0 {
			return fallback
		}
		return int64(typed)
	default:
		return fallback
	}
}

func intInput(value interface{}, fallback int) int {
	switch typed := value.(type) {
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) || typed < 0 {
			return fallback
		}
		return int(typed)
	case int:
		if typed < 0 {
			return fallback
		}
		return typed
	case int64:
		if typed < 0 {
			return fallback
		}
		return int(typed)
	default:
		return fallback
	}
}

func metadataInput(input resourceViewStoreMetadataInput, items []resourceViewPreset, storage string) resourceViewStoreMetadata {
	fallbackUpdatedAt := maxResourceViewPresetUpdatedAt(items)
	metadata := resourceViewStoreMetadata{
		Version:   timestampInput(input.Version, fallbackUpdatedAt),
		UpdatedAt: timestampInput(input.UpdatedAt, fallbackUpdatedAt),
		Count:     intInput(input.Count, len(items)),
		Storage:   resourceViewStoreStorageInput(input.Storage, storage),
	}
	return snapshotResourceViewStoreMetadata(metadata, len(items), storage)
}

func resourceViewStoreStorageInput(value interface{}, fallback string) string {
	storage := strings.TrimSpace(stringInput(value, fallback))
	if storage != "file" && storage != "memory" {
		return fallback
	}
	return storage
}

func maxResourceViewPresetUpdatedAt(items []resourceViewPreset) int64 {
	var updatedAt int64
	for _, item := range items {
		if item.UpdatedAt > updatedAt {
			updatedAt = item.UpdatedAt
		}
	}
	return updatedAt
}

func nextResourceViewStoreMetadata(current resourceViewStoreMetadata, count int, storage string, now time.Time) resourceViewStoreMetadata {
	nowMillis := now.UnixMilli()
	version := nowMillis
	if current.Version >= version {
		version = current.Version + 1
	}
	return resourceViewStoreMetadata{
		Version:   version,
		UpdatedAt: nowMillis,
		Count:     count,
		Storage:   storage,
	}
}

func snapshotResourceViewStoreMetadata(metadata resourceViewStoreMetadata, count int, storage string) resourceViewStoreMetadata {
	if metadata.Storage != "file" && metadata.Storage != "memory" {
		metadata.Storage = storage
	}
	if metadata.Count != count {
		metadata.Count = count
	}
	if metadata.Version < 0 {
		metadata.Version = 0
	}
	if metadata.UpdatedAt < 0 {
		metadata.UpdatedAt = 0
	}
	return metadata
}

func orderInput(value interface{}, fallback int64) int64 {
	switch typed := value.(type) {
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) || typed <= 0 {
			return fallback
		}
		return int64(typed)
	case int64:
		if typed <= 0 {
			return fallback
		}
		return typed
	case int:
		if typed <= 0 {
			return fallback
		}
		return int64(typed)
	default:
		return fallback
	}
}

func normalizeResourceViewPresetOrders(items []resourceViewPreset) []resourceViewPreset {
	normalized := cloneResourceViewPresets(items)
	sort.SliceStable(normalized, func(left, right int) bool {
		return normalized[left].Order < normalized[right].Order
	})
	for index := range normalized {
		normalized[index].Order = int64(index + 1)
	}
	return normalized
}

func truncateString(value string, maxLength int) string {
	if utf8.RuneCountInString(value) <= maxLength {
		return value
	}
	runes := []rune(value)
	return string(runes[:maxLength])
}

func cloneResourceViewPresets(items []resourceViewPreset) []resourceViewPreset {
	if len(items) == 0 {
		return []resourceViewPreset{}
	}
	cloned := make([]resourceViewPreset, len(items))
	copy(cloned, items)
	return cloned
}
