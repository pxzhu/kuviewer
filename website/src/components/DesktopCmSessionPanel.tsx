import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bookmark, CheckCircle2, Download, Filter, KeyRound, Pencil, Play, Plus, Search, ServerCog, ShieldCheck, Square, Trash2, Unplug, Upload, XCircle } from 'lucide-react';
import {
  createDesktopCmSessionExportBundle,
  desktopCmDefaultRemoteApiHost,
  desktopCmDefaultRemoteApiPort,
  desktopCmSessionEndpointKey,
  parseDesktopCmSessionImportBundle,
  type DesktopCmSession,
  type DesktopCmSessionInput,
  type DesktopCmSessionRuntimeProfile,
} from '../features/desktop/desktopConnectionProfile';

interface DesktopCmSessionPanelProps {
  message: string;
  runtimeProfile: DesktopCmSessionRuntimeProfile | null;
  sessions: DesktopCmSession[];
  onDeleteSession: (sessionId: string) => Promise<void>;
  onDeleteSessionCredential: (sessionId: string) => Promise<void>;
  onCheckSession: (sessionId: string) => Promise<void>;
  onImportPrivateKey: (sessionId: string, keyFilePath: string) => Promise<void>;
  onCheckSessionRuntime: () => Promise<void>;
  onStartSessionRuntime: (sessionId: string) => Promise<void>;
  onStopSessionRuntime: () => Promise<void>;
  onSaveSession: (session: DesktopCmSessionInput) => Promise<void>;
  onSelectSession: (sessionId: string) => Promise<void>;
}

const emptyForm: DesktopCmSessionInput = {
  name: '',
  host: '',
  port: 22,
  user: '',
  remoteApiHost: desktopCmDefaultRemoteApiHost,
  remoteApiPort: desktopCmDefaultRemoteApiPort,
  description: '',
};

interface DesktopCmSessionImportSummary {
  fileName: string;
  imported: number;
  updated: number;
  skipped: number;
  invalid: number;
}

interface DesktopCmDiagnosticFilterPreset {
  name: string;
  diagnosticStage: CmDiagnosticStageFilter;
  diagnosticSeverity: CmDiagnosticSeverityFilter;
  updatedAt: number;
}

const cmDiagnosticStageFilterOptions = ['all', 'metadata', 'credential', 'reachability', 'ssh-auth', 'tunnel', 'health', 'runtime'] as const;
const cmDiagnosticSeverityFilterOptions = ['all', 'info', 'warning', 'error'] as const;
const desktopCmDiagnosticFilterPresetStorageKey = 'kuviewer_desktop_cm_diagnostic_filter_presets';
const maxDesktopCmDiagnosticFilterPresets = 8;
const maxDesktopCmDiagnosticFilterPresetNameLength = 40;

type CmDiagnosticStageFilter = (typeof cmDiagnosticStageFilterOptions)[number];
type CmDiagnosticSeverityFilter = (typeof cmDiagnosticSeverityFilterOptions)[number];

