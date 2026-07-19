import type { DesktopCmSession } from './desktopConnectionProfile.ts';
import {
  normalizeDesktopCmSessionViewPreferences,
  pruneDesktopCmSessionViewPreferences,
  type DesktopCmSessionViewPreferences,
} from './desktopCmSessionView.ts';

export interface DesktopCmSessionLayoutPreset {
  name: string;
  folder: string;
  viewPreferences: DesktopCmSessionViewPreferences;
  updatedAt: number;
}

export interface DesktopCmSessionLayoutFolder {
  folder: string;
  slug: string;
  presets: DesktopCmSessionLayoutPreset[];
  totalCount: number;
  collapsed: boolean;
}

export interface DesktopCmSessionLayoutFolderFilterOption {
  folder: string;
  slug: string;
  count: number;
}

export const desktopCmSessionLayoutPresetStorageKey = 'kuviewer_desktop_cm_session_layout_presets';
export const desktopCmSessionLayoutFolderCollapseStorageKey = 'kuviewer_desktop_cm_session_layout_collapsed_folders';
export const desktopCmSessionLayoutExportKind = 'kuviewer.desktop.cmSessionLayouts';
export const maxDesktopCmSessionLayoutPresets = 8;
export const maxDesktopCmSessionLayoutPresetNameLength = 40;
export const maxDesktopCmSessionLayoutFolderNameLength = 40;
export const defaultDesktopCmSessionLayoutFolder = 'General';

export function readDesktopCmSessionLayoutPresets(): DesktopCmSessionLayoutPreset[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const rawValue = window.localStorage.getItem(desktopCmSessionLayoutPresetStorageKey);
    if (!rawValue) {
      return [];
    }
    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      window.localStorage.removeItem(desktopCmSessionLayoutPresetStorageKey);
      return [];
    }
    return normalizeDesktopCmSessionLayoutPresets(parsedValue);
  } catch {
    window.localStorage.removeItem(desktopCmSessionLayoutPresetStorageKey);
    return [];
  }
}

export function writeDesktopCmSessionLayoutPresets(presets: DesktopCmSessionLayoutPreset[]) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(desktopCmSessionLayoutPresetStorageKey, JSON.stringify(normalizeDesktopCmSessionLayoutPresets(presets)));
  } catch {
    // Session layouts are only a UI preference; storage failures should not break CM sessions.
  }
}

export function readDesktopCmSessionLayoutCollapsedFolders() {
  if (typeof window === 'undefined') {
    return new Set<string>();
  }
  try {
    const rawValue = window.localStorage.getItem(desktopCmSessionLayoutFolderCollapseStorageKey);
    if (!rawValue) {
      return new Set<string>();
    }
    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      window.localStorage.removeItem(desktopCmSessionLayoutFolderCollapseStorageKey);
      return new Set<string>();
    }
    return new Set(parsedValue.filter((item): item is string => typeof item === 'string').map(normalizeDesktopCmSessionLayoutFolderName));
  } catch {
    window.localStorage.removeItem(desktopCmSessionLayoutFolderCollapseStorageKey);
    return new Set<string>();
  }
}

export function writeDesktopCmSessionLayoutCollapsedFolders(collapsedFolders: Set<string>) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const normalizedFolders = [...collapsedFolders].map(normalizeDesktopCmSessionLayoutFolderName).sort();
    window.localStorage.setItem(desktopCmSessionLayoutFolderCollapseStorageKey, JSON.stringify(normalizedFolders));
  } catch {
    // Folder collapse is only a UI preference; storage failures should not break CM sessions.
  }
}

export function createDesktopCmSessionLayoutExportBundle(presets: DesktopCmSessionLayoutPreset[]) {
  return {
    schemaVersion: 1,
    kind: desktopCmSessionLayoutExportKind,
    exportedAt: Date.now(),
    items: normalizeDesktopCmSessionLayoutPresets(presets),
  };
}

