package provider

import "strings"

func validLabelKey(value string) bool {
	if value == "" || len(value) > 317 || strings.Count(value, "/") > 1 {
		return false
	}
	parts := strings.SplitN(value, "/", 2)
	name := parts[len(parts)-1]
	if !validQualifiedNamePart(name, false) {
		return false
	}
	return len(parts) == 1 || validDNSSubdomain(parts[0])
}

func validLabelValue(value string) bool {
	return validQualifiedNamePart(value, true)
}

func validQualifiedNamePart(value string, allowEmpty bool) bool {
	if value == "" {
		return allowEmpty
	}
	if len(value) > 63 || !isASCIIAlphanumeric(value[0]) || !isASCIIAlphanumeric(value[len(value)-1]) {
		return false
	}
	for index := 1; index < len(value)-1; index++ {
		character := value[index]
		if !isASCIIAlphanumeric(character) && character != '-' && character != '_' && character != '.' {
			return false
		}
	}
	return true
}

func validDNSSubdomain(value string) bool {
	if value == "" || len(value) > 253 {
		return false
	}
	for _, part := range strings.Split(value, ".") {
		if part == "" || len(part) > 63 || !isASCIILowerAlphanumeric(part[0]) || !isASCIILowerAlphanumeric(part[len(part)-1]) {
			return false
		}
		for index := 1; index < len(part)-1; index++ {
			if !isASCIILowerAlphanumeric(part[index]) && part[index] != '-' {
				return false
			}
		}
	}
	return true
}

func isASCIIAlphanumeric(value byte) bool {
	return isASCIIAlpha(value) || value >= '0' && value <= '9'
}

func isASCIILowerAlphanumeric(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= '0' && value <= '9'
}

func isASCIIAlpha(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z'
}
