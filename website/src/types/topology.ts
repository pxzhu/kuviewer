export type ResourceKind =
  | 'Cluster'
  | 'Namespace'
  | 'Node'
  | 'Deployment'
  | 'ReplicaSet'
  | 'StatefulSet'
  | 'DaemonSet'
  | 'Job'
  | 'CronJob'
  | 'HorizontalPodAutoscaler'
  | 'Pod'
  | 'ServiceAccount'
  | 'Service'
  | 'EndpointSlice'
  | 'Ingress'
  | 'Gateway'
  | 'HTTPRoute'
  | 'NetworkPolicy'
  | 'ConfigMap'
  | 'Secret'
  | 'PersistentVolumeClaim'
  | 'PersistentVolume'
  | 'StorageClass';

export type ResourceStatus = 'healthy' | 'warning' | 'error' | 'unknown';

export type EdgeType =
  | 'owns'
  | 'selects'
  | 'service-endpoint'
  | 'routes-to'
  | 'mounts'
  | 'env-from'
  | 'scheduled-on'
  | 'binds-storage'
  | 'uses-service-account'
  | 'targets-scale'
  | 'applies-to'
  | 'attaches-to';

export interface TopologyNode {
  id: string;
  clusterId: string;
  kind: ResourceKind;
  namespace?: string;
  name: string;
  status: ResourceStatus;
  labels: Record<string, string>;
  summary: Record<string, string | number | boolean>;
  x: number;
  y: number;
}

export interface TopologyEdge {
  id: string;
  clusterId: string;
  source: string;
  target: string;
  type: EdgeType;
  confidence: 'observed' | 'inferred';
  sourceField: string;
}

export interface ClusterSummary {
  id: string;
  name: string;
  provider: string;
  version: string;
  nodeReady: number;
  nodeTotal: number;
  podRunning: number;
  podWarning: number;
  namespaces: number;
}

export interface TopologySnapshot {
  clusters: ClusterSummary[];
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}
