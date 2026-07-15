import type { ClusterSummary, SummaryValue, TopologyEdge, TopologyNode, TopologySnapshot } from '../../types/topology';

export type SnapshotChangeType = 'added' | 'removed' | 'changed';

export interface SnapshotBaseline {
  snapshot: TopologySnapshot;
  capturedAt: number;
  label: string;
}

export interface SnapshotNodeChange {
  id: string;
  type: SnapshotChangeType;
  clusterId: string;
  kind: string;
  namespace: string;
  name: string;
  beforeStatus?: string;
  afterStatus?: string;
  changedFields: string[];
}

export interface SnapshotClusterChange {
  id: string;
  type: SnapshotChangeType;
  name: string;
  before?: ClusterSummary;
  after?: ClusterSummary;
  changedFields: string[];
}

export interface SnapshotResourceIdentity {
  id: string;
  kind: string;
  namespace: string;
  name: string;
}

export interface SnapshotEdgeChange {
  id: string;
  type: SnapshotChangeType;
  clusterId: string;
  relation: string;
  source: SnapshotResourceIdentity;
  target: SnapshotResourceIdentity;
  confidence: TopologyEdge['confidence'];
  sourceField: string;
  changedFields: string[];
}

export interface SnapshotComparison {
  clusters: SnapshotClusterChange[];
  nodes: SnapshotNodeChange[];
  edges: SnapshotEdgeChange[];
  counts: Record<SnapshotChangeType, number>;
  clusterCounts: Record<SnapshotChangeType, number>;
  edgeCounts: Record<SnapshotChangeType, number>;
}

export function captureSnapshotBaseline(snapshot: TopologySnapshot, label: string): SnapshotBaseline {
  return {
    snapshot: cloneTopologySnapshot(snapshot),
    capturedAt: Date.now(),
    label: label.trim().slice(0, 80) || 'snapshot',
  };
}

export function compareTopologySnapshots(baseline: TopologySnapshot, current: TopologySnapshot): SnapshotComparison {
  const clusters = compareClusters(baseline.clusters, current.clusters);
  const baselineNodes = new Map(baseline.nodes.map((node) => [node.id, node]));
  const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
  const nodes: SnapshotNodeChange[] = [];

  for (const node of current.nodes) {
    const previousNode = baselineNodes.get(node.id);
    if (!previousNode) {
      nodes.push(nodeChange('added', node));
      continue;
    }
    const changedFields = changedNodeFields(previousNode, node);
    if (changedFields.length > 0) {
      nodes.push(nodeChange('changed', node, previousNode, changedFields));
    }
  }

  for (const node of baseline.nodes) {
    if (!currentNodes.has(node.id)) {
      nodes.push(nodeChange('removed', node));
    }
  }

  const baselineEdges = new Map(baseline.edges.map((edge) => [edge.id, edge]));
  const currentEdges = new Map(current.edges.map((edge) => [edge.id, edge]));
  const edges: SnapshotEdgeChange[] = [];
  for (const edge of current.edges) {
    const previousEdge = baselineEdges.get(edge.id);
    if (!previousEdge) {
      edges.push(edgeChange('added', edge, currentNodes));
      continue;
    }
    const changedFields = changedEdgeFields(previousEdge, edge);
    if (changedFields.length > 0) {
      edges.push(edgeChange('changed', edge, currentNodes, changedFields));
    }
  }
  for (const edge of baseline.edges) {
    if (!currentEdges.has(edge.id)) {
      edges.push(edgeChange('removed', edge, baselineNodes));
    }
  }

  nodes.sort((left, right) => changeTypeOrder(left.type) - changeTypeOrder(right.type) || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
  edges.sort((left, right) => changeTypeOrder(left.type) - changeTypeOrder(right.type) || left.relation.localeCompare(right.relation) || left.id.localeCompare(right.id));

  return {
    clusters,
    nodes,
    edges,
    counts: {
      added: nodes.filter((change) => change.type === 'added').length,
      removed: nodes.filter((change) => change.type === 'removed').length,
      changed: nodes.filter((change) => change.type === 'changed').length,
    },
    clusterCounts: countChanges(clusters),
    edgeCounts: countChanges(edges),
  };
}

function compareClusters(baseline: ClusterSummary[], current: ClusterSummary[]) {
  const baselineClusters = new Map(baseline.map((cluster) => [cluster.id, cluster]));
  const currentClusters = new Map(current.map((cluster) => [cluster.id, cluster]));
  const changes: SnapshotClusterChange[] = [];

  for (const cluster of current) {
    const previous = baselineClusters.get(cluster.id);
    if (!previous) {
      changes.push(clusterChange('added', cluster));
      continue;
    }
    const changedFields = changedClusterFields(previous, cluster);
    if (changedFields.length > 0) {
      changes.push(clusterChange('changed', cluster, previous, changedFields));
    }
  }
  for (const cluster of baseline) {
    if (!currentClusters.has(cluster.id)) {
      changes.push(clusterChange('removed', cluster));
    }
  }
  return changes.sort((left, right) => changeTypeOrder(left.type) - changeTypeOrder(right.type) || left.name.localeCompare(right.name));
}

function changedClusterFields(previous: ClusterSummary, current: ClusterSummary) {
  const fields: Array<keyof ClusterSummary> = [
    'name',
    'provider',
    'version',
    'nodeReady',
    'nodeTotal',
    'podRunning',
    'podWarning',
    'namespaces',
  ];
  return fields.filter((field) => previous[field] !== current[field]);
}

function clusterChange(type: SnapshotChangeType, cluster: ClusterSummary, previous?: ClusterSummary, changedFields: string[] = []): SnapshotClusterChange {
  return {
    id: cluster.id,
    type,
    name: cluster.name,
    before: previous || (type === 'removed' ? { ...cluster } : undefined),
    after: type === 'removed' ? undefined : { ...cluster },
    changedFields,
  };
}

function countChanges(changes: Array<{ type: SnapshotChangeType }>) {
  return {
    added: changes.filter((change) => change.type === 'added').length,
    removed: changes.filter((change) => change.type === 'removed').length,
    changed: changes.filter((change) => change.type === 'changed').length,
  };
}

function cloneTopologySnapshot(snapshot: TopologySnapshot): TopologySnapshot {
  return {
    clusters: snapshot.clusters.map((cluster) => ({ ...cluster })),
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      labels: { ...node.labels },
      annotations: node.annotations ? { ...node.annotations } : undefined,
      owners: node.owners ? [...node.owners] : undefined,
      summary: Object.fromEntries(Object.entries(node.summary).map(([key, value]) => [key, cloneSummaryValue(value)])),
    })),
    edges: snapshot.edges.map((edge) => ({ ...edge })),
  };
}

