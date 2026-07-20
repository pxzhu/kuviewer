package provider

import "strings"

const (
	maxStorageResourceEntries = 32
	maxStorageAccessModes     = 4
)

type storageResourceAnalysis struct {
	valid     bool
	specValid bool
	status    string
	summary   map[string]interface{}
}

func analyzePersistentVolumeClaim(pvc pvcResource) storageResourceAnalysis {
	specValid := validPVCSpec(pvc.Spec)
	statusValid := validPVCStatus(pvc.Status)
	valid := specValid && statusValid
	return storageResourceAnalysis{
		valid:     valid,
		specValid: specValid,
		status:    pvcStatusValue(pvc.Status.Phase, valid),
		summary:   pvcSummary(pvc, valid),
	}
}

func analyzePersistentVolume(pv pvResource) storageResourceAnalysis {
	specValid := validPVSpec(pv.Spec)
	statusValid := validPVPhase(pv.Status.Phase)
	valid := specValid && statusValid
	return storageResourceAnalysis{
		valid:     valid,
		specValid: specValid,
		status:    pvStatusValue(pv.Status.Phase, valid),
		summary:   pvSummary(pv, valid),
	}
}

func analyzeStorageClass(storageClass storageClassResource) storageResourceAnalysis {
	valid := validStorageClass(storageClass)
	status := "healthy"
	if !valid {
		status = "warning"
	}
	return storageResourceAnalysis{
		valid:     valid,
		specValid: valid,
		status:    status,
		summary:   storageClassSummary(storageClass, valid),
	}
}

func validPVCSpec(spec pvcSpec) bool {
	return validStorageResourceList(spec.Resources.Requests, false) &&
		validStorageAccessModes(spec.AccessModes, false) &&
		validStorageVolumeMode(spec.VolumeMode) &&
		(spec.VolumeName == "" || validKubernetesReferenceName(spec.VolumeName)) &&
		(spec.StorageClassName == "" || validKubernetesReferenceName(spec.StorageClassName))
}

func validPVCStatus(status pvcStat) bool {
	return validPVCPhase(status.Phase) && validStorageResourceList(status.Capacity, false) && validStorageAccessModes(status.AccessModes, false)
}

func validPVSpec(spec pvSpec) bool {
	return validStorageResourceList(spec.Capacity, true) &&
		validStorageAccessModes(spec.AccessModes, true) &&
		validStorageVolumeMode(spec.VolumeMode) &&
		validPVReclaimPolicy(spec.PersistentVolumeReclaimPolicy) &&
		(spec.StorageClassName == "" || validKubernetesReferenceName(spec.StorageClassName))
}

func validStorageClass(storageClass storageClassResource) bool {
	return validLabelKey(storageClass.Provisioner) &&
		validStorageClassReclaimPolicy(storageClass.ReclaimPolicy) &&
		validStorageBindingMode(storageClass.VolumeBindingMode)
}

func validStorageResourceList(resources map[string]string, storageRequired bool) bool {
	if len(resources) > maxStorageResourceEntries {
		return false
	}
	for key, value := range resources {
		if !validLabelKey(key) || !validKubernetesQuantity(value) {
			return false
		}
	}
	_, storageSet := resources["storage"]
	return !storageRequired || storageSet
}

