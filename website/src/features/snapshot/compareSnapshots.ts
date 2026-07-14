import type { SummaryValue, TopologyEdge, TopologyNode, TopologySnapshot } from '../../types/topology';

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

export interface SnapshotEdgeChange {
  id: string;
  type: 'added' | 'removed';
  relation: string;
  source: string;
  target: string;
}

export interface SnapshotComparison {
  nodes: SnapshotNodeChange[];
  edges: SnapshotEdgeChange[];
  counts: Record<SnapshotChangeType, number>;
}

export function captureSnapshotBaseline(snapshot: TopologySnapshot, label: string): SnapshotBaseline {
  return {
    snapshot: cloneTopologySnapshot(snapshot),
    capturedAt: Date.now(),
    label: label.trim().slice(0, 80) || 'snapshot',
  };
}

export function compareTopologySnapshots(baseline: TopologySnapshot, current: TopologySnapshot): SnapshotComparison {
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
    if (!baselineEdges.has(edge.id)) {
      edges.push(edgeChange('added', edge));
    }
  }
  for (const edge of baseline.edges) {
    if (!currentEdges.has(edge.id)) {
      edges.push(edgeChange('removed', edge));
    }
  }

  nodes.sort((left, right) => changeTypeOrder(left.type) - changeTypeOrder(right.type) || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
  edges.sort((left, right) => changeTypeOrder(left.type) - changeTypeOrder(right.type) || left.relation.localeCompare(right.relation) || left.id.localeCompare(right.id));

  return {
    nodes,
    edges,
    counts: {
      added: nodes.filter((change) => change.type === 'added').length,
      removed: nodes.filter((change) => change.type === 'removed').length,
      changed: nodes.filter((change) => change.type === 'changed').length,
    },
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

function edgeChange(type: 'added' | 'removed', edge: TopologyEdge): SnapshotEdgeChange {
  return {
    id: edge.id,
    type,
    relation: edge.type,
    source: edge.source,
    target: edge.target,
  };
}

function changeTypeOrder(type: SnapshotChangeType | 'added' | 'removed') {
  if (type === 'changed') {
    return 0;
  }
  return type === 'added' ? 1 : 2;
}
