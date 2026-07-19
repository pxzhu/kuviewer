import {
  cmDiagnosticSeverityFilterOptions,
  cmDiagnosticStageFilterOptions,
  type CmDiagnosticSeverityFilter,
  type CmDiagnosticStageFilter,
} from './desktopCmSessionView.ts';

export interface DesktopCmDiagnosticFilterPreset {
  name: string;
  diagnosticStage: CmDiagnosticStageFilter;
  diagnosticSeverity: CmDiagnosticSeverityFilter;
  updatedAt: number;
}

interface PreferenceStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export const desktopCmDiagnosticFilterPresetStorageKey = 'kuviewer_desktop_cm_diagnostic_filter_presets';
export const maxDesktopCmDiagnosticFilterPresets = 8;
export const maxDesktopCmDiagnosticFilterPresetNameLength = 40;

export function readDesktopCmDiagnosticFilterPresets(storage = browserPreferenceStorage()): DesktopCmDiagnosticFilterPreset[] {
  if (!storage) {
    return [];
  }
  try {
    const rawValue = storage.getItem(desktopCmDiagnosticFilterPresetStorageKey);
    if (!rawValue) {
      return [];
    }
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      storage.removeItem(desktopCmDiagnosticFilterPresetStorageKey);
      return [];
    }
    return normalizeDesktopCmDiagnosticFilterPresets(parsedValue);
  } catch {
    storage.removeItem(desktopCmDiagnosticFilterPresetStorageKey);
    return [];
  }
}

export function writeDesktopCmDiagnosticFilterPresets(
  presets: DesktopCmDiagnosticFilterPreset[],
  storage = browserPreferenceStorage(),
) {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(
      desktopCmDiagnosticFilterPresetStorageKey,
      JSON.stringify(normalizeDesktopCmDiagnosticFilterPresets(presets)),
    );
  } catch {
    // These presets are optional UI preferences; storage failures must not affect sessions.
  }
}

export function normalizeDesktopCmDiagnosticFilterPresets(value: unknown[]): DesktopCmDiagnosticFilterPreset[] {
  const seenNames = new Set<string>();
  const presets: DesktopCmDiagnosticFilterPreset[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const candidate = item as Partial<DesktopCmDiagnosticFilterPreset>;
    const name = normalizeDesktopCmDiagnosticFilterPresetName(candidate.name || '');
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      continue;
    }
    seenNames.add(nameKey);
    presets.push({
      name,
      diagnosticStage: normalizeCmDiagnosticStageFilter(candidate.diagnosticStage),
      diagnosticSeverity: normalizeCmDiagnosticSeverityFilter(candidate.diagnosticSeverity),
      updatedAt: typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
    });
    if (presets.length >= maxDesktopCmDiagnosticFilterPresets) {
      break;
    }
  }
  return presets;
}

export function normalizeDesktopCmDiagnosticFilterPresetName(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, maxDesktopCmDiagnosticFilterPresetNameLength);
  return normalized || 'all stages · all severities';
}

function normalizeCmDiagnosticStageFilter(value: unknown): CmDiagnosticStageFilter {
  return typeof value === 'string' && cmDiagnosticStageFilterOptions.includes(value as CmDiagnosticStageFilter)
    ? value as CmDiagnosticStageFilter
    : 'all';
}

function normalizeCmDiagnosticSeverityFilter(value: unknown): CmDiagnosticSeverityFilter {
  return typeof value === 'string' && cmDiagnosticSeverityFilterOptions.includes(value as CmDiagnosticSeverityFilter)
    ? value as CmDiagnosticSeverityFilter
    : 'all';
}

function browserPreferenceStorage(): PreferenceStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}
