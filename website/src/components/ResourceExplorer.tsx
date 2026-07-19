import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Boxes, RotateCcw, Search, X } from 'lucide-react';
import { fetchResources, resourcesFromSnapshot } from '../services/resourceApi';
import type { ResourceExplorerItem, ResourceExplorerListMetadata } from '../types/resourceExplorer';
import type { TopologySnapshot } from '../types/topology';
import type { TopologySourceMode } from '../features/topology/useTopology';
import { resourceViewFiltersEqual, type ResourceViewFilters } from '../features/resources/resourceViewState';
import { useResourceViewPresetsController } from '../features/resources/useResourceViewPresetsController';
import {
  defaultResourceViewGroup,
  normalizePresetFilterValue,
  resourceViewPresetMatchesFilters,
} from '../features/resources/resourceViewPresets';
import type { ResourceViewMessage } from '../features/resources/resourceViewPresets';
import {
  filterResourceList,
  getResourceSelectionRange,
  readResourceListColumnPreference,
  readResourceListDensityPreference,
  readResourceListSortPreference,
  reconcileResourceSelection,
  resourceBulkCopyName,
  resourceBulkExportCsv,
  resourceBulkExportFileName,
  resourceBulkExportJson,
  resourceListAllValue,
  resourceListOptionalColumns,
  resourceListSortOptions,
  sortResourceList,
  uniqueSortedValues,
  writeResourceListColumnPreference,
  writeResourceListDensityPreference,
  writeResourceListSortPreference,
  type ResourceListColumnPreference,
  type ResourceListDensity,
  type ResourceListOptionalColumn,
  type ResourceListSortField,
  type ResourceListSortPreference,
} from '../features/resources/resourceListModel';
import { ResourceExplorerListPanel, resourceOptionDomId } from './resourceExplorer/ResourceExplorerListPanel';
import { ResourceViewPresetsPanel } from './resourceExplorer/ResourceViewPresetsPanel';

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

const allValue = resourceListAllValue;
const ResourceExplorerDetail = lazy(async () => {
  const module = await import('./resourceExplorer/ResourceExplorerDetail');
  return { default: module.ResourceExplorerDetail };
});
const liveResourcePageSize = 200;

interface ActiveResourceFilterChip {
  id: keyof ResourceViewFilters;
  label: string;
  value: string;
  testId: string;
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
    () => resourceListMetadata?.facets.clusters ?? uniqueSortedValues(resources.map((resource) => resource.clusterId)),
    [resourceListMetadata?.facets.clusters, resources],
  );
  const namespaces = useMemo(
    () => resourceListMetadata?.facets.namespaces ?? uniqueSortedValues(resources.map((resource) => resource.namespace).filter(Boolean) as string[]),
    [resourceListMetadata?.facets.namespaces, resources],
  );
  const kinds = useMemo(
    () => resourceListMetadata?.facets.kinds ?? uniqueSortedValues(resources.map((resource) => resource.kind)),
    [resourceListMetadata?.facets.kinds, resources],
  );
  const statuses = useMemo(
    () => resourceListMetadata?.facets.statuses ?? uniqueSortedValues(resources.map((resource) => resource.status)),
    [resourceListMetadata?.facets.statuses, resources],
  );
  const currentPresetFilters = useMemo(() => ({ query, cluster, namespace, kind, status }), [cluster, kind, namespace, query, status]);
  const resourceViewController = useResourceViewPresetsController({
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
  const { handleClearActiveResourceFilter, handleResetResourceFilters, setPresetName } = resourceViewController;
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
  const filteredResources = useMemo(() => filterResourceList(resources, currentPresetFilters), [currentPresetFilters, resources]);
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
    setSelectedResourceIds((current) => reconcileResourceSelection(current, sortedResources));
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
    const range = getResourceSelectionRange(sortedResources, anchorResourceId, targetResourceId, selectedResourceIndex);
    if (!range) return;
    setSelectedResourceIds((current) => {
      const next = new Set(current);
      range.resourceIds.forEach((resourceId) => next.add(resourceId));
      return next;
    });
    resourceSelectionAnchorRef.current = range.anchorResourceId;
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
          <ResourceViewPresetsPanel
            controller={resourceViewController}
            currentFilters={currentPresetFilters}
            filtersAreDefault={filtersAreDefault}
          />
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
