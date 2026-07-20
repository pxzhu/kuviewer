import { type DragEvent as ReactDragEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, CheckCircle2, Download, Filter, Folder, KeyRound, Play, Search, ServerCog, ShieldCheck, Trash2, Unplug, Upload, XCircle } from 'lucide-react';
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
  normalizeDesktopCmSessionViewPreferences,
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
import { isDesktopCmKeyboardIgnoredTarget, slugifyDesktopCmTestId } from '../features/desktop/desktopCmReorder';
import {
  buildDesktopCmSessionLayoutDuplicateName,
  buildDesktopCmSessionLayoutFolderFilterOptions,
  buildDesktopCmSessionLayoutFolders,
  buildDesktopCmSessionLayoutImportName,
  defaultDesktopCmSessionLayoutFolder,
  desktopCmSessionLayoutEqual,
  desktopCmSessionLayoutFolderOrder,
  downloadDesktopCmSessionLayoutBundle,
  matchesDesktopCmSessionLayoutFolderFilter,
  matchesDesktopCmSessionLayoutSearch,
  maxDesktopCmSessionLayoutFolderNameLength,
  maxDesktopCmSessionLayoutPresetNameLength,
  maxDesktopCmSessionLayoutPresets,
  moveDesktopCmSessionLayoutFolderBefore,
  moveDesktopCmSessionLayoutFolderToIndex,
  moveDesktopCmSessionLayoutPresetBefore,
  moveDesktopCmSessionLayoutPresetToIndex,
  normalizeDesktopCmSessionLayoutFolderName,
  normalizeDesktopCmSessionLayoutPresetName,
  normalizeDesktopCmSessionLayoutPresets,
  parseDesktopCmSessionLayoutImportBundle,
  readDesktopCmSessionLayoutCollapsedFolders,
  readDesktopCmSessionLayoutPresets,
  setsEqual,
  writeDesktopCmSessionLayoutCollapsedFolders,
  writeDesktopCmSessionLayoutPresets,
  type DesktopCmSessionLayoutPreset,
} from '../features/desktop/desktopCmSessionLayouts';
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
import {
  DesktopCmLayoutConflictPanel,
  type DesktopCmSessionLayoutImportConflict,
  type DesktopCmSessionLayoutImportConflictPreview,
  type DesktopCmSessionLayoutConflictResolution,
} from './desktopCm/DesktopCmLayoutConflictPanel';
import {
  DesktopCmLayoutList,
  desktopCmSessionLayoutReorderDisabledReasonId,
} from './desktopCm/DesktopCmLayoutList';

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

interface DesktopCmSessionLayoutImportSummary {
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
  const [sessionLayoutPresetName, setSessionLayoutPresetName] = useState('');
  const [sessionLayoutPresetFolder, setSessionLayoutPresetFolder] = useState(defaultDesktopCmSessionLayoutFolder);
  const [sessionLayoutSearchQuery, setSessionLayoutSearchQuery] = useState('');
  const [sessionLayoutFolderFilter, setSessionLayoutFolderFilter] = useState('all');
  const [sessionLayoutRenameTargetName, setSessionLayoutRenameTargetName] = useState('');
  const [sessionLayoutRenameDraftName, setSessionLayoutRenameDraftName] = useState('');
  const [sessionLayoutRenameError, setSessionLayoutRenameError] = useState('');
  const [sessionLayoutFolderRenameTarget, setSessionLayoutFolderRenameTarget] = useState('');
  const [sessionLayoutFolderRenameDraft, setSessionLayoutFolderRenameDraft] = useState('');
  const [activeSessionLayoutFolderName, setActiveSessionLayoutFolderName] = useState('');
  const [draggingSessionLayoutFolderName, setDraggingSessionLayoutFolderName] = useState('');
  const [draggingSessionLayoutPresetName, setDraggingSessionLayoutPresetName] = useState('');
  const [sessionLayoutReorderKeyboardMessage, setSessionLayoutReorderKeyboardMessage] = useState('');
  const [sessionLayoutReorderFocusTargetTestId, setSessionLayoutReorderFocusTargetTestId] = useState('');
  const [sessionLayoutReorderFocusTargetLabel, setSessionLayoutReorderFocusTargetLabel] = useState('');
  const [sessionLayoutReorderFocusMessage, setSessionLayoutReorderFocusMessage] = useState('');
  const [sessionLayoutPresets, setSessionLayoutPresets] = useState<DesktopCmSessionLayoutPreset[]>(() => readDesktopCmSessionLayoutPresets());
  const [collapsedSessionLayoutFolders, setCollapsedSessionLayoutFolders] = useState<Set<string>>(() => readDesktopCmSessionLayoutCollapsedFolders());
  const [selectedSessionLayoutPresetNames, setSelectedSessionLayoutPresetNames] = useState<Set<string>>(() => new Set());
  const [sessionLayoutBulkDeleteConfirm, setSessionLayoutBulkDeleteConfirm] = useState(false);
  const [sessionLayoutBulkFolderName, setSessionLayoutBulkFolderName] = useState(defaultDesktopCmSessionLayoutFolder);
  const [selectedBulkSessionIds, setSelectedBulkSessionIds] = useState<Set<string>>(() => new Set());
  const [bulkGroupName, setBulkGroupName] = useState(defaultDesktopCmSessionGroup);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [importSummary, setImportSummary] = useState<DesktopCmSessionImportSummary | null>(null);
  const [sessionLayoutImportSummary, setSessionLayoutImportSummary] = useState<DesktopCmSessionLayoutImportSummary | null>(null);
  const [sessionLayoutImportConflicts, setSessionLayoutImportConflicts] = useState<DesktopCmSessionLayoutImportConflictPreview | null>(null);
  const [cloneDraftSourceName, setCloneDraftSourceName] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const sessionLayoutImportInputRef = useRef<HTMLInputElement | null>(null);
  const sessionLayoutFolderListRef = useRef<HTMLDivElement | null>(null);
  const normalizedSessionSearchQuery = normalizeSearchValue(sessionSearchQuery);
  const normalizedSessionLayoutSearchQuery = normalizeSearchValue(sessionLayoutSearchQuery);
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
  const activeSessionLayoutPresetName = useMemo(() => {
    const currentLayout = pruneDesktopCmSessionViewPreferences(sessionViewPreferences, sessions);
    return sessionLayoutPresets.find((preset) => desktopCmSessionLayoutEqual(currentLayout, pruneDesktopCmSessionViewPreferences(preset.viewPreferences, sessions)))?.name || '';
  }, [sessionLayoutPresets, sessionViewPreferences, sessions]);
  const sessionLayoutFolderFilterOptions = useMemo(() => buildDesktopCmSessionLayoutFolderFilterOptions(sessionLayoutPresets), [sessionLayoutPresets]);
  const sessionLayoutSearchActive = normalizedSessionLayoutSearchQuery.length > 0;
  const sessionLayoutFolderFilterActive = sessionLayoutFolderFilter !== 'all';
  const visibleSessionLayoutPresets = useMemo(
    () =>
      sessionLayoutPresets.filter(
        (preset) =>
          matchesDesktopCmSessionLayoutSearch(preset, normalizedSessionLayoutSearchQuery) &&
          matchesDesktopCmSessionLayoutFolderFilter(preset, sessionLayoutFolderFilter),
      ),
    [normalizedSessionLayoutSearchQuery, sessionLayoutFolderFilter, sessionLayoutPresets],
  );
  const groupedSessionLayoutPresets = useMemo(
    () =>
      buildDesktopCmSessionLayoutFolders(sessionLayoutPresets, visibleSessionLayoutPresets, collapsedSessionLayoutFolders, {
        includeFolders: sessionLayoutFolderFilterActive ? [sessionLayoutFolderFilter] : [],
      }),
    [collapsedSessionLayoutFolders, sessionLayoutFolderFilter, sessionLayoutFolderFilterActive, sessionLayoutPresets, visibleSessionLayoutPresets],
  );
  const sessionLayoutFolderNames = useMemo(() => groupedSessionLayoutPresets.map((folder) => folder.folder), [groupedSessionLayoutPresets]);
  const selectedSessionLayoutPresets = useMemo(
    () => sessionLayoutPresets.filter((preset) => selectedSessionLayoutPresetNames.has(preset.name)),
    [selectedSessionLayoutPresetNames, sessionLayoutPresets],
  );
  const selectedVisibleSessionLayoutPresetCount = useMemo(
    () => visibleSessionLayoutPresets.filter((preset) => selectedSessionLayoutPresetNames.has(preset.name)).length,
    [selectedSessionLayoutPresetNames, visibleSessionLayoutPresets],
  );
  const sessionLayoutFilteredEmpty = sessionLayoutPresets.length > 0 && visibleSessionLayoutPresets.length === 0;
  const sessionLayoutFilteredEmptyLabel =
    sessionLayoutSearchActive && sessionLayoutFolderFilterActive
      ? `${sessionLayoutFolderFilter} folder에서 "${sessionLayoutSearchQuery.trim()}"와 일치하는 saved layout 없음`
      : sessionLayoutFolderFilterActive
        ? `${sessionLayoutFolderFilter} folder에 표시할 saved layout 없음`
        : `"${sessionLayoutSearchQuery.trim()}"와 일치하는 saved layout 없음`;
  const sessionLayoutReorderBlocked = sessionLayoutSearchActive || sessionLayoutFolderFilterActive;
  const canReorderSessionLayoutFolders = sessionLayoutFolderNames.length > 1 && !sessionLayoutReorderBlocked;
  const canReorderSessionLayoutPresets = visibleSessionLayoutPresets.length > 1 && !sessionLayoutReorderBlocked;
  const sessionLayoutReorderFilterDisabledReason =
    sessionLayoutSearchActive && sessionLayoutFolderFilterActive
      ? 'Reorder unavailable: layout search and folder filter are active. Clear both filters to reorder.'
      : sessionLayoutSearchActive
        ? 'Reorder unavailable: layout search is active. Clear layout search to reorder.'
        : sessionLayoutFolderFilterActive
          ? 'Reorder unavailable: folder filter is active. Clear folder filter to reorder.'
          : '';
  const sessionLayoutReorderUnavailableReason =
    sessionLayoutReorderFilterDisabledReason ||
    (sessionLayoutFolderNames.length <= 1 && visibleSessionLayoutPresets.length <= 1
      ? 'Reorder unavailable: at least two layout folders or two presets in the same folder are required.'
      : sessionLayoutFolderNames.length <= 1
        ? 'Reorder unavailable: at least two layout folders are required.'
        : visibleSessionLayoutPresets.length <= 1
          ? 'Reorder unavailable: at least two visible layout presets are required.'
          : '');
  const sessionLayoutReorderStateLabel =
    sessionLayoutReorderUnavailableReason || 'Reorder ready: folder and preset controls are available.';
  const sessionLayoutReorderKeyboardLiveText =
    sessionLayoutReorderKeyboardMessage ||
    (sessionLayoutReorderBlocked
      ? sessionLayoutReorderUnavailableReason
      : 'Reorder ready: keyboard shortcuts can move folders and presets.');
  const sessionLayoutReorderFocusLiveText = sessionLayoutReorderFocusMessage || 'Focus restoration ready: focus returns to the moved control after reorder.';
  const activeSessionLayoutFolder = groupedSessionLayoutPresets.find((folder) => folder.folder === activeSessionLayoutFolderName);
  const activeSessionLayoutFolderIndex = sessionLayoutFolderNames.findIndex((folderName) => folderName === activeSessionLayoutFolderName);
  const sessionLayoutFolderKeyboardLiveText = activeSessionLayoutFolder
    ? `Layout folder ${activeSessionLayoutFolder.folder} active, ${activeSessionLayoutFolder.presets.length} visible presets, ${activeSessionLayoutFolder.totalCount} total presets, ${activeSessionLayoutFolder.collapsed ? 'collapsed' : 'expanded'}, ${activeSessionLayoutFolderIndex + 1} of ${sessionLayoutFolderNames.length}.`
    : `${sessionLayoutFolderNames.length} layout folders available.`;
  const connectionPreview = `${form.user || 'user'}@${form.host || 'host'}:${form.port || 22} -> ${form.remoteApiHost || desktopCmDefaultRemoteApiHost}:${form.remoteApiPort || desktopCmDefaultRemoteApiPort}`;
  const selectedRuntimeActive = Boolean(selectedSession && runtimeProfile?.sessionId === selectedSession.id);
  const selectedRuntimeStatus = selectedRuntimeActive ? runtimeProfile?.status || selectedSession?.runtimeStatus || 'runtime-active' : selectedSession?.runtimeStatus || 'stopped';

