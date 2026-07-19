import { safeCsvCell } from '../export/safeCsv.ts';
import type { ResourceExplorerItem } from '../../types/resourceExplorer.ts';
import type { ResourceViewFilters } from './resourceViewState.ts';

export const resourceListAllValue = 'all';
const resourceListDensityStorageKey = 'kuviewer_resource_list_density';
const resourceListSortStorageKey = 'kuviewer_resource_list_sort';
const resourceListColumnsStorageKey = 'kuviewer_resource_list_columns';

export type ResourceListDensity = 'comfortable' | 'compact';
export type ResourceListSortField = 'name' | 'kind' | 'namespace' | 'status' | 'cluster';
export type ResourceListSortDirection = 'asc' | 'desc';
export type ResourceListOptionalColumn = 'namespace' | 'cluster' | 'age' | 'summary';

export interface ResourceListSortPreference {
  field: ResourceListSortField;
  direction: ResourceListSortDirection;
}

export type ResourceListColumnPreference = Record<ResourceListOptionalColumn, boolean>;

export interface ResourceBulkExportRow {
  cluster: string;
  namespace: string;
  kind: string;
  name: string;
  status: string;
  labelsCount: number;
  annotationsCount: number;
  summaryKeys: string[];
  relatedCount: number;
}

export const resourceListSortOptions: Array<{ value: ResourceListSortField; label: string }> = [
  { value: 'kind', label: 'Kind' },
  { value: 'name', label: '이름' },
  { value: 'namespace', label: 'Namespace' },
  { value: 'status', label: 'Status' },
  { value: 'cluster', label: 'Cluster' },
];

export const resourceListOptionalColumns: Array<{ key: ResourceListOptionalColumn; label: string }> = [
  { key: 'namespace', label: 'Namespace' },
  { key: 'cluster', label: 'Cluster' },
  { key: 'age', label: 'Age' },
  { key: 'summary', label: 'Summary' },
];

export const defaultResourceListSortPreference: ResourceListSortPreference = { field: 'kind', direction: 'asc' };
export const defaultResourceListColumns: ResourceListColumnPreference = {
  namespace: true,
  cluster: false,
  age: true,
  summary: true,
};

export function filterResourceList(resources: ResourceExplorerItem[], filters: ResourceViewFilters) {
  const normalizedQuery = filters.query.trim().toLowerCase();
  return resources.filter((resource) => {
    const matchesQuery =
      !normalizedQuery ||
      resource.name.toLowerCase().includes(normalizedQuery) ||
      resource.kind.toLowerCase().includes(normalizedQuery) ||
      resource.namespace?.toLowerCase().includes(normalizedQuery) ||
      resource.clusterId.toLowerCase().includes(normalizedQuery) ||
      recordText(resource.labels).includes(normalizedQuery) ||
      recordText(resource.summary).includes(normalizedQuery);
    return (
      matchesQuery &&
      (filters.cluster === resourceListAllValue || resource.clusterId === filters.cluster) &&
      (filters.namespace === resourceListAllValue ||
        resource.namespace === filters.namespace ||
        (resource.kind === 'Namespace' && resource.name === filters.namespace)) &&
      (filters.kind === resourceListAllValue || resource.kind === filters.kind) &&
      (filters.status === resourceListAllValue || resource.status === filters.status)
    );
  });
}

export function sortResourceList(resources: ResourceExplorerItem[], sortPreference: ResourceListSortPreference) {
  const normalizedSort = normalizeResourceListSortPreference(sortPreference);
  return resources
    .map((resource, index) => ({ resource, index }))
    .sort((left, right) => {
      const primary = compareResourceSortValue(left.resource, right.resource, normalizedSort.field);
      if (primary !== 0) {
        return normalizedSort.direction === 'desc' ? -primary : primary;
      }
      const fallback =
        compareResourceText(left.resource.kind, right.resource.kind) ||
        compareResourceText(left.resource.namespace || '', right.resource.namespace || '') ||
        compareResourceText(left.resource.name, right.resource.name) ||
        compareResourceText(left.resource.id, right.resource.id);
      return fallback || left.index - right.index;
    })
    .map(({ resource }) => resource);
}

export function reconcileResourceSelection(current: Set<string>, visibleResources: ResourceExplorerItem[]) {
  const visibleResourceIds = new Set(visibleResources.map((resource) => resource.id));
  const next = new Set([...current].filter((resourceId) => visibleResourceIds.has(resourceId)));
  return next.size === current.size ? current : next;
}

export function getResourceSelectionRange(
  resources: ResourceExplorerItem[],
  anchorResourceId: string,
  targetResourceId: string,
  selectedResourceIndex: number,
) {
  const targetIndex = resources.findIndex((resource) => resource.id === targetResourceId);
  if (targetIndex < 0) return null;
  const anchorIndex = resources.findIndex((resource) => resource.id === anchorResourceId);
  const normalizedAnchorIndex = anchorIndex >= 0 ? anchorIndex : selectedResourceIndex >= 0 ? selectedResourceIndex : targetIndex;
  const startIndex = Math.min(normalizedAnchorIndex, targetIndex);
  const endIndex = Math.max(normalizedAnchorIndex, targetIndex);
  return {
    anchorResourceId: resources[normalizedAnchorIndex]?.id ?? targetResourceId,
    resourceIds: resources.slice(startIndex, endIndex + 1).map((resource) => resource.id),
  };
}

