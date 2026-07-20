package provider

import (
	"math"
	"strings"
	"unicode/utf8"
)

const (
	maxMetadataEntries      = 256
	maxAnnotationValueBytes = 512
	maxSummaryEntries       = 64
	maxSummaryKeyBytes      = 64
	maxSummaryStringBytes   = 512
	maxSummaryStringItems   = 256
	maxUIDBytes             = 128
	maxClusterIDBytes       = 64
	maxClusterNameBytes     = 128
	maxSummaryInteger       = 1_000_000_000
)

func safeMetadataLabels(values map[string]string) map[string]string {
	if len(values) > maxMetadataEntries {
		return map[string]string{}
	}
	safe := make(map[string]string, len(values))
	for key, value := range values {
		if !validLabelKey(key) || !validLabelValue(value) {
			continue
		}
		if sensitiveMetadataField(key) || looksSensitiveMetadataValue(value) {
			safe[key] = "redacted"
			continue
		}
		safe[key] = value
	}
	return safe
}

func safeMetadataAnnotations(values map[string]string) map[string]string {
	if len(values) > maxMetadataEntries {
		return map[string]string{}
	}
	safe := make(map[string]string, len(values))
	for key, value := range values {
		if !validLabelKey(key) {
			continue
		}
		if sensitiveMetadataField(key) || riskyAnnotationKey(key) || sensitiveMetadataField(value) || looksSensitiveMetadataValue(value) {
			safe[key] = "redacted"
			continue
		}
		if sanitized, ok := safeVisibleText(value, maxAnnotationValueBytes); ok {
			safe[key] = sanitized
		} else {
			safe[key] = "omitted"
		}
	}
	return safe
}

func riskyAnnotationKey(value string) bool {
	normalized := strings.ToLower(value)
	return strings.Contains(normalized, "last-applied-configuration") ||
		strings.Contains(normalized, "release.v1") ||
		strings.Contains(normalized, "checksum/secret") ||
		strings.Contains(normalized, "certificate") ||
		strings.Contains(normalized, "client-key")
}

func sensitiveMetadataField(value string) bool {
	normalized := strings.ToLower(value)
	return strings.Contains(normalized, "token") ||
		strings.Contains(normalized, "password") ||
		strings.Contains(normalized, "secret") ||
		strings.Contains(normalized, "credential") ||
		strings.Contains(normalized, "apikey") ||
		strings.Contains(normalized, "api-key") ||
		strings.Contains(normalized, "accesskey") ||
		strings.Contains(normalized, "access-key") ||
		strings.Contains(normalized, "private-key") ||
		strings.Contains(normalized, "client-key")
}

func looksSensitiveMetadataValue(value string) bool {
	normalized := strings.ToLower(value)
	return strings.Contains(normalized, "-----begin ") ||
		strings.Contains(normalized, "bearer ") ||
		strings.Contains(normalized, "token=") ||
		strings.Contains(normalized, "token:") ||
		strings.Contains(normalized, "password=") ||
		strings.Contains(normalized, "password:") ||
		strings.Contains(normalized, "secret=") ||
		strings.Contains(normalized, "apikey=") ||
		strings.Contains(normalized, "api_key=")
}

func safeSummaryMap(values map[string]interface{}) map[string]interface{} {
	if len(values) > maxSummaryEntries {
		return map[string]interface{}{}
	}
	safe := make(map[string]interface{}, len(values))
	for key, value := range values {
		if !validSummaryKey(key) {
			continue
		}
		if sensitiveMetadataField(key) {
			safe[key] = "redacted"
			continue
		}
		if sanitized, ok := safeSummaryValue(value); ok {
			safe[key] = sanitized
		}
	}
	return safe
}

func validSummaryKey(value string) bool {
	if value == "" || len(value) > maxSummaryKeyBytes || !isASCIIAlpha(value[0]) {
		return false
	}
	for index := 1; index < len(value); index++ {
		character := value[index]
		if !isASCIIAlphanumeric(character) && character != '-' && character != '_' && character != '.' {
			return false
		}
	}
	return true
}

