import type {
  SnapshotBaseline,
  SnapshotChangeType,
  SnapshotClusterChange,
  SnapshotComparison,
  SnapshotEdgeChange,
  SnapshotNodeChange,
} from './compareSnapshots';
import type { ClusterSummary, TopologySnapshot } from '../../types/topology';
import { safeCsvDocument } from '../export/safeCsv';

export type SnapshotDiffScope = 'resources' | 'relations' | 'clusters';
export type SnapshotDiffChangeFilter = 'all' | SnapshotChangeType;
export type SnapshotDiffExportFormat = 'json' | 'csv';

export interface SnapshotDiffExportInput {
  baseline: SnapshotBaseline;
  changeFilter: SnapshotDiffChangeFilter;
  clusters: SnapshotClusterChange[];
  comparison: SnapshotComparison;
  currentLabel: string;
  currentSnapshot: TopologySnapshot;
  edges: SnapshotEdgeChange[];
  nodes: SnapshotNodeChange[];
  relationTypes: string[];
  scope: SnapshotDiffScope;
}

export function downloadSnapshotDiff(input: SnapshotDiffExportInput, format: SnapshotDiffExportFormat) {
  const exportedAt = Date.now();
  const content = format === 'json'
    ? createSnapshotDiffJson(input, exportedAt)
    : createSnapshotDiffCsv(input);
  const mimeType = format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8';
  const fileName = snapshotDiffFileName(input, format, exportedAt);
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
}

export function createSnapshotDiffJson(input: SnapshotDiffExportInput, exportedAt = Date.now()) {
  const items = safeExportItems(input);
  return `${JSON.stringify({
    schemaVersion: 1,
    kind: 'kuviewer.snapshotDiff',
    exportedAt,
    baseline: snapshotIdentity(input.baseline.label, input.baseline.snapshot, input.baseline.capturedAt),
    current: snapshotIdentity(input.currentLabel, input.currentSnapshot),
    filters: {
      scope: input.scope,
      changeType: input.changeFilter,
      relationTypes: input.scope === 'relations' ? [...input.relationTypes].sort() : [],
    },
    counts: {
      exported: items.length,
      resources: input.comparison.nodes.length,
      relations: input.comparison.edges.length,
      clusters: input.comparison.clusters.length,
    },
    items,
  }, null, 2)}\n`;
}

export function createSnapshotDiffCsv(input: SnapshotDiffExportInput) {
  if (input.scope === 'resources') {
    return csvDocument(
      ['change', 'clusterId', 'kind', 'namespace', 'name', 'beforeStatus', 'afterStatus', 'changedFields'],
      input.nodes.map((change) => [
        change.type,
        change.clusterId,
        change.kind,
        change.namespace,
        change.name,
        change.beforeStatus || '',
        change.afterStatus || '',
        change.changedFields.join('|'),
      ]),
    );
  }
  if (input.scope === 'relations') {
    return csvDocument(
      [
        'change', 'clusterId', 'relation',
        'sourceKind', 'sourceNamespace', 'sourceName',
        'targetKind', 'targetNamespace', 'targetName',
        'confidence', 'sourceField', 'changedFields',
      ],
      input.edges.map((change) => [
        change.type,
        change.clusterId,
        change.relation,
        change.source.kind,
        change.source.namespace,
        change.source.name,
        change.target.kind,
        change.target.namespace,
        change.target.name,
        change.confidence,
        change.sourceField,
        change.changedFields.join('|'),
      ]),
    );
  }
  return csvDocument(
    [
      'change', 'clusterId', 'clusterName', 'changedFields',
      'beforeProvider', 'beforeVersion', 'beforeNodeReady', 'beforeNodeTotal', 'beforePodRunning', 'beforePodWarning', 'beforeNamespaces',
      'afterProvider', 'afterVersion', 'afterNodeReady', 'afterNodeTotal', 'afterPodRunning', 'afterPodWarning', 'afterNamespaces',
    ],
    input.clusters.map((change) => [
      change.type,
      change.id,
      change.name,
      change.changedFields.join('|'),
      ...clusterCsvValues(change.before),
      ...clusterCsvValues(change.after),
    ]),
  );
}

function safeExportItems(input: SnapshotDiffExportInput): Array<Record<string, unknown>> {
  if (input.scope === 'resources') {
    return input.nodes.map((change) => ({
      change: change.type,
      clusterId: change.clusterId,
      kind: change.kind,
      namespace: change.namespace,
      name: change.name,
      beforeStatus: change.beforeStatus,
      afterStatus: change.afterStatus,
      changedFields: [...change.changedFields],
    }));
  }
  if (input.scope === 'relations') {
    return input.edges.map((change) => ({
      change: change.type,
      clusterId: change.clusterId,
      relation: change.relation,
      source: { ...change.source },
      target: { ...change.target },
      confidence: change.confidence,
      sourceField: change.sourceField,
      changedFields: [...change.changedFields],
    }));
  }
  return input.clusters.map((change) => ({
    change: change.type,
    clusterId: change.id,
    clusterName: change.name,
    changedFields: [...change.changedFields],
    before: safeClusterSummary(change.before),
    after: safeClusterSummary(change.after),
  }));
}

function snapshotIdentity(label: string, snapshot: TopologySnapshot, capturedAt?: number) {
  return {
    label: label.trim().slice(0, 80),
    capturedAt,
    clusterCount: snapshot.clusters.length,
    resourceCount: snapshot.nodes.length,
    relationCount: snapshot.edges.length,
  };
}

function safeClusterSummary(cluster?: ClusterSummary) {
  if (!cluster) {
    return undefined;
  }
  return {
    id: cluster.id,
    name: cluster.name,
    provider: cluster.provider,
    version: cluster.version,
    nodeReady: cluster.nodeReady,
    nodeTotal: cluster.nodeTotal,
    podRunning: cluster.podRunning,
    podWarning: cluster.podWarning,
    namespaces: cluster.namespaces,
  };
}

function clusterCsvValues(cluster?: ClusterSummary): Array<string | number> {
  if (!cluster) {
    return ['', '', '', '', '', '', ''];
  }
  return [
    cluster.provider,
    cluster.version,
    cluster.nodeReady,
    cluster.nodeTotal,
    cluster.podRunning,
    cluster.podWarning,
    cluster.namespaces,
  ];
}

function csvDocument(headers: string[], rows: Array<Array<string | number>>) {
  return safeCsvDocument(headers, rows);
}

function snapshotDiffFileName(input: SnapshotDiffExportInput, format: SnapshotDiffExportFormat, exportedAt: number) {
  const baseline = safeFileSlug(input.baseline.label, 'baseline');
  const current = safeFileSlug(input.currentLabel, 'current');
  const timestamp = new Date(exportedAt).toISOString().replace(/[:.]/g, '-');
  return `kuviewer-diff-${baseline}-to-${current}-${input.scope}-${timestamp}.${format}`;
}

function safeFileSlug(value: string, fallback: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}
