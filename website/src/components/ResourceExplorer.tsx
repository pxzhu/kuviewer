import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Activity, AlertTriangle, Bookmark, Boxes, ChevronDown, Copy, FileText, GitBranch, Link2, Search, Tags, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { fetchResourceEvents, fetchResourceLogs, fetchResources, resourcesFromSnapshot, streamResourceLogs } from '../services/resourceApi';
import type { ResourceEvent, ResourceExplorerItem } from '../types/resourceExplorer';
import type { TopologySnapshot } from '../types/topology';
import type { TopologySourceMode } from '../features/topology/useTopology';

interface ResourceExplorerProps {
  liveEnabled: boolean;
  selectedNodeId: string;
  snapshot: TopologySnapshot;
  sourceMode: TopologySourceMode;
  onOpenTopologyNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}

const allValue = 'all';
const resourceViewPresetStorageKey = 'kuviewer_resource_view_presets';
const logDensityStorageKey = 'kuviewer_log_density';
const maxResourceViewPresets = 8;
const maxCollapsedRelations = 24;
const defaultOpenDetailSections: DetailSectionId[] = ['metadata', 'status', 'safe', 'relations', 'events'];

type DetailSectionId = 'metadata' | 'status' | 'safe' | 'yaml' | 'labels' | 'annotations' | 'relations' | 'events' | 'logs';
type LogDensity = 'comfortable' | 'compact';
type EventSeverity = 'warning' | 'normal' | 'other';
type EventSeverityFilter = 'all' | 'warning' | 'normal';
type EventTimeRangeFilter = 'all' | '1h' | '6h' | '24h' | '7d';

