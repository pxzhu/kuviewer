import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Activity, CheckCircle2, FileText, RotateCcw, Search, Tags, X } from "lucide-react";
import type { ResourceExplorerItem } from "../../types/resourceExplorer";
import {
  DetailSection,
  HealthSignalPanel,
  KeyValueGrid,
  ResourceDetailOverview,
  ResourceDetailSectionNavigator,
} from './ResourceDetailPrimitives';
import {
  countEventSeverities,
  countNewEvents,
  collectKeyValueSearchMatches,
  downloadTextFile,
  eventControlSummary,
  eventExportCsv,
  eventExportFileName,
  eventExportJson,
  eventIdentityKey,
  eventSectionSummary,
  filterEvents,
  filterRelatedResources,
  groupEventsBySeverity,
  groupRelatedResources,
  keyValueEntries,
  readResourceDetailDensityPreference,
  recordFromUnknown,
  sortEventListItems,
  statusPillClassName,
  writeResourceDetailDensityPreference,
} from './resourceDetailActivity';
import { renderHighlightedText } from './resourceDetailHighlight';
import {
  healthSectionSummary,
  healthSignalSectionTone,
  resourceDetailOverviewItems,
  resourceHealthSignals,
  sectionCount,
} from './resourceDetailHealth';
import {
  defaultOpenDetailSections,
  detailJumpSections,
  detailKeyboardSections,
  detailNavigatorSections,
  maxCollapsedRelations,
  type DetailSectionId,
  type DetailSectionTone,
  type EventExportFormat,
  type ResourceDetailDensity,
} from './resourceDetailTypes';
import { useResourceEventsController } from './useResourceEventsController';
import { useResourceLogsController } from './useResourceLogsController';
import { ResourceRelationsSection } from './ResourceRelationsSection';
import { ResourceEventsSection } from './ResourceEventsSection';
import { ResourceLogsSection } from './ResourceLogsSection';

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'select' || tagName === 'textarea' || tagName === 'button' || target.isContentEditable;
}

function EmptyResourceDetail() {
  return (
    <div className="ku-panel p-6 text-center">
      <p className="text-sm font-semibold text-[#1d1d1f]">선택된 리소스가 없습니다.</p>
    </div>
  );
}

