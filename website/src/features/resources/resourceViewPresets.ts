import type { ResourceViewPresetApiMetadata } from '../../services/resourceApi';
import type { TopologySourceMode } from '../topology/useTopology';
import { appendResourceViewFilterSearchParams, type ResourceViewFilters } from './resourceViewState.ts';

export const defaultResourceViewGroup = 'General';
export const maxResourceViewPresets = 8;
export const maxResourceViewGroupLength = 40;
const resourceViewPresetStorageKey = 'kuviewer_resource_view_presets';
const resourceViewPresetCollapsedGroupsStorageKey = 'kuviewer_resource_view_collapsed_groups';
const allValue = 'all';

type ResourceViewStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface ResourceViewPreset extends ResourceViewFilters {
  name: string;
  group: string;
  order: number;
  updatedAt: number;
}

export interface ResourceViewMessage {
  tone: 'success' | 'warning';
  text: string;
}

export interface ResourceViewTransferSummary {
  action: 'export' | 'import';
  scope: 'all' | 'selected' | 'incoming';
  fileName: string;
  count: number;
  skippedCount: number;
  folders: string[];
  format?: 'array' | 'items';
}

export interface ResourceViewTeamSyncSummary {
  action: 'load' | 'save';
  count: number;
  skippedCount: number;
  conflictCount: number;
  duplicateCount: number;
  newCount: number;
  localCount: number;
  folders: string[];
  timestamp: number;
  snapshotMetadata?: ResourceViewTeamSnapshotMetadata;
}

export interface ResourceViewTeamComparePreview {
  action: 'load' | 'save';
  incomingPresets: ResourceViewPreset[];
  invalidCount: number;
  mergeResult: ResourceViewMergeResult;
  localCount: number;
  teamCount: number;
  newNames: string[];
  conflictNames: string[];
  duplicateNames: string[];
  localOnlyNames: string[];
  teamOnlyNames: string[];
  folders: string[];
  timestamp: number;
  snapshotMetadata?: ResourceViewTeamSnapshotMetadata;
}

export interface ResourceViewTeamSnapshotMetadata {
  version: number;
  updatedAt: number;
  count: number;
  storage: string;
}

export interface ResourceViewRenameState {
  originalName: string;
  draftName: string;
  error: string;
}

export type ResourceViewConflictSource = 'import' | 'team';
export type ResourceViewConflictResolution = 'incoming' | 'current' | 'rename';

export interface ResourceViewConflictItem {
  name: string;
  existing: ResourceViewPreset;
  incoming: ResourceViewPreset;
}

export interface ResourceViewConflictState {
  source: ResourceViewConflictSource;
  basePresets: ResourceViewPreset[];
  incomingPresets: ResourceViewPreset[];
  conflicts: ResourceViewConflictItem[];
  duplicateCount: number;
  invalidCount: number;
  incomingCount: number;
}

export interface ResourceViewMergeResult {
  presets: ResourceViewPreset[];
  conflicts: ResourceViewConflictItem[];
  duplicateCount: number;
  incomingCount: number;
  droppedCount: number;
}

export function readResourceViewPresets(storage: ResourceViewStorage = window.localStorage): ResourceViewPreset[] {
  try {
    const rawValue = storage.getItem(resourceViewPresetStorageKey);
    if (!rawValue) {
      return [];
    }
    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }
    return normalizeResourceViewPresetOrders(parsedValue.flatMap((value, index) => validResourceViewPreset(value, index + 1)).slice(0, maxResourceViewPresets));
  } catch {
    return [];
  }
}

export function writeResourceViewPresets(presets: ResourceViewPreset[], storage: ResourceViewStorage = window.localStorage) {
  try {
    const safePresets = normalizeResourceViewPresetOrders(
      presets.flatMap((preset, index) => validResourceViewPreset(preset, index + 1)),
    )
      .slice(0, maxResourceViewPresets)
      .map(resourceViewPresetExportRecord);
    storage.setItem(resourceViewPresetStorageKey, JSON.stringify(safePresets));
  } catch {
    // Presets are a convenience feature; quota/private-mode failures should not break the explorer.
  }
}

