package provider

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestWorkloadTemplateAnalysisKeepsBoundedImagesAndReferencesWithoutRawValues(t *testing.T) {
	deployment := deploymentResource{}
	const raw = `{
		"metadata":{"name":"api","namespace":"app"},
		"spec":{"template":{"spec":{
			"serviceAccountName":"runtime",
			"imagePullSecrets":[{"name":"registry"}],
			"volumes":[{"persistentVolumeClaim":{"claimName":"cache"}}],
			"initContainers":[{"name":"migrate","image":"registry.example.com/team/migrate:v2"}],
			"containers":[{
				"name":"api","image":"registry.example.com/team/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				"envFrom":[{"configMapRef":{"name":"runtime-config"}}],
				"env":[{"name":"RAW_VALUE","value":"must-not-survive"},{"name":"SAFE_REF","valueFrom":{"secretKeyRef":{"name":"runtime-secret","key":"password"}}},{"name":"POD_NAME","valueFrom":{"fieldRef":{"fieldPath":"metadata.name"}}}]
			}]
		}}}
	}`
	if err := json.Unmarshal([]byte(raw), &deployment); err != nil {
		t.Fatalf("decode Deployment: %v", err)
	}

	analysis := analyzeWorkloadTemplate(deployment.Spec.Template.Spec, "Deployment.spec.template.spec")
	if !analysis.valid || analysis.containers != 1 || analysis.initContainers != 1 || analysis.serviceAccount != "runtime" {
		t.Fatalf("analysis = %+v", analysis)
	}
	if len(analysis.images) != 2 || analysis.images[0] != "registry.example.com/team/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("images = %#v", analysis.images)
	}
	for _, expected := range []string{"cache", "registry", "runtime-config", "runtime-secret"} {
		found := false
		for _, reference := range analysis.references {
			if reference.name == expected {
				found = true
			}
		}
		if !found {
			t.Fatalf("missing reference %q in %#v", expected, analysis.references)
		}
	}

	encoded, err := json.Marshal(deployment)
	if err != nil {
		t.Fatalf("encode Deployment: %v", err)
	}
	if strings.Contains(string(encoded), "must-not-survive") || strings.Contains(string(encoded), `"key":"password"`) || strings.Contains(string(encoded), "metadata.name") {
		t.Fatalf("workload schema retained raw env data: %s", encoded)
	}
}

func TestWorkloadTemplateAnalysisRejectsMalformedInputFailClosed(t *testing.T) {
	valid := podSpec{Containers: []container{{Name: "api", Image: "registry.example.com/team/api:v1"}}}
	if !analyzeWorkloadTemplate(valid, "Deployment.spec.template.spec").valid {
		t.Fatal("valid workload template was rejected")
	}
	if !validWorkloadImage("secret:v1") || validWorkloadImage("image:v1?token=fixture") || validWorkloadImage("https://registry.example.com/image:v1") {
		t.Fatal("workload image syntax boundary mismatch")
	}

	tests := []podSpec{
		{},
		{Containers: []container{{Name: "api", Image: "https://registry.example.com/api:v1"}}},
		{Containers: []container{{Name: "api", Image: "registry.example.com/api:v1?token=fixture"}}},
		{Containers: []container{{Name: "api", Image: "image:v1"}, {Name: "api", Image: "image:v2"}}},
		{Containers: []container{{Name: "api", Image: "image:v1", EnvFrom: []envFrom{{SecretRef: &localObjectRef{Name: "bad name"}}}}}},
		{Containers: []container{{Name: "api", Image: "image:v1", EnvFrom: []envFrom{{}}}}},
		{Containers: []container{{Name: "api", Image: "image:v1"}}, ImagePullSecret: []localObjectRef{{Name: "bad name"}}},
	}
	for index, spec := range tests {
		if analysis := analyzeWorkloadTemplate(spec, "Deployment.spec.template.spec"); analysis.valid || len(analysis.references) != 0 || len(analysis.images) != 0 {
			t.Fatalf("case %d did not fail closed: %+v", index, analysis)
		}
	}

	if validWorkloadSchedule("token=fixture") || validWorkloadSchedule("line\nbreak") || !validWorkloadSchedule("*/5 * * * *") {
		t.Fatal("workload schedule boundary mismatch")
	}
}

