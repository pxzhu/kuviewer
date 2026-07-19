import { type DragEvent as ReactDragEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, Bookmark, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Copy, Download, Filter, Folder, GripVertical, KeyRound, Pencil, Play, Search, ServerCog, ShieldCheck, Square, Star, Trash2, Unplug, Upload, XCircle } from 'lucide-react';
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
  maxDesktopCmSessionGroupNameLength,
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
import {
  desktopCmSessionLayoutReorderHistoryDensityOptions,
  desktopCmSessionLayoutReorderHistoryFilterPresetIds,
  desktopCmSessionLayoutReorderHistoryFilterPresets,
  desktopCmSessionLayoutReorderHistoryFilterPresetShortcuts,
  desktopCmSessionLayoutReorderHistoryScopeFilterOptions,
  desktopCmSessionLayoutReorderHistoryStatusFilterOptions,
  formatDesktopCmSessionLayoutReorderHistoryAge,
  formatDesktopCmSessionLayoutReorderHistoryExactTime,
  formatDesktopCmSessionLayoutReorderHistoryIsoTime,
  formatDesktopCmSessionLayoutReorderHistoryScopeLabel,
  isDesktopCmKeyboardIgnoredTarget,
  matchesDesktopCmSessionLayoutReorderHistoryScope,
  matchesDesktopCmSessionLayoutReorderHistoryStatus,
  maxDesktopCmSessionLayoutReorderHistoryEntries,
  slugifyDesktopCmTestId,
  type DesktopCmSessionLayoutReorderHistoryDensity,
  type DesktopCmSessionLayoutReorderHistoryEntry,
  type DesktopCmSessionLayoutReorderHistoryFilterPreset,
  type DesktopCmSessionLayoutReorderHistoryScopeFilter,
  type DesktopCmSessionLayoutReorderHistoryStatusFilter,
} from '../features/desktop/desktopCmReorderHistory';
import {
  buildDesktopCmSessionLayoutDuplicateName,
  buildDesktopCmSessionLayoutFolderFilterOptions,
  buildDesktopCmSessionLayoutFolders,
  buildDesktopCmSessionLayoutImportName,
  defaultDesktopCmSessionLayoutFolder,
  desktopCmSessionLayoutEqual,
  desktopCmSessionLayoutFolderOrder,
  downloadDesktopCmSessionLayoutBundle,
  formatDesktopCmSessionLayoutSummary,
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
  DesktopCmDiagnostics,
} from './desktopCm/DesktopCmSessionPrimitives';
import {
  buildDesktopCmSessionCloneName,
  formatCmSessionError,
  formatCmDiagnosticSeverity,
  formatCmDiagnosticStage,
  formatCmSessionCheckStatus,
  formatRuntimeHealthStatus,
  normalizeSearchValue,
  validateDesktopCmSessionForm,
} from '../features/desktop/desktopCmSessionPresentation';
import { DesktopCmSessionSummary } from './desktopCm/DesktopCmSessionSummary';

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

interface DesktopCmSessionLayoutImportConflict {
  name: string;
  current: DesktopCmSessionLayoutPreset;
  incoming: DesktopCmSessionLayoutPreset;
}

interface DesktopCmSessionLayoutImportConflictPreview {
  fileName: string;
  imported: number;
  updated: number;
  skipped: number;
  invalid: number;
  initialConflictCount: number;
  incomingResolved: number;
  currentResolved: number;
  renamedResolved: number;
  conflicts: DesktopCmSessionLayoutImportConflict[];
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
  const [sessionLayoutReorderHistory, setSessionLayoutReorderHistory] = useState<DesktopCmSessionLayoutReorderHistoryEntry[]>(() => []);
  const [sessionLayoutReorderHistoryScopeFilter, setSessionLayoutReorderHistoryScopeFilter] =
    useState<DesktopCmSessionLayoutReorderHistoryScopeFilter>('all');
  const [sessionLayoutReorderHistoryStatusFilter, setSessionLayoutReorderHistoryStatusFilter] =
    useState<DesktopCmSessionLayoutReorderHistoryStatusFilter>('all');
  const [sessionLayoutReorderHistoryNow, setSessionLayoutReorderHistoryNow] = useState(() => Date.now());
  const [sessionLayoutReorderHistoryDensity, setSessionLayoutReorderHistoryDensity] =
    useState<DesktopCmSessionLayoutReorderHistoryDensity>('comfortable');
  const [sessionLayoutReorderHistoryFilterPresetFocusId, setSessionLayoutReorderHistoryFilterPresetFocusId] = useState(
    desktopCmSessionLayoutReorderHistoryFilterPresetIds[0] || '',
  );
  const [sessionLayoutReorderHistoryFilterPresetKeyboardMessage, setSessionLayoutReorderHistoryFilterPresetKeyboardMessage] = useState('');
  const [sessionLayoutReorderHistoryFilterPresetHelpFocusVisible, setSessionLayoutReorderHistoryFilterPresetHelpFocusVisible] = useState(false);
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
  const [activeSessionLayoutConflictName, setActiveSessionLayoutConflictName] = useState('');
  const [cloneDraftSourceName, setCloneDraftSourceName] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const sessionLayoutImportInputRef = useRef<HTMLInputElement | null>(null);
  const sessionLayoutConflictPreviewRef = useRef<HTMLDivElement | null>(null);
  const sessionLayoutFolderListRef = useRef<HTMLDivElement | null>(null);
  const sessionLayoutReorderHistorySequenceRef = useRef(0);
  const sessionLayoutReorderHistoryFilterPresetButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
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
  const sessionLayoutConflictSummary = useMemo(() => {
    if (!sessionLayoutImportConflicts) {
      return null;
    }
    const total = sessionLayoutImportConflicts.initialConflictCount;
    const remaining = sessionLayoutImportConflicts.conflicts.length;
    return {
      total,
      remaining,
      resolved: Math.max(0, total - remaining),
      imported: sessionLayoutImportConflicts.imported,
      updated: sessionLayoutImportConflicts.updated,
      skipped: sessionLayoutImportConflicts.skipped,
      invalid: sessionLayoutImportConflicts.invalid,
      incomingResolved: sessionLayoutImportConflicts.incomingResolved,
      currentResolved: sessionLayoutImportConflicts.currentResolved,
      renamedResolved: sessionLayoutImportConflicts.renamedResolved,
    };
  }, [sessionLayoutImportConflicts]);
  const sessionLayoutConflictNames = useMemo(() => sessionLayoutImportConflicts?.conflicts.map((conflict) => conflict.name) ?? [], [sessionLayoutImportConflicts]);
  const sessionLayoutConflictPreviewFocusKey = sessionLayoutImportConflicts
    ? `${sessionLayoutImportConflicts.fileName}:${sessionLayoutImportConflicts.initialConflictCount}:${sessionLayoutImportConflicts.invalid}`
    : '';
  const sessionLayoutConflictTitleId = 'desktop-cm-session-layout-conflict-title';
  const sessionLayoutConflictDescriptionId = 'desktop-cm-session-layout-conflict-description';
  const sessionLayoutConflictLiveStatusId = 'desktop-cm-session-layout-conflict-live-status';
  const sessionLayoutConflictLiveText = sessionLayoutConflictSummary
    ? `Layout conflicts: ${sessionLayoutConflictSummary.resolved} of ${sessionLayoutConflictSummary.total} resolved, ${sessionLayoutConflictSummary.remaining} remaining. Incoming ${sessionLayoutConflictSummary.incomingResolved}, keep current ${sessionLayoutConflictSummary.currentResolved}, rename ${sessionLayoutConflictSummary.renamedResolved}.`
    : '';
  const sessionLayoutFolderListTitleId = 'desktop-cm-session-layout-folder-list-title';
  const sessionLayoutFolderKeyboardDescriptionId = 'desktop-cm-session-layout-folder-keyboard-description';
  const sessionLayoutFolderKeyboardLiveStatusId = 'desktop-cm-session-layout-folder-keyboard-live-status';
  const sessionLayoutReorderKeyboardDescriptionId = 'desktop-cm-session-layout-reorder-keyboard-description';
  const sessionLayoutReorderKeyboardStatusId = 'desktop-cm-session-layout-reorder-keyboard-status';
  const sessionLayoutReorderDisabledDescriptionId = 'desktop-cm-session-layout-reorder-disabled-description';
  const sessionLayoutReorderDisabledReasonId = 'desktop-cm-session-layout-reorder-disabled-reason';
  const sessionLayoutReorderFocusDescriptionId = 'desktop-cm-session-layout-reorder-focus-description';
  const sessionLayoutReorderFocusStatusId = 'desktop-cm-session-layout-reorder-focus-status';
  const sessionLayoutReorderHistoryTitleId = 'desktop-cm-session-layout-reorder-history-title';
  const sessionLayoutReorderHistoryDescriptionId = 'desktop-cm-session-layout-reorder-history-description';
  const sessionLayoutReorderHistorySummaryId = 'desktop-cm-session-layout-reorder-history-accessibility-summary';
  const sessionLayoutReorderHistoryFilterPresetDescriptionId = 'desktop-cm-session-layout-reorder-history-filter-preset-description';
  const sessionLayoutReorderHistoryFilterPresetSummaryId = 'desktop-cm-session-layout-reorder-history-filter-preset-summary';
  const sessionLayoutReorderHistoryFilterPresetKeyboardDescriptionId = 'desktop-cm-session-layout-reorder-history-filter-preset-keyboard-description';
  const sessionLayoutReorderHistoryFilterPresetKeyboardStatusId = 'desktop-cm-session-layout-reorder-history-filter-preset-keyboard-status';
  const sessionLayoutReorderHistoryFilterPresetShortcutHintId = 'desktop-cm-session-layout-reorder-history-filter-preset-shortcut-hint';
  const sessionLayoutReorderHistoryFilterPresetDiscoverabilityHintId = 'desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint';
  const sessionLayoutReorderHistoryFilterPresetHelpTooltipId = 'desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip';
  const sessionLayoutReorderHistoryFilterPresetHelpTooltipContrastDescriptionId =
    'desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip-contrast-description';
  const sessionLayoutReorderHistoryFilterPresetHelpTooltipFocusVisibleDescriptionId =
    'desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip-focus-visible-description';
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
  const sessionLayoutReorderHistoryFiltersActive = sessionLayoutReorderHistoryScopeFilter !== 'all' || sessionLayoutReorderHistoryStatusFilter !== 'all';
  const visibleSessionLayoutReorderHistory = useMemo(
    () =>
      sessionLayoutReorderHistory.filter(
        (entry) =>
          matchesDesktopCmSessionLayoutReorderHistoryScope(entry, sessionLayoutReorderHistoryScopeFilter) &&
          matchesDesktopCmSessionLayoutReorderHistoryStatus(entry, sessionLayoutReorderHistoryStatusFilter),
      ),
    [sessionLayoutReorderHistory, sessionLayoutReorderHistoryScopeFilter, sessionLayoutReorderHistoryStatusFilter],
  );
  const sessionLayoutReorderHistoryLatestMessage =
    visibleSessionLayoutReorderHistory[0]?.message ||
    (sessionLayoutReorderHistoryFiltersActive ? 'No matching reorder status history.' : 'No reorder status history yet.');
  const sessionLayoutReorderHistoryLatestAge = visibleSessionLayoutReorderHistory[0]
    ? formatDesktopCmSessionLayoutReorderHistoryAge(visibleSessionLayoutReorderHistory[0].createdAt, sessionLayoutReorderHistoryNow)
    : '';
  const sessionLayoutReorderHistoryAccessibilitySummary = visibleSessionLayoutReorderHistory[0]
    ? `Showing ${visibleSessionLayoutReorderHistory.length} of ${sessionLayoutReorderHistory.length} saved layout reorder status history entries, newest first. Latest ${formatDesktopCmSessionLayoutReorderHistoryScopeLabel(visibleSessionLayoutReorderHistory[0].scope)} entry recorded ${sessionLayoutReorderHistoryLatestAge}.`
    : sessionLayoutReorderHistoryFiltersActive
      ? `No saved layout reorder status history entries match the current filters. ${sessionLayoutReorderHistory.length} total entries remain in memory.`
      : 'No saved layout reorder status history entries are currently available.';
  const activeSessionLayoutFolder = groupedSessionLayoutPresets.find((folder) => folder.folder === activeSessionLayoutFolderName);
  const activeSessionLayoutFolderIndex = sessionLayoutFolderNames.findIndex((folderName) => folderName === activeSessionLayoutFolderName);
  const sessionLayoutFolderKeyboardLiveText = activeSessionLayoutFolder
    ? `Layout folder ${activeSessionLayoutFolder.folder} active, ${activeSessionLayoutFolder.presets.length} visible presets, ${activeSessionLayoutFolder.totalCount} total presets, ${activeSessionLayoutFolder.collapsed ? 'collapsed' : 'expanded'}, ${activeSessionLayoutFolderIndex + 1} of ${sessionLayoutFolderNames.length}.`
    : `${sessionLayoutFolderNames.length} layout folders available.`;
  const connectionPreview = `${form.user || 'user'}@${form.host || 'host'}:${form.port || 22} -> ${form.remoteApiHost || desktopCmDefaultRemoteApiHost}:${form.remoteApiPort || desktopCmDefaultRemoteApiPort}`;
  const selectedRuntimeActive = Boolean(selectedSession && runtimeProfile?.sessionId === selectedSession.id);
  const selectedRuntimeStatus = selectedRuntimeActive ? runtimeProfile?.status || selectedSession?.runtimeStatus || 'runtime-active' : selectedSession?.runtimeStatus || 'stopped';

