import type { Dispatch, SetStateAction } from 'react';
import type { ResourceEvent, ResourceExplorerItem } from '../../types/resourceExplorer';
import { safeCsvCell } from '../../features/export/safeCsv.ts';
import {
  eventTimeRangeOptions,
  eventsAutoRefreshStorageKey,
  eventsWarningNotificationsStorageKey,
  logDensityStorageKey,
  resourceDetailDensityStorageKey,
  type DetailSectionTone,
  type EventExportFormat,
  type EventExportRow,
  type EventGroup,
  type EventListItem,
  type EventNotificationNotice,
  type EventSeverity,
  type EventSeverityFilter,
  type EventSortOrder,
  type EventTimeRangeFilter,
  type KeyValueEntry,
  type KeyValueSearchMatch,
  type LogDensity,
  type LogSearchMatch,
  type LogSortOrder,
  type LogTimeRangeFilter,
  type ParsedLogLine,
  type RelationGroup,
  type ResourceDetailDensity,
} from './resourceDetailTypes.ts';

export function parseLogLines(lines: string[]): ParsedLogLine[] {
  return lines.map((line, index) => parseLogLine(line, index));
}

export function parseLogLine(line: string, index: number): ParsedLogLine {
  const parsed = parseLogTimestampPrefix(line);
  if (!parsed) {
    return { line, message: line, index, timestamp: '', timestampMs: null };
  }
  return {
    line,
    message: parsed.message,
    index,
    timestamp: parsed.timestamp,
    timestampMs: parsed.timestampMs,
  };
}

export function parseLogTimestampPrefix(line: string) {
  const leadingWhitespaceLength = line.length - line.trimStart().length;
  const trimmedLine = line.trimStart();
  const match = trimmedLine.match(/^\[?(\d{4}-\d{2}-\d{2}(?:T|\s+)\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)\]?/);
  if (!match) {
    return null;
  }
  const timestamp = match[1];
  const timestampMs = Date.parse(timestamp);
  if (Number.isNaN(timestampMs)) {
    return null;
  }
  const messageStart = leadingWhitespaceLength + match[0].length;
  return {
    timestamp,
    timestampMs,
    message: line.slice(messageStart).replace(/^\s*(?:[-|:])?\s*/, ''),
  };
}

export function filterLogLines(lines: ParsedLogLine[], filter: string, timeRangeFilter: LogTimeRangeFilter, nowMs: number) {
  const normalizedFilter = filter.trim().toLowerCase();
  return lines.filter((line) => {
    if (!logMatchesTimeRangeFilter(line, timeRangeFilter, nowMs)) {
      return false;
    }
    return !normalizedFilter || logLineText(line).includes(normalizedFilter);
  });
}

export function sortLogLines(lines: ParsedLogLine[], sortOrder: LogSortOrder) {
  if (sortOrder === 'received') {
    return lines;
  }
  return [...lines].sort((left, right) => {
    if (left.timestampMs === null && right.timestampMs !== null) {
      return 1;
    }
    if (left.timestampMs !== null && right.timestampMs === null) {
      return -1;
    }
    if (left.timestampMs === null && right.timestampMs === null) {
      return left.index - right.index;
    }
    if (left.timestampMs !== null && right.timestampMs !== null && left.timestampMs !== right.timestampMs) {
      return sortOrder === 'newest' ? right.timestampMs - left.timestampMs : left.timestampMs - right.timestampMs;
    }
    return left.index - right.index;
  });
}

export function logMatchesTimeRangeFilter(line: ParsedLogLine, timeRangeFilter: LogTimeRangeFilter, nowMs: number) {
  if (timeRangeFilter === 'all') {
    return true;
  }
  const option = eventTimeRangeOptions.find((candidate) => candidate.value === timeRangeFilter);
  if (!option?.milliseconds) {
    return true;
  }
  return line.timestampMs !== null && line.timestampMs >= nowMs - option.milliseconds;
}

export function logLineText(line: ParsedLogLine) {
  return [line.line, line.message, line.timestamp, line.timestamp ? formatLogTimestamp(line.timestamp) : ''].join(' ').toLowerCase();
}

export function collectLogSearchMatches(lines: ParsedLogLine[], filter: string): LogSearchMatch[] {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return [];
  }
  return lines.flatMap((line) => {
    const matches: LogSearchMatch[] = [];
    if (line.timestamp) {
      matches.push(...collectLogSearchMatchesForText(formatLogTimestamp(line.timestamp), normalizedFilter, line.index, 'timestamp'));
    }
    matches.push(...collectLogSearchMatchesForText(line.message || line.line || ' ', normalizedFilter, line.index, 'message'));
    return matches;
  });
}

