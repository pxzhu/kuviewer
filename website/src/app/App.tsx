import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, GitBranch, LockKeyhole, Palette, Pause, Play, RefreshCw, SearchCode, SlidersHorizontal, Workflow } from 'lucide-react';
import { clearAdminToken, getStoredAdminToken, isValidAdminToken, storeAdminToken } from '../features/auth/adminToken';
import {
  getDesktopConnectionProfile,
  getDesktopSidecarProfile,
  isDesktopRuntime,
  storeDesktopConnectionProfile,
  subscribeDesktopConnectionProfile,
  type DesktopConnectionProfile,
} from '../features/desktop/desktopConnectionProfile';
import { useConnectorStatus } from '../features/status/useConnectorStatus';
import { type ColorMode, type TopologyFilters, type TopologySourceMode, useTopology } from '../features/topology/useTopology';
import { importTopologySnapshot, parseKubernetesFiles, type UploadedTopologyState } from '../features/upload/parseKubernetesFiles';
import { ConnectorDiagnostics } from '../components/ConnectorDiagnostics';
import { DetailPanel } from '../components/DetailPanel';
import { FilterBar } from '../components/FilterBar';
import { ResourceList } from '../components/ResourceList';
import {
  ResourceExplorer,
  appSearchHasResourceViewState,
  appendResourceViewFilterSearchParams,
  defaultResourceViewFilters,
  readResourceViewFiltersFromSearch,
  resourceViewFiltersEqual,
  type ResourceViewFilters,
} from '../components/ResourceExplorer';
import { SourceModeBar } from '../components/SourceModeBar';
import { StatTiles } from '../components/StatTiles';
import { TopologyCanvas } from '../components/TopologyCanvas';
import { TrafficFlowView } from '../components/TrafficFlowView';
import type { ConnectorStatus } from '../types/status';

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
type BrandTheme = 'yaml-flow' | 'radar';
type ViewMode = 'topology' | 'traffic' | 'resources';

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
  const [desktopConnectionProfile, setDesktopConnectionProfile] = useState<DesktopConnectionProfile | null>(() => getDesktopConnectionProfile());
  const [liveUnlocked, setLiveUnlocked] = useState(() => isValidAdminToken(getStoredAdminToken()));
  const [uploadedState, setUploadedState] = useState<UploadedTopologyState | null>(null);
  const [uploadClusterName, setUploadClusterName] = useState('uploaded-bundle');
  const [uploadClusterId, setUploadClusterId] = useState('uploaded-bundle');
  const [uploadError, setUploadError] = useState('');
  const [liveSessionMessage, setLiveSessionMessage] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const liveActive = sourceMode === 'live' && liveUnlocked;
  const appUrlStateRef = useRef<AppUrlState>({
    viewMode,
    sourceMode,
    resourceFilters: resourceUrlFilters,
  });

  const { status: connectorStatus, loading: connectorLoading, error: connectorError } = useConnectorStatus(liveActive);
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

  useEffect(() => {
    if (!desktopConnectionAvailable) {
      return;
    }
    return subscribeDesktopConnectionProfile(() => {
      setDesktopConnectionProfile(getDesktopConnectionProfile());
    });
  }, [desktopConnectionAvailable]);

  useEffect(() => {
    if (!desktopConnectionAvailable) {
      return;
    }

    let cancelled = false;
    void getDesktopSidecarProfile()
      .then((sidecarProfile) => {
        if (cancelled || !sidecarProfile) {
          return;
        }

        const currentProfile = getDesktopConnectionProfile();
        if (currentProfile && currentProfile.serverUrl !== sidecarProfile.serverUrl) {
          setLiveSessionMessage('desktop local sidecar 대기 · remote profile 사용 중');
          return;
        }

        storeAdminToken(sidecarProfile.adminToken);
        setDesktopConnectionProfile(storeDesktopConnectionProfile(sidecarProfile.serverUrl));
        setLiveUnlocked(true);
        setLiveSessionMessage(`desktop local sidecar 연결됨 · ${sidecarProfile.source} source`);
      })
      .catch(() => {
        if (!cancelled) {
          setLiveSessionMessage('desktop local sidecar 시작 안 됨 · remote profile 사용 가능');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [desktopConnectionAvailable]);

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
  const visibleNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) || snapshotNodeMap.get(selectedNodeId) : nodes[0];
  const AutoRefreshIcon = autoRefresh ? Pause : Play;
  const providerLabel = sourceMode === 'live' ? connectorStatus?.source || '실시간' : sourceModeLabel(sourceMode);
  const brandIconSrc =
    brandTheme === 'radar'
      ? `${import.meta.env.BASE_URL}images/brand/kuviewer-icon-radar.svg?v=0.1.40`
      : `${import.meta.env.BASE_URL}images/brand/kuviewer-icon-yaml-flow.svg?v=0.1.40`;
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

  const handleDesktopConnectionProfileChange = useCallback(
    (profile: DesktopConnectionProfile | null) => {
      setDesktopConnectionProfile(profile);
      clearAdminToken();
      setLiveUnlocked(false);
      setAutoRefresh(false);
      setLiveSessionMessage(profile ? 'desktop server 변경됨 · token 재입력 필요' : 'desktop server profile 없음');
    },
    [setAutoRefresh],
  );

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
    <main className="ku-app-shell text-[#1e2b3c]" data-brand-theme={brandTheme}>
      <header className="sticky top-0 z-50 border-b border-[rgba(137,158,186,0.18)] bg-white/82 shadow-[0_16px_46px_rgba(73,104,143,0.12)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-3 px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="flex min-w-0 gap-3">
            <img
              className="mt-0.5 h-11 w-11 shrink-0 rounded-[13px] border border-[rgba(137,158,186,0.22)] shadow-[0_12px_28px_rgba(73,104,143,0.16)]"
              src={brandIconSrc}
              alt=""
              aria-hidden="true"
            />
            <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="ku-chip border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]">
                <Boxes size={13} aria-hidden="true" />
                {providerLabel} 소스
              </span>
              <span className="ku-chip">
                {loading ? '동기화 중' : `동기화 ${formatLastSync(lastUpdatedAt)}`}
              </span>
              <span className="ku-chip max-w-full truncate">
                {formatConnectorStatus(connectorStatus, connectorLoading, connectorError, sourceMode, liveUnlocked, uploadedState)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-[22px] font-semibold tracking-[0] text-[#1d1d1f]">Kuviewer</h1>
              <p className="font-mono text-xs font-semibold text-[rgba(60,60,67,0.62)]">
                Kubernetes 리소스 맵 · 관계 · YAML 기반 트래픽 흐름
              </p>
            </div>
            {error ? <p className="mt-1 text-sm font-semibold text-[#b26a00]">API 오류: {formatUiError(error)}</p> : null}
            {uploadError ? <p className="mt-1 text-sm font-semibold text-[#b26a00]">업로드 오류: {formatUiError(uploadError)}</p> : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="grid grid-cols-2 rounded-[11px] border border-[rgba(60,60,67,0.16)] bg-white/70 p-1 shadow-[0_2px_10px_rgba(0,0,0,0.04)] backdrop-blur-xl" aria-label="브랜드 테마">
              {(['yaml-flow', 'radar'] as BrandTheme[]).map((theme) => (
                <button
                  key={theme}
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] px-3 text-sm font-semibold transition ${
                    brandTheme === theme ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white/80'
                  }`}
                  type="button"
                  aria-pressed={brandTheme === theme}
                  onClick={() => handleBrandThemeChange(theme)}
                >
                  <Palette size={14} aria-hidden="true" />
                  {theme === 'yaml-flow' ? 'D' : 'B'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 rounded-[11px] border border-[rgba(60,60,67,0.16)] bg-white/70 p-1 shadow-[0_2px_10px_rgba(0,0,0,0.04)] backdrop-blur-xl">
              <button
                className={`inline-flex h-8 items-center justify-center gap-2 rounded-[8px] px-3 text-sm font-semibold transition ${
                  viewMode === 'topology' ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white/80'
                }`}
                type="button"
                onClick={() => handleViewModeChange('topology')}
              >
                <GitBranch size={15} aria-hidden="true" />
                토폴로지
              </button>
              <button
                className={`inline-flex h-8 items-center justify-center gap-2 rounded-[8px] px-3 text-sm font-semibold transition ${
                  viewMode === 'traffic' ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white/80'
                }`}
                type="button"
                onClick={() => handleViewModeChange('traffic')}
              >
                <Workflow size={15} aria-hidden="true" />
                트래픽 흐름
              </button>
              <button
                className={`inline-flex h-8 items-center justify-center gap-2 rounded-[8px] px-3 text-sm font-semibold transition ${
                  viewMode === 'resources' ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white/80'
                }`}
                type="button"
                onClick={() => handleViewModeChange('resources')}
              >
                <SearchCode size={15} aria-hidden="true" />
                리소스 탐색
              </button>
            </div>
            <button
              className="ku-control"
              type="button"
              onClick={refresh}
              disabled={!liveActive || loading}
              title="실시간 토폴로지 새로고침"
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} size={16} aria-hidden="true" />
              새로고침
            </button>
            <button
              className={`inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-sm font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition ${
                autoRefresh
                  ? 'border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.1)] text-[#0066cc] hover:bg-[rgba(0,122,255,0.14)]'
                  : 'border-[rgba(60,60,67,0.16)] bg-white/80 text-[#1d1d1f] hover:bg-white'
              } ${liveActive ? '' : 'cursor-not-allowed opacity-60'}`}
              type="button"
              onClick={() => setAutoRefresh(!autoRefresh)}
              disabled={!liveActive}
              aria-pressed={autoRefresh}
              title="실시간 자동 새로고침 전환"
            >
              <AutoRefreshIcon size={16} aria-hidden="true" />
              자동 {Math.round(refreshIntervalMs / 1000)}초
            </button>
            <button
              className="ku-control"
              type="button"
              onClick={() => setFilters(initialFilters)}
              title="필터 초기화"
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              초기화
            </button>
            <button
              className="ku-control-primary"
              type="button"
              disabled={!liveUnlocked}
              onClick={handleLiveLock}
              title="실시간 admin token 지우기"
            >
              <LockKeyhole size={16} aria-hidden="true" />
              실시간 잠금
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1760px] gap-3 px-3 py-3 sm:px-4 lg:gap-4 lg:px-6 lg:py-4">
        <SourceModeBar
          canExport={snapshot.nodes.length > 0 || snapshot.edges.length > 0}
          desktopConnectionAvailable={desktopConnectionAvailable}
          desktopConnectionProfile={desktopConnectionProfile}
          liveSessionMessage={liveSessionMessage}
          liveUnlocked={liveUnlocked}
          mode={sourceMode}
          uploadClusterId={uploadClusterId}
          uploadClusterName={uploadClusterName}
          uploadedState={uploadedState}
          uploadError={uploadError}
          onDesktopConnectionProfileChange={handleDesktopConnectionProfileChange}
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
        ) : (
          <div className="grid gap-3 lg:gap-4 xl:grid-cols-[minmax(0,1fr)_390px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
            {viewMode === 'topology' ? (
            <TopologyCanvas
              brandTheme={brandTheme}
              colorMode={colorMode}
              edges={edges}
              nodes={nodes}
              selectedNodeId={selectedNode?.id || ''}
              sourceKey={topologySourceKey}
              onSelectNode={setSelectedNodeId}
            />
            ) : (
            <TrafficFlowView
              edges={snapshot.edges}
              nodes={snapshot.nodes}
              selectedNodeId={selectedNode?.id || ''}
              visibleNodeIds={visibleNodeIds}
              onSelectNode={setSelectedNodeId}
            />
            )}

            <aside className="grid content-start gap-3 lg:gap-4 xl:sticky xl:top-[116px] xl:max-h-[calc(100vh-132px)] xl:overflow-auto xl:pr-1">
            <ConnectorDiagnostics
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

function formatLastSync(lastUpdatedAt: number | null) {
  if (!lastUpdatedAt) {
    return '안 됨';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(lastUpdatedAt));
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
  if (view === 'resources' || view === 'traffic') {
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

function formatConnectorStatus(
  status: ConnectorStatus | null,
  loading: boolean,
  error: string,
  sourceMode: TopologySourceMode,
  liveUnlocked: boolean,
  uploadedState: UploadedTopologyState | null,
) {
  if (sourceMode === 'upload') {
    if (!uploadedState) {
      return '업로드 소스 · 매니페스트 대기 중';
    }

    return `업로드 소스 · ${uploadedState.snapshot.nodes.length}개 리소스 · 경고 ${uploadedState.warnings.length}개`;
  }

  if (sourceMode === 'mock') {
    return '목업 소스 · 내장 데모 데이터';
  }

  if (!liveUnlocked) {
    return '실시간 소스 잠김 · admin token 필요';
  }

  if (status) {
    const accessLabel = status.readOnly ? '읽기 전용' : '쓰기 가능';
    const secretsLabel = status.secrets === 'hidden' ? 'Secret 숨김' : `Secret ${status.secrets}`;
    const uiLabel = status.static ? '정적 UI 포함' : '분리된 UI';

    return `제공자 ${status.source} · ${accessLabel} · ${secretsLabel} · ${uiLabel}`;
  }

  if (loading) {
    return '제공자 상태 로딩 중';
  }

  if (error) {
    return `제공자 상태 오류: ${formatUiError(error)}`;
  }

  return '제공자 상태 확인 불가';
}

function formatUiError(error: string) {
  if (error.includes(':401')) {
    return 'admin token 인증 실패(401)';
  }
  if (error.includes(':500')) {
    return '서버에서 토폴로지 스냅샷 생성 실패(500)';
  }
  if (error.includes('api_base_url')) {
    return 'API 주소가 설정되지 않았습니다.';
  }
  if (error.includes('invalid_topology_json')) {
    return '토폴로지 JSON 형식이 올바르지 않습니다.';
  }
  if (error.includes('topology_import_failed')) {
    return '토폴로지 JSON 가져오기에 실패했습니다.';
  }
  if (error.includes('upload_parse_failed')) {
    return '업로드 파일을 해석하지 못했습니다.';
  }
  if (error.includes('topology_request_failed')) {
    return '토폴로지 API 요청에 실패했습니다.';
  }

  return error;
}