func safeSummaryValue(value interface{}) (interface{}, bool) {
	switch typed := value.(type) {
	case nil:
		return nil, true
	case bool:
		return typed, true
	case string:
		if looksSensitiveMetadataValue(typed) {
			return "redacted", true
		}
		if sanitized, ok := safeVisibleText(typed, maxSummaryStringBytes); ok {
			return sanitized, true
		}
		return "omitted", true
	case []string:
		if len(typed) > maxSummaryStringItems {
			return []string{}, true
		}
		safe := make([]string, 0, len(typed))
		for _, item := range typed {
			if looksSensitiveMetadataValue(item) {
				safe = append(safe, "redacted")
				continue
			}
			if sanitized, ok := safeVisibleText(item, maxSummaryStringBytes); ok {
				safe = append(safe, sanitized)
			}
		}
		return safe, true
	case int:
		if !validSummaryInteger(int64(typed)) {
			return "invalid", true
		}
		return typed, true
	case int32:
		if !validSummaryInteger(int64(typed)) {
			return "invalid", true
		}
		return typed, true
	case int64:
		if !validSummaryInteger(typed) {
			return "invalid", true
		}
		return typed, true
	case uint:
		if uint64(typed) > maxSummaryInteger {
			return "invalid", true
		}
		return typed, true
	case uint32:
		if uint64(typed) > maxSummaryInteger {
			return "invalid", true
		}
		return typed, true
	case uint64:
		if typed > maxSummaryInteger {
			return "invalid", true
		}
		return typed, true
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) || math.Abs(typed) > maxSummaryInteger {
			return "invalid", true
		}
		return typed, true
	default:
		return "omitted", true
	}
}

func validSummaryInteger(value int64) bool {
	return value >= -maxSummaryInteger && value <= maxSummaryInteger
}

func safeVisibleText(value string, maxBytes int) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) > maxBytes || !utf8.ValidString(trimmed) {
		return "", false
	}
	for _, character := range trimmed {
		if character < 0x20 || character == 0x7f {
			return "", false
		}
	}
	return trimmed, true
}

func safeUID(value string) string {
	if value == "" || len(value) > maxUIDBytes {
		return ""
	}
	for index := 0; index < len(value); index++ {
		character := value[index]
		if !isASCIIAlphanumeric(character) && character != '-' {
			return ""
		}
	}
	return value
}

func safeNodeStatus(value string) string {
	if value == "healthy" || value == "warning" || value == "error" || value == "unknown" {
		return value
	}
	return "unknown"
}

func safeAgeSummary(value string) string {
	if sanitized, ok := safeVisibleText(value, 64); ok {
		return sanitized
	}
	return "unknown"
}

func safeClusterID(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || len(trimmed) > maxClusterIDBytes {
		return "in-cluster"
	}
	for index := 0; index < len(trimmed); index++ {
		character := trimmed[index]
		if !isASCIIAlphanumeric(character) && character != '-' && character != '_' && character != '.' {
			return "in-cluster"
		}
	}
	return trimmed
}

func safeClusterName(value string, fallback string) string {
	if sanitized, ok := safeVisibleText(value, maxClusterNameBytes); ok && sanitized != "" {
		return sanitized
	}
	return fallback
}

func safeClusterVersion(value string) string {
	if looksSensitiveMetadataValue(value) {
		return "unknown"
	}
	if sanitized, ok := safeVisibleText(value, 128); ok && sanitized != "" {
		return sanitized
	}
	return "unknown"
}

func safeOwnerSummaries(values []string) []string {
	if len(values) > maxOwnerSummaryItems {
		return []string{}
	}
	safe := make([]string, 0, len(values))
	for _, value := range values {
		kind, name, found := strings.Cut(value, "/")
		if found && validKubernetesKind(kind) && validKubernetesReferenceName(name) {
			safe = append(safe, kind+"/"+name)
		}
	}
	return uniqueStrings(safe)
}

func validGraphNodeIdentity(kind string, namespace string, name string) bool {
	if !validKubernetesKind(kind) || namespace != "" && !validKubernetesNamespace(namespace) {
		return false
	}
	if kind == "Cluster" {
		_, ok := safeVisibleText(name, maxClusterNameBytes)
		return namespace == "" && ok && strings.TrimSpace(name) != ""
	}
	if kind == "CustomResource" {
		resourceKind, resourceName, found := strings.Cut(name, ":")
		return found && validKubernetesKind(resourceKind) && validKubernetesReferenceName(resourceName)
	}
	return validKubernetesReferenceName(name)
}

func validGraphEdgeMetadata(edgeType string, sourceField string, confidence string) bool {
	if confidence != "observed" && confidence != "inferred" {
		return false
	}
	if edgeType == "" || len(edgeType) > 64 || sourceField == "" || len(sourceField) > 512 {
		return false
	}
	for index := 0; index < len(edgeType); index++ {
		character := edgeType[index]
		if !(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') && character != '-' {
			return false
		}
	}
	sanitized, ok := safeVisibleText(sourceField, 512)
	return ok && sanitized == sourceField
}