function cloneSummaryValue(value: SummaryValue): SummaryValue {
  if (Array.isArray(value)) {
    return [...value] as SummaryValue;
  }
  return value;
}

function changedNodeFields(previousNode: TopologyNode, currentNode: TopologyNode) {
  const fields: string[] = [];
  if (previousNode.status !== currentNode.status) {
    fields.push('status');
  }
  if (stableValue(previousNode.labels) !== stableValue(currentNode.labels)) {
    fields.push('labels');
  }
  if (stableValue(Object.keys(previousNode.annotations || {})) !== stableValue(Object.keys(currentNode.annotations || {}))) {
    fields.push('annotations');
  }
  if (stableValue(previousNode.owners || []) !== stableValue(currentNode.owners || [])) {
    fields.push('owners');
  }
  if (safeSummaryValue(previousNode) !== safeSummaryValue(currentNode)) {
    fields.push('summary');
  }
  return fields;
}

function safeSummaryValue(node: TopologyNode) {
  if (node.kind === 'Secret') {
    return stableValue(Object.keys(node.summary));
  }
  return stableValue(node.summary);
}

function stableValue(value: Record<string, string | SummaryValue> | string[]) {
  if (Array.isArray(value)) {
    return JSON.stringify([...value].sort());
  }
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function nodeChange(type: SnapshotChangeType, node: TopologyNode, previousNode?: TopologyNode, changedFields: string[] = []): SnapshotNodeChange {
  return {
    id: node.id,
    type,
    clusterId: node.clusterId,
    kind: node.kind,
    namespace: node.namespace || '-',
    name: node.name,
    beforeStatus: previousNode?.status || (type === 'removed' ? node.status : undefined),
    afterStatus: type === 'removed' ? undefined : node.status,
    changedFields,
  };
}

function changedEdgeFields(previous: TopologyEdge, current: TopologyEdge) {
  const fields: Array<keyof TopologyEdge> = ['clusterId', 'source', 'target', 'type', 'confidence', 'sourceField'];
  return fields.filter((field) => previous[field] !== current[field]);
}

function edgeChange(type: SnapshotChangeType, edge: TopologyEdge, nodes: Map<string, TopologyNode>, changedFields: string[] = []): SnapshotEdgeChange {
  return {
    id: edge.id,
    type,
    clusterId: edge.clusterId,
    relation: edge.type,
    source: resourceIdentity(edge.source, nodes.get(edge.source)),
    target: resourceIdentity(edge.target, nodes.get(edge.target)),
    confidence: edge.confidence,
    sourceField: edge.sourceField,
    changedFields,
  };
}

function resourceIdentity(id: string, node?: TopologyNode): SnapshotResourceIdentity {
  return {
    id,
    kind: node?.kind || 'Unknown',
    namespace: node?.namespace || '-',
    name: node?.name || id,
  };
}

function changeTypeOrder(type: SnapshotChangeType | 'added' | 'removed') {
  if (type === 'changed') {
    return 0;
  }
  return type === 'added' ? 1 : 2;
}
