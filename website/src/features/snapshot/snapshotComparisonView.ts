import type { SnapshotDiffChangeFilter, SnapshotDiffScope } from './exportSnapshotDiff.ts';
import type {
  SnapshotClusterChange,
  SnapshotComparison,
  SnapshotEdgeChange,
  SnapshotNodeChange,
} from './compareSnapshots.ts';

export interface SnapshotRelationTypeOption {
  relation: string;
  count: number;
}

export interface VisibleSnapshotChanges {
  clusters: SnapshotClusterChange[];
  edges: SnapshotEdgeChange[];
  nodes: SnapshotNodeChange[];
}

export function filterSnapshotComparison(
  comparison: SnapshotComparison,
  changeFilter: SnapshotDiffChangeFilter,
  query: string,
): VisibleSnapshotChanges {
  const normalizedQuery = query.trim().toLowerCase();
  return {
    nodes: comparison.nodes.filter((change) => matchesChangeType(change.type, changeFilter)
      && (!normalizedQuery || nodeSearchValue(change).includes(normalizedQuery))),
    edges: comparison.edges.filter((change) => matchesChangeType(change.type, changeFilter)
      && (!normalizedQuery || edgeSearchValue(change).includes(normalizedQuery))),
    clusters: comparison.clusters.filter((change) => matchesChangeType(change.type, changeFilter)
      && (!normalizedQuery || clusterSearchValue(change).includes(normalizedQuery))),
  };
}

export function filterSnapshotRelationsByTypes(changes: SnapshotEdgeChange[], selected: Set<string>) {
  return selected.size === 0 ? changes : changes.filter((change) => selected.has(change.relation));
}

export function relationTypeCounts(changes: SnapshotEdgeChange[]): SnapshotRelationTypeOption[] {
  const counts = new Map<string, number>();
  changes.forEach((change) => counts.set(change.relation, (counts.get(change.relation) || 0) + 1));
  return [...counts.entries()]
    .map(([relation, count]) => ({ relation, count }))
    .sort((left, right) => left.relation.localeCompare(right.relation));
}

export function retainAvailableRelationTypes(selected: Set<string>, options: SnapshotRelationTypeOption[]) {
  const available = new Set(options.map((option) => option.relation));
  const next = new Set([...selected].filter((relation) => available.has(relation)));
  return setsEqual(selected, next) ? selected : next;
}

export function toggleRelationTypeSelection(selected: Set<string>, relation: string) {
  const next = new Set(selected);
  if (next.has(relation)) {
    next.delete(relation);
  } else {
    next.add(relation);
  }
  return next;
}

export function snapshotScopeLabel(scope: SnapshotDiffScope) {
  if (scope === 'relations') {
    return '관계';
  }
  return scope === 'clusters' ? '클러스터' : '리소스';
}

export function snapshotScopeTotalCount(scope: SnapshotDiffScope, comparison: SnapshotComparison) {
  if (scope === 'relations') {
    return comparison.edges.length;
  }
  return scope === 'clusters' ? comparison.clusters.length : comparison.nodes.length;
}

export function snapshotVisibleChangeCount(scope: SnapshotDiffScope, changes: VisibleSnapshotChanges) {
  if (scope === 'relations') {
    return changes.edges.length;
  }
  return scope === 'clusters' ? changes.clusters.length : changes.nodes.length;
}

export function snapshotScopeSearchPlaceholder(scope: SnapshotDiffScope) {
  if (scope === 'relations') {
    return 'relation, source, target 검색';
  }
  if (scope === 'clusters') {
    return 'cluster, provider, version 검색';
  }
  return 'kind, namespace, name 검색';
}

function matchesChangeType(changeType: SnapshotNodeChange['type'], filter: SnapshotDiffChangeFilter) {
  return filter === 'all' || changeType === filter;
}

function nodeSearchValue(change: SnapshotNodeChange) {
  return [change.kind, change.namespace, change.name, change.clusterId, ...change.changedFields].join(' ').toLowerCase();
}

function edgeSearchValue(change: SnapshotEdgeChange) {
  return [
    change.clusterId,
    change.relation,
    change.source.kind,
    change.source.namespace,
    change.source.name,
    change.target.kind,
    change.target.namespace,
    change.target.name,
    change.sourceField,
    change.confidence,
    ...change.changedFields,
  ].join(' ').toLowerCase();
}

function clusterSearchValue(change: SnapshotClusterChange) {
  return [
    change.id,
    change.name,
    change.before?.provider,
    change.before?.version,
    change.after?.provider,
    change.after?.version,
    ...change.changedFields,
  ].filter(Boolean).join(' ').toLowerCase();
}

function setsEqual(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}
