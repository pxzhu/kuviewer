import type { ResourceExplorerItem } from '../../types/resourceExplorer';
import type {
  ResourceLogsSectionActions,
  ResourceLogsSectionModel,
} from './ResourceLogsSection';
import type { DetailSectionTone } from './resourceDetailTypes';
import { useResourceLogsController } from './useResourceLogsController';

interface ResourceLogsSectionControllerOptions {
  active: boolean;
  liveEnabled: boolean;
  onEnsureOpen: () => void;
  onFocusSection: () => void;
  onToggleSection: () => void;
  open: boolean;
  resource: ResourceExplorerItem;
  sectionRef: (node: HTMLElement | null) => void;
}

export function useResourceLogsSectionController({
  active,
  liveEnabled,
  onEnsureOpen,
  onFocusSection,
  onToggleSection,
  open,
  resource,
  sectionRef,
}: ResourceLogsSectionControllerOptions) {
  const controller = useResourceLogsController({ liveEnabled, resource });
  const normalizedFilter = controller.logFilter.trim();
  const filterActive = normalizedFilter.length > 0;
  const activeMatchNumber = controller.logSearchMatches.length > 0
    ? Math.min(controller.activeLogMatchIndex + 1, controller.logSearchMatches.length)
    : 0;
  const controlsActive = filterActive
    || controller.logTimeRangeFilter !== 'all'
    || controller.logSortOrder !== 'received';
  const canCopyVisible = controller.filteredLogLines.length > 0;
  const canDownloadVisible = controller.filteredLogLines.length > 0;
  const canCopyAll = controlsActive && controller.logLines.length > 0;
  const canDownloadAll = controlsActive && controller.logLines.length > 0;
  const summary = controller.logLines.length > 0
    ? `${controller.filteredLogLines.length} / ${controller.logLines.length}`
    : controller.canFetchLogs ? 'ready' : 'empty';
  const navigatorTone: DetailSectionTone = controller.logsError
    ? 'error'
    : controller.logsWarning ? 'warning' : 'default';
  const viewportClassName = controller.logDensity === 'compact'
    ? 'max-h-[420px] overflow-auto rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-[#111827] p-1 font-mono text-[10px] leading-4 text-[#d1d5db]'
    : 'max-h-[320px] overflow-auto rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-[#111827] p-2 font-mono text-[11px] leading-5 text-[#d1d5db]';
  const rowClassName = controller.logDensity === 'compact'
    ? 'grid grid-cols-[38px_minmax(0,1fr)] gap-1 rounded-[5px] px-0.5 py-0'
    : 'grid grid-cols-[44px_minmax(0,1fr)] gap-2 rounded-[6px] px-1 py-0.5';

  const actions: ResourceLogsSectionActions = {
    changeContainer: (value) => {
      controller.stopLogStream();
      controller.setSelectedLogContainer(value);
      controller.clearLogOutput();
    },
    changeFilter: (value) => {
      controller.setLogFilter(value);
      controller.setActiveLogMatchIndex(0);
      controller.setLogCopyStatus(null);
    },
    changePrevious: (value) => {
      controller.stopLogStream();
      controller.setPreviousLogs(value);
      controller.clearLogOutput();
    },
    changeSortOrder: (value) => {
      controller.setLogSortOrder(value);
      controller.setActiveLogMatchIndex(0);
      controller.setLogCopyStatus(null);
    },
    changeTimeRange: (value) => {
      controller.setLogTimeRangeFilter(value);
      controller.setActiveLogMatchIndex(0);
      controller.setLogCopyStatus(null);
    },
    copy: (mode) => void controller.copyLogs(mode),
    download: controller.downloadLogs,
    fetch: () => {
      if (!controller.canFetchLogs) {
        return;
      }
      onEnsureOpen();
      void controller.fetchLogs();
    },
    focusSection: onFocusSection,
    moveMatch: (offset) => {
      if (controller.logSearchMatches.length === 0) {
        return;
      }
      onEnsureOpen();
      controller.moveActiveLogMatch(offset);
    },
    resetControls: () => {
      controller.setLogFilter('');
      controller.setActiveLogMatchIndex(0);
      controller.setLogTimeRangeFilter('all');
      controller.setLogSortOrder('received');
      controller.setLogCopyStatus(null);
    },
    setDensity: controller.setLogDensity,
    stream: () => {
      if (!controller.canFetchLogs || controller.previousLogs) {
        return;
      }
      onEnsureOpen();
      void controller.toggleLogStream();
    },
    togglePause: controller.logsPaused ? controller.resumeLogStream : controller.pauseLogStream,
    toggleSection: onToggleSection,
  };

  const model: ResourceLogsSectionModel = {
    active,
    activeMatch: controller.activeLogMatch || undefined,
    activeMatchNumber,
    canCopyAll,
    canCopyVisible,
    canDownloadAll,
    canDownloadVisible,
    canFetch: controller.canFetchLogs,
    containerOptions: controller.logContainerOptions,
    controlsActive,
    copyStatus: controller.logCopyStatus,
    density: controller.logDensity,
    effectiveContainer: controller.effectiveLogContainer,
    error: controller.logsError,
    filter: controller.logFilter,
    filterActive,
    filteredLines: controller.filteredLogLines,
    lineRefs: controller.logLineRefs,
    lines: controller.logLines,
    loading: controller.logsLoading,
    normalizedFilter,
    open,
    paused: controller.logsPaused,
    pendingCount: controller.pendingLogLines.length,
    previous: controller.previousLogs,
    rowClassName,
    searchMatchCount: controller.logSearchMatches.length,
    sectionRef,
    sortOrder: controller.logSortOrder,
    streaming: controller.logsStreaming,
    summary,
    timeRangeFilter: controller.logTimeRangeFilter,
    viewportClassName,
    warning: controller.logsWarning,
  };

  return {
    actions,
    canFetch: controller.canFetchLogs,
    effectiveContainer: controller.effectiveLogContainer,
    model,
    navigatorTone,
    summary,
  };
}
