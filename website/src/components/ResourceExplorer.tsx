import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Bookmark, Boxes, CheckCircle2, ChevronDown, Copy, Download, Folder, FolderOpen, GitBranch, GripVertical, Link2, Pencil, RefreshCw, RotateCcw, Search, Tags, Trash2, Upload, X } from 'lucide-react';
import { fetchResourceViewPresets, fetchResources, resourcesFromSnapshot, saveResourceViewPresets } from '../services/resourceApi';
import type { ResourceViewPresetApiMetadata } from '../services/resourceApi';
import type { ResourceExplorerItem, ResourceExplorerListMetadata } from '../types/resourceExplorer';
import type { TopologySnapshot } from '../types/topology';
import type { TopologySourceMode } from '../features/topology/useTopology';
import { appendResourceViewFilterSearchParams, resourceViewFiltersEqual, type ResourceViewFilters } from '../features/resources/resourceViewState';
import { safeCsvCell } from '../features/export/safeCsv';

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
const ResourceExplorerDetail = lazy(async () => {
  const module = await import('./resourceExplorer/ResourceExplorerDetail');
  return { default: module.ResourceExplorerDetail };
});
const resourceViewPresetStorageKey = 'kuviewer_resource_view_presets';
const resourceViewPresetCollapsedGroupsStorageKey = 'kuviewer_resource_view_collapsed_groups';
const resourceListDensityStorageKey = 'kuviewer_resource_list_density';
const resourceListSortStorageKey = 'kuviewer_resource_list_sort';
const resourceListColumnsStorageKey = 'kuviewer_resource_list_columns';
const maxResourceViewPresets = 8;
const liveResourcePageSize = 200;
const defaultResourceViewGroup = 'General';
const maxResourceViewGroupLength = 40;
type ResourceListDensity = 'comfortable' | 'compact';
type ResourceListSortField = 'name' | 'kind' | 'namespace' | 'status' | 'cluster';
type ResourceListSortDirection = 'asc' | 'desc';
type ResourceListOptionalColumn = 'namespace' | 'cluster' | 'age' | 'summary';
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
  const [resourceListMetadata, setResourceListMetadata] = useState<ResourceExplorerListMetadata | null>(null);
  const [liveResourceApiReady, setLiveResourceApiReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
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
  const resourceRequestGenerationRef = useRef(0);
  const resourceRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const viewPresetImportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const requestGeneration = resourceRequestGenerationRef.current + 1;
    resourceRequestGenerationRef.current = requestGeneration;
    if (sourceMode !== 'live' || !liveEnabled) {
      setResources(resourcesFromSnapshot(snapshot).items);
      setResourceListMetadata(null);
      setLiveResourceApiReady(false);
      setLoading(false);
      setLoadingMore(false);
      setError('');
      return;
    }

    const controller = new AbortController();
    const debounceDelay = query.trim() ? 250 : 0;
    setLiveResourceApiReady(false);
    setLoading(true);
    setLoadingMore(false);
    setError('');
    const timeoutId = window.setTimeout(() => {
      void fetchResources(
        {
          query,
          cluster,
          namespace,
          kind,
          status,
          sort: resourceListSort.field,
          direction: resourceListSort.direction,
          limit: liveResourcePageSize,
        },
        controller.signal,
      )
        .then((list) => {
          if (requestGeneration !== resourceRequestGenerationRef.current) {
            return;
          }
          setResources(list.items);
          setResourceListMetadata(list.metadata ?? null);
          setLiveResourceApiReady(true);
        })
        .catch((requestError: unknown) => {
          if (!controller.signal.aborted) {
            setError(requestError instanceof Error ? requestError.message : 'resources_request_failed');
            setResources(resourcesFromSnapshot(snapshot).items);
            setResourceListMetadata(null);
            setLiveResourceApiReady(false);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, debounceDelay);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [cluster, kind, liveEnabled, namespace, query, resourceListSort.direction, resourceListSort.field, snapshot, sourceMode, status]);

  const clusters = useMemo(
    () => resourceListMetadata?.facets.clusters ?? unique(resources.map((resource) => resource.clusterId)),
    [resourceListMetadata?.facets.clusters, resources],
  );
  const namespaces = useMemo(
    () => resourceListMetadata?.facets.namespaces ?? unique(resources.map((resource) => resource.namespace).filter(Boolean) as string[]),
    [resourceListMetadata?.facets.namespaces, resources],
  );
  const kinds = useMemo(
    () => resourceListMetadata?.facets.kinds ?? unique(resources.map((resource) => resource.kind)),
    [resourceListMetadata?.facets.kinds, resources],
  );
  const statuses = useMemo(
    () => resourceListMetadata?.facets.statuses ?? unique(resources.map((resource) => resource.status)),
    [resourceListMetadata?.facets.statuses, resources],
  );
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
  const nextResourceCursor = resourceListMetadata?.nextCursor ?? '';
  const resourceResultLabel = resourceListMetadata
    ? `표시 ${filteredResources.length} / 일치 ${resourceListMetadata.filtered} · 전체 ${resourceListMetadata.total}`
    : `결과 ${filteredResources.length} / 전체 ${resources.length}`;
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
  const handleLoadMoreResources = async () => {
    if (!nextResourceCursor || loadingMore || sourceMode !== 'live' || !liveEnabled) {
      return;
    }
    setLoadingMore(true);
    setError('');
    const requestGeneration = resourceRequestGenerationRef.current;
    try {
      const list = await fetchResources({
        query,
        cluster,
        namespace,
        kind,
        status,
        sort: resourceListSort.field,
        direction: resourceListSort.direction,
        limit: liveResourcePageSize,
        cursor: nextResourceCursor,
      });
      if (requestGeneration !== resourceRequestGenerationRef.current) {
        return;
      }
      setResources((currentResources) => {
        const knownIds = new Set(currentResources.map((resource) => resource.id));
        return [...currentResources, ...list.items.filter((resource) => !knownIds.has(resource.id))];
      });
      setResourceListMetadata(list.metadata ?? null);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : 'resources_request_failed');
    } finally {
      setLoadingMore(false);
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
              <span className="ku-chip" data-testid="resource-result-count">{loading ? '로딩 중' : resourceResultLabel}</span>
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
          {nextResourceCursor ? (
            <div className="flex justify-center border-t border-[rgba(60,60,67,0.1)] px-3 py-4">
              <button
                className="inline-flex items-center gap-2 rounded-[9px] border border-[rgba(0,122,255,0.2)] bg-[rgba(0,122,255,0.06)] px-4 py-2 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)] disabled:cursor-wait disabled:opacity-60"
                type="button"
                onClick={() => void handleLoadMoreResources()}
                disabled={loadingMore}
                data-testid="resource-list-load-more"
              >
                <RefreshCw size={14} className={loadingMore ? 'animate-spin' : ''} aria-hidden="true" />
                {loadingMore ? '추가 리소스 불러오는 중' : `더 불러오기 · ${filteredResources.length} / ${resourceListMetadata?.filtered ?? filteredResources.length}`}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <Suspense fallback={<div className="ku-panel p-6 text-center"><p className="ku-meta">리소스 상세 불러오는 중</p></div>}>
        <ResourceExplorerDetail
          liveEnabled={liveEnabled && sourceMode === 'live' && liveResourceApiReady}
          resource={selectedResource}
          focusRequest={detailFocusRequest}
          onOpenTopologyNode={onOpenTopologyNode}
          onSelectNode={onSelectNode}
        />
      </Suspense>
    </section>
  );
}

function downloadTextFile(content: string, mimeType: string, fileName: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
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
  const rows = resourceBulkExportRows(resources).map((row) => header.map((key) => safeCsvCell(Array.isArray(row[key]) ? row[key].join(';') : row[key])).join(','));
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

function unique(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function recordText(values: Record<string, unknown>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(' ')
    .toLowerCase();
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
