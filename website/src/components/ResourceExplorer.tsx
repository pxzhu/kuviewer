import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, SetStateAction } from 'react';
import { Activity, AlertTriangle, ArrowDown, ArrowUp, Bookmark, Boxes, CheckCircle2, ChevronDown, Copy, Download, FileText, Folder, FolderOpen, GitBranch, GripVertical, Link2, Pencil, RefreshCw, RotateCcw, Search, Tags, Trash2, Upload, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { fetchResourceEvents, fetchResourceLogs, fetchResourceViewPresets, fetchResources, resourcesFromSnapshot, saveResourceViewPresets, streamResourceLogs } from '../services/resourceApi';
import type { ResourceViewPresetApiMetadata } from '../services/resourceApi';
import type { ResourceEvent, ResourceExplorerItem } from '../types/resourceExplorer';
import type { TopologySnapshot } from '../types/topology';
import type { TopologySourceMode } from '../features/topology/useTopology';
import { appendResourceViewFilterSearchParams, resourceViewFiltersEqual, type ResourceViewFilters } from '../features/resources/resourceViewState';

interface ResourceExplorerProps {
  liveEnabled: boolean;
  resourceFilters: ResourceViewFilters;
  selectedNodeId: string;
  snapshot: TopologySnapshot;
  sourceMode: TopologySourceMode;
  onOpenTopologyNode: (nodeId: string) => void;
  onResourceFiltersChange: (filters: ResourceViewFilters) => void;
  onSelectNode: (nodeId: string) => void;
}

const allValue = 'all';
const resourceViewPresetStorageKey = 'kuviewer_resource_view_presets';
const resourceViewPresetCollapsedGroupsStorageKey = 'kuviewer_resource_view_collapsed_groups';
const resourceListDensityStorageKey = 'kuviewer_resource_list_density';
const resourceListSortStorageKey = 'kuviewer_resource_list_sort';
const resourceListColumnsStorageKey = 'kuviewer_resource_list_columns';
const resourceDetailDensityStorageKey = 'kuviewer_resource_detail_density';
const logDensityStorageKey = 'kuviewer_log_density';
const eventsAutoRefreshStorageKey = 'kuviewer_events_auto_refresh';
const eventsWarningNotificationsStorageKey = 'kuviewer_events_warning_notifications';
const eventsAutoRefreshIntervalMs = 30_000;
const maxResourceViewPresets = 8;
const defaultResourceViewGroup = 'General';
const maxResourceViewGroupLength = 40;
const maxCollapsedRelations = 24;
const defaultOpenDetailSections: DetailSectionId[] = ['metadata', 'status', 'safe', 'relations', 'events'];
type DetailSectionId = 'metadata' | 'status' | 'safe' | 'yaml' | 'labels' | 'annotations' | 'relations' | 'events' | 'logs';
type ResourceListDensity = 'comfortable' | 'compact';
type ResourceListSortField = 'name' | 'kind' | 'namespace' | 'status' | 'cluster';
type ResourceListSortDirection = 'asc' | 'desc';
type ResourceListOptionalColumn = 'namespace' | 'cluster' | 'age' | 'summary';
type ResourceDetailDensity = 'comfortable' | 'compact';
type LogDensity = 'comfortable' | 'compact';
type EventSeverity = 'warning' | 'normal' | 'other';
type EventSeverityFilter = 'all' | 'warning' | 'normal';
type EventTimeRangeFilter = 'all' | '1h' | '6h' | '24h' | '7d';
type LogTimeRangeFilter = EventTimeRangeFilter;
type EventSortOrder = 'newest' | 'oldest';
type EventExportFormat = 'csv' | 'json';
type LogSortOrder = 'received' | 'newest' | 'oldest';

const detailJumpSections: Array<{ id: DetailSectionId; label: string }> = [
  { id: 'metadata', label: 'Metadata' },
  { id: 'status', label: 'Status' },
  { id: 'safe', label: 'Safe Preview' },
  { id: 'relations', label: 'Relations' },
  { id: 'events', label: 'Events' },
  { id: 'logs', label: 'Logs' },
];
const detailKeyboardSections: DetailSectionId[] = ['metadata', 'status', 'safe', 'yaml', 'labels', 'annotations', 'relations', 'events', 'logs'];
const detailNavigatorSections: Array<{ id: DetailSectionId; label: string }> = [
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
const eventTimeRangeOptions: Array<{ value: EventTimeRangeFilter; label: string; milliseconds?: number }> = [
  { value: 'all', label: '전체' },
  { value: '1h', label: '1h', milliseconds: 60 * 60 * 1000 },
  { value: '6h', label: '6h', milliseconds: 6 * 60 * 60 * 1000 },
  { value: '24h', label: '24h', milliseconds: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7d', milliseconds: 7 * 24 * 60 * 60 * 1000 },
];
const logSortOptions: Array<{ value: LogSortOrder; label: string }> = [
  { value: 'received', label: '수신순' },
  { value: 'newest', label: '최신순' },
  { value: 'oldest', label: '오래된순' },
];
const resourceListSortOptions: Array<{ value: ResourceListSortField; label: string }> = [
  { value: 'kind', label: 'Kind' },
  { value: 'name', label: '이름' },
  { value: 'namespace', label: 'Namespace' },
  { value: 'status', label: 'Status' },
  { value: 'cluster', label: 'Cluster' },
];
const defaultResourceListSortPreference: ResourceListSortPreference = { field: 'kind', direction: 'asc' };
const resourceListOptionalColumns: Array<{ key: ResourceListOptionalColumn; label: string }> = [
  { key: 'namespace', label: 'Namespace' },
  { key: 'cluster', label: 'Cluster' },
  { key: 'age', label: 'Age' },
  { key: 'summary', label: 'Summary' },
];
const defaultResourceListColumns: ResourceListColumnPreference = {
  namespace: true,
  cluster: false,
  age: true,
  summary: true,
};

interface ResourceViewPreset extends ResourceViewFilters {
  name: string;
  group: string;
  order: number;
  updatedAt: number;
}

interface ActiveResourceFilterChip {
  id: keyof ResourceViewFilters;
  label: string;
  value: string;
  testId: string;
}

interface ResourceViewMessage {
  tone: 'success' | 'warning';
  text: string;
}

interface ResourceViewTransferSummary {
  action: 'export' | 'import';
  scope: 'all' | 'selected' | 'incoming';
  fileName: string;
  count: number;
  skippedCount: number;
  folders: string[];
  format?: 'array' | 'items';
}

interface ResourceViewTeamSyncSummary {
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

interface ResourceViewTeamComparePreview {
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

interface ResourceViewTeamSnapshotMetadata {
  version: number;
  updatedAt: number;
  count: number;
  storage: string;
}

interface ResourceViewRenameState {
  originalName: string;
  draftName: string;
  error: string;
}

type ResourceViewConflictSource = 'import' | 'team';
type ResourceViewConflictResolution = 'incoming' | 'current' | 'rename';

interface ResourceListSortPreference {
  field: ResourceListSortField;
  direction: ResourceListSortDirection;
}

type ResourceListColumnPreference = Record<ResourceListOptionalColumn, boolean>;

interface ResourceViewConflictItem {
  name: string;
  existing: ResourceViewPreset;
  incoming: ResourceViewPreset;
}

interface ResourceViewConflictState {
  source: ResourceViewConflictSource;
  basePresets: ResourceViewPreset[];
  incomingPresets: ResourceViewPreset[];
  conflicts: ResourceViewConflictItem[];
  duplicateCount: number;
  invalidCount: number;
  incomingCount: number;
}

interface ResourceViewMergeResult {
  presets: ResourceViewPreset[];
  conflicts: ResourceViewConflictItem[];
  duplicateCount: number;
  incomingCount: number;
  droppedCount: number;
}

interface RelationGroup {
  key: string;
  label: string;
  count: number;
  items: ResourceExplorerItem['related'];
}

interface EventGroup {
  key: EventSeverity;
  label: string;
  count: number;
  items: EventListItem[];
}

interface EventListItem {
  id: string;
  event: ResourceEvent;
  index: number;
  pinned: boolean;
}

interface EventExportRow {
  timestamp: string;
  type: string;
  severity: EventSeverity;
  reason: string;
  source: string;
  message: string;
  pinned: boolean;
}

interface ResourceBulkExportRow {
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

interface EventNotificationNotice {
  count: number;
  reason: string;
  source: string;
  timestamp: string;
}

interface ParsedLogLine {
  line: string;
  message: string;
  index: number;
  timestamp: string;
  timestampMs: number | null;
}

interface LogSearchMatch {
  id: string;
  lineIndex: number;
  field: 'timestamp' | 'message';
  start: number;
  end: number;
}

interface KeyValueEntry {
  key: string;
  valueText: string;
}

interface KeyValueSearchMatch {
  id: string;
  entryIndex: number;
  field: 'key' | 'value';
  start: number;
  end: number;
}

interface HealthSignal {
  label: string;
  value: string;
  helper: string;
  tone: 'default' | 'accent' | 'healthy' | 'warning' | 'error';
}

interface DetailOverviewItem {
  label: string;
  value: string;
  helper: string;
  tone?: 'default' | 'accent' | 'warning' | 'error';
}

type DetailSectionTone = 'default' | 'warning' | 'error';

export function ResourceExplorer({
  liveEnabled,
  resourceFilters,
  selectedNodeId,
  snapshot,
  sourceMode,
  onOpenTopologyNode,
  onResourceFiltersChange,
  onSelectNode,
}: ResourceExplorerProps) {
  const resourceFiltersPropRef = useRef<ResourceViewFilters>(resourceFilters);
  const applyingResourceFiltersRef = useRef(false);
  const [query, setQuery] = useState(resourceFilters.query);
  const [cluster, setCluster] = useState(resourceFilters.cluster);
  const [namespace, setNamespace] = useState(resourceFilters.namespace);
  const [kind, setKind] = useState(resourceFilters.kind);
  const [status, setStatus] = useState(resourceFilters.status);
  const [resources, setResources] = useState<ResourceExplorerItem[]>(() => resourcesFromSnapshot(snapshot).items);
  const [liveResourceApiReady, setLiveResourceApiReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewPresets, setViewPresets] = useState<ResourceViewPreset[]>(() => readResourceViewPresets());
  const [presetName, setPresetName] = useState('');
  const [presetGroup, setPresetGroup] = useState(defaultResourceViewGroup);
  const [viewPresetSearch, setViewPresetSearch] = useState('');
  const [draggingViewPresetName, setDraggingViewPresetName] = useState('');
  const [selectedViewPresetNames, setSelectedViewPresetNames] = useState<Set<string>>(() => new Set());
  const [bulkViewPresetGroup, setBulkViewPresetGroup] = useState(defaultResourceViewGroup);
  const [bulkViewPresetDeleteConfirm, setBulkViewPresetDeleteConfirm] = useState(false);
  const [collapsedViewGroups, setCollapsedViewGroups] = useState<Set<string>>(() => readCollapsedResourceViewGroups());
  const [resourceViewMessage, setResourceViewMessage] = useState<ResourceViewMessage | null>(null);
  const [resourceViewTransferSummary, setResourceViewTransferSummary] = useState<ResourceViewTransferSummary | null>(null);
  const [resourceViewTeamSyncSummary, setResourceViewTeamSyncSummary] = useState<ResourceViewTeamSyncSummary | null>(null);
  const [resourceViewTeamComparePreview, setResourceViewTeamComparePreview] = useState<ResourceViewTeamComparePreview | null>(null);
  const [resourceViewConflict, setResourceViewConflict] = useState<ResourceViewConflictState | null>(null);
  const [renamingViewPreset, setRenamingViewPreset] = useState<ResourceViewRenameState | null>(null);
  const [resourceViewTeamLoading, setResourceViewTeamLoading] = useState(false);
  const [resourceViewTeamSaveConfirm, setResourceViewTeamSaveConfirm] = useState(false);
  const [detailFocusRequest, setDetailFocusRequest] = useState(0);
  const [resourceListDensity, setResourceListDensity] = useState<ResourceListDensity>(() => readResourceListDensityPreference());
  const [resourceListSort, setResourceListSort] = useState<ResourceListSortPreference>(() => readResourceListSortPreference());
  const [resourceListColumns, setResourceListColumns] = useState<ResourceListColumnPreference>(() => readResourceListColumnPreference());
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(() => new Set());
  const [resourceBulkMessage, setResourceBulkMessage] = useState<ResourceViewMessage | null>(null);
  const resourceSelectionAnchorRef = useRef<string | null>(null);
  const resourceRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const viewPresetImportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sourceMode !== 'live' || !liveEnabled) {
      setResources(resourcesFromSnapshot(snapshot).items);
      setLiveResourceApiReady(false);
      setLoading(false);
      setError('');
      return;
    }

    const controller = new AbortController();
    setLiveResourceApiReady(false);
    setLoading(true);
    setError('');
    fetchResources(controller.signal)
      .then((list) => {
        setResources(list.items);
        setLiveResourceApiReady(true);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : 'resources_request_failed');
          setResources(resourcesFromSnapshot(snapshot).items);
          setLiveResourceApiReady(false);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [liveEnabled, snapshot, sourceMode]);

  const clusters = useMemo(() => unique(resources.map((resource) => resource.clusterId)), [resources]);
  const namespaces = useMemo(() => unique(resources.map((resource) => resource.namespace).filter(Boolean) as string[]), [resources]);
  const kinds = useMemo(() => unique(resources.map((resource) => resource.kind)), [resources]);
  const statuses = useMemo(() => unique(resources.map((resource) => resource.status)), [resources]);
  const suggestedPresetName = useMemo(() => suggestedResourceViewPresetName({ query, cluster, namespace, kind, status }), [cluster, kind, namespace, query, status]);
  const currentPresetFilters = useMemo(() => ({ query, cluster, namespace, kind, status }), [cluster, kind, namespace, query, status]);
  const matchingViewPreset = useMemo(() => viewPresets.find((preset) => resourceViewPresetMatchesFilters(preset, currentPresetFilters)), [currentPresetFilters, viewPresets]);
  const nextPresetName = resourceViewPresetTargetName(presetName, matchingViewPreset?.name || suggestedPresetName);
  const nextPresetGroup = normalizeResourceViewPresetGroup(presetGroup || matchingViewPreset?.group || defaultResourceViewGroup);
  const presetNameExists = viewPresets.some((preset) => preset.name === nextPresetName);
  const groupedViewPresets = useMemo(() => groupResourceViewPresets(viewPresets), [viewPresets]);
  const normalizedViewPresetSearch = viewPresetSearch.trim().toLowerCase();
  const canReorderViewPresets = normalizedViewPresetSearch.length === 0;
  const filteredGroupedViewPresets = useMemo(() => filterGroupedResourceViewPresets(groupedViewPresets, normalizedViewPresetSearch), [groupedViewPresets, normalizedViewPresetSearch]);
  const visibleViewPresets = useMemo(() => filteredGroupedViewPresets.flatMap((group) => group.presets), [filteredGroupedViewPresets]);
  const selectedViewPresets = useMemo(() => orderResourceViewPresets(viewPresets.filter((preset) => selectedViewPresetNames.has(preset.name))), [selectedViewPresetNames, viewPresets]);
  const selectedViewPresetCount = selectedViewPresets.length;
  const allVisibleViewPresetsSelected = visibleViewPresets.length > 0 && visibleViewPresets.every((preset) => selectedViewPresetNames.has(preset.name));
  const visibleViewPresetFolderCount = filteredGroupedViewPresets.length;
  const collapsedVisibleViewPresetFolderCount = filteredGroupedViewPresets.filter((group) => collapsedViewGroups.has(group.name)).length;
  const selectedVisibleViewPresetCount = visibleViewPresets.filter((preset) => selectedViewPresetNames.has(preset.name)).length;
  const viewPresetGroupOptions = useMemo(() => unique([defaultResourceViewGroup, ...viewPresets.map((preset) => preset.group)]), [viewPresets]);
  const filtersAreDefault = resourceViewPresetMatchesFilters(
    {
      name: 'default',
      query: '',
      cluster: allValue,
      namespace: allValue,
      kind: allValue,
      status: allValue,
      order: 1,
      group: defaultResourceViewGroup,
      updatedAt: 0,
    },
    currentPresetFilters,
  );
  const activeResourceFilterChips = useMemo<ActiveResourceFilterChip[]>(() => {
    const trimmedQuery = query.trim();
    return [
      trimmedQuery ? { id: 'query', label: 'Search', value: trimmedQuery, testId: 'resource-active-filter-query' } : null,
      cluster !== allValue ? { id: 'cluster', label: 'Cluster', value: cluster, testId: 'resource-active-filter-cluster' } : null,
      namespace !== allValue ? { id: 'namespace', label: 'Namespace', value: namespace, testId: 'resource-active-filter-namespace' } : null,
      kind !== allValue ? { id: 'kind', label: 'Kind', value: kind, testId: 'resource-active-filter-kind' } : null,
      status !== allValue ? { id: 'status', label: 'Status', value: status, testId: 'resource-active-filter-status' } : null,
    ].filter((chip): chip is ActiveResourceFilterChip => chip !== null);
  }, [cluster, kind, namespace, query, status]);
  const savePresetLabel = matchingViewPreset || presetNameExists ? '뷰 업데이트' : '뷰 저장';
  const teamResourceViewsEnabled = sourceMode === 'live' && liveEnabled;
  const filteredResources = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
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
        (cluster === allValue || resource.clusterId === cluster) &&
        (namespace === allValue || resource.namespace === namespace || (resource.kind === 'Namespace' && resource.name === namespace)) &&
        (kind === allValue || resource.kind === kind) &&
        (status === allValue || resource.status === status)
      );
    });
  }, [cluster, kind, namespace, query, resources, status]);
  const sortedResources = useMemo(() => sortResourceList(filteredResources, resourceListSort), [filteredResources, resourceListSort]);
  const selectedResource = sortedResources.find((resource) => resource.id === selectedNodeId) || sortedResources[0];
  const selectedResourceIndex = selectedResource ? sortedResources.findIndex((resource) => resource.id === selectedResource.id) : -1;
  const selectedResources = useMemo(() => sortedResources.filter((resource) => selectedResourceIds.has(resource.id)), [selectedResourceIds, sortedResources]);
  const selectedResourceCount = selectedResources.length;
  const allFilteredResourcesSelected = sortedResources.length > 0 && selectedResourceCount === sortedResources.length;

  useEffect(() => {
    if (resourceViewFiltersEqual(resourceFiltersPropRef.current, resourceFilters)) {
      return;
    }
    resourceFiltersPropRef.current = resourceFilters;
    applyingResourceFiltersRef.current = true;
    setQuery(resourceFilters.query);
    setCluster(resourceFilters.cluster);
    setNamespace(resourceFilters.namespace);
    setKind(resourceFilters.kind);
    setStatus(resourceFilters.status);
    setPresetName('');
    onSelectNode('');
  }, [onSelectNode, resourceFilters]);

  useEffect(() => {
    if (applyingResourceFiltersRef.current) {
      applyingResourceFiltersRef.current = false;
      return;
    }
    resourceFiltersPropRef.current = currentPresetFilters;
    onResourceFiltersChange(currentPresetFilters);
  }, [currentPresetFilters, onResourceFiltersChange]);

  useEffect(() => {
    if (selectedResource && selectedNodeId !== selectedResource.id) {
      onSelectNode(selectedResource.id);
    } else if (!selectedResource && selectedNodeId) {
      onSelectNode('');
    }
  }, [onSelectNode, selectedNodeId, selectedResource]);

  useEffect(() => {
    const visibleResourceIds = new Set(sortedResources.map((resource) => resource.id));
    setSelectedResourceIds((current) => {
      const next = new Set([...current].filter((resourceId) => visibleResourceIds.has(resourceId)));
      return next.size === current.size ? current : next;
    });
    if (resourceSelectionAnchorRef.current && !visibleResourceIds.has(resourceSelectionAnchorRef.current)) {
      resourceSelectionAnchorRef.current = selectedResource && visibleResourceIds.has(selectedResource.id) ? selectedResource.id : sortedResources[0]?.id ?? null;
    }
  }, [selectedResource, sortedResources]);

  useEffect(() => {
    writeResourceListDensityPreference(resourceListDensity);
  }, [resourceListDensity]);

  useEffect(() => {
    writeResourceListSortPreference(resourceListSort);
  }, [resourceListSort]);

  useEffect(() => {
    writeResourceListColumnPreference(resourceListColumns);
  }, [resourceListColumns]);

  useEffect(() => {
    writeCollapsedResourceViewGroups(collapsedViewGroups);
  }, [collapsedViewGroups]);

  useEffect(() => {
    const existingPresetNames = new Set(viewPresets.map((preset) => preset.name));
    setSelectedViewPresetNames((current) => {
      const next = new Set([...current].filter((presetName) => existingPresetNames.has(presetName)));
      return next.size === current.size ? current : next;
    });
    setBulkViewPresetDeleteConfirm(false);
  }, [viewPresets]);

  useEffect(() => {
    if (resources.length === 0) {
      return;
    }
    setCluster((current) => normalizePresetFilterValue(current, clusters));
    setNamespace((current) => normalizePresetFilterValue(current, namespaces));
    setKind((current) => normalizePresetFilterValue(current, kinds));
    setStatus((current) => normalizePresetFilterValue(current, statuses));
  }, [clusters, kinds, namespaces, resources.length, statuses]);

  useEffect(() => {
    setResourceViewTeamSaveConfirm(false);
    setResourceViewTeamComparePreview(null);
  }, [sourceMode, viewPresets]);

  const handleSaveViewPreset = () => {
    setResourceViewConflict(null);
    setRenamingViewPreset(null);
    const existingPreset = viewPresets.find((preset) => preset.name === nextPresetName);
    const nextPreset: ResourceViewPreset = {
      name: nextPresetName,
      group: nextPresetGroup,
      query: query.slice(0, 160),
      cluster,
      namespace,
      kind,
      status,
      order: existingPreset?.order ?? resourceViewPresetTopOrderForGroup(viewPresets, nextPresetGroup),
      updatedAt: Date.now(),
    };
    const nextPresets = upsertResourceViewPreset(viewPresets, nextPreset);
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setPresetName(nextPreset.name);
    setPresetGroup(nextPreset.group);
  };

  const handleApplyViewPreset = (preset: ResourceViewPreset) => {
    setRenamingViewPreset(null);
    setQuery(preset.query);
    setCluster(normalizePresetFilterValue(preset.cluster, clusters));
    setNamespace(normalizePresetFilterValue(preset.namespace, namespaces));
    setKind(normalizePresetFilterValue(preset.kind, kinds));
    setStatus(normalizePresetFilterValue(preset.status, statuses));
    setPresetName(preset.name);
    setPresetGroup(preset.group);
    onSelectNode('');
  };

  const handleDeleteViewPreset = (presetNameToDelete: string) => {
    setResourceViewConflict(null);
    setRenamingViewPreset(null);
    const nextPresets = normalizeResourceViewPresetOrders(viewPresets.filter((preset) => preset.name !== presetNameToDelete));
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setSelectedViewPresetNames((current) => {
      if (!current.has(presetNameToDelete)) {
        return current;
      }
      const next = new Set(current);
      next.delete(presetNameToDelete);
      return next;
    });
    setBulkViewPresetDeleteConfirm(false);
    if (presetName.trim() === presetNameToDelete) {
      setPresetName('');
    }
  };

  const handleCopyResourceViewLink = async () => {
    const url = resourceViewShareUrl(currentPresetFilters, sourceMode);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard_unavailable');
      }
      await navigator.clipboard.writeText(url);
      setResourceViewMessage({ tone: 'success', text: '공유 링크를 클립보드에 복사했습니다.' });
    } catch {
      setResourceViewMessage({ tone: 'warning', text: '클립보드 복사가 지원되지 않아 공유 링크를 복사하지 못했습니다.' });
    }
  };

  const handleExportViewPresets = () => {
    const exportPresets = normalizeResourceViewPresetOrders(viewPresets);
    const fileName = resourceViewExportFileName('all');
    const payload = `${JSON.stringify(exportPresets.map(resourceViewPresetExportRecord), null, 2)}\n`;
    downloadTextFile(payload, 'application/json;charset=utf-8', fileName);
    setResourceViewTransferSummary({
      action: 'export',
      scope: 'all',
      fileName,
      count: exportPresets.length,
      skippedCount: 0,
      folders: resourceViewPresetFolderNames(exportPresets),
    });
    setResourceViewMessage({ tone: 'success', text: `저장된 뷰 ${exportPresets.length}개를 ${fileName} 파일로 내보냈습니다.` });
  };
  const handleExportSelectedViewPresets = () => {
    if (selectedViewPresetCount === 0) {
      return;
    }
    const exportPresets = normalizeResourceViewPresetOrders(selectedViewPresets);
    const fileName = resourceViewExportFileName('selected');
    const payload = `${JSON.stringify(exportPresets.map(resourceViewPresetExportRecord), null, 2)}\n`;
    downloadTextFile(payload, 'application/json;charset=utf-8', fileName);
    setResourceViewTransferSummary({
      action: 'export',
      scope: 'selected',
      fileName,
      count: exportPresets.length,
      skippedCount: 0,
      folders: resourceViewPresetFolderNames(exportPresets),
    });
    setBulkViewPresetDeleteConfirm(false);
    setResourceViewMessage({ tone: 'success', text: `선택한 saved view ${exportPresets.length}개를 ${fileName} 파일로 내보냈습니다.` });
  };

  const handleImportViewPresets = async (file?: File) => {
    if (!file) {
      return;
    }
    try {
      const parsedValue = JSON.parse(await file.text());
      const parsedImport = resourceViewImportItems(parsedValue);
      if (!parsedImport) {
        setResourceViewConflict(null);
        setRenamingViewPreset(null);
        setResourceViewTransferSummary(null);
        setResourceViewMessage({ tone: 'warning', text: '가져오기 실패: saved view JSON 배열 또는 { items } 형식이 아닙니다.' });
        return;
      }
      const importedPresets = normalizeResourceViewPresetOrders(parsedImport.items.flatMap((value, index) => validResourceViewPreset(value, index + 1)));
      const skippedCount = Math.max(0, parsedImport.items.length - importedPresets.length);
      if (importedPresets.length === 0) {
        setResourceViewConflict(null);
        setRenamingViewPreset(null);
        setResourceViewTransferSummary({
          action: 'import',
          scope: 'incoming',
          fileName: file.name || 'resource-views.json',
          count: 0,
          skippedCount,
          folders: [],
          format: parsedImport.format,
        });
        setResourceViewMessage({ tone: 'warning', text: `가져오기 실패: 유효한 saved view가 없습니다. ${parsedImport.items.length}개 항목을 건너뛰었습니다.` });
        return;
      }
      setResourceViewTransferSummary({
        action: 'import',
        scope: 'incoming',
        fileName: file.name || 'resource-views.json',
        count: importedPresets.length,
        skippedCount,
        folders: resourceViewPresetFolderNames(importedPresets),
        format: parsedImport.format,
      });
      handleIncomingResourceViewPresets('import', importedPresets, skippedCount);
    } catch {
      setResourceViewConflict(null);
      setRenamingViewPreset(null);
      setResourceViewTransferSummary(null);
      setResourceViewMessage({ tone: 'warning', text: '가져오기 실패: JSON 파일을 읽을 수 없습니다.' });
    }
  };

  const handleLoadTeamViewPresets = async () => {
    if (!teamResourceViewsEnabled) {
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰는 Live Cluster 연결과 admin token이 활성화된 상태에서 사용할 수 있습니다.' });
      return;
    }
    setResourceViewTeamSaveConfirm(false);
    setResourceViewTeamLoading(true);
    try {
      const response = await fetchResourceViewPresets();
      const teamPresets = normalizeResourceViewPresetOrders(response.items.flatMap((value, index) => validResourceViewPreset(value, index + 1)));
      const skippedCount = Math.max(0, response.items.length - teamPresets.length);
      const snapshotMetadata = resourceViewTeamSnapshotMetadata(response.metadata, teamPresets.length);
      const comparePreview = buildResourceViewTeamComparePreview('load', viewPresets, teamPresets, skippedCount, snapshotMetadata);
      setResourceViewTransferSummary(null);
      setResourceViewTeamSyncSummary(null);
      setResourceViewConflict(null);
      setRenamingViewPreset(null);
      setResourceViewTeamComparePreview(comparePreview);
      setResourceViewMessage({
        tone: comparePreview.conflictNames.length > 0 || comparePreview.invalidCount > 0 || comparePreview.mergeResult.droppedCount > 0 ? 'warning' : 'success',
        text: resourceViewTeamCompareMessage(comparePreview),
      });
    } catch {
      setResourceViewConflict(null);
      setRenamingViewPreset(null);
      setResourceViewTeamSyncSummary(null);
      setResourceViewTeamComparePreview(null);
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰를 불러오지 못했습니다. admin token 또는 서버 상태를 확인하세요.' });
    } finally {
      setResourceViewTeamLoading(false);
    }
  };

  const handleSaveTeamViewPresets = async () => {
    if (!teamResourceViewsEnabled) {
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰는 Live Cluster 연결과 admin token이 활성화된 상태에서 사용할 수 있습니다.' });
      return;
    }
    if (resourceViewTeamComparePreview?.action === 'save' && resourceViewTeamSaveConfirm) {
      await handleConfirmTeamSavePreview();
      return;
    }
    if (!resourceViewTeamSaveConfirm) {
      await handlePrepareTeamSavePreview();
      return;
    }
    await handleConfirmTeamSavePreview();
  };

  const handlePrepareTeamSavePreview = async () => {
    if (!teamResourceViewsEnabled) {
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰는 Live Cluster 연결과 admin token이 활성화된 상태에서 사용할 수 있습니다.' });
      return;
    }
    setResourceViewTeamLoading(true);
    try {
      const response = await fetchResourceViewPresets();
      const teamPresets = normalizeResourceViewPresetOrders(response.items.flatMap((value, index) => validResourceViewPreset(value, index + 1)));
      const skippedCount = Math.max(0, response.items.length - teamPresets.length);
      const snapshotMetadata = resourceViewTeamSnapshotMetadata(response.metadata, teamPresets.length);
      const comparePreview = buildResourceViewTeamComparePreview('save', viewPresets, teamPresets, skippedCount, snapshotMetadata);
      setResourceViewConflict(null);
      setRenamingViewPreset(null);
      setResourceViewTransferSummary(null);
      setResourceViewTeamSyncSummary(null);
      setResourceViewTeamComparePreview(comparePreview);
      setResourceViewTeamSaveConfirm(true);
      setResourceViewMessage({
        tone: comparePreview.conflictNames.length > 0 || comparePreview.teamOnlyNames.length > 0 || comparePreview.invalidCount > 0 ? 'warning' : 'success',
        text: `${resourceViewTeamCompareMessage(comparePreview)} 저장 실행 전 한 번 더 확인하세요.`,
      });
    } catch {
      setResourceViewTeamSaveConfirm(false);
      setResourceViewTeamComparePreview(null);
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰 비교 미리보기를 불러오지 못했습니다. admin token 또는 서버 상태를 확인하세요.' });
    } finally {
      setResourceViewTeamLoading(false);
    }
  };

  const handleConfirmTeamSavePreview = async () => {
    if (!teamResourceViewsEnabled) {
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰는 Live Cluster 연결과 admin token이 활성화된 상태에서 사용할 수 있습니다.' });
      return;
    }
    setResourceViewTeamLoading(true);
    try {
      setResourceViewConflict(null);
      setRenamingViewPreset(null);
      setResourceViewTeamSaveConfirm(false);
      const response = await saveResourceViewPresets(normalizeResourceViewPresetOrders(viewPresets).map(resourceViewPresetExportRecord));
      const savedPresets = normalizeResourceViewPresetOrders(response.items.flatMap((value, index) => validResourceViewPreset(value, index + 1)));
      const skippedCount = Math.max(0, viewPresets.length - savedPresets.length);
      const snapshotMetadata = resourceViewTeamSnapshotMetadata(response.metadata, savedPresets.length);
      setViewPresets(savedPresets);
      writeResourceViewPresets(savedPresets);
      setResourceViewTransferSummary(null);
      setResourceViewTeamSyncSummary({
        action: 'save',
        count: savedPresets.length,
        skippedCount,
        conflictCount: 0,
        duplicateCount: 0,
        newCount: 0,
        localCount: viewPresets.length,
        folders: resourceViewPresetFolderNames(savedPresets),
        timestamp: Date.now(),
        snapshotMetadata,
      });
      setResourceViewTeamComparePreview(null);
      setResourceViewMessage({ tone: 'success', text: `현재 브라우저 뷰 ${savedPresets.length}개를 팀 뷰로 저장했습니다.` });
    } catch {
      setResourceViewTeamSyncSummary(null);
      setResourceViewTeamComparePreview(null);
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰를 저장하지 못했습니다. admin token 또는 서버 상태를 확인하세요.' });
    } finally {
      setResourceViewTeamLoading(false);
    }
  };

  const handleApplyTeamLoadPreview = () => {
    if (!resourceViewTeamComparePreview || resourceViewTeamComparePreview.action !== 'load') {
      return;
    }
    setResourceViewTeamSyncSummary(resourceViewTeamSyncSummaryFromCompare(resourceViewTeamComparePreview));
    setResourceViewTeamComparePreview(null);
    handleIncomingResourceViewPresets('team', resourceViewTeamComparePreview.incomingPresets, resourceViewTeamComparePreview.invalidCount);
  };

  const handleDismissTeamComparePreview = () => {
    setResourceViewTeamComparePreview(null);
    setResourceViewTeamSaveConfirm(false);
  };

  const handleResetResourceFilters = () => {
    setRenamingViewPreset(null);
    setQuery('');
    setCluster(allValue);
    setNamespace(allValue);
    setKind(allValue);
    setStatus(allValue);
    setPresetName('');
    setPresetGroup(defaultResourceViewGroup);
    setResourceViewMessage(null);
    onSelectNode('');
  };
  const handleClearActiveResourceFilter = (filterId: keyof ResourceViewFilters) => {
    setRenamingViewPreset(null);
    setResourceViewMessage(null);
    if (filterId === 'query') {
      setQuery('');
    } else if (filterId === 'cluster') {
      setCluster(allValue);
    } else if (filterId === 'namespace') {
      setNamespace(allValue);
    } else if (filterId === 'kind') {
      setKind(allValue);
    } else if (filterId === 'status') {
      setStatus(allValue);
    }
  };
  const handleIncomingResourceViewPresets = (source: ResourceViewConflictSource, incomingPresets: ResourceViewPreset[], invalidCount: number) => {
    setRenamingViewPreset(null);
    const mergeResult = mergeResourceViewPresets(viewPresets, incomingPresets, 'incoming');
    if (mergeResult.conflicts.length > 0) {
      setResourceViewConflict({
        source,
        basePresets: viewPresets,
        incomingPresets,
        conflicts: mergeResult.conflicts,
        duplicateCount: mergeResult.duplicateCount,
        invalidCount,
        incomingCount: incomingPresets.length,
      });
      setResourceViewMessage({
        tone: 'warning',
        text: resourceViewConflictPendingMessage(source, mergeResult.conflicts.length, mergeResult.duplicateCount, invalidCount),
      });
      return;
    }
    applyResourceViewMergeResult(source, mergeResult, invalidCount, false);
  };
  const handleResolveResourceViewConflicts = (resolution: ResourceViewConflictResolution) => {
    if (!resourceViewConflict) {
      return;
    }
    const mergeResult = mergeResourceViewPresets(resourceViewConflict.basePresets, resourceViewConflict.incomingPresets, resolution);
    applyResourceViewMergeResult(resourceViewConflict.source, mergeResult, resourceViewConflict.invalidCount, true);
  };
  const applyResourceViewMergeResult = (source: ResourceViewConflictSource, mergeResult: ResourceViewMergeResult, invalidCount: number, resolved: boolean) => {
    setViewPresets(mergeResult.presets);
    writeResourceViewPresets(mergeResult.presets);
    setResourceViewConflict(null);
    setRenamingViewPreset(null);
    setResourceViewMessage({
      tone: mergeResult.conflicts.length > 0 || invalidCount > 0 || mergeResult.droppedCount > 0 ? 'warning' : 'success',
      text: resourceViewMergeMessage(source, mergeResult, invalidCount, resolved),
    });
  };
  const handleToggleViewPresetSelection = (presetNameToToggle: string, selected: boolean) => {
    setSelectedViewPresetNames((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(presetNameToToggle);
      } else {
        next.delete(presetNameToToggle);
      }
      return next;
    });
    setBulkViewPresetDeleteConfirm(false);
  };
  const handleSetVisibleViewPresetSelection = (selected: boolean) => {
    setSelectedViewPresetNames((current) => {
      const next = new Set(current);
      visibleViewPresets.forEach((preset) => {
        if (selected) {
          next.add(preset.name);
        } else {
          next.delete(preset.name);
        }
      });
      return next;
    });
    setBulkViewPresetDeleteConfirm(false);
    setResourceViewMessage(selected ? { tone: 'success', text: `현재 결과 saved view ${visibleViewPresets.length}개를 선택했습니다.` } : null);
  };
  const handleSetGroupViewPresetSelection = (presets: ResourceViewPreset[], selected: boolean) => {
    setSelectedViewPresetNames((current) => {
      const next = new Set(current);
      presets.forEach((preset) => {
        if (selected) {
          next.add(preset.name);
        } else {
          next.delete(preset.name);
        }
      });
      return next;
    });
    setBulkViewPresetDeleteConfirm(false);
  };
  const handleClearViewPresetSelection = () => {
    setSelectedViewPresetNames(new Set());
    setBulkViewPresetDeleteConfirm(false);
  };
  const handleBulkMoveViewPresets = () => {
    if (selectedViewPresetCount === 0) {
      return;
    }
    const targetGroup = normalizeResourceViewPresetGroup(bulkViewPresetGroup);
    const nextPresets = moveResourceViewPresetsToGroup(viewPresets, selectedViewPresetNames, targetGroup);
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setBulkViewPresetGroup(targetGroup);
    setBulkViewPresetDeleteConfirm(false);
    setResourceViewConflict(null);
    setRenamingViewPreset(null);
    if (matchingViewPreset && selectedViewPresetNames.has(matchingViewPreset.name)) {
      setPresetGroup(targetGroup);
    }
    setResourceViewMessage({ tone: 'success', text: `선택한 saved view ${selectedViewPresetCount}개를 ${targetGroup} 그룹으로 이동했습니다.` });
  };
  const handleBulkDeleteViewPresets = () => {
    if (selectedViewPresetCount === 0) {
      return;
    }
    if (!bulkViewPresetDeleteConfirm) {
      setBulkViewPresetDeleteConfirm(true);
      setResourceViewMessage({ tone: 'warning', text: `선택한 saved view ${selectedViewPresetCount}개를 삭제하려면 한 번 더 누르세요.` });
      return;
    }
    const selectedNames = new Set(selectedViewPresets.map((preset) => preset.name));
    const nextPresets = normalizeResourceViewPresetOrders(viewPresets.filter((preset) => !selectedNames.has(preset.name)));
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setSelectedViewPresetNames(new Set());
    setBulkViewPresetDeleteConfirm(false);
    setResourceViewConflict(null);
    setRenamingViewPreset(null);
    if (selectedNames.has(presetName.trim()) || (matchingViewPreset && selectedNames.has(matchingViewPreset.name))) {
      setPresetName('');
      setPresetGroup(defaultResourceViewGroup);
    }
    setResourceViewMessage({ tone: 'success', text: `선택한 saved view ${selectedNames.size}개를 삭제했습니다.` });
  };
  const handleStartResourceViewRename = (preset: ResourceViewPreset) => {
    setResourceViewConflict(null);
    setResourceViewMessage(null);
    setRenamingViewPreset({ originalName: preset.name, draftName: preset.name, error: '' });
  };
  const handleCancelResourceViewRename = () => {
    setRenamingViewPreset(null);
  };
  const handleCommitResourceViewRename = () => {
    if (!renamingViewPreset) {
      return;
    }
    const targetName = normalizeResourceViewPresetName(renamingViewPreset.draftName);
    if (!targetName) {
      setRenamingViewPreset((current) => current && current.originalName === renamingViewPreset.originalName ? { ...current, error: '이름을 입력하세요.' } : current);
      return;
    }
    if (targetName === renamingViewPreset.originalName) {
      setRenamingViewPreset(null);
      setResourceViewMessage({ tone: 'success', text: 'saved view 이름이 변경되지 않았습니다.' });
      return;
    }
    if (viewPresets.some((preset) => preset.name === targetName && preset.name !== renamingViewPreset.originalName)) {
      setRenamingViewPreset((current) => current && current.originalName === renamingViewPreset.originalName ? { ...current, error: '이미 같은 이름의 saved view가 있습니다.' } : current);
      return;
    }
    let renamed = false;
    const nextPresets = viewPresets.map((preset) => {
      if (preset.name !== renamingViewPreset.originalName) {
        return preset;
      }
      renamed = true;
      return { ...preset, name: targetName, updatedAt: Date.now() };
    });
    if (!renamed) {
      setRenamingViewPreset(null);
      setResourceViewMessage({ tone: 'warning', text: '이름을 변경할 saved view를 찾을 수 없습니다.' });
      return;
    }
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setRenamingViewPreset(null);
    if (presetName.trim() === renamingViewPreset.originalName || matchingViewPreset?.name === renamingViewPreset.originalName) {
      setPresetName(targetName);
    }
    setResourceViewMessage({ tone: 'success', text: `saved view 이름을 "${targetName}"으로 변경했습니다.` });
  };
  const handleUpdateViewPresetGroup = (preset: ResourceViewPreset, groupValue: string) => {
    const targetGroup = normalizeResourceViewPresetGroup(groupValue);
    if (targetGroup === preset.group) {
      return;
    }
    const nextPresets = normalizeResourceViewPresetOrders(viewPresets.map((candidate) => candidate.name === preset.name ? { ...candidate, group: targetGroup, order: resourceViewPresetTopOrderForGroup(viewPresets, targetGroup), updatedAt: Date.now() } : candidate));
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    if (presetName.trim() === preset.name || matchingViewPreset?.name === preset.name) {
      setPresetGroup(targetGroup);
    }
    setResourceViewMessage({ tone: 'success', text: `"${preset.name}" 뷰를 ${targetGroup} 그룹으로 이동했습니다.` });
  };
  const handleMoveViewPreset = (preset: ResourceViewPreset, direction: -1 | 1) => {
    if (!canReorderViewPresets) {
      return;
    }
    const groupName = normalizeResourceViewPresetGroup(preset.group);
    const groupPresets = orderResourceViewPresets(viewPresets.filter((candidate) => normalizeResourceViewPresetGroup(candidate.group) === groupName));
    const currentIndex = groupPresets.findIndex((candidate) => candidate.name === preset.name);
    const targetPreset = groupPresets[currentIndex + direction];
    if (currentIndex < 0 || !targetPreset) {
      return;
    }
    const nextPresets = normalizeResourceViewPresetOrders(viewPresets.map((candidate) => {
      if (candidate.name === preset.name) {
        return { ...candidate, order: targetPreset.order };
      }
      if (candidate.name === targetPreset.name) {
        return { ...candidate, order: preset.order };
      }
      return candidate;
    }));
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setResourceViewMessage({ tone: 'success', text: `"${preset.name}" 뷰 순서를 변경했습니다.` });
  };
  const handleDropViewPreset = (targetPreset: ResourceViewPreset, event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!canReorderViewPresets) {
      setDraggingViewPresetName('');
      return;
    }
    const sourceName = event.dataTransfer.getData('text/plain') || draggingViewPresetName;
    const sourcePreset = viewPresets.find((preset) => preset.name === sourceName);
    if (!sourcePreset || sourcePreset.name === targetPreset.name || normalizeResourceViewPresetGroup(sourcePreset.group) !== normalizeResourceViewPresetGroup(targetPreset.group)) {
      setDraggingViewPresetName('');
      return;
    }
    const groupName = normalizeResourceViewPresetGroup(targetPreset.group);
    const groupPresets = orderResourceViewPresets(viewPresets.filter((candidate) => normalizeResourceViewPresetGroup(candidate.group) === groupName && candidate.name !== sourcePreset.name));
    const targetIndex = Math.max(0, groupPresets.findIndex((candidate) => candidate.name === targetPreset.name));
    const reorderedGroup = [...groupPresets.slice(0, targetIndex), sourcePreset, ...groupPresets.slice(targetIndex)];
    const orderByName = new Map(reorderedGroup.map((candidate, index) => [candidate.name, index + 1]));
    const nextPresets = normalizeResourceViewPresetOrders(viewPresets.map((candidate) => orderByName.has(candidate.name) ? { ...candidate, order: orderByName.get(candidate.name) ?? candidate.order } : candidate));
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setDraggingViewPresetName('');
    setResourceViewMessage({ tone: 'success', text: `"${sourcePreset.name}" 뷰 순서를 변경했습니다.` });
  };
  const toggleViewPresetGroup = (groupName: string) => {
    setCollapsedViewGroups((current) => {
      const next = new Set(current);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };
  const handleExpandVisibleViewPresetFolders = () => {
    const visibleGroupNames = new Set(filteredGroupedViewPresets.map((group) => group.name));
    setCollapsedViewGroups((current) => {
      const next = new Set([...current].filter((groupName) => !visibleGroupNames.has(groupName)));
      return next;
    });
    setResourceViewMessage({ tone: 'success', text: `saved view folder ${visibleGroupNames.size}개를 펼쳤습니다.` });
  };
  const handleCollapseVisibleViewPresetFolders = () => {
    setCollapsedViewGroups((current) => {
      const next = new Set(current);
      filteredGroupedViewPresets.forEach((group) => next.add(group.name));
      return next;
    });
    setResourceViewMessage({ tone: 'success', text: `saved view folder ${filteredGroupedViewPresets.length}개를 접었습니다.` });
  };
  const handleResourceViewRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleCommitResourceViewRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelResourceViewRename();
    }
  };
  const handleToggleResourceSelection = (resourceId: string, selected: boolean) => {
    resourceSelectionAnchorRef.current = resourceId;
    setSelectedResourceIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(resourceId);
      } else {
        next.delete(resourceId);
      }
      return next;
    });
    setResourceBulkMessage(null);
  };
  const handleSelectFilteredResources = () => {
    if (sortedResources.length === 0) {
      return;
    }
    setSelectedResourceIds(new Set(sortedResources.map((resource) => resource.id)));
    resourceSelectionAnchorRef.current = selectedResource?.id ?? sortedResources[0]?.id ?? null;
    setResourceBulkMessage({ tone: 'success', text: `현재 필터 결과 ${sortedResources.length}개를 선택했습니다.` });
  };
  const handleClearResourceSelection = () => {
    setSelectedResourceIds(new Set());
    resourceSelectionAnchorRef.current = selectedResource?.id ?? sortedResources[0]?.id ?? null;
    setResourceBulkMessage(null);
  };
  const handleCopySelectedResourceNames = async () => {
    if (selectedResources.length === 0) {
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard_unavailable');
      }
      await navigator.clipboard.writeText(`${selectedResources.map(resourceBulkCopyName).join('\n')}\n`);
      setResourceBulkMessage({ tone: 'success', text: `선택한 리소스 ${selectedResources.length}개 이름을 복사했습니다.` });
    } catch {
      setResourceBulkMessage({ tone: 'warning', text: '클립보드 복사가 지원되지 않아 이름을 복사하지 못했습니다.' });
    }
  };
  const handleExportSelectedResources = (format: 'json' | 'csv') => {
    if (selectedResources.length === 0) {
      return;
    }
    const content = format === 'json' ? resourceBulkExportJson(selectedResources) : resourceBulkExportCsv(selectedResources);
    const mimeType = format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8';
    downloadTextFile(content, mimeType, resourceBulkExportFileName(format));
    setResourceBulkMessage({ tone: 'success', text: `선택한 리소스 ${selectedResources.length}개를 ${format.toUpperCase()}로 내보냈습니다.` });
  };
  const resourceSummaryLimit = resourceListDensity === 'compact' ? 2 : 3;
  const visibleOptionalColumnCount = resourceListOptionalColumns.filter((column) => resourceListColumns[column.key]).length;
  const toggleResourceListColumn = (column: ResourceListOptionalColumn) => {
    setResourceListColumns((current) => ({ ...current, [column]: !current[column] }));
  };
  const resourceRowClassName = (resource: ResourceExplorerItem) =>
    `${resourceListDensity === 'compact' ? 'mb-1.5 rounded-[10px] px-2 py-2' : 'mb-2 rounded-[12px] p-3'} w-full cursor-pointer border text-left transition focus:outline-none focus:ring-2 focus:ring-[rgba(0,122,255,0.22)] ${
      resource.id === selectedResource?.id
        ? 'border-[rgba(0,122,255,0.36)] bg-[rgba(0,122,255,0.1)] shadow-[0_0_0_1px_rgba(0,122,255,0.08)]'
        : selectedResourceIds.has(resource.id)
          ? 'border-[rgba(52,199,89,0.24)] bg-[rgba(52,199,89,0.08)] hover:bg-[rgba(52,199,89,0.11)]'
        : 'border-[rgba(60,60,67,0.12)] bg-white/78 hover:bg-white'
    }`;
  const resourceGridClassName =
    resourceListDensity === 'compact'
      ? 'grid gap-1.5 md:[grid-template-columns:var(--resource-list-columns)] md:items-center'
      : 'grid gap-2 md:[grid-template-columns:var(--resource-list-columns)] md:items-center';
  const resourceHeaderGridClassName = `${resourceGridClassName} rounded-[10px] border border-[rgba(60,60,67,0.08)] bg-[rgba(242,242,247,0.66)] px-3 py-2`;
  const resourceGridStyle = { '--resource-list-columns': resourceListGridTemplate(resourceListColumns) } as CSSProperties;
  const resourceNameClassName = resourceListDensity === 'compact' ? 'truncate text-xs font-semibold text-[#1d1d1f]' : 'truncate text-sm font-semibold text-[#1d1d1f]';
  const resourceMetaClassName =
    resourceListDensity === 'compact'
      ? 'mt-0.5 truncate font-mono text-[9px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]'
      : 'mt-0.5 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]';
  const resourceColumnLabelClassName = 'ku-meta md:hidden';
  const resourceColumnValueClassName =
    resourceListDensity === 'compact'
      ? 'min-w-0 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.72)]'
      : 'min-w-0 truncate font-mono text-[11px] font-semibold text-[rgba(60,60,67,0.72)]';
  const resourceSummaryContainerClassName = resourceListDensity === 'compact' ? 'mt-1 flex flex-wrap gap-1' : 'mt-2 flex flex-wrap gap-1.5';
  const resourceSummaryChipClassName =
    resourceListDensity === 'compact'
      ? 'rounded-full bg-[rgba(242,242,247,0.78)] px-1.5 py-0 font-mono text-[9px] font-semibold text-[rgba(60,60,67,0.72)]'
      : 'rounded-full bg-[rgba(242,242,247,0.78)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.72)]';
  const focusResourceRow = (resourceId: string) => {
    window.requestAnimationFrame(() => {
      resourceRowRefs.current[resourceId]?.focus({ preventScroll: true });
    });
  };
  const handleSelectResource = (resourceId: string) => {
    resourceSelectionAnchorRef.current = resourceId;
    onSelectNode(resourceId);
  };
  const selectResourceRange = (anchorResourceId: string, targetResourceId: string) => {
    const targetIndex = sortedResources.findIndex((resource) => resource.id === targetResourceId);
    if (targetIndex < 0) {
      return;
    }
    const anchorIndex = sortedResources.findIndex((resource) => resource.id === anchorResourceId);
    const normalizedAnchorIndex = anchorIndex >= 0 ? anchorIndex : selectedResourceIndex >= 0 ? selectedResourceIndex : targetIndex;
    const startIndex = Math.min(normalizedAnchorIndex, targetIndex);
    const endIndex = Math.max(normalizedAnchorIndex, targetIndex);
    const rangeResourceIds = sortedResources.slice(startIndex, endIndex + 1).map((resource) => resource.id);
    setSelectedResourceIds((current) => {
      const next = new Set(current);
      rangeResourceIds.forEach((resourceId) => next.add(resourceId));
      return next;
    });
    resourceSelectionAnchorRef.current = sortedResources[normalizedAnchorIndex]?.id ?? targetResourceId;
    setResourceBulkMessage(null);
    onSelectNode(targetResourceId);
    focusResourceRow(targetResourceId);
  };
  const selectResourceAtIndex = (index: number, rangeSelection = false) => {
    if (sortedResources.length === 0) {
      return;
    }
    const nextIndex = Math.max(0, Math.min(sortedResources.length - 1, index));
    const nextResource = sortedResources[nextIndex];
    if (rangeSelection) {
      selectResourceRange(resourceSelectionAnchorRef.current ?? selectedResource?.id ?? nextResource.id, nextResource.id);
      return;
    }
    resourceSelectionAnchorRef.current = nextResource.id;
    onSelectNode(nextResource.id);
    focusResourceRow(nextResource.id);
  };
  const handleResourceListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const shortcutTarget = isResourceListShortcutTarget(event.target);

    if (!shortcutTarget && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      handleSelectFilteredResources();
      return;
    }

    if (!shortcutTarget && event.key === 'Escape' && (selectedResourceCount > 0 || resourceBulkMessage)) {
      event.preventDefault();
      handleClearResourceSelection();
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey || shortcutTarget) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectResourceAtIndex(selectedResourceIndex >= 0 ? selectedResourceIndex + 1 : 0, event.shiftKey);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectResourceAtIndex(selectedResourceIndex >= 0 ? selectedResourceIndex - 1 : sortedResources.length - 1, event.shiftKey);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectResourceAtIndex(0, event.shiftKey);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectResourceAtIndex(sortedResources.length - 1, event.shiftKey);
    } else if (event.key === 'Enter' && selectedResource) {
      event.preventDefault();
      setDetailFocusRequest((request) => request + 1);
    } else if ((event.key === ' ' || event.key === 'Spacebar') && selectedResource) {
      event.preventDefault();
      handleToggleResourceSelection(selectedResource.id, !selectedResourceIds.has(selectedResource.id));
    }
  };

  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
      <div className="ku-panel overflow-hidden">
        <div className="border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[#1d1d1f]">리소스 탐색</h2>
              <p className="ku-meta mt-1">읽기 전용 Kubernetes 리소스 목록 · Secret value 숨김</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <label className="grid min-w-[116px] gap-1">
                <span className="ku-meta">정렬</span>
                <select
                  className="ku-select h-8 text-xs"
                  value={resourceListSort.field}
                  data-testid="resource-list-sort-field"
                  onChange={(event) => setResourceListSort((current) => ({ ...current, field: event.target.value as ResourceListSortField }))}
                >
                  {resourceListSortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-1">
                <span className="ku-meta">방향</span>
                <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="리소스 목록 정렬 방향">
                  {([
                    { value: 'asc', label: '오름차순', icon: ArrowUp },
                    { value: 'desc', label: '내림차순', icon: ArrowDown },
                  ] as const).map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                          resourceListSort.direction === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                        }`}
                        data-testid={`resource-list-sort-${option.value}`}
                        type="button"
                        onClick={() => setResourceListSort((current) => ({ ...current, direction: option.value }))}
                        aria-pressed={resourceListSort.direction === option.value}
                        aria-label={`리소스 목록 ${option.label} 정렬`}
                        title={`리소스 목록 ${option.label} 정렬`}
                      >
                        <Icon size={13} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="리소스 목록 밀도">
                {([
                  { value: 'comfortable', label: '기본' },
                  { value: 'compact', label: '촘촘' },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                      resourceListDensity === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                    }`}
                    data-testid={`resource-list-density-${option.value}`}
                    type="button"
                    onClick={() => setResourceListDensity(option.value)}
                    aria-pressed={resourceListDensity === option.value}
                    title={`리소스 목록 ${option.label} 표시`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="grid gap-1">
                <span className="ku-meta">컬럼 · {visibleOptionalColumnCount + 3}</span>
                <div className="flex max-w-[280px] flex-wrap gap-1 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-1" aria-label="리소스 목록 표시 컬럼">
                  {resourceListOptionalColumns.map((column) => (
                    <button
                      key={column.key}
                      className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                        resourceListColumns[column.key] ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                      }`}
                      data-testid={`resource-list-column-${column.key}`}
                      type="button"
                      onClick={() => toggleResourceListColumn(column.key)}
                      aria-pressed={resourceListColumns[column.key]}
                      title={`${column.label} 컬럼 ${resourceListColumns[column.key] ? '숨기기' : '표시'}`}
                    >
                      {column.label}
                    </button>
                  ))}
                </div>
              </div>
              <span className="ku-chip" data-testid="resource-result-count">{loading ? '로딩 중' : `결과 ${filteredResources.length} / 전체 ${resources.length}`}</span>
              {activeResourceFilterChips.length > 0 ? (
                <span className="ku-chip border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] text-[#0057b8]" data-testid="resource-active-filter-count">
                  필터 {activeResourceFilterChips.length}
                </span>
              ) : null}
            </div>
          </div>
          {error ? <p className="mt-2 text-xs font-semibold text-[#b26a00]">API 오류: {error}</p> : null}
        </div>

        <div className="grid gap-2 border-b border-[rgba(60,60,67,0.1)] p-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={16} />
            <input className="ku-input w-full pl-9" placeholder="리소스 검색" value={query} data-testid="resource-view-query" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <ResourceSelect label="Cluster" testId="resource-filter-cluster" value={cluster} values={clusters} onChange={setCluster} />
            <ResourceSelect label="Namespace" testId="resource-filter-namespace" value={namespace} values={namespaces} onChange={setNamespace} />
            <ResourceSelect label="Kind" testId="resource-filter-kind" value={kind} values={kinds} onChange={setKind} />
            <ResourceSelect label="Status" testId="resource-filter-status" value={status} values={statuses} onChange={setStatus} />
          </div>
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[rgba(60,60,67,0.1)] bg-[rgba(248,248,252,0.72)] p-2"
            data-testid="resource-active-filters"
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {activeResourceFilterChips.length > 0 ? (
                activeResourceFilterChips.map((chip) => (
                  <span
                    key={chip.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[rgba(0,122,255,0.18)] bg-white px-2 py-1 text-[10px] font-semibold text-[#0057b8] shadow-sm"
                    data-testid={chip.testId}
                  >
                    <span className="min-w-0 truncate">
                      {chip.label}: {chip.value}
                    </span>
                    <button
                      className="rounded-full p-0.5 text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)]"
                      type="button"
                      onClick={() => handleClearActiveResourceFilter(chip.id)}
                      aria-label={`${chip.label} 필터 지우기`}
                      data-testid={`${chip.testId}-clear`}
                    >
                      <X size={11} aria-hidden="true" />
                    </button>
                  </span>
                ))
              ) : (
                <span className="inline-flex items-center rounded-full bg-[rgba(60,60,67,0.06)] px-2 py-1 text-[10px] font-semibold text-[rgba(60,60,67,0.58)]" data-testid="resource-active-filter-empty">
                  모든 리소스
                </span>
              )}
            </div>
            {activeResourceFilterChips.length > 0 ? (
              <button
                className="inline-flex items-center gap-1 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                type="button"
                onClick={handleResetResourceFilters}
                data-testid="resource-active-filter-clear-all"
              >
                <RotateCcw size={13} aria-hidden="true" />
                Clear all
              </button>
            ) : null}
          </div>
          <div className="grid gap-2 rounded-[12px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="ku-meta">저장된 뷰 · 필터만 브라우저/팀 저장소에 보관</p>
                {matchingViewPreset ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(52,199,89,0.12)] px-2 py-1 text-[10px] font-semibold text-[#14863d]">
                    <CheckCircle2 size={12} aria-hidden="true" />
                    현재 적용됨 · {matchingViewPreset.name}
                  </span>
                ) : (
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${filtersAreDefault ? 'bg-[rgba(60,60,67,0.08)] text-[rgba(60,60,67,0.62)]' : 'bg-[rgba(255,149,0,0.12)] text-[#a45f00]'}`}>
                    {filtersAreDefault ? '기본 필터' : '저장 안 됨'}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <button
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.06)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)]"
                  type="button"
                  onClick={() => void handleCopyResourceViewLink()}
                  data-testid="resource-view-share-link"
                  title="현재 Resource Explorer 필터 공유 링크 복사"
                >
                  <Link2 size={13} aria-hidden="true" />
                  공유 링크
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={handleExportViewPresets}
                  disabled={viewPresets.length === 0}
                  data-testid="resource-view-export"
                  title="저장된 Resource Explorer view를 JSON으로 내보내기"
                >
                  <Download size={13} aria-hidden="true" />
                  내보내기
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                  type="button"
                  onClick={() => viewPresetImportInputRef.current?.click()}
                  data-testid="resource-view-import"
                  title="저장된 Resource Explorer view JSON 가져오기"
                >
                  <Upload size={13} aria-hidden="true" />
                  가져오기
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.06)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)] disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={() => void handleLoadTeamViewPresets()}
                  disabled={!teamResourceViewsEnabled || resourceViewTeamLoading}
                  data-testid="resource-view-team-load"
                  title={teamResourceViewsEnabled ? '서버에 저장된 팀 Resource Explorer view 불러오기' : 'Live Cluster 연결과 admin token이 필요합니다'}
                >
                  <RefreshCw className={resourceViewTeamLoading ? 'animate-spin' : ''} size={13} aria-hidden="true" />
                  팀 불러오기
                </button>
                <button
                  className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    resourceViewTeamSaveConfirm
                      ? 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00] hover:bg-[rgba(255,149,0,0.14)]'
                      : 'border-[rgba(0,122,255,0.18)] bg-white text-[#0057b8] hover:bg-[rgba(0,122,255,0.08)]'
                  }`}
                  type="button"
                  onClick={() => void handleSaveTeamViewPresets()}
                  disabled={!teamResourceViewsEnabled || resourceViewTeamLoading || viewPresets.length === 0}
                  data-testid="resource-view-team-save"
                  aria-pressed={resourceViewTeamSaveConfirm}
                  title={teamResourceViewsEnabled ? '현재 브라우저 saved view를 팀 저장소에 저장' : 'Live Cluster 연결과 admin token이 필요합니다'}
                >
                  <Upload size={13} aria-hidden="true" />
                  {resourceViewTeamSaveConfirm ? '팀 저장 확인' : '팀 저장'}
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={handleResetResourceFilters}
                  disabled={filtersAreDefault}
                  data-testid="resource-view-reset"
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  필터 초기화
                </button>
                <span className="ku-chip">{viewPresets.length} / {maxResourceViewPresets}</span>
                <input
                  ref={viewPresetImportInputRef}
                  className="hidden"
                  type="file"
                  accept="application/json,.json"
                  data-testid="resource-view-import-input"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    void handleImportViewPresets(file);
                    event.currentTarget.value = '';
                  }}
                />
              </div>
            </div>
            {resourceViewMessage ? (
              <p
                className={`rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold ${
                  resourceViewMessage.tone === 'success'
                    ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]'
                    : 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]'
                }`}
                data-testid="resource-view-message"
              >
                {resourceViewMessage.text}
              </p>
            ) : null}
            {resourceViewTransferSummary ? (
              <div className="grid gap-2 rounded-[12px] border border-[rgba(0,122,255,0.14)] bg-[rgba(0,122,255,0.045)] p-2" data-testid="resource-view-transfer-summary">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/82 px-2 py-1 text-[10px] font-semibold text-[#0057b8]" data-testid="resource-view-transfer-action">
                      {resourceViewTransferSummary.action === 'export' ? <Download size={12} aria-hidden="true" /> : <Upload size={12} aria-hidden="true" />}
                      {resourceViewTransferActionLabel(resourceViewTransferSummary)}
                    </span>
                    <span className="ku-chip" data-testid="resource-view-transfer-count">
                      {resourceViewTransferSummary.count} views
                    </span>
                    {resourceViewTransferSummary.skippedCount > 0 ? (
                      <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]" data-testid="resource-view-transfer-skipped">
                        skipped {resourceViewTransferSummary.skippedCount}
                      </span>
                    ) : null}
                  </div>
                  <button
                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2 py-1 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                    type="button"
                    onClick={() => setResourceViewTransferSummary(null)}
                    data-testid="resource-view-transfer-dismiss"
                  >
                    닫기
                  </button>
                </div>
                <div className="grid gap-1">
                  <p className="truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.62)]" data-testid="resource-view-transfer-file">
                    {resourceViewTransferSummary.fileName}
                  </p>
                  <p className="ku-meta" data-testid="resource-view-transfer-folders">
                    Folders {resourceViewTransferSummary.folders.length}: {resourceViewTransferSummary.folders.length > 0 ? resourceViewTransferSummary.folders.join(', ') : 'none'}
                    {resourceViewTransferSummary.format ? ` · format ${resourceViewTransferSummary.format === 'items' ? '{ items }' : 'array'}` : ''}
                  </p>
                </div>
              </div>
            ) : null}
            {resourceViewTeamComparePreview ? (
              <div className="grid gap-2 rounded-[12px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.055)] p-2.5" data-testid="resource-view-team-compare-preview">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/82 px-2 py-1 text-[10px] font-semibold text-[#0057b8]" data-testid="resource-view-team-compare-action">
                        <GitBranch size={12} aria-hidden="true" />
                        {resourceViewTeamCompareActionLabel(resourceViewTeamComparePreview)}
                      </span>
                      <span className="ku-chip" data-testid="resource-view-team-compare-local">Local {resourceViewTeamComparePreview.localCount}</span>
                      <span className="ku-chip" data-testid="resource-view-team-compare-team">Team {resourceViewTeamComparePreview.teamCount}</span>
                      {resourceViewTeamComparePreview.newNames.length > 0 ? (
                        <span className="ku-chip border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]" data-testid="resource-view-team-compare-new">
                          신규 {resourceViewTeamComparePreview.newNames.length}
                        </span>
                      ) : null}
                      {resourceViewTeamComparePreview.conflictNames.length > 0 ? (
                        <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]" data-testid="resource-view-team-compare-conflicts">
                          변경 충돌 {resourceViewTeamComparePreview.conflictNames.length}
                        </span>
                      ) : null}
                      {resourceViewTeamComparePreview.duplicateNames.length > 0 ? (
                        <span className="ku-chip" data-testid="resource-view-team-compare-duplicates">동일 {resourceViewTeamComparePreview.duplicateNames.length}</span>
                      ) : null}
                      {resourceViewTeamComparePreview.action === 'load' && resourceViewTeamComparePreview.localOnlyNames.length > 0 ? (
                        <span className="ku-chip" data-testid="resource-view-team-compare-local-only">로컬 유지 {resourceViewTeamComparePreview.localOnlyNames.length}</span>
                      ) : null}
                      {resourceViewTeamComparePreview.action === 'save' && resourceViewTeamComparePreview.teamOnlyNames.length > 0 ? (
                        <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]" data-testid="resource-view-team-compare-team-only">
                          서버 제외 {resourceViewTeamComparePreview.teamOnlyNames.length}
                        </span>
                      ) : null}
                      {resourceViewTeamComparePreview.invalidCount > 0 ? (
                        <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]" data-testid="resource-view-team-compare-skipped">
                          skipped {resourceViewTeamComparePreview.invalidCount}
                        </span>
                      ) : null}
                    </div>
                    <p className="ku-meta mt-1" data-testid="resource-view-team-compare-folders">
                      Folders {resourceViewTeamComparePreview.folders.length}: {resourceViewTeamComparePreview.folders.length > 0 ? resourceViewTeamComparePreview.folders.join(', ') : 'none'}
                      {resourceViewTeamComparePreview.mergeResult.droppedCount > 0 ? ` · 최대 ${maxResourceViewPresets}개 제한으로 ${resourceViewTeamComparePreview.mergeResult.droppedCount}개 제외 예정` : ''}
                    </p>
                    {resourceViewTeamComparePreview.snapshotMetadata ? (
                      <p className="ku-meta mt-1" data-testid="resource-view-team-compare-snapshot">
                        {formatResourceViewTeamSnapshotMetadata(resourceViewTeamComparePreview.snapshotMetadata)}
                      </p>
                    ) : null}
                  </div>
                  <button
                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2 py-1 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                    type="button"
                    onClick={handleDismissTeamComparePreview}
                    data-testid="resource-view-team-compare-dismiss"
                  >
                    닫기
                  </button>
                </div>
                <div className="grid gap-1.5 md:grid-cols-2">
                  <ResourceViewCompareNames title={resourceViewTeamComparePreview.action === 'load' ? '팀에서 들어올 뷰' : '팀에 저장할 뷰'} names={resourceViewTeamComparePreview.newNames} testId="resource-view-team-compare-new-list" />
                  <ResourceViewCompareNames title={resourceViewTeamComparePreview.action === 'load' ? '변경 충돌' : '서버와 다른 뷰'} names={resourceViewTeamComparePreview.conflictNames} testId="resource-view-team-compare-conflict-list" />
                  {resourceViewTeamComparePreview.action === 'load' ? (
                    <ResourceViewCompareNames title="로컬에만 있는 뷰" names={resourceViewTeamComparePreview.localOnlyNames} testId="resource-view-team-compare-local-list" />
                  ) : (
                    <ResourceViewCompareNames title="서버에서 빠질 뷰" names={resourceViewTeamComparePreview.teamOnlyNames} testId="resource-view-team-compare-team-list" />
                  )}
                  <ResourceViewCompareNames title="이미 동일한 뷰" names={resourceViewTeamComparePreview.duplicateNames} testId="resource-view-team-compare-duplicate-list" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {resourceViewTeamComparePreview.action === 'load' ? (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.2)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.12)]"
                      type="button"
                      onClick={handleApplyTeamLoadPreview}
                      data-testid="resource-view-team-compare-apply"
                    >
                      <CheckCircle2 size={13} aria-hidden="true" />
                      팀 뷰 반영
                    </button>
                  ) : (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.2)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.12)] disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      onClick={() => void handleConfirmTeamSavePreview()}
                      disabled={resourceViewTeamLoading}
                      data-testid="resource-view-team-compare-save"
                    >
                      <Upload size={13} aria-hidden="true" />
                      팀 저장 실행
                    </button>
                  )}
                  <button
                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                    type="button"
                    onClick={handleDismissTeamComparePreview}
                    data-testid="resource-view-team-compare-cancel"
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : null}
            {resourceViewTeamSyncSummary ? (
              <div className="grid gap-2 rounded-[12px] border border-[rgba(52,199,89,0.18)] bg-[rgba(52,199,89,0.06)] p-2" data-testid="resource-view-team-sync-summary">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/82 px-2 py-1 text-[10px] font-semibold text-[#14863d]" data-testid="resource-view-team-sync-action">
                      <RefreshCw size={12} aria-hidden="true" />
                      {resourceViewTeamSyncActionLabel(resourceViewTeamSyncSummary)}
                    </span>
                    <span className="ku-chip" data-testid="resource-view-team-sync-count">
                      {resourceViewTeamSyncSummary.count} views
                    </span>
                    {resourceViewTeamSyncSummary.newCount > 0 ? (
                      <span className="ku-chip border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]" data-testid="resource-view-team-sync-new">
                        신규 {resourceViewTeamSyncSummary.newCount}
                      </span>
                    ) : null}
                    {resourceViewTeamSyncSummary.conflictCount > 0 ? (
                      <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]" data-testid="resource-view-team-sync-conflicts">
                        충돌 {resourceViewTeamSyncSummary.conflictCount}
                      </span>
                    ) : null}
                    {resourceViewTeamSyncSummary.duplicateCount > 0 ? (
                      <span className="ku-chip" data-testid="resource-view-team-sync-duplicates">중복 {resourceViewTeamSyncSummary.duplicateCount}</span>
                    ) : null}
                    {resourceViewTeamSyncSummary.skippedCount > 0 ? (
                      <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]" data-testid="resource-view-team-sync-skipped">
                        skipped {resourceViewTeamSyncSummary.skippedCount}
                      </span>
                    ) : null}
                  </div>
                  <button
                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2 py-1 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                    type="button"
                    onClick={() => setResourceViewTeamSyncSummary(null)}
                    data-testid="resource-view-team-sync-dismiss"
                  >
                    닫기
                  </button>
                </div>
                <div className="grid gap-1">
                  <p className="ku-meta" data-testid="resource-view-team-sync-folders">
                    Folders {resourceViewTeamSyncSummary.folders.length}: {resourceViewTeamSyncSummary.folders.length > 0 ? resourceViewTeamSyncSummary.folders.join(', ') : 'none'}
                  </p>
                  <p className="ku-meta" data-testid="resource-view-team-sync-meta">
                    Local before {resourceViewTeamSyncSummary.localCount} · {formatPresetUpdatedAt(resourceViewTeamSyncSummary.timestamp)}
                  </p>
                  {resourceViewTeamSyncSummary.snapshotMetadata ? (
                    <p className="ku-meta" data-testid="resource-view-team-sync-snapshot">
                      {formatResourceViewTeamSnapshotMetadata(resourceViewTeamSyncSummary.snapshotMetadata)}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
            {resourceViewConflict ? (
              <div
                className="grid gap-2 rounded-[12px] border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.08)] p-2.5"
                data-testid="resource-view-conflict-panel"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#8a4d00]">
                      {resourceViewSourceLabel(resourceViewConflict.source)} 충돌 {resourceViewConflict.conflicts.length}개
                    </p>
                    <p className="ku-meta mt-0.5">
                      신규 {resourceViewIncomingNewCount(resourceViewConflict.basePresets, resourceViewConflict.incomingPresets)}개 · 중복 {resourceViewConflict.duplicateCount}개 · 건너뜀 {resourceViewConflict.invalidCount}개
                    </p>
                  </div>
                  <button
                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2 py-1 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                    type="button"
                    onClick={() => setResourceViewConflict(null)}
                    data-testid="resource-view-conflict-dismiss"
                  >
                    닫기
                  </button>
                </div>
                <div className="grid gap-1.5">
                  {resourceViewConflict.conflicts.slice(0, 4).map((conflict) => (
                    <div key={conflict.name} className="grid gap-1 rounded-[9px] border border-[rgba(255,149,0,0.18)] bg-white/78 p-2">
                      <p className="truncate text-xs font-semibold text-[#1d1d1f]">{conflict.name}</p>
                      <p className="truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.56)]">현재: {resourceViewPresetSummary(conflict.existing)}</p>
                      <p className="truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.56)]">{resourceViewSourceShortLabel(resourceViewConflict.source)}: {resourceViewPresetSummary(conflict.incoming)}</p>
                    </div>
                  ))}
                  {resourceViewConflict.conflicts.length > 4 ? (
                    <p className="ku-meta">+{resourceViewConflict.conflicts.length - 4}개 충돌 더 있음</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.2)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.12)]"
                    type="button"
                    onClick={() => handleResolveResourceViewConflicts('incoming')}
                    data-testid="resource-view-conflict-apply-incoming"
                  >
                    <CheckCircle2 size={13} aria-hidden="true" />
                    {resourceViewSourceShortLabel(resourceViewConflict.source)} 우선
                  </button>
                  <button
                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                    type="button"
                    onClick={() => handleResolveResourceViewConflicts('current')}
                    data-testid="resource-view-conflict-keep-current"
                  >
                    현재 유지
                  </button>
                  <button
                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                    type="button"
                    onClick={() => handleResolveResourceViewConflicts('rename')}
                    data-testid="resource-view-conflict-rename"
                  >
                    이름 바꿔 둘 다 보관
                  </button>
                </div>
              </div>
            ) : null}
            {viewPresets.length > 0 ? (
              <div className="grid gap-2 rounded-[12px] border border-[rgba(60,60,67,0.1)] bg-[rgba(242,242,247,0.42)] p-2" data-testid="resource-view-folder-summary">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/82 px-2 py-1 text-[10px] font-semibold text-[rgba(60,60,67,0.72)]" data-testid="resource-view-folder-summary-count">
                      <FolderOpen size={12} aria-hidden="true" />
                      Folders {normalizedViewPresetSearch ? `${visibleViewPresetFolderCount} / ${groupedViewPresets.length}` : visibleViewPresetFolderCount}
                    </span>
                    <span className="ku-chip" data-testid="resource-view-folder-collapsed-count">접힘 {collapsedVisibleViewPresetFolderCount}</span>
                    {selectedViewPresetCount > 0 ? (
                      <span className="ku-chip border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] text-[#0057b8]" data-testid="resource-view-folder-selected-count">
                        선택 {selectedVisibleViewPresetCount} / {selectedViewPresetCount}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      onClick={handleExpandVisibleViewPresetFolders}
                      disabled={visibleViewPresetFolderCount === 0 || collapsedVisibleViewPresetFolderCount === 0}
                      data-testid="resource-view-folder-expand-all"
                    >
                      모두 펼치기
                    </button>
                    <button
                      className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      onClick={handleCollapseVisibleViewPresetFolders}
                      disabled={visibleViewPresetFolderCount === 0 || collapsedVisibleViewPresetFolderCount === visibleViewPresetFolderCount}
                      data-testid="resource-view-folder-collapse-all"
                    >
                      모두 접기
                    </button>
                  </div>
                </div>
                {visibleViewPresetFolderCount > 0 ? (
                  <div className="flex gap-1.5 overflow-x-auto pb-0.5" data-testid="resource-view-folder-chips">
                    {filteredGroupedViewPresets.map((group) => {
                      const collapsed = collapsedViewGroups.has(group.name);
                      const groupDomId = resourceViewGroupDomId(group.name);
                      const selectedCount = group.presets.filter((preset) => selectedViewPresetNames.has(preset.name)).length;
                      const active = matchingViewPreset?.group === group.name;
                      const FolderIcon = collapsed ? Folder : FolderOpen;
                      return (
                        <button
                          key={group.name}
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${
                            active
                              ? 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.1)] text-[#0057b8]'
                              : collapsed
                                ? 'border-[rgba(60,60,67,0.12)] bg-white/72 text-[rgba(60,60,67,0.62)] hover:bg-white'
                                : 'border-[rgba(52,199,89,0.16)] bg-white/86 text-[rgba(60,60,67,0.72)] hover:bg-white'
                          }`}
                          type="button"
                          onClick={() => toggleViewPresetGroup(group.name)}
                          aria-expanded={!collapsed}
                          data-testid={`resource-view-folder-chip-${groupDomId}`}
                          title={`${group.name} folder ${collapsed ? '펼치기' : '접기'}`}
                        >
                          <FolderIcon size={13} aria-hidden="true" />
                          <span>{group.name}</span>
                          <span className="rounded-full bg-[rgba(60,60,67,0.06)] px-1.5 py-0.5 text-[9px] font-semibold">
                            {normalizedViewPresetSearch ? `${group.presets.length}/${group.total}` : group.presets.length}
                          </span>
                          {selectedCount > 0 ? <span className="rounded-full bg-[rgba(0,122,255,0.1)] px-1.5 py-0.5 text-[9px] font-semibold text-[#0057b8]">{selectedCount} selected</span> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="ku-meta" data-testid="resource-view-folder-empty">일치하는 folder 없음</p>
                )}
              </div>
            ) : null}
            {viewPresets.length > 0 ? (
              <div className="grid gap-1.5" aria-label="저장된 뷰 빠른 적용" data-testid="resource-view-quick-groups">
                {filteredGroupedViewPresets.map((group) => (
                  <div key={group.name} className="grid gap-1">
                    <p className="ku-meta flex items-center gap-1.5" data-testid={`resource-view-quick-group-${resourceViewGroupDomId(group.name)}`}>
                      <FolderOpen size={12} aria-hidden="true" />
                      {group.name} · {normalizedViewPresetSearch ? `${group.presets.length} / ${group.total}` : group.presets.length}
                    </p>
                    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                      {group.presets.map((preset) => {
                        const active = resourceViewPresetMatchesFilters(preset, currentPresetFilters);
                        return (
                          <button
                            key={preset.name}
                            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${
                              active
                                ? 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.1)] text-[#0057b8]'
                                : 'border-[rgba(60,60,67,0.12)] bg-white/82 text-[rgba(60,60,67,0.72)] hover:bg-white'
                            }`}
                            type="button"
                            onClick={() => handleApplyViewPreset(preset)}
                            aria-pressed={active}
                            title={`${preset.name} · ${preset.group} · ${resourceViewPresetSummary(preset)}`}
                          >
                            {active ? <CheckCircle2 size={13} aria-hidden="true" /> : <Bookmark size={13} aria-hidden="true" />}
                            <span>{preset.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {viewPresets.length > 0 ? (
              <div className="grid gap-1.5 rounded-[12px] border border-[rgba(60,60,67,0.1)] bg-white/72 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="relative min-w-[220px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
                    <input
                      className="ku-input w-full pl-9 pr-9"
                      placeholder="Saved view search"
                      value={viewPresetSearch}
                      onChange={(event) => setViewPresetSearch(event.target.value)}
                      data-testid="resource-view-search"
                    />
                    {viewPresetSearch ? (
                      <button
                        className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-full p-1 text-[rgba(60,60,67,0.56)] transition hover:bg-[rgba(60,60,67,0.08)]"
                        type="button"
                        onClick={() => setViewPresetSearch('')}
                        aria-label="Saved view search clear"
                        data-testid="resource-view-search-clear"
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </label>
                  {normalizedViewPresetSearch ? (
                    <span className="ku-chip" data-testid="resource-view-search-count">
                      {filteredGroupedViewPresets.reduce((total, group) => total + group.presets.length, 0)} / {viewPresets.length}
                    </span>
                  ) : null}
                  <button
                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    onClick={() => handleSetVisibleViewPresetSelection(true)}
                    disabled={visibleViewPresets.length === 0 || allVisibleViewPresetsSelected}
                    data-testid="resource-view-select-visible"
                  >
                    현재 결과 선택
                  </button>
                  <button
                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    onClick={handleClearViewPresetSelection}
                    disabled={selectedViewPresetCount === 0}
                    data-testid="resource-view-clear-selection"
                  >
                    선택 해제
                  </button>
                </div>
                {normalizedViewPresetSearch ? (
                  <p className="ku-meta" data-testid="resource-view-reorder-disabled">검색 해제 후 순서 변경</p>
                ) : null}
              </div>
            ) : null}
            {selectedViewPresetCount > 0 ? (
              <div className="grid gap-2 rounded-[12px] border border-[rgba(0,122,255,0.16)] bg-[rgba(0,122,255,0.055)] p-2" data-testid="resource-view-bulk-toolbar">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="ku-chip border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] text-[#0057b8]" data-testid="resource-view-bulk-count">
                      선택 {selectedViewPresetCount}개
                    </span>
                    <span className="ku-meta">saved view 선택은 메모리에만 보관</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <button
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                      type="button"
                      onClick={handleExportSelectedViewPresets}
                      data-testid="resource-view-bulk-export"
                      title="선택한 saved view만 JSON으로 내보내기"
                    >
                      <Download size={13} aria-hidden="true" />
                      선택 export
                    </button>
                    <label className="grid min-w-[132px] gap-1">
                      <span className="ku-meta">Group 이동</span>
                      <input
                        className="ku-input h-8 text-xs"
                        list="resource-view-group-options"
                        value={bulkViewPresetGroup}
                        onChange={(event) => {
                          setBulkViewPresetGroup(event.target.value.slice(0, maxResourceViewGroupLength));
                          setBulkViewPresetDeleteConfirm(false);
                        }}
                        data-testid="resource-view-bulk-group-input"
                      />
                    </label>
                    <button
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.18)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.08)]"
                      type="button"
                      onClick={handleBulkMoveViewPresets}
                      data-testid="resource-view-bulk-move"
                    >
                      <Tags size={13} aria-hidden="true" />
                      Group 이동
                    </button>
                    <button
                      className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs font-semibold transition ${
                        bulkViewPresetDeleteConfirm
                          ? 'border-[rgba(255,59,48,0.28)] bg-[rgba(255,59,48,0.12)] text-[#c01f17] hover:bg-[rgba(255,59,48,0.16)]'
                          : 'border-[rgba(255,59,48,0.18)] bg-white text-[#c01f17] hover:bg-[rgba(255,59,48,0.08)]'
                      }`}
                      type="button"
                      onClick={handleBulkDeleteViewPresets}
                      data-testid="resource-view-bulk-delete"
                    >
                      <Trash2 size={13} aria-hidden="true" />
                      {bulkViewPresetDeleteConfirm ? '삭제 확인' : '선택 삭제'}
                    </button>
                    <button
                      className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                      type="button"
                      onClick={handleClearViewPresetSelection}
                      data-testid="resource-view-bulk-clear"
                    >
                      선택 해제
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {presetNameExists ? <p className="ku-meta">같은 이름으로 저장하면 기존 뷰를 업데이트합니다.</p> : null}
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(150px,0.45fr)_auto]">
              <label className="grid gap-1">
                <span className="ku-meta">View name</span>
                <input
                  className="ku-input w-full"
                  placeholder={suggestedPresetName}
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  data-testid="resource-view-name-input"
                />
              </label>
              <label className="grid gap-1">
                <span className="ku-meta">Group</span>
                <input
                  className="ku-input w-full"
                  list="resource-view-group-options"
                  placeholder={defaultResourceViewGroup}
                  value={presetGroup}
                  onChange={(event) => setPresetGroup(event.target.value.slice(0, maxResourceViewGroupLength))}
                  data-testid="resource-view-group-input"
                />
                <datalist id="resource-view-group-options">
                  {viewPresetGroupOptions.map((groupName) => (
                    <option key={groupName} value={groupName} />
                  ))}
                </datalist>
              </label>
              <button
                className="inline-flex h-9 items-center justify-center gap-2 self-end rounded-[9px] border border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] px-3 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.13)]"
                type="button"
                onClick={handleSaveViewPreset}
                data-testid="resource-view-save"
              >
                <Bookmark size={14} aria-hidden="true" />
                {savePresetLabel}
              </button>
            </div>
            {viewPresets.length === 0 ? (
              <p className="ku-meta">저장된 뷰 없음</p>
            ) : filteredGroupedViewPresets.length === 0 ? (
              <p className="ku-meta" data-testid="resource-view-search-empty">일치하는 saved view 없음</p>
            ) : (
              <div className="grid gap-2" data-testid="resource-view-grouped-list">
                {filteredGroupedViewPresets.map((group) => {
                  const collapsed = collapsedViewGroups.has(group.name);
                  const groupDomId = resourceViewGroupDomId(group.name);
                  const groupSelectedCount = group.presets.filter((preset) => selectedViewPresetNames.has(preset.name)).length;
                  const groupAllSelected = group.presets.length > 0 && groupSelectedCount === group.presets.length;
                  const groupPartiallySelected = groupSelectedCount > 0 && !groupAllSelected;
                  const HeaderFolderIcon = collapsed ? Folder : FolderOpen;
                  return (
                    <div key={group.name} className="grid gap-1.5 rounded-[12px] border border-[rgba(60,60,67,0.1)] bg-[rgba(242,242,247,0.38)] p-2" data-testid={`resource-view-group-${groupDomId}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] px-1.5 py-1 transition hover:bg-white/70">
                        <button
                          className="inline-flex min-w-0 items-center gap-1.5 text-left"
                          type="button"
                          onClick={() => toggleViewPresetGroup(group.name)}
                          aria-expanded={!collapsed}
                          data-testid={`resource-view-group-toggle-${groupDomId}`}
                        >
                          <ChevronDown className={`shrink-0 transition ${collapsed ? '-rotate-90' : ''}`} size={14} aria-hidden="true" />
                          <HeaderFolderIcon className="shrink-0 text-[rgba(60,60,67,0.56)]" size={13} aria-hidden="true" />
                          <span className="truncate text-xs font-semibold text-[#1d1d1f]">{group.name}</span>
                        </button>
                        <div className="flex items-center gap-1.5">
                          <label className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.1)] bg-white/72 px-2 py-1 text-xs font-semibold text-[rgba(60,60,67,0.72)]">
                            <input
                              className="h-3.5 w-3.5 rounded border-[rgba(60,60,67,0.24)] text-[#0057b8] focus:ring-[rgba(0,122,255,0.25)]"
                              type="checkbox"
                              checked={groupAllSelected}
                              ref={(node) => {
                                if (node) {
                                  node.indeterminate = groupPartiallySelected;
                                }
                              }}
                              onChange={(event) => handleSetGroupViewPresetSelection(group.presets, event.currentTarget.checked)}
                              data-testid={`resource-view-group-select-${groupDomId}`}
                              aria-label={`${group.name} saved view 선택`}
                            />
                            선택
                          </label>
                          {groupSelectedCount > 0 ? <span className="ku-chip border-[rgba(0,122,255,0.2)] bg-[rgba(0,122,255,0.08)] text-[#0057b8]">{groupSelectedCount} selected</span> : null}
                          <span className="ku-chip">{normalizedViewPresetSearch ? `${group.presets.length} / ${group.total}` : `${group.presets.length} views`}</span>
                        </div>
                      </div>
                      {collapsed ? null : group.presets.map((preset, presetIndex) => {
                        const active = resourceViewPresetMatchesFilters(preset, currentPresetFilters);
                        const isRenaming = renamingViewPreset?.originalName === preset.name;
                        const presetDomId = resourceViewPresetDomId(preset.name);
                        const presetBulkSelected = selectedViewPresetNames.has(preset.name);
                        const canMovePresetUp = canReorderViewPresets && presetIndex > 0;
                        const canMovePresetDown = canReorderViewPresets && presetIndex < group.presets.length - 1;
                        return (
                          <div
                            key={preset.name}
                            className={`grid gap-2 rounded-[10px] border p-2 transition sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${draggingViewPresetName === preset.name ? 'opacity-60' : ''} ${active ? 'border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.06)]' : 'border-[rgba(60,60,67,0.1)] bg-white/78'}`}
                            data-testid={`resource-view-preset-row-${presetDomId}`}
                            onDragOver={(event) => {
                              if (canReorderViewPresets) {
                                event.preventDefault();
                              }
                            }}
                            onDrop={(event) => handleDropViewPreset(preset, event)}
                          >
                            <div className="min-w-0">
                              {isRenaming ? (
                                <div className="grid gap-1.5">
                                  <label className="grid gap-1">
                                    <span className="ku-meta">saved view 이름</span>
                                    <input
                                      className="ku-input h-8 w-full text-xs"
                                      value={renamingViewPreset.draftName}
                                      onChange={(event) => setRenamingViewPreset((current) => current && current.originalName === preset.name ? { ...current, draftName: event.target.value.slice(0, 80), error: '' } : current)}
                                      onKeyDown={handleResourceViewRenameKeyDown}
                                      data-testid={`resource-view-rename-input-${presetDomId}`}
                                      autoFocus
                                    />
                                  </label>
                                  {renamingViewPreset.error ? (
                                    <p className="rounded-[8px] border border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] px-2 py-1 text-xs font-semibold text-[#8a4d00]" data-testid={`resource-view-rename-error-${presetDomId}`}>
                                      {renamingViewPreset.error}
                                    </p>
                                  ) : null}
                                  <p className="truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.54)]">{resourceViewPresetSummary(preset)}</p>
                                </div>
                              ) : (
                                <>
                                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                    <input
                                      className="h-4 w-4 rounded border-[rgba(60,60,67,0.24)] text-[#0057b8] focus:ring-[rgba(0,122,255,0.25)]"
                                      type="checkbox"
                                      checked={presetBulkSelected}
                                      onChange={(event) => handleToggleViewPresetSelection(preset.name, event.currentTarget.checked)}
                                      aria-label={`${preset.name} saved view 선택`}
                                      data-testid={`resource-view-select-${presetDomId}`}
                                    />
                                    <p className="truncate text-xs font-semibold text-[#1d1d1f]">{preset.name}</p>
                                    {active ? <span className="rounded-full bg-[rgba(0,122,255,0.1)] px-1.5 py-0.5 text-[9px] font-semibold text-[#0057b8]">적용됨</span> : null}
                                    <span className="rounded-full bg-[rgba(52,199,89,0.1)] px-1.5 py-0.5 text-[9px] font-semibold text-[#248a3d]">{preset.group}</span>
                                    <span className="rounded-full bg-[rgba(60,60,67,0.06)] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[rgba(60,60,67,0.54)]">{formatPresetUpdatedAt(preset.updatedAt)}</span>
                                  </div>
                                  <p className="mt-0.5 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.54)]">{resourceViewPresetSummary(preset)}</p>
                                </>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                              {isRenaming ? (
                                <>
                                  <button
                                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.2)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.12)]"
                                    type="button"
                                    onClick={handleCommitResourceViewRename}
                                    data-testid={`resource-view-rename-save-${presetDomId}`}
                                  >
                                    <CheckCircle2 size={13} aria-hidden="true" />
                                    저장
                                  </button>
                                  <button
                                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                                    type="button"
                                    onClick={handleCancelResourceViewRename}
                                    data-testid={`resource-view-rename-cancel-${presetDomId}`}
                                  >
                                    <X size={13} aria-hidden="true" />
                                    취소
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.64)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-45"
                                    type="button"
                                    draggable={canReorderViewPresets}
                                    onDragStart={(event) => {
                                      if (!canReorderViewPresets) {
                                        event.preventDefault();
                                        return;
                                      }
                                      setDraggingViewPresetName(preset.name);
                                      event.dataTransfer.effectAllowed = 'move';
                                      event.dataTransfer.setData('text/plain', preset.name);
                                    }}
                                    onDragEnd={() => setDraggingViewPresetName('')}
                                    disabled={!canReorderViewPresets}
                                    title={canReorderViewPresets ? 'Drag to reorder saved view' : '검색 해제 후 순서 변경'}
                                    aria-label={`${preset.name} 순서 드래그`}
                                    data-testid={`resource-view-drag-handle-${presetDomId}`}
                                  >
                                    <GripVertical size={13} aria-hidden="true" />
                                  </button>
                                  <button
                                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white p-1.5 text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-45"
                                    type="button"
                                    onClick={() => handleMoveViewPreset(preset, -1)}
                                    disabled={!canMovePresetUp}
                                    aria-label={`${preset.name} 위로 이동`}
                                    data-testid={`resource-view-reorder-up-${presetDomId}`}
                                  >
                                    <ArrowUp size={13} aria-hidden="true" />
                                  </button>
                                  <button
                                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white p-1.5 text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-45"
                                    type="button"
                                    onClick={() => handleMoveViewPreset(preset, 1)}
                                    disabled={!canMovePresetDown}
                                    aria-label={`${preset.name} 아래로 이동`}
                                    data-testid={`resource-view-reorder-down-${presetDomId}`}
                                  >
                                    <ArrowDown size={13} aria-hidden="true" />
                                  </button>
                                  <label className="grid min-w-[126px] gap-1">
                                    <span className="ku-meta">Group</span>
                                    <input
                                      className="ku-input h-8 text-xs"
                                      list="resource-view-group-options"
                                      defaultValue={preset.group}
                                      onBlur={(event) => handleUpdateViewPresetGroup(preset, event.currentTarget.value)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault();
                                          handleUpdateViewPresetGroup(preset, event.currentTarget.value);
                                          event.currentTarget.blur();
                                        }
                                      }}
                                      data-testid={`resource-view-group-input-${presetDomId}`}
                                    />
                                  </label>
                                  <button className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]" type="button" onClick={() => handleApplyViewPreset(preset)}>
                                    적용
                                  </button>
                                  <button
                                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                                    type="button"
                                    onClick={() => handleStartResourceViewRename(preset)}
                                    data-testid={`resource-view-rename-start-${presetDomId}`}
                                    aria-label={`${preset.name} 이름 변경`}
                                  >
                                    <Pencil size={13} aria-hidden="true" />
                                    이름 변경
                                  </button>
                                  <button className="rounded-[8px] border border-[rgba(255,59,48,0.18)] bg-[rgba(255,59,48,0.06)] p-1.5 text-[#c01f17] transition hover:bg-[rgba(255,59,48,0.1)]" type="button" onClick={() => handleDeleteViewPreset(preset.name)} aria-label={`${preset.name} 삭제`}>
                                    <Trash2 size={14} aria-hidden="true" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-2 border-b border-[rgba(60,60,67,0.1)] p-3" data-testid="resource-bulk-toolbar">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`ku-chip ${selectedResourceCount > 0 ? 'border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] text-[#0057b8]' : ''}`} data-testid="resource-bulk-count">
                선택 {selectedResourceCount}개
              </span>
              <span className="ku-meta">현재 필터 결과 {sortedResources.length}개 · 메모리에만 보관</span>
              <span className="ku-meta" data-testid="resource-bulk-keyboard-hint">Space 선택 · Shift+Arrow 범위 · Ctrl/⌘+A 전체</span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <button
                className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={handleSelectFilteredResources}
                disabled={sortedResources.length === 0 || allFilteredResourcesSelected}
                data-testid="resource-bulk-select-all"
              >
                현재 필터 전체 선택
              </button>
              <button
                className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={handleClearResourceSelection}
                disabled={selectedResourceCount === 0}
                data-testid="resource-bulk-clear"
              >
                선택 해제
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.06)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => void handleCopySelectedResourceNames()}
                disabled={selectedResourceCount === 0}
                data-testid="resource-bulk-copy-names"
                title="선택한 리소스 이름을 클립보드에 복사"
              >
                <Copy size={13} aria-hidden="true" />
                이름 복사
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => handleExportSelectedResources('json')}
                disabled={selectedResourceCount === 0}
                data-testid="resource-bulk-export-json"
                title="선택한 리소스 safe inventory를 JSON으로 다운로드"
              >
                <Download size={13} aria-hidden="true" />
                JSON
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => handleExportSelectedResources('csv')}
                disabled={selectedResourceCount === 0}
                data-testid="resource-bulk-export-csv"
                title="선택한 리소스 safe inventory를 CSV로 다운로드"
              >
                <Download size={13} aria-hidden="true" />
                CSV
              </button>
            </div>
          </div>
          {resourceBulkMessage ? (
            <p
              className={`rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold ${
                resourceBulkMessage.tone === 'success'
                  ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]'
                  : 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]'
              }`}
              data-testid="resource-bulk-message"
            >
              {resourceBulkMessage.text}
            </p>
          ) : null}
        </div>

        <div
          className="max-h-[68vh] overflow-auto p-2 focus:outline-none focus:ring-2 focus:ring-[rgba(0,122,255,0.22)]"
          role="listbox"
          tabIndex={0}
          aria-label="리소스 목록"
          aria-activedescendant={selectedResource && selectedResourceIndex >= 0 ? resourceOptionDomId(selectedResource.id) : undefined}
          onKeyDown={handleResourceListKeyDown}
        >
          {sortedResources.length === 0 ? <p className="ku-meta p-2">필터와 일치하는 리소스가 없습니다.</p> : null}
          {sortedResources.length > 0 ? (
            <div className={`${resourceHeaderGridClassName} mb-2 hidden md:grid`} style={resourceGridStyle} data-testid="resource-list-column-header">
              <span className="ku-meta" data-resource-column="select">Select</span>
              <span className="ku-meta" data-resource-column="kind">Kind</span>
              <span className="ku-meta" data-resource-column="name">Name</span>
              {resourceListColumns.namespace ? <span className="ku-meta" data-resource-column="namespace">Namespace</span> : null}
              <span className="ku-meta" data-resource-column="status">Status</span>
              {resourceListColumns.cluster ? <span className="ku-meta" data-resource-column="cluster">Cluster</span> : null}
              {resourceListColumns.age ? <span className="ku-meta" data-resource-column="age">Age</span> : null}
              {resourceListColumns.summary ? <span className="ku-meta" data-resource-column="summary">Summary</span> : null}
            </div>
          ) : null}
          {sortedResources.map((resource) => {
            const summaryEntries = Object.entries(resource.summary).slice(0, resourceSummaryLimit);
            const resourceAge = resourceListAge(resource);
            const resourceBulkSelected = selectedResourceIds.has(resource.id);
            const resourceBulkDomId = resourceOptionDomId(resource.id);
            return (
              <div
                key={resource.id}
                id={resourceOptionDomId(resource.id)}
                className={resourceRowClassName(resource)}
                ref={(node) => {
                  resourceRowRefs.current[resource.id] = node;
                }}
                role="option"
                aria-selected={resource.id === selectedResource?.id}
                data-resource-row="true"
                data-resource-bulk-selected={resourceBulkSelected ? 'true' : 'false'}
                tabIndex={resource.id === selectedResource?.id ? 0 : -1}
                onClick={() => handleSelectResource(resource.id)}
              >
                <div className={resourceGridClassName} style={resourceGridStyle}>
                  <div className="flex min-w-0 items-center gap-2" data-resource-column="select" onClick={(event) => event.stopPropagation()}>
                    <input
                      className="h-4 w-4 rounded border-[rgba(60,60,67,0.24)] text-[#0057b8] focus:ring-[rgba(0,122,255,0.25)]"
                      type="checkbox"
                      checked={resourceBulkSelected}
                      onChange={(event) => handleToggleResourceSelection(resource.id, event.currentTarget.checked)}
                      aria-label={`${resource.kind} ${resource.namespace ? `${resource.namespace}/` : ''}${resource.name} 선택`}
                      data-testid={`resource-bulk-checkbox-${resourceBulkDomId}`}
                      data-resource-bulk-control="true"
                    />
                    <span className={`${resourceColumnLabelClassName} md:hidden`}>선택</span>
                  </div>
                  <div className="min-w-0" data-resource-column="kind">
                    <span className={resourceColumnLabelClassName}>Kind</span>
                    <span className={resourceColumnValueClassName} title={resource.kind}>{resource.kind}</span>
                  </div>
                  <div className="min-w-0" data-resource-column="name">
                    <span className={resourceColumnLabelClassName}>Name</span>
                    <p className={resourceNameClassName} title={resource.name}>{resource.name}</p>
                    <p className={`${resourceMetaClassName} md:hidden`}>
                      {resource.namespace ? `${resource.namespace} / ` : ''}
                      {resource.clusterId}
                    </p>
                  </div>
                  {resourceListColumns.namespace ? (
                    <div className="min-w-0" data-resource-column="namespace">
                      <span className={resourceColumnLabelClassName}>Namespace</span>
                      <span className={resourceColumnValueClassName} title={resource.namespace || '-'}>{resource.namespace || '-'}</span>
                    </div>
                  ) : null}
                  <div className="min-w-0" data-resource-column="status">
                    <span className={resourceColumnLabelClassName}>Status</span>
                    <span className={statusPillClassName(resource.status)}>{resource.status}</span>
                  </div>
                  {resourceListColumns.cluster ? (
                    <div className="min-w-0" data-resource-column="cluster">
                      <span className={resourceColumnLabelClassName}>Cluster</span>
                      <span className={resourceColumnValueClassName} title={resource.clusterId}>{resource.clusterId}</span>
                    </div>
                  ) : null}
                  {resourceListColumns.age ? (
                    <div className="min-w-0" data-resource-column="age">
                      <span className={resourceColumnLabelClassName}>Age</span>
                      <span className={resourceColumnValueClassName} title={resourceAge}>{resourceAge}</span>
                    </div>
                  ) : null}
                  {resourceListColumns.summary ? (
                    <div className="min-w-0" data-resource-column="summary">
                      <span className={resourceColumnLabelClassName}>Summary</span>
                      {summaryEntries.length > 0 ? (
                        <div className={`${resourceSummaryContainerClassName} md:mt-0`}>
                          {summaryEntries.map(([key, value]) => (
                            <span key={key} className={resourceSummaryChipClassName}>
                              {key}:{String(value)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className={resourceColumnValueClassName}>-</span>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ResourceExplorerDetail
        liveEnabled={liveEnabled && sourceMode === 'live' && liveResourceApiReady}
        resource={selectedResource}
        focusRequest={detailFocusRequest}
        onOpenTopologyNode={onOpenTopologyNode}
        onSelectNode={onSelectNode}
      />
    </section>
  );
}

function EmptyResourceDetail() {
  return (
    <div className="ku-panel p-6 text-center">
      <p className="text-sm font-semibold text-[#1d1d1f]">선택된 리소스가 없습니다.</p>
    </div>
  );
}

function ResourceExplorerDetail({
  liveEnabled,
  resource,
  focusRequest,
  onOpenTopologyNode,
  onSelectNode,
}: {
  liveEnabled: boolean;
  resource?: ResourceExplorerItem;
  focusRequest: number;
  onOpenTopologyNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  if (!resource) {
    return <EmptyResourceDetail />;
  }

  return (
    <ResourceExplorerDetailBody
      liveEnabled={liveEnabled}
      resource={resource}
      focusRequest={focusRequest}
      onOpenTopologyNode={onOpenTopologyNode}
      onSelectNode={onSelectNode}
    />
  );
}

function ResourceExplorerDetailBody({
  liveEnabled,
  resource,
  focusRequest,
  onOpenTopologyNode,
  onSelectNode,
}: {
  liveEnabled: boolean;
  resource: ResourceExplorerItem;
  focusRequest: number;
  onOpenTopologyNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const [events, setEvents] = useState<ResourceEvent[]>([]);
  const [eventsError, setEventsError] = useState('');
  const [eventsWarning, setEventsWarning] = useState('');
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsLastUpdatedAt, setEventsLastUpdatedAt] = useState<number | null>(null);
  const [eventsAutoRefreshEnabled, setEventsAutoRefreshEnabled] = useState(() => readEventsAutoRefreshPreference());
  const [eventsWarningNotificationsEnabled, setEventsWarningNotificationsEnabled] = useState(() => readEventsWarningNotificationsPreference());
  const [eventNotificationNotice, setEventNotificationNotice] = useState<EventNotificationNotice | null>(null);
  const [newEventKeys, setNewEventKeys] = useState<Set<string>>(() => new Set());
  const [showNewEventsOnly, setShowNewEventsOnly] = useState(false);
  const [eventFilter, setEventFilter] = useState('');
  const [eventSeverityFilter, setEventSeverityFilter] = useState<EventSeverityFilter>('all');
  const [eventTimeRangeFilter, setEventTimeRangeFilter] = useState<EventTimeRangeFilter>('all');
  const [eventSortOrder, setEventSortOrder] = useState<EventSortOrder>('newest');
  const [pinnedEventKeys, setPinnedEventKeys] = useState<Set<string>>(() => new Set());
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsError, setLogsError] = useState('');
  const [logsWarning, setLogsWarning] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsStreaming, setLogsStreaming] = useState(false);
  const logsStreamControllerRef = useRef<AbortController | null>(null);
  const logsPausedRef = useRef(false);
  const pendingLogLinesRef = useRef<string[]>([]);
  const [logsPaused, setLogsPaused] = useState(false);
  const [pendingLogLines, setPendingLogLines] = useState<string[]>([]);
  const [selectedLogContainer, setSelectedLogContainer] = useState('');
  const [previousLogs, setPreviousLogs] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  const [activeLogMatchIndex, setActiveLogMatchIndex] = useState(0);
  const [logTimeRangeFilter, setLogTimeRangeFilter] = useState<LogTimeRangeFilter>('all');
  const [logSortOrder, setLogSortOrder] = useState<LogSortOrder>('received');
  const [logCopyStatus, setLogCopyStatus] = useState<{ tone: 'success' | 'warning'; message: string } | null>(null);
  const [logDensity, setLogDensity] = useState<LogDensity>(() => readLogDensityPreference());
  const [resourceDetailDensity, setResourceDetailDensity] = useState<ResourceDetailDensity>(() => readResourceDetailDensityPreference());
  const [safePreviewFilter, setSafePreviewFilter] = useState('');
  const [activeSafePreviewMatchIndex, setActiveSafePreviewMatchIndex] = useState(0);
  const [relationFilter, setRelationFilter] = useState('');
  const [relationsExpanded, setRelationsExpanded] = useState(false);
  const [activeDetailSectionId, setActiveDetailSectionId] = useState<DetailSectionId>('metadata');
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const detailPanelActiveRef = useRef(false);
  const detailSectionRefs = useRef<Partial<Record<DetailSectionId, HTMLElement | null>>>({});
  const logLineRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const eventsControllerRef = useRef<AbortController | null>(null);
  const eventsRequestIdRef = useRef(0);
  const knownEventKeysRef = useRef<Set<string>>(new Set());
  const knownEventKeysInitializedRef = useRef(false);
  const eventsWarningNotificationsEnabledRef = useRef(eventsWarningNotificationsEnabled);
  const [openSections, setOpenSections] = useState<Set<DetailSectionId>>(() => new Set(defaultOpenDetailSections));
  const resourceEventsKey = resource ? `${resource.kind}:${resource.namespace || '-'}:${resource.name}` : '';

  const loadResourceEvents = (options: { preserveExistingEvents?: boolean } = {}) => {
    const requestId = eventsRequestIdRef.current + 1;
    eventsRequestIdRef.current = requestId;
    eventsControllerRef.current?.abort();
    eventsControllerRef.current = null;

    if (!resource || !liveEnabled) {
      setEvents([]);
      setEventsError('');
      setEventsWarning('');
      setEventsLoading(false);
      setEventsLastUpdatedAt(null);
      setEventNotificationNotice(null);
      setNewEventKeys(new Set());
      setShowNewEventsOnly(false);
      knownEventKeysRef.current = new Set();
      knownEventKeysInitializedRef.current = false;
      return undefined;
    }

    if (!options.preserveExistingEvents) {
      setEvents([]);
      setEventsLastUpdatedAt(null);
      setEventNotificationNotice(null);
      setNewEventKeys(new Set());
      setShowNewEventsOnly(false);
      knownEventKeysRef.current = new Set();
      knownEventKeysInitializedRef.current = false;
    }

    const controller = new AbortController();
    eventsControllerRef.current = controller;
    setEventsLoading(true);
    setEventsError('');
    setEventsWarning('');

    fetchResourceEvents(resource, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || eventsRequestIdRef.current !== requestId) {
          return;
        }
        const nextEvents = [...response.items].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        updateEventNotificationState(nextEvents, knownEventKeysRef, knownEventKeysInitializedRef, eventsWarningNotificationsEnabledRef.current, setEventNotificationNotice, setNewEventKeys);
        setEvents(nextEvents);
        setEventsError('');
        setEventsWarning(response.warning || '');
        setEventsLastUpdatedAt(Date.now());
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted && eventsRequestIdRef.current === requestId) {
          if (!options.preserveExistingEvents) {
            setEvents([]);
            setEventsLastUpdatedAt(null);
          }
          setEventsError(requestError instanceof Error ? requestError.message : 'resource_events_request_failed');
          setEventsWarning('');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && eventsRequestIdRef.current === requestId) {
          eventsControllerRef.current = null;
          setEventsLoading(false);
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = loadResourceEvents();
    return () => {
      controller?.abort();
    };
  }, [liveEnabled, resource]);

  useEffect(() => {
    writeEventsAutoRefreshPreference(eventsAutoRefreshEnabled);
  }, [eventsAutoRefreshEnabled]);

  useEffect(() => {
    eventsWarningNotificationsEnabledRef.current = eventsWarningNotificationsEnabled;
    writeEventsWarningNotificationsPreference(eventsWarningNotificationsEnabled);
    if (!eventsWarningNotificationsEnabled) {
      setEventNotificationNotice(null);
      setNewEventKeys(new Set());
      setShowNewEventsOnly(false);
    }
  }, [eventsWarningNotificationsEnabled]);

  useEffect(() => {
    if (!eventsAutoRefreshEnabled || !liveEnabled || !resource) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      if (eventsControllerRef.current) {
        return;
      }
      loadResourceEvents({ preserveExistingEvents: true });
    }, eventsAutoRefreshIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [eventsAutoRefreshEnabled, liveEnabled, resourceEventsKey]);

  const resetLogPauseState = useCallback(() => {
    logsPausedRef.current = false;
    pendingLogLinesRef.current = [];
    setLogsPaused(false);
    setPendingLogLines([]);
  }, []);

  const resetEventMarkerState = useCallback(() => {
    setEventNotificationNotice(null);
    setNewEventKeys(new Set());
    setShowNewEventsOnly(false);
    knownEventKeysRef.current = new Set();
    knownEventKeysInitializedRef.current = false;
  }, []);

  const abortLogStream = useCallback(() => {
    logsStreamControllerRef.current?.abort();
    logsStreamControllerRef.current = null;
  }, []);

  const stopLogStream = useCallback(() => {
    abortLogStream();
    setLogsStreaming(false);
    resetLogPauseState();
  }, [abortLogStream, resetLogPauseState]);

  const resetResourceLogState = useCallback(() => {
    abortLogStream();
    setLogLines([]);
    setLogsError('');
    setLogsWarning('');
    setLogsLoading(false);
    setLogsStreaming(false);
    resetLogPauseState();
    setSelectedLogContainer('');
    setPreviousLogs(false);
    setLogFilter('');
    setActiveLogMatchIndex(0);
    setLogTimeRangeFilter('all');
    setLogSortOrder('received');
    setLogCopyStatus(null);
  }, [abortLogStream, resetLogPauseState]);

  const resetResourceDetailUiState = useCallback(() => {
    setSafePreviewFilter('');
    setActiveSafePreviewMatchIndex(0);
    setRelationFilter('');
    setRelationsExpanded(false);
    setEventFilter('');
    setEventSeverityFilter('all');
    setEventTimeRangeFilter('all');
    setEventSortOrder('newest');
    setPinnedEventKeys(new Set());
    setEventsLastUpdatedAt(null);
    resetEventMarkerState();
    setActiveDetailSectionId('metadata');
    setOpenSections(new Set(defaultOpenDetailSections));
  }, [resetEventMarkerState]);

  useEffect(() => {
    resetResourceLogState();
    resetResourceDetailUiState();
  }, [resetResourceDetailUiState, resetResourceLogState, resource.id]);

  useEffect(() => {
    return () => {
      eventsControllerRef.current?.abort();
      eventsControllerRef.current = null;
      logsStreamControllerRef.current?.abort();
      logsStreamControllerRef.current = null;
      logsPausedRef.current = false;
      pendingLogLinesRef.current = [];
    };
  }, []);

  const parsedLogLines = useMemo(() => parseLogLines(logLines), [logLines]);
  const filteredLogLines = useMemo(() => sortLogLines(filterLogLines(parsedLogLines, logFilter, logTimeRangeFilter, Date.now()), logSortOrder), [logFilter, logSortOrder, logTimeRangeFilter, parsedLogLines]);
  const logSearchMatches = useMemo(() => collectLogSearchMatches(filteredLogLines, logFilter), [filteredLogLines, logFilter]);
  const activeLogMatch = logSearchMatches[activeLogMatchIndex] || null;
  const baseFilteredEvents = useMemo(
    () => sortEventListItems(filterEvents(events, eventFilter, eventSeverityFilter, eventTimeRangeFilter, Date.now()), eventSortOrder, pinnedEventKeys),
    [eventFilter, eventSeverityFilter, eventSortOrder, eventTimeRangeFilter, events, pinnedEventKeys],
  );
  const filteredEvents = useMemo(
    () => (showNewEventsOnly ? baseFilteredEvents.filter((item) => newEventKeys.has(eventIdentityKey(item.event))) : baseFilteredEvents),
    [baseFilteredEvents, newEventKeys, showNewEventsOnly],
  );
  const pinnedEvents = useMemo(() => filteredEvents.filter((item) => item.pinned), [filteredEvents]);
  const eventGroups = useMemo(() => groupEventsBySeverity(filteredEvents.filter((item) => !item.pinned)), [filteredEvents]);
  const eventSeverityCounts = useMemo(() => countEventSeverities(events), [events]);
  const newEventCount = useMemo(() => countNewEvents(events, newEventKeys), [events, newEventKeys]);
  const hasNewEvents = newEventCount > 0;
  const eventWarningCount = eventSeverityCounts.warning;
  const eventHasWarning = eventWarningCount > 0;
  const filteredRelations = useMemo(() => filterRelatedResources(resource?.related || [], relationFilter), [relationFilter, resource?.related]);
  const normalizedLogFilter = logFilter.trim();
  const normalizedEventFilter = eventFilter.trim();
  const normalizedRelationFilter = relationFilter.trim();
  const relationGroups = useMemo(
    () => groupRelatedResources(filteredRelations, relationsExpanded ? Number.POSITIVE_INFINITY : maxCollapsedRelations),
    [filteredRelations, relationsExpanded],
  );
  const visibleRelationCount = relationGroups.reduce((total, group) => total + group.items.length, 0);
  const hiddenRelationCount = Math.max(filteredRelations.length - visibleRelationCount, 0);
  const eventControlsActive = eventFilter || eventSeverityFilter !== 'all' || eventTimeRangeFilter !== 'all' || eventSortOrder !== 'newest' || pinnedEventKeys.size > 0 || showNewEventsOnly;
  const eventFilterSummary = eventControlSummary(eventFilter, eventSeverityFilter, eventTimeRangeFilter, eventSortOrder, pinnedEventKeys.size, showNewEventsOnly);
  const canRefreshEvents = liveEnabled && Boolean(resource);
  const eventsAutoRefreshActive = canRefreshEvents && eventsAutoRefreshEnabled;
  const canExportEvents = filteredEvents.length > 0;

  useEffect(() => {
    writeLogDensityPreference(logDensity);
  }, [logDensity]);

  useEffect(() => {
    writeResourceDetailDensityPreference(resourceDetailDensity);
  }, [resourceDetailDensity]);

  useEffect(() => {
    if (!logCopyStatus) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setLogCopyStatus(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [logCopyStatus]);

  useEffect(() => {
    if (focusRequest <= 0) {
      return;
    }
    detailPanelActiveRef.current = true;
    window.requestAnimationFrame(() => {
      detailPanelRef.current?.focus({ preventScroll: false });
    });
  }, [focusRequest]);

  useEffect(() => {
    setActiveLogMatchIndex((current) => {
      if (logSearchMatches.length === 0) {
        return 0;
      }
      return Math.min(current, logSearchMatches.length - 1);
    });
  }, [logSearchMatches.length]);

  useEffect(() => {
    if (!activeLogMatch) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      logLineRefs.current[activeLogMatch.lineIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeLogMatch?.id]);

  const metadataPreview = resource ? recordFromUnknown(resource.preview.metadata) : {};
  const statusPreview = resource ? recordFromUnknown(resource.preview.status) : {};
  const summaryPreview = resource
    ? {
        ...recordFromUnknown(resource.preview.summary),
        ...(resource.preview.secretValues ? { secretValues: resource.preview.secretValues } : {}),
      }
    : {};
  const yamlPreview = resource && typeof resource.preview.safeYaml === 'string' ? resource.preview.safeYaml : '';
  const safePreviewEntries = keyValueEntries(summaryPreview);
  const safePreviewMatches = collectKeyValueSearchMatches(safePreviewEntries, safePreviewFilter);
  const safePreviewFilterActive = safePreviewFilter.trim().length > 0;
  const activeSafePreviewMatch = safePreviewMatches[activeSafePreviewMatchIndex] || null;

  useEffect(() => {
    setActiveSafePreviewMatchIndex((current) => {
      if (safePreviewMatches.length === 0) {
        return 0;
      }
      return Math.min(current, safePreviewMatches.length - 1);
    });
  }, [safePreviewMatches.length]);

  const healthSignals = resourceHealthSignals(resource, statusPreview, summaryPreview);
  const healthSectionTone = healthSignalSectionTone(resource, healthSignals);
  const canFetchLogs = liveEnabled && resource.kind === 'Pod';
  const logContainerOptions = podLogContainerOptions(resource);
  const effectiveLogContainer = selectedLogContainer || logContainerOptions.find((option) => !option.init)?.name || logContainerOptions[0]?.name || '';
  const logFilterActive = normalizedLogFilter.length > 0;
  const activeLogMatchNumber = logSearchMatches.length > 0 ? Math.min(activeLogMatchIndex + 1, logSearchMatches.length) : 0;
  const pendingLogCount = pendingLogLines.length;
  const canCopyVisibleLogs = filteredLogLines.length > 0;
  const canDownloadVisibleLogs = filteredLogLines.length > 0;
  const logControlsActive = logFilterActive || logTimeRangeFilter !== 'all' || logSortOrder !== 'received';
  const canCopyAllLogs = logControlsActive && logLines.length > 0;
  const canDownloadAllLogs = logControlsActive && logLines.length > 0;
  const relationSummary = normalizedRelationFilter ? `${filteredRelations.length} / ${resource.related.length}` : `${resource.related.length}`;
  const detailSectionSummaries: Record<DetailSectionId, string> = {
    metadata: sectionCount(metadataPreview),
    status: healthSectionSummary(resource, healthSignals, statusPreview),
    safe: sectionCount(summaryPreview),
    yaml: yamlPreview ? 'available' : 'empty',
    labels: sectionCount(resource.labels),
    annotations: sectionCount(resource.annotations),
    relations: relationSummary,
    events: eventSectionSummary(filteredEvents.length, events.length, eventSeverityCounts),
    logs: logLines.length > 0 ? `${filteredLogLines.length} / ${logLines.length}` : canFetchLogs ? 'ready' : 'empty',
  };
  const detailSectionTones: Record<DetailSectionId, DetailSectionTone> = {
    metadata: 'default',
    status: healthSectionTone,
    safe: 'default',
    yaml: 'default',
    labels: 'default',
    annotations: 'default',
    relations: 'default',
    events: eventsError || eventHasWarning ? 'warning' : 'default',
    logs: logsError ? 'error' : logsWarning ? 'warning' : 'default',
  };
  const overviewItems = resourceDetailOverviewItems({
    canFetchLogs,
    effectiveLogContainer,
    eventSeverityCounts,
    eventSummary: detailSectionSummaries.events,
    logSummary: detailSectionSummaries.logs,
    labels: resource.labels,
    annotations: resource.annotations,
    healthSignals,
    metadataPreview,
    relationCount: resource.related.length,
    resource,
  });
  const logViewportClassName =
    logDensity === 'compact'
      ? 'max-h-[420px] overflow-auto rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-[#111827] p-1 font-mono text-[10px] leading-4 text-[#d1d5db]'
      : 'max-h-[320px] overflow-auto rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-[#111827] p-2 font-mono text-[11px] leading-5 text-[#d1d5db]';
  const logRowClassName =
    logDensity === 'compact'
      ? 'grid grid-cols-[38px_minmax(0,1fr)] gap-1 rounded-[5px] px-0.5 py-0'
      : 'grid grid-cols-[44px_minmax(0,1fr)] gap-2 rounded-[6px] px-1 py-0.5';
  const openDetailSectionCount = detailKeyboardSections.filter((id) => openSections.has(id)).length;
  const allDetailSectionsOpen = openDetailSectionCount === detailKeyboardSections.length;
  const noDetailSectionsOpen = openDetailSectionCount === 0;
  const defaultDetailSectionsOpen = openDetailSectionCount === defaultOpenDetailSections.length && defaultOpenDetailSections.every((id) => openSections.has(id));
  const activeDetailSectionLabel = detailNavigatorSections.find((section) => section.id === activeDetailSectionId)?.label || 'Metadata';
  const resourceIdentityName = resource.namespace ? `${resource.namespace}/${resource.name}` : resource.name;
  const isSectionOpen = useCallback((id: DetailSectionId) => openSections.has(id), [openSections]);
  const toggleSection = useCallback((id: DetailSectionId) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  const openSection = useCallback((id: DetailSectionId) => {
    setOpenSections((current) => {
      if (current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);
  const focusDetailSection = useCallback((id: DetailSectionId) => {
    setActiveDetailSectionId(id);
    openSection(id);
    window.requestAnimationFrame(() => {
      const section = detailSectionRefs.current[id];
      section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      section?.focus({ preventScroll: true });
    });
  }, [openSection]);
  const moveDetailSection = useCallback((offset: number) => {
    const currentIndex = detailKeyboardSections.indexOf(activeDetailSectionId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + offset + detailKeyboardSections.length) % detailKeyboardSections.length : 0;
    focusDetailSection(detailKeyboardSections[nextIndex]);
  }, [activeDetailSectionId, focusDetailSection]);
  const handleExpandAllDetailSections = useCallback(() => {
    setOpenSections(new Set(detailKeyboardSections));
  }, []);
  const handleCollapseAllDetailSections = useCallback(() => {
    setOpenSections(new Set());
  }, []);
  const handleResetDetailSections = useCallback(() => {
    setOpenSections(new Set(defaultOpenDetailSections));
  }, []);
  const handleDetailShortcut = useCallback((event: globalThis.KeyboardEvent) => {
    const eventPath = event.composedPath();
    const editableTargetHasFocus = Boolean(detailPanelRef.current?.querySelector('input:focus, select:focus, textarea:focus, button:focus, [contenteditable="true"]:focus'));
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      editableTargetHasFocus ||
      isEditableTarget(event.target) ||
      isEditableTarget(document.activeElement) ||
      eventPath.some((target) => isEditableTarget(target))
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'j') {
      event.preventDefault();
      moveDetailSection(1);
    } else if (key === 'k') {
      event.preventDefault();
      moveDetailSection(-1);
    } else if (key === 'o') {
      event.preventDefault();
      toggleSection(activeDetailSectionId);
    } else if (key === 'e') {
      event.preventDefault();
      handleExpandAllDetailSections();
    } else if (key === 'c') {
      event.preventDefault();
      handleCollapseAllDetailSections();
    } else if (key === 'r') {
      event.preventDefault();
      handleResetDetailSections();
    } else if (/^[1-9]$/.test(key)) {
      const targetSection = detailKeyboardSections[Number(key) - 1];
      if (targetSection) {
        event.preventDefault();
        focusDetailSection(targetSection);
      }
    }
  }, [activeDetailSectionId, focusDetailSection, handleCollapseAllDetailSections, handleExpandAllDetailSections, handleResetDetailSections, moveDetailSection, toggleSection]);
  const setDetailSectionRef = useCallback((id: DetailSectionId) => (node: HTMLElement | null) => {
    detailSectionRefs.current[id] = node;
  }, []);
  const handleSafePreviewFilterChange = useCallback((value: string) => {
    setSafePreviewFilter(value);
    setActiveSafePreviewMatchIndex(0);
    if (value.trim()) {
      openSection('safe');
    }
  }, [openSection]);
  const moveActiveSafePreviewMatch = useCallback((offset: number) => {
    if (safePreviewMatches.length === 0) {
      return;
    }
    openSection('safe');
    setActiveSafePreviewMatchIndex((current) => (current + offset + safePreviewMatches.length) % safePreviewMatches.length);
  }, [openSection, safePreviewMatches.length]);
  const handleSafePreviewSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    moveActiveSafePreviewMatch(event.shiftKey ? -1 : 1);
  }, [moveActiveSafePreviewMatch]);

  useEffect(() => {
    const handleDocumentPointerDown = (event: MouseEvent | TouchEvent) => {
      detailPanelActiveRef.current = Boolean(detailPanelRef.current?.contains(event.target as Node));
    };
    const handleDocumentFocusIn = (event: FocusEvent) => {
      detailPanelActiveRef.current = Boolean(detailPanelRef.current?.contains(event.target as Node));
    };
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (detailPanelActiveRef.current) {
        handleDetailShortcut(event);
      }
    };
    document.addEventListener('mousedown', handleDocumentPointerDown, true);
    document.addEventListener('touchstart', handleDocumentPointerDown, true);
    document.addEventListener('focusin', handleDocumentFocusIn);
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown, true);
      document.removeEventListener('touchstart', handleDocumentPointerDown, true);
      document.removeEventListener('focusin', handleDocumentFocusIn);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [handleDetailShortcut]);

  const handleFetchLogs = async () => {
    if (!canFetchLogs) {
      return;
    }
    openSection('logs');
    stopLogStream();
    resetLogPauseState();
    setActiveLogMatchIndex(0);
    setLogsLoading(true);
    setLogsError('');
    setLogsWarning('');
    setLogCopyStatus(null);
    try {
      const response = await fetchResourceLogs(resource, { container: effectiveLogContainer || undefined, previous: previousLogs });
      setLogLines(response.lines);
      setLogsWarning(response.warning || '');
    } catch (requestError) {
      setLogLines([]);
      setLogsError(requestError instanceof Error ? requestError.message : 'resource_logs_request_failed');
    } finally {
      setLogsLoading(false);
    }
  };

  const handleRefreshEvents = () => {
    if (!canRefreshEvents || eventsLoading) {
      return;
    }
    openSection('events');
    loadResourceEvents({ preserveExistingEvents: true });
  };

  const handleEventsAutoRefreshToggle = () => {
    if (!canRefreshEvents) {
      return;
    }
    openSection('events');
    setEventsAutoRefreshEnabled((current) => !current);
  };

  const handleEventsWarningNotificationsToggle = () => {
    if (!canRefreshEvents) {
      return;
    }
    openSection('events');
    setEventsWarningNotificationsEnabled((current) => {
      const next = !current;
      eventsWarningNotificationsEnabledRef.current = next;
      if (!next) {
        setEventNotificationNotice(null);
        setNewEventKeys(new Set());
        setShowNewEventsOnly(false);
      }
      return next;
    });
  };

  const handleShowNewEvents = () => {
    if (!hasNewEvents) {
      return;
    }
    openSection('events');
    setShowNewEventsOnly(true);
  };

  const handleClearNewEvents = () => {
    setEventNotificationNotice(null);
    setNewEventKeys(new Set());
    setShowNewEventsOnly(false);
  };

  const handleDownloadEvents = (format: EventExportFormat) => {
    if (!canExportEvents) {
      return;
    }
    const content = format === 'csv' ? eventExportCsv(filteredEvents) : eventExportJson(filteredEvents);
    const mimeType = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
    downloadTextFile(content, mimeType, eventExportFileName(resource, format));
  };

  const appendVisibleLogLine = (line: string) => {
    setLogLines((current) => [...current, line].slice(-500));
  };

  const appendPendingLogLine = (line: string) => {
    pendingLogLinesRef.current = [...pendingLogLinesRef.current, line].slice(-500);
    setPendingLogLines(pendingLogLinesRef.current);
  };

  const handlePauseLogStream = () => {
    if (!logsStreaming) {
      return;
    }
    logsPausedRef.current = true;
    setLogsPaused(true);
    setLogCopyStatus(null);
  };

  const handleResumeLogStream = () => {
    const pendingLines = pendingLogLinesRef.current;
    logsPausedRef.current = false;
    pendingLogLinesRef.current = [];
    setLogsPaused(false);
    setPendingLogLines([]);
    if (pendingLines.length > 0) {
      setLogLines((current) => [...current, ...pendingLines].slice(-500));
    }
    setLogCopyStatus(null);
  };

  const handleStreamLogs = async () => {
    if (!canFetchLogs || previousLogs) {
      return;
    }
    if (logsStreaming) {
      stopLogStream();
      return;
    }

    const controller = new AbortController();
    logsStreamControllerRef.current = controller;
    openSection('logs');
    setLogLines([]);
    setLogsError('');
    setLogsWarning('');
    setLogCopyStatus(null);
    setActiveLogMatchIndex(0);
    resetLogPauseState();
    setLogsStreaming(true);
    try {
      await streamResourceLogs(
        resource,
        {
          container: effectiveLogContainer || undefined,
          previous: false,
          signal: controller.signal,
          tailLines: 200,
        },
        (message) => {
          if (message.warning) {
            setLogsWarning(message.warning);
          }
          if (typeof message.line === 'string') {
            const nextLine = message.line || '';
            if (logsPausedRef.current) {
              appendPendingLogLine(nextLine);
            } else {
              appendVisibleLogLine(nextLine);
            }
          }
        },
      );
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setLogsError(requestError instanceof Error ? requestError.message : 'resource_logs_stream_failed');
      }
    } finally {
      if (logsStreamControllerRef.current === controller) {
        logsStreamControllerRef.current = null;
        setLogsStreaming(false);
        resetLogPauseState();
      }
    }
  };

  const handleCopyLogs = async (mode: 'visible' | 'all') => {
    const lines = mode === 'all' ? logLines : filteredLogLines.map(({ line }) => line);
    if (lines.length === 0) {
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setLogCopyStatus({ tone: 'warning', message: '복사할 수 없습니다' });
      return;
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setLogCopyStatus({ tone: 'success', message: `${lines.length}줄 복사됨` });
    } catch {
      setLogCopyStatus({ tone: 'warning', message: '복사할 수 없습니다' });
    }
  };
  const handleDownloadLogs = (mode: 'visible' | 'all') => {
    const lines = mode === 'all' ? logLines : filteredLogLines.map(({ line }) => line);
    if (lines.length === 0) {
      return;
    }
    downloadTextFile(`${lines.join('\n')}\n`, 'text/plain;charset=utf-8', logDownloadFileName(resource, effectiveLogContainer, previousLogs));
    setLogCopyStatus({ tone: 'success', message: `${lines.length}줄 다운로드 준비됨` });
  };
  const moveActiveLogMatch = (offset: number) => {
    if (logSearchMatches.length === 0) {
      return;
    }
    openSection('logs');
    setActiveLogMatchIndex((current) => (current + offset + logSearchMatches.length) % logSearchMatches.length);
    setLogCopyStatus(null);
  };
  const togglePinnedEvent = (eventId: string) => {
    setPinnedEventKeys((current) => {
      const next = new Set(current);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };
  const renderEventCard = (item: EventListItem) => {
    const { event, id, pinned } = item;
    const severity = eventSeverity(event);
    const isNewEvent = newEventKeys.has(eventIdentityKey(event));
    const timestampKnown = validEventTimestamp(event.timestamp);
    const relativeTime = formatRelativeEventTimestamp(event.timestamp);
    const absoluteTime = formatEventTimestamp(event.timestamp);
    return (
      <div
        key={id}
        className={`rounded-[10px] border p-2 ${
          isNewEvent
            ? 'border-[rgba(255,149,0,0.35)] bg-[rgba(255,149,0,0.08)]'
            : pinned
              ? 'border-[rgba(0,122,255,0.26)] bg-[rgba(0,122,255,0.06)]'
              : 'border-[rgba(60,60,67,0.12)] bg-white/75'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={eventSeverityBadgeClassName(severity)}>{renderHighlightedText(event.type || 'Normal', normalizedEventFilter)}</span>
              {isNewEvent ? (
                <span
                  data-testid="events-new-chip"
                  className="rounded-full border border-[rgba(255,149,0,0.28)] bg-[rgba(255,149,0,0.14)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#9a5a00]"
                >
                  NEW
                </span>
              ) : null}
              <p className="min-w-0 break-words text-xs font-semibold text-[#1d1d1f]">{renderHighlightedText(event.reason || event.type || 'Event', normalizedEventFilter)}</p>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className={`ku-chip ${timestampKnown ? '' : 'border-[rgba(142,142,147,0.2)] bg-[rgba(142,142,147,0.1)] text-[#636366]'}`}>
                {renderHighlightedText(relativeTime, normalizedEventFilter)}
              </span>
              {event.source ? <span className="ku-chip">{renderHighlightedText(event.source, normalizedEventFilter)}</span> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              className={`inline-flex items-center gap-1 rounded-[7px] border px-1.5 py-1 text-[10px] font-semibold transition ${
                pinned
                  ? 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.12)] text-[#0057b8]'
                  : 'border-[rgba(60,60,67,0.12)] bg-white/78 text-[rgba(60,60,67,0.62)] hover:bg-white'
              }`}
              type="button"
              onClick={() => togglePinnedEvent(id)}
              aria-pressed={pinned}
              title={pinned ? '이벤트 고정 해제' : '이벤트 고정'}
            >
              <Bookmark size={12} aria-hidden="true" />
              {pinned ? '고정됨' : '고정'}
            </button>
          </div>
        </div>
        <p className="mt-2 break-words text-xs text-[rgba(60,60,67,0.72)]">{renderHighlightedText(event.message, normalizedEventFilter)}</p>
        <p className="mt-1 break-words font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.54)]">
          {renderHighlightedText(absoluteTime, normalizedEventFilter)}
        </p>
      </div>
    );
  };

  return (
    <div
      ref={detailPanelRef}
      className="ku-panel overflow-hidden"
      tabIndex={0}
      onFocusCapture={() => {
        detailPanelActiveRef.current = true;
      }}
      onMouseDownCapture={() => {
        detailPanelActiveRef.current = true;
      }}
      aria-label="리소스 상세 패널"
      data-testid="resource-detail-panel"
    >
      <div className="border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[#1d1d1f]">{resource.name}</h2>
            <p className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">
              {resource.clusterId} · {resource.namespace ? `${resource.namespace} / ` : ''}
              {resource.kind}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="리소스 상세 식별 정보">
              <span className="ku-chip" data-testid="resource-detail-kind-chip">Kind {resource.kind}</span>
              <span className="ku-chip" data-testid="resource-detail-name-chip">{resourceIdentityName}</span>
              <span className="ku-chip" data-testid="resource-detail-cluster-chip">Cluster {resource.clusterId}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
            <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="리소스 상세 밀도">
              {([
                { value: 'comfortable', label: '기본' },
                { value: 'compact', label: '촘촘' },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                    resourceDetailDensity === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                  }`}
                  data-testid={`resource-detail-density-${option.value}`}
                  type="button"
                  onClick={() => setResourceDetailDensity(option.value)}
                  aria-pressed={resourceDetailDensity === option.value}
                  title={`리소스 상세 ${option.label} 표시`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span className={statusPillClassName(resource.status)}>{resource.status}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[rgba(60,60,67,0.1)] bg-white/70 p-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="ku-chip border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] text-[#0057b8]" data-testid="resource-detail-active-section">
              현재 {activeDetailSectionLabel}
            </span>
            <span className="ku-chip" data-testid="resource-detail-open-section-count">
              열린 섹션 {openDetailSectionCount} / {detailKeyboardSections.length}
            </span>
            <span className="ku-chip" data-testid="resource-detail-keyboard-hint" title="상세 패널에 포커스가 있을 때만 동작합니다">
              J/K 이동 · O 열기 · E 펼치기 · C 접기 · R 기본 · 1-9 이동
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={handleExpandAllDetailSections}
              disabled={allDetailSectionsOpen}
              aria-pressed={allDetailSectionsOpen}
              aria-label="모든 리소스 상세 섹션 펼치기"
              data-testid="resource-detail-expand-all"
            >
              전체 펼치기
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={handleCollapseAllDetailSections}
              disabled={noDetailSectionsOpen}
              aria-pressed={noDetailSectionsOpen}
              aria-label="모든 리소스 상세 섹션 접기"
              data-testid="resource-detail-collapse-all"
            >
              전체 접기
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.06)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={handleResetDetailSections}
              disabled={defaultDetailSectionsOpen}
              aria-pressed={defaultDetailSectionsOpen}
              aria-label="리소스 상세 기본 섹션만 펼치기"
              data-testid="resource-detail-reset-sections"
            >
              기본 섹션
            </button>
          </div>
        </div>
        <ResourceDetailSectionNavigator
          activeId={activeDetailSectionId}
          openSections={openSections}
          sections={detailNavigatorSections}
          summaries={detailSectionSummaries}
          tones={detailSectionTones}
          onFocusSection={focusDetailSection}
        />
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {detailJumpSections.map((section) => {
            const jumpTone: DetailSectionTone = section.id === 'events' && eventHasWarning ? 'warning' : section.id === 'status' ? healthSectionTone : 'default';
            return (
              <button
                key={section.id}
                className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs font-semibold transition ${
                  activeDetailSectionId === section.id
                    ? jumpTone === 'error'
                      ? 'border-[rgba(255,59,48,0.28)] bg-[rgba(255,59,48,0.12)] text-[#b42318]'
                      : jumpTone === 'warning'
                        ? 'border-[rgba(255,149,0,0.28)] bg-[rgba(255,149,0,0.12)] text-[#9a5a00]'
                        : 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.1)] text-[#0057b8]'
                    : jumpTone === 'error'
                      ? 'border-[rgba(255,59,48,0.22)] bg-[rgba(255,59,48,0.08)] text-[#b42318] hover:bg-[rgba(255,59,48,0.12)]'
                      : jumpTone === 'warning'
                        ? 'border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] text-[#9a5a00] hover:bg-[rgba(255,149,0,0.12)]'
                        : 'border-[rgba(60,60,67,0.12)] bg-white/75 text-[rgba(60,60,67,0.72)] hover:bg-white'
                }`}
                type="button"
                onClick={() => focusDetailSection(section.id)}
                aria-current={activeDetailSectionId === section.id ? 'true' : undefined}
                aria-label={`${section.label} ${detailSectionSummaries[section.id]} 섹션으로 이동`}
                title={`${section.label} 섹션으로 이동`}
              >
                <span>{section.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${
                    jumpTone === 'error'
                      ? 'bg-white/80 text-[#b42318]'
                      : jumpTone === 'warning'
                        ? 'bg-white/80 text-[#9a5a00]'
                        : 'bg-white/70 text-[rgba(60,60,67,0.54)]'
                  }`}
                >
                  {detailSectionSummaries[section.id]}
                </span>
              </button>
            );
          })}
        </div>
        <ResourceDetailOverview items={overviewItems} />
      </div>

      <div className="grid gap-3 p-3">
        <DetailSection id="metadata" icon={FileText} title="Metadata" summary={detailSectionSummaries.metadata} open={isSectionOpen('metadata')} active={activeDetailSectionId === 'metadata'} sectionRef={setDetailSectionRef('metadata')} onFocusSection={() => setActiveDetailSectionId('metadata')} onToggle={() => toggleSection('metadata')}>
          <KeyValueGrid density={resourceDetailDensity} testId="metadata" values={metadataPreview} />
        </DetailSection>
        <DetailSection id="status" icon={Activity} title="Status" summary={detailSectionSummaries.status} tone={healthSectionTone} open={isSectionOpen('status')} active={activeDetailSectionId === 'status'} sectionRef={setDetailSectionRef('status')} onFocusSection={() => setActiveDetailSectionId('status')} onToggle={() => toggleSection('status')}>
          <HealthSignalPanel signals={healthSignals} />
          <KeyValueGrid density={resourceDetailDensity} testId="status" values={statusPreview} />
        </DetailSection>
        <DetailSection id="safe" icon={FileText} title="Safe Preview" summary={detailSectionSummaries.safe} open={isSectionOpen('safe')} active={activeDetailSectionId === 'safe'} sectionRef={setDetailSectionRef('safe')} onFocusSection={() => setActiveDetailSectionId('safe')} onToggle={() => toggleSection('safe')}>
          <div className="grid gap-2">
            <div className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
                <input
                  className="ku-input w-full pl-9"
                  data-testid="safe-preview-search-input"
                  placeholder="Safe Preview 검색"
                  value={safePreviewFilter}
                  onChange={(event) => handleSafePreviewFilterChange(event.target.value)}
                  onKeyDown={handleSafePreviewSearchKeyDown}
                  aria-label="Safe Preview 검색"
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="ku-chip" data-testid="safe-preview-search-count">
                  {safePreviewFilterActive ? `${safePreviewMatches.length} matches` : `${safePreviewEntries.length} items`}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    onClick={() => moveActiveSafePreviewMatch(-1)}
                    disabled={safePreviewMatches.length === 0}
                    data-testid="safe-preview-search-prev"
                    title="이전 Safe Preview match"
                  >
                    이전
                  </button>
                  <button
                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    onClick={() => moveActiveSafePreviewMatch(1)}
                    disabled={safePreviewMatches.length === 0}
                    data-testid="safe-preview-search-next"
                    title="다음 Safe Preview match"
                  >
                    다음
                  </button>
                  {safePreviewFilter ? (
                    <button
                      className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                      type="button"
                      onClick={() => handleSafePreviewFilterChange('')}
                      data-testid="safe-preview-search-clear"
                    >
                      초기화
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            {safePreviewFilterActive ? (
              <p className="ku-meta" data-testid="safe-preview-search-status">
                {safePreviewMatches.length > 0 ? `검색 결과 ${Math.min(activeSafePreviewMatchIndex + 1, safePreviewMatches.length)} / ${safePreviewMatches.length}` : '검색 결과 0개'}
              </p>
            ) : null}
            <KeyValueGrid
              activeMatch={activeSafePreviewMatch}
              density={resourceDetailDensity}
              filter={safePreviewFilter}
              filteredEmpty="일치하는 Safe Preview 항목 없음"
              testId="safe"
              values={summaryPreview}
            />
          </div>
        </DetailSection>
        <DetailSection id="yaml" icon={FileText} title="YAML Preview" summary={detailSectionSummaries.yaml} open={isSectionOpen('yaml')} active={activeDetailSectionId === 'yaml'} sectionRef={setDetailSectionRef('yaml')} onFocusSection={() => setActiveDetailSectionId('yaml')} onToggle={() => toggleSection('yaml')}>
          {yamlPreview ? (
            <pre className={`max-h-[360px] overflow-auto rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-[#111827] font-mono text-[#d1d5db] ${resourceDetailDensity === 'compact' ? 'p-2 text-[10px] leading-4' : 'p-3 text-[11px] leading-5'}`}>{yamlPreview}</pre>
          ) : (
            <p className="ku-meta">표시할 YAML preview가 없습니다.</p>
          )}
        </DetailSection>
        <DetailSection id="labels" icon={Tags} title="Labels" summary={detailSectionSummaries.labels} open={isSectionOpen('labels')} active={activeDetailSectionId === 'labels'} sectionRef={setDetailSectionRef('labels')} onFocusSection={() => setActiveDetailSectionId('labels')} onToggle={() => toggleSection('labels')}>
          <KeyValueGrid density={resourceDetailDensity} empty="labels 없음" testId="labels" values={resource.labels} />
        </DetailSection>
        <DetailSection id="annotations" icon={Tags} title="Annotations" summary={detailSectionSummaries.annotations} open={isSectionOpen('annotations')} active={activeDetailSectionId === 'annotations'} sectionRef={setDetailSectionRef('annotations')} onFocusSection={() => setActiveDetailSectionId('annotations')} onToggle={() => toggleSection('annotations')}>
          <KeyValueGrid density={resourceDetailDensity} empty="annotations 없음" testId="annotations" values={resource.annotations} />
        </DetailSection>
        <DetailSection id="relations" icon={Link2} title="Relations" summary={detailSectionSummaries.relations} open={isSectionOpen('relations')} active={activeDetailSectionId === 'relations'} sectionRef={setDetailSectionRef('relations')} onFocusSection={() => setActiveDetailSectionId('relations')} onToggle={() => toggleSection('relations')}>
          {resource.related.length === 0 ? (
            <p className="ku-meta">관계 없음</p>
          ) : (
            <div className="grid gap-2">
              <div className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
                  <input className="ku-input w-full pl-9" placeholder="관계 검색" value={relationFilter} onChange={(event) => setRelationFilter(event.target.value)} />
                </label>
                <div className="flex items-center justify-between gap-2">
                  <span className="ku-chip">
                    {filteredRelations.length} / {resource.related.length}
                  </span>
                  {relationFilter ? (
                    <button
                      className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                      type="button"
                      onClick={() => setRelationFilter('')}
                    >
                      초기화
                    </button>
                  ) : null}
                </div>
              </div>
              {filteredRelations.length === 0 ? (
                <p className="ku-meta">필터와 일치하는 관계가 없습니다.</p>
              ) : (
                <div className="grid gap-2">
                  {relationGroups.map((group) => (
                    <div key={group.key} className="grid gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">
                          {renderHighlightedText(group.label, normalizedRelationFilter)}
                        </p>
                        <span className="ku-chip">{group.count}</span>
                      </div>
                      <div className="grid gap-1.5">
                        {group.items.map((related) => (
                          <div key={`${related.direction}:${related.edgeType}:${related.nodeId}`} className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/75 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                            <button className="min-w-0 text-left" type="button" onClick={() => onSelectNode(related.nodeId)}>
                              <p className="truncate text-xs font-semibold text-[#1d1d1f]">
                                {related.direction === 'outgoing' ? '→' : '←'} {renderHighlightedText(related.name, normalizedRelationFilter)}
                              </p>
                              <p className="mt-0.5 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.58)]">
                                {renderHighlightedText(`${related.edgeType} · ${related.namespace ? `${related.namespace} / ` : ''}${related.kind}`, normalizedRelationFilter)}
                              </p>
                            </button>
                            <button
                              className="inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.06)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)]"
                              type="button"
                              onClick={() => onOpenTopologyNode(related.nodeId)}
                            >
                              <GitBranch size={13} aria-hidden="true" />
                              토폴로지
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {hiddenRelationCount > 0 || relationsExpanded ? (
                    <button
                      className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                      type="button"
                      onClick={() => setRelationsExpanded((current) => !current)}
                    >
                      {relationsExpanded ? '접기' : `+${hiddenRelationCount} more`}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </DetailSection>
        <DetailSection id="events" icon={Boxes} title="Events" summary={detailSectionSummaries.events} tone={eventHasWarning ? 'warning' : 'default'} open={isSectionOpen('events')} active={activeDetailSectionId === 'events'} sectionRef={setDetailSectionRef('events')} onFocusSection={() => setActiveDetailSectionId('events')} onToggle={() => toggleSection('events')}>
          {liveEnabled ? (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="ku-meta">live Events · 읽기 전용 · 저장 안 함</p>
                {eventsLoading ? <span className="ku-chip">조회 중</span> : null}
                {eventsLastUpdatedAt ? <span className="ku-chip">마지막 조회 {formatRefreshTimestamp(eventsLastUpdatedAt)}</span> : null}
                {eventsAutoRefreshActive ? <span className="ku-chip">자동 갱신 켜짐</span> : null}
                {eventsWarningNotificationsEnabled && canRefreshEvents ? <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#9a5a00]">Warning 알림 켜짐</span> : null}
                {hasNewEvents ? (
                  <>
                    <button
                      className="rounded-full border border-[rgba(255,149,0,0.28)] bg-[rgba(255,149,0,0.14)] px-2 py-1 font-mono text-[10px] font-semibold uppercase text-[#9a5a00] transition hover:bg-[rgba(255,149,0,0.2)]"
                      type="button"
                      onClick={handleShowNewEvents}
                      data-testid="events-new-count"
                      title="새 Warning/Error Events만 보기"
                    >
                      NEW {newEventCount}
                    </button>
                    <button
                      className="rounded-full border border-[rgba(255,149,0,0.22)] bg-white/75 px-2 py-1 text-[10px] font-semibold text-[#8a4d00] transition hover:bg-white"
                      type="button"
                      onClick={handleClearNewEvents}
                      data-testid="events-new-clear"
                      title="새 Event 표시 지우기"
                    >
                      NEW 지우기
                    </button>
                  </>
                ) : null}
                {events.length > 0 ? <EventSeverityChips counts={eventSeverityCounts} /> : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  className={`inline-flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    eventsWarningNotificationsEnabled && canRefreshEvents
                      ? 'border-[rgba(255,149,0,0.28)] bg-[rgba(255,149,0,0.12)] text-[#8a4d00] hover:bg-[rgba(255,149,0,0.16)]'
                      : 'border-[rgba(60,60,67,0.14)] bg-white/75 text-[rgba(60,60,67,0.72)] hover:bg-white'
                  }`}
                  type="button"
                  onClick={handleEventsWarningNotificationsToggle}
                  disabled={!canRefreshEvents}
                  aria-pressed={eventsWarningNotificationsEnabled && canRefreshEvents}
                  data-testid="events-warning-notifications-toggle"
                  title="새 Warning/Error Events를 앱 내부 알림으로 표시"
                >
                  <AlertTriangle size={14} aria-hidden="true" />
                  Warning 알림
                </button>
                <button
                  className={`inline-flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    eventsAutoRefreshActive
                      ? 'border-[rgba(52,199,89,0.24)] bg-[rgba(52,199,89,0.1)] text-[#248a3d] hover:bg-[rgba(52,199,89,0.14)]'
                      : 'border-[rgba(60,60,67,0.14)] bg-white/75 text-[rgba(60,60,67,0.72)] hover:bg-white'
                  }`}
                  type="button"
                  onClick={handleEventsAutoRefreshToggle}
                  disabled={!canRefreshEvents}
                  aria-pressed={eventsAutoRefreshActive}
                  title="선택한 리소스의 Events를 30초마다 다시 조회"
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  자동 30초
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.13)] disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={handleRefreshEvents}
                  disabled={!canRefreshEvents || eventsLoading}
                  data-testid="events-refresh"
                  title="선택한 리소스의 Events를 다시 조회"
                >
                  <RefreshCw className={eventsLoading ? 'animate-spin' : undefined} size={14} aria-hidden="true" />
                  {eventsLoading ? '조회 중' : '새로고침'}
                </button>
              </div>
            </div>
          ) : null}
          {eventNotificationNotice ? (
            <div
              className="mb-2 flex flex-wrap items-start justify-between gap-2 rounded-[10px] border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] p-2"
              data-testid="events-notification-banner"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <AlertTriangle size={15} className="text-[#9a5a00]" aria-hidden="true" />
                  <p className="text-xs font-semibold text-[#7a4300]">새 Warning/Error Events {eventNotificationNotice.count}개</p>
                </div>
                <p className="mt-1 break-words text-xs text-[rgba(60,60,67,0.72)]">
                  {eventNotificationNotice.reason || 'Event'} · {eventNotificationNotice.source || 'source unknown'} · {formatEventTimestamp(eventNotificationNotice.timestamp)}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <button
                  className="rounded-[9px] border border-[rgba(255,149,0,0.24)] bg-white/75 px-2.5 py-1.5 text-xs font-semibold text-[#8a4d00] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={handleShowNewEvents}
                  disabled={!hasNewEvents}
                  data-testid="events-notification-show-new"
                >
                  새 이벤트 보기
                </button>
                <button
                  className="rounded-[9px] border border-[rgba(255,149,0,0.24)] bg-white/75 px-2.5 py-1.5 text-xs font-semibold text-[#8a4d00] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={handleClearNewEvents}
                  disabled={!hasNewEvents && !eventNotificationNotice}
                  data-testid="events-notification-clear"
                >
                  표시 지우기
                </button>
                <button
                  className="rounded-[9px] border border-[rgba(255,149,0,0.24)] bg-white/75 px-2.5 py-1.5 text-xs font-semibold text-[#8a4d00] transition hover:bg-white"
                  type="button"
                  onClick={() => setEventNotificationNotice(null)}
                  data-testid="events-notification-dismiss"
                >
                  닫기
                </button>
              </div>
            </div>
          ) : null}
          {eventsWarning ? <InlineWarning message="이벤트 조회 권한이 없거나 API가 없어 빈 목록으로 표시합니다." /> : null}
          {eventsError ? <InlineWarning message={`이벤트 조회 실패: ${eventsError}`} /> : null}
          {events.length > 0 ? (
            <div className="mb-2 grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2 lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,1fr)_auto] lg:items-center">
              <div className="grid gap-1.5">
                <div className="grid grid-cols-3 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5">
                  {([
                    { value: 'all', label: '전체', count: events.length },
                    { value: 'warning', label: 'Warning', count: eventSeverityCounts.warning },
                    { value: 'normal', label: 'Normal', count: eventSeverityCounts.normal },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      className={`rounded-[7px] px-2.5 py-1 text-xs font-semibold transition ${
                        eventSeverityFilter === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                      }`}
                      type="button"
                      onClick={() => setEventSeverityFilter(option.value)}
                      aria-pressed={eventSeverityFilter === option.value}
                      title={`${option.label} 이벤트만 보기`}
                    >
                      {option.label} {option.count}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5">
                  {eventTimeRangeOptions.map((option) => (
                    <button
                      key={option.value}
                      className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                        eventTimeRangeFilter === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                      }`}
                      type="button"
                      onClick={() => setEventTimeRangeFilter(option.value)}
                      aria-pressed={eventTimeRangeFilter === option.value}
                      title={option.value === 'all' ? '모든 이벤트 보기' : `최근 ${option.label} 이벤트만 보기`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5">
                  {([
                    { value: 'newest', label: '최신순' },
                    { value: 'oldest', label: '오래된순' },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                        eventSortOrder === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                      }`}
                      type="button"
                      onClick={() => setEventSortOrder(option.value)}
                      aria-pressed={eventSortOrder === option.value}
                      title={`이벤트 ${option.label} 정렬`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
                <input className="ku-input w-full pl-9" placeholder="이벤트 필터" value={eventFilter} onChange={(event) => setEventFilter(event.target.value)} />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="ku-chip">
                    {filteredEvents.length} / {events.length}
                  </span>
                  {pinnedEventKeys.size > 0 ? <span className="ku-chip">고정 {pinnedEventKeys.size}</span> : null}
                  {showNewEventsOnly ? <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#9a5a00]">새 이벤트만</span> : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <button
                    className={`inline-flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      showNewEventsOnly
                        ? 'border-[rgba(255,149,0,0.28)] bg-[rgba(255,149,0,0.12)] text-[#8a4d00] hover:bg-[rgba(255,149,0,0.16)]'
                        : 'border-[rgba(60,60,67,0.12)] bg-white text-[rgba(60,60,67,0.72)] hover:bg-[rgba(242,242,247,0.9)]'
                    }`}
                    type="button"
                    onClick={() => setShowNewEventsOnly((current) => !current)}
                    disabled={!hasNewEvents}
                    aria-pressed={showNewEventsOnly}
                    data-testid="events-new-only-toggle"
                    title="새 Warning/Error Events만 보기"
                  >
                    NEW만
                  </button>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    onClick={() => handleDownloadEvents('csv')}
                    disabled={!canExportEvents}
                    data-testid="events-export-csv"
                    title="현재 표시된 Events를 CSV로 다운로드"
                  >
                    <Download size={14} aria-hidden="true" />
                    CSV
                  </button>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    onClick={() => handleDownloadEvents('json')}
                    disabled={!canExportEvents}
                    data-testid="events-export-json"
                    title="현재 표시된 Events를 JSON으로 다운로드"
                  >
                    <Download size={14} aria-hidden="true" />
                    JSON
                  </button>
                  {eventControlsActive ? (
                    <button
                      className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                      type="button"
                      onClick={() => {
                        setEventFilter('');
                        setEventSeverityFilter('all');
                        setEventTimeRangeFilter('all');
                        setEventSortOrder('newest');
                        setPinnedEventKeys(new Set());
                        setShowNewEventsOnly(false);
                      }}
                    >
                      초기화
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {eventsLoading && events.length === 0 ? (
            <p className="ku-meta">이벤트 조회 중...</p>
          ) : events.length === 0 ? (
            <p className="ku-meta">표시할 이벤트가 없습니다.</p>
          ) : filteredEvents.length === 0 ? (
            <p className="ku-meta">
              필터와 일치하는 이벤트가 없습니다.
              {eventFilterSummary ? ` · ${eventFilterSummary}` : ''}
            </p>
          ) : (
            <div className="grid gap-2">
              {pinnedEvents.length > 0 ? (
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[#0057b8]">Pinned</p>
                    <span className="ku-chip">{pinnedEvents.length}</span>
                  </div>
                  <div className="grid gap-2">{pinnedEvents.map(renderEventCard)}</div>
                </div>
              ) : null}
              {eventGroups.map((group) => (
                <div key={group.key} className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">{group.label}</p>
                    <span className="ku-chip">{group.count}</span>
                  </div>
                  <div className="grid gap-2">
                    {group.items.map(renderEventCard)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DetailSection>
        <DetailSection id="logs" icon={FileText} title="Logs" summary={detailSectionSummaries.logs} open={isSectionOpen('logs')} active={activeDetailSectionId === 'logs'} sectionRef={setDetailSectionRef('logs')} onFocusSection={() => setActiveDetailSectionId('logs')} onToggle={() => toggleSection('logs')}>
          {!canFetchLogs ? (
            <p className="ku-meta">Pod 로그 없음</p>
          ) : (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="ku-meta">최근 200줄 · 따라가기 최대 500줄 · 읽기 전용 · 저장 안 함</p>
                {logContainerOptions.length > 1 ? (
                  <select
                    className="ku-select min-w-[180px]"
                    value={effectiveLogContainer}
                    onChange={(event) => {
                      stopLogStream();
                      setSelectedLogContainer(event.target.value);
                      setLogLines([]);
                      setLogsError('');
                      setLogsWarning('');
                      setLogFilter('');
                      setActiveLogMatchIndex(0);
                      setLogTimeRangeFilter('all');
                      setLogSortOrder('received');
                      setLogCopyStatus(null);
                    }}
                    disabled={logsLoading || logsStreaming}
                  >
                    {logContainerOptions.map((option) => (
                      <option key={`${option.init ? 'init' : 'app'}:${option.name}`} value={option.name}>
                        {option.init ? `init: ${option.name}` : option.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <label className="flex items-center gap-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)]">
                  <input
                    className="h-3.5 w-3.5 accent-[#007aff]"
                    type="checkbox"
                    checked={previousLogs}
                    onChange={(event) => {
                      stopLogStream();
                      setPreviousLogs(event.target.checked);
                      setLogLines([]);
                      setLogsError('');
                      setLogsWarning('');
                      setLogFilter('');
                      setActiveLogMatchIndex(0);
                      setLogTimeRangeFilter('all');
                      setLogSortOrder('received');
                      setLogCopyStatus(null);
                    }}
                    disabled={logsLoading || logsStreaming}
                  />
                  이전 로그
                </label>
                <button
                  className="rounded-[9px] border border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.13)] disabled:cursor-not-allowed disabled:opacity-55"
                  type="button"
                  onClick={handleFetchLogs}
                  disabled={logsLoading || logsStreaming}
                >
                  {logsLoading ? '불러오는 중' : '로그 불러오기'}
                </button>
                <button
                  className="rounded-[9px] border border-[rgba(52,199,89,0.28)] bg-[rgba(52,199,89,0.10)] px-2.5 py-1.5 text-xs font-semibold text-[#19783b] transition hover:bg-[rgba(52,199,89,0.16)] disabled:cursor-not-allowed disabled:opacity-55"
                  type="button"
                  onClick={handleStreamLogs}
                  disabled={logsLoading || previousLogs}
                  title={previousLogs ? '이전 로그는 고정 조회만 지원합니다.' : undefined}
                >
                  {logsStreaming ? '중지' : '따라가기'}
                </button>
                {logsStreaming ? (
                  <button
                    className="rounded-[9px] border border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#8a4d00] transition hover:bg-[rgba(255,149,0,0.13)]"
                    type="button"
                    onClick={logsPaused ? handleResumeLogStream : handlePauseLogStream}
                    data-testid="log-stream-pause-toggle"
                  >
                    {logsPaused ? '재개' : '일시정지'}
                  </button>
                ) : null}
                <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5">
                  {(['comfortable', 'compact'] as const).map((density) => (
                    <button
                      key={density}
                      className={`rounded-[7px] px-2.5 py-1 text-xs font-semibold transition ${
                        logDensity === density ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                      }`}
                      type="button"
                      onClick={() => setLogDensity(density)}
                      aria-pressed={logDensity === density}
                    >
                      {density === 'comfortable' ? '기본' : '촘촘'}
                    </button>
                  ))}
                </div>
              </div>
              {effectiveLogContainer ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="ku-meta">컨테이너: {effectiveLogContainer}{previousLogs ? ' · 이전 종료 인스턴스' : logsStreaming ? ' · 실시간 따라가기' : ''}</p>
                  {logsPaused ? <span className="ku-chip">일시정지 · {pendingLogCount}줄 대기</span> : null}
                </div>
              ) : null}
              {logLines.length > 0 ? (
                <div className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto] xl:items-center">
                  <div className="grid gap-1.5">
                    <label className="relative block">
                      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
                      <input
                        className="ku-input w-full pl-9"
                        placeholder="로그 필터"
                        value={logFilter}
                        onChange={(event) => {
                          setLogFilter(event.target.value);
                          setActiveLogMatchIndex(0);
                          setLogCopyStatus(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && logFilterActive) {
                            event.preventDefault();
                            moveActiveLogMatch(event.shiftKey ? -1 : 1);
                          }
                        }}
                      />
                    </label>
                    {logFilterActive ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="ku-chip" data-testid="log-search-match-summary">
                          {logSearchMatches.length > 0 ? `${activeLogMatchNumber} / ${logSearchMatches.length} matches` : '0 matches'}
                        </span>
                        <div className="grid grid-cols-2 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white/75 p-0.5" aria-label="로그 검색 매치 이동">
                          <button
                            className="inline-flex items-center justify-center gap-1 rounded-[6px] px-2 py-1 text-[10px] font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
                            type="button"
                            onClick={() => moveActiveLogMatch(-1)}
                            disabled={logSearchMatches.length === 0}
                            aria-label="이전 로그 검색 매치"
                            data-testid="log-search-previous"
                          >
                            <ArrowUp size={12} aria-hidden="true" />
                            이전
                          </button>
                          <button
                            className="inline-flex items-center justify-center gap-1 rounded-[6px] px-2 py-1 text-[10px] font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
                            type="button"
                            onClick={() => moveActiveLogMatch(1)}
                            disabled={logSearchMatches.length === 0}
                            aria-label="다음 로그 검색 매치"
                            data-testid="log-search-next"
                          >
                            <ArrowDown size={12} aria-hidden="true" />
                            다음
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="로그 시간 범위">
                    {eventTimeRangeOptions.map((option) => (
                      <button
                        key={option.value}
                        className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                          logTimeRangeFilter === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                        }`}
                        type="button"
                        onClick={() => {
                          setLogTimeRangeFilter(option.value);
                          setActiveLogMatchIndex(0);
                          setLogCopyStatus(null);
                        }}
                        aria-pressed={logTimeRangeFilter === option.value}
                        data-testid={`log-time-range-${option.value}`}
                        title={option.value === 'all' ? '모든 로그 보기' : `최근 ${option.label} 로그만 보기`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="로그 정렬">
                    {logSortOptions.map((option) => (
                      <button
                        key={option.value}
                        className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                          logSortOrder === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                        }`}
                        type="button"
                        onClick={() => {
                          setLogSortOrder(option.value);
                          setActiveLogMatchIndex(0);
                          setLogCopyStatus(null);
                        }}
                        aria-pressed={logSortOrder === option.value}
                        data-testid={`log-sort-${option.value}`}
                        title={`로그 ${option.label} 보기`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="ku-chip">
                      {filteredLogLines.length} / {logLines.length}
                    </span>
                    {logControlsActive ? (
                      <button
                        className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                        type="button"
                        onClick={() => {
                          setLogFilter('');
                          setActiveLogMatchIndex(0);
                          setLogTimeRangeFilter('all');
                          setLogSortOrder('received');
                          setLogCopyStatus(null);
                        }}
                      >
                        초기화
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {logLines.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-55"
                    type="button"
                    onClick={() => void handleCopyLogs('visible')}
                    disabled={!canCopyVisibleLogs}
                  >
                    <Copy size={13} aria-hidden="true" />
                    표시 로그 복사
                  </button>
                  {canCopyAllLogs ? (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                      type="button"
                      onClick={() => void handleCopyLogs('all')}
                    >
                      <Copy size={13} aria-hidden="true" />
                      전체 로그 복사
                    </button>
                  ) : null}
                  <button
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-55"
                    type="button"
                    onClick={() => handleDownloadLogs('visible')}
                    disabled={!canDownloadVisibleLogs}
                  >
                    <Download size={13} aria-hidden="true" />
                    표시 로그 다운로드
                  </button>
                  {canDownloadAllLogs ? (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                      type="button"
                      onClick={() => handleDownloadLogs('all')}
                    >
                      <Download size={13} aria-hidden="true" />
                      전체 로그 다운로드
                    </button>
                  ) : null}
                  {logCopyStatus ? (
                    <span
                      className={`rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold ${
                        logCopyStatus.tone === 'success'
                          ? 'border-[rgba(52,199,89,0.24)] bg-[rgba(52,199,89,0.1)] text-[#19783b]'
                          : 'border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] text-[#8a4d00]'
                      }`}
                    >
                      {logCopyStatus.message}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {logsWarning ? <InlineWarning message="로그 조회 권한이 없거나 API가 없어 빈 목록으로 표시합니다." /> : null}
              {logsError ? <InlineWarning message={`로그 조회 실패: ${logsError}`} /> : null}
              {logLines.length === 0 ? (
                <p className="ku-meta">표시할 로그가 없습니다.</p>
              ) : filteredLogLines.length === 0 ? (
                <p className="ku-meta">필터와 일치하는 로그가 없습니다.</p>
              ) : (
                <div className={logViewportClassName}>
                  {filteredLogLines.map(({ line, message, index, timestamp }) => {
                    const activeTimestampMatch = activeLogMatch?.lineIndex === index && activeLogMatch.field === 'timestamp' ? activeLogMatch : undefined;
                    const activeMessageMatch = activeLogMatch?.lineIndex === index && activeLogMatch.field === 'message' ? activeLogMatch : undefined;
                    const activeRow = Boolean(activeTimestampMatch || activeMessageMatch);
                    return (
                      <div
                        key={`${index}:${line.slice(0, 16)}`}
                        ref={(node) => {
                          logLineRefs.current[index] = node;
                        }}
                        className={`${logRowClassName} ${activeRow ? 'bg-[rgba(255,214,10,0.12)] ring-1 ring-[rgba(255,214,10,0.28)]' : ''}`}
                        data-testid={activeRow ? 'active-log-search-line' : undefined}
                      >
                        <span className="select-none text-right text-[rgba(209,213,219,0.42)]">{index + 1}</span>
                        <span className="min-w-0 whitespace-pre-wrap break-words">
                          {timestamp ? (
                            <span className="mr-2 inline-flex rounded-[5px] bg-[rgba(96,165,250,0.16)] px-1.5 py-0.5 text-[rgba(191,219,254,0.9)]">
                              {renderHighlightedText(formatLogTimestamp(timestamp), normalizedLogFilter, activeTimestampMatch)}
                            </span>
                          ) : null}
                          {renderHighlightedText(message || line || ' ', normalizedLogFilter, activeMessageMatch)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </DetailSection>
      </div>
    </div>
  );
}

function InlineWarning({ message }: { message: string }) {
  return (
    <p className="mb-2 flex items-start gap-1.5 rounded-[9px] border border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] px-2 py-1.5 text-xs font-semibold text-[#8a4d00]">
      <AlertTriangle className="mt-0.5 shrink-0" size={13} aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

function EventSeverityChips({ counts }: { counts: Record<EventSeverity, number> }) {
  return (
    <>
      {counts.warning > 0 ? (
        <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#9a5a00]">Warning {counts.warning}</span>
      ) : null}
      {counts.normal > 0 ? <span className="ku-chip">Normal {counts.normal}</span> : null}
      {counts.other > 0 ? <span className="ku-chip">Other {counts.other}</span> : null}
    </>
  );
}

function HealthSignalPanel({ signals }: { signals: HealthSignal[] }) {
  if (signals.length === 0) {
    return null;
  }
  return (
    <div className="mb-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Health Signals">
      {signals.slice(0, 6).map((signal) => (
        <div key={`${signal.label}:${signal.value}`} className={`min-w-0 rounded-[10px] border px-2.5 py-2 ${healthSignalToneClassName(signal.tone)}`}>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="truncate font-mono text-[9px] font-semibold uppercase tracking-[0.04em] text-[rgba(60,60,67,0.56)]">{signal.label}</p>
            <span className={healthSignalBadgeClassName(signal.tone)}>{signal.tone}</span>
          </div>
          <p className="mt-1 truncate text-xs font-semibold text-[#1d1d1f]" title={signal.value}>
            {signal.value}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.58)]" title={signal.helper}>
            {signal.helper}
          </p>
        </div>
      ))}
    </div>
  );
}

function ResourceDetailOverview({ items }: { items: DetailOverviewItem[] }) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="리소스 상세 요약">
      {items.map((item) => (
        <div key={item.label} className={`min-w-0 rounded-[10px] border px-2.5 py-2 ${detailOverviewToneClassName(item.tone)}`}>
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.04em] text-[rgba(60,60,67,0.52)]">{item.label}</p>
          <p className="mt-1 truncate text-xs font-semibold text-[#1d1d1f]" title={item.value}>
            {item.value}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.56)]" title={item.helper}>
            {item.helper}
          </p>
        </div>
      ))}
    </div>
  );
}

function resourceDetailOverviewItems({
  annotations,
  canFetchLogs,
  effectiveLogContainer,
  eventSeverityCounts,
  eventSummary,
  healthSignals,
  logSummary,
  labels,
  metadataPreview,
  relationCount,
  resource,
}: {
  annotations: Record<string, string>;
  canFetchLogs: boolean;
  effectiveLogContainer: string;
  eventSeverityCounts: Record<EventSeverity, number>;
  eventSummary: string;
  healthSignals: HealthSignal[];
  logSummary: string;
  labels: Record<string, string>;
  metadataPreview: Record<string, unknown>;
  relationCount: number;
  resource: ResourceExplorerItem;
}): DetailOverviewItem[] {
  const namespace = resource.namespace || (resource.kind === 'Namespace' ? resource.name : 'cluster-scoped');
  const age = overviewScalar(metadataPreview.age, 'unknown');
  const uid = overviewScalar(metadataPreview.uid, 'unknown');
  const owners = overviewList(metadataPreview.owners, 'none');
  const labelCount = visibleValueCount(labels);
  const annotationCount = visibleValueCount(annotations);
  const logContext = canFetchLogs ? `Logs ${effectiveLogContainer ? `${effectiveLogContainer} · ` : ''}${logSummary}` : 'Logs n/a';
  const eventSignal = eventSeverityCounts.warning > 0 ? `${eventSeverityCounts.warning} warning` : `Events ${eventSummary}`;
  const primaryHealthSignal = healthSignals[0] ?? fallbackHealthSignal(resource);
  const healthTone = primaryHealthSignal.tone === 'error' ? 'error' : primaryHealthSignal.tone === 'warning' || eventSeverityCounts.warning > 0 ? 'warning' : relationCount > 0 ? 'accent' : 'default';
  return [
    {
      label: 'Scope',
      value: namespace,
      helper: `${resource.clusterId} · ${resource.kind}`,
      tone: 'accent',
    },
    {
      label: 'Age / UID',
      value: age,
      helper: `UID ${uid}`,
    },
    {
      label: 'Owner / Tags',
      value: owners,
      helper: `${labelCount} labels · ${annotationCount} annotations`,
    },
    {
      label: 'Signals',
      value: primaryHealthSignal.value,
      helper: `${primaryHealthSignal.helper} · ${relationCount} rel · ${eventSignal} · ${logContext}`,
      tone: healthTone,
    },
  ];
}

function detailOverviewToneClassName(tone: DetailOverviewItem['tone']) {
  if (tone === 'accent') {
    return 'border-[rgba(0,122,255,0.16)] bg-[rgba(0,122,255,0.055)]';
  }
  if (tone === 'warning') {
    return 'border-[rgba(255,149,0,0.18)] bg-[rgba(255,149,0,0.07)]';
  }
  if (tone === 'error') {
    return 'border-[rgba(255,59,48,0.18)] bg-[rgba(255,59,48,0.07)]';
  }
  return 'border-[rgba(60,60,67,0.1)] bg-white/70';
}

function detailSectionToneClassName(active: boolean, tone: DetailSectionTone) {
  if (tone === 'error') {
    return active
      ? 'border-[rgba(255,59,48,0.34)] bg-white/72 ring-2 ring-[rgba(255,59,48,0.12)]'
      : 'border-[rgba(255,59,48,0.22)] bg-[rgba(255,59,48,0.035)]';
  }
  if (tone === 'warning') {
    return active
      ? 'border-[rgba(255,149,0,0.34)] bg-white/72 ring-2 ring-[rgba(255,149,0,0.12)]'
      : 'border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.035)]';
  }
  return active ? 'border-[rgba(0,122,255,0.34)] bg-white/72 ring-2 ring-[rgba(0,122,255,0.12)]' : 'border-[rgba(60,60,67,0.12)] bg-white/72';
}

function resourceHealthSignals(resource: ResourceExplorerItem, statusPreview: Record<string, unknown>, summaryPreview: Record<string, unknown>): HealthSignal[] {
  const facts = { ...summaryPreview, ...statusPreview };
  const signals: HealthSignal[] = [];
  const addSignal = (signal: HealthSignal) => {
    if (!signals.some((existing) => existing.label === signal.label && existing.value === signal.value)) {
      signals.push(signal);
    }
  };
  const statusTone = healthToneFromStatus(resource.status);
  const addGenericHealth = () => {
    addSignal({
      label: 'Health',
      value: statusTitle(resource.status),
      helper: `${resource.kind} status`,
      tone: statusTone,
    });
  };

  if (resource.kind === 'Pod') {
    const phase = factScalar(facts, 'phase', resource.status === 'healthy' ? 'Running' : 'unknown');
    const ready = ratioFromValue(firstFact(facts, ['ready']));
    const restarts = numberFromValue(firstFact(facts, ['restarts']));
    const node = factScalar(facts, 'node', 'unassigned');
    if (resource.status === 'error') {
      addSignal({ label: 'Health', value: `Pod ${phase}`, helper: 'pod phase/status indicates failure', tone: 'error' });
    } else if (ready && ready.ready < ready.total) {
      addSignal({ label: 'Health', value: 'Pod not ready', helper: `${ready.ready}/${ready.total} containers ready`, tone: 'warning' });
    } else if (phase !== 'Running' && phase !== 'Succeeded' && phase !== 'unknown') {
      addSignal({ label: 'Health', value: `Pod ${phase}`, helper: 'phase is not Running', tone: resource.status === 'healthy' ? 'default' : 'warning' });
    } else {
      addSignal({ label: 'Health', value: phase === 'Succeeded' ? 'Pod completed' : 'Pod ready', helper: ready ? `${ready.ready}/${ready.total} containers ready` : `phase ${phase}`, tone: resource.status === 'healthy' ? 'healthy' : statusTone });
    }
    if (restarts > 0) {
      addSignal({ label: 'Restarts', value: `${restarts}`, helper: 'container restart count', tone: restarts >= 3 || resource.status !== 'healthy' ? 'warning' : 'default' });
    }
    if (node !== 'unassigned') {
      addSignal({ label: 'Node', value: node, helper: 'scheduled node', tone: 'accent' });
    }
    addConditionSignal(addSignal, facts);
  } else if (['Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'HorizontalPodAutoscaler'].includes(resource.kind)) {
    const replicas = ratioFromValue(firstFact(facts, ['replicas', 'ready']));
    if (replicas) {
      addSignal({
        label: 'Replicas',
        value: `${replicas.ready}/${replicas.total}`,
        helper: replicas.ready < replicas.total ? 'ready replicas below desired' : 'ready replicas match desired',
        tone: replicas.ready < replicas.total ? 'warning' : 'healthy',
      });
    } else {
      addGenericHealth();
    }
    const target = factScalar(facts, 'target', '');
    if (target) {
      addSignal({ label: 'Target', value: target, helper: 'scale target', tone: 'accent' });
    }
    const range = factScalar(facts, 'range', '');
    if (range) {
      addSignal({ label: 'Range', value: range, helper: 'configured replica range', tone: 'default' });
    }
  } else if (resource.kind === 'Service') {
    const endpoints = ratioFromValue(firstFact(facts, ['readyEndpoints', 'endpoints']));
    if (endpoints) {
      const emptyEndpoints = endpoints.total === 0 || endpoints.ready === 0;
      addSignal({
        label: 'Endpoints',
        value: `${endpoints.ready}/${endpoints.total}`,
        helper: emptyEndpoints ? 'no ready endpoints' : endpoints.ready < endpoints.total ? 'some endpoints are not ready' : 'ready endpoints match total',
        tone: emptyEndpoints ? (resource.status === 'error' ? 'error' : 'warning') : endpoints.ready < endpoints.total ? 'warning' : 'healthy',
      });
    } else if (resource.status === 'unknown') {
      addSignal({ label: 'Endpoints', value: 'unknown', helper: 'selector or endpoints unavailable', tone: 'default' });
    } else {
      addGenericHealth();
    }
    const serviceType = factScalar(facts, 'type', '');
    if (serviceType) {
      addSignal({ label: 'Type', value: serviceType, helper: 'service type', tone: 'accent' });
    }
  } else if (['PersistentVolumeClaim', 'PersistentVolume'].includes(resource.kind)) {
    const phase = factScalar(facts, 'phase', resource.status === 'healthy' ? 'Bound' : 'unknown');
    addSignal({
      label: 'Storage',
      value: phase === 'unknown' ? statusTitle(resource.status) : phase,
      helper: storageHealthHelper(facts),
      tone: resource.status === 'error' ? 'error' : resource.status === 'warning' || (phase !== 'Bound' && phase !== 'Available' && phase !== 'unknown') ? 'warning' : resource.status === 'healthy' ? 'healthy' : 'default',
    });
    const storageClass = factScalar(facts, 'storageClass', '');
    if (storageClass) {
      addSignal({ label: 'Class', value: storageClass, helper: 'storage class', tone: 'default' });
    }
  } else if (resource.kind === 'Job') {
    const failed = numberFromValue(firstFact(facts, ['failed']));
    const succeeded = numberFromValue(firstFact(facts, ['succeeded']));
    const completions = numberFromValue(firstFact(facts, ['completions']));
    if (failed > 0) {
      addSignal({ label: 'Job', value: 'Failed', helper: `${failed} failed attempts`, tone: 'error' });
    } else if (completions > 0) {
      addSignal({ label: 'Job', value: `${succeeded}/${completions}`, helper: 'succeeded completions', tone: succeeded >= completions ? 'healthy' : 'warning' });
    } else {
      addGenericHealth();
    }
  } else if (resource.kind === 'CronJob') {
    addSignal({ label: 'Schedule', value: factScalar(facts, 'schedule', 'unknown'), helper: `${factScalar(facts, 'active', '0')} active jobs`, tone: resource.status === 'healthy' ? 'healthy' : statusTone });
  } else if (['Ingress', 'Gateway', 'HTTPRoute', 'GRPCRoute', 'TLSRoute', 'TCPRoute'].includes(resource.kind)) {
    addSignal({ label: 'Routing', value: routeSignalValue(facts), helper: routeSignalHelper(facts), tone: resource.status === 'healthy' ? 'healthy' : statusTone });
  } else if (resource.kind === 'NetworkPolicy') {
    addSignal({ label: 'Policy', value: factScalar(facts, 'policyTypes', 'NetworkPolicy'), helper: networkPolicyHealthHelper(facts), tone: resource.status === 'healthy' ? 'healthy' : statusTone });
  } else if (resource.kind === 'CustomResource') {
    const conditions = factScalar(facts, 'conditions', '');
    addSignal({ label: 'CustomResource', value: conditions || statusTitle(resource.status), helper: customResourceHealthHelper(facts), tone: conditions.includes('False') || conditions.includes('Unknown') ? 'warning' : resource.status === 'healthy' ? 'healthy' : statusTone });
  } else {
    addGenericHealth();
  }

  if (signals.length === 0) {
    addGenericHealth();
  }
  return signals.slice(0, 6);
}

function fallbackHealthSignal(resource: ResourceExplorerItem): HealthSignal {
  return {
    label: 'Health',
    value: statusTitle(resource.status),
    helper: `${resource.kind} status`,
    tone: healthToneFromStatus(resource.status),
  };
}

function healthSectionSummary(resource: ResourceExplorerItem, signals: HealthSignal[], statusPreview: Record<string, unknown>) {
  if (resource.status === 'error' || resource.status === 'warning') {
    return resource.status;
  }
  const issue = signals.find((signal) => signal.tone === 'error' || signal.tone === 'warning');
  if (issue) {
    return issue.tone;
  }
  return sectionCount(statusPreview);
}

function healthSignalSectionTone(resource: ResourceExplorerItem, signals: HealthSignal[]): DetailSectionTone {
  if (resource.status === 'error' || signals.some((signal) => signal.tone === 'error')) {
    return 'error';
  }
  if (resource.status === 'warning' || signals.some((signal) => signal.tone === 'warning')) {
    return 'warning';
  }
  return 'default';
}

function healthToneFromStatus(status: string): HealthSignal['tone'] {
  if (status === 'error') {
    return 'error';
  }
  if (status === 'warning') {
    return 'warning';
  }
  if (status === 'healthy') {
    return 'healthy';
  }
  return 'default';
}

function healthSignalToneClassName(tone: HealthSignal['tone']) {
  if (tone === 'healthy') {
    return 'border-[rgba(52,199,89,0.18)] bg-[rgba(52,199,89,0.06)]';
  }
  if (tone === 'accent') {
    return 'border-[rgba(0,122,255,0.16)] bg-[rgba(0,122,255,0.055)]';
  }
  if (tone === 'warning') {
    return 'border-[rgba(255,149,0,0.2)] bg-[rgba(255,149,0,0.075)]';
  }
  if (tone === 'error') {
    return 'border-[rgba(255,59,48,0.2)] bg-[rgba(255,59,48,0.075)]';
  }
  return 'border-[rgba(60,60,67,0.1)] bg-white/70';
}

function healthSignalBadgeClassName(tone: HealthSignal['tone']) {
  if (tone === 'healthy') {
    return 'rounded-full bg-[rgba(52,199,89,0.12)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase text-[#248a3d]';
  }
  if (tone === 'accent') {
    return 'rounded-full bg-[rgba(0,122,255,0.1)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase text-[#0057b8]';
  }
  if (tone === 'warning') {
    return 'rounded-full bg-[rgba(255,149,0,0.12)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase text-[#9a5a00]';
  }
  if (tone === 'error') {
    return 'rounded-full bg-[rgba(255,59,48,0.12)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase text-[#b42318]';
  }
  return 'rounded-full bg-[rgba(142,142,147,0.12)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase text-[#636366]';
}

function addConditionSignal(addSignal: (signal: HealthSignal) => void, facts: Record<string, unknown>) {
  const conditions = factScalar(facts, 'conditions', '');
  if (!conditions) {
    return;
  }
  addSignal({
    label: 'Conditions',
    value: conditions,
    helper: 'condition summary',
    tone: conditions.includes('False') || conditions.includes('Unknown') ? 'warning' : 'default',
  });
}

function routeSignalValue(facts: Record<string, unknown>) {
  const hosts = factScalar(facts, 'hosts', factScalar(facts, 'host', 'route'));
  return hosts || 'route';
}

function routeSignalHelper(facts: Record<string, unknown>) {
  const pieces = [
    factScalar(facts, 'listeners', '') ? `${factScalar(facts, 'listeners', '')} listeners` : '',
    factScalar(facts, 'rules', '') ? `${factScalar(facts, 'rules', '')} rules` : '',
    factScalar(facts, 'backends', '') ? `${factScalar(facts, 'backends', '')} backends` : '',
  ].filter(Boolean);
  return pieces.length > 0 ? pieces.join(' · ') : 'routing summary';
}

function networkPolicyHealthHelper(facts: Record<string, unknown>) {
  const ingress = factScalar(facts, 'ingress', '');
  const egress = factScalar(facts, 'egress', '');
  if (ingress && egress) {
    return 'ingress and egress intent';
  }
  return ingress || egress || 'policy intent summary';
}

function customResourceHealthHelper(facts: Record<string, unknown>) {
  const specFields = factScalar(facts, 'specFields', '');
  const statusFields = factScalar(facts, 'statusFields', '');
  return [specFields ? `${specFields} spec fields` : '', statusFields ? `${statusFields} status fields` : ''].filter(Boolean).join(' · ') || 'safe custom resource summary';
}

function storageHealthHelper(facts: Record<string, unknown>) {
  return [factScalar(facts, 'storage', ''), factScalar(facts, 'capacity', ''), factScalar(facts, 'volume', ''), factScalar(facts, 'mode', '')].filter(Boolean).join(' · ') || 'storage summary';
}

function statusTitle(status: string) {
  if (!status) {
    return 'Unknown';
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function firstFact(values: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = values[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function factScalar(values: Record<string, unknown>, key: string, fallback: string) {
  return overviewScalar(values[key], fallback);
}

function numberFromValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function ratioFromValue(value: unknown): { ready: number; total: number } | null {
  if (typeof value === 'boolean') {
    return { ready: value ? 1 : 0, total: 1 };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { ready: value, total: value };
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) {
    return null;
  }
  return { ready: Number(match[1]), total: Number(match[2]) };
}

function overviewScalar(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (Array.isArray(value)) {
    return overviewList(value, fallback);
  }
  if (typeof value === 'object') {
    return fallback;
  }
  return String(value);
}

function overviewList(value: unknown, fallback: string): string {
  if (!Array.isArray(value)) {
    return overviewScalar(value, fallback);
  }
  const values = value.flatMap((item) => {
    if (item === undefined || item === null || item === '') {
      return [];
    }
    if (typeof item === 'object') {
      return [];
    }
    return [String(item)];
  });
  if (values.length === 0) {
    return fallback;
  }
  const visibleValues = values.slice(0, 2).join(', ');
  return values.length > 2 ? `${visibleValues} +${values.length - 2}` : visibleValues;
}

function parseLogLines(lines: string[]): ParsedLogLine[] {
  return lines.map((line, index) => parseLogLine(line, index));
}

function parseLogLine(line: string, index: number): ParsedLogLine {
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

function parseLogTimestampPrefix(line: string) {
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

function filterLogLines(lines: ParsedLogLine[], filter: string, timeRangeFilter: LogTimeRangeFilter, nowMs: number) {
  const normalizedFilter = filter.trim().toLowerCase();
  return lines.filter((line) => {
    if (!logMatchesTimeRangeFilter(line, timeRangeFilter, nowMs)) {
      return false;
    }
    return !normalizedFilter || logLineText(line).includes(normalizedFilter);
  });
}

function sortLogLines(lines: ParsedLogLine[], sortOrder: LogSortOrder) {
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

function logMatchesTimeRangeFilter(line: ParsedLogLine, timeRangeFilter: LogTimeRangeFilter, nowMs: number) {
  if (timeRangeFilter === 'all') {
    return true;
  }
  const option = eventTimeRangeOptions.find((candidate) => candidate.value === timeRangeFilter);
  if (!option?.milliseconds) {
    return true;
  }
  return line.timestampMs !== null && line.timestampMs >= nowMs - option.milliseconds;
}

function logLineText(line: ParsedLogLine) {
  return [line.line, line.message, line.timestamp, line.timestamp ? formatLogTimestamp(line.timestamp) : ''].join(' ').toLowerCase();
}

function collectLogSearchMatches(lines: ParsedLogLine[], filter: string): LogSearchMatch[] {
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

function collectLogSearchMatchesForText(text: string, normalizedFilter: string, lineIndex: number, field: LogSearchMatch['field']) {
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

function logDownloadFileName(resource: ResourceExplorerItem, container: string, previousLogs: boolean) {
  const namespace = safeFileSlug(resource.namespace || 'cluster', 'cluster');
  const pod = safeFileSlug(resource.name, 'pod');
  const containerName = safeFileSlug(container || 'default', 'default');
  const mode = previousLogs ? 'previous' : 'current';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `kuviewer-logs-${namespace}-${pod}-${containerName}-${mode}-${timestamp}.log`;
}

function eventExportFileName(resource: ResourceExplorerItem, format: EventExportFormat) {
  const namespace = safeFileSlug(resource.namespace || 'cluster', 'cluster');
  const kind = safeFileSlug(resource.kind, 'resource');
  const name = safeFileSlug(resource.name, 'resource');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `kuviewer-events-${namespace}-${kind}-${name}-${timestamp}.${format}`;
}

function eventExportRows(items: EventListItem[]): EventExportRow[] {
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

function eventExportCsv(items: EventListItem[]) {
  const header: Array<keyof EventExportRow> = ['timestamp', 'type', 'severity', 'reason', 'source', 'message', 'pinned'];
  const rows = eventExportRows(items).map((row) => header.map((key) => eventCsvCell(row[key])).join(','));
  return `${header.join(',')}\n${rows.join('\n')}\n`;
}

function eventExportJson(items: EventListItem[]) {
  return `${JSON.stringify(eventExportRows(items), null, 2)}\n`;
}

function eventCsvCell(value: unknown) {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadTextFile(content: string, mimeType: string, fileName: string) {
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

function safeFileSlug(value: string, fallback: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function filterEvents(events: ResourceEvent[], filter: string, severityFilter: EventSeverityFilter, timeRangeFilter: EventTimeRangeFilter, nowMs: number) {
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

function sortEventListItems(events: EventListItem[], sortOrder: EventSortOrder, pinnedEventKeys: Set<string>) {
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

function sortableEventTimestamp(event: ResourceEvent) {
  const value = Date.parse(event.timestamp);
  return Number.isNaN(value) ? null : value;
}

function eventListItemId(event: ResourceEvent, index: number) {
  return `${eventIdentityKey(event)}\u001f${index}`;
}

function eventIdentityKey(event: ResourceEvent) {
  return [event.timestamp, event.type, event.reason, event.source, event.message]
    .map((part) => part.trim())
    .join('\u001f');
}

function updateEventNotificationState(
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

function eventMatchesSeverityFilter(event: ResourceEvent, severityFilter: EventSeverityFilter) {
  if (severityFilter === 'all') {
    return true;
  }
  return eventSeverity(event) === severityFilter;
}

function eventMatchesTimeRangeFilter(event: ResourceEvent, timeRangeFilter: EventTimeRangeFilter, nowMs: number) {
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

function eventSeverity(event: ResourceEvent): EventSeverity {
  const normalizedType = event.type.trim().toLowerCase();
  if (normalizedType === 'warning' || normalizedType === 'error') {
    return 'warning';
  }
  if (normalizedType === 'normal') {
    return 'normal';
  }
  return 'other';
}

function countEventSeverities(events: ResourceEvent[]) {
  return events.reduce(
    (counts, event) => {
      counts[eventSeverity(event)] += 1;
      return counts;
    },
    { warning: 0, normal: 0, other: 0 } as Record<EventSeverity, number>,
  );
}

function countNewEvents(events: ResourceEvent[], newEventKeys: Set<string>) {
  return events.reduce((count, event) => (newEventKeys.has(eventIdentityKey(event)) ? count + 1 : count), 0);
}

function groupEventsBySeverity(events: EventListItem[]): EventGroup[] {
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

function eventSeverityBadgeClassName(severity: EventSeverity) {
  if (severity === 'warning') {
    return 'rounded-full border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#9a5a00]';
  }
  if (severity === 'normal') {
    return 'rounded-full border border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.09)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#248a3d]';
  }
  return 'rounded-full border border-[rgba(142,142,147,0.22)] bg-[rgba(142,142,147,0.09)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#636366]';
}

function eventSectionSummary(visibleCount: number, totalCount: number, counts: Record<EventSeverity, number>) {
  const base = `${visibleCount} / ${totalCount}`;
  if (counts.warning > 0) {
    return `${base} · ${counts.warning} warn`;
  }
  if (totalCount > 0 && counts.other > 0) {
    return `${base} · ${counts.other} other`;
  }
  return base;
}

function eventControlSummary(filter: string, severityFilter: EventSeverityFilter, timeRangeFilter: EventTimeRangeFilter, sortOrder: EventSortOrder, pinnedCount: number, showNewOnly: boolean) {
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

function eventText(event: ResourceEvent) {
  return [event.type, event.reason, event.message, event.source, event.timestamp, formatEventTimestamp(event.timestamp)].join(' ').toLowerCase();
}

function filterRelatedResources(relations: ResourceExplorerItem['related'], filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return relations;
  }
  return relations.filter((relation) => relationText(relation).includes(normalizedFilter));
}

function relationText(relation: ResourceExplorerItem['related'][number]) {
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

function groupRelatedResources(relations: ResourceExplorerItem['related'], visibleLimit: number): RelationGroup[] {
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

function renderHighlightedText(text: string, filter: string, activeMatch?: Pick<LogSearchMatch, 'start' | 'end'>, activeTestId = 'active-log-search-match'): ReactNode {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return text || ' ';
  }

  const lowerText = text.toLowerCase();
  const fragments: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(normalizedFilter, cursor);
  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      fragments.push(text.slice(cursor, matchIndex));
    }
    const matchEnd = matchIndex + normalizedFilter.length;
    const active = activeMatch?.start === matchIndex && activeMatch.end === matchEnd;
    fragments.push(
      <mark
        key={`${matchIndex}:${matchEnd}`}
        className={`rounded-[3px] px-0.5 text-[#1d1d1f] ${active ? 'bg-[#ff9500] ring-1 ring-[#ffd60a]' : 'bg-[#ffd60a]'}`}
        data-testid={active ? activeTestId : undefined}
      >
        {text.slice(matchIndex, matchEnd)}
      </mark>,
    );
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(normalizedFilter, cursor);
  }
  if (cursor < text.length) {
    fragments.push(text.slice(cursor));
  }
  return fragments.length > 0 ? fragments : ' ';
}

function sectionCount(values: Record<string, unknown>) {
  return `${visibleValueCount(values)}`;
}

function visibleValueCount(values: Record<string, unknown>) {
  return Object.entries(values).filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)).length;
}

function keyValueEntries(values: Record<string, unknown>): KeyValueEntry[] {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0))
    .map(([key, value]) => ({ key, valueText: formatValue(value) }));
}

function collectKeyValueSearchMatches(entries: KeyValueEntry[], filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return [];
  }
  return entries.flatMap((entry, entryIndex) => [
    ...collectKeyValueSearchMatchesForText(entry.key, normalizedFilter, entryIndex, 'key'),
    ...collectKeyValueSearchMatchesForText(entry.valueText, normalizedFilter, entryIndex, 'value'),
  ]);
}

function collectKeyValueSearchMatchesForText(text: string, normalizedFilter: string, entryIndex: number, field: KeyValueSearchMatch['field']) {
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

function keyValueEntryMatchesFilter(entry: KeyValueEntry, filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return true;
  }
  return entry.key.toLowerCase().includes(normalizedFilter) || entry.valueText.toLowerCase().includes(normalizedFilter);
}

function ResourceSelect({ label, testId, value, values, onChange }: { label: string; testId: string; value: string; values: string[]; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="ku-meta">{label}</span>
      <select className="ku-select" value={value} data-testid={testId} onChange={(event) => onChange(event.target.value)}>
        <option value={allValue}>전체</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResourceViewCompareNames({ title, names, testId }: { title: string; names: string[]; testId: string }) {
  const visibleNames = names.slice(0, 3);
  return (
    <div className="grid gap-1 rounded-[9px] border border-[rgba(60,60,67,0.1)] bg-white/72 p-2" data-testid={testId}>
      <p className="ku-meta">{title} · {names.length}</p>
      {visibleNames.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {visibleNames.map((name) => (
            <span key={name} className="max-w-full truncate rounded-full bg-[rgba(60,60,67,0.06)] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[rgba(60,60,67,0.64)]">
              {name}
            </span>
          ))}
          {names.length > visibleNames.length ? (
            <span className="rounded-full bg-[rgba(60,60,67,0.06)] px-1.5 py-0.5 text-[9px] font-semibold text-[rgba(60,60,67,0.56)]">
              +{names.length - visibleNames.length} more
            </span>
          ) : null}
        </div>
      ) : (
        <p className="font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.48)]">none</p>
      )}
    </div>
  );
}

function readResourceListDensityPreference(): ResourceListDensity {
  try {
    return window.localStorage.getItem(resourceListDensityStorageKey) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function writeResourceListDensityPreference(density: ResourceListDensity) {
  try {
    window.localStorage.setItem(resourceListDensityStorageKey, density);
  } catch {
    // Density is only a UI preference; storage failures should not break the explorer.
  }
}

function readResourceListSortPreference(): ResourceListSortPreference {
  try {
    const rawValue = window.localStorage.getItem(resourceListSortStorageKey);
    if (!rawValue) {
      return defaultResourceListSortPreference;
    }
    const parsedValue = JSON.parse(rawValue) as Partial<ResourceListSortPreference>;
    return normalizeResourceListSortPreference(parsedValue);
  } catch {
    return defaultResourceListSortPreference;
  }
}

function writeResourceListSortPreference(sortPreference: ResourceListSortPreference) {
  try {
    window.localStorage.setItem(resourceListSortStorageKey, JSON.stringify(sortPreference));
  } catch {
    // Sorting is only a UI preference; storage failures should not break the explorer.
  }
}

function normalizeResourceListSortPreference(value: Partial<ResourceListSortPreference>): ResourceListSortPreference {
  const field = value.field && resourceListSortOptions.some((option) => option.value === value.field) ? value.field : defaultResourceListSortPreference.field;
  const direction = value.direction === 'desc' ? 'desc' : defaultResourceListSortPreference.direction;
  return { field, direction };
}

function readResourceListColumnPreference(): ResourceListColumnPreference {
  try {
    const rawValue = window.localStorage.getItem(resourceListColumnsStorageKey);
    if (!rawValue) {
      return { ...defaultResourceListColumns };
    }
    const parsedValue = JSON.parse(rawValue) as Partial<Record<ResourceListOptionalColumn, unknown>>;
    return normalizeResourceListColumnPreference(parsedValue);
  } catch {
    return { ...defaultResourceListColumns };
  }
}

function writeResourceListColumnPreference(columns: ResourceListColumnPreference) {
  try {
    window.localStorage.setItem(resourceListColumnsStorageKey, JSON.stringify(normalizeResourceListColumnPreference(columns)));
  } catch {
    // Column visibility is only a UI preference; storage failures should not break the explorer.
  }
}

function normalizeResourceListColumnPreference(value: Partial<Record<ResourceListOptionalColumn, unknown>>): ResourceListColumnPreference {
  return {
    namespace: typeof value.namespace === 'boolean' ? value.namespace : defaultResourceListColumns.namespace,
    cluster: typeof value.cluster === 'boolean' ? value.cluster : defaultResourceListColumns.cluster,
    age: typeof value.age === 'boolean' ? value.age : defaultResourceListColumns.age,
    summary: typeof value.summary === 'boolean' ? value.summary : defaultResourceListColumns.summary,
  };
}

function readResourceDetailDensityPreference(): ResourceDetailDensity {
  try {
    return window.localStorage.getItem(resourceDetailDensityStorageKey) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function writeResourceDetailDensityPreference(density: ResourceDetailDensity) {
  try {
    window.localStorage.setItem(resourceDetailDensityStorageKey, density);
  } catch {
    // Detail density is only a UI preference; storage failures should not break details.
  }
}

function readLogDensityPreference(): LogDensity {
  try {
    return window.localStorage.getItem(logDensityStorageKey) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function writeLogDensityPreference(density: LogDensity) {
  try {
    window.localStorage.setItem(logDensityStorageKey, density);
  } catch {
    // Density is only a UI preference; storage failures should not break logs.
  }
}

function readEventsAutoRefreshPreference() {
  try {
    return window.localStorage.getItem(eventsAutoRefreshStorageKey) === 'true';
  } catch {
    return false;
  }
}

function writeEventsAutoRefreshPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(eventsAutoRefreshStorageKey, enabled ? 'true' : 'false');
  } catch {
    // Events auto refresh is only a UI preference; storage failures should not break details.
  }
}

function readEventsWarningNotificationsPreference() {
  try {
    return window.localStorage.getItem(eventsWarningNotificationsStorageKey) === 'true';
  } catch {
    return false;
  }
}

function writeEventsWarningNotificationsPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(eventsWarningNotificationsStorageKey, enabled ? 'true' : 'false');
  } catch {
    // Events warning notifications are only a UI preference; storage failures should not break details.
  }
}

function readResourceViewPresets(): ResourceViewPreset[] {
  try {
    const rawValue = window.localStorage.getItem(resourceViewPresetStorageKey);
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

function writeResourceViewPresets(presets: ResourceViewPreset[]) {
  try {
    window.localStorage.setItem(resourceViewPresetStorageKey, JSON.stringify(normalizeResourceViewPresetOrders(presets).slice(0, maxResourceViewPresets)));
  } catch {
    // Presets are a convenience feature; quota/private-mode failures should not break the explorer.
  }
}

function readCollapsedResourceViewGroups(): Set<string> {
  try {
    const rawValue = window.localStorage.getItem(resourceViewPresetCollapsedGroupsStorageKey);
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

function writeCollapsedResourceViewGroups(groups: Set<string>) {
  try {
    window.localStorage.setItem(resourceViewPresetCollapsedGroupsStorageKey, JSON.stringify([...groups].sort()));
  } catch {
    // Group collapse state is only a UI preference.
  }
}

function resourceViewShareUrl(filters: ResourceViewFilters, sourceMode: TopologySourceMode) {
  const url = new URL(window.location.href);
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

function resourceViewPresetExportRecord(preset: ResourceViewPreset): ResourceViewPreset {
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

function resourceViewExportFileName(scope: 'all' | 'selected') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `kuviewer-resource-views-${scope}-${timestamp}.json`;
}

function resourceViewPresetFolderNames(presets: ResourceViewPreset[]) {
  return unique(presets.map((preset) => normalizeResourceViewPresetGroup(preset.group))).sort((left, right) => left.localeCompare(right));
}

function resourceViewImportItems(value: unknown): { format: 'array' | 'items'; items: unknown[] } | null {
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

function validResourceViewPreset(value: unknown, fallbackOrder = 1): ResourceViewPreset[] {
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

function mergeResourceViewPresets(existingPresets: ResourceViewPreset[], incomingPresets: ResourceViewPreset[], resolution: ResourceViewConflictResolution): ResourceViewMergeResult {
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

function buildResourceViewTeamComparePreview(action: 'load' | 'save', localPresets: ResourceViewPreset[], teamPresets: ResourceViewPreset[], invalidCount: number, snapshotMetadata?: ResourceViewTeamSnapshotMetadata): ResourceViewTeamComparePreview {
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

function resourceViewTeamSyncSummaryFromCompare(preview: ResourceViewTeamComparePreview): ResourceViewTeamSyncSummary {
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

function upsertResourceViewPreset(presets: ResourceViewPreset[], preset: ResourceViewPreset) {
  return normalizeResourceViewPresetOrders([preset, ...presets.filter((existingPreset) => existingPreset.name !== preset.name)].slice(0, maxResourceViewPresets));
}

function moveResourceViewPresetsToGroup(presets: ResourceViewPreset[], selectedNames: Set<string>, targetGroup: string) {
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

function normalizeResourceViewPresetOrders(presets: ResourceViewPreset[]) {
  return orderResourceViewPresets(presets).map((preset, index) => ({ ...preset, order: index + 1 }));
}

function orderResourceViewPresets(presets: ResourceViewPreset[]) {
  return presets
    .map((preset, index) => ({ preset: { ...preset, order: normalizeResourceViewPresetOrder(preset.order, index + 1) }, index }))
    .sort((left, right) => left.preset.order - right.preset.order || left.index - right.index)
    .map((entry) => entry.preset);
}

function resourceViewPresetTopOrderForGroup(presets: ResourceViewPreset[], groupName: string) {
  const normalizedGroup = normalizeResourceViewPresetGroup(groupName);
  const groupOrders = presets
    .filter((preset) => normalizeResourceViewPresetGroup(preset.group) === normalizedGroup)
    .map((preset) => normalizeResourceViewPresetOrder(preset.order, Number.POSITIVE_INFINITY));
  return groupOrders.length > 0 ? Math.min(...groupOrders) - 1 : 0;
}

function normalizeResourceViewPresetGroup(group: string) {
  const normalized = group.trim().slice(0, maxResourceViewGroupLength);
  return normalized || defaultResourceViewGroup;
}

function groupResourceViewPresets(presets: ResourceViewPreset[]) {
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

function filterGroupedResourceViewPresets(groups: ReturnType<typeof groupResourceViewPresets>, query: string) {
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

function resourceViewConflictPendingMessage(source: ResourceViewConflictSource, conflictCount: number, duplicateCount: number, invalidCount: number) {
  return `${resourceViewSourceLabel(source)} 충돌 ${conflictCount}개가 있습니다. 해결 방식을 선택하세요.${duplicateCount > 0 ? ` 중복 ${duplicateCount}개는 변경 없음으로 처리됩니다.` : ''}${invalidCount > 0 ? ` ${invalidCount}개 항목은 건너뛰었습니다.` : ''}`;
}

function resourceViewMergeMessage(source: ResourceViewConflictSource, result: ResourceViewMergeResult, invalidCount: number, resolved: boolean) {
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

function resourceViewTransferActionLabel(summary: ResourceViewTransferSummary) {
  if (summary.action === 'export') {
    return summary.scope === 'selected' ? 'Selected export' : 'All export';
  }
  return 'Import preview';
}

function resourceViewTeamSyncActionLabel(summary: ResourceViewTeamSyncSummary) {
  return summary.action === 'load' ? 'Team load' : 'Team save';
}

function resourceViewTeamCompareActionLabel(preview: ResourceViewTeamComparePreview) {
  return preview.action === 'load' ? 'Team load preview' : 'Team save preview';
}

function resourceViewTeamCompareMessage(preview: ResourceViewTeamComparePreview) {
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

function resourceViewSourceLabel(source: ResourceViewConflictSource) {
  return source === 'team' ? '팀 뷰' : '가져온 뷰';
}

function resourceViewSourceShortLabel(source: ResourceViewConflictSource) {
  return source === 'team' ? '팀' : '가져온 뷰';
}

function resourceViewIncomingNewCount(existingPresets: ResourceViewPreset[], incomingPresets: ResourceViewPreset[]) {
  const existingNames = new Set(existingPresets.map((preset) => preset.name));
  return incomingPresets.filter((preset) => !existingNames.has(preset.name)).length;
}

function resourceViewPresetTargetName(inputName: string, suggestedName: string) {
  return normalizeResourceViewPresetName(inputName) || normalizeResourceViewPresetName(suggestedName) || '전체 리소스';
}

function normalizeResourceViewPresetName(name: string) {
  return name.trim().slice(0, 80);
}

function resourceViewPresetDomId(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'view';
}

function resourceViewGroupDomId(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'group';
}

function resourceViewPresetMatchesFilters(preset: ResourceViewPreset, filters: Pick<ResourceViewPreset, 'query' | 'cluster' | 'namespace' | 'kind' | 'status'>) {
  return (
    preset.query === filters.query.slice(0, 160) &&
    preset.cluster === filters.cluster &&
    preset.namespace === filters.namespace &&
    preset.kind === filters.kind &&
    preset.status === filters.status
  );
}

function normalizePresetFilterValue(value: string, availableValues: string[]) {
  if (value === allValue || availableValues.includes(value)) {
    return value;
  }
  return allValue;
}

function suggestedResourceViewPresetName(filters: Pick<ResourceViewPreset, 'query' | 'cluster' | 'namespace' | 'kind' | 'status'>) {
  const parts = [
    filters.query.trim() ? `검색 ${filters.query.trim()}` : '',
    filters.cluster !== allValue ? filters.cluster : '',
    filters.namespace !== allValue ? filters.namespace : '',
    filters.kind !== allValue ? filters.kind : '',
    filters.status !== allValue ? filters.status : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ').slice(0, 80) : '전체 리소스';
}

function resourceViewPresetSummary(preset: ResourceViewPreset) {
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

function resourceViewTeamSnapshotMetadata(metadata: ResourceViewPresetApiMetadata | undefined, fallbackCount: number): ResourceViewTeamSnapshotMetadata | undefined {
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

function formatResourceViewTeamSnapshotMetadata(metadata: ResourceViewTeamSnapshotMetadata) {
  return `Snapshot v${metadata.version} · ${metadata.count} views · ${metadata.storage} · ${formatPresetUpdatedAt(metadata.updatedAt)}`;
}

function formatPresetUpdatedAt(updatedAt: number) {
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

function resourceOptionDomId(resourceId: string) {
  return `kuviewer-resource-${resourceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function isResourceListShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest('[data-resource-bulk-control="true"]')) {
    return true;
  }
  if (target.closest('[data-resource-row="true"]')) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'select' || tagName === 'textarea' || tagName === 'button' || target.isContentEditable;
}

function sortResourceList(resources: ResourceExplorerItem[], sortPreference: ResourceListSortPreference) {
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

function resourceListGridTemplate(columns: ResourceListColumnPreference) {
  const tracks = ['minmax(44px,0.32fr)', 'minmax(92px,0.72fr)', 'minmax(150px,1.45fr)'];
  if (columns.namespace) {
    tracks.push('minmax(92px,0.72fr)');
  }
  tracks.push('minmax(92px,0.72fr)');
  if (columns.cluster) {
    tracks.push('minmax(96px,0.82fr)');
  }
  if (columns.age) {
    tracks.push('minmax(74px,0.62fr)');
  }
  if (columns.summary) {
    tracks.push('minmax(150px,1.25fr)');
  }
  return tracks.join(' ');
}

function resourceListAge(resource: ResourceExplorerItem) {
  const metadata = recordFromUnknown(resource.preview.metadata);
  return resourceListCellValue(metadata.age);
}

function resourceListCellValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return '-';
}

function resourceBulkCopyName(resource: ResourceExplorerItem) {
  return `${resource.kind} ${resource.namespace ? `${resource.namespace}/` : ''}${resource.name}`;
}

function resourceBulkExportRows(resources: ResourceExplorerItem[]): ResourceBulkExportRow[] {
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

function resourceBulkExportJson(resources: ResourceExplorerItem[]) {
  return `${JSON.stringify(resourceBulkExportRows(resources), null, 2)}\n`;
}

function resourceBulkExportCsv(resources: ResourceExplorerItem[]) {
  const header: Array<keyof ResourceBulkExportRow> = ['cluster', 'namespace', 'kind', 'name', 'status', 'labelsCount', 'annotationsCount', 'summaryKeys', 'relatedCount'];
  const rows = resourceBulkExportRows(resources).map((row) => header.map((key) => eventCsvCell(Array.isArray(row[key]) ? row[key].join(';') : row[key])).join(','));
  return `${header.join(',')}\n${rows.join('\n')}\n`;
}

function resourceBulkExportFileName(format: 'json' | 'csv') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `kuviewer-resources-selected-${timestamp}.${format}`;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'select' || tagName === 'textarea' || tagName === 'button' || target.isContentEditable;
}

function ResourceDetailSectionNavigator({
  activeId,
  onFocusSection,
  openSections,
  sections,
  summaries,
  tones,
}: {
  activeId: DetailSectionId;
  onFocusSection: (id: DetailSectionId) => void;
  openSections: Set<DetailSectionId>;
  sections: Array<{ id: DetailSectionId; label: string }>;
  summaries: Record<DetailSectionId, string>;
  tones: Record<DetailSectionId, DetailSectionTone>;
}) {
  return (
    <div
      className="mt-3 grid gap-2 rounded-[12px] border border-[rgba(60,60,67,0.1)] bg-[rgba(242,242,247,0.42)] p-2"
      data-testid="resource-detail-section-navigator"
      aria-label="리소스 상세 섹션 목차"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="ku-meta">Detail sections</p>
        <span className="ku-chip" data-testid="resource-detail-section-navigator-count">
          {openSections.size} open
        </span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 md:grid md:grid-cols-3 md:overflow-visible xl:grid-cols-9">
        {sections.map((section) => {
          const open = openSections.has(section.id);
          const active = activeId === section.id;
          const tone = tones[section.id] || 'default';
          return (
            <button
              key={section.id}
              className={resourceDetailNavigatorItemClassName(active, open, tone)}
              type="button"
              onClick={() => onFocusSection(section.id)}
              aria-current={active ? 'true' : undefined}
              aria-expanded={open}
              data-testid={`resource-detail-section-nav-item-${section.id}`}
              title={`${section.label} section`}
            >
              <span className="truncate">{section.label}</span>
              <span className="flex items-center gap-1">
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${
                    tone === 'error'
                      ? 'bg-[rgba(255,59,48,0.12)] text-[#b42318]'
                      : tone === 'warning'
                        ? 'bg-[rgba(255,149,0,0.14)] text-[#9a5a00]'
                        : active
                          ? 'bg-white/85 text-[#0057b8]'
                          : 'bg-white/72 text-[rgba(60,60,67,0.58)]'
                  }`}
                  data-testid={`resource-detail-section-nav-summary-${section.id}`}
                >
                  {summaries[section.id]}
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${
                    open ? 'bg-[rgba(52,199,89,0.12)] text-[#248a3d]' : 'bg-[rgba(142,142,147,0.1)] text-[#636366]'
                  }`}
                  data-testid={`resource-detail-section-nav-state-${section.id}`}
                >
                  {open ? 'open' : 'closed'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DetailSection({
  active = false,
  children,
  id,
  icon: Icon,
  onFocusSection,
  onToggle,
  open,
  sectionRef,
  summary,
  tone = 'default',
  title,
}: {
  active?: boolean;
  children: ReactNode;
  id: DetailSectionId;
  icon: LucideIcon;
  onFocusSection?: () => void;
  onToggle: () => void;
  open: boolean;
  sectionRef?: (node: HTMLElement | null) => void;
  summary: string;
  tone?: DetailSectionTone;
  title: string;
}) {
  return (
    <section
      ref={sectionRef}
      className={`rounded-[12px] border transition focus:outline-none focus:ring-2 focus:ring-[rgba(0,122,255,0.22)] ${detailSectionToneClassName(active, tone)}`}
      onFocusCapture={onFocusSection}
      tabIndex={-1}
      data-testid={`resource-detail-section-${id}`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <h3 className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.62)]">
          <Icon size={14} aria-hidden="true" />
          <span className="truncate">{title}</span>
        </h3>
        <button
          className="flex shrink-0 items-center gap-1.5 rounded-[8px] px-1.5 py-1 transition hover:bg-[rgba(242,242,247,0.85)]"
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${title} ${open ? '접기' : '펼치기'}`}
          data-detail-section-toggle="true"
        >
          <span
            className={
              tone === 'error'
                ? 'ku-chip border-[rgba(255,59,48,0.24)] bg-[rgba(255,59,48,0.1)] text-[#b42318]'
                : tone === 'warning'
                  ? 'ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#9a5a00]'
                  : 'ku-chip'
            }
          >
            {summary}
          </span>
          <ChevronDown className={`text-[rgba(60,60,67,0.48)] transition ${open ? 'rotate-180' : ''}`} size={15} aria-hidden="true" />
        </button>
      </div>
      {open ? <div className="px-3 pb-3" data-testid={`resource-detail-section-body-${id}`}>{children}</div> : null}
    </section>
  );
}

function KeyValueGrid({
  activeMatch,
  density = 'comfortable',
  empty = '데이터 없음',
  filter = '',
  filteredEmpty = '일치하는 항목 없음',
  limit = 20,
  testId,
  values,
}: {
  activeMatch?: KeyValueSearchMatch | null;
  density?: ResourceDetailDensity;
  empty?: string;
  filter?: string;
  filteredEmpty?: string;
  limit?: number;
  testId: string;
  values: Record<string, unknown>;
}) {
  const entries = useMemo(() => keyValueEntries(values), [values]);
  const [expanded, setExpanded] = useState(false);
  const entriesKey = useMemo(() => entries.map((entry) => entry.key).join('\u001f'), [entries]);
  const normalizedFilter = filter.trim();

  useEffect(() => {
    setExpanded(false);
  }, [entriesKey, normalizedFilter]);

  if (entries.length === 0) {
    return <p className="ku-meta">{empty}</p>;
  }
  const filteredEntries = normalizedFilter ? entries.filter((entry) => keyValueEntryMatchesFilter(entry, normalizedFilter)) : entries;
  if (filteredEntries.length === 0) {
    return <p className="ku-meta" data-testid={`resource-key-value-empty-${testId}`}>{filteredEmpty}</p>;
  }
  const compact = density === 'compact';
  const visibleEntries = normalizedFilter || expanded ? filteredEntries : filteredEntries.slice(0, limit);
  const hiddenCount = Math.max(0, filteredEntries.length - visibleEntries.length);
  const gridClassName = compact ? 'grid gap-1' : 'grid gap-1.5';
  const rowClassName = compact
    ? 'grid grid-cols-[minmax(84px,0.32fr)_minmax(0,1fr)] gap-2 rounded-[7px] border border-[rgba(60,60,67,0.06)] bg-[rgba(242,242,247,0.62)] px-2 py-1'
    : 'grid grid-cols-[minmax(112px,0.34fr)_minmax(0,1fr)] gap-2 rounded-[8px] border border-[rgba(60,60,67,0.06)] bg-[rgba(242,242,247,0.68)] px-2.5 py-1.5';
  const keyClassName = compact
    ? 'min-w-0 truncate font-mono text-[9px] font-semibold text-[rgba(60,60,67,0.58)]'
    : 'min-w-0 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.58)]';
  const valueClassName = compact
    ? 'min-w-0 break-words font-mono text-[9px] font-semibold leading-4 text-[#1d1d1f]'
    : 'min-w-0 break-words font-mono text-[10px] font-semibold leading-5 text-[#1d1d1f]';
  return (
    <div className="grid gap-2" data-testid={`resource-key-value-grid-${testId}`} data-density={density}>
      <div className={gridClassName}>
        {visibleEntries.map((entry) => {
          const entryIndex = entries.findIndex((candidate) => candidate.key === entry.key);
          const activeKeyMatch = activeMatch?.entryIndex === entryIndex && activeMatch.field === 'key' ? activeMatch : undefined;
          const activeValueMatch = activeMatch?.entryIndex === entryIndex && activeMatch.field === 'value' ? activeMatch : undefined;
          return (
            <div key={entry.key} className={rowClassName} data-testid={`resource-key-value-row-${testId}`}>
              <span className={keyClassName} title={entry.key}>{renderHighlightedText(entry.key, normalizedFilter, activeKeyMatch, 'active-key-value-search-match')}</span>
              <span className={valueClassName} title={entry.valueText}>{renderHighlightedText(entry.valueText, normalizedFilter, activeValueMatch, 'active-key-value-search-match')}</span>
            </div>
          );
        })}
      </div>
      {!normalizedFilter && entries.length > limit ? (
        <button
          className="inline-flex w-fit items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          data-testid={`resource-key-value-toggle-${testId}`}
        >
          <ChevronDown className={`transition ${expanded ? 'rotate-180' : ''}`} size={13} aria-hidden="true" />
          {expanded ? '접기' : `더 보기 · ${hiddenCount}개`}
        </button>
      ) : null}
    </div>
  );
}

function statusPillClassName(status: string) {
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

function resourceDetailNavigatorItemClassName(active: boolean, open: boolean, tone: DetailSectionTone) {
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

function unique(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function recordText(values: Record<string, unknown>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(' ')
    .toLowerCase();
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : '';
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function podLogContainerOptions(resource: ResourceExplorerItem) {
  const summary = recordFromUnknown(resource.preview.summary);
  const containers = asStringArray(summary.containerNames);
  const initContainers = asStringArray(summary.initContainers);
  return [
    ...containers.map((name) => ({ name, init: false })),
    ...initContainers.map((name) => ({ name, init: true })),
  ];
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function formatEventTimestamp(value: string) {
  if (!value) {
    return 'timestamp unknown';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function validEventTimestamp(value: string) {
  return Boolean(value) && !Number.isNaN(Date.parse(value));
}

function formatRelativeEventTimestamp(value: string) {
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

function formatRefreshTimestamp(value: number) {
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

function formatLogTimestamp(value: string) {
  return formatEventTimestamp(value);
}
