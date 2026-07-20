package provider

import (
	"bytes"
	"encoding/json"
	"strings"
)

const maxConfigMapEntries = 4096

type configMapKeyIndex struct {
	present bool
	valid   bool
	keys    map[string]struct{}
}

type configMapImmutable struct {
	present bool
	valid   bool
	set     bool
	value   bool
}

type configMapAnalysis struct {
	valid   bool
	status  string
	summary map[string]interface{}
}

// UnmarshalJSON indexes ConfigMap keys without decoding or retaining their values.
func (index *configMapKeyIndex) UnmarshalJSON(data []byte) error {
	index.present = true
	index.valid = false
	index.keys = nil
	if !json.Valid(data) {
		return errKubeAPIInvalidResponse
	}

	data = bytes.TrimSpace(data)
	if bytes.Equal(data, []byte("null")) {
		index.valid = true
		return nil
	}
	if len(data) < 2 || data[0] != '{' {
		return nil
	}

	keys := make(map[string]struct{})
	valid := true
	position := skipJSONWhitespace(data, 1)
	if position < len(data) && data[position] == '}' {
		index.valid = position+1 == len(data)
		index.keys = keys
		return nil
	}

	for position < len(data) {
		keyStart := position
		keyEnd, ok := skipJSONString(data, keyStart)
		if !ok {
			return nil
		}
		var key string
		if err := json.Unmarshal(data[keyStart:keyEnd], &key); err != nil {
			return errKubeAPIInvalidResponse
		}
		if !validConfigMapKey(key) {
			valid = false
		}
		if _, duplicate := keys[key]; duplicate {
			valid = false
		} else if len(keys) < maxConfigMapEntries {
			keys[key] = struct{}{}
		} else {
			valid = false
		}

		position = skipJSONWhitespace(data, keyEnd)
		if position >= len(data) || data[position] != ':' {
			return nil
		}
		position = skipJSONWhitespace(data, position+1)
		valueEnd, valueIsString := skipJSONString(data, position)
		if !valueIsString {
			return nil
		}
		position = skipJSONWhitespace(data, valueEnd)
		if position >= len(data) {
			return nil
		}
		switch data[position] {
		case ',':
			position = skipJSONWhitespace(data, position+1)
		case '}':
			position++
			if skipJSONWhitespace(data, position) != len(data) {
				return nil
			}
			index.valid = valid
			index.keys = keys
			return nil
		default:
			return nil
		}
	}
	return nil
}

func (value *configMapImmutable) UnmarshalJSON(data []byte) error {
	value.present = true
	value.valid = false
	value.set = false
	value.value = false
	if !json.Valid(data) {
		return errKubeAPIInvalidResponse
	}
	switch string(bytes.TrimSpace(data)) {
	case "null":
		value.valid = true
	case "true":
		value.valid = true
		value.set = true
		value.value = true
	case "false":
		value.valid = true
		value.set = true
	}
	return nil
}

func analyzeConfigMap(configMap configMapResource) configMapAnalysis {
	valid := configMap.Data.isValid() && configMap.BinaryData.isValid() &&
		configMap.Data.count()+configMap.BinaryData.count() <= maxConfigMapEntries &&
		!configMap.Data.overlaps(configMap.BinaryData) && configMap.Immutable.isValid()
	if !valid {
		return configMapAnalysis{
			valid:  false,
			status: "warning",
			summary: map[string]interface{}{
				"keys":       "invalid",
				"dataKeys":   "invalid",
				"binaryKeys": "invalid",
				"immutable":  "invalid",
			},
		}
	}
	return configMapAnalysis{
		valid:  true,
		status: "healthy",
		summary: map[string]interface{}{
			"keys":       configMap.Data.count() + configMap.BinaryData.count(),
			"dataKeys":   configMap.Data.count(),
			"binaryKeys": configMap.BinaryData.count(),
			"immutable":  configMap.Immutable.summary(),
		},
	}
}

func (index configMapKeyIndex) isValid() bool {
	return !index.present || index.valid
}

func (index configMapKeyIndex) count() int {
	return len(index.keys)
}

func (index configMapKeyIndex) overlaps(other configMapKeyIndex) bool {
	for key := range index.keys {
		if _, exists := other.keys[key]; exists {
			return true
		}
	}
	return false
}

func (value configMapImmutable) isValid() bool {
	return !value.present || value.valid
}

func (value configMapImmutable) summary() interface{} {
	if !value.present || !value.set {
		return "unset"
	}
	return value.value
}

func validConfigMapKey(value string) bool {
	if value == "" || value == "." || len(value) > 253 || strings.HasPrefix(value, "..") {
		return false
	}
	for index := 0; index < len(value); index++ {
		character := value[index]
		if !isASCIIAlphanumeric(character) && character != '-' && character != '_' && character != '.' {
			return false
		}
	}
	return true
}

func skipJSONWhitespace(data []byte, position int) int {
	for position < len(data) {
		switch data[position] {
		case ' ', '\n', '\r', '\t':
			position++
		default:
			return position
		}
	}
	return position
}

func skipJSONString(data []byte, position int) (int, bool) {
	if position >= len(data) || data[position] != '"' {
		return position, false
	}
	for position++; position < len(data); position++ {
		switch data[position] {
		case '"':
			return position + 1, true
		case '\\':
			position++
			if position >= len(data) {
				return position, false
			}
			if data[position] == 'u' {
				if position+4 >= len(data) {
					return position, false
				}
				for offset := 1; offset <= 4; offset++ {
					if !isJSONHex(data[position+offset]) {
						return position, false
					}
				}
				position += 4
			} else if !strings.ContainsRune(`"\\/bfnrt`, rune(data[position])) {
				return position, false
			}
		default:
			if data[position] < 0x20 {
				return position, false
			}
		}
	}
	return position, false
}

func isJSONHex(value byte) bool {
	return value >= '0' && value <= '9' || value >= 'a' && value <= 'f' || value >= 'A' && value <= 'F'
}
