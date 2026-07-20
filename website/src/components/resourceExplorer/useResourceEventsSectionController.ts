import { useMemo } from 'react';
import { downloadTextFile } from '../../features/export/downloadTextFile';
import type { ResourceExplorerItem } from '../../types/resourceExplorer';
import type {
  ResourceEventsSectionActions,
  ResourceEventsSectionModel,
} from './ResourceEventsSection';
import {
  countEventSeverities,
  countNewEvents,
  eventControlSummary,
  eventExportCsv,
  eventExportFileName,
  eventExportJson,
  eventIdentityKey,
  eventSectionSummary,
  filterEvents,
  groupEventsBySeverity,
  sortEventListItems,
} from './resourceDetailActivity';
import type { DetailSectionTone, EventExportFormat } from './resourceDetailTypes';
import { useResourceEventsController } from './useResourceEventsController';

interface ResourceEventsSectionControllerOptions {
  active: boolean;
  liveEnabled: boolean;
  onEnsureOpen: () => void;
  onFocusSection: () => void;
  onToggleSection: () => void;
  open: boolean;
  resource: ResourceExplorerItem;
  sectionRef: (node: HTMLElement | null) => void;
}

export function useResourceEventsSectionController({
  active,
  liveEnabled,
  onEnsureOpen,
  onFocusSection,
  onToggleSection,
  open,
  resource,
  sectionRef,
}: ResourceEventsSectionControllerOptions) {
  const controller = useResourceEventsController({ liveEnabled, resource });
  const baseFilteredEvents = useMemo(
    () => sortEventListItems(
      filterEvents(
        controller.events,
        controller.eventFilter,
        controller.eventSeverityFilter,
        controller.eventTimeRangeFilter,
        Date.now(),
      ),
      controller.eventSortOrder,
      controller.pinnedEventKeys,
    ),
    [
      controller.eventFilter,
      controller.eventSeverityFilter,
      controller.eventSortOrder,
      controller.eventTimeRangeFilter,
      controller.events,
      controller.pinnedEventKeys,
    ],
  );
  const filteredEvents = useMemo(
    () => controller.showNewEventsOnly
      ? baseFilteredEvents.filter((item) => controller.newEventKeys.has(eventIdentityKey(item.event)))
      : baseFilteredEvents,
    [baseFilteredEvents, controller.newEventKeys, controller.showNewEventsOnly],
  );
  const pinnedEvents = useMemo(
    () => filteredEvents.filter((item) => item.pinned),
    [filteredEvents],
  );
  const groups = useMemo(
    () => groupEventsBySeverity(filteredEvents.filter((item) => !item.pinned)),
    [filteredEvents],
  );
  const severityCounts = useMemo(
    () => countEventSeverities(controller.events),
    [controller.events],
  );
  const newEventCount = useMemo(
    () => countNewEvents(controller.events, controller.newEventKeys),
    [controller.events, controller.newEventKeys],
  );
  const hasNewEvents = newEventCount > 0;
  const hasWarning = severityCounts.warning > 0;
  const normalizedFilter = controller.eventFilter.trim();
  const controlsActive = Boolean(
    controller.eventFilter
      || controller.eventSeverityFilter !== 'all'
      || controller.eventTimeRangeFilter !== 'all'
      || controller.eventSortOrder !== 'newest'
      || controller.pinnedEventKeys.size > 0
      || controller.showNewEventsOnly,
  );
  const filterSummary = eventControlSummary(
    controller.eventFilter,
    controller.eventSeverityFilter,
    controller.eventTimeRangeFilter,
    controller.eventSortOrder,
    controller.pinnedEventKeys.size,
    controller.showNewEventsOnly,
  );
  const canRefresh = liveEnabled;
  const autoRefreshActive = canRefresh && controller.eventsAutoRefreshEnabled;
  const canExport = filteredEvents.length > 0;
  const summary = eventSectionSummary(filteredEvents.length, controller.events.length, severityCounts);
  const navigatorTone: DetailSectionTone = controller.eventsError || hasWarning ? 'warning' : 'default';

  const clearNewEvents = () => {
    controller.setEventNotificationNotice(null);
    controller.setNewEventKeys(new Set());
    controller.setShowNewEventsOnly(false);
  };

  const download = (format: EventExportFormat) => {
    if (!canExport) {
      return;
    }
    const content = format === 'csv' ? eventExportCsv(filteredEvents) : eventExportJson(filteredEvents);
    const mimeType = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
    downloadTextFile(content, mimeType, eventExportFileName(resource, format));
  };

  const actions: ResourceEventsSectionActions = {
    clearNewEvents,
    dismissNotification: () => controller.setEventNotificationNotice(null),
    download,
    focusSection: onFocusSection,
    refresh: () => {
      if (!canRefresh || controller.eventsLoading) {
        return;
      }
      onEnsureOpen();
      controller.loadResourceEvents({ preserveExistingEvents: true });
    },
    resetControls: () => {
      controller.setEventFilter('');
      controller.setEventSeverityFilter('all');
      controller.setEventTimeRangeFilter('all');
      controller.setEventSortOrder('newest');
      controller.setPinnedEventKeys(new Set());
      controller.setShowNewEventsOnly(false);
    },
    setFilter: controller.setEventFilter,
    setSeverityFilter: controller.setEventSeverityFilter,
    setShowNewOnly: controller.setShowNewEventsOnly,
    setSortOrder: controller.setEventSortOrder,
    setTimeRangeFilter: controller.setEventTimeRangeFilter,
    showNewEvents: () => {
      if (!hasNewEvents) {
        return;
      }
      onEnsureOpen();
      controller.setShowNewEventsOnly(true);
    },
    toggleAutoRefresh: () => {
      if (!canRefresh) {
        return;
      }
      onEnsureOpen();
      controller.setEventsAutoRefreshEnabled((current) => !current);
    },
    toggleNotifications: () => {
      if (!canRefresh) {
        return;
      }
      onEnsureOpen();
      if (controller.eventsWarningNotificationsEnabled) {
        clearNewEvents();
      }
      controller.setEventsWarningNotificationsEnabled(!controller.eventsWarningNotificationsEnabled);
    },
    togglePinned: (eventId) => {
      controller.setPinnedEventKeys((current) => {
        const next = new Set(current);
        if (next.has(eventId)) {
          next.delete(eventId);
        } else {
          next.add(eventId);
        }
        return next;
      });
    },
    toggleSection: onToggleSection,
  };

  const model: ResourceEventsSectionModel = {
    active,
    autoRefreshActive,
    canExport,
    canRefresh,
    controlsActive,
    error: controller.eventsError,
    eventFilter: controller.eventFilter,
    events: controller.events,
    filterSummary,
    filteredCount: filteredEvents.length,
    groups,
    hasNewEvents,
    lastUpdatedAt: controller.eventsLastUpdatedAt,
    liveEnabled,
    loading: controller.eventsLoading,
    newEventCount,
    newEventKeys: controller.newEventKeys,
    notificationNotice: controller.eventNotificationNotice,
    notificationsEnabled: controller.eventsWarningNotificationsEnabled,
    normalizedFilter,
    open,
    pinnedEventKeys: controller.pinnedEventKeys,
    pinnedEvents,
    sectionRef,
    severityCounts,
    severityFilter: controller.eventSeverityFilter,
    showNewOnly: controller.showNewEventsOnly,
    sortOrder: controller.eventSortOrder,
    summary,
    timeRangeFilter: controller.eventTimeRangeFilter,
    tone: hasWarning ? 'warning' : 'default',
    warning: controller.eventsWarning,
  };

  return {
    actions,
    model,
    navigatorTone,
    severityCounts,
    summary,
  };
}