export function readCollapsedResourceViewGroups(storage: ResourceViewStorage = window.localStorage): Set<string> {
  try {
    const rawValue = storage.getItem(resourceViewPresetCollapsedGroupsStorageKey);
    if (!rawValue) {
      return new Set();
    }
    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return new Set();
    }
    return new Set(parsedValue.flatMap((value) => typeof value === 'string' ? [normalizeResourceViewPresetGroup(value)] : []));
  } catch {
    return new Set();
  }
}

export function writeCollapsedResourceViewGroups(groups: Set<string>, storage: ResourceViewStorage = window.localStorage) {
  try {
    const safeGroups = [...new Set([...groups].map(normalizeResourceViewPresetGroup))].sort();
    storage.setItem(resourceViewPresetCollapsedGroupsStorageKey, JSON.stringify(safeGroups));
  } catch {
    // Group collapse state is only a UI preference.
  }
}

export function resourceViewShareUrl(filters: ResourceViewFilters, sourceMode: TopologySourceMode, currentHref = window.location.href) {
  const url = new URL(currentHref);
  const params = new URLSearchParams();
  params.set('view', 'resources');
  if (sourceMode !== 'upload') {
    params.set('source', sourceMode);
  }
  appendResourceViewFilterSearchParams(params, filters);
  url.search = params.toString();
  url.hash = '';
  return url.toString();
}

export function resourceViewPresetExportRecord(preset: ResourceViewPreset): ResourceViewPreset {
  return {
    name: preset.name,
    group: preset.group,
    query: preset.query,
    cluster: preset.cluster,
    namespace: preset.namespace,
    kind: preset.kind,
    status: preset.status,
    order: preset.order,
    updatedAt: preset.updatedAt,
  };
}

export function resourceViewExportFileName(scope: 'all' | 'selected') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `kuviewer-resource-views-${scope}-${timestamp}.json`;
}

export function resourceViewPresetFolderNames(presets: ResourceViewPreset[]) {
  return unique(presets.map((preset) => normalizeResourceViewPresetGroup(preset.group))).sort((left, right) => left.localeCompare(right));
}

export function resourceViewImportItems(value: unknown): { format: 'array' | 'items'; items: unknown[] } | null {
  if (Array.isArray(value)) {
    return { format: 'array', items: value };
  }
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    if (Array.isArray(candidate.items)) {
      return { format: 'items', items: candidate.items };
    }
  }
  return null;
}

export function validResourceViewPreset(value: unknown, fallbackOrder = 1): ResourceViewPreset[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.name !== 'string' ||
    candidate.name.trim() === '' ||
    typeof candidate.query !== 'string' ||
    typeof candidate.cluster !== 'string' ||
    typeof candidate.namespace !== 'string' ||
    typeof candidate.kind !== 'string' ||
    typeof candidate.status !== 'string' ||
    typeof candidate.updatedAt !== 'number'
  ) {
    return [];
  }
  return [
    {
      name: candidate.name.trim().slice(0, 80),
      group: normalizeResourceViewPresetGroup(typeof candidate.group === 'string' ? candidate.group : ''),
      query: candidate.query.slice(0, 160),
      cluster: candidate.cluster || allValue,
      namespace: candidate.namespace || allValue,
      kind: candidate.kind || allValue,
      status: candidate.status || allValue,
      order: normalizeResourceViewPresetOrder(candidate.order, fallbackOrder),
      updatedAt: candidate.updatedAt,
    },
  ];
}