export function downloadDesktopCmSessionLayoutBundle(presets: DesktopCmSessionLayoutPreset[], filePrefix: string) {
  const bundle = createDesktopCmSessionLayoutExportBundle(presets);
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filePrefix}-${new Date(bundle.exportedAt).toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

export function parseDesktopCmSessionLayoutImportBundle(value: unknown, sessions: DesktopCmSession[]) {
  const rawItems = readDesktopCmSessionLayoutImportItems(value);
  let skipped = Math.max(0, rawItems.length - maxDesktopCmSessionLayoutPresets);
  let invalid = 0;
  const seenNames = new Set<string>();
  const items: DesktopCmSessionLayoutPreset[] = [];

  for (const rawItem of rawItems.slice(0, maxDesktopCmSessionLayoutPresets)) {
    if (!rawItem || typeof rawItem !== 'object') {
      invalid += 1;
      continue;
    }
    const candidate = rawItem as Partial<DesktopCmSessionLayoutPreset>;
    const rawName = typeof candidate.name === 'string' ? candidate.name : '';
    if (!rawName.trim()) {
      invalid += 1;
      continue;
    }
    const name = normalizeDesktopCmSessionLayoutPresetName(rawName);
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      skipped += 1;
      continue;
    }
    const viewPreferences = pruneDesktopCmSessionViewPreferences(normalizeDesktopCmSessionViewPreferences(candidate.viewPreferences), sessions);
    if (viewPreferences.sessions.length === 0) {
      invalid += 1;
      continue;
    }
    seenNames.add(nameKey);
    items.push({
      name,
      folder: normalizeDesktopCmSessionLayoutFolderName(typeof candidate.folder === 'string' ? candidate.folder : defaultDesktopCmSessionLayoutFolder),
      viewPreferences,
      updatedAt: typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
    });
  }

  return { items, skipped, invalid };
}

export function normalizeDesktopCmSessionLayoutPresets(value: unknown): DesktopCmSessionLayoutPreset[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seenNames = new Set<string>();
  const presets: DesktopCmSessionLayoutPreset[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const candidate = item as Partial<DesktopCmSessionLayoutPreset>;
    if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
      continue;
    }
    const name = normalizeDesktopCmSessionLayoutPresetName(candidate.name);
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      continue;
    }
    seenNames.add(nameKey);
    presets.push({
      name,
      folder: normalizeDesktopCmSessionLayoutFolderName(typeof candidate.folder === 'string' ? candidate.folder : defaultDesktopCmSessionLayoutFolder),
      viewPreferences: normalizeDesktopCmSessionViewPreferences(candidate.viewPreferences),
      updatedAt: typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
    });
    if (presets.length >= maxDesktopCmSessionLayoutPresets) {
      break;
    }
  }
  return presets;
}

export function normalizeDesktopCmSessionLayoutPresetName(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, maxDesktopCmSessionLayoutPresetNameLength);
  return normalized || 'Session layout';
}

export function normalizeDesktopCmSessionLayoutFolderName(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, maxDesktopCmSessionLayoutFolderNameLength);
  return normalized || defaultDesktopCmSessionLayoutFolder;
}