func TestWorkloadResourceSchemasDecodeControllerTemplatePaths(t *testing.T) {
	cronJob := cronJobResource{}
	if err := json.Unmarshal([]byte(`{"spec":{"schedule":"0 * * * *","jobTemplate":{"spec":{"template":{"spec":{"containers":[{"name":"worker","image":"worker:v1"}]}}}}},"status":{"active":[]}}`), &cronJob); err != nil {
		t.Fatalf("decode CronJob: %v", err)
	}
	cronAnalysis := analyzeWorkloadTemplate(cronJob.Spec.JobTemplate.Spec.Template.Spec, "CronJob.spec.jobTemplate.spec.template.spec")
	if !cronAnalysis.valid || len(cronAnalysis.images) != 1 || !validCronJobWorkload(cronJob) {
		t.Fatalf("CronJob analysis = %+v", cronAnalysis)
	}

	job := jobResource{}
	if err := json.Unmarshal([]byte(`{"spec":{"completions":1,"template":{"spec":{"containers":[{"name":"worker","image":"worker:v1"}]}}},"status":{"succeeded":1}}`), &job); err != nil {
		t.Fatalf("decode Job: %v", err)
	}
	jobAnalysis := analyzeWorkloadTemplate(job.Spec.Template.Spec, "Job.spec.template.spec")
	if !jobAnalysis.valid || len(jobAnalysis.images) != 1 || !validJobWorkload(job) {
		t.Fatalf("Job analysis = %+v", jobAnalysis)
	}
}

func TestBuildKubernetesSnapshotAddsOnlyValidWorkloadTemplateReferences(t *testing.T) {
	resources := newKubernetesSnapshotResources()
	valid := deploymentResource{Metadata: metadata{Name: "api", Namespace: "app"}}
	valid.Spec.Template.Spec = podSpec{
		ServiceAccountName: "runtime",
		ImagePullSecret:    []localObjectRef{{Name: "registry"}},
		Containers:         []container{{Name: "api", Image: "registry.example.com/team/api:v1", EnvFrom: []envFrom{{ConfigMapRef: &localObjectRef{Name: "runtime-config"}}}}},
	}
	valid.Status = replicaStatus{Replicas: 1, ReadyReplicas: 1, AvailableReplicas: 1}
	invalid := deploymentResource{Metadata: metadata{Name: "invalid", Namespace: "app"}}
	invalid.Spec.Template.Spec = podSpec{
		Containers: []container{{Name: "api", Image: "image:v1?credential=fixture", EnvFrom: []envFrom{{SecretRef: &localObjectRef{Name: "phantom-secret"}}}}},
	}
	invalid.Status = replicaStatus{Replicas: 1, ReadyReplicas: 1, AvailableReplicas: 1}
	resources.deployments.Items = []deploymentResource{valid, invalid}

	snapshot := buildKubernetesSnapshot("cluster-a", "Cluster A", resources)
	node := snapshotNode(t, snapshot, "Deployment", "app", "api")
	if node.Status != "healthy" || node.Summary["imageCount"] != 1 || node.Summary["containers"] != 1 {
		t.Fatalf("valid workload node = %+v", node)
	}
	invalidNode := snapshotNode(t, snapshot, "Deployment", "app", "invalid")
	if invalidNode.Status != "warning" || invalidNode.Summary["imageCount"] != "invalid" {
		t.Fatalf("invalid workload node = %+v", invalidNode)
	}
	for _, target := range []struct {
		kind     string
		name     string
		edgeType string
	}{
		{kind: "ServiceAccount", name: "runtime", edgeType: "uses-service-account"},
		{kind: "Secret", name: "registry", edgeType: "env-from"},
		{kind: "ConfigMap", name: "runtime-config", edgeType: "env-from"},
	} {
		if !snapshotHasNode(snapshot, target.kind, "app", target.name) {
			t.Fatalf("missing workload reference node %s/%s", target.kind, target.name)
		}
		if !snapshotHasEdge(snapshot, target.edgeType, "cluster-a:app:Deployment:api", "cluster-a:app:"+target.kind+":"+target.name) {
			t.Fatalf("missing workload reference edge %s to %s/%s", target.edgeType, target.kind, target.name)
		}
	}
	if snapshotHasNode(snapshot, "Secret", "app", "phantom-secret") {
		t.Fatal("invalid workload created a phantom Secret")
	}
	if diagnostic := findSnapshotDiagnostic(snapshot.Diagnostics, "snapshot/deployments"); diagnostic.Reason != "invalid_item" || diagnostic.Count != 1 {
		t.Fatalf("Deployment diagnostic = %+v", diagnostic)
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	if strings.Contains(string(encoded), "credential=fixture") {
		t.Fatalf("snapshot retained malformed image: %s", encoded)
	}
}
