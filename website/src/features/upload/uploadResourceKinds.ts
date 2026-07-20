import type { ResourceKind } from '../../types/topology.ts';

export const supportedUploadKinds: ReadonlySet<ResourceKind> = new Set([
  'Cluster',
  'Namespace',
  'Node',
  'Deployment',
  'ReplicaSet',
  'StatefulSet',
  'DaemonSet',
  'Job',
  'CronJob',
  'HorizontalPodAutoscaler',
  'Pod',
  'ServiceAccount',
  'Service',
  'EndpointSlice',
  'Ingress',
  'Gateway',
  'HTTPRoute',
  'GRPCRoute',
  'TLSRoute',
  'TCPRoute',
  'NetworkPolicy',
  'ConfigMap',
  'Secret',
  'PersistentVolumeClaim',
  'PersistentVolume',
  'StorageClass',
  'CustomResourceDefinition',
]);

export function normalizeUploadResourceKind(kind: unknown): ResourceKind | undefined {
  return typeof kind === 'string' && supportedUploadKinds.has(kind as ResourceKind)
    ? (kind as ResourceKind)
    : undefined;
}