  const announceSessionLayoutReorderStatus = (messageText: string) => {
    setSessionLayoutReorderKeyboardMessage(messageText);
  };

  useEffect(() => {
    if (form.id && !sessions.some((session) => session.id === form.id)) {
      setForm(emptyForm);
      setCloneDraftSourceName('');
    }
  }, [form.id, sessions]);

  useEffect(() => {
    if (!sessionLayoutReorderFocusTargetTestId) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      const target =
        sessionLayoutReorderFocusTargetTestId === 'desktop-cm-session-layout-list'
          ? sessionLayoutFolderListRef.current
          : [...document.querySelectorAll<HTMLElement>('[data-testid]')].find(
              (element) => element.dataset.testid === sessionLayoutReorderFocusTargetTestId,
            ) || null;
      const focusStatusMessage = target
        ? `Focus restored: ${sessionLayoutReorderFocusTargetLabel || 'moved layout reorder control'}.`
        : `Focus target unavailable after reorder: ${sessionLayoutReorderFocusTargetLabel || 'moved layout reorder control'}.`;
      if (target) {
        target.focus({ preventScroll: true });
      }
      setSessionLayoutReorderFocusMessage(focusStatusMessage);
      setSessionLayoutReorderFocusTargetTestId('');
      setSessionLayoutReorderFocusTargetLabel('');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sessionLayoutPresets, sessionLayoutReorderFocusTargetLabel, sessionLayoutReorderFocusTargetTestId]);

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

  useEffect(() => {
    if (
      sessionLayoutRenameTargetName &&
      !sessionLayoutPresets.some((preset) => preset.name.toLowerCase() === sessionLayoutRenameTargetName.toLowerCase())
    ) {
      setSessionLayoutRenameTargetName('');
      setSessionLayoutRenameDraftName('');
      setSessionLayoutRenameError('');
    }
  }, [sessionLayoutPresets, sessionLayoutRenameTargetName]);

  useEffect(() => {
    const validLayoutPresetNames = new Set(sessionLayoutPresets.map((preset) => preset.name));
    setSelectedSessionLayoutPresetNames((current) => {
      const nextSelection = new Set([...current].filter((presetName) => validLayoutPresetNames.has(presetName)));
      return setsEqual(current, nextSelection) ? current : nextSelection;
    });
  }, [sessionLayoutPresets]);

  useEffect(() => {
    const validFolders = new Set(sessionLayoutPresets.map((preset) => preset.folder));
    setCollapsedSessionLayoutFolders((current) => {
      const nextCollapsedFolders = new Set([...current].filter((folder) => validFolders.has(folder)));
      if (!setsEqual(current, nextCollapsedFolders)) {
        writeDesktopCmSessionLayoutCollapsedFolders(nextCollapsedFolders);
      }
      return setsEqual(current, nextCollapsedFolders) ? current : nextCollapsedFolders;
    });
  }, [sessionLayoutPresets]);

  useEffect(() => {
    if (sessionLayoutFolderFilter === 'all') {
      return;
    }
    if (!sessionLayoutFolderFilterOptions.some((option) => option.folder === sessionLayoutFolderFilter)) {
      setSessionLayoutFolderFilter('all');
    }
  }, [sessionLayoutFolderFilter, sessionLayoutFolderFilterOptions]);

