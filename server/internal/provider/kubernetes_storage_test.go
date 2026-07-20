package provider

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestStorageAnalysisSummarizesSafeBoundedFields(t *testing.T) {
	pvc := validPVCFixture()
	pvcAnalysis := analyzePersistentVolumeClaim(pvc)
	if !pvcAnalysis.valid || pvcAnalysis.status != "healthy" || pvcAnalysis.summary["requestedStorage"] != "10Gi" || pvcAnalysis.summary["capacityStorage"] != "10Gi" {
		t.Fatalf("PVC analysis = %+v", pvcAnalysis)
	}
	if pvcAnalysis.summary["accessModes"] != "ReadWriteOnce" || pvcAnalysis.summary["volumeMode"] != "Filesystem" || pvcAnalysis.summary["volume"] != "orders-pv" {
		t.Fatalf("PVC summary = %+v", pvcAnalysis.summary)
	}

	pv := validPVFixture()
	pvAnalysis := analyzePersistentVolume(pv)
	if !pvAnalysis.valid || pvAnalysis.status != "healthy" || pvAnalysis.summary["storage"] != "10Gi" || pvAnalysis.summary["reclaimPolicy"] != "Delete" {
		t.Fatalf("PV analysis = %+v", pvAnalysis)
	}

	storageClass := validStorageClassFixture()
	storageClassAnalysis := analyzeStorageClass(storageClass)
	if !storageClassAnalysis.valid || storageClassAnalysis.status != "healthy" || storageClassAnalysis.summary["provisioner"] != "example.csi.io" ||
		storageClassAnalysis.summary["volumeBindingMode"] != "WaitForFirstConsumer" || storageClassAnalysis.summary["allowVolumeExpansion"] != true {
		t.Fatalf("StorageClass analysis = %+v", storageClassAnalysis)
	}
}

func TestStorageSchemaDoesNotRetainVolumeSourceOrProvisionerParameters(t *testing.T) {
	var pv pvResource
	const rawPV = `{
		"metadata":{"name":"orders-pv"},
		"spec":{"capacity":{"storage":"10Gi"},"accessModes":["ReadWriteOnce"],"persistentVolumeReclaimPolicy":"Delete","storageClassName":"local-fast","volumeMode":"Filesystem","claimRef":{"name":"must-not-survive"},"csi":{"driver":"example.csi.io","volumeHandle":"must-not-survive","nodeStageSecretRef":{"name":"must-not-survive"}}},
		"status":{"phase":"Bound","message":"must-not-survive"}
	}`
	if err := json.Unmarshal([]byte(rawPV), &pv); err != nil {
		t.Fatalf("decode PV: %v", err)
	}
	var storageClass storageClassResource
	const rawStorageClass = `{"metadata":{"name":"local-fast"},"provisioner":"example.csi.io","parameters":{"secretName":"must-not-survive"},"mountOptions":["must-not-survive"]}`
	if err := json.Unmarshal([]byte(rawStorageClass), &storageClass); err != nil {
		t.Fatalf("decode StorageClass: %v", err)
	}
	encoded, err := json.Marshal([]interface{}{pv, storageClass})
	if err != nil {
		t.Fatalf("marshal storage resources: %v", err)
	}
	for _, forbidden := range []string{"must-not-survive", "claimRef", `"csi"`, "volumeHandle", "SecretRef", "parameters", "mountOptions", "message"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("storage schema retained %q: %s", forbidden, encoded)
		}
	}
}

func TestStorageAnalysisRejectsMalformedFieldsFailClosed(t *testing.T) {
	pvc := validPVCFixture()
	pvc.Spec.Resources.Requests["storage"] = "10Gi?token=fixture"
	pvcAnalysis := analyzePersistentVolumeClaim(pvc)
	assertInvalidStorageAnalysis(t, pvcAnalysis, "requestedStorage")

	pv := validPVFixture()
	pv.Spec.AccessModes = []string{"ReadWriteOnce", "ReadWriteOnce"}
	pvAnalysis := analyzePersistentVolume(pv)
	assertInvalidStorageAnalysis(t, pvAnalysis, "accessModes")

	storageClass := validStorageClassFixture()
	storageClass.Provisioner = "example.csi.io?credential=fixture"
	storageClassAnalysis := analyzeStorageClass(storageClass)
	assertInvalidStorageAnalysis(t, storageClassAnalysis, "provisioner")

	pv = validPVFixture()
	pv.Status.Phase = "token=fixture"
	assertInvalidStorageAnalysis(t, analyzePersistentVolume(pv), "phase")

	pvc = validPVCFixture()
	pvc.Spec.Resources.Requests = oversizedStorageResourceMap()
	assertInvalidStorageAnalysis(t, analyzePersistentVolumeClaim(pvc), "requestResourceCount")

	pv = validPVFixture()
	pv.Spec.AccessModes = []string{"ReadWriteOnce", "ReadOnlyMany", "ReadWriteMany", "ReadWriteOncePod", "ReadWriteOnce"}
	assertInvalidStorageAnalysis(t, analyzePersistentVolume(pv), "accessModes")

	storageClass = validStorageClassFixture()
	storageClass.VolumeBindingMode = "token=fixture"
	assertInvalidStorageAnalysis(t, analyzeStorageClass(storageClass), "volumeBindingMode")
}