export function collectLogSearchMatchesForText(text: string, normalizedFilter: string, lineIndex: number, field: LogSearchMatch['field']) {
  const lowerText = text.toLowerCase();
  const matches: LogSearchMatch[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(normalizedFilter, cursor);
  while (matchIndex >= 0) {
    const matchEnd = matchIndex + normalizedFilter.length;
    matches.push({
      id: `${lineIndex}:${field}:${matchIndex}:${matchEnd}`,
      lineIndex,
      field,
      start: matchIndex,
      end: matchEnd,
    });
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(normalizedFilter, cursor);
  }
  return matches;
}

export function logDownloadFileName(resource: ResourceExplorerItem, container: string, previousLogs: boolean) {
  const namespace = safeFileSlug(resource.namespace || 'cluster', 'cluster');
  const pod = safeFileSlug(resource.name, 'pod');
  const containerName = safeFileSlug(container || 'default', 'default');
  const mode = previousLogs ? 'previous' : 'current';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `kuviewer-logs-${namespace}-${pod}-${containerName}-${mode}-${timestamp}.log`;
}

export function eventExportFileName(resource: ResourceExplorerItem, format: EventExportFormat) {
  const namespace = safeFileSlug(resource.namespace || 'cluster', 'cluster');
  const kind = safeFileSlug(resource.kind, 'resource');
  const name = safeFileSlug(resource.name, 'resource');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `kuviewer-events-${namespace}-${kind}-${name}-${timestamp}.${format}`;
}

export function eventExportRows(items: EventListItem[]): EventExportRow[] {
  return items.map((item) => ({
    timestamp: item.event.timestamp,
    type: item.event.type,
    severity: eventSeverity(item.event),
    reason: item.event.reason,
    source: item.event.source,
    message: item.event.message,
    pinned: item.pinned,
  }));
}

export function eventExportCsv(items: EventListItem[]) {
  const header: Array<keyof EventExportRow> = ['timestamp', 'type', 'severity', 'reason', 'source', 'message', 'pinned'];
  const rows = eventExportRows(items).map((row) => header.map((key) => safeCsvCell(row[key])).join(','));
  return `${header.join(',')}\n${rows.join('\n')}\n`;
}

export function eventExportJson(items: EventListItem[]) {
  return `${JSON.stringify(eventExportRows(items), null, 2)}\n`;
}

export function downloadTextFile(content: string, mimeType: string, fileName: string) {
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

export function safeFileSlug(value: string, fallback: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

export function filterEvents(events: ResourceEvent[], filter: string, severityFilter: EventSeverityFilter, timeRangeFilter: EventTimeRangeFilter, nowMs: number) {
  const normalizedFilter = filter.trim().toLowerCase();
  return events.flatMap((event, index) => {
    if ((!normalizedFilter || eventText(event).includes(normalizedFilter)) && eventMatchesSeverityFilter(event, severityFilter) && eventMatchesTimeRangeFilter(event, timeRangeFilter, nowMs)) {
      return [
        {
          event,
          id: eventListItemId(event, index),
          index,
          pinned: false,
        },
      ];
    }
    return [];
  });
}

export function sortEventListItems(events: EventListItem[], sortOrder: EventSortOrder, pinnedEventKeys: Set<string>) {
  return events
    .map((item) => ({ ...item, pinned: pinnedEventKeys.has(item.id) }))
    .sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1;
      }
      const leftTime = sortableEventTimestamp(left.event);
      const rightTime = sortableEventTimestamp(right.event);
      if (leftTime === null && rightTime !== null) {
        return 1;
      }
      if (leftTime !== null && rightTime === null) {
        return -1;
      }
      if (leftTime === null && rightTime === null) {
        return left.index - right.index;
      }
      if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
        return sortOrder === 'newest' ? rightTime - leftTime : leftTime - rightTime;
      }
      return left.index - right.index;
    });
}

export function sortableEventTimestamp(event: ResourceEvent) {
  const value = Date.parse(event.timestamp);
  return Number.isNaN(value) ? null : value;
}

export function eventListItemId(event: ResourceEvent, index: number) {
  return `${eventIdentityKey(event)}\u001f${index}`;
}

export function eventIdentityKey(event: ResourceEvent) {
  return [event.timestamp, event.type, event.reason, event.source, event.message]
    .map((part) => part.trim())
    .join('\u001f');
}

