import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Activity, AlertTriangle, ArrowDown, ArrowUp, Bookmark, Boxes, CheckCircle2, ChevronDown, Copy, Download, FileText, GitBranch, Link2, RefreshCw, RotateCcw, Search, Tags, Trash2 } from 'lucide-react';
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
const resourceListDensityStorageKey = 'kuviewer_resource_list_density';
const logDensityStorageKey = 'kuviewer_log_density';
const eventsAutoRefreshStorageKey = 'kuviewer_events_auto_refresh';
const eventsAutoRefreshIntervalMs = 30_000;
const maxResourceViewPresets = 8;
const maxCollapsedRelations = 24;
const defaultOpenDetailSections: DetailSectionId[] = ['metadata', 'status', 'safe', 'relations', 'events'];

type DetailSectionId = 'metadata' | 'status' | 'safe' | 'yaml' | 'labels' | 'annotations' | 'relations' | 'events' | 'logs';
type ResourceListDensity = 'comfortable' | 'compact';
type LogDensity = 'comfortable' | 'compact';
type EventSeverity = 'warning' | 'normal' | 'other';
type EventSeverityFilter = 'all' | 'warning' | 'normal';
type EventTimeRangeFilter = 'all' | '1h' | '6h' | '24h' | '7d';
type LogTimeRangeFilter = EventTimeRangeFilter;
type EventSortOrder = 'newest' | 'oldest';
type LogSortOrder = 'received' | 'newest' | 'oldest';

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
const logSortOptions: Array<{ value: LogSortOrder; label: string }> = [
  { value: 'received', label: '수신순' },
  { value: 'newest', label: '최신순' },
  { value: 'oldest', label: '오래된순' },
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
  items: EventListItem[];
}

interface EventListItem {
  id: string;
  event: ResourceEvent;
  index: number;
  pinned: boolean;
}

interface ParsedLogLine {
  line: string;
  message: string;
  index: number;
  timestamp: string;
  timestampMs: number | null;
}

interface LogSearchMatch {
  id: string;
  lineIndex: number;
  field: 'timestamp' | 'message';
  start: number;
  end: number;
}

interface DetailOverviewItem {
  label: string;
  value: string;
  helper: string;
  tone?: 'default' | 'accent' | 'warning';
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
  const [resourceListDensity, setResourceListDensity] = useState<ResourceListDensity>(() => readResourceListDensityPreference());
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
  const currentPresetFilters = useMemo(() => ({ query, cluster, namespace, kind, status }), [cluster, kind, namespace, query, status]);
  const matchingViewPreset = useMemo(() => viewPresets.find((preset) => resourceViewPresetMatchesFilters(preset, currentPresetFilters)), [currentPresetFilters, viewPresets]);
  const nextPresetName = resourceViewPresetTargetName(presetName, matchingViewPreset?.name || suggestedPresetName);
  const presetNameExists = viewPresets.some((preset) => preset.name === nextPresetName);
  const filtersAreDefault = resourceViewPresetMatchesFilters(
    {
      name: 'default',
      query: '',
      cluster: allValue,
      namespace: allValue,
      kind: allValue,
      status: allValue,
      updatedAt: 0,
    },
    currentPresetFilters,
  );
  const savePresetLabel = matchingViewPreset || presetNameExists ? '뷰 업데이트' : '뷰 저장';
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

  useEffect(() => {
    writeResourceListDensityPreference(resourceListDensity);
  }, [resourceListDensity]);

