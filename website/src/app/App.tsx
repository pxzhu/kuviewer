import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { clearAdminToken, getStoredAdminToken, isValidAdminToken } from '../features/auth/adminToken';
import { isDesktopRuntime } from '../features/desktop/desktopRuntime';
import { useDesktopCmSessionController } from '../features/desktop/useDesktopCmSessionController';
import { useConnectorStatus } from '../features/status/useConnectorStatus';
import { useConnectorCapabilities } from '../features/status/useConnectorCapabilities';
import { type ColorMode, type TopologyFilters, type TopologySourceMode, useTopology } from '../features/topology/useTopology';
import { importTopologySnapshot, parseKubernetesFiles, type UploadedTopologyState } from '../features/upload/parseKubernetesFiles';
import {
  addSnapshotHistoryEntry,
  createSnapshotHistoryEntry,
  deleteSnapshotHistoryEntry,
  renameSnapshotHistoryEntry,
  type SnapshotHistoryEntry,
} from '../features/snapshot/snapshotHistory';
import { ConnectorDiagnostics } from '../components/ConnectorDiagnostics';
import { DetailPanel } from '../components/DetailPanel';
import { FilterBar } from '../components/FilterBar';
import { ResourceList } from '../components/ResourceList';
import { AppHeader, type BrandTheme, type ViewMode } from '../components/AppHeader';
import {
  appSearchHasResourceViewState,
  appendResourceViewFilterSearchParams,
  defaultResourceViewFilters,
  readResourceViewFiltersFromSearch,
  resourceViewFiltersEqual,
  type ResourceViewFilters,
} from '../features/resources/resourceViewState';
import { SourceModeBar } from '../components/SourceModeBar';
import { StatTiles } from '../components/StatTiles';

const initialFilters: TopologyFilters = {
  query: '',
  cluster: 'all',
  namespace: 'all',
  node: 'all',
  kind: 'all',
  status: 'all',
};
const sourceModeStorageKey = 'kuviewer_source_mode';
const brandThemeStorageKey = 'kuviewer_brand_theme';

const ResourceExplorer = lazy(async () => {
  const module = await import('../components/ResourceExplorer');
  return { default: module.ResourceExplorer };
});

const SnapshotComparePanel = lazy(async () => {
  const module = await import('../components/SnapshotComparePanel');
  return { default: module.SnapshotComparePanel };
});

const TrafficFlowView = lazy(async () => {
  const module = await import('../components/TrafficFlowView');
  return { default: module.TrafficFlowView };
});

const TopologyCanvas = lazy(async () => {
  const module = await import('../components/TopologyCanvas');
  return { default: module.TopologyCanvas };
});

interface AppUrlState {
  viewMode: ViewMode;
  sourceMode: TopologySourceMode;
  resourceFilters: ResourceViewFilters;
}

export function App() {
  return <Dashboard />;
}