export function buildDesktopCmSessionLayoutFolderFilterOptions(presets: DesktopCmSessionLayoutPreset[]): DesktopCmSessionLayoutFolderFilterOption[] {
  const counts = new Map<string, number>();
  for (const preset of presets) {
    const folder = normalizeDesktopCmSessionLayoutFolderName(preset.folder);
    counts.set(folder, (counts.get(folder) || 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => {
      if (left === defaultDesktopCmSessionLayoutFolder) return -1;
      if (right === defaultDesktopCmSessionLayoutFolder) return 1;
      return left.localeCompare(right);
    })
    .map(([folder, count]) => ({ folder, slug: slugifyTestId(folder), count }));
}

export function buildDesktopCmSessionLayoutFolders(
  allPresets: DesktopCmSessionLayoutPreset[],
  visiblePresets: DesktopCmSessionLayoutPreset[],
  collapsedFolders: Set<string>,
  options: { includeFolders?: string[] } = {},
): DesktopCmSessionLayoutFolder[] {
  const totalByFolder = new Map<string, number>();
  for (const preset of allPresets) {
    const folder = normalizeDesktopCmSessionLayoutFolderName(preset.folder);
    totalByFolder.set(folder, (totalByFolder.get(folder) || 0) + 1);
  }

  const folders = new Map<string, DesktopCmSessionLayoutFolder>();
  for (const includeFolder of options.includeFolders || []) {
    const folder = normalizeDesktopCmSessionLayoutFolderName(includeFolder);
    const totalCount = totalByFolder.get(folder) || 0;
    if (totalCount > 0 && !folders.has(folder)) {
      folders.set(folder, { folder, slug: slugifyTestId(folder), presets: [], totalCount, collapsed: collapsedFolders.has(folder) });
    }
  }
  for (const preset of visiblePresets) {
    const folder = normalizeDesktopCmSessionLayoutFolderName(preset.folder);
    if (!folders.has(folder)) {
      folders.set(folder, {
        folder,
        slug: slugifyTestId(folder),
        presets: [],
        totalCount: totalByFolder.get(folder) || 0,
        collapsed: collapsedFolders.has(folder),
      });
    }
    folders.get(folder)?.presets.push(preset);
  }
  return [...folders.values()];
}

export function desktopCmSessionLayoutFolderOrder(presets: DesktopCmSessionLayoutPreset[]) {
  const folderOrder: string[] = [];
  const seenFolders = new Set<string>();
  for (const preset of presets) {
    const folder = normalizeDesktopCmSessionLayoutFolderName(preset.folder);
    if (!seenFolders.has(folder)) {
      seenFolders.add(folder);
      folderOrder.push(folder);
    }
  }
  return folderOrder;
}

export function moveDesktopCmSessionLayoutFolderBefore(presets: DesktopCmSessionLayoutPreset[], sourceFolderName: string, targetFolderName: string) {
  const sourceFolder = normalizeDesktopCmSessionLayoutFolderName(sourceFolderName);
  const targetFolder = normalizeDesktopCmSessionLayoutFolderName(targetFolderName);
  if (sourceFolder === targetFolder) {
    return normalizeDesktopCmSessionLayoutPresets(presets);
  }
  const { folderOrder, grouped } = groupDesktopCmSessionLayoutPresetsByFolder(presets);
  if (!grouped.has(sourceFolder) || !grouped.has(targetFolder)) {
    return normalizeDesktopCmSessionLayoutPresets(presets);
  }
  const remainingFolders = folderOrder.filter((folder) => folder !== sourceFolder);
  const targetIndex = remainingFolders.indexOf(targetFolder);
  if (targetIndex < 0) {
    return normalizeDesktopCmSessionLayoutPresets(presets);
  }
  return flattenDesktopCmSessionLayoutPresetFolders(
    [...remainingFolders.slice(0, targetIndex), sourceFolder, ...remainingFolders.slice(targetIndex)],
    grouped,
  );
}

export function moveDesktopCmSessionLayoutFolderToIndex(presets: DesktopCmSessionLayoutPreset[], sourceFolderName: string, targetIndex: number) {
  const sourceFolder = normalizeDesktopCmSessionLayoutFolderName(sourceFolderName);
  const { folderOrder, grouped } = groupDesktopCmSessionLayoutPresetsByFolder(presets);
  if (!grouped.has(sourceFolder)) {
    return normalizeDesktopCmSessionLayoutPresets(presets);
  }
  const remainingFolders = folderOrder.filter((folder) => folder !== sourceFolder);
  const boundedTargetIndex = Math.max(0, Math.min(targetIndex, remainingFolders.length));
  return flattenDesktopCmSessionLayoutPresetFolders(
    [...remainingFolders.slice(0, boundedTargetIndex), sourceFolder, ...remainingFolders.slice(boundedTargetIndex)],
    grouped,
  );
}

export function moveDesktopCmSessionLayoutPresetBefore(presets: DesktopCmSessionLayoutPreset[], sourcePresetName: string, targetPresetName: string) {
  if (!sourcePresetName || sourcePresetName === targetPresetName) {
    return normalizeDesktopCmSessionLayoutPresets(presets);
  }
  const { folderOrder, grouped } = groupDesktopCmSessionLayoutPresetsByFolder(presets);
  const sourcePreset = presets.find((preset) => preset.name === sourcePresetName);
  const targetPreset = presets.find((preset) => preset.name === targetPresetName);
  if (!sourcePreset || !targetPreset) {
    return normalizeDesktopCmSessionLayoutPresets(presets);
  }
  const sourceFolder = normalizeDesktopCmSessionLayoutFolderName(sourcePreset.folder);
  const targetFolder = normalizeDesktopCmSessionLayoutFolderName(targetPreset.folder);
  if (sourceFolder !== targetFolder) {
    return normalizeDesktopCmSessionLayoutPresets(presets);
  }
  const folderPresets = grouped.get(sourceFolder) || [];
  const source = folderPresets.find((preset) => preset.name === sourcePresetName);
  const withoutSource = folderPresets.filter((preset) => preset.name !== sourcePresetName);
  const targetIndex = withoutSource.findIndex((preset) => preset.name === targetPresetName);
  if (!source || targetIndex < 0) {
    return normalizeDesktopCmSessionLayoutPresets(presets);
  }
  grouped.set(sourceFolder, [...withoutSource.slice(0, targetIndex), source, ...withoutSource.slice(targetIndex)]);
  return flattenDesktopCmSessionLayoutPresetFolders(folderOrder, grouped);
}

export function moveDesktopCmSessionLayoutPresetToIndex(presets: DesktopCmSessionLayoutPreset[], presetName: string, targetIndex: number) {
  const { folderOrder, grouped } = groupDesktopCmSessionLayoutPresetsByFolder(presets);
  const sourcePreset = presets.find((preset) => preset.name === presetName);
  if (!sourcePreset) {
    return normalizeDesktopCmSessionLayoutPresets(presets);
  }
  const folder = normalizeDesktopCmSessionLayoutFolderName(sourcePreset.folder);
  const folderPresets = grouped.get(folder) || [];
  const source = folderPresets.find((preset) => preset.name === presetName);
  if (!source) {
    return normalizeDesktopCmSessionLayoutPresets(presets);
  }
  const withoutSource = folderPresets.filter((preset) => preset.name !== presetName);
  const boundedTargetIndex = Math.max(0, Math.min(targetIndex, withoutSource.length));
  grouped.set(folder, [...withoutSource.slice(0, boundedTargetIndex), source, ...withoutSource.slice(boundedTargetIndex)]);
  return flattenDesktopCmSessionLayoutPresetFolders(folderOrder, grouped);
}

export function buildDesktopCmSessionLayoutImportName(baseName: string, existingNames: Set<string>) {
  const availableName = buildAvailableLayoutName(baseName, existingNames, ' import');
  return availableName || normalizeDesktopCmSessionLayoutPresetName(`Imported layout ${Date.now()}`);
}

export function buildDesktopCmSessionLayoutDuplicateName(baseName: string, existingNames: Set<string>) {
  const availableName = buildAvailableLayoutName(baseName, existingNames, ' copy');
  return availableName || normalizeDesktopCmSessionLayoutPresetName(`Layout copy ${Date.now().toString(36).slice(-6)}`);
}

export function desktopCmSessionLayoutEqual(left: DesktopCmSessionViewPreferences, right: DesktopCmSessionViewPreferences) {
  return JSON.stringify(normalizeDesktopCmSessionLayoutComparable(left)) === JSON.stringify(normalizeDesktopCmSessionLayoutComparable(right));
}

export function formatDesktopCmSessionLayoutSummary(preferences: DesktopCmSessionViewPreferences) {
  const normalized = normalizeDesktopCmSessionViewPreferences(preferences);
  const favoriteCount = normalized.sessions.filter((preference) => preference.favorite).length;
  const groupCount = new Set(normalized.sessions.map((preference) => preference.group)).size || 1;
  return `${normalized.sessions.length} sessions · ${groupCount} groups · ${favoriteCount} favorites`;
}

export function matchesDesktopCmSessionLayoutSearch(preset: DesktopCmSessionLayoutPreset, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }
  const normalized = normalizeDesktopCmSessionViewPreferences(preset.viewPreferences);
  const groups = [...new Set(normalized.sessions.map((preference) => preference.group))];
  const favoriteCount = normalized.sessions.filter((preference) => preference.favorite).length;
  return [
    preset.name,
    preset.folder,
    formatDesktopCmSessionLayoutSummary(normalized),
    `${normalized.sessions.length} sessions`,
    `${groups.length || 1} groups`,
    `${favoriteCount} favorites`,
    favoriteCount > 0 ? 'favorite favorites 즐겨찾기' : '',
    normalized.collapsedGroups.length > 0 ? 'collapsed 접힘' : '',
    ...groups,
    ...normalized.collapsedGroups,
  ].join(' ').toLowerCase().includes(normalizedQuery);
}

export function matchesDesktopCmSessionLayoutFolderFilter(preset: DesktopCmSessionLayoutPreset, folderFilter: string) {
  return folderFilter === 'all' || normalizeDesktopCmSessionLayoutFolderName(preset.folder) === normalizeDesktopCmSessionLayoutFolderName(folderFilter);
}

export function setsEqual(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function readDesktopCmSessionLayoutImportItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw new Error('desktop_cm_session_layout_import_invalid');
  }
  const candidate = value as { schemaVersion?: unknown; kind?: unknown; items?: unknown };
  if (candidate.kind !== undefined && candidate.kind !== desktopCmSessionLayoutExportKind) {
    throw new Error('desktop_cm_session_layout_import_invalid_kind');
  }
  if (candidate.schemaVersion !== undefined && candidate.schemaVersion !== 1) {
    throw new Error('desktop_cm_session_layout_import_invalid_version');
  }
  if (!Array.isArray(candidate.items)) {
    throw new Error('desktop_cm_session_layout_import_invalid_items');
  }
  return candidate.items;
}

