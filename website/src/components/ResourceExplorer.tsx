import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Bookmark, Boxes, CheckCircle2, ChevronDown, Download, Folder, FolderOpen, GitBranch, GripVertical, Link2, Pencil, RefreshCw, RotateCcw, Search, Tags, Trash2, Upload, X } from 'lucide-react';
import { fetchResources, resourcesFromSnapshot } from '../services/resourceApi';
import type { ResourceExplorerItem, ResourceExplorerListMetadata } from '../types/resourceExplorer';
import type { TopologySnapshot } from '../types/topology';
import type { TopologySourceMode } from '../features/topology/useTopology';
import { resourceViewFiltersEqual, type ResourceViewFilters } from '../features/resources/resourceViewState';
import { safeCsvCell } from '../features/export/safeCsv';
import { useResourceViewPresetsController } from '../features/resources/useResourceViewPresetsController';
import {
  defaultResourceViewGroup,
  formatPresetUpdatedAt,
  formatResourceViewTeamSnapshotMetadata,
  maxResourceViewGroupLength,
  maxResourceViewPresets,
  normalizePresetFilterValue,
  resourceViewGroupDomId,
  resourceViewIncomingNewCount,
  resourceViewPresetDomId,
  resourceViewPresetMatchesFilters,
  resourceViewPresetSummary,
  resourceViewSourceLabel,
  resourceViewSourceShortLabel,
  resourceViewTeamCompareActionLabel,
  resourceViewTeamSyncActionLabel,
  resourceViewTransferActionLabel,
} from '../features/resources/resourceViewPresets';
import type { ResourceViewMessage } from '../features/resources/resourceViewPresets';
import { ResourceExplorerListPanel, resourceOptionDomId } from './resourceExplorer/ResourceExplorerListPanel';

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
const resourceListDensityStorageKey = 'kuviewer_resource_list_density';
const resourceListSortStorageKey = 'kuviewer_resource_list_sort';
const resourceListColumnsStorageKey = 'kuviewer_resource_list_columns';
const liveResourcePageSize = 200;
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

interface ActiveResourceFilterChip {
  id: keyof ResourceViewFilters;
  label: string;
  value: string;
  testId: string;
}

interface ResourceListSortPreference {
  field: ResourceListSortField;
  direction: ResourceListSortDirection;
}