function Dashboard() {
  usePreventDocumentPullToRefresh();

  const [filters, setFilters] = useState(initialFilters);
  const [colorMode, setColorMode] = useState<ColorMode>('status');
  const [brandTheme, setBrandTheme] = useState<BrandTheme>(() => initialBrandTheme());
  const [viewMode, setViewMode] = useState<ViewMode>(() => initialViewMode());
  const [sourceMode, setSourceMode] = useState<TopologySourceMode>(() => initialSourceMode());
  const [resourceUrlFilters, setResourceUrlFilters] = useState<ResourceViewFilters>(() => initialResourceViewFilters());
  const [desktopConnectionAvailable] = useState(() => isDesktopRuntime());
  const [liveUnlocked, setLiveUnlocked] = useState(() => isValidAdminToken(getStoredAdminToken()));
  const [uploadedState, setUploadedState] = useState<UploadedTopologyState | null>(null);
  const [uploadClusterName, setUploadClusterName] = useState('uploaded-bundle');
  const [uploadClusterId, setUploadClusterId] = useState('uploaded-bundle');
  const [uploadError, setUploadError] = useState('');
  const [liveSessionMessage, setLiveSessionMessage] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [snapshotHistory, setSnapshotHistory] = useState<SnapshotHistoryEntry[]>([]);
  const [snapshotBaselineId, setSnapshotBaselineId] = useState('');
  const [snapshotCurrentId, setSnapshotCurrentId] = useState('');
  const liveActive = sourceMode === 'live' && liveUnlocked;
  const appUrlStateRef = useRef<AppUrlState>({
    viewMode,
    sourceMode,
    resourceFilters: resourceUrlFilters,
  });

  const { status: connectorStatus, loading: connectorLoading, error: connectorError } = useConnectorStatus(liveActive);
  const {
    report: capabilityReport,
    loading: capabilityLoading,
    error: capabilityError,
    refresh: refreshCapabilities,
  } = useConnectorCapabilities(liveActive);
  const {
    snapshot,
    nodes,
    edges,
    clusters,
    namespaces,
    nodeNames,
    kinds,
    statuses,
    loading,
    error,
    lastUpdatedAt,
    refresh,
    autoRefresh,
    setAutoRefresh,
    refreshIntervalMs,
    source,
  } = useTopology(filters, sourceMode, uploadedState?.snapshot || null, liveUnlocked);

  const handleDesktopRuntimeStarted = useCallback(() => {
    setSourceMode('live');
    storeSourceMode('live');
    writeAppUrlState({ viewMode, sourceMode: 'live', resourceFilters: resourceUrlFilters }, 'push');
  }, [resourceUrlFilters, viewMode]);

  const handleDesktopRuntimeStopped = useCallback(() => {
    if (sourceMode !== 'live') {
      return;
    }
    setSourceMode('upload');
    storeSourceMode('upload');
    writeAppUrlState({ viewMode, sourceMode: 'upload', resourceFilters: resourceUrlFilters }, 'push');
    setAutoRefresh(false);
  }, [resourceUrlFilters, setAutoRefresh, sourceMode, viewMode]);

  const {
    sessions: desktopCmSessions,
    runtimeProfile: desktopCmRuntimeProfile,
    message: desktopCmSessionMessage,
    saveSession: handleDesktopCmSessionSave,
    selectSession: handleDesktopCmSessionSelect,
    deleteSession: handleDesktopCmSessionDelete,
    importPrivateKey: handleDesktopCmSessionPrivateKeyImport,
    deleteCredential: handleDesktopCmSessionCredentialDelete,
    checkSession: handleDesktopCmSessionCheck,
    startRuntime: handleDesktopCmSessionRuntimeStart,
    stopRuntime: handleDesktopCmSessionRuntimeStop,
    checkRuntime: handleDesktopCmSessionRuntimeCheck,
  } = useDesktopCmSessionController({
    enabled: desktopConnectionAvailable,
    onRuntimeStarted: handleDesktopRuntimeStarted,
    onRuntimeStopped: handleDesktopRuntimeStopped,
  });

  useEffect(() => {
    if (!desktopConnectionAvailable) {
      return;
    }
    clearAdminToken();
    setLiveUnlocked(false);
    setAutoRefresh(false);
  }, [desktopConnectionAvailable, setAutoRefresh]);

  useEffect(() => {
    if (sourceMode === 'live' && (connectorError.endsWith(':401') || error.endsWith(':401'))) {
      clearAdminToken();
      setLiveUnlocked(false);
      setLiveSessionMessage('실시간 세션 잠김 · token 재입력 필요');
      setAutoRefresh(false);
    }
  }, [connectorError, error, setAutoRefresh, sourceMode]);

  useEffect(() => {
    if (nodes.length === 0) {
      if (selectedNodeId) {
        setSelectedNodeId('');
      }
      return;
    }

    if (!nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(nodes[0].id);
    }
  }, [nodes, selectedNodeId]);

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const snapshotNodeMap = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot.nodes]);
  const snapshotNodeIds = useMemo(() => new Set(snapshot.nodes.map((node) => node.id)), [snapshot.nodes]);
  const visibleNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) || snapshotNodeMap.get(selectedNodeId) : nodes[0];
  const providerLabel = sourceMode === 'live' ? connectorStatus?.source || '실시간' : sourceModeLabel(sourceMode);
  const snapshotBaseline = useMemo(
    () => snapshotHistory.find((entry) => entry.id === snapshotBaselineId) || null,
    [snapshotBaselineId, snapshotHistory],
  );
  const snapshotComparisonCurrent = useMemo(
    () => snapshotHistory.find((entry) => entry.id === snapshotCurrentId) || null,
    [snapshotCurrentId, snapshotHistory],
  );
  const comparisonCurrentSnapshot = snapshotComparisonCurrent?.snapshot || snapshot;
  const comparisonCurrentLabel = snapshotComparisonCurrent?.label || providerLabel;
  const topologySourceKey = useMemo(
    () => `${sourceMode}:${snapshot.clusters.map((cluster) => cluster.id).join(',')}:${snapshot.nodes.length}:${snapshot.edges.length}`,
    [snapshot.clusters, snapshot.edges.length, snapshot.nodes.length, sourceMode],
  );

  const handleSourceModeChange = useCallback(
    (nextMode: TopologySourceMode) => {
      setSourceMode(nextMode);
      storeSourceMode(nextMode);
      setSelectedNodeId('');
      writeAppUrlState({ viewMode, sourceMode: nextMode, resourceFilters: resourceUrlFilters }, 'push');
      if (nextMode !== 'live') {
        setAutoRefresh(false);
        setLiveSessionMessage('');
      }
    },
    [resourceUrlFilters, setAutoRefresh, viewMode],
  );

  const handleViewModeChange = useCallback(
    (nextMode: ViewMode) => {
      setViewMode(nextMode);
      writeAppUrlState({ viewMode: nextMode, sourceMode, resourceFilters: resourceUrlFilters }, nextMode === viewMode ? 'replace' : 'push');
    },
    [resourceUrlFilters, sourceMode, viewMode],
  );

  const handleResourceFiltersChange = useCallback(
    (nextFilters: ResourceViewFilters) => {
      setResourceUrlFilters((currentFilters) => (resourceViewFiltersEqual(currentFilters, nextFilters) ? currentFilters : nextFilters));
      if (viewMode === 'resources') {
        writeAppUrlState({ viewMode, sourceMode, resourceFilters: nextFilters }, 'replace');
      }
    },
    [sourceMode, viewMode],
  );

  useEffect(() => {
    appUrlStateRef.current = { viewMode, sourceMode, resourceFilters: resourceUrlFilters };
  }, [resourceUrlFilters, sourceMode, viewMode]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const nextViewMode = readViewModeFromSearch(window.location.search);
      const nextSourceMode = readSourceModeForAppUrl(window.location.search, event.state);
      const nextResourceFilters = readResourceViewFiltersFromSearch(window.location.search) || defaultResourceViewFilters();
      const currentState = appUrlStateRef.current;

      if (currentState.viewMode !== nextViewMode) {
        setViewMode(nextViewMode);
      }
      if (currentState.sourceMode !== nextSourceMode) {
        setSourceMode(nextSourceMode);
        storeSourceMode(nextSourceMode);
        setSelectedNodeId('');
        if (nextSourceMode !== 'live') {
          setAutoRefresh(false);
          setLiveSessionMessage('');
        }
      }
      if (!resourceViewFiltersEqual(currentState.resourceFilters, nextResourceFilters)) {
        setResourceUrlFilters(nextResourceFilters);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [setAutoRefresh]);

  useEffect(() => {
    writeAppUrlState(appUrlStateRef.current, 'replace');
  }, []);

  const handleUploadFiles = useCallback(async (files: File[]) => {
    setUploadError('');
    try {
      const nextUploadedState = await parseKubernetesFiles(files, { clusterId: uploadClusterId, clusterName: uploadClusterName });
      setUploadedState(nextUploadedState);
      setSourceMode('upload');
      storeSourceMode('upload');
      writeAppUrlState({ viewMode, sourceMode: 'upload', resourceFilters: resourceUrlFilters }, 'push');
      setFilters(initialFilters);
      setSelectedNodeId('');
    } catch (requestError) {
      setUploadError(requestError instanceof Error ? requestError.message : 'upload_parse_failed');
    }
  }, [resourceUrlFilters, uploadClusterId, uploadClusterName, viewMode]);

  const handleImportJson = useCallback(async (file: File) => {
    setUploadError('');
    try {
      const importedSnapshot = importTopologySnapshot(JSON.parse(await file.text()));
      setUploadedState({
        snapshot: importedSnapshot,
        files: [file.name],
        warnings: [],
        loadedAt: Date.now(),
      });
      setSourceMode('upload');
      storeSourceMode('upload');
      writeAppUrlState({ viewMode, sourceMode: 'upload', resourceFilters: resourceUrlFilters }, 'push');
      setFilters(initialFilters);
      setSelectedNodeId('');
    } catch (requestError) {
      setUploadError(requestError instanceof Error ? requestError.message : 'topology_import_failed');
    }
  }, [resourceUrlFilters, viewMode]);

  const handleExportJson = useCallback(() => {
    const payload = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kuviewer-${exportSourceName(sourceMode, uploadedState)}-topology.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }, [snapshot, sourceMode, uploadedState]);

  const handleCaptureSnapshotBaseline = useCallback(() => {
    const entry = createSnapshotHistoryEntry(snapshot, providerLabel, 'capture');
    setSnapshotHistory((current) => addSnapshotHistoryEntry(current, entry, [snapshotBaselineId, snapshotCurrentId]));
    setSnapshotBaselineId((current) => current || entry.id);
  }, [providerLabel, snapshot, snapshotBaselineId, snapshotCurrentId]);

  const handleImportSnapshotBaseline = useCallback(async (file: File) => {
    const importedSnapshot = importTopologySnapshot(JSON.parse(await file.text()));
    const entry = createSnapshotHistoryEntry(importedSnapshot, file.name, 'import');
    setSnapshotHistory((current) => addSnapshotHistoryEntry(current, entry, [snapshotBaselineId, snapshotCurrentId]));
    setSnapshotBaselineId(entry.id);
  }, [snapshotBaselineId, snapshotCurrentId]);

  const handleClearSnapshotHistory = useCallback(() => {
    setSnapshotHistory([]);
    setSnapshotBaselineId('');
    setSnapshotCurrentId('');
  }, []);

  const handleDeleteSnapshotHistory = useCallback((id: string) => {
    setSnapshotHistory((current) => deleteSnapshotHistoryEntry(current, id));
    setSnapshotBaselineId((current) => current === id ? '' : current);
    setSnapshotCurrentId((current) => current === id ? '' : current);
  }, []);

  const handleRenameSnapshotHistory = useCallback((id: string, label: string) => {
    setSnapshotHistory((current) => renameSnapshotHistoryEntry(current, id, label));
  }, []);

  useEffect(() => {
    const historyIds = new Set(snapshotHistory.map((entry) => entry.id));
    if (snapshotBaselineId && !historyIds.has(snapshotBaselineId)) {
      setSnapshotBaselineId('');
    }
    if (snapshotCurrentId && (!historyIds.has(snapshotCurrentId) || snapshotCurrentId === snapshotBaselineId)) {
      setSnapshotCurrentId('');
    }
  }, [snapshotBaselineId, snapshotCurrentId, snapshotHistory]);

  const handleLiveLock = useCallback(() => {
    clearAdminToken();
    setLiveUnlocked(false);
    setLiveSessionMessage('');
    setAutoRefresh(false);
    if (sourceMode === 'live') {
      setSourceMode('upload');
      storeSourceMode('upload');
      writeAppUrlState({ viewMode, sourceMode: 'upload', resourceFilters: resourceUrlFilters }, 'push');
    }
  }, [resourceUrlFilters, setAutoRefresh, sourceMode, viewMode]);

  const handleOpenTopologyNode = useCallback((nodeId: string) => {
    setFilters(initialFilters);
    setSelectedNodeId(nodeId);
    setViewMode('topology');
    writeAppUrlState({ viewMode: 'topology', sourceMode, resourceFilters: resourceUrlFilters }, 'push');
  }, [resourceUrlFilters, sourceMode]);

  const handleBrandThemeChange = useCallback((nextTheme: BrandTheme) => {
    setBrandTheme(nextTheme);
    storeBrandTheme(nextTheme);
  }, []);

  return (
    <main
      className="ku-app-shell text-[#1e2b3c]"
      data-brand-theme={brandTheme}
      data-theme={brandTheme === 'radar' ? 'dark' : 'light'}
    >
      <AppHeader
        autoRefresh={autoRefresh}
        brandTheme={brandTheme}
        connectorError={connectorError}
        connectorLoading={connectorLoading}
        connectorStatus={connectorStatus}
        lastUpdatedAt={lastUpdatedAt}
        liveActive={liveActive}
        liveUnlocked={liveUnlocked}
        loading={loading}
        providerLabel={providerLabel}
        refreshIntervalMs={refreshIntervalMs}
        sourceMode={sourceMode}
        topologyError={error}
        uploadError={uploadError}
        uploadedState={uploadedState}
        viewMode={viewMode}
        onAutoRefreshChange={setAutoRefresh}
        onBrandThemeChange={handleBrandThemeChange}
        onLiveLock={handleLiveLock}
        onRefresh={refresh}
        onResetFilters={() => setFilters(initialFilters)}
        onViewModeChange={handleViewModeChange}
      />

      <div className="mx-auto grid max-w-[1760px] gap-3 px-3 py-3 sm:px-4 lg:gap-4 lg:px-6 lg:py-4">
        <SourceModeBar
          canExport={snapshot.nodes.length > 0 || snapshot.edges.length > 0}
          desktopConnectionAvailable={desktopConnectionAvailable}
          desktopCmRuntimeProfile={desktopCmRuntimeProfile}
          desktopCmSessionMessage={desktopCmSessionMessage}
          desktopCmSessions={desktopCmSessions}
          liveSessionMessage={liveSessionMessage}
          liveUnlocked={liveUnlocked}
          mode={sourceMode}
          uploadClusterId={uploadClusterId}
          uploadClusterName={uploadClusterName}
          uploadedState={uploadedState}
          uploadError={uploadError}
          onDesktopCmSessionDelete={handleDesktopCmSessionDelete}
          onDesktopCmSessionCredentialDelete={handleDesktopCmSessionCredentialDelete}
          onDesktopCmSessionCheck={handleDesktopCmSessionCheck}
          onDesktopCmSessionPrivateKeyImport={handleDesktopCmSessionPrivateKeyImport}
          onDesktopCmSessionRuntimeCheck={handleDesktopCmSessionRuntimeCheck}
          onDesktopCmSessionRuntimeStart={handleDesktopCmSessionRuntimeStart}
          onDesktopCmSessionRuntimeStop={handleDesktopCmSessionRuntimeStop}
          onDesktopCmSessionSave={handleDesktopCmSessionSave}
          onDesktopCmSessionSelect={handleDesktopCmSessionSelect}
          onExportJson={handleExportJson}
          onImportJson={handleImportJson}
          onLiveLock={handleLiveLock}
          onLiveUnlock={() => {
            setLiveUnlocked(true);
            setLiveSessionMessage('');
          }}
          onModeChange={handleSourceModeChange}
          onUploadClusterIdChange={setUploadClusterId}
          onUploadClusterNameChange={setUploadClusterName}
          onUploadFiles={handleUploadFiles}
        />
        <StatTiles clusters={clusters} selectedClusterId={filters.cluster} />
        <FilterBar
          clusters={clusters}
          colorMode={colorMode}
          filters={filters}
          kinds={kinds}
          namespaces={namespaces}
          nodeNames={nodeNames}
          statuses={statuses}
          onColorModeChange={setColorMode}
          onFiltersChange={(nextFilters) => {
            setFilters(nextFilters);
            setSelectedNodeId('');
          }}
        />

        {viewMode === 'resources' ? (
          <Suspense fallback={<ViewLoading label="리소스 탐색" />}>
            <ResourceExplorer
              liveEnabled={liveActive}
              resourceFilters={resourceUrlFilters}
              selectedNodeId={selectedNode?.id || ''}
              snapshot={snapshot}
              sourceMode={sourceMode}
              onOpenTopologyNode={handleOpenTopologyNode}
              onResourceFiltersChange={handleResourceFiltersChange}
              onSelectNode={setSelectedNodeId}
            />
          </Suspense>
        ) : viewMode === 'compare' ? (
          <Suspense fallback={<ViewLoading label="스냅샷 비교" />}>
            <SnapshotComparePanel
              baseline={snapshotBaseline}
              baselineId={snapshotBaselineId}
              canCaptureCurrent={snapshot.nodes.length > 0}
              currentId={snapshotCurrentId}
              currentLabel={comparisonCurrentLabel}
              currentSnapshot={comparisonCurrentSnapshot}
              history={snapshotHistory}
              liveCurrentLabel={providerLabel}
              liveNodeIds={snapshotNodeIds}
              onCapture={handleCaptureSnapshotBaseline}
              onClearHistory={handleClearSnapshotHistory}
              onDeleteHistory={handleDeleteSnapshotHistory}
              onImport={handleImportSnapshotBaseline}
              onOpenTopologyNode={handleOpenTopologyNode}
              onRenameHistory={handleRenameSnapshotHistory}
              onSelectBaseline={setSnapshotBaselineId}
              onSelectCurrent={setSnapshotCurrentId}
            />
          </Suspense>
        ) : (
          <div className="grid gap-3 lg:gap-4 xl:grid-cols-[minmax(0,1fr)_390px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
            {viewMode === 'topology' ? (
              <Suspense fallback={<ViewLoading label="토폴로지" />}>
                <TopologyCanvas
                  brandTheme={brandTheme}
                  colorMode={colorMode}
                  edges={edges}
                  nodes={nodes}
                  selectedNodeId={selectedNode?.id || ''}
                  sourceKey={topologySourceKey}
                  onSelectNode={setSelectedNodeId}
                />
              </Suspense>
            ) : (
              <Suspense fallback={<ViewLoading label="트래픽 흐름" />}>
                <TrafficFlowView
                  edges={snapshot.edges}
                  nodes={snapshot.nodes}
                  selectedNodeId={selectedNode?.id || ''}
                  visibleNodeIds={visibleNodeIds}
                  onSelectNode={setSelectedNodeId}
                />
              </Suspense>
            )}

            <aside className="grid content-start gap-3 lg:gap-4 xl:sticky xl:top-[116px] xl:max-h-[calc(100vh-132px)] xl:overflow-auto xl:pr-1">
              <ConnectorDiagnostics
                capabilityEnabled={liveActive}
                capabilityError={capabilityError}
                capabilityLoading={capabilityLoading}
                capabilityReport={capabilityReport}
                collectionDiagnostics={snapshot.diagnostics || []}
                lastUpdatedAt={lastUpdatedAt}
                source={source}
                status={connectorStatus}
                statusError={connectorError}
                statusLoading={connectorLoading}
                topologyError={error}
                topologyLoading={loading}
                totalEdges={snapshot.edges.length}
                totalNodes={snapshot.nodes.length}
                visibleEdges={edges.length}
                visibleNodes={nodes.length}
                onRefreshCapabilities={refreshCapabilities}
              />
              <ResourceList nodes={nodes} selectedNodeId={selectedNode?.id || ''} onSelectNode={setSelectedNodeId} />
              <DetailPanel edges={snapshot.edges} node={selectedNode} nodeMap={snapshotNodeMap} />
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function ViewLoading({ label }: { label: string }) {
  return (
    <section className="ku-panel flex min-h-[360px] items-center justify-center p-6" aria-busy="true" aria-live="polite">
      <div className="text-center">
        <RefreshCw className="mx-auto animate-spin text-[#007aff]" size={22} aria-hidden="true" />
        <p className="mt-3 text-sm font-semibold text-[#1d1d1f]">{label}을 불러오는 중</p>
      </div>
    </section>
  );
}

function usePreventDocumentPullToRefresh() {
  useEffect(() => {
    let lastTouchY = 0;
    const touchStartOptions = { passive: true, capture: true } as AddEventListenerOptions;
    const touchMoveOptions = { passive: false, capture: true } as AddEventListenerOptions;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        return;
      }
      lastTouchY = event.touches[0].clientY;
      nudgeScrollBoundaries(event.target);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        return;
      }

      const currentTouchY = event.touches[0].clientY;
      const deltaY = currentTouchY - lastTouchY;
      lastTouchY = currentTouchY;

      if (deltaY === 0 || targetCanScroll(event.target, deltaY)) {
        return;
      }

      event.preventDefault();
    };

    document.addEventListener('touchstart', handleTouchStart, touchStartOptions);
    document.addEventListener('touchmove', handleTouchMove, touchMoveOptions);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart, touchStartOptions);
      document.removeEventListener('touchmove', handleTouchMove, touchMoveOptions);
    };
  }, []);
}