  const appendSessionLayoutReorderHistory = (messageText: string, scope: DesktopCmSessionLayoutReorderHistoryEntry['scope']) => {
    const messageValue = messageText.trim();
    if (!messageValue) {
      return;
    }
    const now = Date.now();
    sessionLayoutReorderHistorySequenceRef.current += 1;
    const entry: DesktopCmSessionLayoutReorderHistoryEntry = {
      id: `${now}-${sessionLayoutReorderHistorySequenceRef.current}`,
      scope,
      message: messageValue,
      createdAt: now,
    };
    setSessionLayoutReorderHistoryNow(now);
    setSessionLayoutReorderHistory((current) => [entry, ...current].slice(0, maxDesktopCmSessionLayoutReorderHistoryEntries));
  };

  const applySessionLayoutReorderHistoryFilterPreset = (preset: DesktopCmSessionLayoutReorderHistoryFilterPreset) => {
    setSessionLayoutReorderHistoryFilterPresetFocusId(preset.id);
    setSessionLayoutReorderHistoryFilterPresetKeyboardMessage(`Applied ${preset.label} reorder history preset.`);
    setSessionLayoutReorderHistoryScopeFilter(preset.scope);
    setSessionLayoutReorderHistoryStatusFilter(preset.status);
    setSessionLayoutReorderHistoryDensity(preset.density);
  };

  const announceSessionLayoutReorderStatus = (messageText: string, scope: DesktopCmSessionLayoutReorderHistoryEntry['scope']) => {
    setSessionLayoutReorderKeyboardMessage(messageText);
    appendSessionLayoutReorderHistory(messageText, scope);
  };

  useEffect(() => {
    if (form.id && !sessions.some((session) => session.id === form.id)) {
      setForm(emptyForm);
      setCloneDraftSourceName('');
    }
  }, [form.id, sessions]);

