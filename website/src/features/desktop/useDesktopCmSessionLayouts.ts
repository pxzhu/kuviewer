import {
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { DesktopCmSession } from './desktopConnectionProfile';
import {
  normalizeDesktopCmSessionViewPreferences,
  pruneDesktopCmSessionViewPreferences,
  type DesktopCmSessionViewPreferences,
} from './desktopCmSessionView';
import { isDesktopCmKeyboardIgnoredTarget, slugifyDesktopCmTestId } from './desktopCmReorder';
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
} from './desktopCmSessionLayouts';
import { formatCmSessionError, normalizeSearchValue } from './desktopCmSessionPresentation';
import type {
  DesktopCmSessionLayoutConflictResolution,
  DesktopCmSessionLayoutImportConflict,
  DesktopCmSessionLayoutImportConflictPreview,
} from '../../components/desktopCm/DesktopCmLayoutConflictPanel';
import type { DesktopCmSavedLayoutsPanelProps } from '../../components/desktopCm/DesktopCmSavedLayoutsPanel';

export interface DesktopCmSessionLayoutImportSummary {
  fileName: string;
  imported: number;
  updated: number;
  skipped: number;
  invalid: number;
}

interface UseDesktopCmSessionLayoutsOptions {
  sessions: DesktopCmSession[];
  sessionViewPreferences: DesktopCmSessionViewPreferences;
  busyAction: string;
  setBusyAction: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  onApplyViewPreferences: (preferences: DesktopCmSessionViewPreferences) => void;
}

export function useDesktopCmSessionLayouts({
  sessions,
  sessionViewPreferences,
  busyAction,
  setBusyAction,
  setError,
  onApplyViewPreferences,
}: UseDesktopCmSessionLayoutsOptions) {
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
  const [sessionLayoutImportSummary, setSessionLayoutImportSummary] = useState<DesktopCmSessionLayoutImportSummary | null>(null);
  const [sessionLayoutImportConflicts, setSessionLayoutImportConflicts] = useState<DesktopCmSessionLayoutImportConflictPreview | null>(null);
  const sessionLayoutImportInputRef = useRef<HTMLInputElement | null>(null);
  const sessionLayoutFolderListRef = useRef<HTMLDivElement | null>(null);
  const normalizedSessionLayoutSearchQuery = normalizeSearchValue(sessionLayoutSearchQuery);
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

  const announceSessionLayoutReorderStatus = (messageText: string) => {
    setSessionLayoutReorderKeyboardMessage(messageText);
  };

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
    onApplyViewPreferences(nextPreferences);
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

  const panelProps: DesktopCmSavedLayoutsPanelProps = {
    importInputRef: sessionLayoutImportInputRef,
    listRef: sessionLayoutFolderListRef,
    presetName: sessionLayoutPresetName,
    presetFolder: sessionLayoutPresetFolder,
    searchQuery: sessionLayoutSearchQuery,
    folderFilter: sessionLayoutFolderFilter,
    folderFilterOptions: sessionLayoutFolderFilterOptions,
    presetCount: sessionLayoutPresets.length,
    visiblePresetCount: visibleSessionLayoutPresets.length,
    searchActive: sessionLayoutSearchActive,
    folderFilterActive: sessionLayoutFolderFilterActive,
    reorderUnavailableReason: sessionLayoutReorderUnavailableReason,
    reorderStateLabel: sessionLayoutReorderStateLabel,
    selectedCount: selectedSessionLayoutPresetNames.size,
    selectedVisibleCount: selectedVisibleSessionLayoutPresetCount,
    bulkFolderName: sessionLayoutBulkFolderName,
    bulkDeleteConfirm: sessionLayoutBulkDeleteConfirm,
    busyAction,
    importConflicts: sessionLayoutImportConflicts,
    listProps: {
      presetCount: sessionLayoutPresets.length,
      folders: groupedSessionLayoutPresets,
      activeFolderName: activeSessionLayoutFolderName,
      activePresetName: activeSessionLayoutPresetName,
      selectedPresetNames: selectedSessionLayoutPresetNames,
      draggingFolderName: draggingSessionLayoutFolderName,
      draggingPresetName: draggingSessionLayoutPresetName,
      folderRenameTarget: sessionLayoutFolderRenameTarget,
      folderRenameDraft: sessionLayoutFolderRenameDraft,
      presetRenameTarget: sessionLayoutRenameTargetName,
      presetRenameDraft: sessionLayoutRenameDraftName,
      presetRenameError: sessionLayoutRenameError,
      canReorderFolders: canReorderSessionLayoutFolders,
      canReorderPresets: canReorderSessionLayoutPresets,
      filteredEmpty: sessionLayoutFilteredEmpty,
      filteredEmptyLabel: sessionLayoutFilteredEmptyLabel,
      searchActive: sessionLayoutSearchActive,
      searchQuery: sessionLayoutSearchQuery,
      folderFilterActive: sessionLayoutFolderFilterActive,
      folderFilter: sessionLayoutFolderFilter,
      folderKeyboardLiveText: sessionLayoutFolderKeyboardLiveText,
      reorderKeyboardLiveText: sessionLayoutReorderKeyboardLiveText,
      reorderFocusLiveText: sessionLayoutReorderFocusLiveText,
      folderDisabledReason: sessionLayoutFolderReorderDisabledReason,
      presetDisabledReason: sessionLayoutPresetReorderDisabledReason,
    },
    listActions: {
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
    },
    actions: {
      onPresetNameChange: setSessionLayoutPresetName,
      onPresetFolderChange: setSessionLayoutPresetFolder,
      onPresetFolderBlur: (value) => setSessionLayoutPresetFolder(normalizeDesktopCmSessionLayoutFolderName(value)),
      onSearchQueryChange: setSessionLayoutSearchQuery,
      onFolderFilterChange: (value) => {
        setSessionLayoutBulkDeleteConfirm(false);
        setSessionLayoutFolderFilter(value);
      },
      onSave: handleSaveSessionLayoutPreset,
      onSelectVisible: handleSelectVisibleSessionLayoutPresets,
      onClearSelection: handleClearSessionLayoutPresetSelection,
      onExport: handleExportSessionLayouts,
      onImport: (file) => void handleImportSessionLayouts(file),
      onBulkFolderChange: (value) => {
        setSessionLayoutBulkDeleteConfirm(false);
        setSessionLayoutBulkFolderName(value);
      },
      onMoveSelectedToFolder: handleMoveSelectedSessionLayoutsToFolder,
      onExportSelected: handleExportSelectedSessionLayouts,
      onDeleteSelected: handleDeleteSelectedSessionLayouts,
      onResolveConflicts: handleResolveSessionLayoutImportConflicts,
    },
  };

  return {
    importSummary: sessionLayoutImportSummary,
    panelProps,
  };
}
