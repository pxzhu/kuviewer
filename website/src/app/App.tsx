import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, GitBranch, GitCompareArrows, LockKeyhole, Palette, Pause, Play, RefreshCw, SearchCode, SlidersHorizontal, Workflow, type LucideIcon } from 'lucide-react';
import { clearAdminToken, getStoredAdminToken, isValidAdminToken } from '../features/auth/adminToken';
import type {
  DesktopCmSession,
  DesktopCmSessionInput,
  DesktopCmSessionRuntimeProfile,
} from '../features/desktop/desktopConnectionProfile';
import { isDesktopRuntime } from '../features/desktop/desktopRuntime';
import { useConnectorStatus } from '../features/status/useConnectorStatus';
import { describeConnectorError } from '../features/status/connectorDiagnostics';
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
import type { ConnectorStatus } from '../types/status';
import { formatLastSync } from '../utils/formatTime';

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
const loadDesktopConnectionApi = () => import('../features/desktop/desktopConnectionProfile');
type BrandTheme = 'yaml-flow' | 'radar';
type ViewMode = 'topology' | 'traffic' | 'resources' | 'compare';

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

const brandThemeOptions: Array<{ value: BrandTheme; label: string }> = [
  { value: 'yaml-flow', label: 'D' },
  { value: 'radar', label: 'B' },
];

const viewModeOptions: Array<{ value: ViewMode; label: string; icon: LucideIcon }> = [
  { value: 'topology', label: '토폴로지', icon: GitBranch },
  { value: 'traffic', label: '트래픽 흐름', icon: Workflow },
  { value: 'resources', label: '리소스 탐색', icon: SearchCode },
  { value: 'compare', label: '스냅샷 비교', icon: GitCompareArrows },
];

interface AppUrlState {
  viewMode: ViewMode;
  sourceMode: TopologySourceMode;
  resourceFilters: ResourceViewFilters;
}

export function App() {
  return <Dashboard />;
}

function HeaderSegmentButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      className={`ku-segmented-button ${active ? 'ku-segmented-button-active' : ''}`}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon size={15} aria-hidden="true" />
      {label}
    </button>
  );
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
  const [desktopCmSessions, setDesktopCmSessions] = useState<DesktopCmSession[]>([]);
  const [desktopCmRuntimeProfile, setDesktopCmRuntimeProfile] = useState<DesktopCmSessionRuntimeProfile | null>(null);
  const [desktopCmSessionMessage, setDesktopCmSessionMessage] = useState('');
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

  useEffect(() => {
    if (!desktopConnectionAvailable) {
      return;
    }
    void loadDesktopConnectionApi().then(({ clearDesktopCmRuntimeProfile, clearDesktopConnectionProfile }) => {
      clearDesktopConnectionProfile();
      clearDesktopCmRuntimeProfile();
    });
    clearAdminToken();
    setLiveUnlocked(false);
    setAutoRefresh(false);
  }, [desktopConnectionAvailable, setAutoRefresh]);

  useEffect(() => {
    if (!desktopConnectionAvailable) {
      return;
    }

    let cancelled = false;
    void loadDesktopConnectionApi()
      .then(({ getDesktopCmSessions }) => getDesktopCmSessions())
      .then((sessions) => {
        if (cancelled) {
          return;
        }
        setDesktopCmSessions(sessions);
        setDesktopCmSessionMessage(sessions.length > 0 ? 'CM/SSH session metadata 준비됨' : 'CM/SSH session 없음');
      })
      .catch(() => {
        if (!cancelled) {
          setDesktopCmSessions([]);
          setDesktopCmSessionMessage('CM/SSH session 읽기 실패');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [desktopConnectionAvailable]);

  useEffect(() => {
    if (!desktopConnectionAvailable) {
      return;
    }

    let cancelled = false;
    let unsubscribe = () => {};
    void loadDesktopConnectionApi()
      .then(async (desktopApi) => {
        const profile = await desktopApi.getDesktopCmSessionRuntime();
        if (cancelled) {
          return;
        }
        if (profile) {
          desktopApi.storeDesktopCmRuntimeProfile(profile);
          setDesktopCmRuntimeProfile(profile);
        } else {
          desktopApi.clearDesktopCmRuntimeProfile();
          setDesktopCmRuntimeProfile(null);
        }
        unsubscribe = desktopApi.subscribeDesktopCmRuntimeProfile(() => {
          setDesktopCmRuntimeProfile(desktopApi.getDesktopCmRuntimeProfile());
        });
      })
      .catch(() => {
        if (!cancelled) {
          setDesktopCmRuntimeProfile(null);
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
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
  const snapshotNodeIds = useMemo(() => new Set(snapshot.nodes.map((node) => node.id)), [snapshot.nodes]);
  const visibleNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) || snapshotNodeMap.get(selectedNodeId) : nodes[0];
  const AutoRefreshIcon = autoRefresh ? Pause : Play;
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

  const handleDesktopCmSessionSave = useCallback(async (session: DesktopCmSessionInput) => {
    const { saveDesktopCmSession } = await loadDesktopConnectionApi();
    const savedSession = await saveDesktopCmSession(session);
    if (!savedSession) {
      throw new Error('desktop_cm_session_save_failed');
    }
    setDesktopCmSessions((currentSessions) => upsertDesktopCmSession(currentSessions, savedSession));
    setDesktopCmSessionMessage(`${savedSession.name} 저장됨 · metadata-only`);
  }, []);

  const handleDesktopCmSessionSelect = useCallback(async (sessionId: string) => {
    const { selectDesktopCmSession } = await loadDesktopConnectionApi();
    const selectedSession = await selectDesktopCmSession(sessionId);
    if (!selectedSession) {
      throw new Error('desktop_cm_session_not_found');
    }
    setDesktopCmSessions((currentSessions) =>
      currentSessions.map((session) => ({
        ...session,
        selected: session.id === selectedSession.id,
        status: session.id === selectedSession.id ? selectedSession.status : 'metadata-only',
      })),
    );
    setDesktopCmSessionMessage(`${selectedSession.name} 선택됨 · ${selectedSession.credentialAvailable ? 'credential ready' : 'credential 필요'}`);
  }, []);

  const handleDesktopCmSessionDelete = useCallback(async (sessionId: string) => {
    const { clearDesktopCmRuntimeProfile, deleteDesktopCmSession } = await loadDesktopConnectionApi();
    const sessions = await deleteDesktopCmSession(sessionId);
    setDesktopCmSessions(sessions);
    if (desktopCmRuntimeProfile?.sessionId === sessionId) {
      clearDesktopCmRuntimeProfile();
      setDesktopCmRuntimeProfile(null);
      if (sourceMode === 'live') {
        setSourceMode('upload');
        storeSourceMode('upload');
        writeAppUrlState({ viewMode, sourceMode: 'upload', resourceFilters: resourceUrlFilters }, 'push');
        setAutoRefresh(false);
      }
    }
    setDesktopCmSessionMessage('CM/SSH session 삭제됨');
  }, [desktopCmRuntimeProfile?.sessionId, resourceUrlFilters, setAutoRefresh, sourceMode, viewMode]);

  const handleDesktopCmSessionPrivateKeyImport = useCallback(async (sessionId: string, keyFilePath: string) => {
    const { importDesktopCmSessionPrivateKey } = await loadDesktopConnectionApi();
    const updatedSession = await importDesktopCmSessionPrivateKey(sessionId, keyFilePath);
    if (!updatedSession) {
      throw new Error('desktop_cm_private_key_import_failed');
    }
    setDesktopCmSessions((currentSessions) => upsertDesktopCmSession(currentSessions, updatedSession));
    setDesktopCmSessionMessage(`${updatedSession.name} credential 저장됨`);
  }, []);

  const handleDesktopCmSessionCredentialDelete = useCallback(async (sessionId: string) => {
    const { clearDesktopCmRuntimeProfile, deleteDesktopCmSessionCredential } = await loadDesktopConnectionApi();
    const updatedSession = await deleteDesktopCmSessionCredential(sessionId);
    if (!updatedSession) {
      throw new Error('desktop_cm_credential_delete_failed');
    }
    if (desktopCmRuntimeProfile?.sessionId === sessionId) {
      clearDesktopCmRuntimeProfile();
      setDesktopCmRuntimeProfile(null);
      if (sourceMode === 'live') {
        setSourceMode('upload');
        storeSourceMode('upload');
        writeAppUrlState({ viewMode, sourceMode: 'upload', resourceFilters: resourceUrlFilters }, 'push');
        setAutoRefresh(false);
      }
    }
    setDesktopCmSessions((currentSessions) => upsertDesktopCmSession(currentSessions, updatedSession));
    setDesktopCmSessionMessage(`${updatedSession.name} credential 삭제됨`);
  }, [desktopCmRuntimeProfile?.sessionId, resourceUrlFilters, setAutoRefresh, sourceMode, viewMode]);

  const handleDesktopCmSessionCheck = useCallback(async (sessionId: string) => {
    const { checkDesktopCmSession } = await loadDesktopConnectionApi();
    const updatedSession = await checkDesktopCmSession(sessionId);
    if (!updatedSession) {
      throw new Error('desktop_cm_session_check_failed');
    }
    setDesktopCmSessions((currentSessions) => upsertDesktopCmSession(currentSessions, updatedSession));
    setDesktopCmSessionMessage(`${updatedSession.name} 확인 · ${formatCmSessionStatus(updatedSession.lastCheckStatus)}`);
  }, []);

  const handleDesktopCmSessionRuntimeStart = useCallback(async (sessionId: string) => {
    const { startDesktopCmSessionRuntime, storeDesktopCmRuntimeProfile } = await loadDesktopConnectionApi();
    const profile = await startDesktopCmSessionRuntime(sessionId);
    if (!profile) {
      throw new Error('desktop_cm_runtime_start_failed');
    }
    storeDesktopCmRuntimeProfile(profile);
    setDesktopCmRuntimeProfile(profile);
    setDesktopCmSessions((currentSessions) =>
      currentSessions.map((session) => ({
        ...session,
        selected: session.id === profile.sessionId,
        status: session.id === profile.sessionId ? 'runtime-active' : session.status,
        runtimeStatus: session.id === profile.sessionId ? 'runtime-active' : 'stopped',
        diagnosticStage: session.id === profile.sessionId ? profile.diagnosticStage : session.diagnosticStage,
        diagnosticSeverity: session.id === profile.sessionId ? profile.diagnosticSeverity : session.diagnosticSeverity,
        diagnosticMessage: session.id === profile.sessionId ? profile.diagnosticMessage : session.diagnosticMessage,
        diagnosticHint: session.id === profile.sessionId ? profile.diagnosticHint : session.diagnosticHint,
      })),
    );
    setSourceMode('live');
    storeSourceMode('live');
    writeAppUrlState({ viewMode, sourceMode: 'live', resourceFilters: resourceUrlFilters }, 'push');
    setDesktopCmSessionMessage(`${profile.sessionName} runtime 시작됨`);
  }, [resourceUrlFilters, viewMode]);

  const handleDesktopCmSessionRuntimeStop = useCallback(async () => {
    const { clearDesktopCmRuntimeProfile, stopDesktopCmSessionRuntime } = await loadDesktopConnectionApi();
    await stopDesktopCmSessionRuntime();
    const stoppedSessionId = desktopCmRuntimeProfile?.sessionId;
    clearDesktopCmRuntimeProfile();
    setDesktopCmRuntimeProfile(null);
    setDesktopCmSessions((currentSessions) =>
      currentSessions.map((session) => ({
        ...session,
        status: session.id === stoppedSessionId && session.credentialAvailable ? 'credential-ready' : session.status,
        runtimeStatus: session.id === stoppedSessionId ? 'stopped' : session.runtimeStatus,
        diagnosticStage: session.id === stoppedSessionId ? 'runtime' : session.diagnosticStage,
        diagnosticSeverity: session.id === stoppedSessionId ? 'info' : session.diagnosticSeverity,
        diagnosticMessage: session.id === stoppedSessionId ? 'runtime-stopped' : session.diagnosticMessage,
        diagnosticHint: session.id === stoppedSessionId ? 'Start runtime again when needed.' : session.diagnosticHint,
      })),
    );
    if (sourceMode === 'live') {
      setSourceMode('upload');
      storeSourceMode('upload');
      writeAppUrlState({ viewMode, sourceMode: 'upload', resourceFilters: resourceUrlFilters }, 'push');
      setAutoRefresh(false);
    }
    setDesktopCmSessionMessage('CM/SSH runtime 중지됨');
  }, [desktopCmRuntimeProfile?.sessionId, resourceUrlFilters, setAutoRefresh, sourceMode, viewMode]);

  const handleDesktopCmSessionRuntimeCheck = useCallback(async () => {
    const { checkDesktopCmSessionRuntime, clearDesktopCmRuntimeProfile, storeDesktopCmRuntimeProfile } = await loadDesktopConnectionApi();
    const previousSessionId = desktopCmRuntimeProfile?.sessionId;
    const profile = await checkDesktopCmSessionRuntime();
    if (!profile) {
      clearDesktopCmRuntimeProfile();
      setDesktopCmRuntimeProfile(null);
      setDesktopCmSessions((currentSessions) =>
        currentSessions.map((session) => ({
          ...session,
          status: session.id === previousSessionId ? 'runtime-lost' : session.status,
          runtimeStatus: session.id === previousSessionId ? 'runtime-lost' : session.runtimeStatus,
          diagnosticStage: session.id === previousSessionId ? 'runtime' : session.diagnosticStage,
          diagnosticSeverity: session.id === previousSessionId ? 'error' : session.diagnosticSeverity,
          diagnosticMessage: session.id === previousSessionId ? 'runtime-lost' : session.diagnosticMessage,
          diagnosticHint: session.id === previousSessionId ? 'SSH tunnel process exited. Start the runtime again.' : session.diagnosticHint,
        })),
      );
      if (sourceMode === 'live') {
        setSourceMode('upload');
        storeSourceMode('upload');
        writeAppUrlState({ viewMode, sourceMode: 'upload', resourceFilters: resourceUrlFilters }, 'push');
        setAutoRefresh(false);
      }
      setDesktopCmSessionMessage('CM/SSH runtime 끊김');
      return;
    }
    storeDesktopCmRuntimeProfile(profile);
    setDesktopCmRuntimeProfile(profile);
    setDesktopCmSessions((currentSessions) =>
      currentSessions.map((session) => ({
        ...session,
        status: session.id === profile.sessionId ? (profile.healthStatus === 'healthy' ? 'runtime-active' : 'runtime-unhealthy') : session.status,
        runtimeStatus: session.id === profile.sessionId ? (profile.healthStatus === 'healthy' ? 'runtime-active' : 'runtime-unhealthy') : session.runtimeStatus,
        diagnosticStage: session.id === profile.sessionId ? profile.diagnosticStage : session.diagnosticStage,
        diagnosticSeverity: session.id === profile.sessionId ? profile.diagnosticSeverity : session.diagnosticSeverity,
        diagnosticMessage: session.id === profile.sessionId ? profile.diagnosticMessage : session.diagnosticMessage,
        diagnosticHint: session.id === profile.sessionId ? profile.diagnosticHint : session.diagnosticHint,
      })),
    );
    setDesktopCmSessionMessage(`${profile.sessionName} health · ${formatCmRuntimeHealthStatus(profile.healthStatus)}`);
  }, [desktopCmRuntimeProfile?.sessionId, resourceUrlFilters, setAutoRefresh, sourceMode, viewMode]);

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
      <header className="ku-header sticky top-0 z-50">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-3 px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="flex min-w-0 gap-3">
            <img
              className="ku-brand-mark mt-0.5 h-11 w-11 shrink-0"
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
                  {loading ? '동기화 중' : `동기화 ${formatLastSync(lastUpdatedAt, '안 됨')}`}
                </span>
                <span className="ku-chip max-w-full truncate">
                  {formatConnectorStatus(connectorStatus, connectorLoading, connectorError, sourceMode, liveUnlocked, uploadedState)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="ku-title text-[22px] font-semibold tracking-[0]">Kuviewer</h1>
                <p className="ku-copy font-mono text-xs font-semibold">
                  Kubernetes 리소스 맵 · 관계 · YAML 기반 트래픽 흐름
                </p>
              </div>
              {error ? <p className="mt-1 text-sm font-semibold text-[#b26a00]">API 오류: {formatUiError(error)}</p> : null}
              {uploadError ? <p className="mt-1 text-sm font-semibold text-[#b26a00]">업로드 오류: {formatUiError(uploadError)}</p> : null}
            </div>
          </div>

          <div className="ku-header-actions">
            <div className="ku-segmented grid-cols-2" aria-label="브랜드 테마">
              {brandThemeOptions.map((option) => (
                <HeaderSegmentButton
                  key={option.value}
                  active={brandTheme === option.value}
                  icon={Palette}
                  label={option.label}
                  onClick={() => handleBrandThemeChange(option.value)}
                />
              ))}
            </div>
            <div className="ku-segmented grid-cols-4" aria-label="주요 보기">
              {viewModeOptions.map((option) => (
                <HeaderSegmentButton
                  key={option.value}
                  active={viewMode === option.value}
                  icon={option.icon}
                  label={option.label}
                  onClick={() => handleViewModeChange(option.value)}
                />
              ))}
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

function upsertDesktopCmSession(sessions: DesktopCmSession[], savedSession: DesktopCmSession) {
  const existingIndex = sessions.findIndex((session) => session.id === savedSession.id);
  if (existingIndex === -1) {
    return [savedSession, ...sessions];
  }
  return sessions.map((session) => (session.id === savedSession.id ? savedSession : session));
}

function formatCmSessionStatus(status: string) {
  switch (status) {
    case 'reachable':
      return '연결 가능';
    case 'auth-failed':
      return '인증 실패';
    case 'timeout':
      return '시간 초과';
    case 'unreachable':
      return '연결 불가';
    case 'not-ssh':
      return 'SSH 아님';
    case 'ssh-binary-missing':
      return 'ssh 없음';
    case 'credential-ready':
      return 'credential 준비됨';
    case 'credential-missing':
      return 'credential 없음';
    default:
      return status || '확인 안 됨';
  }
}

function formatCmRuntimeHealthStatus(status: string) {
  switch (status) {
    case 'healthy':
      return '정상';
    case 'unhealthy':
      return 'health 실패';
    case 'unknown':
      return '미확인';
    default:
      return status || '미확인';
  }
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
    return `제공자 상태 오류: ${describeConnectorError(error).message}`;
  }

  return '제공자 상태 확인 불가';
}

function formatUiError(error: string) {
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
    return describeConnectorError(error).message;
  }
  if (error.includes('status_request_failed') || error.includes('api_base_url') || error.toLowerCase().includes('failed to fetch')) {
    return describeConnectorError(error).message;
  }
  return '요청을 처리하지 못했습니다.';
}
