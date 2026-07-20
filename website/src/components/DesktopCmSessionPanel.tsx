import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, CheckCircle2, Download, Filter, KeyRound, Play, Search, ServerCog, ShieldCheck, Unplug, Upload, XCircle } from 'lucide-react';
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
import {
  buildDesktopCmSessionGroups,
  cmDiagnosticSeverityFilterOptions,
  cmDiagnosticStageFilterOptions,
  defaultDesktopCmSessionGroup,
  desktopCmSessionViewPreferencesEqual,
  getDesktopCmSessionPreference,
  getDisplayedCmDiagnostic,
  matchesCmDiagnosticFilters,
  matchesCmSessionSearch,
  normalizeDesktopCmSessionGroupName,
  pruneDesktopCmSessionViewPreferences,
  readDesktopCmSessionViewPreferences,
  setDesktopCmSessionFavoritePreferences,
  setDesktopCmSessionGroupPreference,
  setDesktopCmSessionGroupPreferences,
  toggleDesktopCmSessionFavoritePreference,
  toggleDesktopCmSessionGroupCollapsed,
  writeDesktopCmSessionViewPreferences,
  type CmDiagnosticSeverityFilter,
  type CmDiagnosticStageFilter,
  type DesktopCmSessionViewPreferences,
} from '../features/desktop/desktopCmSessionView';
import {
  maxDesktopCmDiagnosticFilterPresetNameLength,
  maxDesktopCmDiagnosticFilterPresets,
  normalizeDesktopCmDiagnosticFilterPresetName,
  readDesktopCmDiagnosticFilterPresets,
  writeDesktopCmDiagnosticFilterPresets,
  type DesktopCmDiagnosticFilterPreset,
} from '../features/desktop/desktopCmDiagnosticFilterPresets';
import { slugifyDesktopCmTestId } from '../features/desktop/desktopCmReorder';
import { setsEqual } from '../features/desktop/desktopCmSessionLayouts';
import { DesktopCmConnectionProfileForm } from './desktopCm/DesktopCmConnectionProfileForm';
import {
  buildDesktopCmSessionCloneName,
  formatCmSessionError,
  formatCmDiagnosticSeverity,
  formatCmDiagnosticStage,
  normalizeSearchValue,
  validateDesktopCmSessionForm,
} from '../features/desktop/desktopCmSessionPresentation';
import { DesktopCmSessionSummary } from './desktopCm/DesktopCmSessionSummary';
import { DesktopCmSessionBulkToolbar, DesktopCmSessionList } from './desktopCm/DesktopCmSessionList';
import { DesktopCmSavedLayoutsPanel } from './desktopCm/DesktopCmSavedLayoutsPanel';
import { useDesktopCmSessionLayouts } from '../features/desktop/useDesktopCmSessionLayouts';

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
  const [sessionViewPreferences, setSessionViewPreferences] = useState<DesktopCmSessionViewPreferences>(() => readDesktopCmSessionViewPreferences());
  const [selectedBulkSessionIds, setSelectedBulkSessionIds] = useState<Set<string>>(() => new Set());
  const [bulkGroupName, setBulkGroupName] = useState(defaultDesktopCmSessionGroup);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [importSummary, setImportSummary] = useState<DesktopCmSessionImportSummary | null>(null);
  const [cloneDraftSourceName, setCloneDraftSourceName] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedSessionSearchQuery = normalizeSearchValue(sessionSearchQuery);
  const sessionPreferenceMap = useMemo(() => new Map(sessionViewPreferences.sessions.map((preference) => [preference.sessionId, preference])), [sessionViewPreferences.sessions]);
  const visibleSessions = useMemo(
    () =>
      sessions.filter((session) => {
        const diagnostic = getDisplayedCmDiagnostic(session, runtimeProfile, activeRuntimeSessionId);
        const preference = getDesktopCmSessionPreference(session.id, sessionPreferenceMap);
        return (
          matchesCmSessionSearch(session, normalizedSessionSearchQuery, diagnostic, preference) &&
          matchesCmDiagnosticFilters(diagnostic, diagnosticStageFilter, diagnosticSeverityFilter)
        );
      }),
    [activeRuntimeSessionId, diagnosticSeverityFilter, diagnosticStageFilter, normalizedSessionSearchQuery, runtimeProfile, sessionPreferenceMap, sessions],
  );
  const groupedSessions = useMemo(
    () => buildDesktopCmSessionGroups(sessions, visibleSessions, sessionPreferenceMap, sessionViewPreferences.collapsedGroups),
    [sessionPreferenceMap, sessionViewPreferences.collapsedGroups, sessions, visibleSessions],
  );
  const selectedBulkSessions = useMemo(() => sessions.filter((session) => selectedBulkSessionIds.has(session.id)), [selectedBulkSessionIds, sessions]);
  const selectedVisibleBulkCount = useMemo(() => visibleSessions.filter((session) => selectedBulkSessionIds.has(session.id)).length, [selectedBulkSessionIds, visibleSessions]);
  const visibleSessionIds = useMemo(() => visibleSessions.map((session) => session.id), [visibleSessions]);
  const diagnosticFiltersActive = diagnosticStageFilter !== 'all' || diagnosticSeverityFilter !== 'all';
  const activeDiagnosticFilterPresetName = useMemo(
    () => diagnosticFilterPresets.find((preset) => preset.diagnosticStage === diagnosticStageFilter && preset.diagnosticSeverity === diagnosticSeverityFilter)?.name || '',
    [diagnosticFilterPresets, diagnosticSeverityFilter, diagnosticStageFilter],
  );
  const connectionPreview = `${form.user || 'user'}@${form.host || 'host'}:${form.port || 22} -> ${form.remoteApiHost || desktopCmDefaultRemoteApiHost}:${form.remoteApiPort || desktopCmDefaultRemoteApiPort}`;
  const selectedRuntimeActive = Boolean(selectedSession && runtimeProfile?.sessionId === selectedSession.id);
  const selectedRuntimeStatus = selectedRuntimeActive ? runtimeProfile?.status || selectedSession?.runtimeStatus || 'runtime-active' : selectedSession?.runtimeStatus || 'stopped';
  const sessionLayouts = useDesktopCmSessionLayouts({
    sessions,
    sessionViewPreferences,
    busyAction,
    setBusyAction,
    setError,
    onApplyViewPreferences: (nextPreferences) => {
      setSessionViewPreferences(nextPreferences);
      writeDesktopCmSessionViewPreferences(nextPreferences);
      setBulkDeleteConfirm(false);
      setSelectedBulkSessionIds(new Set());
    },
  });


  useEffect(() => {
    if (form.id && !sessions.some((session) => session.id === form.id)) {
      setForm(emptyForm);
      setCloneDraftSourceName('');
    }
  }, [form.id, sessions]);


  useEffect(() => {
    if (sessions.length === 0) {
      return;
    }
    setSessionViewPreferences((current) => {
      const nextPreferences = pruneDesktopCmSessionViewPreferences(current, sessions);
      if (desktopCmSessionViewPreferencesEqual(current, nextPreferences)) {
        return current;
      }
      writeDesktopCmSessionViewPreferences(nextPreferences);
      return nextPreferences;
    });
  }, [sessions]);

  useEffect(() => {
    const validSessionIds = new Set(sessions.map((session) => session.id));
    setSelectedBulkSessionIds((current) => {
      const nextSelection = new Set([...current].filter((sessionId) => validSessionIds.has(sessionId)));
      return setsEqual(current, nextSelection) ? current : nextSelection;
    });
  }, [sessions]);

  useEffect(() => {
    if (selectedBulkSessionIds.size === 0 && bulkDeleteConfirm) {
      setBulkDeleteConfirm(false);
    }
  }, [bulkDeleteConfirm, selectedBulkSessionIds.size]);


  const handleSave = async () => {
    setError('');
    const validationError = validateDesktopCmSessionForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusyAction('save');
    try {
      await onSaveSession(form);
      setForm(emptyForm);
      setCloneDraftSourceName('');
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_session_save_failed'));
    } finally {
      setBusyAction('');
    }
  };

  const applyRemoteApiEndpoint = (host: string, port: number) => {
    setForm((current) => ({ ...current, remoteApiHost: host, remoteApiPort: port }));
    setError('');
  };

  const fillSelectedSession = () => {
    if (!selectedSession) {
      return;
    }
    setForm({
      id: selectedSession.id,
      name: selectedSession.name,
      host: selectedSession.host,
      port: selectedSession.port,
      user: selectedSession.user,
      remoteApiHost: selectedSession.remoteApiHost,
      remoteApiPort: selectedSession.remoteApiPort,
      description: selectedSession.description || '',
    });
    setCloneDraftSourceName('');
    setError('');
  };

  const handleEditSession = (session: DesktopCmSession) => {
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
    setCloneDraftSourceName('');
    setError('');
  };

  const handleKeyFilePathChange = (sessionId: string, value: string) => {
    setKeyFilePaths((current) => ({ ...current, [sessionId]: value }));
    setError('');
  };

  const handleCloneSession = (session: DesktopCmSession) => {
    setForm({
      name: buildDesktopCmSessionCloneName(session.name, sessions),
      host: session.host,
      port: session.port,
      user: session.user,
      remoteApiHost: session.remoteApiHost,
      remoteApiPort: session.remoteApiPort,
      description: session.description || '',
    });
    setCloneDraftSourceName(session.name);
    setDeleteConfirmId('');
    setCredentialDeleteConfirmId('');
    setError('');
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
        setCloneDraftSourceName('');
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

  const handleExportSelectedSessions = () => {
    setError('');
    const bundle = createDesktopCmSessionExportBundle(selectedBulkSessions);
    const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kuviewer-desktop-cm-sessions-selected-${new Date(bundle.exportedAt).toISOString().slice(0, 10)}.json`;
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


  const handleSetSessionGroup = (sessionId: string, group: string) => {
    setSessionViewPreferences((current) => {
      const nextPreferences = setDesktopCmSessionGroupPreference(current, sessionId, group);
      writeDesktopCmSessionViewPreferences(nextPreferences);
      return nextPreferences;
    });
  };

  const handleToggleSessionFavorite = (sessionId: string) => {
    setSessionViewPreferences((current) => {
      const nextPreferences = toggleDesktopCmSessionFavoritePreference(current, sessionId);
      writeDesktopCmSessionViewPreferences(nextPreferences);
      return nextPreferences;
    });
  };

  const handleToggleGroupCollapsed = (group: string) => {
    setSessionViewPreferences((current) => {
      const nextPreferences = toggleDesktopCmSessionGroupCollapsed(current, group);
      writeDesktopCmSessionViewPreferences(nextPreferences);
      return nextPreferences;
    });
  };

  const handleToggleBulkSession = (sessionId: string, checked: boolean) => {
    setBulkDeleteConfirm(false);
    setSelectedBulkSessionIds((current) => {
      const nextSelection = new Set(current);
      if (checked) {
        nextSelection.add(sessionId);
      } else {
        nextSelection.delete(sessionId);
      }
      return nextSelection;
    });
  };

  const handleToggleBulkGroup = (sessionIds: string[], checked: boolean) => {
    setBulkDeleteConfirm(false);
    setSelectedBulkSessionIds((current) => {
      const nextSelection = new Set(current);
      for (const sessionId of sessionIds) {
        if (checked) {
          nextSelection.add(sessionId);
        } else {
          nextSelection.delete(sessionId);
        }
      }
      return nextSelection;
    });
  };

  const handleSelectVisibleSessions = () => {
    setBulkDeleteConfirm(false);
    setSelectedBulkSessionIds((current) => new Set([...current, ...visibleSessionIds]));
  };

  const handleClearBulkSelection = () => {
    setBulkDeleteConfirm(false);
    setSelectedBulkSessionIds(new Set());
  };

  const handleMoveSelectedSessionsToGroup = () => {
    const sessionIds = [...selectedBulkSessionIds];
    if (sessionIds.length === 0) {
      return;
    }
    setBulkDeleteConfirm(false);
    const normalizedGroup = normalizeDesktopCmSessionGroupName(bulkGroupName);
    setBulkGroupName(normalizedGroup);
    setSessionViewPreferences((current) => {
      const nextPreferences = setDesktopCmSessionGroupPreferences(current, sessionIds, normalizedGroup);
      writeDesktopCmSessionViewPreferences(nextPreferences);
      return nextPreferences;
    });
  };

  const handleSetSelectedFavorite = (favorite: boolean) => {
    const sessionIds = [...selectedBulkSessionIds];
    if (sessionIds.length === 0) {
      return;
    }
    setBulkDeleteConfirm(false);
    setSessionViewPreferences((current) => {
      const nextPreferences = setDesktopCmSessionFavoritePreferences(current, sessionIds, favorite);
      writeDesktopCmSessionViewPreferences(nextPreferences);
      return nextPreferences;
    });
  };

  const handleDeleteSelectedSessions = async () => {
    const sessionIds = [...selectedBulkSessionIds];
    if (sessionIds.length === 0) {
      return;
    }
    if (!bulkDeleteConfirm) {
      setBulkDeleteConfirm(true);
      return;
    }

    setError('');
    setBusyAction('bulk-delete-sessions');
    try {
      for (const sessionId of sessionIds) {
        await onDeleteSession(sessionId);
      }
      if (form.id && selectedBulkSessionIds.has(form.id)) {
        setForm(emptyForm);
        setCloneDraftSourceName('');
      }
      setSelectedBulkSessionIds(new Set());
      setBulkDeleteConfirm(false);
      setDeleteConfirmId('');
      setCredentialDeleteConfirmId('');
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_session_bulk_delete_failed'));
    } finally {
      setBusyAction('');
    }
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
        {sessionLayouts.importSummary ? (
          <span className="ku-chip max-w-full" data-testid="desktop-cm-session-layout-import-summary">
            layout import {sessionLayouts.importSummary.fileName} · new {sessionLayouts.importSummary.imported} · updated {sessionLayouts.importSummary.updated} · skipped{' '}
            {sessionLayouts.importSummary.skipped} · invalid {sessionLayouts.importSummary.invalid}
          </span>
        ) : null}
      </div>

      <DesktopCmConnectionProfileForm
        busy={busyAction === 'save'}
        cloneDraftSourceName={cloneDraftSourceName}
        connectionPreview={connectionPreview}
        form={form}
        hasSelectedSession={Boolean(selectedSession)}
        onApplyRemoteApiEndpoint={applyRemoteApiEndpoint}
        onCancel={() => {
          setForm(emptyForm);
          setCloneDraftSourceName('');
        }}
        onChange={(patch) => {
          setForm((current) => ({ ...current, ...patch }));
          setError('');
        }}
        onFillSelected={fillSelectedSession}
        onSave={() => void handleSave()}
      />

      <DesktopCmSessionSummary
        runtimeActive={selectedRuntimeActive}
        runtimeProfile={runtimeProfile}
        runtimeStatus={selectedRuntimeStatus}
        selectedSession={selectedSession}
      />

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
            <button
              className="ku-control h-9"
              data-testid="desktop-cm-session-bulk-select-visible"
              type="button"
              disabled={visibleSessions.length === 0}
              onClick={handleSelectVisibleSessions}
            >
              현재 결과 선택
            </button>
            <button
              className="ku-control h-9"
              data-testid="desktop-cm-session-bulk-clear"
              type="button"
              disabled={selectedBulkSessionIds.size === 0}
              onClick={handleClearBulkSelection}
            >
              선택 해제
            </button>
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
                      data-testid={`desktop-cm-diagnostic-filter-preset-${slugifyDesktopCmTestId(preset.name)}`}
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
                        data-testid={`desktop-cm-diagnostic-filter-preset-delete-${slugifyDesktopCmTestId(preset.name)}`}
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

          <DesktopCmSavedLayoutsPanel {...sessionLayouts.panelProps} />

          <DesktopCmSessionBulkToolbar
            selectedCount={selectedBulkSessionIds.size}
            selectedVisibleCount={selectedVisibleBulkCount}
            bulkGroupName={bulkGroupName}
            bulkDeleteConfirm={bulkDeleteConfirm}
            busyAction={busyAction}
            onExport={handleExportSelectedSessions}
            onSetFavorite={handleSetSelectedFavorite}
            onDelete={handleDeleteSelectedSessions}
            onClear={handleClearBulkSelection}
            onBulkGroupNameChange={setBulkGroupName}
            onMoveToGroup={handleMoveSelectedSessionsToGroup}
          />
        </div>
      ) : null}

      <DesktopCmSessionList
        sessions={sessions}
        visibleSessionCount={visibleSessions.length}
        groups={groupedSessions}
        preferences={sessionPreferenceMap}
        selectedSessionIds={selectedBulkSessionIds}
        runtimeProfile={runtimeProfile}
        activeRuntimeSessionId={activeRuntimeSessionId}
        keyFilePaths={keyFilePaths}
        busyAction={busyAction}
        deleteConfirmId={deleteConfirmId}
        credentialDeleteConfirmId={credentialDeleteConfirmId}
        actions={{
          onToggleGroupSelection: handleToggleBulkGroup,
          onToggleGroupCollapsed: handleToggleGroupCollapsed,
          onToggleSessionSelection: handleToggleBulkSession,
          onToggleFavorite: handleToggleSessionFavorite,
          onSetGroup: handleSetSessionGroup,
          onSelect: handleSelect,
          onKeyFilePathChange: handleKeyFilePathChange,
          onImportPrivateKey: handleImportPrivateKey,
          onCheckSession: handleCheckSession,
          onCheckRuntime: handleCheckRuntime,
          onStopRuntime: handleStopRuntime,
          onStartRuntime: handleStartRuntime,
          onDeleteCredential: handleCredentialDelete,
          onEdit: handleEditSession,
          onClone: handleCloneSession,
          onDelete: handleDelete,
        }}
      />
    </div>
  );
}