  useEffect(() => {
    if (!sessionLayoutFolderRenameTarget) {
      return;
    }
    if (!sessionLayoutFolderFilterOptions.some((option) => option.folder === sessionLayoutFolderRenameTarget)) {
      setSessionLayoutFolderRenameTarget('');
      setSessionLayoutFolderRenameDraft('');
    }
  }, [sessionLayoutFolderFilterOptions, sessionLayoutFolderRenameTarget]);

  useEffect(() => {
    if (!activeSessionLayoutFolderName) {
      return;
    }
    if (!sessionLayoutFolderNames.includes(activeSessionLayoutFolderName)) {
      setActiveSessionLayoutFolderName('');
    }
  }, [activeSessionLayoutFolderName, sessionLayoutFolderNames]);

  useEffect(() => {
    if (selectedSessionLayoutPresetNames.size === 0 && sessionLayoutBulkDeleteConfirm) {
      setSessionLayoutBulkDeleteConfirm(false);
    }
  }, [selectedSessionLayoutPresetNames.size, sessionLayoutBulkDeleteConfirm]);

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

  const handleSaveSessionLayoutPreset = () => {
    setSessionLayoutImportConflicts(null);
    setSessionLayoutRenameTargetName('');
    setSessionLayoutRenameDraftName('');
    setSessionLayoutRenameError('');
    setSessionLayoutBulkDeleteConfirm(false);
    const presetName = normalizeDesktopCmSessionLayoutPresetName(sessionLayoutPresetName || `Layout ${sessionLayoutPresets.length + 1}`);
    const preset: DesktopCmSessionLayoutPreset = {
      name: presetName,
      folder: normalizeDesktopCmSessionLayoutFolderName(sessionLayoutPresetFolder),
      viewPreferences: pruneDesktopCmSessionViewPreferences(sessionViewPreferences, sessions),
      updatedAt: Date.now(),
    };
    setSessionLayoutPresets((current) => {
      const withoutSameName = current.filter((item) => item.name.toLowerCase() !== preset.name.toLowerCase());
      const nextPresets = normalizeDesktopCmSessionLayoutPresets([preset, ...withoutSameName]).slice(0, maxDesktopCmSessionLayoutPresets);
      writeDesktopCmSessionLayoutPresets(nextPresets);
      return nextPresets;
    });
    setSessionLayoutPresetName('');
    setSessionLayoutPresetFolder(preset.folder);
  };

  const handleStartRenameSessionLayoutPreset = (preset: DesktopCmSessionLayoutPreset) => {
    setSessionLayoutImportConflicts(null);
    setSessionLayoutBulkDeleteConfirm(false);
    setSessionLayoutRenameTargetName(preset.name);
    setSessionLayoutRenameDraftName(preset.name);
    setSessionLayoutRenameError('');
  };

  const handleCancelRenameSessionLayoutPreset = () => {
    setSessionLayoutRenameTargetName('');
    setSessionLayoutRenameDraftName('');
    setSessionLayoutRenameError('');
  };

  const handleSaveRenamedSessionLayoutPreset = () => {
    if (!sessionLayoutRenameTargetName) {
      return;
    }
    const targetKey = sessionLayoutRenameTargetName.toLowerCase();
    const nextName = normalizeDesktopCmSessionLayoutPresetName(sessionLayoutRenameDraftName);
    const nextKey = nextName.toLowerCase();
    if (targetKey === nextKey) {
      handleCancelRenameSessionLayoutPreset();
      return;
    }
    const duplicate = sessionLayoutPresets.some((preset) => preset.name.toLowerCase() === nextKey && preset.name.toLowerCase() !== targetKey);
    if (duplicate) {
      setSessionLayoutRenameError('layout 이름 중복');
      return;
    }
    setSessionLayoutImportConflicts(null);
    setSessionLayoutBulkDeleteConfirm(false);
    setSessionLayoutPresets((current) => {
      const nextPresets = normalizeDesktopCmSessionLayoutPresets(
        current.map((preset) =>
          preset.name.toLowerCase() === targetKey
            ? {
                ...preset,
                name: nextName,
                updatedAt: Date.now(),
              }
            : preset,
        ),
      );
      writeDesktopCmSessionLayoutPresets(nextPresets);
      return nextPresets;
    });
    handleCancelRenameSessionLayoutPreset();
  };