const detailJumpSections: Array<{ id: DetailSectionId; label: string }> = [
  { id: 'metadata', label: 'Metadata' },
  { id: 'status', label: 'Status' },
  { id: 'safe', label: 'Safe Preview' },
  { id: 'relations', label: 'Relations' },
  { id: 'events', label: 'Events' },
  { id: 'logs', label: 'Logs' },
];
const detailKeyboardSections: DetailSectionId[] = ['metadata', 'status', 'safe', 'yaml', 'labels', 'annotations', 'relations', 'events', 'logs'];
const eventTimeRangeOptions: Array<{ value: EventTimeRangeFilter; label: string; milliseconds?: number }> = [
  { value: 'all', label: '전체' },
  { value: '1h', label: '1h', milliseconds: 60 * 60 * 1000 },
  { value: '6h', label: '6h', milliseconds: 6 * 60 * 60 * 1000 },
  { value: '24h', label: '24h', milliseconds: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7d', milliseconds: 7 * 24 * 60 * 60 * 1000 },
];

interface ResourceViewPreset {
  name: string;
  query: string;
  cluster: string;
  namespace: string;
  kind: string;
  status: string;
  updatedAt: number;
}

interface RelationGroup {
  key: string;
  label: string;
  count: number;
  items: ResourceExplorerItem['related'];
}

interface EventGroup {
  key: EventSeverity;
  label: string;
  count: number;
  items: Array<{ event: ResourceEvent; index: number }>;
}

export function ResourceExplorer({ liveEnabled, selectedNodeId, snapshot, sourceMode, onOpenTopologyNode, onSelectNode }: ResourceExplorerProps) {
  const [query, setQuery] = useState('');
  const [cluster, setCluster] = useState(allValue);
  const [namespace, setNamespace] = useState(allValue);
  const [kind, setKind] = useState(allValue);
  const [status, setStatus] = useState(allValue);
  const [resources, setResources] = useState<ResourceExplorerItem[]>(() => resourcesFromSnapshot(snapshot).items);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewPresets, setViewPresets] = useState<ResourceViewPreset[]>(() => readResourceViewPresets());
  const [presetName, setPresetName] = useState('');
  const [detailFocusRequest, setDetailFocusRequest] = useState(0);
  const resourceRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (sourceMode !== 'live' || !liveEnabled) {
      setResources(resourcesFromSnapshot(snapshot).items);
      setLoading(false);
      setError('');
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchResources(controller.signal)
      .then((list) => setResources(list.items))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : 'resources_request_failed');
          setResources(resourcesFromSnapshot(snapshot).items);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [liveEnabled, snapshot, sourceMode]);

  const clusters = useMemo(() => unique(resources.map((resource) => resource.clusterId)), [resources]);
  const namespaces = useMemo(() => unique(resources.map((resource) => resource.namespace).filter(Boolean) as string[]), [resources]);
  const kinds = useMemo(() => unique(resources.map((resource) => resource.kind)), [resources]);
  const statuses = useMemo(() => unique(resources.map((resource) => resource.status)), [resources]);
  const suggestedPresetName = useMemo(() => suggestedResourceViewPresetName({ query, cluster, namespace, kind, status }), [cluster, kind, namespace, query, status]);
  const filteredResources = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return resources.filter((resource) => {
      const matchesQuery =
        !normalizedQuery ||
        resource.name.toLowerCase().includes(normalizedQuery) ||
        resource.kind.toLowerCase().includes(normalizedQuery) ||
        resource.namespace?.toLowerCase().includes(normalizedQuery) ||
        resource.clusterId.toLowerCase().includes(normalizedQuery) ||
        recordText(resource.labels).includes(normalizedQuery) ||
        recordText(resource.summary).includes(normalizedQuery);
      return (
        matchesQuery &&
        (cluster === allValue || resource.clusterId === cluster) &&
        (namespace === allValue || resource.namespace === namespace || (resource.kind === 'Namespace' && resource.name === namespace)) &&
        (kind === allValue || resource.kind === kind) &&
        (status === allValue || resource.status === status)
      );
    });
  }, [cluster, kind, namespace, query, resources, status]);
  const selectedResource = filteredResources.find((resource) => resource.id === selectedNodeId) || resources.find((resource) => resource.id === selectedNodeId) || filteredResources[0] || resources[0];
  const selectedResourceIndex = selectedResource ? filteredResources.findIndex((resource) => resource.id === selectedResource.id) : -1;

  useEffect(() => {
    if (selectedResource && selectedNodeId !== selectedResource.id) {
      onSelectNode(selectedResource.id);
    }
  }, [onSelectNode, selectedNodeId, selectedResource]);

  const handleSaveViewPreset = () => {
    const nextPreset: ResourceViewPreset = {
      name: (presetName.trim() || suggestedPresetName).slice(0, 80),
      query: query.slice(0, 160),
      cluster,
      namespace,
      kind,
      status,
      updatedAt: Date.now(),
    };
    const nextPresets = upsertResourceViewPreset(viewPresets, nextPreset);
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setPresetName('');
  };

  const handleApplyViewPreset = (preset: ResourceViewPreset) => {
    setQuery(preset.query);
    setCluster(normalizePresetFilterValue(preset.cluster, clusters));
    setNamespace(normalizePresetFilterValue(preset.namespace, namespaces));
    setKind(normalizePresetFilterValue(preset.kind, kinds));
    setStatus(normalizePresetFilterValue(preset.status, statuses));
    onSelectNode('');
  };

  const handleDeleteViewPreset = (presetNameToDelete: string) => {
    const nextPresets = viewPresets.filter((preset) => preset.name !== presetNameToDelete);
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
  };
  const focusResourceRow = (resourceId: string) => {
    window.requestAnimationFrame(() => {
      resourceRowRefs.current[resourceId]?.focus({ preventScroll: true });
    });
  };
  const selectResourceAtIndex = (index: number) => {
    if (filteredResources.length === 0) {
      return;
    }
    const nextIndex = Math.max(0, Math.min(filteredResources.length - 1, index));
    const nextResource = filteredResources[nextIndex];
    onSelectNode(nextResource.id);
    focusResourceRow(nextResource.id);
  };
  const handleResourceListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || isResourceListShortcutTarget(event.target)) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectResourceAtIndex(selectedResourceIndex >= 0 ? selectedResourceIndex + 1 : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectResourceAtIndex(selectedResourceIndex >= 0 ? selectedResourceIndex - 1 : filteredResources.length - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectResourceAtIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectResourceAtIndex(filteredResources.length - 1);
    } else if (event.key === 'Enter' && selectedResource) {
      event.preventDefault();
      setDetailFocusRequest((request) => request + 1);
    }
  };

  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
      <div className="ku-panel overflow-hidden">
        <div className="border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[#1d1d1f]">리소스 탐색</h2>
              <p className="ku-meta mt-1">읽기 전용 Kubernetes 리소스 목록 · Secret value 숨김</p>
            </div>
            <span className="ku-chip">{loading ? '로딩 중' : `${filteredResources.length} / ${resources.length}`}</span>
          </div>
          {error ? <p className="mt-2 text-xs font-semibold text-[#b26a00]">API 오류: {error}</p> : null}
        </div>

        <div className="grid gap-2 border-b border-[rgba(60,60,67,0.1)] p-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={16} />
            <input className="ku-input w-full pl-9" placeholder="리소스 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <ResourceSelect label="Cluster" value={cluster} values={clusters} onChange={setCluster} />
            <ResourceSelect label="Namespace" value={namespace} values={namespaces} onChange={setNamespace} />
            <ResourceSelect label="Kind" value={kind} values={kinds} onChange={setKind} />
            <ResourceSelect label="Status" value={status} values={statuses} onChange={setStatus} />
          </div>
          <div className="grid gap-2 rounded-[12px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="ku-meta">저장된 뷰 · 필터만 브라우저에 저장</p>
              <span className="ku-chip">{viewPresets.length} / {maxResourceViewPresets}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input className="ku-input w-full" placeholder={suggestedPresetName} value={presetName} onChange={(event) => setPresetName(event.target.value)} />
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-[9px] border border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] px-3 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.13)]"
                type="button"
                onClick={handleSaveViewPreset}
              >
                <Bookmark size={14} aria-hidden="true" />
                뷰 저장
              </button>
            </div>
            {viewPresets.length === 0 ? (
              <p className="ku-meta">저장된 뷰 없음</p>
            ) : (
              <div className="grid gap-1.5">
                {viewPresets.map((preset) => (
                  <div key={preset.name} className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.1)] bg-white/78 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-[#1d1d1f]">{preset.name}</p>
                      <p className="mt-0.5 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.54)]">{resourceViewPresetSummary(preset)}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]" type="button" onClick={() => handleApplyViewPreset(preset)}>
                        적용
                      </button>
                      <button className="rounded-[8px] border border-[rgba(255,59,48,0.18)] bg-[rgba(255,59,48,0.06)] p-1.5 text-[#c01f17] transition hover:bg-[rgba(255,59,48,0.1)]" type="button" onClick={() => handleDeleteViewPreset(preset.name)} aria-label={`${preset.name} 삭제`}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          className="max-h-[68vh] overflow-auto p-2 focus:outline-none focus:ring-2 focus:ring-[rgba(0,122,255,0.22)]"
          role="listbox"
          tabIndex={0}
          aria-label="리소스 목록"
          aria-activedescendant={selectedResource && selectedResourceIndex >= 0 ? resourceOptionDomId(selectedResource.id) : undefined}
          onKeyDown={handleResourceListKeyDown}
        >
          {filteredResources.length === 0 ? <p className="ku-meta p-2">필터와 일치하는 리소스가 없습니다.</p> : null}
          {filteredResources.map((resource) => (
            <div
              key={resource.id}
              id={resourceOptionDomId(resource.id)}
              className={`mb-2 w-full cursor-pointer rounded-[12px] border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-[rgba(0,122,255,0.22)] ${
                resource.id === selectedResource?.id
                  ? 'border-[rgba(0,122,255,0.36)] bg-[rgba(0,122,255,0.1)] shadow-[0_0_0_1px_rgba(0,122,255,0.08)]'
                  : 'border-[rgba(60,60,67,0.12)] bg-white/78 hover:bg-white'
              }`}
              ref={(node) => {
                resourceRowRefs.current[resource.id] = node;
              }}
              role="option"
              aria-selected={resource.id === selectedResource?.id}
              data-resource-row="true"
              tabIndex={resource.id === selectedResource?.id ? 0 : -1}
              onClick={() => onSelectNode(resource.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#1d1d1f]">{resource.name}</p>
                  <p className="mt-0.5 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">
                    {resource.namespace ? `${resource.namespace} / ` : ''}
                    {resource.kind}
                  </p>
                </div>
                <span className={statusPillClassName(resource.status)}>{resource.status}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(resource.summary).slice(0, 3).map(([key, value]) => (
                  <span key={key} className="rounded-full bg-[rgba(242,242,247,0.78)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.72)]">
                    {key}:{String(value)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <ResourceExplorerDetail
        liveEnabled={liveEnabled && sourceMode === 'live'}
        resource={selectedResource}
        focusRequest={detailFocusRequest}
        onOpenTopologyNode={onOpenTopologyNode}
        onSelectNode={onSelectNode}
      />
    </section>
  );
}

function ResourceExplorerDetail({
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
  const [events, setEvents] = useState<ResourceEvent[]>([]);
  const [eventsError, setEventsError] = useState('');
  const [eventsWarning, setEventsWarning] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [eventSeverityFilter, setEventSeverityFilter] = useState<EventSeverityFilter>('all');
  const [eventTimeRangeFilter, setEventTimeRangeFilter] = useState<EventTimeRangeFilter>('all');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsError, setLogsError] = useState('');
  const [logsWarning, setLogsWarning] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsStreaming, setLogsStreaming] = useState(false);
  const logsStreamControllerRef = useRef<AbortController | null>(null);
  const [selectedLogContainer, setSelectedLogContainer] = useState('');
  const [previousLogs, setPreviousLogs] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  const [logCopyStatus, setLogCopyStatus] = useState<{ tone: 'success' | 'warning'; message: string } | null>(null);
  const [logDensity, setLogDensity] = useState<LogDensity>(() => readLogDensityPreference());
  const [relationFilter, setRelationFilter] = useState('');
  const [relationsExpanded, setRelationsExpanded] = useState(false);
  const [activeDetailSectionId, setActiveDetailSectionId] = useState<DetailSectionId>('metadata');
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const detailPanelActiveRef = useRef(false);
  const detailSectionRefs = useRef<Partial<Record<DetailSectionId, HTMLElement | null>>>({});
  const [openSections, setOpenSections] = useState<Set<DetailSectionId>>(() => new Set(defaultOpenDetailSections));

  useEffect(() => {
    if (!resource || !liveEnabled) {
      setEvents([]);
      setEventsError('');
      setEventsWarning('');
      return;
    }

    const controller = new AbortController();
    fetchResourceEvents(resource, controller.signal)
      .then((response) => {
        setEvents([...response.items].sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
        setEventsError('');
        setEventsWarning(response.warning || '');
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setEvents([]);
          setEventsError(requestError instanceof Error ? requestError.message : 'resource_events_request_failed');
          setEventsWarning('');
        }
      });
    return () => controller.abort();
  }, [liveEnabled, resource]);

  useEffect(() => {
    logsStreamControllerRef.current?.abort();
    logsStreamControllerRef.current = null;
    setLogLines([]);
    setLogsError('');
    setLogsWarning('');
    setLogsLoading(false);
    setLogsStreaming(false);
    setSelectedLogContainer('');
    setPreviousLogs(false);
    setLogFilter('');
    setLogCopyStatus(null);
    setRelationFilter('');
    setRelationsExpanded(false);
    setEventFilter('');
    setEventSeverityFilter('all');
    setEventTimeRangeFilter('all');
    setActiveDetailSectionId('metadata');
    setOpenSections(new Set(defaultOpenDetailSections));
  }, [resource?.id]);

  useEffect(() => {
    return () => {
      logsStreamControllerRef.current?.abort();
      logsStreamControllerRef.current = null;
    };
  }, []);

  const filteredLogLines = useMemo(() => filterLogLines(logLines, logFilter), [logFilter, logLines]);
  const filteredEvents = useMemo(() => filterEvents(events, eventFilter, eventSeverityFilter, eventTimeRangeFilter, Date.now()), [eventFilter, eventSeverityFilter, eventTimeRangeFilter, events]);
  const eventGroups = useMemo(() => groupEventsBySeverity(filteredEvents), [filteredEvents]);
  const eventSeverityCounts = useMemo(() => countEventSeverities(events), [events]);
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

  useEffect(() => {
    writeLogDensityPreference(logDensity);
  }, [logDensity]);

  useEffect(() => {
    if (!logCopyStatus) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setLogCopyStatus(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [logCopyStatus]);

  useEffect(() => {
    if (focusRequest <= 0) {
      return;
    }
    detailPanelActiveRef.current = true;
    window.requestAnimationFrame(() => {
      detailPanelRef.current?.focus({ preventScroll: false });
    });
  }, [focusRequest]);

  if (!resource) {
    return (
      <div className="ku-panel p-6 text-center">
        <p className="text-sm font-semibold text-[#1d1d1f]">선택된 리소스가 없습니다.</p>
      </div>
    );
  }

  const metadataPreview = recordFromUnknown(resource.preview.metadata);
  const statusPreview = recordFromUnknown(resource.preview.status);
  const summaryPreview = {
    ...recordFromUnknown(resource.preview.summary),
    ...(resource.preview.secretValues ? { secretValues: resource.preview.secretValues } : {}),
  };
  const yamlPreview = typeof resource.preview.safeYaml === 'string' ? resource.preview.safeYaml : '';
  const canFetchLogs = liveEnabled && resource.kind === 'Pod';
  const logContainerOptions = podLogContainerOptions(resource);
  const effectiveLogContainer = selectedLogContainer || logContainerOptions.find((option) => !option.init)?.name || logContainerOptions[0]?.name || '';
  const logFilterActive = normalizedLogFilter.length > 0;
  const canCopyVisibleLogs = filteredLogLines.length > 0;
  const canCopyAllLogs = logFilterActive && logLines.length > 0;
  const relationSummary = normalizedRelationFilter ? `${filteredRelations.length} / ${resource.related.length}` : `${resource.related.length}`;
  const logViewportClassName =
    logDensity === 'compact'
      ? 'max-h-[420px] overflow-auto rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-[#111827] p-1 font-mono text-[10px] leading-4 text-[#d1d5db]'
      : 'max-h-[320px] overflow-auto rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-[#111827] p-2 font-mono text-[11px] leading-5 text-[#d1d5db]';
  const logRowClassName =
    logDensity === 'compact'
      ? 'grid grid-cols-[38px_minmax(0,1fr)] gap-1 rounded-[5px] px-0.5 py-0'
      : 'grid grid-cols-[44px_minmax(0,1fr)] gap-2 rounded-[6px] px-1 py-0.5';
  const isSectionOpen = (id: DetailSectionId) => openSections.has(id);
  const toggleSection = (id: DetailSectionId) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const openSection = (id: DetailSectionId) => {
    setOpenSections((current) => {
      if (current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.add(id);
      return next;
    });
  };
  const focusDetailSection = (id: DetailSectionId) => {
    setActiveDetailSectionId(id);
    openSection(id);
    window.requestAnimationFrame(() => {
      const section = detailSectionRefs.current[id];
      section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      section?.querySelector<HTMLButtonElement>('[data-detail-section-toggle="true"]')?.focus({ preventScroll: true });
    });
  };
  const moveDetailSection = (offset: number) => {
    const currentIndex = detailKeyboardSections.indexOf(activeDetailSectionId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + offset + detailKeyboardSections.length) % detailKeyboardSections.length : 0;
    focusDetailSection(detailKeyboardSections[nextIndex]);
  };
  const handleDetailShortcut = (event: globalThis.KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) {
      return;
    }
    if (event.key === 'j') {
      event.preventDefault();
      moveDetailSection(1);
    } else if (event.key === 'k') {
      event.preventDefault();
      moveDetailSection(-1);
    } else if (event.key === 'o') {
      event.preventDefault();
      toggleSection(activeDetailSectionId);
    }
  };
  const setDetailSectionRef = (id: DetailSectionId) => (node: HTMLElement | null) => {
    detailSectionRefs.current[id] = node;
  };

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
  }, [activeDetailSectionId]);

  const handleFetchLogs = async () => {
    if (!canFetchLogs) {
      return;
    }
    openSection('logs');
    stopLogStream();
    setLogsLoading(true);
    setLogsError('');
    setLogsWarning('');
    setLogCopyStatus(null);
    try {
      const response = await fetchResourceLogs(resource, { container: effectiveLogContainer || undefined, previous: previousLogs });
      setLogLines(response.lines);
      setLogsWarning(response.warning || '');
    } catch (requestError) {
      setLogLines([]);
      setLogsError(requestError instanceof Error ? requestError.message : 'resource_logs_request_failed');
    } finally {
      setLogsLoading(false);
    }
  };

  const stopLogStream = () => {
    logsStreamControllerRef.current?.abort();
    logsStreamControllerRef.current = null;
    setLogsStreaming(false);
  };

  const handleStreamLogs = async () => {
    if (!canFetchLogs || previousLogs) {
      return;
    }
    if (logsStreaming) {
      stopLogStream();
      return;
    }

    const controller = new AbortController();
    logsStreamControllerRef.current = controller;
    openSection('logs');
    setLogLines([]);
    setLogsError('');
    setLogsWarning('');
    setLogCopyStatus(null);
    setLogsStreaming(true);
    try {
      await streamResourceLogs(
        resource,
        {
          container: effectiveLogContainer || undefined,
          previous: false,
          signal: controller.signal,
          tailLines: 200,
        },
        (message) => {
          if (message.warning) {
            setLogsWarning(message.warning);
          }
          if (typeof message.line === 'string') {
            setLogLines((current) => [...current, message.line || ''].slice(-500));
          }
        },
      );
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setLogsError(requestError instanceof Error ? requestError.message : 'resource_logs_stream_failed');
      }
    } finally {
      if (logsStreamControllerRef.current === controller) {
        logsStreamControllerRef.current = null;
        setLogsStreaming(false);
      }
    }
  };

  const handleCopyLogs = async (mode: 'visible' | 'all') => {
    const lines = mode === 'all' ? logLines : filteredLogLines.map(({ line }) => line);
    if (lines.length === 0) {
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setLogCopyStatus({ tone: 'warning', message: '복사할 수 없습니다' });
      return;
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setLogCopyStatus({ tone: 'success', message: `${lines.length}줄 복사됨` });
    } catch {
      setLogCopyStatus({ tone: 'warning', message: '복사할 수 없습니다' });
    }
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
    >
      <div className="border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[#1d1d1f]">{resource.name}</h2>
            <p className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">
              {resource.clusterId} · {resource.namespace ? `${resource.namespace} / ` : ''}
              {resource.kind}
            </p>
          </div>
          <span className={statusPillClassName(resource.status)}>{resource.status}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {detailJumpSections.map((section) => (
            <button
              key={section.id}
              className={`rounded-[8px] border px-2.5 py-1.5 text-xs font-semibold transition ${
                activeDetailSectionId === section.id
                  ? 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.1)] text-[#0057b8]'
                  : 'border-[rgba(60,60,67,0.12)] bg-white/75 text-[rgba(60,60,67,0.72)] hover:bg-white'
              }`}
              type="button"
              onClick={() => focusDetailSection(section.id)}
              aria-current={activeDetailSectionId === section.id ? 'true' : undefined}
              title={`${section.label} 섹션으로 이동`}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 p-3">
        <DetailSection icon={FileText} title="Metadata" summary={sectionCount(metadataPreview)} open={isSectionOpen('metadata')} active={activeDetailSectionId === 'metadata'} sectionRef={setDetailSectionRef('metadata')} onFocusSection={() => setActiveDetailSectionId('metadata')} onToggle={() => toggleSection('metadata')}>
          <KeyValueGrid values={metadataPreview} />
        </DetailSection>
        <DetailSection icon={Activity} title="Status" summary={sectionCount(statusPreview)} open={isSectionOpen('status')} active={activeDetailSectionId === 'status'} sectionRef={setDetailSectionRef('status')} onFocusSection={() => setActiveDetailSectionId('status')} onToggle={() => toggleSection('status')}>
          <KeyValueGrid values={statusPreview} />
        </DetailSection>
        <DetailSection icon={FileText} title="Safe Preview" summary={sectionCount(summaryPreview)} open={isSectionOpen('safe')} active={activeDetailSectionId === 'safe'} sectionRef={setDetailSectionRef('safe')} onFocusSection={() => setActiveDetailSectionId('safe')} onToggle={() => toggleSection('safe')}>
          <KeyValueGrid values={summaryPreview} />
        </DetailSection>
        <DetailSection icon={FileText} title="YAML Preview" summary={yamlPreview ? 'available' : 'empty'} open={isSectionOpen('yaml')} active={activeDetailSectionId === 'yaml'} sectionRef={setDetailSectionRef('yaml')} onFocusSection={() => setActiveDetailSectionId('yaml')} onToggle={() => toggleSection('yaml')}>
          {yamlPreview ? (
            <pre className="max-h-[360px] overflow-auto rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-[#111827] p-3 font-mono text-[11px] leading-5 text-[#d1d5db]">{yamlPreview}</pre>
          ) : (
            <p className="ku-meta">표시할 YAML preview가 없습니다.</p>
          )}
        </DetailSection>
        <DetailSection icon={Tags} title="Labels" summary={sectionCount(resource.labels)} open={isSectionOpen('labels')} active={activeDetailSectionId === 'labels'} sectionRef={setDetailSectionRef('labels')} onFocusSection={() => setActiveDetailSectionId('labels')} onToggle={() => toggleSection('labels')}>
          <KeyValueGrid values={resource.labels} empty="labels 없음" />
        </DetailSection>
        <DetailSection icon={Tags} title="Annotations" summary={sectionCount(resource.annotations)} open={isSectionOpen('annotations')} active={activeDetailSectionId === 'annotations'} sectionRef={setDetailSectionRef('annotations')} onFocusSection={() => setActiveDetailSectionId('annotations')} onToggle={() => toggleSection('annotations')}>
          <KeyValueGrid values={resource.annotations} empty="annotations 없음" />
        </DetailSection>
        <DetailSection icon={Link2} title="Relations" summary={relationSummary} open={isSectionOpen('relations')} active={activeDetailSectionId === 'relations'} sectionRef={setDetailSectionRef('relations')} onFocusSection={() => setActiveDetailSectionId('relations')} onToggle={() => toggleSection('relations')}>
          {resource.related.length === 0 ? (
            <p className="ku-meta">관계 없음</p>
          ) : (
            <div className="grid gap-2">
              <div className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
                  <input className="ku-input w-full pl-9" placeholder="관계 검색" value={relationFilter} onChange={(event) => setRelationFilter(event.target.value)} />
                </label>
                <div className="flex items-center justify-between gap-2">
                  <span className="ku-chip">
                    {filteredRelations.length} / {resource.related.length}
                  </span>
                  {relationFilter ? (
                    <button
                      className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                      type="button"
                      onClick={() => setRelationFilter('')}
                    >
                      초기화
                    </button>
                  ) : null}
                </div>
              </div>
              {filteredRelations.length === 0 ? (
                <p className="ku-meta">필터와 일치하는 관계가 없습니다.</p>
              ) : (
                <div className="grid gap-2">
                  {relationGroups.map((group) => (
                    <div key={group.key} className="grid gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">
                          {renderHighlightedText(group.label, normalizedRelationFilter)}
                        </p>
                        <span className="ku-chip">{group.count}</span>
                      </div>
                      <div className="grid gap-1.5">
                        {group.items.map((related) => (
                          <div key={`${related.direction}:${related.edgeType}:${related.nodeId}`} className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/75 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                            <button className="min-w-0 text-left" type="button" onClick={() => onSelectNode(related.nodeId)}>
                              <p className="truncate text-xs font-semibold text-[#1d1d1f]">
                                {related.direction === 'outgoing' ? '→' : '←'} {renderHighlightedText(related.name, normalizedRelationFilter)}
                              </p>
                              <p className="mt-0.5 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.58)]">
                                {renderHighlightedText(`${related.edgeType} · ${related.namespace ? `${related.namespace} / ` : ''}${related.kind}`, normalizedRelationFilter)}
                              </p>
                            </button>
                            <button
                              className="inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.06)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)]"
                              type="button"
                              onClick={() => onOpenTopologyNode(related.nodeId)}
                            >
                              <GitBranch size={13} aria-hidden="true" />
                              토폴로지
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {hiddenRelationCount > 0 || relationsExpanded ? (
                    <button
                      className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                      type="button"
                      onClick={() => setRelationsExpanded((current) => !current)}
                    >
                      {relationsExpanded ? '접기' : `+${hiddenRelationCount} more`}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </DetailSection>
        <DetailSection icon={Boxes} title="Events" summary={`${filteredEvents.length} / ${events.length}`} open={isSectionOpen('events')} active={activeDetailSectionId === 'events'} sectionRef={setDetailSectionRef('events')} onFocusSection={() => setActiveDetailSectionId('events')} onToggle={() => toggleSection('events')}>
          {eventsWarning ? <InlineWarning message="이벤트 조회 권한이 없거나 API가 없어 빈 목록으로 표시합니다." /> : null}
          {eventsError ? <InlineWarning message={`이벤트 조회 실패: ${eventsError}`} /> : null}
          {events.length > 0 ? (
            <div className="mb-2 grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2 lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,1fr)_auto] lg:items-center">
              <div className="grid gap-1.5">
                <div className="grid grid-cols-3 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5">
                  {([
                    { value: 'all', label: '전체', count: events.length },
                    { value: 'warning', label: 'Warning', count: eventSeverityCounts.warning },
                    { value: 'normal', label: 'Normal', count: eventSeverityCounts.normal },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      className={`rounded-[7px] px-2.5 py-1 text-xs font-semibold transition ${
                        eventSeverityFilter === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                      }`}
                      type="button"
                      onClick={() => setEventSeverityFilter(option.value)}
                      aria-pressed={eventSeverityFilter === option.value}
                      title={`${option.label} 이벤트만 보기`}
                    >
                      {option.label} {option.count}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5">
                  {eventTimeRangeOptions.map((option) => (
                    <button
                      key={option.value}
                      className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                        eventTimeRangeFilter === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                      }`}
                      type="button"
                      onClick={() => setEventTimeRangeFilter(option.value)}
                      aria-pressed={eventTimeRangeFilter === option.value}
                      title={option.value === 'all' ? '모든 이벤트 보기' : `최근 ${option.label} 이벤트만 보기`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
                <input className="ku-input w-full pl-9" placeholder="이벤트 필터" value={eventFilter} onChange={(event) => setEventFilter(event.target.value)} />
              </label>
              <div className="flex items-center justify-between gap-2">
                <span className="ku-chip">
                  {filteredEvents.length} / {events.length}
                </span>
                {eventFilter || eventSeverityFilter !== 'all' || eventTimeRangeFilter !== 'all' ? (
                  <button
                    className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                    type="button"
                    onClick={() => {
                      setEventFilter('');
                      setEventSeverityFilter('all');
                      setEventTimeRangeFilter('all');
                    }}
                  >
                    초기화
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {events.length === 0 ? (
            <p className="ku-meta">표시할 이벤트가 없습니다.</p>
          ) : filteredEvents.length === 0 ? (
            <p className="ku-meta">필터와 일치하는 이벤트가 없습니다.</p>
          ) : (
            <div className="grid gap-2">
              {eventGroups.map((group) => (
                <div key={group.key} className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">{group.label}</p>
                    <span className="ku-chip">{group.count}</span>
                  </div>
                  <div className="grid gap-2">
                    {group.items.map(({ event, index }) => (
                      <div key={`${event.timestamp}:${event.reason}:${index}`} className="rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/75 p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-[#1d1d1f]">{renderHighlightedText(event.reason || event.type || 'Event', normalizedEventFilter)}</p>
                          <span className={`font-mono text-[10px] font-semibold uppercase ${eventSeverityClassName(eventSeverity(event))}`}>{renderHighlightedText(event.type || 'Normal', normalizedEventFilter)}</span>
                        </div>
                        <p className="mt-1 text-xs text-[rgba(60,60,67,0.72)]">{renderHighlightedText(event.message, normalizedEventFilter)}</p>
                        <p className="mt-1 font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.54)]">
                          {renderHighlightedText(formatEventTimestamp(event.timestamp), normalizedEventFilter)}
                          {event.source ? <> · {renderHighlightedText(event.source, normalizedEventFilter)}</> : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DetailSection>
        <DetailSection icon={FileText} title="Logs" summary={logLines.length > 0 ? `${filteredLogLines.length} / ${logLines.length}` : canFetchLogs ? 'ready' : 'empty'} open={isSectionOpen('logs')} active={activeDetailSectionId === 'logs'} sectionRef={setDetailSectionRef('logs')} onFocusSection={() => setActiveDetailSectionId('logs')} onToggle={() => toggleSection('logs')}>
          {!canFetchLogs ? (
            <p className="ku-meta">Pod 로그 없음</p>
          ) : (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="ku-meta">최근 200줄 · 따라가기 최대 500줄 · 읽기 전용 · 저장 안 함</p>
                {logContainerOptions.length > 1 ? (
                  <select
                    className="ku-select min-w-[180px]"
                    value={effectiveLogContainer}
                    onChange={(event) => {
                      stopLogStream();
                      setSelectedLogContainer(event.target.value);
                      setLogLines([]);
                      setLogsError('');
                      setLogsWarning('');
                      setLogFilter('');
                      setLogCopyStatus(null);
                    }}
                    disabled={logsLoading || logsStreaming}
                  >
                    {logContainerOptions.map((option) => (
                      <option key={`${option.init ? 'init' : 'app'}:${option.name}`} value={option.name}>
                        {option.init ? `init: ${option.name}` : option.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <label className="flex items-center gap-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)]">
                  <input
                    className="h-3.5 w-3.5 accent-[#007aff]"
                    type="checkbox"
                    checked={previousLogs}
                    onChange={(event) => {
                      stopLogStream();
                      setPreviousLogs(event.target.checked);
                      setLogLines([]);
                      setLogsError('');
                      setLogsWarning('');
                      setLogFilter('');
                      setLogCopyStatus(null);
                    }}
                    disabled={logsLoading || logsStreaming}
                  />
                  이전 로그
                </label>
                <button
                  className="rounded-[9px] border border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.13)] disabled:cursor-not-allowed disabled:opacity-55"
                  type="button"
                  onClick={handleFetchLogs}
                  disabled={logsLoading || logsStreaming}
                >
                  {logsLoading ? '불러오는 중' : '로그 불러오기'}
                </button>
                <button
                  className="rounded-[9px] border border-[rgba(52,199,89,0.28)] bg-[rgba(52,199,89,0.10)] px-2.5 py-1.5 text-xs font-semibold text-[#19783b] transition hover:bg-[rgba(52,199,89,0.16)] disabled:cursor-not-allowed disabled:opacity-55"
                  type="button"
                  onClick={handleStreamLogs}
                  disabled={logsLoading || previousLogs}
                  title={previousLogs ? '이전 로그는 고정 조회만 지원합니다.' : undefined}
                >
                  {logsStreaming ? '중지' : '따라가기'}
                </button>
                <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5">
                  {(['comfortable', 'compact'] as const).map((density) => (
                    <button
                      key={density}
                      className={`rounded-[7px] px-2.5 py-1 text-xs font-semibold transition ${
                        logDensity === density ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                      }`}
                      type="button"
                      onClick={() => setLogDensity(density)}
                      aria-pressed={logDensity === density}
                    >
                      {density === 'comfortable' ? '기본' : '촘촘'}
                    </button>
                  ))}
                </div>
              </div>
              {effectiveLogContainer ? <p className="ku-meta">컨테이너: {effectiveLogContainer}{previousLogs ? ' · 이전 종료 인스턴스' : logsStreaming ? ' · 실시간 따라가기' : ''}</p> : null}
              {logLines.length > 0 ? (
                <div className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
                    <input
                      className="ku-input w-full pl-9"
                      placeholder="로그 필터"
                      value={logFilter}
                      onChange={(event) => {
                        setLogFilter(event.target.value);
                        setLogCopyStatus(null);
                      }}
                    />
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <span className="ku-chip">
                      {filteredLogLines.length} / {logLines.length}
                    </span>
                    {logFilter ? (
                      <button
                        className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                        type="button"
                        onClick={() => {
                          setLogFilter('');
                          setLogCopyStatus(null);
                        }}
                      >
                        초기화
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {logLines.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-55"
                    type="button"
                    onClick={() => void handleCopyLogs('visible')}
                    disabled={!canCopyVisibleLogs}
                  >
                    <Copy size={13} aria-hidden="true" />
                    표시 로그 복사
                  </button>
                  {canCopyAllLogs ? (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                      type="button"
                      onClick={() => void handleCopyLogs('all')}
                    >
                      <Copy size={13} aria-hidden="true" />
                      전체 로그 복사
                    </button>
                  ) : null}
                  {logCopyStatus ? (
                    <span
                      className={`rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold ${
                        logCopyStatus.tone === 'success'
                          ? 'border-[rgba(52,199,89,0.24)] bg-[rgba(52,199,89,0.1)] text-[#19783b]'
                          : 'border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] text-[#8a4d00]'
                      }`}
                    >
                      {logCopyStatus.message}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {logsWarning ? <InlineWarning message="로그 조회 권한이 없거나 API가 없어 빈 목록으로 표시합니다." /> : null}
              {logsError ? <InlineWarning message={`로그 조회 실패: ${logsError}`} /> : null}
              {logLines.length === 0 ? (
                <p className="ku-meta">표시할 로그가 없습니다.</p>
              ) : filteredLogLines.length === 0 ? (
                <p className="ku-meta">필터와 일치하는 로그가 없습니다.</p>
              ) : (
                <div className={logViewportClassName}>
                  {filteredLogLines.map(({ line, index }) => (
                    <div key={`${index}:${line.slice(0, 16)}`} className={logRowClassName}>
                      <span className="select-none text-right text-[rgba(209,213,219,0.42)]">{index + 1}</span>
                      <span className="min-w-0 whitespace-pre-wrap break-words">{renderHighlightedText(line || ' ', normalizedLogFilter)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DetailSection>
      </div>
    </div>
  );
}

function InlineWarning({ message }: { message: string }) {
  return (
    <p className="mb-2 flex items-start gap-1.5 rounded-[9px] border border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] px-2 py-1.5 text-xs font-semibold text-[#8a4d00]">
      <AlertTriangle className="mt-0.5 shrink-0" size={13} aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

function filterLogLines(lines: string[], filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  return lines.flatMap((line, index) => {
    if (!normalizedFilter || line.toLowerCase().includes(normalizedFilter)) {
      return [{ line, index }];
    }
    return [];
  });
}

function filterEvents(events: ResourceEvent[], filter: string, severityFilter: EventSeverityFilter, timeRangeFilter: EventTimeRangeFilter, nowMs: number) {
  const normalizedFilter = filter.trim().toLowerCase();
  return events.flatMap((event, index) => {
    if ((!normalizedFilter || eventText(event).includes(normalizedFilter)) && eventMatchesSeverityFilter(event, severityFilter) && eventMatchesTimeRangeFilter(event, timeRangeFilter, nowMs)) {
      return [{ event, index }];
    }
    return [];
  });
}

function eventMatchesSeverityFilter(event: ResourceEvent, severityFilter: EventSeverityFilter) {
  if (severityFilter === 'all') {
    return true;
  }
  return eventSeverity(event) === severityFilter;
}

function eventMatchesTimeRangeFilter(event: ResourceEvent, timeRangeFilter: EventTimeRangeFilter, nowMs: number) {
  if (timeRangeFilter === 'all') {
    return true;
  }
  const option = eventTimeRangeOptions.find((candidate) => candidate.value === timeRangeFilter);
  if (!option?.milliseconds) {
    return true;
  }
  const eventMs = Date.parse(event.timestamp);
  if (Number.isNaN(eventMs)) {
    return false;
  }
  return eventMs >= nowMs - option.milliseconds;
}

function eventSeverity(event: ResourceEvent): EventSeverity {
  const normalizedType = event.type.trim().toLowerCase();
  if (normalizedType === 'warning' || normalizedType === 'error') {
    return 'warning';
  }
  if (normalizedType === 'normal') {
    return 'normal';
  }
  return 'other';
}

function countEventSeverities(events: ResourceEvent[]) {
  return events.reduce(
    (counts, event) => {
      counts[eventSeverity(event)] += 1;
      return counts;
    },
    { warning: 0, normal: 0, other: 0 } as Record<EventSeverity, number>,
  );
}

function groupEventsBySeverity(events: Array<{ event: ResourceEvent; index: number }>): EventGroup[] {
  const groups: Record<EventSeverity, EventGroup> = {
    warning: { key: 'warning', label: 'Warning / Error', count: 0, items: [] },
    normal: { key: 'normal', label: 'Normal', count: 0, items: [] },
    other: { key: 'other', label: 'Other', count: 0, items: [] },
  };
  for (const item of events) {
    const severity = eventSeverity(item.event);
    groups[severity].count += 1;
    groups[severity].items.push(item);
  }
  return (['warning', 'normal', 'other'] as const).map((severity) => groups[severity]).filter((group) => group.items.length > 0);
}

function eventSeverityClassName(severity: EventSeverity) {
  if (severity === 'warning') {
    return 'text-[#a05a00]';
  }
  if (severity === 'normal') {
    return 'text-[rgba(60,60,67,0.54)]';
  }
  return 'text-[#636366]';
}

function eventText(event: ResourceEvent) {
  return [event.type, event.reason, event.message, event.source, event.timestamp, formatEventTimestamp(event.timestamp)].join(' ').toLowerCase();
}

function filterRelatedResources(relations: ResourceExplorerItem['related'], filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return relations;
  }
  return relations.filter((relation) => relationText(relation).includes(normalizedFilter));
}

function relationText(relation: ResourceExplorerItem['related'][number]) {
  return [
    relation.name,
    relation.kind,
    relation.namespace || '',
    relation.edgeType,
    relation.direction,
    relation.sourceField,
    relation.direction === 'outgoing' ? 'outgoing from' : 'incoming to',
    relation.direction === 'outgoing' ? '나가는 관계' : '들어오는 관계',
  ]
    .join(' ')
    .toLowerCase();
}

function groupRelatedResources(relations: ResourceExplorerItem['related'], visibleLimit: number): RelationGroup[] {
  const groups = new Map<string, RelationGroup>();
  let visibleCount = 0;
  for (const relation of relations) {
    const key = `${relation.direction}:${relation.edgeType}`;
    const existingGroup = groups.get(key);
    const group =
      existingGroup ||
      ({
        key,
        label: `${relation.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} · ${relation.edgeType}`,
        count: 0,
        items: [],
      } satisfies RelationGroup);
    group.count += 1;
    if (visibleCount < visibleLimit) {
      group.items.push(relation);
      visibleCount += 1;
    }
    groups.set(key, group);
  }
  return Array.from(groups.values()).filter((group) => group.items.length > 0);
}

function renderHighlightedText(text: string, filter: string): ReactNode {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return text || ' ';
  }

  const lowerText = text.toLowerCase();
  const fragments: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(normalizedFilter, cursor);
  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      fragments.push(text.slice(cursor, matchIndex));
    }
    const matchEnd = matchIndex + normalizedFilter.length;
    fragments.push(
      <mark key={`${matchIndex}:${matchEnd}`} className="rounded-[3px] bg-[#ffd60a] px-0.5 text-[#1d1d1f]">
        {text.slice(matchIndex, matchEnd)}
      </mark>,
    );
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(normalizedFilter, cursor);
  }
  if (cursor < text.length) {
    fragments.push(text.slice(cursor));
  }
  return fragments.length > 0 ? fragments : ' ';
}

function sectionCount(values: Record<string, unknown>) {
  const count = Object.entries(values).filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)).length;
  return `${count}`;
}

function ResourceSelect({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="ku-meta">{label}</span>
      <select className="ku-select" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={allValue}>전체</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function readLogDensityPreference(): LogDensity {
  try {
    return window.localStorage.getItem(logDensityStorageKey) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function writeLogDensityPreference(density: LogDensity) {
  try {
    window.localStorage.setItem(logDensityStorageKey, density);
  } catch {
    // Density is only a UI preference; storage failures should not break logs.
  }
}

function readResourceViewPresets(): ResourceViewPreset[] {
  try {
    const rawValue = window.localStorage.getItem(resourceViewPresetStorageKey);
    if (!rawValue) {
      return [];
    }
    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }
    return parsedValue.flatMap(validResourceViewPreset).slice(0, maxResourceViewPresets);
  } catch {
    return [];
  }
}

function writeResourceViewPresets(presets: ResourceViewPreset[]) {
  try {
    window.localStorage.setItem(resourceViewPresetStorageKey, JSON.stringify(presets.slice(0, maxResourceViewPresets)));
  } catch {
    // Presets are a convenience feature; quota/private-mode failures should not break the explorer.
  }
}

function validResourceViewPreset(value: unknown): ResourceViewPreset[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.name !== 'string' ||
    candidate.name.trim() === '' ||
    typeof candidate.query !== 'string' ||
    typeof candidate.cluster !== 'string' ||
    typeof candidate.namespace !== 'string' ||
    typeof candidate.kind !== 'string' ||
    typeof candidate.status !== 'string' ||
    typeof candidate.updatedAt !== 'number'
  ) {
    return [];
  }
  return [
    {
      name: candidate.name.trim().slice(0, 80),
      query: candidate.query.slice(0, 160),
      cluster: candidate.cluster || allValue,
      namespace: candidate.namespace || allValue,
      kind: candidate.kind || allValue,
      status: candidate.status || allValue,
      updatedAt: candidate.updatedAt,
    },
  ];
}

function upsertResourceViewPreset(presets: ResourceViewPreset[], preset: ResourceViewPreset) {
  return [preset, ...presets.filter((existingPreset) => existingPreset.name !== preset.name)].slice(0, maxResourceViewPresets);
}

function normalizePresetFilterValue(value: string, availableValues: string[]) {
  if (value === allValue || availableValues.includes(value)) {
    return value;
  }
  return allValue;
}

function suggestedResourceViewPresetName(filters: Pick<ResourceViewPreset, 'query' | 'cluster' | 'namespace' | 'kind' | 'status'>) {
  const parts = [
    filters.query.trim() ? `검색 ${filters.query.trim()}` : '',
    filters.cluster !== allValue ? filters.cluster : '',
    filters.namespace !== allValue ? filters.namespace : '',
    filters.kind !== allValue ? filters.kind : '',
    filters.status !== allValue ? filters.status : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ').slice(0, 80) : '전체 리소스';
}

function resourceViewPresetSummary(preset: ResourceViewPreset) {
  const parts = [
    preset.query.trim() ? `q:${preset.query.trim()}` : '',
    preset.cluster !== allValue ? `cluster:${preset.cluster}` : '',
    preset.namespace !== allValue ? `ns:${preset.namespace}` : '',
    preset.kind !== allValue ? `kind:${preset.kind}` : '',
    preset.status !== allValue ? `status:${preset.status}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '전체 필터';
}

function resourceOptionDomId(resourceId: string) {
  return `kuviewer-resource-${resourceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function isResourceListShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest('[data-resource-row="true"]')) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'select' || tagName === 'textarea' || tagName === 'button' || target.isContentEditable;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'select' || tagName === 'textarea' || tagName === 'button' || target.isContentEditable;
}

function DetailSection({
  active = false,
  children,
  icon: Icon,
  onFocusSection,
  onToggle,
  open,
  sectionRef,
  summary,
  title,
}: {
  active?: boolean;
  children: ReactNode;
  icon: LucideIcon;
  onFocusSection?: () => void;
  onToggle: () => void;
  open: boolean;
  sectionRef?: (node: HTMLElement | null) => void;
  summary: string;
  title: string;
}) {
  return (
    <section
      ref={sectionRef}
      className={`rounded-[12px] border bg-white/72 transition ${
        active ? 'border-[rgba(0,122,255,0.34)] ring-2 ring-[rgba(0,122,255,0.12)]' : 'border-[rgba(60,60,67,0.12)]'
      }`}
      onFocusCapture={onFocusSection}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <h3 className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.62)]">
          <Icon size={14} aria-hidden="true" />
          <span className="truncate">{title}</span>
        </h3>
        <button
          className="flex shrink-0 items-center gap-1.5 rounded-[8px] px-1.5 py-1 transition hover:bg-[rgba(242,242,247,0.85)]"
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${title} ${open ? '접기' : '펼치기'}`}
          data-detail-section-toggle="true"
        >
          <span className="ku-chip">{summary}</span>
          <ChevronDown className={`text-[rgba(60,60,67,0.48)] transition ${open ? 'rotate-180' : ''}`} size={15} aria-hidden="true" />
        </button>
      </div>
      {open ? <div className="px-3 pb-3">{children}</div> : null}
    </section>
  );
}

function KeyValueGrid({ values, empty = '데이터 없음' }: { values: Record<string, unknown>; empty?: string }) {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0));
  if (entries.length === 0) {
    return <p className="ku-meta">{empty}</p>;
  }
  return (
    <div className="grid gap-1.5">
      {entries.slice(0, 20).map(([key, value]) => (
        <div key={key} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 rounded-[8px] bg-[rgba(242,242,247,0.68)] px-2 py-1.5">
          <span className="truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.58)]">{key}</span>
          <span className="min-w-0 break-words font-mono text-[10px] font-semibold text-[#1d1d1f]">{formatValue(value)}</span>
        </div>
      ))}
    </div>
  );
}

function statusPillClassName(status: string) {
  if (status === 'healthy') {
    return 'shrink-0 rounded-full border border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#248a3d]';
  }
  if (status === 'warning') {
    return 'shrink-0 rounded-full border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#a05a00]';
  }
  if (status === 'error') {
    return 'shrink-0 rounded-full border border-[rgba(255,59,48,0.24)] bg-[rgba(255,59,48,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#c01f17]';
  }
  return 'shrink-0 rounded-full border border-[rgba(142,142,147,0.22)] bg-[rgba(142,142,147,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#636366]';
}

function unique(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function recordText(values: Record<string, unknown>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(' ')
    .toLowerCase();
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : '';
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function podLogContainerOptions(resource: ResourceExplorerItem) {
  const summary = recordFromUnknown(resource.preview.summary);
  const containers = asStringArray(summary.containerNames);
  const initContainers = asStringArray(summary.initContainers);
  return [
    ...containers.map((name) => ({ name, init: false })),
    ...initContainers.map((name) => ({ name, init: true })),
  ];
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function formatEventTimestamp(value: string) {
  if (!value) {
    return 'timestamp unknown';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
