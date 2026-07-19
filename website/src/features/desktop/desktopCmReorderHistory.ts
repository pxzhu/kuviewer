export interface DesktopCmSessionLayoutReorderHistoryEntry {
  id: string;
  scope: 'folder' | 'preset' | 'focus' | 'system';
  message: string;
  createdAt: number;
}

export type DesktopCmSessionLayoutReorderHistoryScopeFilter = 'all' | DesktopCmSessionLayoutReorderHistoryEntry['scope'];
export type DesktopCmSessionLayoutReorderHistoryStatusFilter =
  | 'all'
  | 'reorder-complete'
  | 'reorder-unavailable'
  | 'reorder-unchanged'
  | 'focus-restored'
  | 'focus-unavailable';
export type DesktopCmSessionLayoutReorderHistoryDensity = 'comfortable' | 'compact';

export interface DesktopCmSessionLayoutReorderHistoryFilterPreset {
  id: string;
  label: string;
  scope: DesktopCmSessionLayoutReorderHistoryScopeFilter;
  status: DesktopCmSessionLayoutReorderHistoryStatusFilter;
  density: DesktopCmSessionLayoutReorderHistoryDensity;
}

export const maxDesktopCmSessionLayoutReorderHistoryEntries = 5;
export const desktopCmSessionLayoutReorderHistoryScopeFilterOptions: DesktopCmSessionLayoutReorderHistoryScopeFilter[] = [
  'all', 'folder', 'preset', 'focus', 'system',
];
export const desktopCmSessionLayoutReorderHistoryStatusFilterOptions: DesktopCmSessionLayoutReorderHistoryStatusFilter[] = [
  'all', 'reorder-complete', 'reorder-unavailable', 'reorder-unchanged', 'focus-restored', 'focus-unavailable',
];
export const desktopCmSessionLayoutReorderHistoryDensityOptions: DesktopCmSessionLayoutReorderHistoryDensity[] = ['comfortable', 'compact'];
export const desktopCmSessionLayoutReorderHistoryFilterPresets: DesktopCmSessionLayoutReorderHistoryFilterPreset[] = [
  { id: 'all-comfortable', label: 'All', scope: 'all', status: 'all', density: 'comfortable' },
  { id: 'complete-compact', label: 'Complete', scope: 'all', status: 'reorder-complete', density: 'compact' },
  { id: 'focus-compact', label: 'Focus', scope: 'focus', status: 'focus-restored', density: 'compact' },
  { id: 'blocked-compact', label: 'Blocked', scope: 'all', status: 'reorder-unavailable', density: 'compact' },
];
export const desktopCmSessionLayoutReorderHistoryFilterPresetIds = desktopCmSessionLayoutReorderHistoryFilterPresets.map((preset) => preset.id);
export const desktopCmSessionLayoutReorderHistoryFilterPresetShortcuts = 'ArrowLeft ArrowRight ArrowUp ArrowDown Home End Enter Space';

export function matchesDesktopCmSessionLayoutReorderHistoryScope(
  entry: DesktopCmSessionLayoutReorderHistoryEntry,
  scopeFilter: DesktopCmSessionLayoutReorderHistoryScopeFilter,
) {
  return scopeFilter === 'all' || entry.scope === scopeFilter;
}

export function matchesDesktopCmSessionLayoutReorderHistoryStatus(
  entry: DesktopCmSessionLayoutReorderHistoryEntry,
  statusFilter: DesktopCmSessionLayoutReorderHistoryStatusFilter,
) {
  if (statusFilter === 'all') {
    return true;
  }
  const message = entry.message.toLowerCase();
  const prefixes: Record<Exclude<DesktopCmSessionLayoutReorderHistoryStatusFilter, 'all'>, string> = {
    'reorder-complete': 'reorder complete:',
    'reorder-unavailable': 'reorder unavailable:',
    'reorder-unchanged': 'reorder unchanged:',
    'focus-restored': 'focus restored:',
    'focus-unavailable': 'focus target unavailable',
  };
  return message.startsWith(prefixes[statusFilter]);
}

export function formatDesktopCmSessionLayoutReorderHistoryScopeLabel(
  scope: DesktopCmSessionLayoutReorderHistoryEntry['scope'],
) {
  return scope === 'folder' ? 'Folder' : scope === 'preset' ? 'Preset' : scope === 'focus' ? 'Focus' : 'System';
}

export function formatDesktopCmSessionLayoutReorderHistoryAge(createdAt: number, now: number) {
  if (!Number.isFinite(createdAt) || !Number.isFinite(now)) {
    return 'timestamp unknown';
  }
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatDesktopCmSessionLayoutReorderHistoryExactTime(createdAt: number) {
  const date = safeDate(createdAt);
  if (!date) {
    return 'timestamp unknown';
  }
  return date.toLocaleString([], {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function formatDesktopCmSessionLayoutReorderHistoryIsoTime(createdAt: number) {
  return safeDate(createdAt)?.toISOString() || '';
}

export function isDesktopCmKeyboardIgnoredTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || ['input', 'textarea', 'select', 'button', 'label'].includes(tagName);
}

export function slugifyDesktopCmTestId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
}

function safeDate(value: number) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