export function updateEventNotificationState(
  nextEvents: ResourceEvent[],
  knownEventKeysRef: { current: Set<string> },
  knownEventKeysInitializedRef: { current: boolean },
  notificationsEnabled: boolean,
  setEventNotificationNotice: Dispatch<SetStateAction<EventNotificationNotice | null>>,
  setNewEventKeys: Dispatch<SetStateAction<Set<string>>>,
) {
  const nextKeys = new Set(nextEvents.map(eventIdentityKey));
  if (!knownEventKeysInitializedRef.current) {
    knownEventKeysRef.current = nextKeys;
    knownEventKeysInitializedRef.current = true;
    return;
  }

  const previousKeys = knownEventKeysRef.current;
  const newWarningEvents = nextEvents.filter((event) => !previousKeys.has(eventIdentityKey(event)) && eventSeverity(event) === 'warning');
  knownEventKeysRef.current = nextKeys;

  if (!notificationsEnabled || newWarningEvents.length === 0) {
    return;
  }

  const newWarningKeys = new Set(newWarningEvents.map(eventIdentityKey));
  setNewEventKeys((current) => {
    const next = new Set(current);
    for (const key of newWarningKeys) {
      next.add(key);
    }
    return next;
  });

  const representativeEvent = newWarningEvents[0];
  setEventNotificationNotice({
    count: newWarningEvents.length,
    reason: representativeEvent.reason || representativeEvent.type || 'Event',
    source: representativeEvent.source || 'source unknown',
    timestamp: representativeEvent.timestamp,
  });
}

export function eventMatchesSeverityFilter(event: ResourceEvent, severityFilter: EventSeverityFilter) {
  if (severityFilter === 'all') {
    return true;
  }
  return eventSeverity(event) === severityFilter;
}

export function eventMatchesTimeRangeFilter(event: ResourceEvent, timeRangeFilter: EventTimeRangeFilter, nowMs: number) {
  if (timeRangeFilter === 'all') {
    return true;
  }
  const option = eventTimeRangeOptions.find((candidate) => candidate.value === timeRangeFilter);
  if (!option?.milliseconds) {
    return true;
  }
  const eventMs = Date.parse(event.timestamp);
  if (Number.isNaN(eventMs)) {
    return false;
  }
  return eventMs >= nowMs - option.milliseconds;
}

export function eventSeverity(event: ResourceEvent): EventSeverity {
  const normalizedType = event.type.trim().toLowerCase();
  if (normalizedType === 'warning' || normalizedType === 'error') {
    return 'warning';
  }
  if (normalizedType === 'normal') {
    return 'normal';
  }
  return 'other';
}

export function countEventSeverities(events: ResourceEvent[]) {
  return events.reduce(
    (counts, event) => {
      counts[eventSeverity(event)] += 1;
      return counts;
    },
    { warning: 0, normal: 0, other: 0 } as Record<EventSeverity, number>,
  );
}

export function countNewEvents(events: ResourceEvent[], newEventKeys: Set<string>) {
  return events.reduce((count, event) => (newEventKeys.has(eventIdentityKey(event)) ? count + 1 : count), 0);
}

export function groupEventsBySeverity(events: EventListItem[]): EventGroup[] {
  const groups: Record<EventSeverity, EventGroup> = {
    warning: { key: 'warning', label: 'Warning / Error', count: 0, items: [] },
    normal: { key: 'normal', label: 'Normal', count: 0, items: [] },
    other: { key: 'other', label: 'Other', count: 0, items: [] },
  };
  for (const item of events) {
    const severity = eventSeverity(item.event);
    groups[severity].count += 1;
    groups[severity].items.push(item);
  }
  return (['warning', 'normal', 'other'] as const).map((severity) => groups[severity]).filter((group) => group.items.length > 0);
}

export function eventSeverityBadgeClassName(severity: EventSeverity) {
  if (severity === 'warning') {
    return 'rounded-full border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#9a5a00]';
  }
  if (severity === 'normal') {
    return 'rounded-full border border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.09)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#248a3d]';
  }
  return 'rounded-full border border-[rgba(142,142,147,0.22)] bg-[rgba(142,142,147,0.09)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#636366]';
}

export function eventSectionSummary(visibleCount: number, totalCount: number, counts: Record<EventSeverity, number>) {
  const base = `${visibleCount} / ${totalCount}`;
  if (counts.warning > 0) {
    return `${base} · ${counts.warning} warn`;
  }
  if (totalCount > 0 && counts.other > 0) {
    return `${base} · ${counts.other} other`;
  }
  return base;
}