export function ResourceExplorerDetail({
  liveEnabled,
  resource,
  focusRequest,
  onOpenTopologyNode,
  onSelectNode,
}: {
  liveEnabled: boolean;
  resource?: ResourceExplorerItem;
  focusRequest: number;
  onOpenTopologyNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  if (!resource) {
    return <EmptyResourceDetail />;
  }

  return (
    <ResourceExplorerDetailBody
      liveEnabled={liveEnabled}
      resource={resource}
      focusRequest={focusRequest}
      onOpenTopologyNode={onOpenTopologyNode}
      onSelectNode={onSelectNode}
    />
  );
}

function ResourceExplorerDetailBody({
  liveEnabled,
  resource,
  focusRequest,
  onOpenTopologyNode,
  onSelectNode,
}: {
  liveEnabled: boolean;
  resource: ResourceExplorerItem;
  focusRequest: number;
  onOpenTopologyNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const {
    events,
    eventsAutoRefreshEnabled,
    eventsError,
    eventsLastUpdatedAt,
    eventsLoading,
    eventsWarning,
    eventsWarningNotificationsEnabled,
    eventFilter,
    eventNotificationNotice,
    eventSeverityFilter,
    eventSortOrder,
    eventTimeRangeFilter,
    loadResourceEvents,
    newEventKeys,
    pinnedEventKeys,
    resetEventMarkerState,
    resetResourceEventUiState,
    setEventFilter,
    setEventNotificationNotice,
    setEventsAutoRefreshEnabled,
    setEventsWarningNotificationsEnabled,
    setEventSeverityFilter,
    setEventSortOrder,
    setEventTimeRangeFilter,
    setNewEventKeys,
    setPinnedEventKeys,
    setShowNewEventsOnly,
    showNewEventsOnly,
  } = useResourceEventsController({ liveEnabled, resource });
  const {
    activeLogMatch,
    activeLogMatchIndex,
    canFetchLogs,
    clearLogOutput,
    copyLogs,
    downloadLogs,
    effectiveLogContainer,
    fetchLogs,
    filteredLogLines,
    logContainerOptions,
    logCopyStatus,
    logDensity,
    logFilter,
    logLineRefs,
    logLines,
    logSearchMatches,
    logSortOrder,
    logsError,
    logsLoading,
    logsPaused,
    logsStreaming,
    logsWarning,
    logTimeRangeFilter,
    moveActiveLogMatch: moveActiveLogMatchController,
    pauseLogStream,
    pendingLogLines,
    previousLogs,
    resetLogPauseState,
    resumeLogStream,
    selectedLogContainer,
    setActiveLogMatchIndex,
    setLogCopyStatus,
    setLogDensity,
    setLogFilter,
    setLogSortOrder,
    setLogTimeRangeFilter,
    setPreviousLogs,
    setSelectedLogContainer,
    stopLogStream,
    toggleLogStream,
  } = useResourceLogsController({ liveEnabled, resource });
  const [resourceDetailDensity, setResourceDetailDensity] = useState<ResourceDetailDensity>(() => readResourceDetailDensityPreference());
  const [safePreviewFilter, setSafePreviewFilter] = useState('');
  const [activeSafePreviewMatchIndex, setActiveSafePreviewMatchIndex] = useState(0);
  const [relationFilter, setRelationFilter] = useState('');
  const [relationsExpanded, setRelationsExpanded] = useState(false);
  const [activeDetailSectionId, setActiveDetailSectionId] = useState<DetailSectionId>('metadata');
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const detailPanelActiveRef = useRef(false);
  const detailSectionRefs = useRef<Partial<Record<DetailSectionId, HTMLElement | null>>>({});
  const [openSections, setOpenSections] = useState<Set<DetailSectionId>>(() => new Set(defaultOpenDetailSections));

  const resetResourceDetailUiState = useCallback(() => {
    setSafePreviewFilter('');
    setActiveSafePreviewMatchIndex(0);
    setRelationFilter('');
    setRelationsExpanded(false);
    resetResourceEventUiState();
    setActiveDetailSectionId('metadata');
    setOpenSections(new Set(defaultOpenDetailSections));
  }, [resetResourceEventUiState]);

  useEffect(() => {
    resetResourceDetailUiState();
  }, [resetResourceDetailUiState, resource.id]);
  const baseFilteredEvents = useMemo(
    () => sortEventListItems(filterEvents(events, eventFilter, eventSeverityFilter, eventTimeRangeFilter, Date.now()), eventSortOrder, pinnedEventKeys),
    [eventFilter, eventSeverityFilter, eventSortOrder, eventTimeRangeFilter, events, pinnedEventKeys],
  );
  const filteredEvents = useMemo(
    () => (showNewEventsOnly ? baseFilteredEvents.filter((item) => newEventKeys.has(eventIdentityKey(item.event))) : baseFilteredEvents),
    [baseFilteredEvents, newEventKeys, showNewEventsOnly],
  );
  const pinnedEvents = useMemo(() => filteredEvents.filter((item) => item.pinned), [filteredEvents]);
  const eventGroups = useMemo(() => groupEventsBySeverity(filteredEvents.filter((item) => !item.pinned)), [filteredEvents]);
  const eventSeverityCounts = useMemo(() => countEventSeverities(events), [events]);
  const newEventCount = useMemo(() => countNewEvents(events, newEventKeys), [events, newEventKeys]);
  const hasNewEvents = newEventCount > 0;
  const eventWarningCount = eventSeverityCounts.warning;
  const eventHasWarning = eventWarningCount > 0;
  const filteredRelations = useMemo(() => filterRelatedResources(resource?.related || [], relationFilter), [relationFilter, resource?.related]);
  const normalizedLogFilter = logFilter.trim();
  const normalizedEventFilter = eventFilter.trim();
  const normalizedRelationFilter = relationFilter.trim();
  const relationGroups = useMemo(
    () => groupRelatedResources(filteredRelations, relationsExpanded ? Number.POSITIVE_INFINITY : maxCollapsedRelations),
    [filteredRelations, relationsExpanded],
  );
  const visibleRelationCount = relationGroups.reduce((total, group) => total + group.items.length, 0);
  const hiddenRelationCount = Math.max(filteredRelations.length - visibleRelationCount, 0);
  const eventControlsActive = eventFilter || eventSeverityFilter !== 'all' || eventTimeRangeFilter !== 'all' || eventSortOrder !== 'newest' || pinnedEventKeys.size > 0 || showNewEventsOnly;
  const eventFilterSummary = eventControlSummary(eventFilter, eventSeverityFilter, eventTimeRangeFilter, eventSortOrder, pinnedEventKeys.size, showNewEventsOnly);
  const canRefreshEvents = liveEnabled && Boolean(resource);
  const eventsAutoRefreshActive = canRefreshEvents && eventsAutoRefreshEnabled;
  const canExportEvents = filteredEvents.length > 0;

  useEffect(() => {
    writeResourceDetailDensityPreference(resourceDetailDensity);
  }, [resourceDetailDensity]);

  useEffect(() => {
    if (focusRequest <= 0) {
      return;
    }
    detailPanelActiveRef.current = true;
    window.requestAnimationFrame(() => {
      detailPanelRef.current?.focus({ preventScroll: false });
    });
  }, [focusRequest]);

  const metadataPreview = resource ? recordFromUnknown(resource.preview.metadata) : {};
  const statusPreview = resource ? recordFromUnknown(resource.preview.status) : {};
  const summaryPreview = resource
    ? {
        ...recordFromUnknown(resource.preview.summary),
        ...(resource.preview.secretValues ? { secretValues: resource.preview.secretValues } : {}),
      }
    : {};
  const yamlPreview = resource && typeof resource.preview.safeYaml === 'string' ? resource.preview.safeYaml : '';
  const safePreviewEntries = keyValueEntries(summaryPreview);
  const safePreviewMatches = collectKeyValueSearchMatches(safePreviewEntries, safePreviewFilter);
  const safePreviewFilterActive = safePreviewFilter.trim().length > 0;
  const activeSafePreviewMatch = safePreviewMatches[activeSafePreviewMatchIndex] || null;

  useEffect(() => {
    setActiveSafePreviewMatchIndex((current) => {
      if (safePreviewMatches.length === 0) {
        return 0;
      }
      return Math.min(current, safePreviewMatches.length - 1);
    });
  }, [safePreviewMatches.length]);

  const healthSignals = resourceHealthSignals(resource, statusPreview, summaryPreview);
  const healthSectionTone = healthSignalSectionTone(resource, healthSignals);
  const logFilterActive = normalizedLogFilter.length > 0;
  const activeLogMatchNumber = logSearchMatches.length > 0 ? Math.min(activeLogMatchIndex + 1, logSearchMatches.length) : 0;
  const pendingLogCount = pendingLogLines.length;
  const canCopyVisibleLogs = filteredLogLines.length > 0;
  const canDownloadVisibleLogs = filteredLogLines.length > 0;
  const logControlsActive = logFilterActive || logTimeRangeFilter !== 'all' || logSortOrder !== 'received';
  const canCopyAllLogs = logControlsActive && logLines.length > 0;
  const canDownloadAllLogs = logControlsActive && logLines.length > 0;
  const relationSummary = normalizedRelationFilter ? `${filteredRelations.length} / ${resource.related.length}` : `${resource.related.length}`;
  const detailSectionSummaries: Record<DetailSectionId, string> = {
    metadata: sectionCount(metadataPreview),
    status: healthSectionSummary(resource, healthSignals, statusPreview),
    safe: sectionCount(summaryPreview),
    yaml: yamlPreview ? 'available' : 'empty',
    labels: sectionCount(resource.labels),
    annotations: sectionCount(resource.annotations),
    relations: relationSummary,
    events: eventSectionSummary(filteredEvents.length, events.length, eventSeverityCounts),
    logs: logLines.length > 0 ? `${filteredLogLines.length} / ${logLines.length}` : canFetchLogs ? 'ready' : 'empty',
  };
  const detailSectionTones: Record<DetailSectionId, DetailSectionTone> = {
    metadata: 'default',
    status: healthSectionTone,
    safe: 'default',
    yaml: 'default',
    labels: 'default',
    annotations: 'default',
    relations: 'default',
    events: eventsError || eventHasWarning ? 'warning' : 'default',
    logs: logsError ? 'error' : logsWarning ? 'warning' : 'default',
  };
  const overviewItems = resourceDetailOverviewItems({
    canFetchLogs,
    effectiveLogContainer,
    eventSeverityCounts,
    eventSummary: detailSectionSummaries.events,
    logSummary: detailSectionSummaries.logs,
    labels: resource.labels,
    annotations: resource.annotations,
    healthSignals,
    metadataPreview,
    relationCount: resource.related.length,
    resource,
  });
  const logViewportClassName =
    logDensity === 'compact'
      ? 'max-h-[420px] overflow-auto rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-[#111827] p-1 font-mono text-[10px] leading-4 text-[#d1d5db]'
      : 'max-h-[320px] overflow-auto rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-[#111827] p-2 font-mono text-[11px] leading-5 text-[#d1d5db]';
  const logRowClassName =
    logDensity === 'compact'
      ? 'grid grid-cols-[38px_minmax(0,1fr)] gap-1 rounded-[5px] px-0.5 py-0'
      : 'grid grid-cols-[44px_minmax(0,1fr)] gap-2 rounded-[6px] px-1 py-0.5';
  const openDetailSectionCount = detailKeyboardSections.filter((id) => openSections.has(id)).length;
  const allDetailSectionsOpen = openDetailSectionCount === detailKeyboardSections.length;
  const noDetailSectionsOpen = openDetailSectionCount === 0;
  const defaultDetailSectionsOpen = openDetailSectionCount === defaultOpenDetailSections.length && defaultOpenDetailSections.every((id) => openSections.has(id));
  const activeDetailSectionLabel = detailNavigatorSections.find((section) => section.id === activeDetailSectionId)?.label || 'Metadata';
  const resourceIdentityName = resource.namespace ? `${resource.namespace}/${resource.name}` : resource.name;
  const isSectionOpen = useCallback((id: DetailSectionId) => openSections.has(id), [openSections]);
  const toggleSection = useCallback((id: DetailSectionId) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  const openSection = useCallback((id: DetailSectionId) => {
    setOpenSections((current) => {
      if (current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);
  const focusDetailSection = useCallback((id: DetailSectionId) => {
    setActiveDetailSectionId(id);
    openSection(id);
    window.requestAnimationFrame(() => {
      const section = detailSectionRefs.current[id];
      section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      section?.focus({ preventScroll: true });
    });
  }, [openSection]);
  const moveDetailSection = useCallback((offset: number) => {
    const currentIndex = detailKeyboardSections.indexOf(activeDetailSectionId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + offset + detailKeyboardSections.length) % detailKeyboardSections.length : 0;
    focusDetailSection(detailKeyboardSections[nextIndex]);
  }, [activeDetailSectionId, focusDetailSection]);
  const handleExpandAllDetailSections = useCallback(() => {
    setOpenSections(new Set(detailKeyboardSections));
  }, []);
  const handleCollapseAllDetailSections = useCallback(() => {
    setOpenSections(new Set());
  }, []);
  const handleResetDetailSections = useCallback(() => {
    setOpenSections(new Set(defaultOpenDetailSections));
  }, []);
  const handleDetailShortcut = useCallback((event: globalThis.KeyboardEvent) => {
    const eventPath = event.composedPath();
    const editableTargetHasFocus = Boolean(detailPanelRef.current?.querySelector('input:focus, select:focus, textarea:focus, button:focus, [contenteditable="true"]:focus'));
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      editableTargetHasFocus ||
      isEditableTarget(event.target) ||
      isEditableTarget(document.activeElement) ||
      eventPath.some((target) => isEditableTarget(target))
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'j') {
      event.preventDefault();
      moveDetailSection(1);
    } else if (key === 'k') {
      event.preventDefault();
      moveDetailSection(-1);
    } else if (key === 'o') {
      event.preventDefault();
      toggleSection(activeDetailSectionId);
    } else if (key === 'e') {
      event.preventDefault();
      handleExpandAllDetailSections();
    } else if (key === 'c') {
      event.preventDefault();
      handleCollapseAllDetailSections();
    } else if (key === 'r') {
      event.preventDefault();
      handleResetDetailSections();
    } else if (/^[1-9]$/.test(key)) {
      const targetSection = detailKeyboardSections[Number(key) - 1];
      if (targetSection) {
        event.preventDefault();
        focusDetailSection(targetSection);
      }
    }
  }, [activeDetailSectionId, focusDetailSection, handleCollapseAllDetailSections, handleExpandAllDetailSections, handleResetDetailSections, moveDetailSection, toggleSection]);
  const setDetailSectionRef = useCallback((id: DetailSectionId) => (node: HTMLElement | null) => {
    detailSectionRefs.current[id] = node;
  }, []);
  const handleSafePreviewFilterChange = useCallback((value: string) => {
    setSafePreviewFilter(value);
    setActiveSafePreviewMatchIndex(0);
    if (value.trim()) {
      openSection('safe');
    }
  }, [openSection]);
  const moveActiveSafePreviewMatch = useCallback((offset: number) => {
    if (safePreviewMatches.length === 0) {
      return;
    }
    openSection('safe');
    setActiveSafePreviewMatchIndex((current) => (current + offset + safePreviewMatches.length) % safePreviewMatches.length);
  }, [openSection, safePreviewMatches.length]);
  const handleSafePreviewSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    moveActiveSafePreviewMatch(event.shiftKey ? -1 : 1);
  }, [moveActiveSafePreviewMatch]);

  useEffect(() => {
    const handleDocumentPointerDown = (event: MouseEvent | TouchEvent) => {
      detailPanelActiveRef.current = Boolean(detailPanelRef.current?.contains(event.target as Node));
    };
    const handleDocumentFocusIn = (event: FocusEvent) => {
      detailPanelActiveRef.current = Boolean(detailPanelRef.current?.contains(event.target as Node));
    };
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (detailPanelActiveRef.current) {
        handleDetailShortcut(event);
      }
    };
    document.addEventListener('mousedown', handleDocumentPointerDown, true);
    document.addEventListener('touchstart', handleDocumentPointerDown, true);
    document.addEventListener('focusin', handleDocumentFocusIn);
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown, true);
      document.removeEventListener('touchstart', handleDocumentPointerDown, true);
      document.removeEventListener('focusin', handleDocumentFocusIn);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [handleDetailShortcut]);

  const handleFetchLogs = async () => {
    if (!canFetchLogs) {
      return;
    }
    openSection('logs');
    await fetchLogs();
  };

  const handleRefreshEvents = () => {
    if (!canRefreshEvents || eventsLoading) {
      return;
    }
    openSection('events');
    loadResourceEvents({ preserveExistingEvents: true });
  };

  const handleEventsAutoRefreshToggle = () => {
    if (!canRefreshEvents) {
      return;
    }
    openSection('events');
    setEventsAutoRefreshEnabled((current) => !current);
  };

  const handleEventsWarningNotificationsToggle = () => {
    if (!canRefreshEvents) {
      return;
    }
    openSection('events');
    setEventsWarningNotificationsEnabled((current) => {
      const next = !current;
      if (!next) {
        setEventNotificationNotice(null);
        setNewEventKeys(new Set());
        setShowNewEventsOnly(false);
      }
      return next;
    });
  };

  const handleShowNewEvents = () => {
    if (!hasNewEvents) {
      return;
    }
    openSection('events');
    setShowNewEventsOnly(true);
  };

  const handleClearNewEvents = () => {
    setEventNotificationNotice(null);
    setNewEventKeys(new Set());
    setShowNewEventsOnly(false);
  };

  const handleDownloadEvents = (format: EventExportFormat) => {
    if (!canExportEvents) {
      return;
    }
    const content = format === 'csv' ? eventExportCsv(filteredEvents) : eventExportJson(filteredEvents);
    const mimeType = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
    downloadTextFile(content, mimeType, eventExportFileName(resource, format));
  };

  const handlePauseLogStream = () => {
    pauseLogStream();
  };

  const handleResumeLogStream = () => {
    resumeLogStream();
  };

  const handleStreamLogs = async () => {
    if (!canFetchLogs || previousLogs) {
      return;
    }
    openSection('logs');
    await toggleLogStream();
  };

  const handleCopyLogs = async (mode: 'visible' | 'all') => {
    await copyLogs(mode);
  };
  const handleDownloadLogs = (mode: 'visible' | 'all') => {
    downloadLogs(mode);
  };
  const moveActiveLogMatch = (offset: number) => {
    if (logSearchMatches.length === 0) {
      return;
    }
    openSection('logs');
    moveActiveLogMatchController(offset);
  };
  const togglePinnedEvent = (eventId: string) => {
    setPinnedEventKeys((current) => {
      const next = new Set(current);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };
  return (
    <div
      ref={detailPanelRef}
      className="ku-panel overflow-hidden"
      tabIndex={0}
      onFocusCapture={() => {
        detailPanelActiveRef.current = true;
      }}
      onMouseDownCapture={() => {
        detailPanelActiveRef.current = true;
      }}
      aria-label="리소스 상세 패널"
      data-testid="resource-detail-panel"
    >
      <div className="border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[#1d1d1f]">{resource.name}</h2>
            <p className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">
              {resource.clusterId} · {resource.namespace ? `${resource.namespace} / ` : ''}
              {resource.kind}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="리소스 상세 식별 정보">
              <span className="ku-chip" data-testid="resource-detail-kind-chip">Kind {resource.kind}</span>
              <span className="ku-chip" data-testid="resource-detail-name-chip">{resourceIdentityName}</span>
              <span className="ku-chip" data-testid="resource-detail-cluster-chip">Cluster {resource.clusterId}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
            <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="리소스 상세 밀도">
              {([
                { value: 'comfortable', label: '기본' },
                { value: 'compact', label: '촘촘' },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                    resourceDetailDensity === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                  }`}
                  data-testid={`resource-detail-density-${option.value}`}
                  type="button"
                  onClick={() => setResourceDetailDensity(option.value)}
                  aria-pressed={resourceDetailDensity === option.value}
                  title={`리소스 상세 ${option.label} 표시`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span className={statusPillClassName(resource.status)}>{resource.status}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[rgba(60,60,67,0.1)] bg-white/70 p-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="ku-chip border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] text-[#0057b8]" data-testid="resource-detail-active-section">
              현재 {activeDetailSectionLabel}
            </span>
            <span className="ku-chip" data-testid="resource-detail-open-section-count">
              열린 섹션 {openDetailSectionCount} / {detailKeyboardSections.length}
            </span>
            <span className="ku-chip" data-testid="resource-detail-keyboard-hint" title="상세 패널에 포커스가 있을 때만 동작합니다">
              J/K 이동 · O 열기 · E 펼치기 · C 접기 · R 기본 · 1-9 이동
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={handleExpandAllDetailSections}
              disabled={allDetailSectionsOpen}
              aria-pressed={allDetailSectionsOpen}
              aria-label="모든 리소스 상세 섹션 펼치기"
              data-testid="resource-detail-expand-all"
            >
              전체 펼치기
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={handleCollapseAllDetailSections}
              disabled={noDetailSectionsOpen}
              aria-pressed={noDetailSectionsOpen}
              aria-label="모든 리소스 상세 섹션 접기"
              data-testid="resource-detail-collapse-all"
            >
              전체 접기
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.06)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={handleResetDetailSections}
              disabled={defaultDetailSectionsOpen}
              aria-pressed={defaultDetailSectionsOpen}
              aria-label="리소스 상세 기본 섹션만 펼치기"
              data-testid="resource-detail-reset-sections"
            >
              기본 섹션
            </button>
          </div>
        </div>
        <ResourceDetailSectionNavigator
          activeId={activeDetailSectionId}
          openSections={openSections}
          sections={detailNavigatorSections}
          summaries={detailSectionSummaries}
          tones={detailSectionTones}
          onFocusSection={focusDetailSection}
        />
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {detailJumpSections.map((section) => {
            const jumpTone: DetailSectionTone = section.id === 'events' && eventHasWarning ? 'warning' : section.id === 'status' ? healthSectionTone : 'default';
            return (
              <button
                key={section.id}
                className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs font-semibold transition ${
                  activeDetailSectionId === section.id
                    ? jumpTone === 'error'
                      ? 'border-[rgba(255,59,48,0.28)] bg-[rgba(255,59,48,0.12)] text-[#b42318]'
                      : jumpTone === 'warning'
                        ? 'border-[rgba(255,149,0,0.28)] bg-[rgba(255,149,0,0.12)] text-[#9a5a00]'
                        : 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.1)] text-[#0057b8]'
                    : jumpTone === 'error'
                      ? 'border-[rgba(255,59,48,0.22)] bg-[rgba(255,59,48,0.08)] text-[#b42318] hover:bg-[rgba(255,59,48,0.12)]'
                      : jumpTone === 'warning'
                        ? 'border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] text-[#9a5a00] hover:bg-[rgba(255,149,0,0.12)]'
                        : 'border-[rgba(60,60,67,0.12)] bg-white/75 text-[rgba(60,60,67,0.72)] hover:bg-white'
                }`}
                type="button"
                onClick={() => focusDetailSection(section.id)}
                aria-current={activeDetailSectionId === section.id ? 'true' : undefined}
                aria-label={`${section.label} ${detailSectionSummaries[section.id]} 섹션으로 이동`}
                title={`${section.label} 섹션으로 이동`}
              >
                <span>{section.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${
                    jumpTone === 'error'
                      ? 'bg-white/80 text-[#b42318]'
                      : jumpTone === 'warning'
                        ? 'bg-white/80 text-[#9a5a00]'
                        : 'bg-white/70 text-[rgba(60,60,67,0.54)]'
                  }`}
                >
                  {detailSectionSummaries[section.id]}
                </span>
              </button>
            );
          })}
        </div>
        <ResourceDetailOverview items={overviewItems} />
      </div>

      <div className="grid gap-3 p-3">
        <DetailSection id="metadata" icon={FileText} title="Metadata" summary={detailSectionSummaries.metadata} open={isSectionOpen('metadata')} active={activeDetailSectionId === 'metadata'} sectionRef={setDetailSectionRef('metadata')} onFocusSection={() => setActiveDetailSectionId('metadata')} onToggle={() => toggleSection('metadata')}>
          <KeyValueGrid density={resourceDetailDensity} testId="metadata" values={metadataPreview} />
        </DetailSection>
        <DetailSection id="status" icon={Activity} title="Status" summary={detailSectionSummaries.status} tone={healthSectionTone} open={isSectionOpen('status')} active={activeDetailSectionId === 'status'} sectionRef={setDetailSectionRef('status')} onFocusSection={() => setActiveDetailSectionId('status')} onToggle={() => toggleSection('status')}>
          <HealthSignalPanel signals={healthSignals} />
          <KeyValueGrid density={resourceDetailDensity} testId="status" values={statusPreview} />
        </DetailSection>
        <DetailSection id="safe" icon={FileText} title="Safe Preview" summary={detailSectionSummaries.safe} open={isSectionOpen('safe')} active={activeDetailSectionId === 'safe'} sectionRef={setDetailSectionRef('safe')} onFocusSection={() => setActiveDetailSectionId('safe')} onToggle={() => toggleSection('safe')}>
          <div className="grid gap-2">
            <div className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
                <input
                  className="ku-input w-full pl-9"
                  data-testid="safe-preview-search-input"
                  placeholder="Safe Preview 검색"
                  value={safePreviewFilter}
                  onChange={(event) => handleSafePreviewFilterChange(event.target.value)}
                  onKeyDown={handleSafePreviewSearchKeyDown}
                  aria-label="Safe Preview 검색"
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="ku-chip" data-testid="safe-preview-search-count">
                  {safePreviewFilterActive ? `${safePreviewMatches.length} matches` : `${safePreviewEntries.length} items`}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    onClick={() => moveActiveSafePreviewMatch(-1)}
                    disabled={safePreviewMatches.length === 0}
                    data-testid="safe-preview-search-prev"
                    title="이전 Safe Preview match"
                  >
                    이전
                  </button>
                  <button
                    className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    onClick={() => moveActiveSafePreviewMatch(1)}
                    disabled={safePreviewMatches.length === 0}
                    data-testid="safe-preview-search-next"
                    title="다음 Safe Preview match"
                  >
                    다음
                  </button>
                  {safePreviewFilter ? (
                    <button
                      className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                      type="button"
                      onClick={() => handleSafePreviewFilterChange('')}
                      data-testid="safe-preview-search-clear"
                    >
                      초기화
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            {safePreviewFilterActive ? (
              <p className="ku-meta" data-testid="safe-preview-search-status">
                {safePreviewMatches.length > 0 ? `검색 결과 ${Math.min(activeSafePreviewMatchIndex + 1, safePreviewMatches.length)} / ${safePreviewMatches.length}` : '검색 결과 0개'}
              </p>
            ) : null}
            <KeyValueGrid
              activeMatch={activeSafePreviewMatch}
              density={resourceDetailDensity}
              filter={safePreviewFilter}
              filteredEmpty="일치하는 Safe Preview 항목 없음"
              testId="safe"
              values={summaryPreview}
            />
          </div>
        </DetailSection>
        <DetailSection id="yaml" icon={FileText} title="YAML Preview" summary={detailSectionSummaries.yaml} open={isSectionOpen('yaml')} active={activeDetailSectionId === 'yaml'} sectionRef={setDetailSectionRef('yaml')} onFocusSection={() => setActiveDetailSectionId('yaml')} onToggle={() => toggleSection('yaml')}>
          {yamlPreview ? (
            <pre className={`max-h-[360px] overflow-auto rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-[#111827] font-mono text-[#d1d5db] ${resourceDetailDensity === 'compact' ? 'p-2 text-[10px] leading-4' : 'p-3 text-[11px] leading-5'}`}>{yamlPreview}</pre>
          ) : (
            <p className="ku-meta">표시할 YAML preview가 없습니다.</p>
          )}
        </DetailSection>
        <DetailSection id="labels" icon={Tags} title="Labels" summary={detailSectionSummaries.labels} open={isSectionOpen('labels')} active={activeDetailSectionId === 'labels'} sectionRef={setDetailSectionRef('labels')} onFocusSection={() => setActiveDetailSectionId('labels')} onToggle={() => toggleSection('labels')}>
          <KeyValueGrid density={resourceDetailDensity} empty="labels 없음" testId="labels" values={resource.labels} />
        </DetailSection>
        <DetailSection id="annotations" icon={Tags} title="Annotations" summary={detailSectionSummaries.annotations} open={isSectionOpen('annotations')} active={activeDetailSectionId === 'annotations'} sectionRef={setDetailSectionRef('annotations')} onFocusSection={() => setActiveDetailSectionId('annotations')} onToggle={() => toggleSection('annotations')}>
          <KeyValueGrid density={resourceDetailDensity} empty="annotations 없음" testId="annotations" values={resource.annotations} />
        </DetailSection>
        <ResourceRelationsSection
          active={activeDetailSectionId === 'relations'}
          expanded={relationsExpanded}
          filter={relationFilter}
          filteredRelations={filteredRelations}
          groups={relationGroups}
          hiddenCount={hiddenRelationCount}
          normalizedFilter={normalizedRelationFilter}
          onFilterChange={setRelationFilter}
          onFocusSection={() => setActiveDetailSectionId('relations')}
          onOpenTopologyNode={onOpenTopologyNode}
          onSelectNode={onSelectNode}
          onToggle={() => toggleSection('relations')}
          onToggleExpanded={() => setRelationsExpanded((current) => !current)}
          open={isSectionOpen('relations')}
          resource={resource}
          sectionRef={setDetailSectionRef('relations')}
          summary={detailSectionSummaries.relations}
        />
        <ResourceEventsSection
          actions={{
            clearNewEvents: handleClearNewEvents,
            dismissNotification: () => setEventNotificationNotice(null),
            download: handleDownloadEvents,
            focusSection: () => setActiveDetailSectionId('events'),
            refresh: handleRefreshEvents,
            resetControls: () => {
              setEventFilter('');
              setEventSeverityFilter('all');
              setEventTimeRangeFilter('all');
              setEventSortOrder('newest');
              setPinnedEventKeys(new Set());
              setShowNewEventsOnly(false);
            },
            setFilter: setEventFilter,
            setSeverityFilter: setEventSeverityFilter,
            setShowNewOnly: setShowNewEventsOnly,
            setSortOrder: setEventSortOrder,
            setTimeRangeFilter: setEventTimeRangeFilter,
            showNewEvents: handleShowNewEvents,
            toggleAutoRefresh: handleEventsAutoRefreshToggle,
            toggleNotifications: handleEventsWarningNotificationsToggle,
            togglePinned: togglePinnedEvent,
            toggleSection: () => toggleSection('events'),
          }}
          model={{
            active: activeDetailSectionId === 'events',
            autoRefreshActive: eventsAutoRefreshActive,
            canExport: canExportEvents,
            canRefresh: canRefreshEvents,
            controlsActive: Boolean(eventControlsActive),
            error: eventsError,
            eventFilter,
            events,
            filterSummary: eventFilterSummary,
            filteredCount: filteredEvents.length,
            groups: eventGroups,
            hasNewEvents,
            lastUpdatedAt: eventsLastUpdatedAt,
            liveEnabled,
            loading: eventsLoading,
            newEventCount,
            newEventKeys,
            notificationNotice: eventNotificationNotice,
            notificationsEnabled: eventsWarningNotificationsEnabled,
            normalizedFilter: normalizedEventFilter,
            open: isSectionOpen('events'),
            pinnedEventKeys,
            pinnedEvents,
            sectionRef: setDetailSectionRef('events'),
            severityCounts: eventSeverityCounts,
            severityFilter: eventSeverityFilter,
            showNewOnly: showNewEventsOnly,
            sortOrder: eventSortOrder,
            summary: detailSectionSummaries.events,
            timeRangeFilter: eventTimeRangeFilter,
            tone: eventHasWarning ? 'warning' : 'default',
            warning: eventsWarning,
          }}
        />
        <ResourceLogsSection
          actions={{
            changeContainer: (value) => {
              stopLogStream();
              setSelectedLogContainer(value);
              clearLogOutput();
            },
            changeFilter: (value) => {
              setLogFilter(value);
              setActiveLogMatchIndex(0);
              setLogCopyStatus(null);
            },
            changePrevious: (value) => {
              stopLogStream();
              setPreviousLogs(value);
              clearLogOutput();
            },
            changeSortOrder: (value) => {
              setLogSortOrder(value);
              setActiveLogMatchIndex(0);
              setLogCopyStatus(null);
            },
            changeTimeRange: (value) => {
              setLogTimeRangeFilter(value);
              setActiveLogMatchIndex(0);
              setLogCopyStatus(null);
            },
            copy: (mode) => void handleCopyLogs(mode),
            download: handleDownloadLogs,
            fetch: () => void handleFetchLogs(),
            focusSection: () => setActiveDetailSectionId('logs'),
            moveMatch: moveActiveLogMatch,
            resetControls: () => {
              setLogFilter('');
              setActiveLogMatchIndex(0);
              setLogTimeRangeFilter('all');
              setLogSortOrder('received');
              setLogCopyStatus(null);
            },
            setDensity: setLogDensity,
            stream: () => void handleStreamLogs(),
            togglePause: logsPaused ? handleResumeLogStream : handlePauseLogStream,
            toggleSection: () => toggleSection('logs'),
          }}
          model={{
            active: activeDetailSectionId === 'logs',
            activeMatch: activeLogMatch || undefined,
            activeMatchNumber: activeLogMatchNumber,
            canCopyAll: canCopyAllLogs,
            canCopyVisible: canCopyVisibleLogs,
            canDownloadAll: canDownloadAllLogs,
            canDownloadVisible: canDownloadVisibleLogs,
            canFetch: canFetchLogs,
            containerOptions: logContainerOptions,
            controlsActive: logControlsActive,
            copyStatus: logCopyStatus,
            density: logDensity,
            effectiveContainer: effectiveLogContainer,
            error: logsError,
            filter: logFilter,
            filterActive: logFilterActive,
            filteredLines: filteredLogLines,
            lineRefs: logLineRefs,
            lines: logLines,
            loading: logsLoading,
            normalizedFilter: normalizedLogFilter,
            open: isSectionOpen('logs'),
            paused: logsPaused,
            pendingCount: pendingLogCount,
            previous: previousLogs,
            rowClassName: logRowClassName,
            searchMatchCount: logSearchMatches.length,
            sectionRef: setDetailSectionRef('logs'),
            sortOrder: logSortOrder,
            streaming: logsStreaming,
            summary: detailSectionSummaries.logs,
            timeRangeFilter: logTimeRangeFilter,
            viewportClassName: logViewportClassName,
            warning: logsWarning,
          }}
        />
      </div>
    </div>
  );
}
