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
	ID          string                 `json:"id"`
	ClusterID   string                 `json:"clusterId"`
	Kind        string                 `json:"kind"`
	Namespace   string                 `json:"namespace,omitempty"`
	Name        string                 `json:"name"`
	Status      string                 `json:"status"`
	Labels      map[string]string      `json:"labels"`
	Annotations map[string]string      `json:"annotations,omitempty"`
	Summary     map[string]interface{} `json:"summary"`
	UID         string                 `json:"uid,omitempty"`
	Age         string                 `json:"age,omitempty"`
	Owners      []string               `json:"owners,omitempty"`
	X           int                    `json:"x"`
	Y           int                    `json:"y"`
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

type ResourceList struct {
	Items []Resource `json:"items"`
}

type Resource struct {
	ID          string                 `json:"id"`
	ClusterID   string                 `json:"clusterId"`
	Kind        string                 `json:"kind"`
	Namespace   string                 `json:"namespace,omitempty"`
	Name        string                 `json:"name"`
	Status      string                 `json:"status"`
	Labels      map[string]string      `json:"labels"`
	Annotations map[string]string      `json:"annotations"`
	Summary     map[string]interface{} `json:"summary"`
	Preview     map[string]interface{} `json:"preview"`
	Related     []RelatedResource      `json:"related"`
}

type RelatedResource struct {
	NodeID      string `json:"nodeId"`
	Kind        string `json:"kind"`
	Namespace   string `json:"namespace,omitempty"`
	Name        string `json:"name"`
	EdgeType    string `json:"edgeType"`
	Direction   string `json:"direction"`
	SourceField string `json:"sourceField"`
}

type ResourceEvents struct {
	Items   []ResourceEvent `json:"items"`
	Warning string          `json:"warning,omitempty"`
}

type ResourceEvent struct {
	Type      string `json:"type"`
	Reason    string `json:"reason"`
	Message   string `json:"message"`
	Source    string `json:"source"`
	Timestamp string `json:"timestamp"`
}

type ResourceLogs struct {
	Lines     []string `json:"lines"`
	Warning   string   `json:"warning,omitempty"`
	Container string   `json:"container,omitempty"`
	TailLines int      `json:"tailLines"`
}
