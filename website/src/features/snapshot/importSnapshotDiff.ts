import type { SnapshotChangeType } from './compareSnapshots';
import type { SnapshotDiffChangeFilter, SnapshotDiffScope } from './exportSnapshotDiff';

const MAX_DIFF_FILE_BYTES = 2_000_000;
const MAX_DIFF_ITEMS = 5_000;
const MAX_RELATION_TYPES = 100;
const MAX_CHANGED_FIELDS = 50;
export const SUPPORTED_SNAPSHOT_DIFF_SCHEMA_VERSIONS = [1] as const;

export interface ImportedSnapshotIdentity {
  label: string;
  capturedAt?: number;
  clusterCount: number;
  resourceCount: number;
  relationCount: number;
}

export interface ImportedSnapshotDiff {
  schemaVersion: 1;
  kind: 'kuviewer.snapshotDiff';
  exportedAt: number;
  baseline: ImportedSnapshotIdentity;
  current: ImportedSnapshotIdentity;
  filters: {
    scope: SnapshotDiffScope;
    changeType: SnapshotDiffChangeFilter;
    relationTypes: string[];
  };
  counts: {
    exported: number;
    resources: number;
    relations: number;
    clusters: number;
  };
  items: Array<Record<string, unknown>>;
}

export async function importSnapshotDiffFile(file: File): Promise<ImportedSnapshotDiff> {
  if (file.size <= 0 || file.size > MAX_DIFF_FILE_BYTES) {
    throw new Error('invalid_snapshot_diff_size');
  }
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error('invalid_snapshot_diff_json');
  }
  return parseSnapshotDiff(value);
}

export function parseSnapshotDiff(value: unknown): ImportedSnapshotDiff {
  const document = strictRecord(value, [
    'schemaVersion', 'kind', 'exportedAt', 'baseline', 'current', 'filters', 'counts', 'items',
  ]);
  if (document.kind !== 'kuviewer.snapshotDiff') {
    throw new Error('unsupported_snapshot_diff_schema');
  }
  if (document.schemaVersion === 1) {
    return parseSnapshotDiffV1(document);
  }
  throw new Error('unsupported_snapshot_diff_schema');
}

function parseSnapshotDiffV1(document: Record<string, unknown>): ImportedSnapshotDiff {
  const filters = parseFilters(document.filters);
  const itemsValue = document.items;
  if (!Array.isArray(itemsValue) || itemsValue.length > MAX_DIFF_ITEMS) {
    throw new Error('invalid_snapshot_diff_items');
  }
  const items = itemsValue.map((item) => parseItem(item, filters.scope));
  const counts = parseCounts(document.counts);
  if (counts.exported !== items.length) {
    throw new Error('invalid_snapshot_diff_count');
  }
  return {
    schemaVersion: 1,
    kind: 'kuviewer.snapshotDiff',
    exportedAt: safeTimestamp(document.exportedAt),
    baseline: parseIdentity(document.baseline),
    current: parseIdentity(document.current),
    filters,
    counts,
    items,
  };
}

function parseFilters(value: unknown): ImportedSnapshotDiff['filters'] {
  const filters = strictRecord(value, ['scope', 'changeType', 'relationTypes']);
  if (!isScope(filters.scope) || !isChangeFilter(filters.changeType)) {
    throw new Error('invalid_snapshot_diff_filters');
  }
  const relationTypes = safeStringArray(filters.relationTypes, MAX_RELATION_TYPES, 120);
  if (filters.scope !== 'relations' && relationTypes.length > 0) {
    throw new Error('invalid_snapshot_diff_filters');
  }
  return { scope: filters.scope, changeType: filters.changeType, relationTypes };
}

function parseCounts(value: unknown): ImportedSnapshotDiff['counts'] {
  const counts = strictRecord(value, ['exported', 'resources', 'relations', 'clusters']);
  return {
    exported: safeCount(counts.exported, MAX_DIFF_ITEMS),
    resources: safeCount(counts.resources, 1_000_000),
    relations: safeCount(counts.relations, 1_000_000),
    clusters: safeCount(counts.clusters, 100_000),
  };
}

function parseIdentity(value: unknown): ImportedSnapshotIdentity {
  const identity = strictRecord(value, ['label', 'capturedAt', 'clusterCount', 'resourceCount', 'relationCount']);
  return {
    label: safeString(identity.label, 80),
    capturedAt: identity.capturedAt === undefined ? undefined : safeTimestamp(identity.capturedAt),
    clusterCount: safeCount(identity.clusterCount, 100_000),
    resourceCount: safeCount(identity.resourceCount, 1_000_000),
    relationCount: safeCount(identity.relationCount, 1_000_000),
  };
}