func TestBuildKubernetesSnapshotAddsStorageDiagnosticsAndSuppressesInvalidEdges(t *testing.T) {
	resources := newKubernetesSnapshotResources()
	resources.storageClasses.Items = []storageClassResource{validStorageClassFixture()}
	resources.pvs.Items = []pvResource{validPVFixture()}
	validPVC := validPVCFixture()
	invalidPVC := validPVCFixture()
	invalidPVC.Metadata.Name = "invalid-claim"
	invalidPVC.Spec.VolumeName = "orders-pv?token=fixture"
	resources.pvcs.Items = []pvcResource{validPVC, invalidPVC}

	snapshot := buildKubernetesSnapshot("cluster-a", "Cluster A", resources)
	validNode := snapshotNode(t, snapshot, "PersistentVolumeClaim", "checkout", "orders-data")
	if validNode.Status != "healthy" || validNode.Summary["requestedStorage"] != "10Gi" {
		t.Fatalf("valid PVC node = %+v", validNode)
	}
	invalidNode := snapshotNode(t, snapshot, "PersistentVolumeClaim", "checkout", "invalid-claim")
	if invalidNode.Status != "warning" || invalidNode.Summary["volume"] != "invalid" {
		t.Fatalf("invalid PVC node = %+v", invalidNode)
	}
	if diagnostic := findSnapshotDiagnostic(snapshot.Diagnostics, "snapshot/pvcs"); diagnostic.Reason != "invalid_item" || diagnostic.Count != 1 {
		t.Fatalf("PVC diagnostic = %+v", diagnostic)
	}
	for _, edge := range snapshot.Edges {
		if strings.Contains(edge.Source, "invalid-claim") {
			t.Fatalf("invalid PVC created edge: %+v", edge)
		}
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	if strings.Contains(string(encoded), "fixture") {
		t.Fatalf("snapshot retained malformed storage value: %s", encoded)
	}
}

func validPVCFixture() pvcResource {
	pvc := pvcResource{
		Metadata: metadata{Name: "orders-data", Namespace: "checkout"},
		Spec: pvcSpec{
			AccessModes:      []string{"ReadWriteOnce"},
			VolumeName:       "orders-pv",
			StorageClassName: "local-fast",
			VolumeMode:       "Filesystem",
		},
		Status: pvcStat{Phase: "Bound", AccessModes: []string{"ReadWriteOnce"}, Capacity: map[string]string{"storage": "10Gi"}},
	}
	pvc.Spec.Resources.Requests = map[string]string{"storage": "10Gi"}
	return pvc
}

func validPVFixture() pvResource {
	return pvResource{
		Metadata: metadata{Name: "orders-pv"},
		Spec: pvSpec{
			Capacity:                      map[string]string{"storage": "10Gi"},
			AccessModes:                   []string{"ReadWriteOnce"},
			PersistentVolumeReclaimPolicy: "Delete",
			StorageClassName:              "local-fast",
			VolumeMode:                    "Filesystem",
		},
		Status: pvStat{Phase: "Bound"},
	}
}

func validStorageClassFixture() storageClassResource {
	expansion := true
	return storageClassResource{
		Metadata:             metadata{Name: "local-fast"},
		Provisioner:          "example.csi.io",
		ReclaimPolicy:        "Delete",
		VolumeBindingMode:    "WaitForFirstConsumer",
		AllowVolumeExpansion: &expansion,
	}
}

func assertInvalidStorageAnalysis(t *testing.T, analysis storageResourceAnalysis, summaryKey string) {
	t.Helper()
	if analysis.valid || analysis.status != "warning" || analysis.summary[summaryKey] != "invalid" {
		t.Fatalf("analysis did not fail closed: %+v", analysis)
	}
	encoded, err := json.Marshal(analysis.summary)
	if err != nil {
		t.Fatalf("marshal invalid summary: %v", err)
	}
	if strings.Contains(string(encoded), "fixture") {
		t.Fatalf("invalid summary leaked malformed value: %s", encoded)
	}
}

func oversizedStorageResourceMap() map[string]string {
	result := map[string]string{"storage": "10Gi"}
	for index := 0; index < maxStorageResourceEntries; index++ {
		result[fmt.Sprintf("example.com/resource-%02d", index)] = "1"
	}
	return result
}
