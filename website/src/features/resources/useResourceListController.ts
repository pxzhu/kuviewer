import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { fetchResources, resourcesFromSnapshot } from '../../services/resourceApi';
import type { ResourceExplorerItem, ResourceExplorerListMetadata } from '../../types/resourceExplorer';
import type { TopologySnapshot } from '../../types/topology';
import type { TopologySourceMode } from '../topology/useTopology';
import type { ResourceViewMessage } from './resourceViewPresets';
import type { ResourceViewFilters } from './resourceViewState';
import {
  buildResourceListRequest,
  filterResourceList,
  getResourceSelectionRange,
  mergeResourcePages,
  normalizeResourceListRequestError,
  readResourceListColumnPreference,
  readResourceListDensityPreference,
  readResourceListSortPreference,
  reconcileResourceSelection,
  resolveResourceListKeyboardCommand,
  resourceBulkCopyName,
  resourceBulkExportCsv,
  resourceBulkExportFileName,
  resourceBulkExportJson,
  resourceListOptionalColumns,
  sortResourceList,
  uniqueSortedValues,
  writeResourceListColumnPreference,
  writeResourceListDensityPreference,
  writeResourceListSortPreference,
  type ResourceListOptionalColumn,
} from './resourceListModel';

interface UseResourceListControllerOptions {
  downloadTextFile: (content: string, mimeType: string, fileName: string) => void;
  filters: ResourceViewFilters;
  liveEnabled: boolean;
  onSelectNode: (nodeId: string) => void;
  selectedNodeId: string;
  snapshot: TopologySnapshot;
  sourceMode: TopologySourceMode;
}