export function eventControlSummary(filter: string, severityFilter: EventSeverityFilter, timeRangeFilter: EventTimeRangeFilter, sortOrder: EventSortOrder, pinnedCount: number, showNewOnly: boolean) {
  const parts = [
    filter.trim() ? `검색 "${filter.trim().slice(0, 48)}"` : '',
    severityFilter !== 'all' ? `type ${severityFilter}` : '',
    timeRangeFilter !== 'all' ? `최근 ${timeRangeFilter}` : '',
    sortOrder !== 'newest' ? '오래된순' : '',
    pinnedCount > 0 ? `고정 ${pinnedCount}` : '',
    showNewOnly ? '새 이벤트만' : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

export function eventText(event: ResourceEvent) {
  return [event.type, event.reason, event.message, event.source, event.timestamp, formatEventTimestamp(event.timestamp)].join(' ').toLowerCase();
}

export function filterRelatedResources(relations: ResourceExplorerItem['related'], filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return relations;
  }
  return relations.filter((relation) => relationText(relation).includes(normalizedFilter));
}

export function relationText(relation: ResourceExplorerItem['related'][number]) {
  return [
    relation.name,
    relation.kind,
    relation.namespace || '',
    relation.edgeType,
    relation.direction,
    relation.sourceField,
    relation.direction === 'outgoing' ? 'outgoing from' : 'incoming to',
    relation.direction === 'outgoing' ? '나가는 관계' : '들어오는 관계',
  ]
    .join(' ')
    .toLowerCase();
}

export function groupRelatedResources(relations: ResourceExplorerItem['related'], visibleLimit: number): RelationGroup[] {
  const groups = new Map<string, RelationGroup>();
  let visibleCount = 0;
  for (const relation of relations) {
    const key = `${relation.direction}:${relation.edgeType}`;
    const existingGroup = groups.get(key);
    const group =
      existingGroup ||
      ({
        key,
        label: `${relation.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} · ${relation.edgeType}`,
        count: 0,
        items: [],
      } satisfies RelationGroup);
    group.count += 1;
    if (visibleCount < visibleLimit) {
      group.items.push(relation);
      visibleCount += 1;
    }
    groups.set(key, group);
  }
  return Array.from(groups.values()).filter((group) => group.items.length > 0);
}

export function keyValueEntries(values: Record<string, unknown>): KeyValueEntry[] {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0))
    .map(([key, value]) => ({ key, valueText: formatValue(value) }));
}

export function collectKeyValueSearchMatches(entries: KeyValueEntry[], filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return [];
  }
  return entries.flatMap((entry, entryIndex) => [
    ...collectKeyValueSearchMatchesForText(entry.key, normalizedFilter, entryIndex, 'key'),
    ...collectKeyValueSearchMatchesForText(entry.valueText, normalizedFilter, entryIndex, 'value'),
  ]);
}

export function collectKeyValueSearchMatchesForText(text: string, normalizedFilter: string, entryIndex: number, field: KeyValueSearchMatch['field']) {
  const lowerText = text.toLowerCase();
  const matches: KeyValueSearchMatch[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(normalizedFilter, cursor);
  while (matchIndex >= 0) {
    const matchEnd = matchIndex + normalizedFilter.length;
    matches.push({
      id: `${entryIndex}:${field}:${matchIndex}:${matchEnd}`,
      entryIndex,
      field,
      start: matchIndex,
      end: matchEnd,
    });
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(normalizedFilter, cursor);
  }
  return matches;
}

export function keyValueEntryMatchesFilter(entry: KeyValueEntry, filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return true;
  }
  return entry.key.toLowerCase().includes(normalizedFilter) || entry.valueText.toLowerCase().includes(normalizedFilter);
}