function groupDesktopCmSessionLayoutPresetsByFolder(presets: DesktopCmSessionLayoutPreset[]) {
  const folderOrder: string[] = [];
  const grouped = new Map<string, DesktopCmSessionLayoutPreset[]>();
  for (const preset of presets) {
    const folder = normalizeDesktopCmSessionLayoutFolderName(preset.folder);
    if (!grouped.has(folder)) {
      grouped.set(folder, []);
      folderOrder.push(folder);
    }
    grouped.get(folder)?.push(preset);
  }
  return { folderOrder, grouped };
}

function flattenDesktopCmSessionLayoutPresetFolders(folderOrder: string[], grouped: Map<string, DesktopCmSessionLayoutPreset[]>) {
  return normalizeDesktopCmSessionLayoutPresets(folderOrder.flatMap((folder) => grouped.get(folder) || []));
}

function buildAvailableLayoutName(baseName: string, existingNames: Set<string>, suffixBase: string) {
  const normalizedBase = normalizeDesktopCmSessionLayoutPresetName(baseName);
  for (let index = 1; index <= maxDesktopCmSessionLayoutPresets + 1; index += 1) {
    const suffix = index === 1 ? suffixBase : `${suffixBase} ${index}`;
    const candidateBase = normalizedBase.slice(0, Math.max(1, maxDesktopCmSessionLayoutPresetNameLength - suffix.length)).trim();
    const candidateName = normalizeDesktopCmSessionLayoutPresetName(`${candidateBase}${suffix}`);
    if (!existingNames.has(candidateName.toLowerCase())) {
      return candidateName;
    }
  }
  return '';
}

function normalizeDesktopCmSessionLayoutComparable(preferences: DesktopCmSessionViewPreferences) {
  const normalized = normalizeDesktopCmSessionViewPreferences(preferences);
  return {
    sessions: normalized.sessions
      .map((preference) => ({ sessionId: preference.sessionId, group: preference.group, favorite: preference.favorite }))
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
    collapsedGroups: [...normalized.collapsedGroups].sort((left, right) => left.localeCompare(right)),
  };
}

function slugifyTestId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
}
