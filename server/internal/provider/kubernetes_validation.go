package provider

import "strings"

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
