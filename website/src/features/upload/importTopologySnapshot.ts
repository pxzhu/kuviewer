import type {
  ClusterSummary,
  EdgeType,
  ResourceKind,
  ResourceStatus,
  SummaryValue,
  TopologyEdge,
  TopologyNode,
  TopologySnapshot,
} from '../../types/topology.ts';
import { safeAnnotations, sensitiveField } from '../../utils/safeMetadata.ts';

const importedResourceKinds = new Set<ResourceKind>([
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
  'CustomResource',
]);

const maxImportedClusters = 100;
const maxImportedNodes = 50_000;
const maxImportedEdges = 100_000;
const importedEdgeTypes = new Set<EdgeType>([
  'owns',
  'selects',
  'service-endpoint',
  'routes-to',
  'mounts',
  'env-from',
  'scheduled-on',
  'binds-storage',
  'uses-service-account',
  'targets-scale',
  'applies-to',
  'attaches-to',
  'allows-ingress',
  'allows-egress',
  'references',
]);
const importedResourceStatuses = new Set<ResourceStatus>(['healthy', 'warning', 'error', 'unknown']);

export function importTopologySnapshot(value: unknown): TopologySnapshot {
  if (
    !isSnapshot(value) ||
    value.clusters.length > maxImportedClusters ||
    value.nodes.length > maxImportedNodes ||
    value.edges.length > maxImportedEdges
  ) {
    throw new Error('invalid_topology_json');
  }
  const clusters = value.clusters.map(sanitizeImportedCluster);
  const nodes = value.nodes.map(sanitizeImportedNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = value.edges.map((edge) => sanitizeImportedEdge(edge, nodeIds));
  if (new Set(clusters.map((cluster) => cluster.id)).size !== clusters.length || nodeIds.size !== nodes.length || new Set(edges.map((edge) => edge.id)).size !== edges.length) {
    throw new Error('invalid_topology_json');
  }
  return { clusters, nodes, edges };
}

function sanitizeImportedCluster(value: unknown): ClusterSummary {
  if (!isRecord(value)) {
    throw new Error('invalid_topology_json');
  }
  return {
    id: requiredImportedString(value.id, 160),
    name: requiredImportedString(value.name, 160),
    provider: importedString(value.provider, 160),
    version: importedString(value.version, 80),
    nodeReady: importedCount(value.nodeReady),
    nodeTotal: importedCount(value.nodeTotal),
    podRunning: importedCount(value.podRunning),
    podWarning: importedCount(value.podWarning),
    namespaces: importedCount(value.namespaces),
  };
}

function sanitizeImportedNode(value: unknown): TopologyNode {
  if (!isRecord(value) || !isResourceKind(value.kind) || !isResourceStatus(value.status)) {
    throw new Error('invalid_topology_json');
  }
  const labels = importedStringRecord(value.labels, 200, 160, 512);
  const annotations = safeAnnotations(importedStringRecord(value.annotations, 200, 256, 2_000));
  const kind = value.kind;
  return {
    id: requiredImportedString(value.id, 500),
    clusterId: requiredImportedString(value.clusterId, 160),
    kind,
    namespace: optionalImportedString(value.namespace, 160),
    name: requiredImportedString(value.name, 253),
    status: value.status,
    labels,
    annotations: Object.keys(annotations).length > 0 ? annotations : undefined,
    uid: optionalImportedString(value.uid, 160),
    age: optionalImportedString(value.age, 80),
    owners: importedStringArray(value.owners, 100, 320),
    summary: sanitizeImportedSummary(value.summary, kind),
    x: importedCoordinate(value.x),
    y: importedCoordinate(value.y),
  };
}

function sanitizeImportedEdge(value: unknown, nodeIds: Set<string>): TopologyEdge {
  if (!isRecord(value) || !isEdgeType(value.type) || (value.confidence !== 'observed' && value.confidence !== 'inferred')) {
    throw new Error('invalid_topology_json');
  }
  const source = requiredImportedString(value.source, 500);
  const target = requiredImportedString(value.target, 500);
  if (!nodeIds.has(source) || !nodeIds.has(target)) {
    throw new Error('invalid_topology_json');
  }
  return {
    id: requiredImportedString(value.id, 1_200),
    clusterId: requiredImportedString(value.clusterId, 160),
    source,
    target,
    type: value.type,
    confidence: value.confidence,
    sourceField: importedString(value.sourceField, 500),
  };
}

function sanitizeImportedSummary(value: unknown, kind: ResourceKind): Record<string, SummaryValue> {
  if (!isRecord(value)) {
    return kind === 'Secret' ? { values: 'hidden' } : {};
  }
  if (kind === 'Secret') {
    const summary: Record<string, SummaryValue> = { values: 'hidden' };
    if (typeof value.type === 'string') {
      summary.type = importedString(value.type, 160);
    }
    if (typeof value.keys === 'number') {
      summary.keys = importedCount(value.keys);
    }
    if (typeof value.referenced === 'boolean') {
      summary.referenced = value.referenced;
    }
    return summary;
  }

  const entries: Array<[string, SummaryValue]> = [];
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 100)) {
    const key = importedString(rawKey, 160);
    if (!key || sensitiveField(key) || key.toLowerCase() === 'data' || key.toLowerCase() === 'stringdata') {
      continue;
    }
    const summaryValue = importedSummaryValue(rawValue);
    if (summaryValue !== undefined) {
      entries.push([key, typeof summaryValue === 'string' && sensitiveField(summaryValue) ? 'redacted' : summaryValue]);
    }
  }
  return Object.fromEntries(entries);
}