type ResourceListColumnPreference = Record<ResourceListOptionalColumn, boolean>;

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
  const [detailFocusRequest, setDetailFocusRequest] = useState(0);
  const [resourceListDensity, setResourceListDensity] = useState<ResourceListDensity>(() => readResourceListDensityPreference());
  const [resourceListSort, setResourceListSort] = useState<ResourceListSortPreference>(() => readResourceListSortPreference());
  const [resourceListColumns, setResourceListColumns] = useState<ResourceListColumnPreference>(() => readResourceListColumnPreference());
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(() => new Set());
  const [resourceBulkMessage, setResourceBulkMessage] = useState<ResourceViewMessage | null>(null);
  const resourceSelectionAnchorRef = useRef<string | null>(null);
  const resourceRequestGenerationRef = useRef(0);
  const resourceRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
  const currentPresetFilters = useMemo(() => ({ query, cluster, namespace, kind, status }), [cluster, kind, namespace, query, status]);
  const {
    allVisibleViewPresetsSelected,
    bulkViewPresetDeleteConfirm,
    bulkViewPresetGroup,
    canReorderViewPresets,
    collapsedViewGroups,
    collapsedVisibleViewPresetFolderCount,
    draggingViewPresetName,
    filteredGroupedViewPresets,
    groupedViewPresets,
    handleApplyTeamLoadPreview,
    handleApplyViewPreset,
    handleBulkDeleteViewPresets,
    handleBulkMoveViewPresets,
    handleCancelResourceViewRename,
    handleClearActiveResourceFilter,
    handleClearViewPresetSelection,
    handleCollapseVisibleViewPresetFolders,
    handleCommitResourceViewRename,
    handleConfirmTeamSavePreview,
    handleCopyResourceViewLink,
    handleDeleteViewPreset,
    handleDismissTeamComparePreview,
    handleDropViewPreset,
    handleExpandVisibleViewPresetFolders,
    handleExportSelectedViewPresets,
    handleExportViewPresets,
    handleImportViewPresets,
    handleLoadTeamViewPresets,
    handleMoveViewPreset,
    handleResetResourceFilters,
    handleResolveResourceViewConflicts,
    handleResourceViewRenameKeyDown,
    handleSaveTeamViewPresets,
    handleSaveViewPreset,
    handleSetGroupViewPresetSelection,
    handleSetVisibleViewPresetSelection,
    handleStartResourceViewRename,
    handleToggleViewPresetSelection,
    handleUpdateViewPresetGroup,
    matchingViewPreset,
    normalizedViewPresetSearch,
    presetGroup,
    presetName,
    presetNameExists,
    renamingViewPreset,
    resourceViewConflict,
    resourceViewMessage,
    resourceViewTeamComparePreview,
    resourceViewTeamLoading,
    resourceViewTeamSaveConfirm,
    resourceViewTeamSyncSummary,
    resourceViewTransferSummary,
    savePresetLabel,
    selectedViewPresetCount,
    selectedViewPresetNames,
    selectedVisibleViewPresetCount,
    setBulkViewPresetGroup,
    setBulkViewPresetDeleteConfirm,
    setDraggingViewPresetName,
    setPresetGroup,
    setPresetName,
    setRenamingViewPreset,
    setResourceViewConflict,
    setResourceViewTeamSyncSummary,
    setResourceViewTransferSummary,
    setViewPresetSearch,
    suggestedPresetName,
    teamResourceViewsEnabled,
    toggleViewPresetGroup,
    viewPresetGroupOptions,
    viewPresetImportInputRef,
    viewPresetSearch,
    viewPresets,
    visibleViewPresetFolderCount,
    visibleViewPresets,
  } = useResourceViewPresetsController({
    cluster,
    clusters,
    downloadTextFile,
    kind,
    kinds,
    liveEnabled,
    namespace,
    namespaces,
    onSelectNode,
    query,
    setCluster,
    setKind,
    setNamespace,
    setQuery,
    setStatus,
    sourceMode,
    status,
    statuses,
  });
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
    if (resources.length === 0) {
      return;
    }
    setCluster((current) => normalizePresetFilterValue(current, clusters));
    setNamespace((current) => normalizePresetFilterValue(current, namespaces));
    setKind((current) => normalizePresetFilterValue(current, kinds));
    setStatus((current) => normalizePresetFilterValue(current, statuses));
  }, [clusters, kinds, namespaces, resources.length, statuses]);

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
  const visibleOptionalColumnCount = resourceListOptionalColumns.filter((column) => resourceListColumns[column.key]).length;
  const toggleResourceListColumn = (column: ResourceListOptionalColumn) => {
    setResourceListColumns((current) => ({ ...current, [column]: !current[column] }));
  };
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

        <ResourceExplorerListPanel
          allVisibleSelected={allFilteredResourcesSelected}
          bulkMessage={resourceBulkMessage}
          columns={resourceListColumns}
          density={resourceListDensity}
          loadingMore={loadingMore}
          nextCursor={nextResourceCursor}
          onClearSelection={handleClearResourceSelection}
          onCopySelectedNames={() => void handleCopySelectedResourceNames()}
          onExportSelected={handleExportSelectedResources}
          onKeyDown={handleResourceListKeyDown}
          onLoadMore={() => void handleLoadMoreResources()}
          onSelectAll={handleSelectFilteredResources}
          onSelectResource={handleSelectResource}
          onToggleSelection={handleToggleResourceSelection}
          resources={sortedResources}
          rowRefs={resourceRowRefs}
          selectedResourceId={selectedResource?.id ?? ''}
          selectedResourceIds={selectedResourceIds}
          selectedResourceIndex={selectedResourceIndex}
          totalFilteredCount={resourceListMetadata?.filtered ?? filteredResources.length}
        />
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
