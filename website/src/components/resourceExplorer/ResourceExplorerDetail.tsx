import { useEffect, useMemo, useState } from "react";
import type { ResourceExplorerItem } from "../../types/resourceExplorer";
import {
  countEventSeverities,
  countNewEvents,
  downloadTextFile,
  eventControlSummary,
  eventExportCsv,
  eventExportFileName,
  eventExportJson,
  eventIdentityKey,
  eventSectionSummary,
  filterEvents,
  groupEventsBySeverity,
  readResourceDetailDensityPreference,
  recordFromUnknown,
  sortEventListItems,
  writeResourceDetailDensityPreference,
} from './resourceDetailActivity';
import {
  healthSectionSummary,
  healthSignalSectionTone,
  resourceDetailOverviewItems,
  resourceHealthSignals,
  sectionCount,
} from './resourceDetailHealth';
import {
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
import { ResourceExplorerDetailHeader } from './ResourceExplorerDetailHeader';
import { ResourceCoreDetailSections } from './ResourceCoreDetailSections';
import { useResourceDetailSectionsController } from './useResourceDetailSectionsController';
import { useResourceRelationsController } from './useResourceRelationsController';

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
    resumeLogStream,
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
  const {
    expanded: relationsExpanded,
    filter: relationFilter,
    filteredRelations,
    groups: relationGroups,
    hiddenCount: hiddenRelationCount,
    normalizedFilter: normalizedRelationFilter,
    setFilter: setRelationFilter,
    summary: relationSummary,
    toggleExpanded: toggleRelationsExpanded,
  } = useResourceRelationsController(resource);
  const {
    activateDetailPanel,
    activeDetailSectionId,
    detailPanelRef,
    focusDetailSection,
    handleCollapseAllDetailSections,
    handleExpandAllDetailSections,
    handleResetDetailSections,
    isSectionOpen,
    openSection,
    openSections,
    setActiveDetailSectionId,
    setDetailSectionRef,
    toggleSection,
  } = useResourceDetailSectionsController({ focusRequest, resourceId: resource.id });

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
  const normalizedLogFilter = logFilter.trim();
  const normalizedEventFilter = eventFilter.trim();
  const eventControlsActive = eventFilter || eventSeverityFilter !== 'all' || eventTimeRangeFilter !== 'all' || eventSortOrder !== 'newest' || pinnedEventKeys.size > 0 || showNewEventsOnly;
  const eventFilterSummary = eventControlSummary(eventFilter, eventSeverityFilter, eventTimeRangeFilter, eventSortOrder, pinnedEventKeys.size, showNewEventsOnly);
  const canRefreshEvents = liveEnabled && Boolean(resource);
  const eventsAutoRefreshActive = canRefreshEvents && eventsAutoRefreshEnabled;
  const canExportEvents = filteredEvents.length > 0;

  useEffect(() => {
    writeResourceDetailDensityPreference(resourceDetailDensity);
  }, [resourceDetailDensity]);

  const metadataPreview = resource ? recordFromUnknown(resource.preview.metadata) : {};
  const statusPreview = resource ? recordFromUnknown(resource.preview.status) : {};
  const summaryPreview = resource
    ? {
        ...recordFromUnknown(resource.preview.summary),
        ...(resource.preview.secretValues ? { secretValues: resource.preview.secretValues } : {}),
      }
    : {};
  const yamlPreview = resource && typeof resource.preview.safeYaml === 'string' ? resource.preview.safeYaml : '';

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
      onFocusCapture={activateDetailPanel}
      onMouseDownCapture={activateDetailPanel}
      aria-label="리소스 상세 패널"
      data-testid="resource-detail-panel"
    >
      <ResourceExplorerDetailHeader
        activeSectionId={activeDetailSectionId}
        density={resourceDetailDensity}
        eventHasWarning={eventHasWarning}
        healthSectionTone={healthSectionTone}
        onCollapseAll={handleCollapseAllDetailSections}
        onDensityChange={setResourceDetailDensity}
        onExpandAll={handleExpandAllDetailSections}
        onFocusSection={focusDetailSection}
        onResetSections={handleResetDetailSections}
        openSections={openSections}
        overviewItems={overviewItems}
        resource={resource}
        sectionSummaries={detailSectionSummaries}
        sectionTones={detailSectionTones}
      />

      <div className="grid gap-3 p-3">
        <ResourceCoreDetailSections
          activeSectionId={activeDetailSectionId}
          density={resourceDetailDensity}
          healthSectionTone={healthSectionTone}
          healthSignals={healthSignals}
          isSectionOpen={isSectionOpen}
          metadataPreview={metadataPreview}
          onFocusSection={setActiveDetailSectionId}
          onOpenSection={openSection}
          onToggleSection={toggleSection}
          resource={resource}
          sectionRef={setDetailSectionRef}
          sectionSummaries={detailSectionSummaries}
          statusPreview={statusPreview}
          summaryPreview={summaryPreview}
          yamlPreview={yamlPreview}
        />
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
          onToggleExpanded={toggleRelationsExpanded}
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