function importedSummaryValue(value: unknown): SummaryValue | undefined {
  if (typeof value === 'string') {
    return importedString(value, 2_000);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (!Array.isArray(value) || value.length > 100) {
    return undefined;
  }
  if (value.every((item) => typeof item === 'string')) {
    return value.map((item) => importedString(item, 500));
  }
  if (value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return value;
  }
  if (value.every((item) => typeof item === 'boolean')) {
    return value;
  }
  return undefined;
}

function importedStringRecord(value: unknown, maxEntries: number, maxKeyLength: number, maxValueLength: number) {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, maxEntries)
      .flatMap(([key, entryValue]) => {
        const safeKey = importedString(key, maxKeyLength);
        return safeKey && typeof entryValue === 'string' ? [[safeKey, importedString(entryValue, maxValueLength)]] : [];
      }),
  );
}

function importedStringArray(value: unknown, maxEntries: number, maxLength: number) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.slice(0, maxEntries).flatMap((entry) => typeof entry === 'string' ? [importedString(entry, maxLength)] : []);
}

function requiredImportedString(value: unknown, maxLength: number) {
  const result = importedString(value, maxLength);
  if (!result) {
    throw new Error('invalid_topology_json');
  }
  return result;
}

function optionalImportedString(value: unknown, maxLength: number) {
  const result = importedString(value, maxLength);
  return result || undefined;
}

function importedString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function importedCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function importedCoordinate(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(-100_000, Math.min(100_000, value)) : 0;
}

function isResourceKind(value: unknown): value is ResourceKind {
  return typeof value === 'string' && importedResourceKinds.has(value as ResourceKind);
}

function isResourceStatus(value: unknown): value is ResourceStatus {
  return typeof value === 'string' && importedResourceStatuses.has(value as ResourceStatus);
}

function isEdgeType(value: unknown): value is EdgeType {
  return typeof value === 'string' && importedEdgeTypes.has(value as EdgeType);
}

function isSnapshot(value: unknown): value is TopologySnapshot {
  return isRecord(value) && Array.isArray(value.clusters) && Array.isArray(value.nodes) && Array.isArray(value.edges);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
