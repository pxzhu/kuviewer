package topology

type Snapshot struct {
	Clusters []ClusterSummary `json:"clusters"`
	Nodes    []Node           `json:"nodes"`
	Edges    []Edge           `json:"edges"`
}

type ClusterSummary struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Provider   string `json:"provider"`
	Version    string `json:"version"`
	NodeReady  int    `json:"nodeReady"`
	NodeTotal  int    `json:"nodeTotal"`
	PodRunning int    `json:"podRunning"`
	PodWarning int    `json:"podWarning"`
	Namespaces int    `json:"namespaces"`
}

type Node struct {
	ID        string                 `json:"id"`
	ClusterID string                 `json:"clusterId"`
	Kind      string                 `json:"kind"`
	Namespace string                 `json:"namespace,omitempty"`
	Name      string                 `json:"name"`
	Status    string                 `json:"status"`
	Labels    map[string]string      `json:"labels"`
	Summary   map[string]interface{} `json:"summary"`
	X         int                    `json:"x"`
	Y         int                    `json:"y"`
}

type Edge struct {
	ID          string `json:"id"`
	ClusterID   string `json:"clusterId"`
	Source      string `json:"source"`
	Target      string `json:"target"`
	Type        string `json:"type"`
	Confidence  string `json:"confidence"`
	SourceField string `json:"sourceField"`
}