  const handleSaveViewPreset = () => {
    const nextPreset: ResourceViewPreset = {
      name: nextPresetName,
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
    setPresetName(nextPreset.name);
  };

  const handleApplyViewPreset = (preset: ResourceViewPreset) => {
    setQuery(preset.query);
    setCluster(normalizePresetFilterValue(preset.cluster, clusters));
    setNamespace(normalizePresetFilterValue(preset.namespace, namespaces));
    setKind(normalizePresetFilterValue(preset.kind, kinds));
    setStatus(normalizePresetFilterValue(preset.status, statuses));
    setPresetName(preset.name);
    onSelectNode('');
  };

  const handleDeleteViewPreset = (presetNameToDelete: string) => {
    const nextPresets = viewPresets.filter((preset) => preset.name !== presetNameToDelete);
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    if (presetName.trim() === presetNameToDelete) {
      setPresetName('');
    }
  };
  const handleResetResourceFilters = () => {
    setQuery('');
    setCluster(allValue);
    setNamespace(allValue);
    setKind(allValue);
    setStatus(allValue);
    setPresetName('');
    onSelectNode('');
  };
  const resourceSummaryLimit = resourceListDensity === 'compact' ? 2 : 3;
  const resourceRowClassName = (resource: ResourceExplorerItem) =>
    `${resourceListDensity === 'compact' ? 'mb-1.5 rounded-[10px] px-2 py-2' : 'mb-2 rounded-[12px] p-3'} w-full cursor-pointer border text-left transition focus:outline-none focus:ring-2 focus:ring-[rgba(0,122,255,0.22)] ${
      resource.id === selectedResource?.id
        ? 'border-[rgba(0,122,255,0.36)] bg-[rgba(0,122,255,0.1)] shadow-[0_0_0_1px_rgba(0,122,255,0.08)]'
        : 'border-[rgba(60,60,67,0.12)] bg-white/78 hover:bg-white'
    }`;
  const resourceNameClassName = resourceListDensity === 'compact' ? 'truncate text-xs font-semibold text-[#1d1d1f]' : 'truncate text-sm font-semibold text-[#1d1d1f]';
  const resourceMetaClassName =
    resourceListDensity === 'compact'
      ? 'mt-0.5 truncate font-mono text-[9px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]'
      : 'mt-0.5 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]';
  const resourceSummaryContainerClassName = resourceListDensity === 'compact' ? 'mt-1 flex flex-wrap gap-1' : 'mt-2 flex flex-wrap gap-1.5';
  const resourceSummaryChipClassName =
    resourceListDensity === 'compact'
      ? 'rounded-full bg-[rgba(242,242,247,0.78)] px-1.5 py-0 font-mono text-[9px] font-semibold text-[rgba(60,60,67,0.72)]'
      : 'rounded-full bg-[rgba(242,242,247,0.78)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.72)]';
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
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="리소스 목록 밀도">
                {([
                  { value: 'comfortable', label: '기본' },
                  { value: 'compact', label: '촘촘' },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                      resourceListDensity === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                    }`}
                    data-testid={`resource-list-density-${option.value}`}
                    type="button"
                    onClick={() => setResourceListDensity(option.value)}
                    aria-pressed={resourceListDensity === option.value}
                    title={`리소스 목록 ${option.label} 표시`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <span className="ku-chip">{loading ? '로딩 중' : `${filteredResources.length} / ${resources.length}`}</span>
            </div>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="ku-meta">저장된 뷰 · 필터만 브라우저에 저장</p>
                {matchingViewPreset ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(52,199,89,0.12)] px-2 py-1 text-[10px] font-semibold text-[#14863d]">
                    <CheckCircle2 size={12} aria-hidden="true" />
                    현재 적용됨 · {matchingViewPreset.name}
                  </span>
                ) : (
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${filtersAreDefault ? 'bg-[rgba(60,60,67,0.08)] text-[rgba(60,60,67,0.62)]' : 'bg-[rgba(255,149,0,0.12)] text-[#a45f00]'}`}>
                    {filtersAreDefault ? '기본 필터' : '저장 안 됨'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={handleResetResourceFilters}
                  disabled={filtersAreDefault}
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  필터 초기화
                </button>
                <span className="ku-chip">{viewPresets.length} / {maxResourceViewPresets}</span>
              </div>
            </div>
            {viewPresets.length > 0 ? (
              <div className="flex gap-1.5 overflow-x-auto pb-0.5" aria-label="저장된 뷰 빠른 적용">
                {viewPresets.map((preset) => {
                  const active = resourceViewPresetMatchesFilters(preset, currentPresetFilters);
                  return (
                    <button
                      key={preset.name}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${
                        active
                          ? 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.1)] text-[#0057b8]'
                          : 'border-[rgba(60,60,67,0.12)] bg-white/82 text-[rgba(60,60,67,0.72)] hover:bg-white'
                      }`}
                      type="button"
                      onClick={() => handleApplyViewPreset(preset)}
                      aria-pressed={active}
                      title={`${preset.name} · ${resourceViewPresetSummary(preset)}`}
                    >
                      {active ? <CheckCircle2 size={13} aria-hidden="true" /> : <Bookmark size={13} aria-hidden="true" />}
                      <span>{preset.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {presetNameExists ? <p className="ku-meta">같은 이름으로 저장하면 기존 뷰를 업데이트합니다.</p> : null}
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input className="ku-input w-full" placeholder={suggestedPresetName} value={presetName} onChange={(event) => setPresetName(event.target.value)} />
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-[9px] border border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] px-3 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.13)]"
                type="button"
                onClick={handleSaveViewPreset}
              >
                <Bookmark size={14} aria-hidden="true" />
                {savePresetLabel}
              </button>
            </div>
            {viewPresets.length === 0 ? (
              <p className="ku-meta">저장된 뷰 없음</p>
            ) : (
              <div className="grid gap-1.5">
                {viewPresets.map((preset) => (
                  <div key={preset.name} className={`grid gap-2 rounded-[10px] border p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${resourceViewPresetMatchesFilters(preset, currentPresetFilters) ? 'border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.06)]' : 'border-[rgba(60,60,67,0.1)] bg-white/78'}`}>
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <p className="truncate text-xs font-semibold text-[#1d1d1f]">{preset.name}</p>
                        {resourceViewPresetMatchesFilters(preset, currentPresetFilters) ? <span className="rounded-full bg-[rgba(0,122,255,0.1)] px-1.5 py-0.5 text-[9px] font-semibold text-[#0057b8]">적용됨</span> : null}
                        <span className="rounded-full bg-[rgba(60,60,67,0.06)] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[rgba(60,60,67,0.54)]">{formatPresetUpdatedAt(preset.updatedAt)}</span>
                      </div>
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
              className={resourceRowClassName(resource)}
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
                  <p className={resourceNameClassName}>{resource.name}</p>
                  <p className={resourceMetaClassName}>
                    {resource.namespace ? `${resource.namespace} / ` : ''}
                    {resource.kind}
                  </p>
                </div>
                <span className={statusPillClassName(resource.status)}>{resource.status}</span>
              </div>
              <div className={resourceSummaryContainerClassName}>
                {Object.entries(resource.summary).slice(0, resourceSummaryLimit).map(([key, value]) => (
                  <span key={key} className={resourceSummaryChipClassName}>
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
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsLastUpdatedAt, setEventsLastUpdatedAt] = useState<number | null>(null);
  const [eventsAutoRefreshEnabled, setEventsAutoRefreshEnabled] = useState(() => readEventsAutoRefreshPreference());
  const [eventFilter, setEventFilter] = useState('');
  const [eventSeverityFilter, setEventSeverityFilter] = useState<EventSeverityFilter>('all');
  const [eventTimeRangeFilter, setEventTimeRangeFilter] = useState<EventTimeRangeFilter>('all');
  const [eventSortOrder, setEventSortOrder] = useState<EventSortOrder>('newest');
  const [pinnedEventKeys, setPinnedEventKeys] = useState<Set<string>>(() => new Set());
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsError, setLogsError] = useState('');
  const [logsWarning, setLogsWarning] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsStreaming, setLogsStreaming] = useState(false);
  const logsStreamControllerRef = useRef<AbortController | null>(null);
  const logsPausedRef = useRef(false);
  const pendingLogLinesRef = useRef<string[]>([]);
  const [logsPaused, setLogsPaused] = useState(false);
  const [pendingLogLines, setPendingLogLines] = useState<string[]>([]);
  const [selectedLogContainer, setSelectedLogContainer] = useState('');
  const [previousLogs, setPreviousLogs] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  const [activeLogMatchIndex, setActiveLogMatchIndex] = useState(0);
  const [logTimeRangeFilter, setLogTimeRangeFilter] = useState<LogTimeRangeFilter>('all');
  const [logSortOrder, setLogSortOrder] = useState<LogSortOrder>('received');
  const [logCopyStatus, setLogCopyStatus] = useState<{ tone: 'success' | 'warning'; message: string } | null>(null);
  const [logDensity, setLogDensity] = useState<LogDensity>(() => readLogDensityPreference());
  const [relationFilter, setRelationFilter] = useState('');
  const [relationsExpanded, setRelationsExpanded] = useState(false);
  const [activeDetailSectionId, setActiveDetailSectionId] = useState<DetailSectionId>('metadata');
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const detailPanelActiveRef = useRef(false);
  const detailSectionRefs = useRef<Partial<Record<DetailSectionId, HTMLElement | null>>>({});
  const logLineRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const eventsControllerRef = useRef<AbortController | null>(null);
  const eventsRequestIdRef = useRef(0);
  const [openSections, setOpenSections] = useState<Set<DetailSectionId>>(() => new Set(defaultOpenDetailSections));
  const resourceEventsKey = resource ? `${resource.kind}:${resource.namespace || '-'}:${resource.name}` : '';

  const loadResourceEvents = (options: { preserveExistingEvents?: boolean } = {}) => {
    const requestId = eventsRequestIdRef.current + 1;
    eventsRequestIdRef.current = requestId;
    eventsControllerRef.current?.abort();
    eventsControllerRef.current = null;

    if (!resource || !liveEnabled) {
      setEvents([]);
      setEventsError('');
      setEventsWarning('');
      setEventsLoading(false);
      setEventsLastUpdatedAt(null);
      return undefined;
    }

    if (!options.preserveExistingEvents) {
      setEvents([]);
      setEventsLastUpdatedAt(null);
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
        setEvents([...response.items].sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
        setEventsError('');
        setEventsWarning(response.warning || '');
        setEventsLastUpdatedAt(Date.now());
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted && eventsRequestIdRef.current === requestId) {
          if (!options.preserveExistingEvents) {
            setEvents([]);
            setEventsLastUpdatedAt(null);
          }
          setEventsError(requestError instanceof Error ? requestError.message : 'resource_events_request_failed');
          setEventsWarning('');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && eventsRequestIdRef.current === requestId) {
          eventsControllerRef.current = null;
          setEventsLoading(false);
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = loadResourceEvents();
    return () => {
      controller?.abort();
    };
  }, [liveEnabled, resource]);

  useEffect(() => {
    writeEventsAutoRefreshPreference(eventsAutoRefreshEnabled);
  }, [eventsAutoRefreshEnabled]);

  useEffect(() => {
    if (!eventsAutoRefreshEnabled || !liveEnabled || !resource) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      if (eventsControllerRef.current) {
        return;
      }
      loadResourceEvents({ preserveExistingEvents: true });
    }, eventsAutoRefreshIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [eventsAutoRefreshEnabled, liveEnabled, resourceEventsKey]);

  useEffect(() => {
    logsStreamControllerRef.current?.abort();
    logsStreamControllerRef.current = null;
    setLogLines([]);
    setLogsError('');
    setLogsWarning('');
    setLogsLoading(false);
    setLogsStreaming(false);
    resetLogPauseState();
    setSelectedLogContainer('');
    setPreviousLogs(false);
    setLogFilter('');
    setActiveLogMatchIndex(0);
    setLogTimeRangeFilter('all');
    setLogSortOrder('received');
    setLogCopyStatus(null);
    setRelationFilter('');
    setRelationsExpanded(false);
    setEventFilter('');
    setEventSeverityFilter('all');
    setEventTimeRangeFilter('all');
    setEventSortOrder('newest');
    setPinnedEventKeys(new Set());
    setEventsLastUpdatedAt(null);
    setActiveDetailSectionId('metadata');
    setOpenSections(new Set(defaultOpenDetailSections));
  }, [resource?.id]);

  useEffect(() => {
    return () => {
      eventsControllerRef.current?.abort();
      eventsControllerRef.current = null;
      logsStreamControllerRef.current?.abort();
      logsStreamControllerRef.current = null;
      logsPausedRef.current = false;
      pendingLogLinesRef.current = [];
    };
  }, []);

  const parsedLogLines = useMemo(() => parseLogLines(logLines), [logLines]);
  const filteredLogLines = useMemo(() => sortLogLines(filterLogLines(parsedLogLines, logFilter, logTimeRangeFilter, Date.now()), logSortOrder), [logFilter, logSortOrder, logTimeRangeFilter, parsedLogLines]);
  const logSearchMatches = useMemo(() => collectLogSearchMatches(filteredLogLines, logFilter), [filteredLogLines, logFilter]);
  const activeLogMatch = logSearchMatches[activeLogMatchIndex] || null;
  const filteredEvents = useMemo(
    () => sortEventListItems(filterEvents(events, eventFilter, eventSeverityFilter, eventTimeRangeFilter, Date.now()), eventSortOrder, pinnedEventKeys),
    [eventFilter, eventSeverityFilter, eventSortOrder, eventTimeRangeFilter, events, pinnedEventKeys],
  );
  const pinnedEvents = useMemo(() => filteredEvents.filter((item) => item.pinned), [filteredEvents]);
  const eventGroups = useMemo(() => groupEventsBySeverity(filteredEvents.filter((item) => !item.pinned)), [filteredEvents]);
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
  const eventControlsActive = eventFilter || eventSeverityFilter !== 'all' || eventTimeRangeFilter !== 'all' || eventSortOrder !== 'newest' || pinnedEventKeys.size > 0;
  const canRefreshEvents = liveEnabled && Boolean(resource);
  const eventsAutoRefreshActive = canRefreshEvents && eventsAutoRefreshEnabled;

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

  useEffect(() => {
    setActiveLogMatchIndex((current) => {
      if (logSearchMatches.length === 0) {
        return 0;
      }
      return Math.min(current, logSearchMatches.length - 1);
    });
  }, [logSearchMatches.length]);

  useEffect(() => {
    if (!activeLogMatch) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      logLineRefs.current[activeLogMatch.lineIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeLogMatch?.id]);

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
    status: sectionCount(statusPreview),
    safe: sectionCount(summaryPreview),
    yaml: yamlPreview ? 'available' : 'empty',
    labels: sectionCount(resource.labels),
    annotations: sectionCount(resource.annotations),
    relations: relationSummary,
    events: `${filteredEvents.length} / ${events.length}`,
    logs: logLines.length > 0 ? `${filteredLogLines.length} / ${logLines.length}` : canFetchLogs ? 'ready' : 'empty',
  };
  const overviewItems = resourceDetailOverviewItems({
    canFetchLogs,
    effectiveLogContainer,
    eventSummary: detailSectionSummaries.events,
    logSummary: detailSectionSummaries.logs,
    labels: resource.labels,
    annotations: resource.annotations,
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
    resetLogPauseState();
    setActiveLogMatchIndex(0);
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

  const stopLogStream = () => {
    logsStreamControllerRef.current?.abort();
    logsStreamControllerRef.current = null;
    setLogsStreaming(false);
    resetLogPauseState();
  };

  const resetLogPauseState = () => {
    logsPausedRef.current = false;
    pendingLogLinesRef.current = [];
    setLogsPaused(false);
    setPendingLogLines([]);
  };

  const appendVisibleLogLine = (line: string) => {
    setLogLines((current) => [...current, line].slice(-500));
  };

  const appendPendingLogLine = (line: string) => {
    pendingLogLinesRef.current = [...pendingLogLinesRef.current, line].slice(-500);
    setPendingLogLines(pendingLogLinesRef.current);
  };

  const handlePauseLogStream = () => {
    if (!logsStreaming) {
      return;
    }
    logsPausedRef.current = true;
    setLogsPaused(true);
    setLogCopyStatus(null);
  };

  const handleResumeLogStream = () => {
    const pendingLines = pendingLogLinesRef.current;
    logsPausedRef.current = false;
    pendingLogLinesRef.current = [];
    setLogsPaused(false);
    setPendingLogLines([]);
    if (pendingLines.length > 0) {
      setLogLines((current) => [...current, ...pendingLines].slice(-500));
    }
    setLogCopyStatus(null);
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
    setActiveLogMatchIndex(0);
    resetLogPauseState();
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
            const nextLine = message.line || '';
            if (logsPausedRef.current) {
              appendPendingLogLine(nextLine);
            } else {
              appendVisibleLogLine(nextLine);
            }
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
        resetLogPauseState();
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
  const handleDownloadLogs = (mode: 'visible' | 'all') => {
    const lines = mode === 'all' ? logLines : filteredLogLines.map(({ line }) => line);
    if (lines.length === 0) {
      return;
    }
    const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = logDownloadFileName(resource, effectiveLogContainer, previousLogs);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
    setLogCopyStatus({ tone: 'success', message: `${lines.length}줄 다운로드 준비됨` });
  };
  const moveActiveLogMatch = (offset: number) => {
    if (logSearchMatches.length === 0) {
      return;
    }
    openSection('logs');
    setActiveLogMatchIndex((current) => (current + offset + logSearchMatches.length) % logSearchMatches.length);
    setLogCopyStatus(null);
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
  const renderEventCard = (item: EventListItem) => {
    const { event, id, pinned } = item;
    return (
      <div
        key={id}
        className={`rounded-[10px] border p-2 ${
          pinned ? 'border-[rgba(0,122,255,0.26)] bg-[rgba(0,122,255,0.06)]' : 'border-[rgba(60,60,67,0.12)] bg-white/75'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 text-xs font-semibold text-[#1d1d1f]">{renderHighlightedText(event.reason || event.type || 'Event', normalizedEventFilter)}</p>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`font-mono text-[10px] font-semibold uppercase ${eventSeverityClassName(eventSeverity(event))}`}>{renderHighlightedText(event.type || 'Normal', normalizedEventFilter)}</span>
            <button
              className={`inline-flex items-center gap-1 rounded-[7px] border px-1.5 py-1 text-[10px] font-semibold transition ${
                pinned
                  ? 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.12)] text-[#0057b8]'
                  : 'border-[rgba(60,60,67,0.12)] bg-white/78 text-[rgba(60,60,67,0.62)] hover:bg-white'
              }`}
              type="button"
              onClick={() => togglePinnedEvent(id)}
              aria-pressed={pinned}
              title={pinned ? '이벤트 고정 해제' : '이벤트 고정'}
            >
              <Bookmark size={12} aria-hidden="true" />
              {pinned ? '고정됨' : '고정'}
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-[rgba(60,60,67,0.72)]">{renderHighlightedText(event.message, normalizedEventFilter)}</p>
        <p className="mt-1 font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.54)]">
          {renderHighlightedText(formatEventTimestamp(event.timestamp), normalizedEventFilter)}
          {event.source ? <> · {renderHighlightedText(event.source, normalizedEventFilter)}</> : ''}
        </p>
      </div>
    );
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
              className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs font-semibold transition ${
                activeDetailSectionId === section.id
                  ? 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.1)] text-[#0057b8]'
                  : 'border-[rgba(60,60,67,0.12)] bg-white/75 text-[rgba(60,60,67,0.72)] hover:bg-white'
              }`}
              type="button"
              onClick={() => focusDetailSection(section.id)}
              aria-current={activeDetailSectionId === section.id ? 'true' : undefined}
              aria-label={`${section.label} ${detailSectionSummaries[section.id]} 섹션으로 이동`}
              title={`${section.label} 섹션으로 이동`}
            >
              <span>{section.label}</span>
              {' '}
              <span className="rounded-full bg-white/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[rgba(60,60,67,0.54)]">{detailSectionSummaries[section.id]}</span>
            </button>
          ))}
        </div>
        <ResourceDetailOverview items={overviewItems} />
      </div>

      <div className="grid gap-3 p-3">
        <DetailSection icon={FileText} title="Metadata" summary={detailSectionSummaries.metadata} open={isSectionOpen('metadata')} active={activeDetailSectionId === 'metadata'} sectionRef={setDetailSectionRef('metadata')} onFocusSection={() => setActiveDetailSectionId('metadata')} onToggle={() => toggleSection('metadata')}>
          <KeyValueGrid values={metadataPreview} />
        </DetailSection>
        <DetailSection icon={Activity} title="Status" summary={detailSectionSummaries.status} open={isSectionOpen('status')} active={activeDetailSectionId === 'status'} sectionRef={setDetailSectionRef('status')} onFocusSection={() => setActiveDetailSectionId('status')} onToggle={() => toggleSection('status')}>
          <KeyValueGrid values={statusPreview} />
        </DetailSection>
        <DetailSection icon={FileText} title="Safe Preview" summary={detailSectionSummaries.safe} open={isSectionOpen('safe')} active={activeDetailSectionId === 'safe'} sectionRef={setDetailSectionRef('safe')} onFocusSection={() => setActiveDetailSectionId('safe')} onToggle={() => toggleSection('safe')}>
          <KeyValueGrid values={summaryPreview} />
        </DetailSection>
        <DetailSection icon={FileText} title="YAML Preview" summary={detailSectionSummaries.yaml} open={isSectionOpen('yaml')} active={activeDetailSectionId === 'yaml'} sectionRef={setDetailSectionRef('yaml')} onFocusSection={() => setActiveDetailSectionId('yaml')} onToggle={() => toggleSection('yaml')}>
          {yamlPreview ? (
            <pre className="max-h-[360px] overflow-auto rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-[#111827] p-3 font-mono text-[11px] leading-5 text-[#d1d5db]">{yamlPreview}</pre>
          ) : (
            <p className="ku-meta">표시할 YAML preview가 없습니다.</p>
          )}
        </DetailSection>
        <DetailSection icon={Tags} title="Labels" summary={detailSectionSummaries.labels} open={isSectionOpen('labels')} active={activeDetailSectionId === 'labels'} sectionRef={setDetailSectionRef('labels')} onFocusSection={() => setActiveDetailSectionId('labels')} onToggle={() => toggleSection('labels')}>
          <KeyValueGrid values={resource.labels} empty="labels 없음" />
        </DetailSection>
        <DetailSection icon={Tags} title="Annotations" summary={detailSectionSummaries.annotations} open={isSectionOpen('annotations')} active={activeDetailSectionId === 'annotations'} sectionRef={setDetailSectionRef('annotations')} onFocusSection={() => setActiveDetailSectionId('annotations')} onToggle={() => toggleSection('annotations')}>
          <KeyValueGrid values={resource.annotations} empty="annotations 없음" />
        </DetailSection>
        <DetailSection icon={Link2} title="Relations" summary={detailSectionSummaries.relations} open={isSectionOpen('relations')} active={activeDetailSectionId === 'relations'} sectionRef={setDetailSectionRef('relations')} onFocusSection={() => setActiveDetailSectionId('relations')} onToggle={() => toggleSection('relations')}>
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
        <DetailSection icon={Boxes} title="Events" summary={detailSectionSummaries.events} open={isSectionOpen('events')} active={activeDetailSectionId === 'events'} sectionRef={setDetailSectionRef('events')} onFocusSection={() => setActiveDetailSectionId('events')} onToggle={() => toggleSection('events')}>
          {liveEnabled ? (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="ku-meta">live Events · 읽기 전용 · 저장 안 함</p>
                {eventsLoading ? <span className="ku-chip">조회 중</span> : null}
                {eventsLastUpdatedAt ? <span className="ku-chip">마지막 조회 {formatRefreshTimestamp(eventsLastUpdatedAt)}</span> : null}
                {eventsAutoRefreshActive ? <span className="ku-chip">자동 갱신 켜짐</span> : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  className={`inline-flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    eventsAutoRefreshActive
                      ? 'border-[rgba(52,199,89,0.24)] bg-[rgba(52,199,89,0.1)] text-[#248a3d] hover:bg-[rgba(52,199,89,0.14)]'
                      : 'border-[rgba(60,60,67,0.14)] bg-white/75 text-[rgba(60,60,67,0.72)] hover:bg-white'
                  }`}
                  type="button"
                  onClick={handleEventsAutoRefreshToggle}
                  disabled={!canRefreshEvents}
                  aria-pressed={eventsAutoRefreshActive}
                  title="선택한 리소스의 Events를 30초마다 다시 조회"
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  자동 30초
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.13)] disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={handleRefreshEvents}
                  disabled={!canRefreshEvents || eventsLoading}
                  title="선택한 리소스의 Events를 다시 조회"
                >
                  <RefreshCw className={eventsLoading ? 'animate-spin' : undefined} size={14} aria-hidden="true" />
                  {eventsLoading ? '조회 중' : '새로고침'}
                </button>
              </div>
            </div>
          ) : null}
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
                <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5">
                  {([
                    { value: 'newest', label: '최신순' },
                    { value: 'oldest', label: '오래된순' },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                        eventSortOrder === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                      }`}
                      type="button"
                      onClick={() => setEventSortOrder(option.value)}
                      aria-pressed={eventSortOrder === option.value}
                      title={`이벤트 ${option.label} 정렬`}
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
                {pinnedEventKeys.size > 0 ? <span className="ku-chip">고정 {pinnedEventKeys.size}</span> : null}
                {eventControlsActive ? (
                  <button
                    className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                    type="button"
                    onClick={() => {
                      setEventFilter('');
                      setEventSeverityFilter('all');
                      setEventTimeRangeFilter('all');
                      setEventSortOrder('newest');
                      setPinnedEventKeys(new Set());
                    }}
                  >
                    초기화
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {eventsLoading && events.length === 0 ? (
            <p className="ku-meta">이벤트 조회 중...</p>
          ) : events.length === 0 ? (
            <p className="ku-meta">표시할 이벤트가 없습니다.</p>
          ) : filteredEvents.length === 0 ? (
            <p className="ku-meta">필터와 일치하는 이벤트가 없습니다.</p>
          ) : (
            <div className="grid gap-2">
              {pinnedEvents.length > 0 ? (
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[#0057b8]">Pinned</p>
                    <span className="ku-chip">{pinnedEvents.length}</span>
                  </div>
                  <div className="grid gap-2">{pinnedEvents.map(renderEventCard)}</div>
                </div>
              ) : null}
              {eventGroups.map((group) => (
                <div key={group.key} className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">{group.label}</p>
                    <span className="ku-chip">{group.count}</span>
                  </div>
                  <div className="grid gap-2">
                    {group.items.map(renderEventCard)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DetailSection>
        <DetailSection icon={FileText} title="Logs" summary={detailSectionSummaries.logs} open={isSectionOpen('logs')} active={activeDetailSectionId === 'logs'} sectionRef={setDetailSectionRef('logs')} onFocusSection={() => setActiveDetailSectionId('logs')} onToggle={() => toggleSection('logs')}>
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
                      setActiveLogMatchIndex(0);
                      setLogTimeRangeFilter('all');
                      setLogSortOrder('received');
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
                      setActiveLogMatchIndex(0);
                      setLogTimeRangeFilter('all');
                      setLogSortOrder('received');
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
                {logsStreaming ? (
                  <button
                    className="rounded-[9px] border border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#8a4d00] transition hover:bg-[rgba(255,149,0,0.13)]"
                    type="button"
                    onClick={logsPaused ? handleResumeLogStream : handlePauseLogStream}
                    data-testid="log-stream-pause-toggle"
                  >
                    {logsPaused ? '재개' : '일시정지'}
                  </button>
                ) : null}
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
              {effectiveLogContainer ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="ku-meta">컨테이너: {effectiveLogContainer}{previousLogs ? ' · 이전 종료 인스턴스' : logsStreaming ? ' · 실시간 따라가기' : ''}</p>
                  {logsPaused ? <span className="ku-chip">일시정지 · {pendingLogCount}줄 대기</span> : null}
                </div>
              ) : null}
              {logLines.length > 0 ? (
                <div className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto] xl:items-center">
                  <div className="grid gap-1.5">
                    <label className="relative block">
                      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
                      <input
                        className="ku-input w-full pl-9"
                        placeholder="로그 필터"
                        value={logFilter}
                        onChange={(event) => {
                          setLogFilter(event.target.value);
                          setActiveLogMatchIndex(0);
                          setLogCopyStatus(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && logFilterActive) {
                            event.preventDefault();
                            moveActiveLogMatch(event.shiftKey ? -1 : 1);
                          }
                        }}
                      />
                    </label>
                    {logFilterActive ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="ku-chip" data-testid="log-search-match-summary">
                          {logSearchMatches.length > 0 ? `${activeLogMatchNumber} / ${logSearchMatches.length} matches` : '0 matches'}
                        </span>
                        <div className="grid grid-cols-2 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white/75 p-0.5" aria-label="로그 검색 매치 이동">
                          <button
                            className="inline-flex items-center justify-center gap-1 rounded-[6px] px-2 py-1 text-[10px] font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
                            type="button"
                            onClick={() => moveActiveLogMatch(-1)}
                            disabled={logSearchMatches.length === 0}
                            aria-label="이전 로그 검색 매치"
                            data-testid="log-search-previous"
                          >
                            <ArrowUp size={12} aria-hidden="true" />
                            이전
                          </button>
                          <button
                            className="inline-flex items-center justify-center gap-1 rounded-[6px] px-2 py-1 text-[10px] font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
                            type="button"
                            onClick={() => moveActiveLogMatch(1)}
                            disabled={logSearchMatches.length === 0}
                            aria-label="다음 로그 검색 매치"
                            data-testid="log-search-next"
                          >
                            <ArrowDown size={12} aria-hidden="true" />
                            다음
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="로그 시간 범위">
                    {eventTimeRangeOptions.map((option) => (
                      <button
                        key={option.value}
                        className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                          logTimeRangeFilter === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                        }`}
                        type="button"
                        onClick={() => {
                          setLogTimeRangeFilter(option.value);
                          setActiveLogMatchIndex(0);
                          setLogCopyStatus(null);
                        }}
                        aria-pressed={logTimeRangeFilter === option.value}
                        data-testid={`log-time-range-${option.value}`}
                        title={option.value === 'all' ? '모든 로그 보기' : `최근 ${option.label} 로그만 보기`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="로그 정렬">
                    {logSortOptions.map((option) => (
                      <button
                        key={option.value}
                        className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                          logSortOrder === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                        }`}
                        type="button"
                        onClick={() => {
                          setLogSortOrder(option.value);
                          setActiveLogMatchIndex(0);
                          setLogCopyStatus(null);
                        }}
                        aria-pressed={logSortOrder === option.value}
                        data-testid={`log-sort-${option.value}`}
                        title={`로그 ${option.label} 보기`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="ku-chip">
                      {filteredLogLines.length} / {logLines.length}
                    </span>
                    {logControlsActive ? (
                      <button
                        className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                        type="button"
                        onClick={() => {
                          setLogFilter('');
                          setActiveLogMatchIndex(0);
                          setLogTimeRangeFilter('all');
                          setLogSortOrder('received');
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
                  <button
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-55"
                    type="button"
                    onClick={() => handleDownloadLogs('visible')}
                    disabled={!canDownloadVisibleLogs}
                  >
                    <Download size={13} aria-hidden="true" />
                    표시 로그 다운로드
                  </button>
                  {canDownloadAllLogs ? (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                      type="button"
                      onClick={() => handleDownloadLogs('all')}
                    >
                      <Download size={13} aria-hidden="true" />
                      전체 로그 다운로드
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
                  {filteredLogLines.map(({ line, message, index, timestamp }) => {
                    const activeTimestampMatch = activeLogMatch?.lineIndex === index && activeLogMatch.field === 'timestamp' ? activeLogMatch : undefined;
                    const activeMessageMatch = activeLogMatch?.lineIndex === index && activeLogMatch.field === 'message' ? activeLogMatch : undefined;
                    const activeRow = Boolean(activeTimestampMatch || activeMessageMatch);
                    return (
                      <div
                        key={`${index}:${line.slice(0, 16)}`}
                        ref={(node) => {
                          logLineRefs.current[index] = node;
                        }}
                        className={`${logRowClassName} ${activeRow ? 'bg-[rgba(255,214,10,0.12)] ring-1 ring-[rgba(255,214,10,0.28)]' : ''}`}
                        data-testid={activeRow ? 'active-log-search-line' : undefined}
                      >
                        <span className="select-none text-right text-[rgba(209,213,219,0.42)]">{index + 1}</span>
                        <span className="min-w-0 whitespace-pre-wrap break-words">
                          {timestamp ? (
                            <span className="mr-2 inline-flex rounded-[5px] bg-[rgba(96,165,250,0.16)] px-1.5 py-0.5 text-[rgba(191,219,254,0.9)]">
                              {renderHighlightedText(formatLogTimestamp(timestamp), normalizedLogFilter, activeTimestampMatch)}
                            </span>
                          ) : null}
                          {renderHighlightedText(message || line || ' ', normalizedLogFilter, activeMessageMatch)}
                        </span>
                      </div>
                    );
                  })}
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

function ResourceDetailOverview({ items }: { items: DetailOverviewItem[] }) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="리소스 상세 요약">
      {items.map((item) => (
        <div key={item.label} className={`min-w-0 rounded-[10px] border px-2.5 py-2 ${detailOverviewToneClassName(item.tone)}`}>
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.04em] text-[rgba(60,60,67,0.52)]">{item.label}</p>
          <p className="mt-1 truncate text-xs font-semibold text-[#1d1d1f]" title={item.value}>
            {item.value}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.56)]" title={item.helper}>
            {item.helper}
          </p>
        </div>
      ))}
    </div>
  );
}

function resourceDetailOverviewItems({
  annotations,
  canFetchLogs,
  effectiveLogContainer,
  eventSummary,
  logSummary,
  labels,
  metadataPreview,
  relationCount,
  resource,
}: {
  annotations: Record<string, string>;
  canFetchLogs: boolean;
  effectiveLogContainer: string;
  eventSummary: string;
  logSummary: string;
  labels: Record<string, string>;
  metadataPreview: Record<string, unknown>;
  relationCount: number;
  resource: ResourceExplorerItem;
}): DetailOverviewItem[] {
  const namespace = resource.namespace || (resource.kind === 'Namespace' ? resource.name : 'cluster-scoped');
  const age = overviewScalar(metadataPreview.age, 'unknown');
  const uid = overviewScalar(metadataPreview.uid, 'unknown');
  const owners = overviewList(metadataPreview.owners, 'none');
  const labelCount = visibleValueCount(labels);
  const annotationCount = visibleValueCount(annotations);
  const logContext = canFetchLogs ? `Logs ${effectiveLogContainer ? `${effectiveLogContainer} · ` : ''}${logSummary}` : 'Logs n/a';
  return [
    {
      label: 'Scope',
      value: namespace,
      helper: `${resource.clusterId} · ${resource.kind}`,
      tone: 'accent',
    },
    {
      label: 'Age / UID',
      value: age,
      helper: `UID ${uid}`,
    },
    {
      label: 'Owner / Tags',
      value: owners,
      helper: `${labelCount} labels · ${annotationCount} annotations`,
    },
    {
      label: 'Signals',
      value: `${relationCount} relations`,
      helper: `Events ${eventSummary} · ${logContext}`,
      tone: relationCount > 0 ? 'accent' : 'default',
    },
  ];
}

function detailOverviewToneClassName(tone: DetailOverviewItem['tone']) {
  if (tone === 'accent') {
    return 'border-[rgba(0,122,255,0.16)] bg-[rgba(0,122,255,0.055)]';
  }
  if (tone === 'warning') {
    return 'border-[rgba(255,149,0,0.18)] bg-[rgba(255,149,0,0.07)]';
  }
  return 'border-[rgba(60,60,67,0.1)] bg-white/70';
}

function overviewScalar(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (Array.isArray(value)) {
    return overviewList(value, fallback);
  }
  if (typeof value === 'object') {
    return fallback;
  }
  return String(value);
}

function overviewList(value: unknown, fallback: string): string {
  if (!Array.isArray(value)) {
    return overviewScalar(value, fallback);
  }
  const values = value.flatMap((item) => {
    if (item === undefined || item === null || item === '') {
      return [];
    }
    if (typeof item === 'object') {
      return [];
    }
    return [String(item)];
  });
  if (values.length === 0) {
    return fallback;
  }
  const visibleValues = values.slice(0, 2).join(', ');
  return values.length > 2 ? `${visibleValues} +${values.length - 2}` : visibleValues;
}

function parseLogLines(lines: string[]): ParsedLogLine[] {
  return lines.map((line, index) => parseLogLine(line, index));
}

function parseLogLine(line: string, index: number): ParsedLogLine {
  const parsed = parseLogTimestampPrefix(line);
  if (!parsed) {
    return { line, message: line, index, timestamp: '', timestampMs: null };
  }
  return {
    line,
    message: parsed.message,
    index,
    timestamp: parsed.timestamp,
    timestampMs: parsed.timestampMs,
  };
}

function parseLogTimestampPrefix(line: string) {
  const leadingWhitespaceLength = line.length - line.trimStart().length;
  const trimmedLine = line.trimStart();
  const match = trimmedLine.match(/^\[?(\d{4}-\d{2}-\d{2}(?:T|\s+)\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)\]?/);
  if (!match) {
    return null;
  }
  const timestamp = match[1];
  const timestampMs = Date.parse(timestamp);
  if (Number.isNaN(timestampMs)) {
    return null;
  }
  const messageStart = leadingWhitespaceLength + match[0].length;
  return {
    timestamp,
    timestampMs,
    message: line.slice(messageStart).replace(/^\s*(?:[-|:])?\s*/, ''),
  };
}

function filterLogLines(lines: ParsedLogLine[], filter: string, timeRangeFilter: LogTimeRangeFilter, nowMs: number) {
  const normalizedFilter = filter.trim().toLowerCase();
  return lines.filter((line) => {
    if (!logMatchesTimeRangeFilter(line, timeRangeFilter, nowMs)) {
      return false;
    }
    return !normalizedFilter || logLineText(line).includes(normalizedFilter);
  });
}

function sortLogLines(lines: ParsedLogLine[], sortOrder: LogSortOrder) {
  if (sortOrder === 'received') {
    return lines;
  }
  return [...lines].sort((left, right) => {
    if (left.timestampMs === null && right.timestampMs !== null) {
      return 1;
    }
    if (left.timestampMs !== null && right.timestampMs === null) {
      return -1;
    }
    if (left.timestampMs === null && right.timestampMs === null) {
      return left.index - right.index;
    }
    if (left.timestampMs !== null && right.timestampMs !== null && left.timestampMs !== right.timestampMs) {
      return sortOrder === 'newest' ? right.timestampMs - left.timestampMs : left.timestampMs - right.timestampMs;
    }
    return left.index - right.index;
  });
}

function logMatchesTimeRangeFilter(line: ParsedLogLine, timeRangeFilter: LogTimeRangeFilter, nowMs: number) {
  if (timeRangeFilter === 'all') {
    return true;
  }
  const option = eventTimeRangeOptions.find((candidate) => candidate.value === timeRangeFilter);
  if (!option?.milliseconds) {
    return true;
  }
  return line.timestampMs !== null && line.timestampMs >= nowMs - option.milliseconds;
}

function logLineText(line: ParsedLogLine) {
  return [line.line, line.message, line.timestamp, line.timestamp ? formatLogTimestamp(line.timestamp) : ''].join(' ').toLowerCase();
}

function collectLogSearchMatches(lines: ParsedLogLine[], filter: string): LogSearchMatch[] {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return [];
  }
  return lines.flatMap((line) => {
    const matches: LogSearchMatch[] = [];
    if (line.timestamp) {
      matches.push(...collectLogSearchMatchesForText(formatLogTimestamp(line.timestamp), normalizedFilter, line.index, 'timestamp'));
    }
    matches.push(...collectLogSearchMatchesForText(line.message || line.line || ' ', normalizedFilter, line.index, 'message'));
    return matches;
  });
}

function collectLogSearchMatchesForText(text: string, normalizedFilter: string, lineIndex: number, field: LogSearchMatch['field']) {
  const lowerText = text.toLowerCase();
  const matches: LogSearchMatch[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(normalizedFilter, cursor);
  while (matchIndex >= 0) {
    const matchEnd = matchIndex + normalizedFilter.length;
    matches.push({
      id: `${lineIndex}:${field}:${matchIndex}:${matchEnd}`,
      lineIndex,
      field,
      start: matchIndex,
      end: matchEnd,
    });
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(normalizedFilter, cursor);
  }
  return matches;
}

function logDownloadFileName(resource: ResourceExplorerItem, container: string, previousLogs: boolean) {
  const namespace = safeFileSlug(resource.namespace || 'cluster', 'cluster');
  const pod = safeFileSlug(resource.name, 'pod');
  const containerName = safeFileSlug(container || 'default', 'default');
  const mode = previousLogs ? 'previous' : 'current';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `kuviewer-logs-${namespace}-${pod}-${containerName}-${mode}-${timestamp}.log`;
}

function safeFileSlug(value: string, fallback: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function filterEvents(events: ResourceEvent[], filter: string, severityFilter: EventSeverityFilter, timeRangeFilter: EventTimeRangeFilter, nowMs: number) {
  const normalizedFilter = filter.trim().toLowerCase();
  return events.flatMap((event, index) => {
    if ((!normalizedFilter || eventText(event).includes(normalizedFilter)) && eventMatchesSeverityFilter(event, severityFilter) && eventMatchesTimeRangeFilter(event, timeRangeFilter, nowMs)) {
      return [
        {
          event,
          id: eventListItemId(event, index),
          index,
          pinned: false,
        },
      ];
    }
    return [];
  });
}

function sortEventListItems(events: EventListItem[], sortOrder: EventSortOrder, pinnedEventKeys: Set<string>) {
  return events
    .map((item) => ({ ...item, pinned: pinnedEventKeys.has(item.id) }))
    .sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1;
      }
      const leftTime = sortableEventTimestamp(left.event);
      const rightTime = sortableEventTimestamp(right.event);
      if (leftTime === null && rightTime !== null) {
        return 1;
      }
      if (leftTime !== null && rightTime === null) {
        return -1;
      }
      if (leftTime === null && rightTime === null) {
        return left.index - right.index;
      }
      if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
        return sortOrder === 'newest' ? rightTime - leftTime : leftTime - rightTime;
      }
      return left.index - right.index;
    });
}

function sortableEventTimestamp(event: ResourceEvent) {
  const value = Date.parse(event.timestamp);
  return Number.isNaN(value) ? null : value;
}

function eventListItemId(event: ResourceEvent, index: number) {
  return [event.timestamp, event.type, event.reason, event.source, event.message, String(index)]
    .map((part) => part.trim())
    .join('\u001f');
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

function groupEventsBySeverity(events: EventListItem[]): EventGroup[] {
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

function renderHighlightedText(text: string, filter: string, activeMatch?: Pick<LogSearchMatch, 'start' | 'end'>): ReactNode {
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
    const active = activeMatch?.start === matchIndex && activeMatch.end === matchEnd;
    fragments.push(
      <mark
        key={`${matchIndex}:${matchEnd}`}
        className={`rounded-[3px] px-0.5 text-[#1d1d1f] ${active ? 'bg-[#ff9500] ring-1 ring-[#ffd60a]' : 'bg-[#ffd60a]'}`}
        data-testid={active ? 'active-log-search-match' : undefined}
      >
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
  return `${visibleValueCount(values)}`;
}

function visibleValueCount(values: Record<string, unknown>) {
  return Object.entries(values).filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)).length;
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

function readResourceListDensityPreference(): ResourceListDensity {
  try {
    return window.localStorage.getItem(resourceListDensityStorageKey) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function writeResourceListDensityPreference(density: ResourceListDensity) {
  try {
    window.localStorage.setItem(resourceListDensityStorageKey, density);
  } catch {
    // Density is only a UI preference; storage failures should not break the explorer.
  }
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

function readEventsAutoRefreshPreference() {
  try {
    return window.localStorage.getItem(eventsAutoRefreshStorageKey) === 'true';
  } catch {
    return false;
  }
}

function writeEventsAutoRefreshPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(eventsAutoRefreshStorageKey, enabled ? 'true' : 'false');
  } catch {
    // Events auto refresh is only a UI preference; storage failures should not break details.
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

function resourceViewPresetTargetName(inputName: string, suggestedName: string) {
  return (inputName.trim() || suggestedName || '전체 리소스').slice(0, 80);
}

function resourceViewPresetMatchesFilters(preset: ResourceViewPreset, filters: Pick<ResourceViewPreset, 'query' | 'cluster' | 'namespace' | 'kind' | 'status'>) {
  return (
    preset.query === filters.query.slice(0, 160) &&
    preset.cluster === filters.cluster &&
    preset.namespace === filters.namespace &&
    preset.kind === filters.kind &&
    preset.status === filters.status
  );
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

function formatPresetUpdatedAt(updatedAt: number) {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return '시각 없음';
  }
  const elapsedMs = Math.max(0, Date.now() - updatedAt);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) {
    return '방금';
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}분 전`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}시간 전`;
  }
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) {
    return `${elapsedDays}일 전`;
  }
  return new Date(updatedAt).toISOString().slice(0, 10);
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

function formatRefreshTimestamp(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '시각 없음';
  }
  const elapsedMs = Math.max(0, Date.now() - value);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) {
    return '방금';
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}분 전`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}시간 전`;
  }
  return new Date(value).toISOString().slice(0, 10);
}

function formatLogTimestamp(value: string) {
  return formatEventTimestamp(value);
}