function parseItem(value: unknown, scope: SnapshotDiffScope): Record<string, unknown> {
  if (scope === 'resources') {
    const item = strictRecord(value, [
      'change', 'clusterId', 'kind', 'namespace', 'name', 'beforeStatus', 'afterStatus', 'changedFields',
    ]);
    return {
      change: safeChangeType(item.change),
      clusterId: safeString(item.clusterId, 160),
      kind: safeString(item.kind, 120),
      namespace: safeString(item.namespace, 160, true),
      name: safeString(item.name, 253),
      beforeStatus: optionalString(item.beforeStatus, 80),
      afterStatus: optionalString(item.afterStatus, 80),
      changedFields: safeStringArray(item.changedFields, MAX_CHANGED_FIELDS, 120),
    };
  }
  if (scope === 'relations') {
    const item = strictRecord(value, [
      'change', 'clusterId', 'relation', 'source', 'target', 'confidence', 'sourceField', 'changedFields',
    ]);
    if (item.confidence !== 'observed' && item.confidence !== 'inferred') {
      throw new Error('invalid_snapshot_diff_item');
    }
    return {
      change: safeChangeType(item.change),
      clusterId: safeString(item.clusterId, 160),
      relation: safeString(item.relation, 120),
      source: parseResourceIdentity(item.source),
      target: parseResourceIdentity(item.target),
      confidence: item.confidence,
      sourceField: safeString(item.sourceField, 500, true),
      changedFields: safeStringArray(item.changedFields, MAX_CHANGED_FIELDS, 120),
    };
  }

  const item = strictRecord(value, ['change', 'clusterId', 'clusterName', 'changedFields', 'before', 'after']);
  const change = safeChangeType(item.change);
  const before = item.before === undefined ? undefined : parseClusterSummary(item.before);
  const after = item.after === undefined ? undefined : parseClusterSummary(item.after);
  if ((change === 'added' && !after) || (change === 'removed' && !before) || (change === 'changed' && (!before || !after))) {
    throw new Error('invalid_snapshot_diff_item');
  }
  return {
    change,
    clusterId: safeString(item.clusterId, 160),
    clusterName: safeString(item.clusterName, 160),
    changedFields: safeStringArray(item.changedFields, MAX_CHANGED_FIELDS, 120),
    before,
    after,
  };
}

function parseResourceIdentity(value: unknown) {
  const identity = strictRecord(value, ['id', 'kind', 'namespace', 'name']);
  return {
    id: safeString(identity.id, 500),
    kind: safeString(identity.kind, 120),
    namespace: safeString(identity.namespace, 160, true),
    name: safeString(identity.name, 253),
  };
}

function parseClusterSummary(value: unknown) {
  const cluster = strictRecord(value, [
    'id', 'name', 'provider', 'version', 'nodeReady', 'nodeTotal', 'podRunning', 'podWarning', 'namespaces',
  ]);
  return {
    id: safeString(cluster.id, 160),
    name: safeString(cluster.name, 160),
    provider: safeString(cluster.provider, 160, true),
    version: safeString(cluster.version, 80, true),
    nodeReady: safeCount(cluster.nodeReady, 1_000_000),
    nodeTotal: safeCount(cluster.nodeTotal, 1_000_000),
    podRunning: safeCount(cluster.podRunning, 1_000_000),
    podWarning: safeCount(cluster.podWarning, 1_000_000),
    namespaces: safeCount(cluster.namespaces, 1_000_000),
  };
}

function strictRecord(value: unknown, allowedKeys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_snapshot_diff_shape');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    throw new Error('invalid_snapshot_diff_field');
  }
  return record;
}

function safeChangeType(value: unknown): SnapshotChangeType {
  if (value !== 'added' && value !== 'removed' && value !== 'changed') {
    throw new Error('invalid_snapshot_diff_item');
  }
  return value;
}

function safeString(value: unknown, maxLength: number, allowEmpty = false) {
  if (typeof value !== 'string') {
    throw new Error('invalid_snapshot_diff_string');
  }
  const text = value.replace(/\0/g, '').trim();
  if ((!allowEmpty && !text) || text.length > maxLength) {
    throw new Error('invalid_snapshot_diff_string');
  }
  return text;
}

function optionalString(value: unknown, maxLength: number) {
  return value === undefined ? undefined : safeString(value, maxLength, true);
}

function safeStringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error('invalid_snapshot_diff_array');
  }
  return value.map((item) => safeString(item, maxLength));
}

function safeCount(value: unknown, max: number) {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw new Error('invalid_snapshot_diff_number');
  }
  return value as number;
}

function safeTimestamp(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 8_640_000_000_000_000) {
    throw new Error('invalid_snapshot_diff_timestamp');
  }
  return value as number;
}

function isScope(value: unknown): value is SnapshotDiffScope {
  return value === 'resources' || value === 'relations' || value === 'clusters';
}

function isChangeFilter(value: unknown): value is SnapshotDiffChangeFilter {
  return value === 'all' || value === 'added' || value === 'removed' || value === 'changed';
}