export function mergeResourceViewPresets(existingPresets: ResourceViewPreset[], incomingPresets: ResourceViewPreset[], resolution: ResourceViewConflictResolution): ResourceViewMergeResult {
  const existingByName = new Map(existingPresets.map((preset) => [preset.name, preset]));
  const seenNames = new Set<string>();
  const merged: ResourceViewPreset[] = [];
  const conflicts: ResourceViewConflictItem[] = [];
  let duplicateCount = 0;

  const pushPreset = (preset: ResourceViewPreset) => {
    if (seenNames.has(preset.name)) {
      return;
    }
    seenNames.add(preset.name);
    merged.push(preset);
  };

  if (resolution === 'current') {
    for (const preset of existingPresets) {
      pushPreset(preset);
    }
  }

  for (const incomingPreset of incomingPresets) {
    const existingPreset = existingByName.get(incomingPreset.name);
    if (!existingPreset) {
      pushPreset(incomingPreset);
      continue;
    }
    if (resourceViewPresetFiltersEqual(existingPreset, incomingPreset)) {
      duplicateCount += 1;
      if (resolution !== 'current') {
        pushPreset(incomingPreset);
      }
      continue;
    }

    conflicts.push({ name: incomingPreset.name, existing: existingPreset, incoming: incomingPreset });
    if (resolution === 'incoming') {
      pushPreset(incomingPreset);
    } else if (resolution === 'rename') {
      const renamedPreset = { ...incomingPreset, name: copiedResourceViewPresetName(incomingPreset.name, seenNames, existingByName) };
      pushPreset(renamedPreset);
    }
  }

  if (resolution !== 'current') {
    for (const preset of existingPresets) {
      pushPreset(preset);
    }
  }

  const droppedCount = Math.max(0, merged.length - maxResourceViewPresets);
  return {
    presets: normalizeResourceViewPresetOrders(merged.slice(0, maxResourceViewPresets)),
    conflicts,
    duplicateCount,
    incomingCount: incomingPresets.length,
    droppedCount,
  };
}

export function buildResourceViewTeamComparePreview(action: 'load' | 'save', localPresets: ResourceViewPreset[], teamPresets: ResourceViewPreset[], invalidCount: number, snapshotMetadata?: ResourceViewTeamSnapshotMetadata): ResourceViewTeamComparePreview {
  const existingPresets = action === 'load' ? localPresets : teamPresets;
  const incomingPresets = action === 'load' ? teamPresets : localPresets;
  const mergeResult = mergeResourceViewPresets(existingPresets, incomingPresets, 'incoming');
  const existingByName = new Map(existingPresets.map((preset) => [preset.name, preset]));
  const localNames = new Set(localPresets.map((preset) => preset.name));
  const teamNames = new Set(teamPresets.map((preset) => preset.name));
  const duplicateNames: string[] = [];
  const newNames: string[] = [];

  for (const incomingPreset of incomingPresets) {
    const existingPreset = existingByName.get(incomingPreset.name);
    if (!existingPreset) {
      newNames.push(incomingPreset.name);
    } else if (resourceViewPresetFiltersEqual(existingPreset, incomingPreset)) {
      duplicateNames.push(incomingPreset.name);
    }
  }

  return {
    action,
    incomingPresets,
    invalidCount,
    mergeResult,
    localCount: localPresets.length,
    teamCount: teamPresets.length,
    newNames,
    conflictNames: mergeResult.conflicts.map((conflict) => conflict.name),
    duplicateNames,
    localOnlyNames: localPresets.filter((preset) => !teamNames.has(preset.name)).map((preset) => preset.name),
    teamOnlyNames: teamPresets.filter((preset) => !localNames.has(preset.name)).map((preset) => preset.name),
    folders: resourceViewPresetFolderNames(incomingPresets),
    timestamp: Date.now(),
    snapshotMetadata,
  };
}

export function resourceViewTeamSyncSummaryFromCompare(preview: ResourceViewTeamComparePreview): ResourceViewTeamSyncSummary {
  return {
    action: preview.action,
    count: preview.incomingPresets.length,
    skippedCount: preview.invalidCount,
    conflictCount: preview.conflictNames.length,
    duplicateCount: preview.duplicateNames.length,
    newCount: preview.newNames.length,
    localCount: preview.localCount,
    folders: preview.folders,
    timestamp: Date.now(),
    snapshotMetadata: preview.snapshotMetadata,
  };
}