  useEffect(() => {
    if (sessionLayoutReorderHistory.length === 0) {
      return undefined;
    }
    const timer = window.setInterval(() => setSessionLayoutReorderHistoryNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [sessionLayoutReorderHistory.length]);

  useEffect(() => {
    if (!sessionLayoutImportConflicts) {
      if (activeSessionLayoutConflictName) {
        setActiveSessionLayoutConflictName('');
      }
      return;
    }
    if (
      activeSessionLayoutConflictName &&
      !sessionLayoutImportConflicts.conflicts.some((conflict) => conflict.name.toLowerCase() === activeSessionLayoutConflictName.toLowerCase())
    ) {
      setActiveSessionLayoutConflictName(sessionLayoutImportConflicts.conflicts[0]?.name || '');
    }
  }, [activeSessionLayoutConflictName, sessionLayoutImportConflicts]);

  useEffect(() => {
    if (!sessionLayoutConflictPreviewFocusKey) {
      return;
    }
    window.requestAnimationFrame(() => {
      sessionLayoutConflictPreviewRef.current?.focus({ preventScroll: true });
    });
  }, [sessionLayoutConflictPreviewFocusKey]);

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
      appendSessionLayoutReorderHistory(focusStatusMessage, 'focus');
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
  const sessionLayoutReorderHistoryScopeLabel = (scope: DesktopCmSessionLayoutReorderHistoryEntry['scope']) =>
    formatDesktopCmSessionLayoutReorderHistoryScopeLabel(scope);
  const sessionLayoutReorderHistoryScopeFilterLabel = (scope: DesktopCmSessionLayoutReorderHistoryScopeFilter) =>
    scope === 'all' ? 'All scopes' : sessionLayoutReorderHistoryScopeLabel(scope);
  const sessionLayoutReorderHistoryStatusFilterLabel = (status: DesktopCmSessionLayoutReorderHistoryStatusFilter) =>
    status === 'all'
      ? 'All statuses'
      : status === 'reorder-complete'
        ? 'Reorder complete'
        : status === 'reorder-unavailable'
          ? 'Reorder unavailable'
          : status === 'reorder-unchanged'
            ? 'Reorder unchanged'
            : status === 'focus-restored'
            ? 'Focus restored'
            : 'Focus unavailable';
  const sessionLayoutReorderHistoryDensityLabel = (density: DesktopCmSessionLayoutReorderHistoryDensity) =>
    density === 'compact' ? 'Compact' : 'Comfortable';
  const sessionLayoutReorderHistoryExactTimeLabel = (createdAt: number) => formatDesktopCmSessionLayoutReorderHistoryExactTime(createdAt);
  const sessionLayoutReorderHistoryIsoTimeLabel = (createdAt: number) => formatDesktopCmSessionLayoutReorderHistoryIsoTime(createdAt);
  const sessionLayoutReorderHistoryAgeLabel = (createdAt: number) =>
    formatDesktopCmSessionLayoutReorderHistoryAge(createdAt, sessionLayoutReorderHistoryNow);
  const sessionLayoutReorderHistoryTimeLabel = (createdAt: number) =>
    new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const sessionLayoutReorderHistoryCompact = sessionLayoutReorderHistoryDensity === 'compact';
  const activeSessionLayoutReorderHistoryFilterPreset = desktopCmSessionLayoutReorderHistoryFilterPresets.find(
    (preset) =>
      preset.scope === sessionLayoutReorderHistoryScopeFilter &&
      preset.status === sessionLayoutReorderHistoryStatusFilter &&
      preset.density === sessionLayoutReorderHistoryDensity,
  );
  const sessionLayoutReorderHistoryFilterPresetSummary = activeSessionLayoutReorderHistoryFilterPreset
    ? `Active reorder history preset ${activeSessionLayoutReorderHistoryFilterPreset.label}: ${sessionLayoutReorderHistoryScopeFilterLabel(activeSessionLayoutReorderHistoryFilterPreset.scope)}, ${sessionLayoutReorderHistoryStatusFilterLabel(activeSessionLayoutReorderHistoryFilterPreset.status)}, ${sessionLayoutReorderHistoryDensityLabel(activeSessionLayoutReorderHistoryFilterPreset.density)} density.`
    : `No reorder history preset is active. Current filters are ${sessionLayoutReorderHistoryScopeFilterLabel(sessionLayoutReorderHistoryScopeFilter)}, ${sessionLayoutReorderHistoryStatusFilterLabel(sessionLayoutReorderHistoryStatusFilter)}, ${sessionLayoutReorderHistoryDensityLabel(sessionLayoutReorderHistoryDensity)} density.`;
  const sessionLayoutReorderHistoryFilterPresetTabStopId = desktopCmSessionLayoutReorderHistoryFilterPresetIds.includes(
    sessionLayoutReorderHistoryFilterPresetFocusId,
  )
    ? sessionLayoutReorderHistoryFilterPresetFocusId
    : activeSessionLayoutReorderHistoryFilterPreset?.id || desktopCmSessionLayoutReorderHistoryFilterPresetIds[0] || '';
  const sessionLayoutReorderHistoryFilterPresetKeyboardStatus =
    sessionLayoutReorderHistoryFilterPresetKeyboardMessage || 'Reorder history filter preset keyboard focus is ready.';
  const sessionLayoutReorderHistoryFilterPresetShortcutHint =
    'Shortcut hint: Arrow keys move across reorder history presets, Home and End jump to the ends, and Enter or Space applies the focused preset.';
  const sessionLayoutReorderHistoryFilterPresetDiscoverabilityHint =
    activeSessionLayoutReorderHistoryFilterPreset
      ? `Preset help for ${activeSessionLayoutReorderHistoryFilterPreset.label}: arrow keys move between presets, Home and End jump, Enter or Space applies, and this help button focuses the active preset. This hint is UI-only.`
      : 'Preset help: arrow keys move between presets, Home and End jump, Enter or Space applies, and this help button focuses the first preset. This hint is UI-only.';
  const sessionLayoutReorderHistoryFilterPresetHelpTooltip =
    activeSessionLayoutReorderHistoryFilterPreset
      ? `Tooltip: ${activeSessionLayoutReorderHistoryFilterPreset.label} is active. Hover or focus this help button to review shortcuts; Enter or Space moves focus to the active preset. UI-only and not stored.`
      : 'Tooltip: no preset currently matches. Hover or focus this help button to review shortcuts; Enter or Space moves focus to the first preset. UI-only and not stored.';
  const sessionLayoutReorderHistoryFilterPresetHelpTooltipContrastDescription =
    'Contrast note: tooltip text and surface keep at least 7:1 contrast. This contrast note is UI-only and not stored.';
  const sessionLayoutReorderHistoryFilterPresetHelpTooltipFocusVisibleDescription =
    'Focus-visible note: keyboard focus shows a high-contrast outline, ring, and offset around this help button. This focus-visible note is UI-only and not stored.';
  const sessionLayoutReorderHistoryFilterPresetHelpFocusVisibleStyle = sessionLayoutReorderHistoryFilterPresetHelpFocusVisible
    ? {
        backgroundColor: '#f8fcff',
        borderColor: '#0f4f68',
        boxShadow: '0 0 0 2px #8bd3f7, 0 0 0 4px rgba(139, 211, 247, 0.34)',
        color: '#0f4f68',
        transform: 'scale(1.04)',
      }
    : undefined;
  const sessionLayoutReorderHistoryFilterPresetHelpVisualRegressionState = sessionLayoutReorderHistoryFilterPresetHelpFocusVisible
    ? 'focus-visible'
    : 'idle';
  const sessionLayoutReorderHistoryFilterPresetLabel = (preset: DesktopCmSessionLayoutReorderHistoryFilterPreset, index: number, total: number) =>
    `Apply ${preset.label} reorder history preset, ${index + 1} of ${total}: ${sessionLayoutReorderHistoryScopeFilterLabel(preset.scope)}, ${sessionLayoutReorderHistoryStatusFilterLabel(preset.status)}, ${sessionLayoutReorderHistoryDensityLabel(preset.density)} density. Arrow keys move between presets, Home and End jump, Enter or Space applies.`;
  const sessionLayoutReorderHistoryFilterPresetTitle = (preset: DesktopCmSessionLayoutReorderHistoryFilterPreset, index: number, total: number) =>
    `${sessionLayoutReorderHistoryFilterPresetLabel(preset, index, total)} Shortcuts: Arrow keys, Home, End, Enter, Space.`;
  const focusSessionLayoutReorderHistoryFilterPreset = (preset: DesktopCmSessionLayoutReorderHistoryFilterPreset) => {
    const presetIndex = desktopCmSessionLayoutReorderHistoryFilterPresets.findIndex((candidate) => candidate.id === preset.id);
    setSessionLayoutReorderHistoryFilterPresetFocusId(preset.id);
    setSessionLayoutReorderHistoryFilterPresetKeyboardMessage(
      `Focus ${preset.label} reorder history preset, ${presetIndex + 1} of ${desktopCmSessionLayoutReorderHistoryFilterPresets.length}. Press Enter or Space to apply.`,
    );
    window.requestAnimationFrame(() => sessionLayoutReorderHistoryFilterPresetButtonRefs.current[preset.id]?.focus({ preventScroll: true }));
  };
  const focusSessionLayoutReorderHistoryFilterPresetHelpTarget = () => {
    const targetPreset = activeSessionLayoutReorderHistoryFilterPreset || desktopCmSessionLayoutReorderHistoryFilterPresets[0];
    if (!targetPreset) {
      return;
    }
    focusSessionLayoutReorderHistoryFilterPreset(targetPreset);
  };
  const handleSessionLayoutReorderHistoryFilterPresetKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    preset: DesktopCmSessionLayoutReorderHistoryFilterPreset,
  ) => {
    const currentIndex = desktopCmSessionLayoutReorderHistoryFilterPresets.findIndex((candidate) => candidate.id === preset.id);
    if (currentIndex < 0) {
      return;
    }
    const presetCount = desktopCmSessionLayoutReorderHistoryFilterPresets.length;
    const targetIndex =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (currentIndex + 1) % presetCount
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (currentIndex - 1 + presetCount) % presetCount
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? presetCount - 1
              : -1;
    if (targetIndex < 0) {
      return;
    }
    event.preventDefault();
    focusSessionLayoutReorderHistoryFilterPreset(desktopCmSessionLayoutReorderHistoryFilterPresets[targetIndex]);
  };
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
      announceSessionLayoutReorderStatus(sessionLayoutReorderUnavailableReason || 'Reorder unavailable: layout folder order cannot change now.', 'folder');
      return;
    }
    const folderOrder = desktopCmSessionLayoutFolderOrder(sessionLayoutPresets);
    const currentIndex = folderOrder.indexOf(folder);
    const targetIndex =
      direction === 'first' ? 0 : direction === 'last' ? folderOrder.length - 1 : currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= folderOrder.length) {
      announceSessionLayoutReorderStatus(
        sessionLayoutReorderUnchangedMessage(folder || 'layout folder', `cannot move ${direction === -1 || direction === 'first' ? 'up' : 'down'}`),
        'folder',
      );
      return;
    }
    if (currentIndex === targetIndex) {
      announceSessionLayoutReorderStatus(
        sessionLayoutReorderUnchangedMessage(`${folder} folder`, `is already ${direction === 'first' || direction === -1 ? 'first' : 'last'}`),
        'folder',
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
    announceSessionLayoutReorderStatus(sessionLayoutFolderReorderSuccessMessage(folder, direction, targetIndex, folderOrder.length), 'folder');
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
    announceSessionLayoutReorderStatus(`Reorder complete: ${sourceFolder} folder moved before ${targetFolder}.`, 'folder');
    requestSessionLayoutReorderFocus(sessionLayoutFolderDragHandleTestId(sourceFolder), `${sourceFolder} layout folder drag handle`);
    setDraggingSessionLayoutFolderName('');
  };

  const handleMoveSessionLayoutPresetOrder = (presetName: string, direction: -1 | 1 | 'first' | 'last') => {
    if (!canReorderSessionLayoutPresets) {
      announceSessionLayoutReorderStatus(sessionLayoutReorderUnavailableReason || 'Reorder unavailable: layout preset order cannot change now.', 'preset');
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
        'preset',
      );
      return;
    }
    if (currentIndex === targetIndex) {
      announceSessionLayoutReorderStatus(
        sessionLayoutReorderUnchangedMessage(`${presetName} layout`, `is already ${direction === 'first' || direction === -1 ? 'first' : 'last'} in ${folder}`),
        'preset',
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
    announceSessionLayoutReorderStatus(sessionLayoutPresetReorderSuccessMessage(presetName, folder, direction, targetIndex, folderPresets.length), 'preset');
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
    announceSessionLayoutReorderStatus(`Reorder complete: ${sourcePresetName} layout moved before ${targetPresetName}.`, 'preset');
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
    setActiveSessionLayoutConflictName('');
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
        setActiveSessionLayoutConflictName(conflicts[0].name);
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

  const handleResolveSessionLayoutImportConflicts = (mode: 'incoming' | 'current' | 'rename', conflictName?: string) => {
    if (!sessionLayoutImportConflicts) {
      return;
    }
    const targetName = conflictName?.toLowerCase();
    const selectedConflicts = targetName ? sessionLayoutImportConflicts.conflicts.filter((conflict) => conflict.name.toLowerCase() === targetName) : sessionLayoutImportConflicts.conflicts;
    if (selectedConflicts.length === 0) {
      return;
    }
    const selectedConflictNames = new Set(selectedConflicts.map((conflict) => conflict.name.toLowerCase()));
    const firstSelectedConflictIndex = sessionLayoutImportConflicts.conflicts.findIndex((conflict) => selectedConflictNames.has(conflict.name.toLowerCase()));
    const remainingConflicts = sessionLayoutImportConflicts.conflicts.filter((conflict) => !selectedConflictNames.has(conflict.name.toLowerCase()));
    const nextActiveConflictName = remainingConflicts[Math.min(Math.max(firstSelectedConflictIndex, 0), Math.max(remainingConflicts.length - 1, 0))]?.name || '';
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
      setActiveSessionLayoutConflictName(nextActiveConflictName);
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
      setActiveSessionLayoutConflictName('');
      setSessionLayoutImportConflicts(null);
    }
  };

  const handleMoveActiveSessionLayoutConflict = (direction: 'previous' | 'next' | 'first' | 'last') => {
    if (sessionLayoutConflictNames.length === 0) {
      return;
    }
    const activeIndex = sessionLayoutConflictNames.findIndex((name) => name.toLowerCase() === activeSessionLayoutConflictName.toLowerCase());
    if (direction === 'first') {
      setActiveSessionLayoutConflictName(sessionLayoutConflictNames[0]);
      return;
    }
    if (direction === 'last') {
      setActiveSessionLayoutConflictName(sessionLayoutConflictNames[sessionLayoutConflictNames.length - 1]);
      return;
    }
    if (activeIndex < 0) {
      setActiveSessionLayoutConflictName(direction === 'previous' ? sessionLayoutConflictNames[sessionLayoutConflictNames.length - 1] : sessionLayoutConflictNames[0]);
      return;
    }
    const nextIndex =
      direction === 'previous'
        ? Math.max(0, activeIndex - 1)
        : Math.min(sessionLayoutConflictNames.length - 1, activeIndex + 1);
    setActiveSessionLayoutConflictName(sessionLayoutConflictNames[nextIndex]);
  };

  const handleResolveActiveSessionLayoutConflict = (mode: 'incoming' | 'current' | 'rename') => {
    if (!activeSessionLayoutConflictName) {
      return;
    }
    handleResolveSessionLayoutImportConflicts(mode, activeSessionLayoutConflictName);
  };

  const handleSessionLayoutConflictKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!sessionLayoutImportConflicts || isDesktopCmKeyboardIgnoredTarget(event.target)) {
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      handleMoveActiveSessionLayoutConflict('previous');
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      handleMoveActiveSessionLayoutConflict('next');
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      handleMoveActiveSessionLayoutConflict('first');
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      handleMoveActiveSessionLayoutConflict('last');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      handleResolveActiveSessionLayoutConflict('incoming');
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (activeSessionLayoutConflictName) {
        setActiveSessionLayoutConflictName('');
      } else {
        sessionLayoutConflictPreviewRef.current?.blur();
      }
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'k') {
      event.preventDefault();
      handleResolveActiveSessionLayoutConflict('current');
    } else if (key === 'r') {
      event.preventDefault();
      handleResolveActiveSessionLayoutConflict('rename');
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
                id={sessionLayoutReorderDisabledReasonId}
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
            {sessionLayoutReorderHistory.length > 0 ? (
              <div
                aria-describedby={`${sessionLayoutReorderHistoryDescriptionId} ${sessionLayoutReorderHistorySummaryId}`}
                aria-labelledby={sessionLayoutReorderHistoryTitleId}
                className="grid min-w-0 gap-2 overflow-hidden rounded-[10px] border border-[rgba(60,60,67,0.1)] bg-white/58 px-2 py-2 sm:px-3"
                data-density={sessionLayoutReorderHistoryDensity}
                data-testid="desktop-cm-session-layout-reorder-history"
                role="region"
              >
                <p className="sr-only" data-testid="desktop-cm-session-layout-reorder-history-description" id={sessionLayoutReorderHistoryDescriptionId}>
                  Saved layout reorder status history is newest first and uses safe UI status metadata only. Each entry includes scope, message, relative age, and exact local timestamp.
                </p>
                <p
                  aria-atomic="true"
                  aria-live="polite"
                  className="sr-only"
                  data-testid="desktop-cm-session-layout-reorder-history-accessibility-summary"
                  id={sessionLayoutReorderHistorySummaryId}
                  role="status"
                >
                  {sessionLayoutReorderHistoryAccessibilitySummary}
                </p>
                <div className="flex min-w-0 flex-wrap items-stretch gap-2 sm:items-center" data-testid="desktop-cm-session-layout-reorder-history-toolbar">
                  <span
                    className="ku-chip max-w-full justify-center text-center"
                    data-testid="desktop-cm-session-layout-reorder-history-count"
                    id={sessionLayoutReorderHistoryTitleId}
                  >
                    최근 reorder status {visibleSessionLayoutReorderHistory.length} / 전체 {sessionLayoutReorderHistory.length}
                  </span>
                  <span
                    className="order-last min-w-0 flex-[1_1_100%] break-words text-xs font-semibold text-[rgba(60,60,67,0.62)] sm:order-none sm:flex-1 sm:truncate"
                    data-testid="desktop-cm-session-layout-reorder-history-latest"
                  >
                    {sessionLayoutReorderHistoryLatestMessage}
                  </span>
                  {visibleSessionLayoutReorderHistory[0] ? (
                    <span
                      className="ku-chip h-7 shrink-0 text-[11px]"
                      data-testid="desktop-cm-session-layout-reorder-history-latest-age"
                      title={sessionLayoutReorderHistoryExactTimeLabel(visibleSessionLayoutReorderHistory[0].createdAt)}
                    >
                      {sessionLayoutReorderHistoryLatestAge}
                    </span>
                  ) : null}
                  <label className="min-w-0 flex-1 basis-full sm:min-w-[138px] sm:basis-[138px]">
                    <span className="ku-meta">Scope</span>
                    <select
                      className="ku-field mt-1 h-8 w-full text-xs"
                      data-testid="desktop-cm-session-layout-reorder-history-scope-filter"
                      value={sessionLayoutReorderHistoryScopeFilter}
                      onChange={(event) => setSessionLayoutReorderHistoryScopeFilter(event.target.value as DesktopCmSessionLayoutReorderHistoryScopeFilter)}
                    >
                      {desktopCmSessionLayoutReorderHistoryScopeFilterOptions.map((option) => (
                        <option key={option} value={option}>
                          {sessionLayoutReorderHistoryScopeFilterLabel(option)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-0 flex-1 basis-full sm:min-w-[158px] sm:basis-[158px]">
                    <span className="ku-meta">Status</span>
                    <select
                      className="ku-field mt-1 h-8 w-full text-xs"
                      data-testid="desktop-cm-session-layout-reorder-history-status-filter"
                      value={sessionLayoutReorderHistoryStatusFilter}
                      onChange={(event) => setSessionLayoutReorderHistoryStatusFilter(event.target.value as DesktopCmSessionLayoutReorderHistoryStatusFilter)}
                    >
                      {desktopCmSessionLayoutReorderHistoryStatusFilterOptions.map((option) => (
                        <option key={option} value={option}>
                          {sessionLayoutReorderHistoryStatusFilterLabel(option)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div
                    aria-label="Reorder history timestamp density"
                    className="flex min-w-0 flex-1 basis-full rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white/60 p-1 sm:flex-none sm:basis-auto"
                    data-testid="desktop-cm-session-layout-reorder-history-density"
                    role="group"
                  >
                    {desktopCmSessionLayoutReorderHistoryDensityOptions.map((density) => (
                      <button
                        key={density}
                        aria-pressed={sessionLayoutReorderHistoryDensity === density}
                        className={`h-7 flex-1 rounded-[6px] px-2 text-xs font-semibold transition sm:flex-none ${
                          sessionLayoutReorderHistoryDensity === density
                            ? 'bg-[rgba(42,111,151,0.14)] text-[rgba(23,68,93,0.92)]'
                            : 'text-[rgba(60,60,67,0.58)] hover:bg-white/70'
                        }`}
                        data-testid={`desktop-cm-session-layout-reorder-history-density-${density}`}
                        type="button"
                        onClick={() => setSessionLayoutReorderHistoryDensity(density)}
                      >
                        {sessionLayoutReorderHistoryDensityLabel(density)}
                      </button>
                    ))}
                  </div>
                  <div
                    aria-describedby={`${sessionLayoutReorderHistoryFilterPresetDescriptionId} ${sessionLayoutReorderHistoryFilterPresetKeyboardDescriptionId} ${sessionLayoutReorderHistoryFilterPresetShortcutHintId} ${sessionLayoutReorderHistoryFilterPresetDiscoverabilityHintId} ${sessionLayoutReorderHistoryFilterPresetHelpTooltipId} ${sessionLayoutReorderHistoryFilterPresetHelpTooltipContrastDescriptionId} ${sessionLayoutReorderHistoryFilterPresetHelpTooltipFocusVisibleDescriptionId} ${sessionLayoutReorderHistoryFilterPresetSummaryId} ${sessionLayoutReorderHistoryFilterPresetKeyboardStatusId}`}
                    aria-label="Reorder history filter presets"
                    className="flex min-w-0 flex-1 basis-full flex-wrap gap-1 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white/55 p-1 sm:flex-none sm:basis-auto"
                    data-testid="desktop-cm-session-layout-reorder-history-filter-presets"
                    role="group"
                  >
                    <p
                      className="sr-only"
                      data-testid="desktop-cm-session-layout-reorder-history-filter-preset-description"
                      id={sessionLayoutReorderHistoryFilterPresetDescriptionId}
                    >
                      Reorder history filter presets apply safe scope, status, and density settings together. Preset state stays in browser memory only and is not stored or exported.
                    </p>
                    <p
                      className="sr-only"
                      data-testid="desktop-cm-session-layout-reorder-history-filter-preset-keyboard-description"
                      id={sessionLayoutReorderHistoryFilterPresetKeyboardDescriptionId}
                    >
                      Use arrow keys, Home, and End to move across reorder history filter presets. Press Enter or Space to apply the focused preset.
                    </p>
                    <p
                      className="sr-only"
                      data-testid="desktop-cm-session-layout-reorder-history-filter-preset-shortcut-hint"
                      id={sessionLayoutReorderHistoryFilterPresetShortcutHintId}
                    >
                      {sessionLayoutReorderHistoryFilterPresetShortcutHint}
                    </p>
                    <p
                      className="sr-only"
                      data-testid="desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip-contrast-description"
                      id={sessionLayoutReorderHistoryFilterPresetHelpTooltipContrastDescriptionId}
                    >
                      {sessionLayoutReorderHistoryFilterPresetHelpTooltipContrastDescription}
                    </p>
                    <p
                      className="sr-only"
                      data-testid="desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip-focus-visible-description"
                      id={sessionLayoutReorderHistoryFilterPresetHelpTooltipFocusVisibleDescriptionId}
                    >
                      {sessionLayoutReorderHistoryFilterPresetHelpTooltipFocusVisibleDescription}
                    </p>
                    <span className="group relative inline-flex shrink-0">
                      <button
                        aria-describedby={`${sessionLayoutReorderHistoryFilterPresetHelpTooltipId} ${sessionLayoutReorderHistoryFilterPresetHelpTooltipContrastDescriptionId} ${sessionLayoutReorderHistoryFilterPresetHelpTooltipFocusVisibleDescriptionId}`}
                        aria-label={sessionLayoutReorderHistoryFilterPresetDiscoverabilityHint}
                        aria-keyshortcuts="Enter Space"
                        className="ku-focus-visible-solid-highlight inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-[rgba(42,111,151,0.16)] bg-[rgba(255,255,255,0.76)] text-[rgba(42,111,151,0.82)] transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4f68] focus-visible:ring-2 focus-visible:ring-[#8bd3f7] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f8fcff]"
                        data-focus-visible="high-safe-ring"
                        data-focus-visible-visual="solid-highlight"
                        data-testid="desktop-cm-session-layout-reorder-history-filter-preset-discoverability-hint"
                        data-visual-regression="desktop-cm-session-layout-reorder-history-filter-preset-help-focus-visible"
                        data-visual-regression-state={sessionLayoutReorderHistoryFilterPresetHelpVisualRegressionState}
                        data-visual-regression-token="solid-highlight-v1"
                        id={sessionLayoutReorderHistoryFilterPresetDiscoverabilityHintId}
                        style={sessionLayoutReorderHistoryFilterPresetHelpFocusVisibleStyle}
                        title={sessionLayoutReorderHistoryFilterPresetDiscoverabilityHint}
                        type="button"
                        onBlur={() => setSessionLayoutReorderHistoryFilterPresetHelpFocusVisible(false)}
                        onFocus={() => {
                          setSessionLayoutReorderHistoryFilterPresetHelpFocusVisible(true);
                          setSessionLayoutReorderHistoryFilterPresetKeyboardMessage(
                            'Preset help focused. Press Enter or Space to focus the active reorder history preset.',
                          );
                        }}
                        onClick={focusSessionLayoutReorderHistoryFilterPresetHelpTarget}
                      >
                        <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">{sessionLayoutReorderHistoryFilterPresetDiscoverabilityHint}</span>
                      </button>
                      <span
                        className="pointer-events-none absolute left-0 top-[calc(100%+0.45rem)] z-30 hidden w-64 max-w-[calc(100vw-2rem)] rounded-[6px] border border-[#2a6f97] bg-[#f8fcff] px-2.5 py-2 text-[0.68rem] leading-snug text-[#102a3a] shadow-[0_12px_30px_rgba(16,42,58,0.22)] before:absolute before:-top-[5px] before:left-3 before:h-2.5 before:w-2.5 before:rotate-45 before:border-l before:border-t before:border-[#2a6f97] before:bg-[#f8fcff] group-focus-within:block group-hover:block sm:left-auto sm:right-0 sm:translate-x-0 sm:before:left-auto sm:before:right-3"
                        data-contrast="high-safe"
                        data-contrast-min-ratio="7"
                        data-testid="desktop-cm-session-layout-reorder-history-filter-preset-help-tooltip"
                        data-placement="bottom-inline-safe"
                        id={sessionLayoutReorderHistoryFilterPresetHelpTooltipId}
                        role="tooltip"
                      >
                        {sessionLayoutReorderHistoryFilterPresetHelpTooltip}
                      </span>
                    </span>
                    <p
                      aria-atomic="true"
                      aria-live="polite"
                      className="sr-only"
                      data-testid="desktop-cm-session-layout-reorder-history-filter-preset-summary"
                      id={sessionLayoutReorderHistoryFilterPresetSummaryId}
                      role="status"
                    >
                      {sessionLayoutReorderHistoryFilterPresetSummary}
                    </p>
                    <p
                      aria-atomic="true"
                      aria-live="polite"
                      className="sr-only"
                      data-testid="desktop-cm-session-layout-reorder-history-filter-preset-keyboard-status"
                      id={sessionLayoutReorderHistoryFilterPresetKeyboardStatusId}
                      role="status"
                    >
                      {sessionLayoutReorderHistoryFilterPresetKeyboardStatus}
                    </p>
                    {desktopCmSessionLayoutReorderHistoryFilterPresets.map((preset, index) => {
                      const active = activeSessionLayoutReorderHistoryFilterPreset?.id === preset.id;
                      return (
                        <button
                          key={preset.id}
                          ref={(element) => {
                            sessionLayoutReorderHistoryFilterPresetButtonRefs.current[preset.id] = element;
                          }}
                          aria-label={sessionLayoutReorderHistoryFilterPresetLabel(preset, index, desktopCmSessionLayoutReorderHistoryFilterPresets.length)}
                          aria-pressed={active}
                          aria-keyshortcuts={desktopCmSessionLayoutReorderHistoryFilterPresetShortcuts}
                          className={`h-7 flex-1 rounded-[6px] px-2 text-xs font-semibold transition sm:flex-none ${
                            active ? 'bg-[rgba(42,111,151,0.14)] text-[rgba(23,68,93,0.92)]' : 'text-[rgba(60,60,67,0.58)] hover:bg-white/70'
                          }`}
                          data-testid={`desktop-cm-session-layout-reorder-history-filter-preset-${preset.id}`}
                          tabIndex={sessionLayoutReorderHistoryFilterPresetTabStopId === preset.id ? 0 : -1}
                          title={sessionLayoutReorderHistoryFilterPresetTitle(preset, index, desktopCmSessionLayoutReorderHistoryFilterPresets.length)}
                          type="button"
                          onFocus={() => setSessionLayoutReorderHistoryFilterPresetFocusId(preset.id)}
                          onKeyDown={(event) => handleSessionLayoutReorderHistoryFilterPresetKeyDown(event, preset)}
                          onClick={() => applySessionLayoutReorderHistoryFilterPreset(preset)}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    className="ku-control h-8 flex-1 basis-[calc(50%-0.25rem)] justify-center text-xs sm:flex-none sm:basis-auto"
                    data-testid="desktop-cm-session-layout-reorder-history-filter-clear"
                    type="button"
                    disabled={!sessionLayoutReorderHistoryFiltersActive}
                    onClick={() => {
                      setSessionLayoutReorderHistoryScopeFilter('all');
                      setSessionLayoutReorderHistoryStatusFilter('all');
                    }}
                  >
                    <Filter size={13} aria-hidden="true" />
                    filter clear
                  </button>
                  <button
                    className="ku-control h-8 flex-1 basis-[calc(50%-0.25rem)] justify-center text-xs sm:flex-none sm:basis-auto"
                    data-testid="desktop-cm-session-layout-reorder-history-clear"
                    type="button"
                    onClick={() => {
                      setSessionLayoutReorderHistory([]);
                      setSessionLayoutReorderHistoryScopeFilter('all');
                      setSessionLayoutReorderHistoryStatusFilter('all');
                    }}
                  >
                    <XCircle size={13} aria-hidden="true" />
                    history clear
                  </button>
                </div>
                {visibleSessionLayoutReorderHistory.length > 0 ? (
                  <ol
                    aria-describedby={sessionLayoutReorderHistorySummaryId}
                    aria-label="Saved layout reorder status history entries, newest first"
                    className={sessionLayoutReorderHistoryCompact ? 'grid gap-0.5' : 'grid gap-1'}
                    data-testid="desktop-cm-session-layout-reorder-history-list"
                  >
                    {visibleSessionLayoutReorderHistory.map((entry) => (
                    <li
                      key={entry.id}
                      aria-label={`${sessionLayoutReorderHistoryScopeLabel(entry.scope)} reorder status: ${entry.message} Recorded ${sessionLayoutReorderHistoryExactTimeLabel(entry.createdAt)} (${sessionLayoutReorderHistoryAgeLabel(entry.createdAt)}).`}
                      className={`grid min-w-0 rounded-[8px] border border-[rgba(60,60,67,0.08)] bg-white/70 font-semibold text-[rgba(60,60,67,0.68)] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center ${
                        sessionLayoutReorderHistoryCompact ? 'gap-0.5 px-1.5 py-0.5 text-[11px]' : 'gap-1 px-2 py-1 text-xs'
                      }`}
                      data-testid={`desktop-cm-session-layout-reorder-history-item-${entry.scope}`}
                    >
                      <span className={`ku-chip max-w-full justify-center text-[11px] sm:w-auto ${sessionLayoutReorderHistoryCompact ? 'h-5' : 'h-6'}`}>
                        {sessionLayoutReorderHistoryScopeLabel(entry.scope)}
                      </span>
                      <span className="min-w-0 break-words sm:truncate" data-testid="desktop-cm-session-layout-reorder-history-message">
                        {entry.message}
                      </span>
                      <span className={`flex min-w-0 flex-wrap items-center sm:justify-end ${sessionLayoutReorderHistoryCompact ? 'gap-0.5' : 'gap-1'}`} data-testid="desktop-cm-session-layout-reorder-history-meta">
                        <span className={`ku-chip shrink-0 text-[11px] ${sessionLayoutReorderHistoryCompact ? 'h-5' : 'h-6'}`} data-testid="desktop-cm-session-layout-reorder-history-age">
                          {sessionLayoutReorderHistoryAgeLabel(entry.createdAt)}
                        </span>
                        <time
                          aria-label={`Recorded ${sessionLayoutReorderHistoryExactTimeLabel(entry.createdAt)} (${sessionLayoutReorderHistoryAgeLabel(entry.createdAt)})`}
                          className={`min-w-0 break-all font-mono text-[rgba(60,60,67,0.48)] ${sessionLayoutReorderHistoryCompact ? 'text-[10px]' : 'text-[11px]'}`}
                          data-testid="desktop-cm-session-layout-reorder-history-time"
                          dateTime={sessionLayoutReorderHistoryIsoTimeLabel(entry.createdAt)}
                          title={sessionLayoutReorderHistoryExactTimeLabel(entry.createdAt)}
                        >
                          {sessionLayoutReorderHistoryTimeLabel(entry.createdAt)}
                        </time>
                      </span>
                    </li>
                    ))}
                  </ol>
                ) : (
                  <div
                    className="rounded-[8px] border border-dashed border-[rgba(60,60,67,0.12)] bg-white/54 px-2 py-2 text-xs font-semibold text-[rgba(60,60,67,0.58)]"
                    data-testid="desktop-cm-session-layout-reorder-history-empty"
                  >
                    필터와 일치하는 reorder status history 없음
                  </div>
                )}
              </div>
            ) : null}
            {sessionLayoutImportConflicts ? (
              <div
                ref={sessionLayoutConflictPreviewRef}
                aria-describedby={`${sessionLayoutConflictDescriptionId} ${sessionLayoutConflictLiveStatusId}`}
                aria-labelledby={sessionLayoutConflictTitleId}
                className="grid gap-2 rounded-[10px] border border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,149,0,0.28)]"
                data-testid="desktop-cm-session-layout-conflict-preview"
                onKeyDown={handleSessionLayoutConflictKeyDown}
                role="group"
                tabIndex={0}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className="ku-chip border-[rgba(255,149,0,0.24)] bg-white/65 text-[#9a5a00]"
                    data-testid="desktop-cm-session-layout-conflict-title"
                    id={sessionLayoutConflictTitleId}
                  >
                    layout conflict preview · {sessionLayoutImportConflicts.fileName} · {sessionLayoutImportConflicts.conflicts.length} conflict
                    {sessionLayoutImportConflicts.conflicts.length === 1 ? '' : 's'}
                  </span>
                  <button
                    aria-label="Use incoming layout for all remaining layout conflicts"
                    className="ku-control h-8 text-xs"
                    data-testid="desktop-cm-session-layout-conflict-use-incoming"
                    type="button"
                    onClick={() => handleResolveSessionLayoutImportConflicts('incoming')}
                  >
                    incoming 우선
                  </button>
                  <button
                    aria-label="Keep current layout for all remaining layout conflicts"
                    className="ku-control h-8 text-xs"
                    data-testid="desktop-cm-session-layout-conflict-keep-current"
                    type="button"
                    onClick={() => handleResolveSessionLayoutImportConflicts('current')}
                  >
                    현재 유지
                  </button>
                  <button
                    aria-label="Rename incoming layout for all remaining layout conflicts"
                    className="ku-control h-8 text-xs"
                    data-testid="desktop-cm-session-layout-conflict-rename-incoming"
                    type="button"
                    onClick={() => handleResolveSessionLayoutImportConflicts('rename')}
                  >
                    이름 바꿔 둘 다 보관
                  </button>
                </div>
                <p className="sr-only" data-testid="desktop-cm-session-layout-conflict-description" id={sessionLayoutConflictDescriptionId}>
                  Same-name layout conflicts are kept in browser memory until explicitly resolved. Use arrow keys, Home, End, Enter, K, R, and Escape when this preview has focus.
                </p>
                <p aria-live="polite" className="sr-only" data-testid="desktop-cm-session-layout-conflict-live-status" id={sessionLayoutConflictLiveStatusId}>
                  {sessionLayoutConflictLiveText}
                </p>
                {sessionLayoutConflictSummary ? (
                  <div
                    className="grid gap-1 rounded-[8px] border border-[rgba(255,149,0,0.16)] bg-white/58 px-2 py-2 text-xs font-semibold text-[rgba(60,60,67,0.68)]"
                    data-testid="desktop-cm-session-layout-conflict-summary"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <span className="ku-chip border-[rgba(255,149,0,0.18)] bg-white/65 text-[#9a5a00]" data-testid="desktop-cm-session-layout-conflict-summary-progress">
                        충돌 {sessionLayoutConflictSummary.total}개 중 {sessionLayoutConflictSummary.resolved}개 해결
                      </span>
                      <span className="ku-chip" data-testid="desktop-cm-session-layout-conflict-summary-remaining">
                        남은 {sessionLayoutConflictSummary.remaining}개
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[11px]" data-testid="desktop-cm-session-layout-conflict-summary-resolutions">
                      <span>incoming 반영 {sessionLayoutConflictSummary.incomingResolved}</span>
                      <span>현재 유지 {sessionLayoutConflictSummary.currentResolved}</span>
                      <span>rename {sessionLayoutConflictSummary.renamedResolved}</span>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[11px]" data-testid="desktop-cm-session-layout-conflict-summary-import">
                      <span>new {sessionLayoutConflictSummary.imported}</span>
                      <span>updated {sessionLayoutConflictSummary.updated}</span>
                      <span>skipped {sessionLayoutConflictSummary.skipped}</span>
                      <span>invalid {sessionLayoutConflictSummary.invalid}</span>
                    </div>
                  </div>
                ) : null}
                <div aria-label="Layout import conflicts" className="grid gap-1" role="list">
                  {sessionLayoutImportConflicts.conflicts.map((conflict) => {
                    const active = activeSessionLayoutConflictName.toLowerCase() === conflict.name.toLowerCase();
                    const conflictSlug = slugifyDesktopCmTestId(conflict.name);
                    const currentSummary = formatDesktopCmSessionLayoutSummary(conflict.current.viewPreferences);
                    const incomingSummary = formatDesktopCmSessionLayoutSummary(conflict.incoming.viewPreferences);
                    return (
                      <div
                        key={conflict.name}
                        aria-label={`${conflict.name}. Current layout ${currentSummary}. Incoming layout ${incomingSummary}.${active ? ' Active conflict row.' : ''}`}
                        aria-current={active ? 'true' : undefined}
                        className={`grid gap-1 rounded-[8px] border px-2 py-1 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition ${
                          active
                            ? 'border-[rgba(255,149,0,0.42)] bg-white/86 shadow-[0_0_0_2px_rgba(255,149,0,0.14)]'
                            : 'border-[rgba(60,60,67,0.08)] bg-white/64'
                        }`}
                        data-testid={`desktop-cm-session-layout-conflict-${conflictSlug}`}
                        id={`desktop-cm-session-layout-conflict-row-${conflictSlug}`}
                        onClick={() => setActiveSessionLayoutConflictName(conflict.name)}
                        role="listitem"
                      >
                        <span className="truncate text-[rgba(60,60,67,0.86)]">{conflict.name}</span>
                        <span className="font-mono">현재 · {currentSummary}</span>
                        <span className="font-mono">incoming · {incomingSummary}</span>
                        <span className="flex min-w-0 flex-wrap items-center gap-1">
                          <button
                            aria-label={`Use incoming layout for ${conflict.name}`}
                            className="ku-control h-7 text-[11px]"
                            data-testid={`desktop-cm-session-layout-conflict-row-use-incoming-${conflictSlug}`}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveSessionLayoutConflictName(conflict.name);
                              handleResolveSessionLayoutImportConflicts('incoming', conflict.name);
                            }}
                          >
                            incoming
                          </button>
                          <button
                            aria-label={`Keep current layout for ${conflict.name}`}
                            className="ku-control h-7 text-[11px]"
                            data-testid={`desktop-cm-session-layout-conflict-row-keep-current-${conflictSlug}`}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveSessionLayoutConflictName(conflict.name);
                              handleResolveSessionLayoutImportConflicts('current', conflict.name);
                            }}
                          >
                            현재 유지
                          </button>
                          <button
                            aria-label={`Rename incoming layout for ${conflict.name}`}
                            className="ku-control h-7 text-[11px]"
                            data-testid={`desktop-cm-session-layout-conflict-row-rename-incoming-${conflictSlug}`}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveSessionLayoutConflictName(conflict.name);
                              handleResolveSessionLayoutImportConflicts('rename', conflict.name);
                            }}
                          >
                            rename
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs font-semibold text-[rgba(60,60,67,0.58)]">
                  same-name layout은 선택 전까지 덮어쓰지 않음 · conflict preview는 브라우저 메모리에만 유지
                </p>
              </div>
            ) : null}
            {sessionLayoutPresets.length > 0 ? (
              <>
                <p className="sr-only" data-testid="desktop-cm-session-layout-folder-list-title" id={sessionLayoutFolderListTitleId}>
                  Saved session layout folders
                </p>
                <p className="sr-only" data-testid="desktop-cm-session-layout-folder-keyboard-description" id={sessionLayoutFolderKeyboardDescriptionId}>
                  Saved layout folder keyboard state is browser memory only. Use arrow keys, Home, End, Enter, S, R, and Escape when this folder list has focus. Shift plus arrow keys, Home, or End reorders the active folder when search and folder filters are clear.
                </p>
                <p className="sr-only" data-testid="desktop-cm-session-layout-reorder-keyboard-description" id={sessionLayoutReorderKeyboardDescriptionId}>
                  Reorder keyboard state is browser memory only. Focus a folder or layout drag handle and use ArrowUp, ArrowDown, Home, or End to reorder without adding saved fields.
                </p>
                <p className="sr-only" data-testid="desktop-cm-session-layout-reorder-disabled-description" id={sessionLayoutReorderDisabledDescriptionId}>
                  Disabled reorder controls explain whether search, folder filter, item edge position, or not enough folders and presets prevents reordering.
                </p>
                <p className="sr-only" data-testid="desktop-cm-session-layout-reorder-focus-description" id={sessionLayoutReorderFocusDescriptionId}>
                  After a layout folder or preset reorder, focus returns to the moved drag handle or the saved layout folder list without scrolling the panel.
                </p>
                <p aria-atomic="true" aria-live="polite" className="sr-only" data-testid="desktop-cm-session-layout-folder-keyboard-live-status" id={sessionLayoutFolderKeyboardLiveStatusId} role="status">
                  {sessionLayoutFolderKeyboardLiveText}
                </p>
                <p aria-atomic="true" aria-live="polite" className="sr-only" data-testid="desktop-cm-session-layout-reorder-keyboard-status" id={sessionLayoutReorderKeyboardStatusId} role="status">
                  {sessionLayoutReorderKeyboardLiveText}
                </p>
                <p aria-atomic="true" aria-live="polite" className="sr-only" data-testid="desktop-cm-session-layout-reorder-focus-status" id={sessionLayoutReorderFocusStatusId} role="status">
                  {sessionLayoutReorderFocusLiveText}
                </p>
                <div
                  ref={sessionLayoutFolderListRef}
                  aria-activedescendant={
                    activeSessionLayoutFolder ? `desktop-cm-session-layout-folder-row-${slugifyDesktopCmTestId(activeSessionLayoutFolder.folder)}` : undefined
                  }
                  aria-describedby={`${sessionLayoutFolderKeyboardDescriptionId} ${sessionLayoutReorderKeyboardDescriptionId} ${sessionLayoutReorderDisabledDescriptionId} ${sessionLayoutReorderDisabledReasonId} ${sessionLayoutReorderFocusDescriptionId} ${sessionLayoutFolderKeyboardLiveStatusId} ${sessionLayoutReorderKeyboardStatusId} ${sessionLayoutReorderFocusStatusId}`}
                  aria-keyshortcuts="ArrowUp ArrowDown Home End Enter S R Escape Shift+ArrowUp Shift+ArrowDown Shift+Home Shift+End"
                  aria-labelledby={sessionLayoutFolderListTitleId}
                  className="grid min-w-0 gap-2 outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,122,255,0.22)]"
                  data-testid="desktop-cm-session-layout-list"
                  onKeyDown={handleSessionLayoutFolderKeyDown}
                  role="list"
                  tabIndex={0}
                >
                {groupedSessionLayoutPresets.map((folder, folderIndex) => {
                  const folderActive = activeSessionLayoutFolderName === folder.folder;
                  const folderRowId = `desktop-cm-session-layout-folder-row-${folder.slug}`;
                  const folderTitleId = `desktop-cm-session-layout-folder-title-${folder.slug}`;
                  const folderCountId = `desktop-cm-session-layout-folder-a11y-count-${folder.slug}`;
                  const folderActionsId = `desktop-cm-session-layout-folder-actions-${folder.slug}`;
                  const folderItemsId = `desktop-cm-session-layout-folder-items-${folder.slug}`;
                  const canMoveFolderUp = canReorderSessionLayoutFolders && folderIndex > 0;
                  const canMoveFolderDown = canReorderSessionLayoutFolders && folderIndex < groupedSessionLayoutPresets.length - 1;
                  const folderDragDisabledReason = sessionLayoutFolderReorderDisabledReason(folder.folder);
                  const folderMoveUpDisabledReason = sessionLayoutFolderReorderDisabledReason(folder.folder, 'up');
                  const folderMoveDownDisabledReason = sessionLayoutFolderReorderDisabledReason(folder.folder, 'down');
                  return (
                  <div
                    key={folder.folder}
                    aria-current={folderActive ? 'true' : undefined}
                    aria-describedby={`${folderCountId} ${folderActionsId}`}
                    aria-labelledby={folderTitleId}
                    className={`grid gap-2 rounded-[8px] border px-2 py-2 transition ${draggingSessionLayoutFolderName === folder.folder ? 'opacity-60' : ''} ${
                      folderActive
                        ? 'border-[rgba(0,122,255,0.34)] bg-white/82 shadow-[0_0_0_2px_rgba(0,122,255,0.1)]'
                        : 'border-[rgba(60,60,67,0.08)] bg-white/56'
                    }`}
                    data-testid={`desktop-cm-session-layout-folder-${folder.slug}`}
                    id={folderRowId}
                    onClick={() => setActiveSessionLayoutFolderName(folder.folder)}
                    onDragOver={(event) => {
                      if (canReorderSessionLayoutFolders) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => handleDropSessionLayoutFolder(folder.folder, event)}
                    role="listitem"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <button
                        aria-label={`${folder.folder} layout folder 순서 드래그`}
                        aria-describedby={`${sessionLayoutReorderKeyboardDescriptionId} ${sessionLayoutReorderDisabledDescriptionId} ${sessionLayoutReorderDisabledReasonId} ${sessionLayoutReorderFocusDescriptionId} ${sessionLayoutReorderFocusStatusId} ${folderActionsId}`}
                        aria-keyshortcuts="ArrowUp ArrowDown Home End"
                        className="ku-control h-8 text-xs"
                        data-testid={`desktop-cm-session-layout-folder-drag-handle-${folder.slug}`}
                        disabled={!canReorderSessionLayoutFolders}
                        draggable={canReorderSessionLayoutFolders}
                        title={canReorderSessionLayoutFolders ? 'Drag to reorder layout folder' : folderDragDisabledReason}
                        type="button"
                        onDragStart={(event) => {
                          if (!canReorderSessionLayoutFolders) {
                            event.preventDefault();
                            return;
                          }
                          setDraggingSessionLayoutFolderName(folder.folder);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('application/x-kuviewer-layout-folder', folder.folder);
                          event.dataTransfer.setData('text/plain', folder.folder);
                        }}
                        onDragEnd={() => setDraggingSessionLayoutFolderName('')}
                        onKeyDown={(event) => handleSessionLayoutFolderReorderHandleKeyDown(folder.folder, event)}
                      >
                        <GripVertical size={13} aria-hidden="true" />
                      </button>
                      <button
                        aria-label={`${folder.folder} layout folder 위로 이동`}
                        aria-describedby={`${sessionLayoutReorderDisabledDescriptionId} ${sessionLayoutReorderDisabledReasonId}`}
                        className="ku-control h-8 text-xs"
                        data-testid={`desktop-cm-session-layout-folder-reorder-up-${folder.slug}`}
                        disabled={!canMoveFolderUp}
                        title={canMoveFolderUp ? `${folder.folder} layout folder move up` : folderMoveUpDisabledReason}
                        type="button"
                        onClick={() => handleMoveSessionLayoutFolderOrder(folder.folder, -1)}
                      >
                        <ArrowUp size={13} aria-hidden="true" />
                      </button>
                      <button
                        aria-label={`${folder.folder} layout folder 아래로 이동`}
                        aria-describedby={`${sessionLayoutReorderDisabledDescriptionId} ${sessionLayoutReorderDisabledReasonId}`}
                        className="ku-control h-8 text-xs"
                        data-testid={`desktop-cm-session-layout-folder-reorder-down-${folder.slug}`}
                        disabled={!canMoveFolderDown}
                        title={canMoveFolderDown ? `${folder.folder} layout folder move down` : folderMoveDownDisabledReason}
                        type="button"
                        onClick={() => handleMoveSessionLayoutFolderOrder(folder.folder, 1)}
                      >
                        <ArrowDown size={13} aria-hidden="true" />
                      </button>
                      <button
                        aria-controls={folderItemsId}
                        aria-expanded={!folder.collapsed}
                        aria-label={`${folder.folder} layout folder ${folder.collapsed ? 'expand' : 'collapse'}`}
                        className="ku-control h-8 text-xs"
                        data-testid={`desktop-cm-session-layout-folder-toggle-${folder.slug}`}
                        type="button"
                        onClick={() => handleToggleSessionLayoutFolder(folder.folder)}
                      >
                        {folder.collapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                        <Folder size={13} aria-hidden="true" />
                        <span className="truncate" id={folderTitleId}>{folder.folder}</span>
                      </button>
                      <span className="ku-chip" data-testid={`desktop-cm-session-layout-folder-count-${folder.slug}`} id={folderCountId}>
                        {folder.presets.length} / {folder.totalCount}
                      </span>
                      <span className="sr-only" data-testid={`desktop-cm-session-layout-folder-actions-${folder.slug}`} id={folderActionsId}>
                        {folder.folder} has {folder.presets.length} visible presets and {folder.totalCount} total presets. Keyboard actions can toggle, select visible presets, rename this folder, or reorder with Shift plus arrow keys. Reorder controls are UI-only and use saved layout preset array order.
                      </span>
                      {sessionLayoutFolderRenameTarget === folder.folder ? (
                        <span
                          aria-label={`Rename ${folder.folder} layout folder`}
                          className="flex min-w-[220px] flex-1 flex-wrap items-center gap-1"
                          data-testid={`desktop-cm-session-layout-folder-rename-editor-${folder.slug}`}
                          role="group"
                        >
                          <input
                            aria-label={`New name for ${folder.folder} layout folder`}
                            className="ku-field h-8 min-w-[150px] flex-1 px-2 py-1 text-xs"
                            data-testid={`desktop-cm-session-layout-folder-rename-input-${folder.slug}`}
                            maxLength={maxDesktopCmSessionLayoutFolderNameLength}
                            value={sessionLayoutFolderRenameDraft}
                            onChange={(event) => setSessionLayoutFolderRenameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                handleSaveRenamedSessionLayoutFolder();
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                handleCancelRenameSessionLayoutFolder();
                              }
                            }}
                          />
                          <button
                            aria-label={`Save ${folder.folder} layout folder name`}
                            className="ku-control h-8 text-xs"
                            data-testid={`desktop-cm-session-layout-folder-rename-save-${folder.slug}`}
                            type="button"
                            onClick={handleSaveRenamedSessionLayoutFolder}
                          >
                            <CheckCircle2 size={13} aria-hidden="true" />
                            저장
                          </button>
                          <button
                            aria-label={`Cancel ${folder.folder} layout folder rename`}
                            className="ku-control h-8 text-xs"
                            data-testid={`desktop-cm-session-layout-folder-rename-cancel-${folder.slug}`}
                            type="button"
                            onClick={handleCancelRenameSessionLayoutFolder}
                          >
                            <XCircle size={13} aria-hidden="true" />
                            취소
                          </button>
                        </span>
                      ) : (
                        <>
                          <button
                            aria-label={`Select visible layouts in ${folder.folder}`}
                            className="ku-control h-8 text-xs"
                            data-testid={`desktop-cm-session-layout-folder-select-${folder.slug}`}
                            type="button"
                            disabled={folder.presets.length === 0}
                            onClick={() => handleSelectSessionLayoutFolderPresets(folder.folder)}
                          >
                            <CheckCircle2 size={13} aria-hidden="true" />
                            Folder 선택
                          </button>
                          <button
                            aria-label={`Rename ${folder.folder} layout folder`}
                            className="ku-control h-8 text-xs"
                            data-testid={`desktop-cm-session-layout-folder-rename-${folder.slug}`}
                            type="button"
                            onClick={() => handleStartRenameSessionLayoutFolder(folder.folder)}
                          >
                            <Pencil size={13} aria-hidden="true" />
                            Folder 이름
                          </button>
                        </>
                      )}
                    </div>
                    <div
                      aria-hidden={folder.collapsed}
                      className={`${folder.collapsed ? 'hidden' : 'flex'} min-w-0 flex-wrap items-center gap-2`}
                      data-testid={`desktop-cm-session-layout-folder-items-${folder.slug}`}
                      id={folderItemsId}
                    >
                        {folder.presets.length === 0 ? (
                          <span
                            className="flex min-w-0 items-center gap-2 rounded-[8px] border border-dashed border-[rgba(60,60,67,0.14)] bg-white/52 px-3 py-2 text-xs font-semibold text-[rgba(60,60,67,0.58)]"
                            data-testid={`desktop-cm-session-layout-folder-empty-${folder.slug}`}
                            role="status"
                          >
                            <Search size={13} aria-hidden="true" />
                            이 folder에 일치하는 saved layout 없음
                          </span>
                        ) : null}
                        {folder.presets.map((preset, presetIndex) => {
                          const active = preset.name === activeSessionLayoutPresetName;
                          const presetSlug = slugifyDesktopCmTestId(preset.name);
                          const renaming = sessionLayoutRenameTargetName.toLowerCase() === preset.name.toLowerCase();
                          const canReorderPresetInFolder = canReorderSessionLayoutPresets && folder.presets.length > 1;
                          const canMovePresetUp = canReorderPresetInFolder && presetIndex > 0;
                          const canMovePresetDown = canReorderPresetInFolder && presetIndex < folder.presets.length - 1;
                          const presetDragDisabledReason = sessionLayoutPresetReorderDisabledReason(preset.name, folder.folder);
                          const presetMoveUpDisabledReason = sessionLayoutPresetReorderDisabledReason(preset.name, folder.folder, 'up');
                          const presetMoveDownDisabledReason = sessionLayoutPresetReorderDisabledReason(preset.name, folder.folder, 'down');
                          return (
                            <span
                              key={preset.name}
                              className={`ku-chip max-w-full gap-1 ${draggingSessionLayoutPresetName === preset.name ? 'opacity-60' : ''} ${renaming ? 'items-stretch' : ''} ${active ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]' : ''}`}
                              data-testid={`desktop-cm-session-layout-${presetSlug}`}
                              onDragOver={(event) => {
                                if (canReorderPresetInFolder) {
                                  event.preventDefault();
                                }
                              }}
                              onDrop={(event) => handleDropSessionLayoutPreset(preset.name, event)}
                            >
                              {renaming ? (
                                <span className="flex min-w-0 flex-wrap items-center gap-1">
                                  <input
                                    className="ku-field h-7 min-w-[150px] flex-1 px-2 py-1 text-xs"
                                    data-testid={`desktop-cm-session-layout-rename-input-${presetSlug}`}
                                    maxLength={maxDesktopCmSessionLayoutPresetNameLength}
                                    value={sessionLayoutRenameDraftName}
                                    onChange={(event) => {
                                      setSessionLayoutRenameDraftName(event.target.value);
                                      setSessionLayoutRenameError('');
                                    }}
                                    onKeyDown={handleSessionLayoutRenameKeyDown}
                                  />
                                  <button
                                    className="rounded-full p-0.5 hover:bg-[rgba(60,60,67,0.08)]"
                                    data-testid={`desktop-cm-session-layout-rename-save-${presetSlug}`}
                                    type="button"
                                    title={`${preset.name} 이름 저장`}
                                    onClick={handleSaveRenamedSessionLayoutPreset}
                                  >
                                    <CheckCircle2 size={12} aria-hidden="true" />
                                  </button>
                                  <button
                                    className="rounded-full p-0.5 hover:bg-[rgba(60,60,67,0.08)]"
                                    data-testid={`desktop-cm-session-layout-rename-cancel-${presetSlug}`}
                                    type="button"
                                    title={`${preset.name} 이름 변경 취소`}
                                    onClick={handleCancelRenameSessionLayoutPreset}
                                  >
                                    <XCircle size={12} aria-hidden="true" />
                                  </button>
                                  {sessionLayoutRenameError ? (
                                    <span className="text-[10px] font-bold text-[#b42318]" data-testid="desktop-cm-session-layout-rename-error">
                                      {sessionLayoutRenameError}
                                    </span>
                                  ) : null}
                                </span>
                              ) : (
                                <>
                                  <button
                                    aria-label={`${preset.name} layout 순서 드래그`}
                                    aria-describedby={`${sessionLayoutReorderKeyboardDescriptionId} ${sessionLayoutReorderDisabledDescriptionId} ${sessionLayoutReorderDisabledReasonId} ${sessionLayoutReorderFocusDescriptionId} ${sessionLayoutReorderFocusStatusId}`}
                                    aria-keyshortcuts="ArrowUp ArrowDown Home End"
                                    className="rounded-full p-0.5 hover:bg-[rgba(60,60,67,0.08)] disabled:cursor-not-allowed disabled:opacity-45"
                                    data-testid={`desktop-cm-session-layout-drag-handle-${presetSlug}`}
                                    disabled={!canReorderPresetInFolder}
                                    draggable={canReorderPresetInFolder}
                                    title={canReorderPresetInFolder ? 'Drag to reorder layout preset' : presetDragDisabledReason}
                                    type="button"
                                    onDragStart={(event) => {
                                      if (!canReorderPresetInFolder) {
                                        event.preventDefault();
                                        return;
                                      }
                                      setDraggingSessionLayoutPresetName(preset.name);
                                      event.dataTransfer.effectAllowed = 'move';
                                      event.dataTransfer.setData('application/x-kuviewer-layout-preset', preset.name);
                                      event.dataTransfer.setData('text/plain', preset.name);
                                    }}
                                    onDragEnd={() => setDraggingSessionLayoutPresetName('')}
                                    onKeyDown={(event) => handleSessionLayoutPresetReorderHandleKeyDown(preset.name, event)}
                                  >
                                    <GripVertical size={12} aria-hidden="true" />
                                  </button>
                                  <button
                                    aria-label={`${preset.name} layout 위로 이동`}
                                    aria-describedby={`${sessionLayoutReorderDisabledDescriptionId} ${sessionLayoutReorderDisabledReasonId}`}
                                    className="rounded-full p-0.5 hover:bg-[rgba(60,60,67,0.08)] disabled:cursor-not-allowed disabled:opacity-45"
                                    data-testid={`desktop-cm-session-layout-reorder-up-${presetSlug}`}
                                    disabled={!canMovePresetUp}
                                    title={canMovePresetUp ? `${preset.name} layout move up` : presetMoveUpDisabledReason}
                                    type="button"
                                    onClick={() => handleMoveSessionLayoutPresetOrder(preset.name, -1)}
                                  >
                                    <ArrowUp size={12} aria-hidden="true" />
                                  </button>
                                  <button
                                    aria-label={`${preset.name} layout 아래로 이동`}
                                    aria-describedby={`${sessionLayoutReorderDisabledDescriptionId} ${sessionLayoutReorderDisabledReasonId}`}
                                    className="rounded-full p-0.5 hover:bg-[rgba(60,60,67,0.08)] disabled:cursor-not-allowed disabled:opacity-45"
                                    data-testid={`desktop-cm-session-layout-reorder-down-${presetSlug}`}
                                    disabled={!canMovePresetDown}
                                    title={canMovePresetDown ? `${preset.name} layout move down` : presetMoveDownDisabledReason}
                                    type="button"
                                    onClick={() => handleMoveSessionLayoutPresetOrder(preset.name, 1)}
                                  >
                                    <ArrowDown size={12} aria-hidden="true" />
                                  </button>
                                  <label className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold" data-testid={`desktop-cm-session-layout-bulk-select-${presetSlug}`}>
                                    <input
                                      className="h-3.5 w-3.5 accent-[#007aff]"
                                      data-testid={`desktop-cm-session-layout-bulk-select-input-${presetSlug}`}
                                      type="checkbox"
                                      checked={selectedSessionLayoutPresetNames.has(preset.name)}
                                      onChange={(event) => handleToggleSessionLayoutPresetSelection(preset.name, event.currentTarget.checked)}
                                    />
                                    선택
                                  </label>
                                  <button className="flex min-w-0 items-center gap-1 truncate" type="button" onClick={() => handleApplySessionLayoutPreset(preset)}>
                                    <Folder size={12} aria-hidden="true" />
                                    <span className="truncate">{preset.name}</span>
                                    <span className="truncate font-mono text-[10px]">{formatDesktopCmSessionLayoutSummary(preset.viewPreferences)}</span>
                                  </button>
                                  <input
                                    aria-label={`${preset.name} layout folder`}
                                    className="ku-field h-7 w-[104px] px-2 py-1 text-[11px]"
                                    data-testid={`desktop-cm-session-layout-folder-input-${presetSlug}`}
                                    defaultValue={preset.folder}
                                    key={`${preset.name}:${preset.folder}`}
                                    maxLength={maxDesktopCmSessionLayoutFolderNameLength}
                                    onBlur={(event) => handleUpdateSessionLayoutPresetFolder(preset.name, event.currentTarget.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault();
                                        handleUpdateSessionLayoutPresetFolder(preset.name, event.currentTarget.value);
                                        event.currentTarget.blur();
                                      }
                                    }}
                                  />
                                  <button
                                    className="ml-1 rounded-full p-0.5 hover:bg-[rgba(60,60,67,0.08)]"
                                    data-testid={`desktop-cm-session-layout-rename-${presetSlug}`}
                                    type="button"
                                    title={`${preset.name} 이름 변경`}
                                    onClick={() => handleStartRenameSessionLayoutPreset(preset)}
                                  >
                                    <Pencil size={12} aria-hidden="true" />
                                  </button>
                                  <button
                                    className="rounded-full p-0.5 hover:bg-[rgba(60,60,67,0.08)]"
                                    data-testid={`desktop-cm-session-layout-duplicate-${presetSlug}`}
                                    type="button"
                                    title={`${preset.name} 복제`}
                                    onClick={() => handleDuplicateSessionLayoutPreset(preset)}
                                  >
                                    <Copy size={12} aria-hidden="true" />
                                  </button>
                                  <button
                                    className="rounded-full p-0.5 hover:bg-[rgba(60,60,67,0.08)]"
                                    data-testid={`desktop-cm-session-layout-delete-${presetSlug}`}
                                    type="button"
                                    title={`${preset.name} 삭제`}
                                    onClick={() => handleDeleteSessionLayoutPreset(preset.name)}
                                  >
                                    <XCircle size={12} aria-hidden="true" />
                                  </button>
                                </>
                              )}
                            </span>
                          );
                        })}
                      </div>
                  </div>
                  );
                })}
                {sessionLayoutFilteredEmpty ? (
                  <div
                    className="flex min-w-0 flex-wrap items-center gap-2 rounded-[8px] border border-dashed border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.05)] px-3 py-2 text-xs font-semibold text-[rgba(60,60,67,0.68)]"
                    data-testid={sessionLayoutFolderFilterActive ? 'desktop-cm-session-layout-filter-empty' : 'desktop-cm-session-layout-search-empty'}
                    role="status"
                  >
                    <Filter size={13} aria-hidden="true" />
                    <span>{sessionLayoutFilteredEmptyLabel}</span>
                    <span className="font-mono text-[11px]">
                      search={sessionLayoutSearchActive ? sessionLayoutSearchQuery.trim() : 'all'} · folder={sessionLayoutFolderFilterActive ? sessionLayoutFolderFilter : 'all'}
                    </span>
                  </div>
                ) : null}
                </div>
              </>
            ) : (
              <div
                className="flex min-w-0 flex-wrap items-center gap-2 rounded-[8px] border border-dashed border-[rgba(60,60,67,0.14)] bg-white/52 px-3 py-2 text-xs font-semibold text-[rgba(60,60,67,0.62)]"
                data-testid="desktop-cm-session-layout-empty"
                role="status"
              >
                <Folder size={13} aria-hidden="true" />
                <span>저장된 session layout 없음</span>
                <span className="font-mono text-[11px]">현재 layout 저장 후 folder별로 표시됨</span>
              </div>
            )}
            <p className="text-xs font-semibold text-[rgba(60,60,67,0.58)]">
              folder, session id, group, favorite, collapsed group만 저장 · search/diagnostic/runtime/credential/export session metadata 제외
            </p>
          </div>

          {selectedBulkSessionIds.size > 0 ? (
            <div
              className="grid gap-2 rounded-[10px] border border-[rgba(0,122,255,0.16)] bg-[rgba(0,122,255,0.06)] px-3 py-2"
              data-testid="desktop-cm-session-bulk-toolbar"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="ku-chip border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]" data-testid="desktop-cm-session-bulk-count">
                  선택 {selectedBulkSessionIds.size}개 · 현재 결과 {selectedVisibleBulkCount}개
                </span>
                <button className="ku-control h-8 text-xs" data-testid="desktop-cm-session-bulk-export" type="button" onClick={handleExportSelectedSessions}>
                  <Download size={13} aria-hidden="true" />
                  선택 export
                </button>
                <button className="ku-control h-8 text-xs" data-testid="desktop-cm-session-bulk-favorite-on" type="button" onClick={() => handleSetSelectedFavorite(true)}>
                  <Star size={13} aria-hidden="true" />
                  즐겨찾기 설정
                </button>
                <button className="ku-control h-8 text-xs" data-testid="desktop-cm-session-bulk-favorite-off" type="button" onClick={() => handleSetSelectedFavorite(false)}>
                  <Star size={13} aria-hidden="true" />
                  즐겨찾기 해제
                </button>
                <button
                  className={`ku-control h-8 text-xs ${bulkDeleteConfirm ? 'border-[rgba(255,59,48,0.28)] bg-[rgba(255,59,48,0.1)] text-[#b42318]' : ''}`}
                  data-testid="desktop-cm-session-bulk-delete"
                  type="button"
                  disabled={busyAction === 'bulk-delete-sessions'}
                  onClick={() => void handleDeleteSelectedSessions()}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  {bulkDeleteConfirm ? '선택 삭제 확인' : '선택 삭제'}
                </button>
                <button className="ku-control h-8 text-xs" data-testid="desktop-cm-session-bulk-clear-toolbar" type="button" onClick={handleClearBulkSelection}>
                  <XCircle size={13} aria-hidden="true" />
                  선택 해제
                </button>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <label className="min-w-[180px] flex-1">
                  <span className="ku-meta">Bulk group</span>
                  <input
                    className="ku-field mt-1 h-8 w-full text-xs"
                    data-testid="desktop-cm-session-bulk-group-input"
                    maxLength={maxDesktopCmSessionGroupNameLength}
                    placeholder={defaultDesktopCmSessionGroup}
                    value={bulkGroupName}
                    onChange={(event) => setBulkGroupName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        handleMoveSelectedSessionsToGroup();
                      }
                    }}
                  />
                </label>
                <button className="ku-control h-8 self-end text-xs" data-testid="desktop-cm-session-bulk-group-apply" type="button" onClick={handleMoveSelectedSessionsToGroup}>
                  <Folder size={13} aria-hidden="true" />
                  Group 이동
                </button>
                <span className="text-xs font-semibold text-[rgba(60,60,67,0.58)]">
                  selection은 메모리 전용 · export/import/Tauri payload 제외
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {sessions.length > 0 ? (
        visibleSessions.length > 0 ? (
          <div className="grid gap-3" data-testid="desktop-cm-session-groups">
            {groupedSessions.map((group) => (
              <section
                key={group.group}
                className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.1)] bg-white/58 px-3 py-3"
                data-testid={`desktop-cm-session-group-${group.slug}`}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <label className="ku-control h-8 text-xs" data-testid={`desktop-cm-session-group-select-${group.slug}`}>
                    <input
                      className="h-4 w-4 accent-[#007aff]"
                      data-testid={`desktop-cm-session-group-select-input-${group.slug}`}
                      type="checkbox"
                      checked={group.sessions.length > 0 && group.sessions.every((session) => selectedBulkSessionIds.has(session.id))}
                      onChange={(event) => handleToggleBulkGroup(group.sessions.map((session) => session.id), event.currentTarget.checked)}
                    />
                    선택
                  </label>
                  <button
                    className="ku-control h-8 text-xs"
                    data-testid={`desktop-cm-session-group-toggle-${group.slug}`}
                    type="button"
                    onClick={() => handleToggleGroupCollapsed(group.group)}
                  >
                    {group.collapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                    <Folder size={13} aria-hidden="true" />
                    <span className="truncate">{group.group}</span>
                  </button>
                  <span className="ku-chip" data-testid={`desktop-cm-session-group-count-${group.slug}`}>
                    {group.sessions.length} / {group.totalCount}
                  </span>
                  <span className="ku-chip" data-testid={`desktop-cm-session-group-favorites-${group.slug}`}>
                    <Star size={12} aria-hidden="true" />
                    favorite {group.favoriteCount}
                  </span>
                  {group.sessions.some((session) => selectedBulkSessionIds.has(session.id)) ? (
                    <span className="ku-chip" data-testid={`desktop-cm-session-group-selected-${group.slug}`}>
                      selected {group.sessions.filter((session) => selectedBulkSessionIds.has(session.id)).length}
                    </span>
                  ) : null}
                </div>
                {group.collapsed ? null : (
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" data-testid={`desktop-cm-session-group-items-${group.slug}`}>
                    {group.sessions.map((session) => {
                      const preference = getDesktopCmSessionPreference(session.id, sessionPreferenceMap);
                      return (
                        <div
                          key={session.id}
                          className={`grid min-w-0 gap-2 rounded-[8px] border px-3 py-2 text-left transition ${
                            session.selected
                              ? 'border-[rgba(52,199,89,0.28)] bg-[rgba(52,199,89,0.09)]'
                              : 'border-[rgba(60,60,67,0.13)] bg-white/72 hover:bg-white'
                          }`}
                          data-testid={`desktop-cm-session-${session.id}`}
                        >
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <label className="ku-control w-fit text-[11px]" data-testid={`desktop-cm-session-bulk-select-${session.id}`}>
                              <input
                                className="h-4 w-4 accent-[#007aff]"
                                data-testid={`desktop-cm-session-bulk-select-input-${session.id}`}
                                type="checkbox"
                                checked={selectedBulkSessionIds.has(session.id)}
                                onChange={(event) => handleToggleBulkSession(session.id, event.currentTarget.checked)}
                              />
                              선택
                            </label>
                            <button
                              className={`ku-control w-fit text-[11px] ${preference.favorite ? 'border-[rgba(255,204,0,0.32)] bg-[rgba(255,204,0,0.14)] text-[#8a6500]' : ''}`}
                              data-testid={`desktop-cm-session-favorite-${session.id}`}
                              type="button"
                              onClick={() => handleToggleSessionFavorite(session.id)}
                            >
                              <Star size={13} aria-hidden="true" fill={preference.favorite ? 'currentColor' : 'none'} />
                              {preference.favorite ? '즐겨찾기' : '즐겨찾기 추가'}
                            </button>
                            <label className="min-w-[150px] flex-1">
                              <span className="ku-meta">Group</span>
                              <input
                                key={`${session.id}:${preference.group}`}
                                className="ku-field mt-1 h-8 w-full text-xs"
                                data-testid={`desktop-cm-session-group-input-${session.id}`}
                                maxLength={maxDesktopCmSessionGroupNameLength}
                                placeholder={defaultDesktopCmSessionGroup}
                                defaultValue={preference.group}
                                onBlur={(event) => handleSetSessionGroup(session.id, event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.currentTarget.blur();
                                  }
                                }}
                              />
                            </label>
                          </div>
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
                                setCloneDraftSourceName('');
                                setError('');
                              }}
                            >
                              <Pencil size={13} aria-hidden="true" />
                              수정
                            </button>
                            <button
                              className="ku-control w-fit text-[11px]"
                              data-testid={`desktop-cm-session-clone-${session.id}`}
                              type="button"
                              onClick={() => handleCloneSession(session)}
                            >
                              <Copy size={13} aria-hidden="true" />
                              복제
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
                      );
                    })}
                  </div>
                )}
              </section>
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