export function DesktopCmSessionPanel({
  message,
  runtimeProfile,
  sessions,
  onDeleteSession,
  onDeleteSessionCredential,
  onCheckSession,
  onImportPrivateKey,
  onCheckSessionRuntime,
  onStartSessionRuntime,
  onStopSessionRuntime,
  onSaveSession,
  onSelectSession,
}: DesktopCmSessionPanelProps) {
  const selectedSession = useMemo(() => sessions.find((session) => session.selected), [sessions]);
  const activeRuntimeSessionId = runtimeProfile?.sessionId || '';
  const [form, setForm] = useState<DesktopCmSessionInput>(emptyForm);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState('');
  const [credentialDeleteConfirmId, setCredentialDeleteConfirmId] = useState('');
  const [keyFilePaths, setKeyFilePaths] = useState<Record<string, string>>({});
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [diagnosticStageFilter, setDiagnosticStageFilter] = useState<CmDiagnosticStageFilter>('all');
  const [diagnosticSeverityFilter, setDiagnosticSeverityFilter] = useState<CmDiagnosticSeverityFilter>('all');
  const [diagnosticFilterPresetName, setDiagnosticFilterPresetName] = useState('');
  const [diagnosticFilterPresets, setDiagnosticFilterPresets] = useState<DesktopCmDiagnosticFilterPreset[]>(() => readDesktopCmDiagnosticFilterPresets());
  const [importSummary, setImportSummary] = useState<DesktopCmSessionImportSummary | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedSessionSearchQuery = normalizeSearchValue(sessionSearchQuery);
  const visibleSessions = useMemo(
    () =>
      sessions.filter((session) => {
        const diagnostic = getDisplayedCmDiagnostic(session, runtimeProfile, activeRuntimeSessionId);
        return (
          matchesCmSessionSearch(session, normalizedSessionSearchQuery, diagnostic) &&
          matchesCmDiagnosticFilters(diagnostic, diagnosticStageFilter, diagnosticSeverityFilter)
        );
      }),
    [activeRuntimeSessionId, diagnosticSeverityFilter, diagnosticStageFilter, normalizedSessionSearchQuery, runtimeProfile, sessions],
  );
  const diagnosticFiltersActive = diagnosticStageFilter !== 'all' || diagnosticSeverityFilter !== 'all';
  const activeDiagnosticFilterPresetName = useMemo(
    () => diagnosticFilterPresets.find((preset) => preset.diagnosticStage === diagnosticStageFilter && preset.diagnosticSeverity === diagnosticSeverityFilter)?.name || '',
    [diagnosticFilterPresets, diagnosticSeverityFilter, diagnosticStageFilter],
  );
  const selectedRuntimeActive = Boolean(selectedSession && runtimeProfile?.sessionId === selectedSession.id);
  const selectedRuntimeStatus = selectedRuntimeActive ? runtimeProfile?.status || selectedSession?.runtimeStatus || 'runtime-active' : selectedSession?.runtimeStatus || 'stopped';

  useEffect(() => {
    if (form.id && !sessions.some((session) => session.id === form.id)) {
      setForm(emptyForm);
    }
  }, [form.id, sessions]);

  const handleSave = async () => {
    setError('');
    setBusyAction('save');
    try {
      await onSaveSession(form);
      setForm(emptyForm);
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_session_save_failed'));
    } finally {
      setBusyAction('');
    }
  };

  const handleSelect = async (sessionId: string) => {
    setError('');
    setBusyAction(`select:${sessionId}`);
    try {
      await onSelectSession(sessionId);
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_session_select_failed'));
    } finally {
      setBusyAction('');
    }
  };

  const handleDelete = async (sessionId: string) => {
    if (deleteConfirmId !== sessionId) {
      setDeleteConfirmId(sessionId);
      return;
    }

    setError('');
    setBusyAction(`delete:${sessionId}`);
    try {
      await onDeleteSession(sessionId);
      setDeleteConfirmId('');
      if (form.id === sessionId) {
        setForm(emptyForm);
      }
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_session_delete_failed'));
    } finally {
      setBusyAction('');
    }
  };

  const handleImportPrivateKey = async (sessionId: string) => {
    setError('');
    setBusyAction(`import-key:${sessionId}`);
    try {
      await onImportPrivateKey(sessionId, keyFilePaths[sessionId] || '');
      setKeyFilePaths((current) => ({ ...current, [sessionId]: '' }));
      setCredentialDeleteConfirmId('');
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_private_key_import_failed'));
    } finally {
      setBusyAction('');
    }
  };

  const handleCredentialDelete = async (sessionId: string) => {
    if (credentialDeleteConfirmId !== sessionId) {
      setCredentialDeleteConfirmId(sessionId);
      return;
    }

    setError('');
    setBusyAction(`delete-credential:${sessionId}`);
    try {
      await onDeleteSessionCredential(sessionId);
      setCredentialDeleteConfirmId('');
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_credential_delete_failed'));
    } finally {
      setBusyAction('');
    }
  };

  const handleCheckSession = async (sessionId: string) => {
    setError('');
    setBusyAction(`check:${sessionId}`);
    try {
      await onCheckSession(sessionId);
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_session_check_failed'));
    } finally {
      setBusyAction('');
    }
  };

  const handleStartRuntime = async (sessionId: string) => {
    setError('');
    setBusyAction(`start-runtime:${sessionId}`);
    try {
      await onStartSessionRuntime(sessionId);
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_runtime_start_failed'));
    } finally {
      setBusyAction('');
    }
  };

  const handleStopRuntime = async () => {
    setError('');
    setBusyAction('stop-runtime');
    try {
      await onStopSessionRuntime();
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_runtime_stop_failed'));
    } finally {
      setBusyAction('');
    }
  };

  const handleCheckRuntime = async () => {
    setError('');
    setBusyAction('check-runtime');
    try {
      await onCheckSessionRuntime();
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_runtime_check_failed'));
    } finally {
      setBusyAction('');
    }
  };

  const handleExportSessions = () => {
    setError('');
    const bundle = createDesktopCmSessionExportBundle(sessions);
    const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kuviewer-desktop-cm-sessions-${new Date(bundle.exportedAt).toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const handleImportSessions = async (file: File | null) => {
    if (!file) {
      return;
    }
    setError('');
    setBusyAction('import-sessions');
    try {
      const parsed = parseDesktopCmSessionImportBundle(JSON.parse(await file.text()));
      let imported = 0;
      let updated = 0;
      const knownSessionIds = new Map(sessions.map((session) => [desktopCmSessionEndpointKey(session), session.id]));
      for (const item of parsed.items) {
        const endpointKey = desktopCmSessionEndpointKey(item);
        const existingSessionId = knownSessionIds.get(endpointKey);
        await onSaveSession(existingSessionId ? { ...item, id: existingSessionId } : item);
        if (existingSessionId) {
          updated += 1;
        } else {
          imported += 1;
        }
        knownSessionIds.set(endpointKey, existingSessionId || endpointKey);
      }
      setImportSummary({ fileName: file.name, imported, updated, skipped: parsed.skipped, invalid: parsed.invalid });
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_session_import_failed'));
    } finally {
      setBusyAction('');
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
    }
  };

  const handleSaveDiagnosticFilterPreset = () => {
    const presetName = normalizeDesktopCmDiagnosticFilterPresetName(
      diagnosticFilterPresetName || `${formatCmDiagnosticStage(diagnosticStageFilter)} · ${formatCmDiagnosticSeverity(diagnosticSeverityFilter)}`,
    );
    const preset: DesktopCmDiagnosticFilterPreset = {
      name: presetName,
      diagnosticStage: diagnosticStageFilter,
      diagnosticSeverity: diagnosticSeverityFilter,
      updatedAt: Date.now(),
    };
    setDiagnosticFilterPresets((current) => {
      const withoutSameName = current.filter((item) => item.name.toLowerCase() !== preset.name.toLowerCase());
      const nextPresets = [preset, ...withoutSameName].slice(0, maxDesktopCmDiagnosticFilterPresets);
      writeDesktopCmDiagnosticFilterPresets(nextPresets);
      return nextPresets;
    });
    setDiagnosticFilterPresetName('');
  };

  const handleApplyDiagnosticFilterPreset = (preset: DesktopCmDiagnosticFilterPreset) => {
    setDiagnosticStageFilter(preset.diagnosticStage);
    setDiagnosticSeverityFilter(preset.diagnosticSeverity);
  };

  const handleDeleteDiagnosticFilterPreset = (presetName: string) => {
    setDiagnosticFilterPresets((current) => {
      const nextPresets = current.filter((preset) => preset.name !== presetName);
      writeDesktopCmDiagnosticFilterPresets(nextPresets);
      return nextPresets;
    });
  };

  return (
    <div
      className="grid gap-3 border-t border-[rgba(60,60,67,0.1)] bg-[rgba(247,250,255,0.48)] px-3 py-3 lg:px-4"
      data-testid="desktop-cm-session-panel"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="ku-meta">Desktop CM/SSH sessions</span>
        {selectedSession ? (
          <span className="ku-chip max-w-full border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]" title={`${selectedSession.user}@${selectedSession.host}:${selectedSession.port}`}>
            <CheckCircle2 size={13} aria-hidden="true" />
            <span className="truncate">{selectedSession.name}</span>
          </span>
        ) : (
          <span className="ku-chip max-w-full">
            <Unplug size={13} aria-hidden="true" />
            선택된 세션 없음
          </span>
        )}
        <span className="ku-chip max-w-full">
          <ShieldCheck size={13} aria-hidden="true" />
          secret 저장 없음
        </span>
        <span className="ku-chip max-w-full">
          <KeyRound size={13} aria-hidden="true" />
          credential store 사용
        </span>
        {runtimeProfile ? (
          <span className="ku-chip max-w-full border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]" title={runtimeProfile.serverUrl}>
            <Play size={13} aria-hidden="true" />
            <span className="truncate">runtime active · {runtimeProfile.sessionName}</span>
          </span>
        ) : null}
        {message ? (
          <span className="ku-chip max-w-full border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]">
            <ServerCog size={13} aria-hidden="true" />
            {message}
          </span>
        ) : null}
        {error ? (
          <span className="ku-chip max-w-full border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]">
            {error}
          </span>
        ) : null}
        {importSummary ? (
          <span className="ku-chip max-w-full" data-testid="desktop-cm-session-import-summary">
            import {importSummary.fileName} · new {importSummary.imported} · updated {importSummary.updated} · skipped {importSummary.skipped} · invalid {importSummary.invalid}
          </span>
        ) : null}
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(130px,1fr)_minmax(160px,1.3fr)_88px_minmax(110px,0.8fr)_minmax(140px,1fr)_88px_minmax(140px,1fr)_auto] xl:items-end">
        <label className="min-w-0">
          <span className="ku-meta">Name</span>
          <input
            className="ku-field mt-1 h-9 w-full"
            data-testid="desktop-cm-session-name"
            placeholder="prod cm"
            value={form.name}
            onChange={(event) => {
              setForm((current) => ({ ...current, name: event.target.value }));
              setError('');
            }}
          />
        </label>
        <label className="min-w-0">
          <span className="ku-meta">Host</span>
          <input
            className="ku-field mt-1 h-9 w-full font-mono"
            data-testid="desktop-cm-session-host"
            placeholder="cm.example.internal"
            value={form.host}
            onChange={(event) => {
              setForm((current) => ({ ...current, host: event.target.value }));
              setError('');
            }}
          />
        </label>
        <label className="min-w-0">
          <span className="ku-meta">Port</span>
          <input
            className="ku-field mt-1 h-9 w-full font-mono"
            data-testid="desktop-cm-session-port"
            inputMode="numeric"
            value={form.port}
            onChange={(event) => {
              setForm((current) => ({ ...current, port: Number(event.target.value || 0) }));
              setError('');
            }}
          />
        </label>
        <label className="min-w-0">
          <span className="ku-meta">User</span>
          <input
            className="ku-field mt-1 h-9 w-full font-mono"
            data-testid="desktop-cm-session-user"
            placeholder="ubuntu"
            value={form.user}
            onChange={(event) => {
              setForm((current) => ({ ...current, user: event.target.value }));
              setError('');
            }}
          />
        </label>
        <label className="min-w-0">
          <span className="ku-meta">API host</span>
          <input
            className="ku-field mt-1 h-9 w-full font-mono"
            data-testid="desktop-cm-session-remote-api-host"
            placeholder={desktopCmDefaultRemoteApiHost}
            value={form.remoteApiHost || desktopCmDefaultRemoteApiHost}
            onChange={(event) => {
              setForm((current) => ({ ...current, remoteApiHost: event.target.value }));
              setError('');
            }}
          />
        </label>
        <label className="min-w-0">
          <span className="ku-meta">API port</span>
          <input
            className="ku-field mt-1 h-9 w-full font-mono"
            data-testid="desktop-cm-session-remote-api-port"
            inputMode="numeric"
            value={form.remoteApiPort || desktopCmDefaultRemoteApiPort}
            onChange={(event) => {
              setForm((current) => ({ ...current, remoteApiPort: Number(event.target.value || 0) }));
              setError('');
            }}
          />
        </label>
        <label className="min-w-0">
          <span className="ku-meta">Description</span>
          <input
            className="ku-field mt-1 h-9 w-full"
            data-testid="desktop-cm-session-description"
            placeholder="readonly entry"
            value={form.description || ''}
            onChange={(event) => {
              setForm((current) => ({ ...current, description: event.target.value }));
              setError('');
            }}
          />
        </label>
        <div className="flex gap-2">
          <button className="ku-control-primary h-9" data-testid="desktop-cm-session-save" type="button" disabled={busyAction === 'save'} onClick={() => void handleSave()}>
            <Plus size={15} aria-hidden="true" />
            {form.id ? '수정' : '저장'}
          </button>
          {form.id ? (
            <button className="ku-control h-9" type="button" onClick={() => setForm(emptyForm)}>
              취소
            </button>
          ) : null}
        </div>
      </div>

      <div
        className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.1)] bg-white/70 px-3 py-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
        data-testid="desktop-cm-session-summary"
      >
        {selectedSession ? (
          <>
            <div className="grid min-w-0 gap-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="ku-meta">Selected CM session</span>
                <span className="ku-chip max-w-full border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]" data-testid="desktop-cm-session-summary-name">
                  <CheckCircle2 size={13} aria-hidden="true" />
                  <span className="truncate">{selectedSession.name}</span>
                </span>
                <span
                  className={`ku-chip max-w-full ${
                    selectedSession.credentialAvailable ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]' : 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#8a4d00]'
                  }`}
                  data-testid="desktop-cm-session-summary-credential"
                >
                  <KeyRound size={13} aria-hidden="true" />
                  {selectedSession.credentialAvailable ? 'credential ready' : 'credential 필요'}
                </span>
                <span className={`ku-chip max-w-full ${cmRuntimeStatusClass(selectedRuntimeStatus)}`} data-testid="desktop-cm-session-summary-runtime">
                  <Activity size={13} aria-hidden="true" />
                  {formatRuntimeStatus(selectedRuntimeStatus)}
                </span>
                {selectedRuntimeActive && runtimeProfile ? (
                  <span className={`ku-chip max-w-full ${runtimeProfile.healthStatus === 'healthy' ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]' : 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]'}`} data-testid="desktop-cm-session-summary-health">
                    <Activity size={13} aria-hidden="true" />
                    {formatRuntimeHealthStatus(runtimeProfile.healthStatus)}
                  </span>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-semibold text-[rgba(60,60,67,0.62)]">
                <span className="truncate font-mono" title={`${selectedSession.user}@${selectedSession.host}:${selectedSession.port}`}>
                  {selectedSession.user}@{selectedSession.host}:{selectedSession.port}
                </span>
                <span className="truncate font-mono">
                  API {selectedSession.remoteApiHost}:{selectedSession.remoteApiPort}
                </span>
                <span className="truncate">
                  {selectedSession.lastCheckAt ? `last check ${formatTimestamp(selectedSession.lastCheckAt)}` : formatCmSessionCheckStatus(selectedSession.lastCheckStatus)}
                </span>
              </div>
              <DesktopCmDiagnostics
                diagnostic={selectedRuntimeActive && runtimeProfile ? runtimeProfile : selectedSession}
                testId="desktop-cm-session-summary-diagnostics"
              />
            </div>
            {selectedRuntimeActive && runtimeProfile ? (
              <div className="min-w-0 text-xs font-semibold text-[rgba(60,60,67,0.62)]" data-testid="desktop-cm-session-summary-runtime-url">
                <p className="truncate font-mono" title={runtimeProfile.serverUrl}>{runtimeProfile.serverUrl}</p>
                <p className="truncate">
                  {runtimeProfile.lastHealthAt ? `health ${formatTimestamp(runtimeProfile.lastHealthAt)}` : 'health 미확인'}
                  {runtimeProfile.lastHealthMessage ? ` · ${runtimeProfile.lastHealthMessage}` : ''}
                </p>
              </div>
            ) : (
              <div className="text-xs font-semibold text-[rgba(60,60,67,0.58)]">
                runtime은 credential이 준비된 세션에서만 시작됩니다.
              </div>
            )}
          </>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="ku-meta">Selected CM session</span>
            <span className="ku-chip">
              <Unplug size={13} aria-hidden="true" />
              선택된 세션 없음
            </span>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="desktop-cm-session-transfer-bar">
        <button
          className="ku-control h-9"
          data-testid="desktop-cm-session-export"
          type="button"
          disabled={sessions.length === 0 || busyAction === 'import-sessions'}
          onClick={handleExportSessions}
        >
          <Download size={14} aria-hidden="true" />
          세션 export
        </button>
        <label className={`ku-control h-9 ${busyAction === 'import-sessions' ? 'opacity-60' : ''}`} data-testid="desktop-cm-session-import-label">
          <Upload size={14} aria-hidden="true" />
          세션 import
          <input
            ref={importInputRef}
            className="hidden"
            data-testid="desktop-cm-session-import"
            type="file"
            accept="application/json,.json"
            disabled={busyAction === 'import-sessions'}
            onChange={(event) => void handleImportSessions(event.currentTarget.files?.[0] || null)}
          />
        </label>
        <span className="text-xs font-semibold text-[rgba(60,60,67,0.58)]">
          safe metadata only · kuviewer.desktop.cmSessions · credential/runtime/logs 제외
        </span>
      </div>

      {sessions.length > 0 ? (
        <div className="grid gap-2" data-testid="desktop-cm-session-search-bar">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.48)]" size={15} aria-hidden="true" />
              <input
                className="ku-field h-9 w-full pl-9 pr-3"
                data-testid="desktop-cm-session-search"
                placeholder="세션 검색"
                value={sessionSearchQuery}
                onChange={(event) => setSessionSearchQuery(event.target.value)}
              />
            </label>
            <button className="ku-control h-9" data-testid="desktop-cm-session-search-clear" type="button" disabled={!sessionSearchQuery} onClick={() => setSessionSearchQuery('')}>
              <XCircle size={14} aria-hidden="true" />
              초기화
            </button>
            <label className="flex min-w-[150px] items-center gap-2">
              <span className="ku-meta whitespace-nowrap">
                <Filter size={13} aria-hidden="true" className="inline-block align-[-2px]" /> Stage
              </span>
              <select
                className="ku-field h-9 min-w-[118px]"
                data-testid="desktop-cm-session-diagnostic-stage-filter"
                value={diagnosticStageFilter}
                onChange={(event) => setDiagnosticStageFilter(event.target.value as CmDiagnosticStageFilter)}
              >
                {cmDiagnosticStageFilterOptions.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage === 'all' ? 'all stages' : formatCmDiagnosticStage(stage)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[150px] items-center gap-2">
              <span className="ku-meta whitespace-nowrap">Severity</span>
              <select
                className="ku-field h-9 min-w-[112px]"
                data-testid="desktop-cm-session-diagnostic-severity-filter"
                value={diagnosticSeverityFilter}
                onChange={(event) => setDiagnosticSeverityFilter(event.target.value as CmDiagnosticSeverityFilter)}
              >
                {cmDiagnosticSeverityFilterOptions.map((severity) => (
                  <option key={severity} value={severity}>
                    {severity === 'all' ? 'all severities' : formatCmDiagnosticSeverity(severity)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="ku-control h-9"
              data-testid="desktop-cm-session-diagnostic-filter-clear"
              type="button"
              disabled={!diagnosticFiltersActive}
              onClick={() => {
                setDiagnosticStageFilter('all');
                setDiagnosticSeverityFilter('all');
              }}
            >
              <XCircle size={14} aria-hidden="true" />
              진단 필터 초기화
            </button>
            <span className="ku-chip" data-testid="desktop-cm-session-search-count">
              결과 {visibleSessions.length} / 전체 {sessions.length}
            </span>
          </div>

          <div
            className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.1)] bg-white/68 px-3 py-2"
            data-testid="desktop-cm-diagnostic-saved-filters"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="ku-meta">Saved diagnostic filters</span>
              <label className="min-w-[180px] flex-1">
                <input
                  className="ku-field h-9 w-full"
                  data-testid="desktop-cm-diagnostic-filter-preset-name"
                  maxLength={maxDesktopCmDiagnosticFilterPresetNameLength}
                  placeholder={`${formatCmDiagnosticStage(diagnosticStageFilter)} · ${formatCmDiagnosticSeverity(diagnosticSeverityFilter)}`}
                  value={diagnosticFilterPresetName}
                  onChange={(event) => setDiagnosticFilterPresetName(event.target.value)}
                />
              </label>
              <button className="ku-control h-9" data-testid="desktop-cm-diagnostic-filter-preset-save" type="button" onClick={handleSaveDiagnosticFilterPreset}>
                <Bookmark size={14} aria-hidden="true" />
                현재 진단 필터 저장
              </button>
              <span className="ku-chip" data-testid="desktop-cm-diagnostic-filter-preset-count">
                {diagnosticFilterPresets.length} / {maxDesktopCmDiagnosticFilterPresets}
              </span>
            </div>
            {diagnosticFilterPresets.length > 0 ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="desktop-cm-diagnostic-filter-preset-list">
                {diagnosticFilterPresets.map((preset) => {
                  const active = preset.name === activeDiagnosticFilterPresetName;
                  return (
                    <span
                      key={preset.name}
                      className={`ku-chip max-w-full gap-1 ${active ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]' : ''}`}
                      data-testid={`desktop-cm-diagnostic-filter-preset-${slugifyTestId(preset.name)}`}
                    >
                      <button className="flex min-w-0 items-center gap-1 truncate" type="button" onClick={() => handleApplyDiagnosticFilterPreset(preset)}>
                        <Bookmark size={12} aria-hidden="true" />
                        <span className="truncate">{preset.name}</span>
                        <span className="truncate font-mono text-[10px]">
                          {formatCmDiagnosticStage(preset.diagnosticStage)} / {formatCmDiagnosticSeverity(preset.diagnosticSeverity)}
                        </span>
                      </button>
                      <button
                        className="ml-1 rounded-full p-0.5 hover:bg-[rgba(60,60,67,0.08)]"
                        data-testid={`desktop-cm-diagnostic-filter-preset-delete-${slugifyTestId(preset.name)}`}
                        type="button"
                        title={`${preset.name} 삭제`}
                        onClick={() => handleDeleteDiagnosticFilterPreset(preset.name)}
                      >
                        <XCircle size={12} aria-hidden="true" />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs font-semibold text-[rgba(60,60,67,0.58)]" data-testid="desktop-cm-diagnostic-filter-preset-empty">
                저장된 진단 필터 없음
              </p>
            )}
          </div>
        </div>
      ) : null}

      {sessions.length > 0 ? (
        visibleSessions.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {visibleSessions.map((session) => (
            <div
              key={session.id}
              className={`grid min-w-0 gap-2 rounded-[8px] border px-3 py-2 text-left transition ${
                session.selected
                  ? 'border-[rgba(52,199,89,0.28)] bg-[rgba(52,199,89,0.09)]'
                  : 'border-[rgba(60,60,67,0.13)] bg-white/72 hover:bg-white'
              }`}
              data-testid={`desktop-cm-session-${session.id}`}
            >
              <button className="min-w-0 text-left" type="button" onClick={() => void handleSelect(session.id)}>
                <span className="flex min-w-0 items-center gap-2">
                  <ServerCog className="shrink-0 text-[rgba(60,60,67,0.48)]" size={15} aria-hidden="true" />
                  <span className="truncate text-sm font-semibold text-[#1d1d1f]">{session.name}</span>
                </span>
                <span className="mt-1 block truncate font-mono text-xs font-semibold text-[rgba(60,60,67,0.62)]">
                  {session.user}@{session.host}:{session.port}
                </span>
                <span className="mt-1 block truncate font-mono text-xs font-semibold text-[rgba(60,60,67,0.58)]">
                  API {session.remoteApiHost}:{session.remoteApiPort}
                </span>
                <span className="mt-1 block truncate text-xs font-semibold text-[rgba(60,60,67,0.58)]">
                  {session.authType} · {session.status} · {session.runtimeStatus}
                </span>
                <span className={`mt-1 flex min-w-0 items-center gap-1 truncate text-xs font-semibold ${session.credentialAvailable ? 'text-[#248a3d]' : 'text-[rgba(60,60,67,0.58)]'}`}>
                  <KeyRound className="shrink-0" size={12} aria-hidden="true" />
                  <span className="truncate">
                    {session.credentialAvailable ? `${session.credentialStore} · credential ready` : `${session.credentialStore} · credential 없음`}
                  </span>
                </span>
                <span className="mt-1 flex min-w-0 items-center gap-1 truncate text-xs font-semibold text-[rgba(60,60,67,0.58)]">
                  <Activity className="shrink-0" size={12} aria-hidden="true" />
                  <span className="truncate">
                    {formatCmSessionCheckStatus(session.lastCheckStatus)}
                    {session.lastCheckAt ? ` · ${new Date(session.lastCheckAt).toLocaleTimeString()}` : ''}
                  </span>
                </span>
              </button>
              <DesktopCmDiagnostics diagnostic={getDisplayedCmDiagnostic(session, runtimeProfile, activeRuntimeSessionId)} testId={`desktop-cm-session-diagnostics-${session.id}`} />
              {activeRuntimeSessionId === session.id && runtimeProfile ? (
                <div
                  className="grid gap-1 rounded-[8px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.07)] px-2.5 py-2 text-xs font-semibold text-[#0066cc]"
                  data-testid={`desktop-cm-session-runtime-detail-${session.id}`}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className={`ku-chip max-w-full ${runtimeProfile.healthStatus === 'healthy' ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]' : 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]'}`}>
                      <Activity size={12} aria-hidden="true" />
                      {formatRuntimeHealthStatus(runtimeProfile.healthStatus)}
                    </span>
                    <span className="truncate font-mono" title={runtimeProfile.serverUrl}>
                      {runtimeProfile.serverUrl}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[rgba(0,78,140,0.78)]">
                    remote {runtimeProfile.remoteApiHost}:{runtimeProfile.remoteApiPort}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-[rgba(0,78,140,0.74)]">
                    <span className="truncate">
                      {runtimeProfile.lastHealthAt ? `health ${new Date(runtimeProfile.lastHealthAt).toLocaleTimeString()}` : 'health 미확인'}
                    </span>
                    {runtimeProfile.lastHealthMessage ? <span className="truncate">{runtimeProfile.lastHealthMessage}</span> : null}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-2">
                <label className="min-w-0">
                  <span className="ku-meta">Private key path</span>
                  <input
                    className="ku-field mt-1 h-8 w-full font-mono text-xs"
                    data-testid={`desktop-cm-session-key-path-${session.id}`}
                    placeholder="~/.ssh/id_ed25519"
                    value={keyFilePaths[session.id] || ''}
                    onChange={(event) => {
                      setKeyFilePaths((current) => ({ ...current, [session.id]: event.target.value }));
                      setError('');
                    }}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="ku-control w-fit text-[11px]"
                    data-testid={`desktop-cm-session-import-key-${session.id}`}
                    type="button"
                    disabled={busyAction === `import-key:${session.id}`}
                    onClick={() => void handleImportPrivateKey(session.id)}
                  >
                    <KeyRound size={13} aria-hidden="true" />
                    credential 가져오기
                  </button>
                  <button
                    className="ku-control w-fit text-[11px]"
                    data-testid={`desktop-cm-session-check-${session.id}`}
                    type="button"
                    disabled={busyAction === `check:${session.id}`}
                    onClick={() => void handleCheckSession(session.id)}
                  >
                    <Activity size={13} aria-hidden="true" />
                    연결 확인
                  </button>
                  {activeRuntimeSessionId === session.id ? (
                    <>
                      <button
                        className="ku-control w-fit text-[11px]"
                        data-testid={`desktop-cm-session-check-runtime-${session.id}`}
                        type="button"
                        disabled={busyAction === 'check-runtime'}
                        onClick={() => void handleCheckRuntime()}
                      >
                        <Activity size={13} aria-hidden="true" />
                        health 재확인
                      </button>
                      <button
                        className="ku-control w-fit text-[11px]"
                        data-testid={`desktop-cm-session-stop-runtime-${session.id}`}
                        type="button"
                        disabled={busyAction === 'stop-runtime'}
                        onClick={() => void handleStopRuntime()}
                      >
                        <Square size={13} aria-hidden="true" />
                        runtime 중지
                      </button>
                    </>
                  ) : (
                    <button
                      className="ku-control w-fit text-[11px]"
                      data-testid={`desktop-cm-session-start-runtime-${session.id}`}
                      type="button"
                      disabled={!session.credentialAvailable || busyAction === `start-runtime:${session.id}`}
                      onClick={() => void handleStartRuntime(session.id)}
                    >
                      <Play size={13} aria-hidden="true" />
                      runtime 시작
                    </button>
                  )}
                  <button
                    className="ku-control w-fit text-[11px]"
                    data-testid={`desktop-cm-session-delete-credential-${session.id}`}
                    type="button"
                    disabled={!session.credentialAvailable || busyAction === `delete-credential:${session.id}`}
                    onClick={() => void handleCredentialDelete(session.id)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    {credentialDeleteConfirmId === session.id ? 'credential 삭제 확인' : 'credential 삭제'}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="ku-control w-fit text-[11px]"
                  data-testid={`desktop-cm-session-edit-${session.id}`}
                  type="button"
                  onClick={() => {
                    setForm({
                      id: session.id,
                      name: session.name,
                      host: session.host,
                      port: session.port,
                      user: session.user,
                      remoteApiHost: session.remoteApiHost,
                      remoteApiPort: session.remoteApiPort,
                      description: session.description || '',
                    });
                    setError('');
                  }}
                >
                  <Pencil size={13} aria-hidden="true" />
                  수정
                </button>
                <button
                  className="ku-control w-fit text-[11px]"
                  data-testid={`desktop-cm-session-delete-${session.id}`}
                  type="button"
                  disabled={busyAction === `delete:${session.id}` || busyAction === `select:${session.id}`}
                  onClick={() => void handleDelete(session.id)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  {deleteConfirmId === session.id ? '삭제 확인' : '삭제'}
                </button>
              </div>
            </div>
            ))}
          </div>
        ) : (
          <p className="rounded-[8px] border border-[rgba(60,60,67,0.1)] bg-white/70 px-3 py-2 text-xs font-semibold text-[rgba(60,60,67,0.58)]" data-testid="desktop-cm-session-search-empty">
            일치하는 CM/SSH session 없음
          </p>
        )
      ) : (
        <p className="text-xs font-semibold text-[rgba(60,60,67,0.58)]">
          CM/SSH 세션은 설치형 앱에서만 관리됩니다. private key는 Rust가 OS credential store에 저장하고 브라우저에는 safe metadata만 표시합니다.
        </p>
      )}
    </div>
  );
}

function DesktopCmDiagnostics({
  diagnostic,
  testId,
}: {
  diagnostic: Pick<DesktopCmSession, 'diagnosticStage' | 'diagnosticSeverity' | 'diagnosticMessage' | 'diagnosticHint' | 'lastCheckAt'> | Pick<DesktopCmSessionRuntimeProfile, 'diagnosticStage' | 'diagnosticSeverity' | 'diagnosticMessage' | 'diagnosticHint' | 'lastHealthAt'>;
  testId: string;
}) {
  const stage = diagnostic.diagnosticStage || 'metadata';
  const severity = diagnostic.diagnosticSeverity || 'info';
  const message = diagnostic.diagnosticMessage || 'not-checked';
  const hint = diagnostic.diagnosticHint || '연결 확인을 실행해 진단을 갱신하세요.';
  const timestamp = 'lastHealthAt' in diagnostic ? diagnostic.lastHealthAt : 'lastCheckAt' in diagnostic ? diagnostic.lastCheckAt : undefined;
  return (
    <div className="mt-2 grid gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.1)] bg-white/68 px-2.5 py-2" data-testid={testId}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="ku-meta">Diagnostics</span>
        <span className={`ku-chip ${cmDiagnosticSeverityClass(severity)}`} data-testid={`${testId}-severity`}>
          {formatCmDiagnosticSeverity(severity)}
        </span>
        <span className="ku-chip" data-testid={`${testId}-stage`}>
          {formatCmDiagnosticStage(stage)}
        </span>
        {timestamp ? <span className="ku-chip">{formatTimestamp(timestamp)}</span> : null}
      </div>
      <p className="break-words font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.64)]" data-testid={`${testId}-message`}>
        {message}
      </p>
      <p className="break-words text-xs font-semibold text-[rgba(60,60,67,0.68)]" data-testid={`${testId}-hint`}>
        {hint}
      </p>
    </div>
  );
}

function formatCmSessionError(error: string) {
  if (error.includes('remote_api_host')) {
    return 'API host 형식 오류';
  }
  if (error.includes('remote_api_port')) {
    return 'API port 1-65535';
  }
  if (error.includes('runtime_health')) {
    return 'API health 확인 실패';
  }
  if (error.includes('runtime_tunnel') || error.includes('process_start')) {
    return 'runtime 터널 실패';
  }
  if (error.includes('import')) {
    return 'import 파일 오류';
  }
  if (error.includes('host')) {
    return 'host 형식 오류';
  }
  if (error.includes('port')) {
    return 'port 1-65535';
  }
  if (error.includes('private_key_path')) {
    return 'key path 필요';
  }
  if (error.includes('private_key_file') || error.includes('private_key_marker') || error.includes('repo_path')) {
    return 'key 파일 오류';
  }
  if (error.includes('credential')) {
    return 'credential 오류';
  }
  if (error.includes('timeout')) {
    return '연결 시간 초과';
  }
  if (error.includes('unreachable')) {
    return '연결 불가';
  }
  if (error.includes('ssh-binary')) {
    return 'ssh 없음';
  }
  if (error.includes('user')) {
    return 'user 형식 오류';
  }
  if (error.includes('name')) {
    return 'name 필요';
  }
  if (error.includes('too_long')) {
    return '값이 너무 김';
  }
  if (error.includes('not_found')) {
    return '세션 없음';
  }
  return '세션 오류';
}

function formatCmSessionCheckStatus(status: string) {
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
    case 'credential-deleted':
      return 'credential 삭제됨';
    case 'credential-missing':
      return 'credential 없음';
    case 'not-checked':
      return '확인 안 됨';
    default:
      return status || '확인 안 됨';
  }
}

function formatRuntimeStatus(status: string) {
  switch (status) {
    case 'runtime-active':
      return 'runtime active';
    case 'runtime-unhealthy':
      return 'runtime health 실패';
    case 'runtime-lost':
      return 'runtime 끊김';
    case 'stopped':
      return 'runtime stopped';
    default:
      return status || 'runtime stopped';
  }
}

function formatRuntimeHealthStatus(status: string) {
  switch (status) {
    case 'healthy':
      return 'health 정상';
    case 'unhealthy':
      return 'health 실패';
    case 'unknown':
      return 'health 미확인';
    default:
      return status || 'health 미확인';
  }
}

function formatCmDiagnosticStage(stage: string) {
  switch (stage) {
    case 'credential':
      return 'credential';
    case 'reachability':
      return 'reachability';
    case 'ssh-auth':
      return 'ssh auth';
    case 'tunnel':
      return 'tunnel';
    case 'health':
      return 'health';
    case 'runtime':
      return 'runtime';
    case 'metadata':
      return 'metadata';
    default:
      return stage || 'metadata';
  }
}

function formatCmDiagnosticSeverity(severity: string) {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return severity || 'info';
  }
}

function cmDiagnosticSeverityClass(severity: string) {
  if (severity === 'error') {
    return 'border-[rgba(255,59,48,0.24)] bg-[rgba(255,59,48,0.1)] text-[#b42318]';
  }
  if (severity === 'warning') {
    return 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#8a4d00]';
  }
  return 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]';
}

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function readDesktopCmDiagnosticFilterPresets(): DesktopCmDiagnosticFilterPreset[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const rawValue = window.localStorage.getItem(desktopCmDiagnosticFilterPresetStorageKey);
    if (!rawValue) {
      return [];
    }
    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      window.localStorage.removeItem(desktopCmDiagnosticFilterPresetStorageKey);
      return [];
    }
    return normalizeDesktopCmDiagnosticFilterPresets(parsedValue);
  } catch {
    window.localStorage.removeItem(desktopCmDiagnosticFilterPresetStorageKey);
    return [];
  }
}

function writeDesktopCmDiagnosticFilterPresets(presets: DesktopCmDiagnosticFilterPreset[]) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(desktopCmDiagnosticFilterPresetStorageKey, JSON.stringify(normalizeDesktopCmDiagnosticFilterPresets(presets)));
  } catch {
    // Saved diagnostic filters are only a UI preference; storage failures should not break sessions.
  }
}

function normalizeDesktopCmDiagnosticFilterPresets(value: unknown[]): DesktopCmDiagnosticFilterPreset[] {
  const seenNames = new Set<string>();
  const presets: DesktopCmDiagnosticFilterPreset[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const candidate = item as Partial<DesktopCmDiagnosticFilterPreset>;
    const name = normalizeDesktopCmDiagnosticFilterPresetName(candidate.name || '');
    const nameKey = name.toLowerCase();
    const diagnosticStage = normalizeCmDiagnosticStageFilter(candidate.diagnosticStage);
    const diagnosticSeverity = normalizeCmDiagnosticSeverityFilter(candidate.diagnosticSeverity);
    if (!name || seenNames.has(nameKey)) {
      continue;
    }
    seenNames.add(nameKey);
    presets.push({
      name,
      diagnosticStage,
      diagnosticSeverity,
      updatedAt: typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
    });
    if (presets.length >= maxDesktopCmDiagnosticFilterPresets) {
      break;
    }
  }
  return presets;
}

function normalizeDesktopCmDiagnosticFilterPresetName(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, maxDesktopCmDiagnosticFilterPresetNameLength);
  return normalized || 'all stages · all severities';
}

function normalizeCmDiagnosticStageFilter(value: unknown): CmDiagnosticStageFilter {
  return typeof value === 'string' && cmDiagnosticStageFilterOptions.includes(value as CmDiagnosticStageFilter) ? (value as CmDiagnosticStageFilter) : 'all';
}

function normalizeCmDiagnosticSeverityFilter(value: unknown): CmDiagnosticSeverityFilter {
  return typeof value === 'string' && cmDiagnosticSeverityFilterOptions.includes(value as CmDiagnosticSeverityFilter) ? (value as CmDiagnosticSeverityFilter) : 'all';
}

function slugifyTestId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
}

function getDisplayedCmDiagnostic(session: DesktopCmSession, runtimeProfile: DesktopCmSessionRuntimeProfile | null, activeRuntimeSessionId: string) {
  return activeRuntimeSessionId === session.id && runtimeProfile ? runtimeProfile : session;
}

function matchesCmDiagnosticFilters(
  diagnostic: Pick<DesktopCmSession, 'diagnosticStage' | 'diagnosticSeverity'> | Pick<DesktopCmSessionRuntimeProfile, 'diagnosticStage' | 'diagnosticSeverity'>,
  stageFilter: CmDiagnosticStageFilter,
  severityFilter: CmDiagnosticSeverityFilter,
) {
  const stage = diagnostic.diagnosticStage || 'metadata';
  const severity = diagnostic.diagnosticSeverity || 'info';
  return (stageFilter === 'all' || stage === stageFilter) && (severityFilter === 'all' || severity === severityFilter);
}

function matchesCmSessionSearch(
  session: DesktopCmSession,
  normalizedQuery: string,
  diagnostic: Pick<DesktopCmSession, 'diagnosticStage' | 'diagnosticSeverity' | 'diagnosticMessage' | 'diagnosticHint'> | Pick<DesktopCmSessionRuntimeProfile, 'diagnosticStage' | 'diagnosticSeverity' | 'diagnosticMessage' | 'diagnosticHint'>,
) {
  if (!normalizedQuery) {
    return true;
  }

  const searchText = [
    session.name,
    session.host,
    session.port,
    session.user,
    session.remoteApiHost,
    session.remoteApiPort,
    session.status,
    session.runtimeStatus,
    session.description || '',
    session.credentialAvailable ? 'credential ready' : 'credential missing',
    formatCmSessionCheckStatus(session.lastCheckStatus),
    formatRuntimeStatus(session.runtimeStatus),
    diagnostic.diagnosticStage || '',
    diagnostic.diagnosticSeverity || '',
    diagnostic.diagnosticMessage || '',
    diagnostic.diagnosticHint || '',
  ]
    .join(' ')
    .toLowerCase();

  return searchText.includes(normalizedQuery);
}

function cmRuntimeStatusClass(status: string) {
  if (status === 'runtime-active') {
    return 'border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]';
  }
  if (status === 'runtime-unhealthy' || status === 'runtime-lost') {
    return 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]';
  }
  return 'border-[rgba(142,142,147,0.2)] bg-[rgba(142,142,147,0.1)] text-[#636366]';
}

function formatTimestamp(timestamp?: number) {
  if (!timestamp) {
    return '';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString();
}
