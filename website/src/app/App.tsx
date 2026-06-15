import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, GitBranch, LockKeyhole, Pause, Play, RefreshCw, SlidersHorizontal, Workflow } from 'lucide-react';
import { clearAdminToken, getStoredAdminToken, isValidAdminToken } from '../features/auth/adminToken';
import { useConnectorStatus } from '../features/status/useConnectorStatus';
import { type ColorMode, type TopologyFilters, type TopologySourceMode, useTopology } from '../features/topology/useTopology';
import { importTopologySnapshot, parseKubernetesFiles, type UploadedTopologyState } from '../features/upload/parseKubernetesFiles';
import { ConnectorDiagnostics } from '../components/ConnectorDiagnostics';
import { DetailPanel } from '../components/DetailPanel';
import { FilterBar } from '../components/FilterBar';
import { ResourceList } from '../components/ResourceList';
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

export function App() {
  return <Dashboard />;
}

function Dashboard() {
  usePreventDocumentPullToRefresh();

  const [filters, setFilters] = useState(initialFilters);
  const [colorMode, setColorMode] = useState<ColorMode>('status');
  const [viewMode, setViewMode] = useState<'topology' | 'traffic'>('topology');
  const [sourceMode, setSourceMode] = useState<TopologySourceMode>(() => initialSourceMode());
  const [liveUnlocked, setLiveUnlocked] = useState(() => isValidAdminToken(getStoredAdminToken()));
  const [uploadedState, setUploadedState] = useState<UploadedTopologyState | null>(null);
  const [uploadClusterName, setUploadClusterName] = useState('uploaded-bundle');
  const [uploadClusterId, setUploadClusterId] = useState('uploaded-bundle');
  const [uploadError, setUploadError] = useState('');
  const [liveSessionMessage, setLiveSessionMessage] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const liveActive = sourceMode === 'live' && liveUnlocked;

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
  const topologySourceKey = useMemo(
    () => `${sourceMode}:${snapshot.clusters.map((cluster) => cluster.id).join(',')}:${snapshot.nodes.length}:${snapshot.edges.length}`,
    [snapshot.clusters, snapshot.edges.length, snapshot.nodes.length, sourceMode],
  );

  const handleSourceModeChange = useCallback(
    (nextMode: TopologySourceMode) => {
      setSourceMode(nextMode);
      storeSourceMode(nextMode);
      setSelectedNodeId('');
      if (nextMode !== 'live') {
        setAutoRefresh(false);
        setLiveSessionMessage('');
      }
    },
    [setAutoRefresh],
  );

  const handleUploadFiles = useCallback(async (files: File[]) => {
    setUploadError('');
    try {
      const nextUploadedState = await parseKubernetesFiles(files, { clusterId: uploadClusterId, clusterName: uploadClusterName });
      setUploadedState(nextUploadedState);
      setSourceMode('upload');
      storeSourceMode('upload');
      setFilters(initialFilters);
      setSelectedNodeId('');
    } catch (requestError) {
      setUploadError(requestError instanceof Error ? requestError.message : 'upload_parse_failed');
    }
  }, [uploadClusterId, uploadClusterName]);

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
      setFilters(initialFilters);
      setSelectedNodeId('');
    } catch (requestError) {
      setUploadError(requestError instanceof Error ? requestError.message : 'topology_import_failed');
    }
  }, []);

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
    }
  }, [setAutoRefresh, sourceMode]);

  return (
    <main className="ku-app-shell text-[#1d1d1f]">
      <header className="sticky top-0 z-50 border-b border-[rgba(60,60,67,0.14)] bg-[#f5f5f7]/80 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-3 px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
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

          <div className="flex flex-wrap items-center gap-2">
            <div className="grid grid-cols-2 rounded-[11px] border border-[rgba(60,60,67,0.16)] bg-white/70 p-1 shadow-[0_2px_10px_rgba(0,0,0,0.04)] backdrop-blur-xl">
              <button
                className={`inline-flex h-8 items-center justify-center gap-2 rounded-[8px] px-3 text-sm font-semibold transition ${
                  viewMode === 'topology' ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white/80'
                }`}
                type="button"
                onClick={() => setViewMode('topology')}
              >
                <GitBranch size={15} aria-hidden="true" />
                토폴로지
              </button>
              <button
                className={`inline-flex h-8 items-center justify-center gap-2 rounded-[8px] px-3 text-sm font-semibold transition ${
                  viewMode === 'traffic' ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white/80'
                }`}
                type="button"
                onClick={() => setViewMode('traffic')}
              >
                <Workflow size={15} aria-hidden="true" />
                트래픽 흐름
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
          liveSessionMessage={liveSessionMessage}
          liveUnlocked={liveUnlocked}
          mode={sourceMode}
          uploadClusterId={uploadClusterId}
          uploadClusterName={uploadClusterName}
          uploadedState={uploadedState}
          uploadError={uploadError}
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

        <div className="grid gap-3 lg:gap-4 xl:grid-cols-[minmax(0,1fr)_390px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
          {viewMode === 'topology' ? (
            <TopologyCanvas
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
  const source = new URLSearchParams(window.location.search).get('source');
  if (source === 'live' || source === 'mock' || source === 'upload') {
    storeSourceMode(source);
    return source;
  }
  const storedSource = readStoredSourceMode();
  return storedSource || 'upload';
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