export function upsertResourceViewPreset(presets: ResourceViewPreset[], preset: ResourceViewPreset) {
  return normalizeResourceViewPresetOrders([preset, ...presets.filter((existingPreset) => existingPreset.name !== preset.name)].slice(0, maxResourceViewPresets));
}

export function moveResourceViewPresetsToGroup(presets: ResourceViewPreset[], selectedNames: Set<string>, targetGroup: string) {
  const normalizedTargetGroup = normalizeResourceViewPresetGroup(targetGroup);
  const now = Date.now();
  const selectedPresets = orderResourceViewPresets(presets.filter((preset) => selectedNames.has(preset.name))).map((preset) => ({
    ...preset,
    group: normalizedTargetGroup,
    updatedAt: now,
  }));
  const remainingPresets = orderResourceViewPresets(presets.filter((preset) => !selectedNames.has(preset.name)));
  return normalizeResourceViewPresetOrders([...selectedPresets, ...remainingPresets]);
}

function normalizeResourceViewPresetOrder(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function normalizeResourceViewPresetOrders(presets: ResourceViewPreset[]) {
  return orderResourceViewPresets(presets).map((preset, index) => ({ ...preset, order: index + 1 }));
}

export function orderResourceViewPresets(presets: ResourceViewPreset[]) {
  return presets
    .map((preset, index) => ({ preset: { ...preset, order: normalizeResourceViewPresetOrder(preset.order, index + 1) }, index }))
    .sort((left, right) => left.preset.order - right.preset.order || left.index - right.index)
    .map((entry) => entry.preset);
}

export function resourceViewPresetTopOrderForGroup(presets: ResourceViewPreset[], groupName: string) {
  const normalizedGroup = normalizeResourceViewPresetGroup(groupName);
  const groupOrders = presets
    .filter((preset) => normalizeResourceViewPresetGroup(preset.group) === normalizedGroup)
    .map((preset) => normalizeResourceViewPresetOrder(preset.order, Number.POSITIVE_INFINITY));
  return groupOrders.length > 0 ? Math.min(...groupOrders) - 1 : 0;
}

export function normalizeResourceViewPresetGroup(group: string) {
  const normalized = group.trim().slice(0, maxResourceViewGroupLength);
  return normalized || defaultResourceViewGroup;
}

export function groupResourceViewPresets(presets: ResourceViewPreset[]) {
  const grouped = new Map<string, ResourceViewPreset[]>();
  for (const preset of presets) {
    const groupName = normalizeResourceViewPresetGroup(preset.group);
    grouped.set(groupName, [...(grouped.get(groupName) || []), preset]);
  }
  return [...grouped.entries()]
    .map(([name, groupPresets]) => ({ name, presets: orderResourceViewPresets(groupPresets), total: groupPresets.length }))
    .sort((left, right) => {
      if (left.name === defaultResourceViewGroup) {
        return -1;
      }
      if (right.name === defaultResourceViewGroup) {
        return 1;
      }
      return left.name.localeCompare(right.name);
    });
}

export function filterGroupedResourceViewPresets(groups: ReturnType<typeof groupResourceViewPresets>, query: string) {
  if (!query) {
    return groups;
  }
  return groups.flatMap((group) => {
    const presets = group.presets.filter((preset) => resourceViewPresetSearchText(preset).includes(query));
    return presets.length > 0 ? [{ ...group, presets }] : [];
  });
}

function resourceViewPresetSearchText(preset: ResourceViewPreset) {
  return [
    preset.name,
    preset.group,
    preset.query,
    preset.cluster,
    preset.namespace,
    preset.kind,
    preset.status,
    resourceViewPresetSummary(preset),
  ].join(' ').toLowerCase();
}

function resourceViewPresetFiltersEqual(left: ResourceViewPreset, right: ResourceViewPreset) {
  return left.group === right.group && left.order === right.order && left.query === right.query && left.cluster === right.cluster && left.namespace === right.namespace && left.kind === right.kind && left.status === right.status;
}

function copiedResourceViewPresetName(name: string, seenNames: Set<string>, existingByName: Map<string, ResourceViewPreset>) {
  for (let index = 1; index < 100; index += 1) {
    const suffix = index === 1 ? ' copy' : ` copy ${index}`;
    const candidate = `${name.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
    if (!seenNames.has(candidate) && !existingByName.has(candidate)) {
      return candidate;
    }
  }
  return `${name.slice(0, 72)} ${Date.now().toString(36)}`.slice(0, 80);
}

export function resourceViewConflictPendingMessage(source: ResourceViewConflictSource, conflictCount: number, duplicateCount: number, invalidCount: number) {
  return `${resourceViewSourceLabel(source)} 충돌 ${conflictCount}개가 있습니다. 해결 방식을 선택하세요.${duplicateCount > 0 ? ` 중복 ${duplicateCount}개는 변경 없음으로 처리됩니다.` : ''}${invalidCount > 0 ? ` ${invalidCount}개 항목은 건너뛰었습니다.` : ''}`;
}

export function resourceViewMergeMessage(source: ResourceViewConflictSource, result: ResourceViewMergeResult, invalidCount: number, resolved: boolean) {
  if (source === 'team' && result.incomingCount === 0) {
    return invalidCount > 0 ? `서버에 유효한 팀 뷰가 없습니다. ${invalidCount}개 항목은 건너뛰었습니다.` : '서버에 저장된 팀 뷰가 없습니다. 현재 브라우저 뷰는 유지했습니다.';
  }
  const parts = [
    `${resourceViewSourceLabel(source)} ${result.incomingCount}개를 ${resolved ? '해결해 반영했습니다' : '반영했습니다'}`,
    result.conflicts.length > 0 ? `충돌 ${result.conflicts.length}개` : '',
    result.duplicateCount > 0 ? `중복 ${result.duplicateCount}개` : '',
    invalidCount > 0 ? `건너뜀 ${invalidCount}개` : '',
    result.droppedCount > 0 ? `최대 ${maxResourceViewPresets}개 제한으로 ${result.droppedCount}개 제외` : '',
  ].filter(Boolean);
  return `${parts.join(' · ')}.`;
}

export function resourceViewTransferActionLabel(summary: ResourceViewTransferSummary) {
  if (summary.action === 'export') {
    return summary.scope === 'selected' ? 'Selected export' : 'All export';
  }
  return 'Import preview';
}

export function resourceViewTeamSyncActionLabel(summary: ResourceViewTeamSyncSummary) {
  return summary.action === 'load' ? 'Team load' : 'Team save';
}

export function resourceViewTeamCompareActionLabel(preview: ResourceViewTeamComparePreview) {
  return preview.action === 'load' ? 'Team load preview' : 'Team save preview';
}

export function resourceViewTeamCompareMessage(preview: ResourceViewTeamComparePreview) {
  const parts = [
    preview.action === 'load' ? `팀 뷰 ${preview.teamCount}개를 비교했습니다` : `팀 저장 미리보기: 브라우저 뷰 ${preview.localCount}개`,
    preview.newNames.length > 0 ? `신규 ${preview.newNames.length}개` : '',
    preview.conflictNames.length > 0 ? `변경 충돌 ${preview.conflictNames.length}개` : '',
    preview.duplicateNames.length > 0 ? `동일 ${preview.duplicateNames.length}개` : '',
    preview.action === 'load' && preview.localOnlyNames.length > 0 ? `로컬 유지 ${preview.localOnlyNames.length}개` : '',
    preview.action === 'save' && preview.teamOnlyNames.length > 0 ? `서버 제외 ${preview.teamOnlyNames.length}개` : '',
    preview.invalidCount > 0 ? `건너뜀 ${preview.invalidCount}개` : '',
    preview.mergeResult.droppedCount > 0 ? `최대 ${maxResourceViewPresets}개 제한으로 ${preview.mergeResult.droppedCount}개 제외 예정` : '',
  ].filter(Boolean);
  return `${parts.join(' · ')}.`;
}

export function resourceViewSourceLabel(source: ResourceViewConflictSource) {
  return source === 'team' ? '팀 뷰' : '가져온 뷰';
}

export function resourceViewSourceShortLabel(source: ResourceViewConflictSource) {
  return source === 'team' ? '팀' : '가져온 뷰';
}

export function resourceViewIncomingNewCount(existingPresets: ResourceViewPreset[], incomingPresets: ResourceViewPreset[]) {
  const existingNames = new Set(existingPresets.map((preset) => preset.name));
  return incomingPresets.filter((preset) => !existingNames.has(preset.name)).length;
}

export function resourceViewPresetTargetName(inputName: string, suggestedName: string) {
  return normalizeResourceViewPresetName(inputName) || normalizeResourceViewPresetName(suggestedName) || '전체 리소스';
}

export function normalizeResourceViewPresetName(name: string) {
  return name.trim().slice(0, 80);
}

export function resourceViewPresetDomId(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'view';
}

export function resourceViewGroupDomId(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'group';
}

export function resourceViewPresetMatchesFilters(preset: ResourceViewPreset, filters: Pick<ResourceViewPreset, 'query' | 'cluster' | 'namespace' | 'kind' | 'status'>) {
  return (
    preset.query === filters.query.slice(0, 160) &&
    preset.cluster === filters.cluster &&
    preset.namespace === filters.namespace &&
    preset.kind === filters.kind &&
    preset.status === filters.status
  );
}

export function normalizePresetFilterValue(value: string, availableValues: string[]) {
  if (value === allValue || availableValues.includes(value)) {
    return value;
  }
  return allValue;
}

export function suggestedResourceViewPresetName(filters: Pick<ResourceViewPreset, 'query' | 'cluster' | 'namespace' | 'kind' | 'status'>) {
  const parts = [
    filters.query.trim() ? `검색 ${filters.query.trim()}` : '',
    filters.cluster !== allValue ? filters.cluster : '',
    filters.namespace !== allValue ? filters.namespace : '',
    filters.kind !== allValue ? filters.kind : '',
    filters.status !== allValue ? filters.status : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ').slice(0, 80) : '전체 리소스';
}

export function resourceViewPresetSummary(preset: ResourceViewPreset) {
  const parts = [
    `group:${preset.group}`,
    preset.query.trim() ? `q:${preset.query.trim()}` : '',
    preset.cluster !== allValue ? `cluster:${preset.cluster}` : '',
    preset.namespace !== allValue ? `ns:${preset.namespace}` : '',
    preset.kind !== allValue ? `kind:${preset.kind}` : '',
    preset.status !== allValue ? `status:${preset.status}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '전체 필터';
}

export function resourceViewTeamSnapshotMetadata(metadata: ResourceViewPresetApiMetadata | undefined, fallbackCount: number): ResourceViewTeamSnapshotMetadata | undefined {
  if (!metadata) {
    return undefined;
  }
  return {
    version: finiteNonNegativeNumber(metadata.version, 0),
    updatedAt: finiteNonNegativeNumber(metadata.updatedAt, 0),
    count: finiteNonNegativeNumber(metadata.count, fallbackCount),
    storage: resourceViewTeamSnapshotStorage(metadata.storage),
  };
}

function finiteNonNegativeNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function resourceViewTeamSnapshotStorage(value: unknown) {
  if (typeof value !== 'string') {
    return 'server';
  }
  const storage = value.trim().slice(0, 24);
  return storage || 'server';
}

export function formatResourceViewTeamSnapshotMetadata(metadata: ResourceViewTeamSnapshotMetadata) {
  return `Snapshot v${metadata.version} · ${metadata.count} views · ${metadata.storage} · ${formatPresetUpdatedAt(metadata.updatedAt)}`;
}

export function formatPresetUpdatedAt(updatedAt: number) {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return '시각 없음';
  }
  const elapsedMs = Math.max(0, Date.now() - updatedAt);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) {
    return '방금';
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}분 전`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}시간 전`;
  }
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) {
    return `${elapsedDays}일 전`;
  }
  return new Date(updatedAt).toISOString().slice(0, 10);
}

function unique(values: string[]) {
  return Array.from(new Set(values)).sort();
}
