import type { ResourceEvent, ResourceExplorerItem } from '../../types/resourceExplorer';

export const resourceDetailDensityStorageKey = 'kuviewer_resource_detail_density';
export const logDensityStorageKey = 'kuviewer_log_density';
export const eventsAutoRefreshStorageKey = 'kuviewer_events_auto_refresh';
export const eventsWarningNotificationsStorageKey = 'kuviewer_events_warning_notifications';
export const eventsAutoRefreshIntervalMs = 30_000;
export const maxCollapsedRelations = 24;

export type DetailSectionId = 'metadata' | 'status' | 'safe' | 'yaml' | 'labels' | 'annotations' | 'relations' | 'events' | 'logs';
export type ResourceDetailDensity = 'comfortable' | 'compact';
export type LogDensity = 'comfortable' | 'compact';
export type EventSeverity = 'warning' | 'normal' | 'other';
export type EventSeverityFilter = 'all' | 'warning' | 'normal';
export type EventTimeRangeFilter = 'all' | '1h' | '6h' | '24h' | '7d';
export type LogTimeRangeFilter = EventTimeRangeFilter;
export type EventSortOrder = 'newest' | 'oldest';
export type EventExportFormat = 'csv' | 'json';
export type LogSortOrder = 'received' | 'newest' | 'oldest';

export const defaultOpenDetailSections: DetailSectionId[] = ['metadata', 'status', 'safe', 'relations', 'events'];
export const detailJumpSections: Array<{ id: DetailSectionId; label: string }> = [
  { id: 'metadata', label: 'Metadata' },
  { id: 'status', label: 'Status' },
  { id: 'safe', label: 'Safe Preview' },
  { id: 'relations', label: 'Relations' },
  { id: 'events', label: 'Events' },
  { id: 'logs', label: 'Logs' },
];
export const detailKeyboardSections: DetailSectionId[] = ['metadata', 'status', 'safe', 'yaml', 'labels', 'annotations', 'relations', 'events', 'logs'];
export const detailNavigatorSections: Array<{ id: DetailSectionId; label: string }> = [
  { id: 'metadata', label: 'Metadata' },
  { id: 'status', label: 'Status' },
  { id: 'safe', label: 'Safe Preview' },
  { id: 'yaml', label: 'YAML Preview' },
  { id: 'labels', label: 'Labels' },
  { id: 'annotations', label: 'Annotations' },
  { id: 'relations', label: 'Relations' },
  { id: 'events', label: 'Events' },
  { id: 'logs', label: 'Logs' },
];
export const eventTimeRangeOptions: Array<{ value: EventTimeRangeFilter; label: string; milliseconds?: number }> = [
  { value: 'all', label: '전체' },
  { value: '1h', label: '1h', milliseconds: 60 * 60 * 1000 },
  { value: '6h', label: '6h', milliseconds: 6 * 60 * 60 * 1000 },
  { value: '24h', label: '24h', milliseconds: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7d', milliseconds: 7 * 24 * 60 * 60 * 1000 },
];
export const logSortOptions: Array<{ value: LogSortOrder; label: string }> = [
  { value: 'received', label: '수신순' },
  { value: 'newest', label: '최신순' },
  { value: 'oldest', label: '오래된순' },
];

export interface RelationGroup {
  key: string;
  label: string;
  count: number;
  items: ResourceExplorerItem['related'];
}

export interface EventGroup {
  key: EventSeverity;
  label: string;
  count: number;
  items: EventListItem[];
}

export interface EventListItem {
  id: string;
  event: ResourceEvent;
  index: number;
  pinned: boolean;
}

export interface EventExportRow {
  timestamp: string;
  type: string;
  severity: EventSeverity;
  reason: string;
  source: string;
  message: string;
  pinned: boolean;
}

export interface EventNotificationNotice {
  count: number;
  reason: string;
  source: string;
  timestamp: string;
}

export interface ParsedLogLine {
  line: string;
  message: string;
  index: number;
  timestamp: string;
  timestampMs: number | null;
}

export interface LogSearchMatch {
  id: string;
  lineIndex: number;
  field: 'timestamp' | 'message';
  start: number;
  end: number;
}

export interface KeyValueEntry {
  key: string;
  valueText: string;
}

export interface KeyValueSearchMatch {
  id: string;
  entryIndex: number;
  field: 'key' | 'value';
  start: number;
  end: number;
}

export interface HealthSignal {
  label: string;
  value: string;
  helper: string;
  tone: 'default' | 'accent' | 'healthy' | 'warning' | 'error';
}

export interface DetailOverviewItem {
  label: string;
  value: string;
  helper: string;
  tone?: 'default' | 'accent' | 'warning' | 'error';
}

export type DetailSectionTone = 'default' | 'warning' | 'error';