function nudgeScrollBoundaries(target: EventTarget | null) {
  const scrollableElements = scrollableAncestors(target);
  const appShell = document.querySelector('.ku-app-shell');
  if (appShell && !scrollableElements.includes(appShell)) {
    scrollableElements.push(appShell);
  }

  scrollableElements.forEach((element) => {
    const maxScrollTop = element.scrollHeight - element.clientHeight;
    if (maxScrollTop <= 1) {
      return;
    }
    if (element.scrollTop <= 0) {
      element.scrollTop = 1;
      return;
    }
    if (element.scrollTop >= maxScrollTop) {
      element.scrollTop = maxScrollTop - 1;
    }
  });
}

function scrollableAncestors(target: EventTarget | null) {
  const elements: Element[] = [];
  let element = target instanceof Element ? target : null;
  while (element) {
    const style = window.getComputedStyle(element);
    const scrollableY = ['auto', 'scroll', 'overlay'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
    if (scrollableY) {
      elements.push(element);
    }
    element = element.parentElement;
  }
  return elements;
}

function targetCanScroll(target: EventTarget | null, deltaY: number) {
  let element = target instanceof Element ? target : null;
  while (element) {
    if (elementCanScroll(element, deltaY)) {
      return true;
    }
    element = element.parentElement;
  }
  const appShell = document.querySelector('.ku-app-shell');
  if (appShell && elementCanScroll(appShell, deltaY)) {
    return true;
  }
  return false;
}

function elementCanScroll(element: Element, deltaY: number) {
  const style = window.getComputedStyle(element);
  const scrollableY = ['auto', 'scroll', 'overlay'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
  if (!scrollableY) {
    return false;
  }
  const canScrollUp = element.scrollTop > 1;
  const canScrollDown = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
  return (deltaY > 0 && canScrollUp) || (deltaY < 0 && canScrollDown);
}

function initialSourceMode(): TopologySourceMode {
  const source = readSourceModeFromSearch(window.location.search);
  if (source) {
    storeSourceMode(source);
    return source;
  }
  if (appSearchHasExplicitState(window.location.search)) {
    return 'upload';
  }
  const storedSource = readStoredSourceMode();
  return storedSource || 'upload';
}

function initialViewMode(): ViewMode {
  return readViewModeFromSearch(window.location.search);
}

function initialResourceViewFilters(): ResourceViewFilters {
  return readResourceViewFiltersFromSearch(window.location.search) || defaultResourceViewFilters();
}

function readViewModeFromSearch(search: string): ViewMode {
  const view = new URLSearchParams(search).get('view');
  if (view === 'resources' || view === 'traffic' || view === 'compare') {
    return view;
  }
  return 'topology';
}

function readSourceModeForAppUrl(search: string, historyState?: unknown): TopologySourceMode {
  const source = readSourceModeFromSearch(search);
  if (source) {
    return source;
  }
  const sourceFromHistory = readSourceModeFromHistoryState(historyState);
  if (sourceFromHistory) {
    return sourceFromHistory;
  }
  if (appSearchHasExplicitState(search)) {
    return 'upload';
  }
  return readStoredSourceMode() || 'upload';
}

function readSourceModeFromSearch(search: string): TopologySourceMode | null {
  const source = new URLSearchParams(search).get('source');
  return source === 'live' || source === 'mock' || source === 'upload' ? source : null;
}

function readSourceModeFromHistoryState(historyState: unknown): TopologySourceMode | null {
  if (!historyState || typeof historyState !== 'object') {
    return null;
  }
  const source = (historyState as Partial<AppUrlState>).sourceMode;
  return source === 'live' || source === 'mock' || source === 'upload' ? source : null;
}

function appSearchHasExplicitState(search: string) {
  const params = new URLSearchParams(search);
  return params.has('view') || params.has('source') || appSearchHasResourceViewState(search);
}

function writeAppUrlState(state: AppUrlState, mode: 'push' | 'replace') {
  const url = new URL(window.location.href);
  const params = new URLSearchParams();
  if (state.viewMode === 'resources') {
    params.set('view', 'resources');
  } else if (state.viewMode === 'traffic') {
    params.set('view', 'traffic');
  } else if (state.viewMode === 'compare') {
    params.set('view', 'compare');
  }
  if (state.sourceMode !== 'upload') {
    params.set('source', state.sourceMode);
  }
  if (state.viewMode === 'resources') {
    appendResourceViewFilterSearchParams(params, state.resourceFilters);
  }

  url.search = params.toString();
  url.hash = '';
  const nextPath = `${url.pathname}${url.search}${url.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const historyState = {
    kuviewer: true,
    viewMode: state.viewMode,
    sourceMode: state.sourceMode,
    resourceFilters: state.resourceFilters,
  };

  if (nextPath === currentPath) {
    window.history.replaceState(historyState, '', nextPath);
    return;
  }
  if (mode === 'push') {
    window.history.pushState(historyState, '', nextPath);
  } else {
    window.history.replaceState(historyState, '', nextPath);
  }
}

function initialBrandTheme(): BrandTheme {
  if (typeof window === 'undefined') {
    return 'yaml-flow';
  }
  return window.localStorage.getItem(brandThemeStorageKey) === 'radar' ? 'radar' : 'yaml-flow';
}

function storeBrandTheme(theme: BrandTheme) {
  window.localStorage.setItem(brandThemeStorageKey, theme);
}

function readStoredSourceMode(): TopologySourceMode | null {
  try {
    const source = window.sessionStorage.getItem(sourceModeStorageKey);
    return source === 'live' || source === 'mock' || source === 'upload' ? source : null;
  } catch {
    return null;
  }
}

function storeSourceMode(sourceMode: TopologySourceMode) {
  try {
    window.sessionStorage.setItem(sourceModeStorageKey, sourceMode);
  } catch {
    // Session storage can be unavailable in hardened browser modes.
  }
}

function sourceModeLabel(sourceMode: TopologySourceMode) {
  if (sourceMode === 'upload') {
    return '업로드';
  }
  if (sourceMode === 'mock') {
    return '목업';
  }
  return '실시간';
}

function exportSourceName(sourceMode: TopologySourceMode, uploadedState: UploadedTopologyState | null) {
  if (sourceMode === 'upload' && uploadedState?.snapshot.clusters[0]?.id) {
    return sanitizeFilenamePart(uploadedState.snapshot.clusters[0].id);
  }
  return sanitizeFilenamePart(sourceMode);
}

function sanitizeFilenamePart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'topology';
}