func validStorageAccessModes(values []string, required bool) bool {
	if len(values) > maxStorageAccessModes || required && len(values) == 0 {
		return false
	}
	seen := map[string]bool{}
	for _, value := range values {
		if !validStorageAccessMode(value) || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}

func validStorageAccessMode(value string) bool {
	return value == "ReadWriteOnce" || value == "ReadOnlyMany" || value == "ReadWriteMany" || value == "ReadWriteOncePod"
}

func validStorageVolumeMode(value string) bool {
	return value == "" || value == "Filesystem" || value == "Block"
}

func validPVReclaimPolicy(value string) bool {
	return value == "" || value == "Retain" || value == "Recycle" || value == "Delete"
}

func validStorageClassReclaimPolicy(value string) bool {
	return value == "" || value == "Retain" || value == "Delete"
}

func validStorageBindingMode(value string) bool {
	return value == "" || value == "Immediate" || value == "WaitForFirstConsumer"
}

func validPVCPhase(value string) bool {
	return value == "" || value == "Pending" || value == "Bound" || value == "Lost"
}

func validPVPhase(value string) bool {
	return value == "" || value == "Pending" || value == "Available" || value == "Bound" || value == "Released" || value == "Failed"
}

func pvcStatusValue(phase string, valid bool) string {
	if !valid {
		return "warning"
	}
	switch phase {
	case "":
		return "unknown"
	case "Bound":
		return "healthy"
	case "Lost":
		return "error"
	default:
		return "warning"
	}
}

func pvStatusValue(phase string, valid bool) string {
	if !valid {
		return "warning"
	}
	switch phase {
	case "":
		return "unknown"
	case "Bound", "Available":
		return "healthy"
	case "Failed":
		return "error"
	default:
		return "warning"
	}
}

func pvcSummary(pvc pvcResource, valid bool) map[string]interface{} {
	if !valid {
		return invalidStorageSummary("phase", "requestedStorage", "capacityStorage", "accessModes", "statusAccessModes", "volumeMode", "volume", "storageClass", "requestResourceCount", "capacityResourceCount")
	}
	return map[string]interface{}{
		"phase":                 optionalStorageValue(pvc.Status.Phase, "unknown"),
		"requestedStorage":      storageQuantitySummary(pvc.Spec.Resources.Requests),
		"capacityStorage":       storageQuantitySummary(pvc.Status.Capacity),
		"accessModes":           storageAccessModesSummary(pvc.Spec.AccessModes),
		"statusAccessModes":     storageAccessModesSummary(pvc.Status.AccessModes),
		"volumeMode":            optionalStorageValue(pvc.Spec.VolumeMode, "Filesystem"),
		"volume":                optionalStorageValue(pvc.Spec.VolumeName, "unbound"),
		"storageClass":          optionalStorageValue(pvc.Spec.StorageClassName, "default"),
		"requestResourceCount":  len(pvc.Spec.Resources.Requests),
		"capacityResourceCount": len(pvc.Status.Capacity),
	}
}

func pvSummary(pv pvResource, valid bool) map[string]interface{} {
	if !valid {
		return invalidStorageSummary("phase", "storage", "accessModes", "volumeMode", "reclaimPolicy", "storageClass", "capacityResourceCount")
	}
	return map[string]interface{}{
		"phase":                 optionalStorageValue(pv.Status.Phase, "unknown"),
		"storage":               storageQuantitySummary(pv.Spec.Capacity),
		"accessModes":           storageAccessModesSummary(pv.Spec.AccessModes),
		"volumeMode":            optionalStorageValue(pv.Spec.VolumeMode, "Filesystem"),
		"reclaimPolicy":         optionalStorageValue(pv.Spec.PersistentVolumeReclaimPolicy, "Retain"),
		"storageClass":          optionalStorageValue(pv.Spec.StorageClassName, "none"),
		"capacityResourceCount": len(pv.Spec.Capacity),
	}
}

func storageClassSummary(storageClass storageClassResource, valid bool) map[string]interface{} {
	if !valid {
		return invalidStorageSummary("provisioner", "reclaimPolicy", "volumeBindingMode", "allowVolumeExpansion")
	}
	return map[string]interface{}{
		"provisioner":          storageClass.Provisioner,
		"reclaimPolicy":        optionalStorageValue(storageClass.ReclaimPolicy, "Delete"),
		"volumeBindingMode":    optionalStorageValue(storageClass.VolumeBindingMode, "Immediate"),
		"allowVolumeExpansion": optionalStorageBoolean(storageClass.AllowVolumeExpansion),
	}
}

func storageQuantitySummary(resources map[string]string) string {
	if value, found := resources["storage"]; found {
		return value
	}
	return "unknown"
}

func storageAccessModesSummary(values []string) string {
	if len(values) == 0 {
		return "unknown"
	}
	copyValues := append([]string(nil), values...)
	return strings.Join(uniqueStrings(copyValues), ",")
}

func optionalStorageValue(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func optionalStorageBoolean(value *bool) interface{} {
	if value == nil {
		return "unknown"
	}
	return *value
}

func invalidStorageSummary(keys ...string) map[string]interface{} {
	result := make(map[string]interface{}, len(keys))
	for _, key := range keys {
		result[key] = "invalid"
	}
	return result
}
