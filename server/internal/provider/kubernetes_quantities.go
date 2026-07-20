package provider

import (
	"regexp"
	"strings"
)

const maxKubernetesQuantityBytes = 64

var kubernetesQuantityPattern = regexp.MustCompile(`^[0-9]+(?:\.[0-9]+)?(?:n|u|m|k|K|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei|[eE][+-]?[0-9]+)?$`)

func validKubernetesQuantity(value string) bool {
	return value != "" && len(value) <= maxKubernetesQuantityBytes && strings.TrimSpace(value) == value && kubernetesQuantityPattern.MatchString(value)
}
