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
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	maxResourceViewPresets  = 8
	maxResourceViewNameLen  = 80
	maxResourceViewQueryLen = 160
)

var errResourceViewsUnavailable = errors.New("resource views unavailable")

type resourceViewPreset struct {
	Name      string `json:"name"`
	Query     string `json:"query"`
	Cluster   string `json:"cluster"`
	Namespace string `json:"namespace"`
	Kind      string `json:"kind"`
	Status    string `json:"status"`
	UpdatedAt int64  `json:"updatedAt"`
}

type resourceViewPresetList struct {
	Items []resourceViewPreset `json:"items"`
}

type resourceViewPresetInput struct {
	Name      interface{} `json:"name"`
	Query     interface{} `json:"query"`
	Cluster   interface{} `json:"cluster"`
	Namespace interface{} `json:"namespace"`
	Kind      interface{} `json:"kind"`
	Status    interface{} `json:"status"`
	UpdatedAt interface{} `json:"updatedAt"`
}

type resourceViewPresetInputList struct {
	Items []resourceViewPresetInput `json:"items"`
}

type resourceViewStore interface {
	List(context.Context) ([]resourceViewPreset, error)
	Save(context.Context, []resourceViewPreset) ([]resourceViewPreset, error)
}

func newResourceViewStore(path string) resourceViewStore {
	if strings.TrimSpace(path) == "" {
		return &memoryResourceViewStore{}
	}
	return &fileResourceViewStore{path: path}
}

type memoryResourceViewStore struct {
	mu    sync.Mutex
	items []resourceViewPreset
}

func (s *memoryResourceViewStore) List(context.Context) ([]resourceViewPreset, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneResourceViewPresets(s.items), nil
}

func (s *memoryResourceViewStore) Save(_ context.Context, items []resourceViewPreset) ([]resourceViewPreset, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items = cloneResourceViewPresets(items)
	return cloneResourceViewPresets(s.items), nil
}

type fileResourceViewStore struct {
	path string
	mu   sync.Mutex
}

func (s *fileResourceViewStore) List(context.Context) ([]resourceViewPreset, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	file, err := os.Open(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []resourceViewPreset{}, nil
		}
		return nil, fmt.Errorf("%w: read", errResourceViewsUnavailable)
	}
	defer file.Close()

	items, err := decodeResourceViewPresetInputs(file)
	if err != nil {
		return nil, fmt.Errorf("%w: decode", errResourceViewsUnavailable)
	}
	return sanitizeResourceViewPresetInputs(items, time.Now()), nil
}

func (s *fileResourceViewStore) Save(_ context.Context, items []resourceViewPreset) ([]resourceViewPreset, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("%w: mkdir", errResourceViewsUnavailable)
	}

	payload, err := json.MarshalIndent(resourceViewPresetList{Items: cloneResourceViewPresets(items)}, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("%w: encode", errResourceViewsUnavailable)
	}
	payload = append(payload, '\n')

	tmpFile, err := os.OpenFile(filepath.Join(dir, "."+filepath.Base(s.path)+".tmp"), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, fmt.Errorf("%w: open", errResourceViewsUnavailable)
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
		return nil, fmt.Errorf("%w: write", errResourceViewsUnavailable)
	}
	if err := tmpFile.Close(); err != nil {
		return nil, fmt.Errorf("%w: close", errResourceViewsUnavailable)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		return nil, fmt.Errorf("%w: rename", errResourceViewsUnavailable)
	}
	ok = true
	return cloneResourceViewPresets(items), nil
}

func decodeResourceViewPresetInputs(reader io.Reader) ([]resourceViewPresetInput, error) {
	var payload resourceViewPresetInputList
	decoder := json.NewDecoder(reader)
	if err := decoder.Decode(&payload); err != nil {
		return nil, err
	}
	return payload.Items, nil
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
		seenNames[name] = true
		presets = append(presets, resourceViewPreset{
			Name:      name,
			Query:     truncateString(stringInput(input.Query, ""), maxResourceViewQueryLen),
			Cluster:   filterInput(input.Cluster),
			Namespace: filterInput(input.Namespace),
			Kind:      filterInput(input.Kind),
			Status:    filterInput(input.Status),
			UpdatedAt: timestampInput(input.UpdatedAt, nowMillis),
		})
		if len(presets) >= maxResourceViewPresets {
			break
		}
	}
	return presets
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
