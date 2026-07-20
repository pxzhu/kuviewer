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
import { isDesktopCmKeyboardIgnoredTarget, slugifyDesktopCmTestId } from './desktopCmReorder';
import {
  desktopCmSessionLayoutFolderOrder,
  moveDesktopCmSessionLayoutFolderBefore,
  moveDesktopCmSessionLayoutFolderToIndex,
  moveDesktopCmSessionLayoutPresetBefore,
  moveDesktopCmSessionLayoutPresetToIndex,
  normalizeDesktopCmSessionLayoutFolderName,
  writeDesktopCmSessionLayoutPresets,
  type DesktopCmSessionLayoutFolder,
  type DesktopCmSessionLayoutPreset,
} from './desktopCmSessionLayouts';

interface UseDesktopCmSessionLayoutReorderOptions {
  presets: DesktopCmSessionLayoutPreset[];
  setPresets: Dispatch<SetStateAction<DesktopCmSessionLayoutPreset[]>>;
  groupedPresets: DesktopCmSessionLayoutFolder[];
  visiblePresetCount: number;
  searchActive: boolean;
  folderFilterActive: boolean;
  activeFolderName: string;
  setActiveFolderName: Dispatch<SetStateAction<string>>;
  folderRenameTarget: string;
  onBeforeReorder: () => void;
  onToggleFolder: (folderName: string) => void;
  onSelectFolderPresets: (folderName: string) => void;
  onStartRenameFolder: (folderName: string) => void;
  onCancelRenameFolder: () => void;
}

export function useDesktopCmSessionLayoutReorder({
  presets: sessionLayoutPresets,
  setPresets: setSessionLayoutPresets,
  groupedPresets: groupedSessionLayoutPresets,
  visiblePresetCount,
  searchActive: sessionLayoutSearchActive,
  folderFilterActive: sessionLayoutFolderFilterActive,
  activeFolderName: activeSessionLayoutFolderName,
  setActiveFolderName: setActiveSessionLayoutFolderName,
  folderRenameTarget: sessionLayoutFolderRenameTarget,
  onBeforeReorder,
  onToggleFolder,
  onSelectFolderPresets,
  onStartRenameFolder,
  onCancelRenameFolder,
}: UseDesktopCmSessionLayoutReorderOptions) {
  const [draggingSessionLayoutFolderName, setDraggingSessionLayoutFolderName] = useState('');
  const [draggingSessionLayoutPresetName, setDraggingSessionLayoutPresetName] = useState('');
  const [sessionLayoutReorderKeyboardMessage, setSessionLayoutReorderKeyboardMessage] = useState('');
  const [sessionLayoutReorderFocusTargetTestId, setSessionLayoutReorderFocusTargetTestId] = useState('');
  const [sessionLayoutReorderFocusTargetLabel, setSessionLayoutReorderFocusTargetLabel] = useState('');
  const [sessionLayoutReorderFocusMessage, setSessionLayoutReorderFocusMessage] = useState('');
  const sessionLayoutFolderListRef = useRef<HTMLDivElement | null>(null);
  const sessionLayoutFolderNames = useMemo(
    () => groupedSessionLayoutPresets.map((folder) => folder.folder),
    [groupedSessionLayoutPresets],
  );

  const sessionLayoutReorderBlocked = sessionLayoutSearchActive || sessionLayoutFolderFilterActive;
  const canReorderSessionLayoutFolders = sessionLayoutFolderNames.length > 1 && !sessionLayoutReorderBlocked;
  const canReorderSessionLayoutPresets = visiblePresetCount > 1 && !sessionLayoutReorderBlocked;
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
    (sessionLayoutFolderNames.length <= 1 && visiblePresetCount <= 1
      ? 'Reorder unavailable: at least two layout folders or two presets in the same folder are required.'
      : sessionLayoutFolderNames.length <= 1
        ? 'Reorder unavailable: at least two layout folders are required.'
        : visiblePresetCount <= 1
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
    onBeforeReorder();
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
    onBeforeReorder();
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
    onBeforeReorder();
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
    onBeforeReorder();
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
      onToggleFolder(activeSessionLayoutFolderName);
      return;
    }
    if (sessionLayoutFolderNames.length > 0) {
      setActiveSessionLayoutFolderName(sessionLayoutFolderNames[0]);
    }
  };

  const handleSelectActiveSessionLayoutFolder = () => {
    if (activeSessionLayoutFolderName) {
      onSelectFolderPresets(activeSessionLayoutFolderName);
      return;
    }
    if (sessionLayoutFolderNames.length > 0) {
      const firstFolder = sessionLayoutFolderNames[0];
      setActiveSessionLayoutFolderName(firstFolder);
      onSelectFolderPresets(firstFolder);
    }
  };

  const handleRenameActiveSessionLayoutFolder = () => {
    if (activeSessionLayoutFolderName) {
      onStartRenameFolder(activeSessionLayoutFolderName);
      return;
    }
    if (sessionLayoutFolderNames.length > 0) {
      onStartRenameFolder(sessionLayoutFolderNames[0]);
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
        onCancelRenameFolder();
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

  return {
    listRef: sessionLayoutFolderListRef,
    reorderUnavailableReason: sessionLayoutReorderUnavailableReason,
    reorderStateLabel: sessionLayoutReorderStateLabel,
    listProps: {
      activeFolderName: activeSessionLayoutFolderName,
      draggingFolderName: draggingSessionLayoutFolderName,
      draggingPresetName: draggingSessionLayoutPresetName,
      canReorderFolders: canReorderSessionLayoutFolders,
      canReorderPresets: canReorderSessionLayoutPresets,
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
      onToggleFolder,
      onSelectFolderPresets,
      onStartFolderRename: onStartRenameFolder,
      onSetDraggingPreset: setDraggingSessionLayoutPresetName,
      onDropPreset: handleDropSessionLayoutPreset,
      onPresetReorderKeyDown: handleSessionLayoutPresetReorderHandleKeyDown,
      onMovePreset: handleMoveSessionLayoutPresetOrder,
    },
  };
}