export function readResourceDetailDensityPreference(): ResourceDetailDensity {
  try {
    return window.localStorage.getItem(resourceDetailDensityStorageKey) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

export function writeResourceDetailDensityPreference(density: ResourceDetailDensity) {
  try {
    window.localStorage.setItem(resourceDetailDensityStorageKey, density);
  } catch {
    // Detail density is only a UI preference; storage failures should not break details.
  }
}

export function readLogDensityPreference(): LogDensity {
  try {
    return window.localStorage.getItem(logDensityStorageKey) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

export function writeLogDensityPreference(density: LogDensity) {
  try {
    window.localStorage.setItem(logDensityStorageKey, density);
  } catch {
    // Density is only a UI preference; storage failures should not break logs.
  }
}

export function readEventsAutoRefreshPreference() {
  try {
    return window.localStorage.getItem(eventsAutoRefreshStorageKey) === 'true';
  } catch {
    return false;
  }
}

export function writeEventsAutoRefreshPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(eventsAutoRefreshStorageKey, enabled ? 'true' : 'false');
  } catch {
    // Events auto refresh is only a UI preference; storage failures should not break details.
  }
}

export function readEventsWarningNotificationsPreference() {
  try {
    return window.localStorage.getItem(eventsWarningNotificationsStorageKey) === 'true';
  } catch {
    return false;
  }
}

export function writeEventsWarningNotificationsPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(eventsWarningNotificationsStorageKey, enabled ? 'true' : 'false');
  } catch {
    // Events warning notifications are only a UI preference; storage failures should not break details.
  }
}

export function statusPillClassName(status: string) {
  if (status === 'healthy') {
    return 'shrink-0 rounded-full border border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#248a3d]';
  }
  if (status === 'warning') {
    return 'shrink-0 rounded-full border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#a05a00]';
  }
  if (status === 'error') {
    return 'shrink-0 rounded-full border border-[rgba(255,59,48,0.24)] bg-[rgba(255,59,48,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#c01f17]';
  }
  return 'shrink-0 rounded-full border border-[rgba(142,142,147,0.22)] bg-[rgba(142,142,147,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#636366]';
}

export function resourceDetailNavigatorItemClassName(active: boolean, open: boolean, tone: DetailSectionTone) {
  const base =
    'flex min-w-[154px] flex-col items-start gap-1 rounded-[10px] border px-2.5 py-2 text-left text-[11px] font-semibold transition md:min-w-0';
  if (active && tone === 'error') {
    return `${base} border-[rgba(255,59,48,0.32)] bg-[rgba(255,59,48,0.12)] text-[#b42318] shadow-sm`;
  }
  if (active && tone === 'warning') {
    return `${base} border-[rgba(255,149,0,0.32)] bg-[rgba(255,149,0,0.12)] text-[#9a5a00] shadow-sm`;
  }
  if (active) {
    return `${base} border-[rgba(0,122,255,0.26)] bg-[rgba(0,122,255,0.1)] text-[#0057b8] shadow-sm`;
  }
  if (tone === 'error') {
    return `${base} border-[rgba(255,59,48,0.22)] bg-[rgba(255,59,48,0.08)] text-[#b42318] hover:bg-[rgba(255,59,48,0.12)]`;
  }
  if (tone === 'warning') {
    return `${base} border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] text-[#8a4d00] hover:bg-[rgba(255,149,0,0.12)]`;
  }
  return `${base} ${
    open
      ? 'border-[rgba(52,199,89,0.18)] bg-white/80 text-[#1d1d1f] hover:bg-white'
      : 'border-[rgba(60,60,67,0.1)] bg-white/58 text-[rgba(60,60,67,0.68)] hover:bg-white'
  }`;
}

export function unique(values: string[]) {
  return Array.from(new Set(values)).sort();
}

export function recordText(values: Record<string, unknown>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(' ')
    .toLowerCase();
}

export function formatValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : '';
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function podLogContainerOptions(resource: ResourceExplorerItem) {
  const summary = recordFromUnknown(resource.preview.summary);
  const containers = asStringArray(summary.containerNames);
  const initContainers = asStringArray(summary.initContainers);
  return [
    ...containers.map((name) => ({ name, init: false })),
    ...initContainers.map((name) => ({ name, init: true })),
  ];
}

export function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function formatEventTimestamp(value: string) {
  if (!value) {
    return 'timestamp unknown';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function validEventTimestamp(value: string) {
  return Boolean(value) && !Number.isNaN(Date.parse(value));
}

export function formatRelativeEventTimestamp(value: string) {
  if (!validEventTimestamp(value)) {
    return 'timestamp unknown';
  }
  const elapsedMs = Math.max(0, Date.now() - Date.parse(value));
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
  return `${elapsedDays}일 전`;
}

export function formatRefreshTimestamp(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '시각 없음';
  }
  const elapsedMs = Math.max(0, Date.now() - value);
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
  return new Date(value).toISOString().slice(0, 10);
}

export function formatLogTimestamp(value: string) {
  return formatEventTimestamp(value);
}
