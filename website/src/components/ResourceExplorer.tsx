import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, RotateCcw, Search, X } from 'lucide-react';
import type { TopologySnapshot } from '../types/topology';
import type { TopologySourceMode } from '../features/topology/useTopology';
import { resourceViewFiltersEqual, type ResourceViewFilters } from '../features/resources/resourceViewState';
import { useResourceViewPresetsController } from '../features/resources/useResourceViewPresetsController';
import {
  defaultResourceViewGroup,
  normalizePresetFilterValue,
  resourceViewPresetMatchesFilters,
} from '../features/resources/resourceViewPresets';
import {
  resourceListAllValue,
  resourceListOptionalColumns,
  resourceListSortOptions,
  type ResourceListSortField,
} from '../features/resources/resourceListModel';
import { useResourceListController } from '../features/resources/useResourceListController';
import { ResourceExplorerListPanel } from './resourceExplorer/ResourceExplorerListPanel';
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
  const currentPresetFilters = useMemo(() => ({ query, cluster, namespace, kind, status }), [cluster, kind, namespace, query, status]);
  const resourceListController = useResourceListController({
    downloadTextFile,
    filters: currentPresetFilters,
    liveEnabled,
    onSelectNode,
    selectedNodeId,
    snapshot,
    sourceMode,
  });
  const {
    allFilteredResourcesSelected,
    clusters,
    detailFocusRequest,
    error,
    filteredResources,
    handleClearResourceSelection,
    handleCopySelectedResourceNames,
    handleExportSelectedResources,
    handleLoadMoreResources,
    handleResourceListKeyDown,
    handleSelectFilteredResources,
    handleSelectResource,
    handleToggleResourceSelection,
    kinds,
    liveResourceApiReady,
    loading,
    loadingMore,
    namespaces,
    nextResourceCursor,
    resourceBulkMessage,
    resourceCount,
    resourceListColumns,
    resourceListDensity,
    resourceListMetadata,
    resourceListSort,
    resourceResultLabel,
    resourceRowRefs,
    selectedResource,
    selectedResourceIds,
    selectedResourceIndex,
    setResourceListDensity,
    setResourceListSort,
    sortedResources,
    statuses,
    toggleResourceListColumn,
    visibleOptionalColumnCount,
  } = resourceListController;
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
    if (resourceCount === 0) {
      return;
    }
    setCluster((current) => normalizePresetFilterValue(current, clusters));
    setNamespace((current) => normalizePresetFilterValue(current, namespaces));
    setKind((current) => normalizePresetFilterValue(current, kinds));
    setStatus((current) => normalizePresetFilterValue(current, statuses));
  }, [clusters, kinds, namespaces, resourceCount, statuses]);

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
