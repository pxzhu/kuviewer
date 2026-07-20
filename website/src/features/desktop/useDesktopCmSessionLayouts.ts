import {
  type Dispatch,
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
import { slugifyDesktopCmTestId } from './desktopCmReorder';
import {
  buildDesktopCmSessionLayoutDuplicateName,
  buildDesktopCmSessionLayoutFolderFilterOptions,
  buildDesktopCmSessionLayoutFolders,
  buildDesktopCmSessionLayoutImportName,
  defaultDesktopCmSessionLayoutFolder,
  desktopCmSessionLayoutEqual,
  downloadDesktopCmSessionLayoutBundle,
  matchesDesktopCmSessionLayoutFolderFilter,
  matchesDesktopCmSessionLayoutSearch,
  maxDesktopCmSessionLayoutPresets,
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
import { useDesktopCmSessionLayoutReorder } from './useDesktopCmSessionLayoutReorder';
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
  const [sessionLayoutPresets, setSessionLayoutPresets] = useState<DesktopCmSessionLayoutPreset[]>(() => readDesktopCmSessionLayoutPresets());
  const [collapsedSessionLayoutFolders, setCollapsedSessionLayoutFolders] = useState<Set<string>>(() => readDesktopCmSessionLayoutCollapsedFolders());
  const [selectedSessionLayoutPresetNames, setSelectedSessionLayoutPresetNames] = useState<Set<string>>(() => new Set());
  const [sessionLayoutBulkDeleteConfirm, setSessionLayoutBulkDeleteConfirm] = useState(false);
  const [sessionLayoutBulkFolderName, setSessionLayoutBulkFolderName] = useState(defaultDesktopCmSessionLayoutFolder);
  const [sessionLayoutImportSummary, setSessionLayoutImportSummary] = useState<DesktopCmSessionLayoutImportSummary | null>(null);
  const [sessionLayoutImportConflicts, setSessionLayoutImportConflicts] = useState<DesktopCmSessionLayoutImportConflictPreview | null>(null);
  const sessionLayoutImportInputRef = useRef<HTMLInputElement | null>(null);
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

  const sessionLayoutReorder = useDesktopCmSessionLayoutReorder({
    presets: sessionLayoutPresets,
    setPresets: setSessionLayoutPresets,
    groupedPresets: groupedSessionLayoutPresets,
    visiblePresetCount: visibleSessionLayoutPresets.length,
    searchActive: sessionLayoutSearchActive,
    folderFilterActive: sessionLayoutFolderFilterActive,
    activeFolderName: activeSessionLayoutFolderName,
    setActiveFolderName: setActiveSessionLayoutFolderName,
    folderRenameTarget: sessionLayoutFolderRenameTarget,
    onBeforeReorder: () => {
      setSessionLayoutImportConflicts(null);
      setSessionLayoutBulkDeleteConfirm(false);
    },
    onToggleFolder: handleToggleSessionLayoutFolder,
    onSelectFolderPresets: handleSelectSessionLayoutFolderPresets,
    onStartRenameFolder: handleStartRenameSessionLayoutFolder,
    onCancelRenameFolder: handleCancelRenameSessionLayoutFolder,
  });

  const panelProps: DesktopCmSavedLayoutsPanelProps = {
    importInputRef: sessionLayoutImportInputRef,
    listRef: sessionLayoutReorder.listRef,
    presetName: sessionLayoutPresetName,
    presetFolder: sessionLayoutPresetFolder,
    searchQuery: sessionLayoutSearchQuery,
    folderFilter: sessionLayoutFolderFilter,
    folderFilterOptions: sessionLayoutFolderFilterOptions,
    presetCount: sessionLayoutPresets.length,
    visiblePresetCount: visibleSessionLayoutPresets.length,
    searchActive: sessionLayoutSearchActive,
    folderFilterActive: sessionLayoutFolderFilterActive,
    reorderUnavailableReason: sessionLayoutReorder.reorderUnavailableReason,
    reorderStateLabel: sessionLayoutReorder.reorderStateLabel,
    selectedCount: selectedSessionLayoutPresetNames.size,
    selectedVisibleCount: selectedVisibleSessionLayoutPresetCount,
    bulkFolderName: sessionLayoutBulkFolderName,
    bulkDeleteConfirm: sessionLayoutBulkDeleteConfirm,
    busyAction,
    importConflicts: sessionLayoutImportConflicts,
    listProps: {
      ...sessionLayoutReorder.listProps,
      presetCount: sessionLayoutPresets.length,
      folders: groupedSessionLayoutPresets,
      activePresetName: activeSessionLayoutPresetName,
      selectedPresetNames: selectedSessionLayoutPresetNames,
      folderRenameTarget: sessionLayoutFolderRenameTarget,
      folderRenameDraft: sessionLayoutFolderRenameDraft,
      presetRenameTarget: sessionLayoutRenameTargetName,
      presetRenameDraft: sessionLayoutRenameDraftName,
      presetRenameError: sessionLayoutRenameError,
      filteredEmpty: sessionLayoutFilteredEmpty,
      filteredEmptyLabel: sessionLayoutFilteredEmptyLabel,
      searchActive: sessionLayoutSearchActive,
      searchQuery: sessionLayoutSearchQuery,
      folderFilterActive: sessionLayoutFolderFilterActive,
      folderFilter: sessionLayoutFolderFilter,
    },
    listActions: {
      ...sessionLayoutReorder.listActions,
      onFolderRenameDraftChange: setSessionLayoutFolderRenameDraft,
      onSaveFolderRename: handleSaveRenamedSessionLayoutFolder,
      onCancelFolderRename: handleCancelRenameSessionLayoutFolder,
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