  const handleSessionLayoutRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSaveRenamedSessionLayoutPreset();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelRenameSessionLayoutPreset();
    }
  };

  const handleDuplicateSessionLayoutPreset = (preset: DesktopCmSessionLayoutPreset) => {
    setSessionLayoutImportConflicts(null);
    handleCancelRenameSessionLayoutPreset();
    setSessionLayoutBulkDeleteConfirm(false);
    setSessionLayoutPresets((current) => {
      const existingNames = new Set(current.map((item) => item.name.toLowerCase()));
      const duplicatedPreset: DesktopCmSessionLayoutPreset = {
        name: buildDesktopCmSessionLayoutDuplicateName(preset.name, existingNames),
        folder: preset.folder,
        viewPreferences: normalizeDesktopCmSessionViewPreferences(preset.viewPreferences),
        updatedAt: Date.now(),
      };
      const nextPresets = normalizeDesktopCmSessionLayoutPresets([duplicatedPreset, ...current]).slice(0, maxDesktopCmSessionLayoutPresets);
      writeDesktopCmSessionLayoutPresets(nextPresets);
      return nextPresets;
    });
  };

  const handleApplySessionLayoutPreset = (preset: DesktopCmSessionLayoutPreset) => {
    setSessionLayoutImportConflicts(null);
    handleCancelRenameSessionLayoutPreset();
    setSessionLayoutBulkDeleteConfirm(false);
    const nextPreferences = pruneDesktopCmSessionViewPreferences(preset.viewPreferences, sessions);
    setSessionViewPreferences(nextPreferences);
    writeDesktopCmSessionViewPreferences(nextPreferences);
    setBulkDeleteConfirm(false);
    setSelectedBulkSessionIds(new Set());
  };

  const handleDeleteSessionLayoutPreset = (presetName: string) => {
    setSessionLayoutImportConflicts(null);
    setSessionLayoutBulkDeleteConfirm(false);
    if (sessionLayoutRenameTargetName.toLowerCase() === presetName.toLowerCase()) {
      handleCancelRenameSessionLayoutPreset();
    }
    setSelectedSessionLayoutPresetNames((current) => {
      const nextSelection = new Set(current);
      nextSelection.delete(presetName);
      return nextSelection;
    });
    setSessionLayoutPresets((current) => {
      const nextPresets = current.filter((preset) => preset.name !== presetName);
      writeDesktopCmSessionLayoutPresets(nextPresets);
      return nextPresets;
    });
  };

  const handleExportSessionLayouts = () => {
    setError('');
    downloadDesktopCmSessionLayoutBundle(sessionLayoutPresets, 'kuviewer-desktop-cm-session-layouts');
  };

  const handleToggleSessionLayoutPresetSelection = (presetName: string, checked: boolean) => {
    setSessionLayoutBulkDeleteConfirm(false);
    setSelectedSessionLayoutPresetNames((current) => {
      const nextSelection = new Set(current);
      if (checked) {
        nextSelection.add(presetName);
      } else {
        nextSelection.delete(presetName);
      }
      return nextSelection;
    });
  };

  const handleSelectVisibleSessionLayoutPresets = () => {
    setSessionLayoutBulkDeleteConfirm(false);
    setSelectedSessionLayoutPresetNames((current) => new Set([...current, ...visibleSessionLayoutPresets.map((preset) => preset.name)]));
  };

  const handleSelectSessionLayoutFolderPresets = (folderName: string) => {
    const folder = normalizeDesktopCmSessionLayoutFolderName(folderName);
    setSessionLayoutBulkDeleteConfirm(false);
    setSelectedSessionLayoutPresetNames(
      (current) =>
        new Set([
          ...current,
          ...visibleSessionLayoutPresets.filter((preset) => normalizeDesktopCmSessionLayoutFolderName(preset.folder) === folder).map((preset) => preset.name),
        ]),
    );
  };

  const handleClearSessionLayoutPresetSelection = () => {
    setSessionLayoutBulkDeleteConfirm(false);
    setSelectedSessionLayoutPresetNames(new Set());
  };

  const handleExportSelectedSessionLayouts = () => {
    if (selectedSessionLayoutPresets.length === 0) {
      return;
    }
    setError('');
    setSessionLayoutBulkDeleteConfirm(false);
    downloadDesktopCmSessionLayoutBundle(selectedSessionLayoutPresets, 'kuviewer-desktop-cm-session-layouts-selected');
  };

  const handleToggleSessionLayoutFolder = (folder: string) => {
    const normalizedFolder = normalizeDesktopCmSessionLayoutFolderName(folder);
    setCollapsedSessionLayoutFolders((current) => {
      const nextCollapsedFolders = new Set(current);
      if (nextCollapsedFolders.has(normalizedFolder)) {
        nextCollapsedFolders.delete(normalizedFolder);
      } else {
        nextCollapsedFolders.add(normalizedFolder);
      }
      writeDesktopCmSessionLayoutCollapsedFolders(nextCollapsedFolders);
      return nextCollapsedFolders;
    });
  };

  const handleUpdateSessionLayoutPresetFolder = (presetName: string, folderValue: string) => {
    const folder = normalizeDesktopCmSessionLayoutFolderName(folderValue);
    setSessionLayoutImportConflicts(null);
    setSessionLayoutBulkDeleteConfirm(false);
    setSessionLayoutPresets((current) => {
      const nextPresets = normalizeDesktopCmSessionLayoutPresets(
        current.map((preset) =>
          preset.name === presetName
            ? {
                ...preset,
                folder,
                updatedAt: Date.now(),
              }
            : preset,
        ),
      );
      writeDesktopCmSessionLayoutPresets(nextPresets);
      return nextPresets;
    });
  };

  const handleStartRenameSessionLayoutFolder = (folderName: string) => {
    const folder = normalizeDesktopCmSessionLayoutFolderName(folderName);
    setSessionLayoutBulkDeleteConfirm(false);
    setActiveSessionLayoutFolderName(folder);
    setSessionLayoutFolderRenameTarget(folder);
    setSessionLayoutFolderRenameDraft(folder);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(`[data-testid="desktop-cm-session-layout-folder-rename-input-${slugifyDesktopCmTestId(folder)}"]`)?.focus();
    });
  };

  const handleCancelRenameSessionLayoutFolder = () => {
    setSessionLayoutFolderRenameTarget('');
    setSessionLayoutFolderRenameDraft('');
  };

  const handleSaveRenamedSessionLayoutFolder = () => {
    const sourceFolder = normalizeDesktopCmSessionLayoutFolderName(sessionLayoutFolderRenameTarget);
    const targetFolder = normalizeDesktopCmSessionLayoutFolderName(sessionLayoutFolderRenameDraft);
    if (!sourceFolder) {
      handleCancelRenameSessionLayoutFolder();
      return;
    }
    if (sourceFolder === targetFolder) {
      handleCancelRenameSessionLayoutFolder();
      return;
    }
    setSessionLayoutImportConflicts(null);
    setSessionLayoutBulkDeleteConfirm(false);
    setCollapsedSessionLayoutFolders((current) => {
      if (!current.has(sourceFolder)) {
        return current;
      }
      const nextCollapsedFolders = new Set(current);
      nextCollapsedFolders.delete(sourceFolder);
      nextCollapsedFolders.add(targetFolder);
      writeDesktopCmSessionLayoutCollapsedFolders(nextCollapsedFolders);
      return nextCollapsedFolders;
    });
    setSessionLayoutFolderFilter((current) => (normalizeDesktopCmSessionLayoutFolderName(current) === sourceFolder ? targetFolder : current));
    setActiveSessionLayoutFolderName(targetFolder);
    setSessionLayoutPresets((current) => {
      const nextPresets = normalizeDesktopCmSessionLayoutPresets(
        current.map((preset) =>
          normalizeDesktopCmSessionLayoutFolderName(preset.folder) === sourceFolder
            ? {
                ...preset,
                folder: targetFolder,
                updatedAt: Date.now(),
              }
            : preset,
        ),
      );
      writeDesktopCmSessionLayoutPresets(nextPresets);
      return nextPresets;
    });
    handleCancelRenameSessionLayoutFolder();
  };

  const requestSessionLayoutReorderFocus = (targetTestId: string, targetLabel: string) => {
    setSessionLayoutReorderFocusTargetTestId(targetTestId);
    setSessionLayoutReorderFocusTargetLabel(targetLabel);
  };

  const sessionLayoutFolderDragHandleTestId = (folderName: string) => `desktop-cm-session-layout-folder-drag-handle-${slugifyDesktopCmTestId(folderName)}`;
  const sessionLayoutPresetDragHandleTestId = (presetName: string) => `desktop-cm-session-layout-drag-handle-${slugifyDesktopCmTestId(presetName)}`;
  const sessionLayoutReorderMovementLabel = (direction: -1 | 1 | 'first' | 'last') =>
    direction === 'first' ? 'moved to first' : direction === 'last' ? 'moved to last' : direction < 0 ? 'moved up' : 'moved down';
  const sessionLayoutReorderPositionLabel = (index: number, total: number) => `position ${index + 1} of ${total}`;
  const sessionLayoutFolderReorderSuccessMessage = (folderName: string, direction: -1 | 1 | 'first' | 'last', targetIndex: number, total: number) =>
    `Reorder complete: ${folderName} folder ${sessionLayoutReorderMovementLabel(direction)}, ${sessionLayoutReorderPositionLabel(targetIndex, total)}.`;
  const sessionLayoutPresetReorderSuccessMessage = (presetName: string, folderName: string, direction: -1 | 1 | 'first' | 'last', targetIndex: number, total: number) =>
    `Reorder complete: ${presetName} layout ${sessionLayoutReorderMovementLabel(direction)} within ${folderName}, ${sessionLayoutReorderPositionLabel(targetIndex, total)}.`;
  const sessionLayoutReorderUnchangedMessage = (targetLabel: string, reason: string) => `Reorder unchanged: ${targetLabel} ${reason}.`;
  const sessionLayoutFolderReorderDisabledReason = (folderName: string, direction?: 'up' | 'down') => {
    const folder = normalizeDesktopCmSessionLayoutFolderName(folderName);
    if (sessionLayoutReorderFilterDisabledReason) {
      return sessionLayoutReorderFilterDisabledReason;
    }
    if (sessionLayoutFolderNames.length <= 1) {
      return 'Reorder unavailable: at least two layout folders are required.';
    }
    const folderIndex = sessionLayoutFolderNames.indexOf(folder);
    if (direction === 'up' && folderIndex === 0) {
      return `Reorder unchanged: ${folder} folder is already first.`;
    }
    if (direction === 'down' && folderIndex === sessionLayoutFolderNames.length - 1) {
      return `Reorder unchanged: ${folder} folder is already last.`;
    }
    return '';
  };
  const sessionLayoutPresetReorderDisabledReason = (presetName: string, folderName: string, direction?: 'up' | 'down') => {
    const folder = normalizeDesktopCmSessionLayoutFolderName(folderName);
    const folderPresets = sessionLayoutPresets.filter((preset) => normalizeDesktopCmSessionLayoutFolderName(preset.folder) === folder);
    if (sessionLayoutReorderFilterDisabledReason) {
      return sessionLayoutReorderFilterDisabledReason;
    }
    if (folderPresets.length <= 1) {
      return `Reorder unavailable: ${folder} folder needs at least two layout presets.`;
    }
    const presetIndex = folderPresets.findIndex((preset) => preset.name === presetName);
    if (direction === 'up' && presetIndex === 0) {
      return `Reorder unchanged: ${presetName} layout is already first in ${folder}.`;
    }
    if (direction === 'down' && presetIndex === folderPresets.length - 1) {
      return `Reorder unchanged: ${presetName} layout is already last in ${folder}.`;
    }
    return '';
  };

  const handleMoveSessionLayoutFolderOrder = (
    folderName: string,
    direction: -1 | 1 | 'first' | 'last',
    focusTarget: 'folder-handle' | 'folder-list' = 'folder-handle',
  ) => {
    const folder = normalizeDesktopCmSessionLayoutFolderName(folderName);
    if (!canReorderSessionLayoutFolders) {
      announceSessionLayoutReorderStatus(sessionLayoutReorderUnavailableReason || 'Reorder unavailable: layout folder order cannot change now.');
      return;
    }
    const folderOrder = desktopCmSessionLayoutFolderOrder(sessionLayoutPresets);
    const currentIndex = folderOrder.indexOf(folder);
    const targetIndex =
      direction === 'first' ? 0 : direction === 'last' ? folderOrder.length - 1 : currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= folderOrder.length) {
      announceSessionLayoutReorderStatus(
        sessionLayoutReorderUnchangedMessage(folder || 'layout folder', `cannot move ${direction === -1 || direction === 'first' ? 'up' : 'down'}`),
      );
      return;
    }
    if (currentIndex === targetIndex) {
      announceSessionLayoutReorderStatus(
        sessionLayoutReorderUnchangedMessage(`${folder} folder`, `is already ${direction === 'first' || direction === -1 ? 'first' : 'last'}`),
      );
      return;
    }
    setSessionLayoutImportConflicts(null);
    setSessionLayoutBulkDeleteConfirm(false);
    setActiveSessionLayoutFolderName(folder);
    setSessionLayoutPresets((current) => {
      const nextPresets = moveDesktopCmSessionLayoutFolderToIndex(current, folder, targetIndex);
      writeDesktopCmSessionLayoutPresets(nextPresets);
      return nextPresets;
    });
    announceSessionLayoutReorderStatus(sessionLayoutFolderReorderSuccessMessage(folder, direction, targetIndex, folderOrder.length));
    requestSessionLayoutReorderFocus(
      focusTarget === 'folder-list' ? 'desktop-cm-session-layout-list' : sessionLayoutFolderDragHandleTestId(folder),
      focusTarget === 'folder-list' ? 'saved layout folder list' : `${folder} layout folder drag handle`,
    );
  };

  const handleDropSessionLayoutFolder = (targetFolderName: string, event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!canReorderSessionLayoutFolders) {
      setDraggingSessionLayoutFolderName('');
      return;
    }
    const sourceFolder = normalizeDesktopCmSessionLayoutFolderName(event.dataTransfer.getData('application/x-kuviewer-layout-folder') || draggingSessionLayoutFolderName);
    const targetFolder = normalizeDesktopCmSessionLayoutFolderName(targetFolderName);
    if (!sourceFolder || sourceFolder === targetFolder) {
      setDraggingSessionLayoutFolderName('');
      return;
    }
    setSessionLayoutImportConflicts(null);
    setSessionLayoutBulkDeleteConfirm(false);
    setActiveSessionLayoutFolderName(sourceFolder);
    setSessionLayoutPresets((current) => {
      const nextPresets = moveDesktopCmSessionLayoutFolderBefore(current, sourceFolder, targetFolder);
      writeDesktopCmSessionLayoutPresets(nextPresets);
      return nextPresets;
    });
    announceSessionLayoutReorderStatus(`Reorder complete: ${sourceFolder} folder moved before ${targetFolder}.`);
    requestSessionLayoutReorderFocus(sessionLayoutFolderDragHandleTestId(sourceFolder), `${sourceFolder} layout folder drag handle`);
    setDraggingSessionLayoutFolderName('');
  };

  const handleMoveSessionLayoutPresetOrder = (presetName: string, direction: -1 | 1 | 'first' | 'last') => {
    if (!canReorderSessionLayoutPresets) {
      announceSessionLayoutReorderStatus(sessionLayoutReorderUnavailableReason || 'Reorder unavailable: layout preset order cannot change now.');
      return;
    }
    const sourcePreset = sessionLayoutPresets.find((preset) => preset.name === presetName);
    if (!sourcePreset) {
      return;
    }
    const folder = normalizeDesktopCmSessionLayoutFolderName(sourcePreset.folder);
    const folderPresets = sessionLayoutPresets.filter((preset) => normalizeDesktopCmSessionLayoutFolderName(preset.folder) === folder);
    const currentIndex = folderPresets.findIndex((preset) => preset.name === presetName);
    const targetIndex =
      direction === 'first' ? 0 : direction === 'last' ? folderPresets.length - 1 : currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= folderPresets.length) {
      announceSessionLayoutReorderStatus(
        sessionLayoutReorderUnchangedMessage(`${presetName} layout`, `cannot move ${direction === -1 || direction === 'first' ? 'up' : 'down'} in ${folder}`),
      );
      return;
    }
    if (currentIndex === targetIndex) {
      announceSessionLayoutReorderStatus(
        sessionLayoutReorderUnchangedMessage(`${presetName} layout`, `is already ${direction === 'first' || direction === -1 ? 'first' : 'last'} in ${folder}`),
      );
      return;
    }
    setSessionLayoutImportConflicts(null);
    setSessionLayoutBulkDeleteConfirm(false);
    setSessionLayoutPresets((current) => {
      const nextPresets = moveDesktopCmSessionLayoutPresetToIndex(current, presetName, targetIndex);
      writeDesktopCmSessionLayoutPresets(nextPresets);
      return nextPresets;
    });
    announceSessionLayoutReorderStatus(sessionLayoutPresetReorderSuccessMessage(presetName, folder, direction, targetIndex, folderPresets.length));
    requestSessionLayoutReorderFocus(sessionLayoutPresetDragHandleTestId(presetName), `${presetName} layout drag handle in ${folder}`);
  };

  const handleDropSessionLayoutPreset = (targetPresetName: string, event: ReactDragEvent<HTMLSpanElement>) => {
    event.preventDefault();
    if (!canReorderSessionLayoutPresets) {
      setDraggingSessionLayoutPresetName('');
      return;
    }
    const sourcePresetName = event.dataTransfer.getData('application/x-kuviewer-layout-preset') || draggingSessionLayoutPresetName;
    if (!sourcePresetName || sourcePresetName === targetPresetName) {
      setDraggingSessionLayoutPresetName('');
      return;
    }
    setSessionLayoutImportConflicts(null);
    setSessionLayoutBulkDeleteConfirm(false);
    setSessionLayoutPresets((current) => {
      const nextPresets = moveDesktopCmSessionLayoutPresetBefore(current, sourcePresetName, targetPresetName);
      writeDesktopCmSessionLayoutPresets(nextPresets);
      return nextPresets;
    });
    announceSessionLayoutReorderStatus(`Reorder complete: ${sourcePresetName} layout moved before ${targetPresetName}.`);
    requestSessionLayoutReorderFocus(sessionLayoutPresetDragHandleTestId(sourcePresetName), `${sourcePresetName} layout drag handle`);
    setDraggingSessionLayoutPresetName('');
  };

  const handleMoveActiveSessionLayoutFolder = (direction: 'previous' | 'next' | 'first' | 'last') => {
    if (sessionLayoutFolderNames.length === 0) {
      return;
    }
    const activeIndex = sessionLayoutFolderNames.findIndex((folderName) => folderName === activeSessionLayoutFolderName);
    if (direction === 'first') {
      setActiveSessionLayoutFolderName(sessionLayoutFolderNames[0]);
      return;
    }
    if (direction === 'last') {
      setActiveSessionLayoutFolderName(sessionLayoutFolderNames[sessionLayoutFolderNames.length - 1]);
      return;
    }
    if (activeIndex < 0) {
      setActiveSessionLayoutFolderName(direction === 'previous' ? sessionLayoutFolderNames[sessionLayoutFolderNames.length - 1] : sessionLayoutFolderNames[0]);
      return;
    }
    const nextIndex =
      direction === 'previous'
        ? Math.max(0, activeIndex - 1)
        : Math.min(sessionLayoutFolderNames.length - 1, activeIndex + 1);
    setActiveSessionLayoutFolderName(sessionLayoutFolderNames[nextIndex]);
  };

  const handleToggleActiveSessionLayoutFolder = () => {
    if (activeSessionLayoutFolderName) {
      handleToggleSessionLayoutFolder(activeSessionLayoutFolderName);
      return;
    }
    if (sessionLayoutFolderNames.length > 0) {
      setActiveSessionLayoutFolderName(sessionLayoutFolderNames[0]);
    }
  };

  const handleSelectActiveSessionLayoutFolder = () => {
    if (activeSessionLayoutFolderName) {
      handleSelectSessionLayoutFolderPresets(activeSessionLayoutFolderName);
      return;
    }
    if (sessionLayoutFolderNames.length > 0) {
      const firstFolder = sessionLayoutFolderNames[0];
      setActiveSessionLayoutFolderName(firstFolder);
      handleSelectSessionLayoutFolderPresets(firstFolder);
    }
  };

  const handleRenameActiveSessionLayoutFolder = () => {
    if (activeSessionLayoutFolderName) {
      handleStartRenameSessionLayoutFolder(activeSessionLayoutFolderName);
      return;
    }
    if (sessionLayoutFolderNames.length > 0) {
      handleStartRenameSessionLayoutFolder(sessionLayoutFolderNames[0]);
    }
  };

  const handleMoveActiveSessionLayoutFolderOrder = (direction: -1 | 1 | 'first' | 'last') => {
    if (activeSessionLayoutFolderName) {
      handleMoveSessionLayoutFolderOrder(activeSessionLayoutFolderName, direction, 'folder-list');
      return;
    }
    if (sessionLayoutFolderNames.length > 0) {
      const fallbackFolder = direction === 'last' ? sessionLayoutFolderNames[sessionLayoutFolderNames.length - 1] : sessionLayoutFolderNames[0];
      setActiveSessionLayoutFolderName(fallbackFolder);
      handleMoveSessionLayoutFolderOrder(fallbackFolder, direction, 'folder-list');
    }
  };

  const handleSessionLayoutFolderReorderHandleKeyDown = (folderName: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      handleMoveSessionLayoutFolderOrder(folderName, -1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      handleMoveSessionLayoutFolderOrder(folderName, 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      handleMoveSessionLayoutFolderOrder(folderName, 'first');
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      handleMoveSessionLayoutFolderOrder(folderName, 'last');
    }
  };

  const handleSessionLayoutPresetReorderHandleKeyDown = (presetName: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      handleMoveSessionLayoutPresetOrder(presetName, -1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      handleMoveSessionLayoutPresetOrder(presetName, 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      handleMoveSessionLayoutPresetOrder(presetName, 'first');
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      handleMoveSessionLayoutPresetOrder(presetName, 'last');
    }
  };

  const handleSessionLayoutFolderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (sessionLayoutFolderNames.length === 0 || isDesktopCmKeyboardIgnoredTarget(event.target)) {
      return;
    }
    if (event.shiftKey && event.key === 'ArrowUp') {
      event.preventDefault();
      handleMoveActiveSessionLayoutFolderOrder(-1);
      return;
    }
    if (event.shiftKey && event.key === 'ArrowDown') {
      event.preventDefault();
      handleMoveActiveSessionLayoutFolderOrder(1);
      return;
    }
    if (event.shiftKey && event.key === 'Home') {
      event.preventDefault();
      handleMoveActiveSessionLayoutFolderOrder('first');
      return;
    }
    if (event.shiftKey && event.key === 'End') {
      event.preventDefault();
      handleMoveActiveSessionLayoutFolderOrder('last');
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      handleMoveActiveSessionLayoutFolder('previous');
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      handleMoveActiveSessionLayoutFolder('next');
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      handleMoveActiveSessionLayoutFolder('first');
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      handleMoveActiveSessionLayoutFolder('last');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      handleToggleActiveSessionLayoutFolder();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (sessionLayoutFolderRenameTarget) {
        handleCancelRenameSessionLayoutFolder();
      } else if (activeSessionLayoutFolderName) {
        setActiveSessionLayoutFolderName('');
      } else {
        sessionLayoutFolderListRef.current?.blur();
      }
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      handleSelectActiveSessionLayoutFolder();
    } else if (key === 'r') {
      event.preventDefault();
      handleRenameActiveSessionLayoutFolder();
    }
  };

  const handleMoveSelectedSessionLayoutsToFolder = () => {
    if (selectedSessionLayoutPresetNames.size === 0) {
      return;
    }
    const folder = normalizeDesktopCmSessionLayoutFolderName(sessionLayoutBulkFolderName);
    const selectedNames = new Set(selectedSessionLayoutPresetNames);
    setSessionLayoutBulkFolderName(folder);
    setSessionLayoutImportConflicts(null);
    setSessionLayoutBulkDeleteConfirm(false);
    setSessionLayoutPresets((current) => {
      const nextPresets = normalizeDesktopCmSessionLayoutPresets(
        current.map((preset) =>
          selectedNames.has(preset.name)
            ? {
                ...preset,
                folder,
                updatedAt: Date.now(),
              }
            : preset,
        ),
      );
      writeDesktopCmSessionLayoutPresets(nextPresets);
      return nextPresets;
    });
  };

  const handleDeleteSelectedSessionLayouts = () => {
    if (selectedSessionLayoutPresetNames.size === 0) {
      return;
    }
    if (!sessionLayoutBulkDeleteConfirm) {
      setSessionLayoutBulkDeleteConfirm(true);
      return;
    }
    const selectedNames = new Set(selectedSessionLayoutPresetNames);
    setSessionLayoutImportConflicts(null);
    if (selectedNames.has(sessionLayoutRenameTargetName)) {
      handleCancelRenameSessionLayoutPreset();
    }
    setSessionLayoutPresets((current) => {
      const nextPresets = current.filter((preset) => !selectedNames.has(preset.name));
      writeDesktopCmSessionLayoutPresets(nextPresets);
      return nextPresets;
    });
    setSelectedSessionLayoutPresetNames(new Set());
    setSessionLayoutBulkDeleteConfirm(false);
  };

  const handleImportSessionLayouts = async (file: File | null) => {
    if (!file) {
      return;
    }
    setError('');
    handleCancelRenameSessionLayoutPreset();
    setSessionLayoutBulkDeleteConfirm(false);
    setSessionLayoutImportConflicts(null);
    setBusyAction('import-session-layouts');
    try {
      const parsed = parseDesktopCmSessionLayoutImportBundle(JSON.parse(await file.text()), sessions);
      const existingPresetByName = new Map(sessionLayoutPresets.map((preset) => [preset.name.toLowerCase(), preset]));
      const incomingPresets: DesktopCmSessionLayoutPreset[] = [];
      const conflicts: DesktopCmSessionLayoutImportConflict[] = [];
      let imported = 0;
      let skipped = parsed.skipped;
      for (const preset of parsed.items) {
        const existingPreset = existingPresetByName.get(preset.name.toLowerCase());
        if (!existingPreset) {
          incomingPresets.push(preset);
          imported += 1;
        } else if (desktopCmSessionLayoutEqual(existingPreset.viewPreferences, preset.viewPreferences)) {
          skipped += 1;
        } else {
          conflicts.push({ name: preset.name, current: existingPreset, incoming: preset });
        }
      }
      if (incomingPresets.length > 0) {
        const nextPresets = normalizeDesktopCmSessionLayoutPresets([...incomingPresets, ...sessionLayoutPresets]);
        setSessionLayoutPresets(nextPresets);
        writeDesktopCmSessionLayoutPresets(nextPresets);
      }
      setSessionLayoutImportSummary({ fileName: file.name, imported, updated: 0, skipped, invalid: parsed.invalid });
      if (conflicts.length > 0) {
        setSessionLayoutImportConflicts({
          fileName: file.name,
          imported,
          updated: 0,
          skipped,
          invalid: parsed.invalid,
          initialConflictCount: conflicts.length,
          incomingResolved: 0,
          currentResolved: 0,
          renamedResolved: 0,
          conflicts,
        });
      }
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_session_layout_import_failed'));
    } finally {
      setBusyAction('');
      if (sessionLayoutImportInputRef.current) {
        sessionLayoutImportInputRef.current.value = '';
      }
    }
  };

  const handleResolveSessionLayoutImportConflicts = (mode: DesktopCmSessionLayoutConflictResolution, conflictName?: string) => {
    if (!sessionLayoutImportConflicts) {
      return;
    }
    const targetName = conflictName?.toLowerCase();
    const selectedConflicts = targetName ? sessionLayoutImportConflicts.conflicts.filter((conflict) => conflict.name.toLowerCase() === targetName) : sessionLayoutImportConflicts.conflicts;
    if (selectedConflicts.length === 0) {
      return;
    }
    const selectedConflictNames = new Set(selectedConflicts.map((conflict) => conflict.name.toLowerCase()));
    const remainingConflicts = sessionLayoutImportConflicts.conflicts.filter((conflict) => !selectedConflictNames.has(conflict.name.toLowerCase()));
    let imported = sessionLayoutImportConflicts.imported;
    let updated = sessionLayoutImportConflicts.updated;
    let skipped = sessionLayoutImportConflicts.skipped;
    let incomingResolved = sessionLayoutImportConflicts.incomingResolved;
    let currentResolved = sessionLayoutImportConflicts.currentResolved;
    let renamedResolved = sessionLayoutImportConflicts.renamedResolved;

    if (mode === 'current') {
      skipped += selectedConflicts.length;
      currentResolved += selectedConflicts.length;
    } else if (mode === 'incoming') {
      const nextPresets = normalizeDesktopCmSessionLayoutPresets([
        ...selectedConflicts.map((conflict) => conflict.incoming),
        ...sessionLayoutPresets.filter((preset) => !selectedConflictNames.has(preset.name.toLowerCase())),
      ]);
      setSessionLayoutPresets(nextPresets);
      writeDesktopCmSessionLayoutPresets(nextPresets);
      updated += selectedConflicts.length;
      incomingResolved += selectedConflicts.length;
    } else {
      const existingNames = new Set(sessionLayoutPresets.map((preset) => preset.name.toLowerCase()));
      const renamedPresets = selectedConflicts.map((conflict) => {
        const name = buildDesktopCmSessionLayoutImportName(conflict.incoming.name, existingNames);
        existingNames.add(name.toLowerCase());
        return { ...conflict.incoming, name, updatedAt: Date.now() };
      });
      const nextPresets = normalizeDesktopCmSessionLayoutPresets([...renamedPresets, ...sessionLayoutPresets]);
      setSessionLayoutPresets(nextPresets);
      writeDesktopCmSessionLayoutPresets(nextPresets);
      imported += renamedPresets.length;
      renamedResolved += renamedPresets.length;
    }

    setSessionLayoutImportSummary({
      fileName: sessionLayoutImportConflicts.fileName,
      imported,
      updated,
      skipped,
      invalid: sessionLayoutImportConflicts.invalid,
    });
    if (remainingConflicts.length > 0) {
      setSessionLayoutImportConflicts({
        ...sessionLayoutImportConflicts,
        imported,
        updated,
        skipped,
        incomingResolved,
        currentResolved,
        renamedResolved,
        conflicts: remainingConflicts,
      });
    } else {
      setSessionLayoutImportConflicts(null);
    }
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
        {sessionLayoutImportSummary ? (
          <span className="ku-chip max-w-full" data-testid="desktop-cm-session-layout-import-summary">
            layout import {sessionLayoutImportSummary.fileName} · new {sessionLayoutImportSummary.imported} · updated {sessionLayoutImportSummary.updated} · skipped{' '}
            {sessionLayoutImportSummary.skipped} · invalid {sessionLayoutImportSummary.invalid}
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

          <div
            className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.1)] bg-white/68 px-3 py-2"
            data-testid="desktop-cm-session-saved-layouts"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="ku-meta">Saved session layouts</span>
              <label className="min-w-[180px] flex-1">
                <input
                  className="ku-field h-9 w-full"
                  data-testid="desktop-cm-session-layout-name"
                  maxLength={maxDesktopCmSessionLayoutPresetNameLength}
                  placeholder={`Layout ${sessionLayoutPresets.length + 1}`}
                  value={sessionLayoutPresetName}
                  onChange={(event) => setSessionLayoutPresetName(event.target.value)}
                />
              </label>
              <label className="min-w-[150px] flex-1">
                <input
                  className="ku-field h-9 w-full"
                  data-testid="desktop-cm-session-layout-folder"
                  maxLength={maxDesktopCmSessionLayoutFolderNameLength}
                  placeholder="Folder"
                  value={sessionLayoutPresetFolder}
                  onChange={(event) => setSessionLayoutPresetFolder(event.target.value)}
                  onBlur={(event) => setSessionLayoutPresetFolder(normalizeDesktopCmSessionLayoutFolderName(event.currentTarget.value))}
                />
              </label>
              <label className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.48)]" size={15} aria-hidden="true" />
                <input
                  className="ku-field h-9 w-full pl-9 pr-3"
                  data-testid="desktop-cm-session-layout-search"
                  placeholder="layout 검색"
                  value={sessionLayoutSearchQuery}
                  onChange={(event) => setSessionLayoutSearchQuery(event.target.value)}
                />
              </label>
              <label className="min-w-[160px] flex-1">
                <select
                  className="ku-field h-9 w-full"
                  data-testid="desktop-cm-session-layout-folder-filter"
                  value={sessionLayoutFolderFilter}
                  onChange={(event) => {
                    setSessionLayoutBulkDeleteConfirm(false);
                    setSessionLayoutFolderFilter(event.target.value);
                  }}
                >
                  <option value="all">전체 folder</option>
                  {sessionLayoutFolderFilterOptions.map((option) => (
                    <option key={option.folder} value={option.folder}>
                      {option.folder} ({option.count})
                    </option>
                  ))}
                </select>
              </label>
              <button className="ku-control h-9" data-testid="desktop-cm-session-layout-save" type="button" onClick={handleSaveSessionLayoutPreset}>
                <Bookmark size={14} aria-hidden="true" />
                현재 layout 저장
              </button>
              <span className="ku-chip" data-testid="desktop-cm-session-layout-count">
                {sessionLayoutPresets.length} / {maxDesktopCmSessionLayoutPresets}
              </span>
              <span className="ku-chip" data-testid="desktop-cm-session-layout-search-count">
                결과 {visibleSessionLayoutPresets.length} / 전체 {sessionLayoutPresets.length}
              </span>
              <span className="ku-chip" data-testid="desktop-cm-session-layout-folder-filter-count">
                Folder {sessionLayoutFolderFilterActive ? sessionLayoutFolderFilter : '전체'}
              </span>
              <span
                aria-live="polite"
                className={`ku-chip ${sessionLayoutReorderUnavailableReason ? 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]' : ''}`}
                data-testid="desktop-cm-session-layout-reorder-state"
                id={desktopCmSessionLayoutReorderDisabledReasonId}
                role="status"
                title={sessionLayoutReorderStateLabel}
              >
                {sessionLayoutReorderUnavailableReason ? '순서 변경 비활성' : 'folder/preset 순서 변경 가능'}
              </span>
              <button
                className="ku-control h-9"
                data-testid="desktop-cm-session-layout-search-clear"
                type="button"
                disabled={!sessionLayoutSearchActive}
                onClick={() => setSessionLayoutSearchQuery('')}
              >
                <XCircle size={14} aria-hidden="true" />
                검색 초기화
              </button>
              <button
                className="ku-control h-9"
                data-testid="desktop-cm-session-layout-folder-filter-clear"
                type="button"
                disabled={!sessionLayoutFolderFilterActive}
                onClick={() => setSessionLayoutFolderFilter('all')}
              >
                <XCircle size={14} aria-hidden="true" />
                Folder 필터 초기화
              </button>
              <button
                className="ku-control h-9"
                data-testid="desktop-cm-session-layout-bulk-select-visible"
                type="button"
                disabled={visibleSessionLayoutPresets.length === 0}
                onClick={handleSelectVisibleSessionLayoutPresets}
              >
                현재 layout 선택
              </button>
              <button
                className="ku-control h-9"
                data-testid="desktop-cm-session-layout-bulk-clear"
                type="button"
                disabled={selectedSessionLayoutPresetNames.size === 0}
                onClick={handleClearSessionLayoutPresetSelection}
              >
                선택 해제
              </button>
              <button
                className="ku-control h-9"
                data-testid="desktop-cm-session-layout-export"
                type="button"
                disabled={sessionLayoutPresets.length === 0 || busyAction === 'import-session-layouts'}
                onClick={handleExportSessionLayouts}
              >
                <Download size={14} aria-hidden="true" />
                layout export
              </button>
              <label className={`ku-control h-9 ${busyAction === 'import-session-layouts' ? 'opacity-60' : ''}`} data-testid="desktop-cm-session-layout-import-label">
                <Upload size={14} aria-hidden="true" />
                layout import
                <input
                  ref={sessionLayoutImportInputRef}
                  className="hidden"
                  data-testid="desktop-cm-session-layout-import"
                  type="file"
                  accept="application/json,.json"
                  disabled={busyAction === 'import-session-layouts'}
                  onChange={(event) => void handleImportSessionLayouts(event.currentTarget.files?.[0] || null)}
                />
              </label>
            </div>
            {selectedSessionLayoutPresetNames.size > 0 ? (
              <div
                className="flex min-w-0 flex-wrap items-center gap-2 rounded-[10px] border border-[rgba(0,122,255,0.14)] bg-[rgba(0,122,255,0.06)] px-3 py-2"
                data-testid="desktop-cm-session-layout-bulk-toolbar"
              >
                <span className="ku-chip border-[rgba(0,122,255,0.18)] bg-white/65 text-[#0066cc]" data-testid="desktop-cm-session-layout-bulk-count">
                  선택 {selectedSessionLayoutPresetNames.size}개 · 현재 결과 {selectedVisibleSessionLayoutPresetCount}개
                </span>
                <label className="min-w-[150px] flex-1">
                  <span className="ku-meta">Bulk folder</span>
                  <input
                    className="ku-field mt-1 h-8 w-full text-xs"
                    data-testid="desktop-cm-session-layout-bulk-folder-input"
                    maxLength={maxDesktopCmSessionLayoutFolderNameLength}
                    placeholder={defaultDesktopCmSessionLayoutFolder}
                    value={sessionLayoutBulkFolderName}
                    onChange={(event) => {
                      setSessionLayoutBulkDeleteConfirm(false);
                      setSessionLayoutBulkFolderName(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        handleMoveSelectedSessionLayoutsToFolder();
                      }
                    }}
                  />
                </label>
                <button className="ku-control h-8 self-end text-xs" data-testid="desktop-cm-session-layout-bulk-folder-apply" type="button" onClick={handleMoveSelectedSessionLayoutsToFolder}>
                  <Folder size={13} aria-hidden="true" />
                  Folder 이동
                </button>
                <button
                  className="ku-control h-8 text-xs"
                  data-testid="desktop-cm-session-layout-bulk-export"
                  type="button"
                  disabled={busyAction === 'import-session-layouts'}
                  onClick={handleExportSelectedSessionLayouts}
                >
                  <Download size={13} aria-hidden="true" />
                  선택 export
                </button>
                <button
                  className={`ku-control h-8 text-xs ${sessionLayoutBulkDeleteConfirm ? 'border-[rgba(255,59,48,0.28)] bg-[rgba(255,59,48,0.1)] text-[#b42318]' : ''}`}
                  data-testid="desktop-cm-session-layout-bulk-delete"
                  type="button"
                  onClick={handleDeleteSelectedSessionLayouts}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  {sessionLayoutBulkDeleteConfirm ? '선택 삭제 확인' : '선택 삭제'}
                </button>
                <button className="ku-control h-8 text-xs" data-testid="desktop-cm-session-layout-bulk-clear-toolbar" type="button" onClick={handleClearSessionLayoutPresetSelection}>
                  선택 해제
                </button>
              </div>
            ) : null}
            {sessionLayoutImportConflicts ? (
              <DesktopCmLayoutConflictPanel preview={sessionLayoutImportConflicts} onResolve={handleResolveSessionLayoutImportConflicts} />
            ) : null}
            <DesktopCmLayoutList
              ref={sessionLayoutFolderListRef}
              presetCount={sessionLayoutPresets.length}
              folders={groupedSessionLayoutPresets}
              activeFolderName={activeSessionLayoutFolderName}
              activePresetName={activeSessionLayoutPresetName}
              selectedPresetNames={selectedSessionLayoutPresetNames}
              draggingFolderName={draggingSessionLayoutFolderName}
              draggingPresetName={draggingSessionLayoutPresetName}
              folderRenameTarget={sessionLayoutFolderRenameTarget}
              folderRenameDraft={sessionLayoutFolderRenameDraft}
              presetRenameTarget={sessionLayoutRenameTargetName}
              presetRenameDraft={sessionLayoutRenameDraftName}
              presetRenameError={sessionLayoutRenameError}
              canReorderFolders={canReorderSessionLayoutFolders}
              canReorderPresets={canReorderSessionLayoutPresets}
              filteredEmpty={sessionLayoutFilteredEmpty}
              filteredEmptyLabel={sessionLayoutFilteredEmptyLabel}
              searchActive={sessionLayoutSearchActive}
              searchQuery={sessionLayoutSearchQuery}
              folderFilterActive={sessionLayoutFolderFilterActive}
              folderFilter={sessionLayoutFolderFilter}
              folderKeyboardLiveText={sessionLayoutFolderKeyboardLiveText}
              reorderKeyboardLiveText={sessionLayoutReorderKeyboardLiveText}
              reorderFocusLiveText={sessionLayoutReorderFocusLiveText}
              folderDisabledReason={sessionLayoutFolderReorderDisabledReason}
              presetDisabledReason={sessionLayoutPresetReorderDisabledReason}
              actions={{
                onListKeyDown: handleSessionLayoutFolderKeyDown,
                onSetActiveFolder: setActiveSessionLayoutFolderName,
                onSetDraggingFolder: setDraggingSessionLayoutFolderName,
                onDropFolder: handleDropSessionLayoutFolder,
                onFolderReorderKeyDown: handleSessionLayoutFolderReorderHandleKeyDown,
                onMoveFolder: handleMoveSessionLayoutFolderOrder,
                onToggleFolder: handleToggleSessionLayoutFolder,
                onFolderRenameDraftChange: setSessionLayoutFolderRenameDraft,
                onSaveFolderRename: handleSaveRenamedSessionLayoutFolder,
                onCancelFolderRename: handleCancelRenameSessionLayoutFolder,
                onSelectFolderPresets: handleSelectSessionLayoutFolderPresets,
                onStartFolderRename: handleStartRenameSessionLayoutFolder,
                onSetDraggingPreset: setDraggingSessionLayoutPresetName,
                onDropPreset: handleDropSessionLayoutPreset,
                onPresetReorderKeyDown: handleSessionLayoutPresetReorderHandleKeyDown,
                onMovePreset: handleMoveSessionLayoutPresetOrder,
                onPresetRenameDraftChange: setSessionLayoutRenameDraftName,
                onClearPresetRenameError: () => setSessionLayoutRenameError(''),
                onPresetRenameKeyDown: handleSessionLayoutRenameKeyDown,
                onSavePresetRename: handleSaveRenamedSessionLayoutPreset,
                onCancelPresetRename: handleCancelRenameSessionLayoutPreset,
                onTogglePresetSelection: handleToggleSessionLayoutPresetSelection,
                onApplyPreset: handleApplySessionLayoutPreset,
                onUpdatePresetFolder: handleUpdateSessionLayoutPresetFolder,
                onStartPresetRename: handleStartRenameSessionLayoutPreset,
                onDuplicatePreset: handleDuplicateSessionLayoutPreset,
                onDeletePreset: handleDeleteSessionLayoutPreset,
              }}
            />
          </div>

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
