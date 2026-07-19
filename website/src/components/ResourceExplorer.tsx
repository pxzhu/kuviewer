import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { TopologySnapshot } from '../types/topology';
import type { TopologySourceMode } from '../features/topology/useTopology';
import { activeResourceFilterChips, resourceViewFiltersEqual, type ResourceViewFilters } from '../features/resources/resourceViewState';
import { useResourceViewPresetsController } from '../features/resources/useResourceViewPresetsController';
import {
  defaultResourceViewGroup,
  normalizePresetFilterValue,
  resourceViewPresetMatchesFilters,
} from '../features/resources/resourceViewPresets';
import { resourceListAllValue } from '../features/resources/resourceListModel';
import { useResourceListController } from '../features/resources/useResourceListController';
import { ResourceExplorerFiltersPanel } from './resourceExplorer/ResourceExplorerFiltersPanel';
import { ResourceExplorerListPanel } from './resourceExplorer/ResourceExplorerListPanel';
import { ResourceExplorerListToolbar } from './resourceExplorer/ResourceExplorerListToolbar';

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
  const activeFilterChips = useMemo(() => activeResourceFilterChips(currentPresetFilters), [currentPresetFilters]);

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
        <ResourceExplorerListToolbar
          activeFilterCount={activeFilterChips.length}
          columns={resourceListColumns}
          density={resourceListDensity}
          error={error}
          loading={loading}
          resultLabel={resourceResultLabel}
          setDensity={setResourceListDensity}
          setSort={setResourceListSort}
          sort={resourceListSort}
          toggleColumn={toggleResourceListColumn}
          visibleOptionalColumnCount={visibleOptionalColumnCount}
        />

        <ResourceExplorerFiltersPanel
          activeFilterChips={activeFilterChips}
          filters={currentPresetFilters}
          filtersAreDefault={filtersAreDefault}
          options={{ cluster: clusters, namespace: namespaces, kind: kinds, status: statuses }}
          resourceViewController={resourceViewController}
          onChange={(filter, value) => {
            if (filter === 'query') setQuery(value);
            else if (filter === 'cluster') setCluster(value);
            else if (filter === 'namespace') setNamespace(value);
            else if (filter === 'kind') setKind(value);
            else setStatus(value);
          }}
          onClearFilter={handleClearActiveResourceFilter}
          onReset={handleResetResourceFilters}
        />

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