export function resourceBulkCopyName(resource: ResourceExplorerItem) {
  return `${resource.kind} ${resource.namespace ? `${resource.namespace}/` : ''}${resource.name}`;
}

export function resourceBulkExportRows(resources: ResourceExplorerItem[]): ResourceBulkExportRow[] {
  return resources.map((resource) => ({
    cluster: resource.clusterId,
    namespace: resource.namespace || '',
    kind: resource.kind,
    name: resource.name,
    status: resource.status,
    labelsCount: Object.keys(resource.labels).length,
    annotationsCount: Object.keys(resource.annotations).length,
    summaryKeys: Object.keys(resource.summary).sort(),
    relatedCount: resource.related.length,
  }));
}

export function resourceBulkExportJson(resources: ResourceExplorerItem[]) {
  return `${JSON.stringify(resourceBulkExportRows(resources), null, 2)}\n`;
}

export function resourceBulkExportCsv(resources: ResourceExplorerItem[]) {
  const header: Array<keyof ResourceBulkExportRow> = ['cluster', 'namespace', 'kind', 'name', 'status', 'labelsCount', 'annotationsCount', 'summaryKeys', 'relatedCount'];
  const rows = resourceBulkExportRows(resources).map((row) =>
    header.map((key) => safeCsvCell(Array.isArray(row[key]) ? row[key].join(';') : row[key])).join(','),
  );
  return `${header.join(',')}\n${rows.join('\n')}\n`;
}

export function resourceBulkExportFileName(format: 'json' | 'csv', now = new Date()) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `kuviewer-resources-selected-${timestamp}.${format}`;
}

export function normalizeResourceListSortPreference(value: Partial<ResourceListSortPreference>): ResourceListSortPreference {
  const field = value.field && resourceListSortOptions.some((option) => option.value === value.field) ? value.field : defaultResourceListSortPreference.field;
  const direction = value.direction === 'desc' ? 'desc' : defaultResourceListSortPreference.direction;
  return { field, direction };
}

export function normalizeResourceListColumnPreference(value: Partial<Record<ResourceListOptionalColumn, unknown>>): ResourceListColumnPreference {
  return {
    namespace: typeof value.namespace === 'boolean' ? value.namespace : defaultResourceListColumns.namespace,
    cluster: typeof value.cluster === 'boolean' ? value.cluster : defaultResourceListColumns.cluster,
    age: typeof value.age === 'boolean' ? value.age : defaultResourceListColumns.age,
    summary: typeof value.summary === 'boolean' ? value.summary : defaultResourceListColumns.summary,
  };
}

export function readResourceListDensityPreference(): ResourceListDensity {
  try {
    return browserStorage()?.getItem(resourceListDensityStorageKey) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

export function writeResourceListDensityPreference(density: ResourceListDensity) {
  try {
    browserStorage()?.setItem(resourceListDensityStorageKey, density);
  } catch {
    // Display preferences must never interrupt resource browsing.
  }
}

export function readResourceListSortPreference(): ResourceListSortPreference {
  try {
    const rawValue = browserStorage()?.getItem(resourceListSortStorageKey);
    return rawValue ? normalizeResourceListSortPreference(JSON.parse(rawValue) as Partial<ResourceListSortPreference>) : defaultResourceListSortPreference;
  } catch {
    return defaultResourceListSortPreference;
  }
}

export function writeResourceListSortPreference(sortPreference: ResourceListSortPreference) {
  try {
    browserStorage()?.setItem(resourceListSortStorageKey, JSON.stringify(normalizeResourceListSortPreference(sortPreference)));
  } catch {
    // Display preferences must never interrupt resource browsing.
  }
}

export function readResourceListColumnPreference(): ResourceListColumnPreference {
  try {
    const rawValue = browserStorage()?.getItem(resourceListColumnsStorageKey);
    return rawValue
      ? normalizeResourceListColumnPreference(JSON.parse(rawValue) as Partial<Record<ResourceListOptionalColumn, unknown>>)
      : { ...defaultResourceListColumns };
  } catch {
    return { ...defaultResourceListColumns };
  }
}

export function writeResourceListColumnPreference(columns: ResourceListColumnPreference) {
  try {
    browserStorage()?.setItem(resourceListColumnsStorageKey, JSON.stringify(normalizeResourceListColumnPreference(columns)));
  } catch {
    // Display preferences must never interrupt resource browsing.
  }
}

export function uniqueSortedValues(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function browserStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function compareResourceSortValue(left: ResourceExplorerItem, right: ResourceExplorerItem, field: ResourceListSortField) {
  switch (field) {
    case 'cluster':
      return compareResourceText(left.clusterId, right.clusterId);
    case 'kind':
      return compareResourceText(left.kind, right.kind);
    case 'namespace':
      return compareResourceText(left.namespace || '', right.namespace || '');
    case 'status':
      return compareResourceText(left.status, right.status);
    case 'name':
    default:
      return compareResourceText(left.name, right.name);
  }
}

function compareResourceText(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function recordText(values: Record<string, unknown>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(' ')
    .toLowerCase();
}
