import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchResourceEvents } from '../../services/resourceApi';
import type { ResourceEvent, ResourceExplorerItem } from '../../types/resourceExplorer';
import {
  readEventsAutoRefreshPreference,
  readEventsWarningNotificationsPreference,
  updateEventNotificationState,
  writeEventsAutoRefreshPreference,
  writeEventsWarningNotificationsPreference,
} from './resourceDetailActivity';
import {
  eventsAutoRefreshIntervalMs,
  type EventNotificationNotice,
  type EventSeverityFilter,
  type EventSortOrder,
  type EventTimeRangeFilter,
} from './resourceDetailTypes';

interface ResourceEventsControllerOptions {
  liveEnabled: boolean;
  resource: ResourceExplorerItem;
}

export function useResourceEventsController({ liveEnabled, resource }: ResourceEventsControllerOptions) {
  const [events, setEvents] = useState<ResourceEvent[]>([]);
  const [eventsError, setEventsError] = useState('');
  const [eventsWarning, setEventsWarning] = useState('');
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsLastUpdatedAt, setEventsLastUpdatedAt] = useState<number | null>(null);
  const [eventsAutoRefreshEnabled, setEventsAutoRefreshEnabled] = useState(() => readEventsAutoRefreshPreference());
  const [eventsWarningNotificationsEnabled, setEventsWarningNotificationsEnabled] = useState(() => readEventsWarningNotificationsPreference());
  const [eventNotificationNotice, setEventNotificationNotice] = useState<EventNotificationNotice | null>(null);
  const [newEventKeys, setNewEventKeys] = useState<Set<string>>(() => new Set());
  const [showNewEventsOnly, setShowNewEventsOnly] = useState(false);
  const [eventFilter, setEventFilter] = useState('');
  const [eventSeverityFilter, setEventSeverityFilter] = useState<EventSeverityFilter>('all');
  const [eventTimeRangeFilter, setEventTimeRangeFilter] = useState<EventTimeRangeFilter>('all');
  const [eventSortOrder, setEventSortOrder] = useState<EventSortOrder>('newest');
  const [pinnedEventKeys, setPinnedEventKeys] = useState<Set<string>>(() => new Set());
  const eventsControllerRef = useRef<AbortController | null>(null);
  const eventsRequestIdRef = useRef(0);
  const knownEventKeysRef = useRef<Set<string>>(new Set());
  const knownEventKeysInitializedRef = useRef(false);
  const eventsWarningNotificationsEnabledRef = useRef(eventsWarningNotificationsEnabled);
  const resourceEventsKey = `${resource.kind}:${resource.namespace || '-'}:${resource.name}`;

  const resetEventMarkerState = useCallback(() => {
    setEventNotificationNotice(null);
    setNewEventKeys(new Set());
    setShowNewEventsOnly(false);
    knownEventKeysRef.current = new Set();
    knownEventKeysInitializedRef.current = false;
  }, []);

  const resetResourceEventUiState = useCallback(() => {
    setEventFilter('');
    setEventSeverityFilter('all');
    setEventTimeRangeFilter('all');
    setEventSortOrder('newest');
    setPinnedEventKeys(new Set());
    setEventsLastUpdatedAt(null);
    resetEventMarkerState();
  }, [resetEventMarkerState]);

  const loadResourceEvents = useCallback((options: { preserveExistingEvents?: boolean } = {}) => {
    const requestId = eventsRequestIdRef.current + 1;
    eventsRequestIdRef.current = requestId;
    eventsControllerRef.current?.abort();
    eventsControllerRef.current = null;

    if (!liveEnabled) {
      setEvents([]);
      setEventsError('');
      setEventsWarning('');
      setEventsLoading(false);
      setEventsLastUpdatedAt(null);
      resetEventMarkerState();
      return undefined;
    }

    if (!options.preserveExistingEvents) {
      setEvents([]);
      setEventsLastUpdatedAt(null);
      resetEventMarkerState();
    }

    const controller = new AbortController();
    eventsControllerRef.current = controller;
    setEventsLoading(true);
    setEventsError('');
    setEventsWarning('');

    fetchResourceEvents(resource, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || eventsRequestIdRef.current !== requestId) {
          return;
        }
        const nextEvents = [...response.items].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
        updateEventNotificationState(
          nextEvents,
          knownEventKeysRef,
          knownEventKeysInitializedRef,
          eventsWarningNotificationsEnabledRef.current,
          setEventNotificationNotice,
          setNewEventKeys,
        );
        setEvents(nextEvents);
        setEventsError('');
        setEventsWarning(response.warning || '');
        setEventsLastUpdatedAt(Date.now());
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted || eventsRequestIdRef.current !== requestId) {
          return;
        }
        if (!options.preserveExistingEvents) {
          setEvents([]);
          setEventsLastUpdatedAt(null);
        }
        setEventsError(requestError instanceof Error ? requestError.message : 'resource_events_request_failed');
        setEventsWarning('');
      })
      .finally(() => {
        if (!controller.signal.aborted && eventsRequestIdRef.current === requestId) {
          eventsControllerRef.current = null;
          setEventsLoading(false);
        }
      });

    return controller;
  }, [liveEnabled, resetEventMarkerState, resource]);

  useEffect(() => {
    const controller = loadResourceEvents();
    return () => controller?.abort();
  }, [loadResourceEvents]);

  useEffect(() => {
    writeEventsAutoRefreshPreference(eventsAutoRefreshEnabled);
  }, [eventsAutoRefreshEnabled]);

  useEffect(() => {
    eventsWarningNotificationsEnabledRef.current = eventsWarningNotificationsEnabled;
    writeEventsWarningNotificationsPreference(eventsWarningNotificationsEnabled);
    if (!eventsWarningNotificationsEnabled) {
      resetEventMarkerState();
    }
  }, [eventsWarningNotificationsEnabled, resetEventMarkerState]);

  useEffect(() => {
    if (!eventsAutoRefreshEnabled || !liveEnabled) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      if (!eventsControllerRef.current) {
        loadResourceEvents({ preserveExistingEvents: true });
      }
    }, eventsAutoRefreshIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [eventsAutoRefreshEnabled, liveEnabled, loadResourceEvents, resourceEventsKey]);

  useEffect(() => () => {
    eventsControllerRef.current?.abort();
    eventsControllerRef.current = null;
  }, []);

  return {
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
  };
}