export function useResourceListController({
  downloadTextFile,
  filters,
  liveEnabled,
  onSelectNode,
  selectedNodeId,
  snapshot,
  sourceMode,
}: UseResourceListControllerOptions) {
  const [resources, setResources] = useState<ResourceExplorerItem[]>(() => resourcesFromSnapshot(snapshot).items);
  const [resourceListMetadata, setResourceListMetadata] = useState<ResourceExplorerListMetadata | null>(null);
  const [liveResourceApiReady, setLiveResourceApiReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [detailFocusRequest, setDetailFocusRequest] = useState(0);
  const [resourceListDensity, setResourceListDensity] = useState(readResourceListDensityPreference);
  const [resourceListSort, setResourceListSort] = useState(readResourceListSortPreference);
  const [resourceListColumns, setResourceListColumns] = useState(readResourceListColumnPreference);
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(() => new Set());
  const [resourceBulkMessage, setResourceBulkMessage] = useState<ResourceViewMessage | null>(null);
  const resourceSelectionAnchorRef = useRef<string | null>(null);
  const resourceRequestGenerationRef = useRef(0);
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  const resourceRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const requestGeneration = resourceRequestGenerationRef.current + 1;
    resourceRequestGenerationRef.current = requestGeneration;
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    setLoadingMore(false);

    if (sourceMode !== 'live' || !liveEnabled) {
      setResources(resourcesFromSnapshot(snapshot).items);
      setResourceListMetadata(null);
      setLiveResourceApiReady(false);
      setLoading(false);
      setError('');
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void fetchResources(buildResourceListRequest(filters, resourceListSort), controller.signal)
        .then((list) => {
          if (!controller.signal.aborted && requestGeneration === resourceRequestGenerationRef.current) {
            setResources(list.items);
            setResourceListMetadata(list.metadata ?? null);
            setLiveResourceApiReady(true);
          }
        })
        .catch((requestError: unknown) => {
          if (!controller.signal.aborted && requestGeneration === resourceRequestGenerationRef.current) {
            setError(normalizeResourceListRequestError(requestError));
            setResources(resourcesFromSnapshot(snapshot).items);
            setResourceListMetadata(null);
            setLiveResourceApiReady(false);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted && requestGeneration === resourceRequestGenerationRef.current) {
            setLoading(false);
          }
        });
    }, filters.query.trim() ? 250 : 0);

    setLiveResourceApiReady(false);
    setLoading(true);
    setError('');
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
      loadMoreControllerRef.current?.abort();
    };
  }, [filters, liveEnabled, resourceListSort, snapshot, sourceMode]);

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
  const filteredResources = useMemo(() => filterResourceList(resources, filters), [filters, resources]);
  const sortedResources = useMemo(() => sortResourceList(filteredResources, resourceListSort), [filteredResources, resourceListSort]);
  const selectedResource = sortedResources.find((resource) => resource.id === selectedNodeId) || sortedResources[0];
  const selectedResourceIndex = selectedResource ? sortedResources.findIndex((resource) => resource.id === selectedResource.id) : -1;
  const selectedResources = useMemo(
    () => sortedResources.filter((resource) => selectedResourceIds.has(resource.id)),
    [selectedResourceIds, sortedResources],
  );
  const selectedResourceCount = selectedResources.length;
  const allFilteredResourcesSelected = sortedResources.length > 0 && selectedResourceCount === sortedResources.length;
  const nextResourceCursor = resourceListMetadata?.nextCursor ?? '';
  const resourceResultLabel = resourceListMetadata
    ? `표시 ${filteredResources.length} / 일치 ${resourceListMetadata.filtered} · 전체 ${resourceListMetadata.total}`
    : `결과 ${filteredResources.length} / 전체 ${resources.length}`;
  const visibleOptionalColumnCount = resourceListOptionalColumns.filter((column) => resourceListColumns[column.key]).length;

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

  useEffect(() => writeResourceListDensityPreference(resourceListDensity), [resourceListDensity]);
  useEffect(() => writeResourceListSortPreference(resourceListSort), [resourceListSort]);
  useEffect(() => writeResourceListColumnPreference(resourceListColumns), [resourceListColumns]);

  const handleToggleResourceSelection = useCallback((resourceId: string, selected: boolean) => {
    resourceSelectionAnchorRef.current = resourceId;
    setSelectedResourceIds((current) => {
      const next = new Set(current);
      if (selected) next.add(resourceId);
      else next.delete(resourceId);
      return next;
    });
    setResourceBulkMessage(null);
  }, []);

  const handleSelectFilteredResources = useCallback(() => {
    if (sortedResources.length === 0) return;
    setSelectedResourceIds(new Set(sortedResources.map((resource) => resource.id)));
    resourceSelectionAnchorRef.current = selectedResource?.id ?? sortedResources[0]?.id ?? null;
    setResourceBulkMessage({ tone: 'success', text: `현재 필터 결과 ${sortedResources.length}개를 선택했습니다.` });
  }, [selectedResource?.id, sortedResources]);

  const handleClearResourceSelection = useCallback(() => {
    setSelectedResourceIds(new Set());
    resourceSelectionAnchorRef.current = selectedResource?.id ?? sortedResources[0]?.id ?? null;
    setResourceBulkMessage(null);
  }, [selectedResource?.id, sortedResources]);

  const handleCopySelectedResourceNames = useCallback(async () => {
    if (selectedResources.length === 0) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(`${selectedResources.map(resourceBulkCopyName).join('\n')}\n`);
      setResourceBulkMessage({ tone: 'success', text: `선택한 리소스 ${selectedResources.length}개 이름을 복사했습니다.` });
    } catch {
      setResourceBulkMessage({ tone: 'warning', text: '클립보드 복사가 지원되지 않아 이름을 복사하지 못했습니다.' });
    }
  }, [selectedResources]);

  const handleExportSelectedResources = useCallback((format: 'json' | 'csv') => {
    if (selectedResources.length === 0) return;
    const content = format === 'json' ? resourceBulkExportJson(selectedResources) : resourceBulkExportCsv(selectedResources);
    const mimeType = format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8';
    downloadTextFile(content, mimeType, resourceBulkExportFileName(format));
    setResourceBulkMessage({ tone: 'success', text: `선택한 리소스 ${selectedResources.length}개를 ${format.toUpperCase()}로 내보냈습니다.` });
  }, [downloadTextFile, selectedResources]);

  const toggleResourceListColumn = useCallback((column: ResourceListOptionalColumn) => {
    setResourceListColumns((current) => ({ ...current, [column]: !current[column] }));
  }, []);

  const focusResourceRow = useCallback((resourceId: string) => {
    window.requestAnimationFrame(() => resourceRowRefs.current[resourceId]?.focus({ preventScroll: true }));
  }, []);

  const handleSelectResource = useCallback((resourceId: string) => {
    resourceSelectionAnchorRef.current = resourceId;
    onSelectNode(resourceId);
  }, [onSelectNode]);

  const selectResourceRange = useCallback((anchorResourceId: string, targetResourceId: string) => {
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
  }, [focusResourceRow, onSelectNode, selectedResourceIndex, sortedResources]);

  const selectResourceAtIndex = useCallback((index: number, rangeSelection = false) => {
    if (sortedResources.length === 0) return;
    const nextIndex = Math.max(0, Math.min(sortedResources.length - 1, index));
    const nextResource = sortedResources[nextIndex];
    if (rangeSelection) {
      selectResourceRange(resourceSelectionAnchorRef.current ?? selectedResource?.id ?? nextResource.id, nextResource.id);
      return;
    }
    resourceSelectionAnchorRef.current = nextResource.id;
    onSelectNode(nextResource.id);
    focusResourceRow(nextResource.id);
  }, [focusResourceRow, onSelectNode, selectResourceRange, selectedResource?.id, sortedResources]);

  const handleResourceListKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const command = resolveResourceListKeyboardCommand({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      hasSelectedResource: Boolean(selectedResource),
      hasSelectionOrMessage: selectedResourceCount > 0 || Boolean(resourceBulkMessage),
      key: event.key,
      metaKey: event.metaKey,
      resourceCount: sortedResources.length,
      selectedResourceIndex,
      shiftKey: event.shiftKey,
      shortcutTarget: isResourceListShortcutTarget(event.target),
    });
    if (!command) return;
    event.preventDefault();
    switch (command.type) {
      case 'select-all':
        handleSelectFilteredResources();
        break;
      case 'clear-selection':
        handleClearResourceSelection();
        break;
      case 'move':
        selectResourceAtIndex(command.index, command.range);
        break;
      case 'focus-detail':
        setDetailFocusRequest((request) => request + 1);
        break;
      case 'toggle-selection':
        if (selectedResource) handleToggleResourceSelection(selectedResource.id, !selectedResourceIds.has(selectedResource.id));
        break;
    }
  }, [
    handleClearResourceSelection,
    handleSelectFilteredResources,
    handleToggleResourceSelection,
    resourceBulkMessage,
    selectResourceAtIndex,
    selectedResource,
    selectedResourceCount,
    selectedResourceIds,
    selectedResourceIndex,
    sortedResources.length,
  ]);

  const handleLoadMoreResources = useCallback(async () => {
    if (!nextResourceCursor || loadingMore || sourceMode !== 'live' || !liveEnabled) return;
    const requestGeneration = resourceRequestGenerationRef.current;
    const controller = new AbortController();
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = controller;
    setLoadingMore(true);
    setError('');
    try {
      const list = await fetchResources(buildResourceListRequest(filters, resourceListSort, nextResourceCursor), controller.signal);
      if (controller.signal.aborted || requestGeneration !== resourceRequestGenerationRef.current) return;
      setResources((currentResources) => mergeResourcePages(currentResources, list.items));
      setResourceListMetadata(list.metadata ?? null);
    } catch (requestError: unknown) {
      if (!controller.signal.aborted && requestGeneration === resourceRequestGenerationRef.current) {
        setError(normalizeResourceListRequestError(requestError));
      }
    } finally {
      if (loadMoreControllerRef.current === controller) loadMoreControllerRef.current = null;
      if (!controller.signal.aborted && requestGeneration === resourceRequestGenerationRef.current) setLoadingMore(false);
    }
  }, [filters, liveEnabled, loadingMore, nextResourceCursor, resourceListSort, sourceMode]);

  return {
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
    resourceCount: resources.length,
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
  };
}

function isResourceListShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-resource-bulk-control="true"]')) return true;
  if (target.closest('[data-resource-row="true"]')) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'select' || tagName === 'textarea' || tagName === 'button' || target.isContentEditable;
}
