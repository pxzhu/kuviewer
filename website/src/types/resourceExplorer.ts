import type { ResourceKind, ResourceStatus } from './topology';

export interface ResourceExplorerList {
  items: ResourceExplorerItem[];
}

export interface ResourceExplorerItem {
  id: string;
  clusterId: string;
  kind: ResourceKind;
  namespace?: string;
  name: string;
  status: ResourceStatus;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  summary: Record<string, string | number | boolean>;
  preview: Record<string, unknown>;
  related: RelatedResource[];
}

export interface RelatedResource {
  nodeId: string;
  kind: ResourceKind;
  namespace?: string;
  name: string;
  edgeType: string;
  direction: 'incoming' | 'outgoing';
  sourceField: string;
}

export interface ResourceEvents {
  items: ResourceEvent[];
}

export interface ResourceEvent {
  type: string;
  reason: string;
  message: string;
  source: string;
  timestamp: string;
}
