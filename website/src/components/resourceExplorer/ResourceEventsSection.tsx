import { AlertTriangle, Boxes, Download, RefreshCw, Search } from 'lucide-react';
import type { ResourceEvent } from '../../types/resourceExplorer';
import { DetailSection, EventSeverityChips, InlineWarning } from './ResourceDetailPrimitives';
import { ResourceEventGroups } from './ResourceEventGroups';
import { formatEventTimestamp, formatRefreshTimestamp } from './resourceDetailActivity';
import { eventTimeRangeOptions } from './resourceDetailTypes';
import type {
  DetailSectionTone,
  EventExportFormat,
  EventGroup,
  EventListItem,
  EventNotificationNotice,
  EventSeverity,
  EventSeverityFilter,
  EventSortOrder,
  EventTimeRangeFilter,
} from './resourceDetailTypes';

export interface ResourceEventsSectionModel {
  active: boolean;
  autoRefreshActive: boolean;
  canExport: boolean;
  canRefresh: boolean;
  controlsActive: boolean;
  error: string;
  eventFilter: string;
  filterSummary: string;
  filteredCount: number;
  groups: EventGroup[];
  hasNewEvents: boolean;
  lastUpdatedAt: number | null;
  liveEnabled: boolean;
  loading: boolean;
  newEventCount: number;
  newEventKeys: Set<string>;
  notificationNotice: EventNotificationNotice | null;
  notificationsEnabled: boolean;
  normalizedFilter: string;
  open: boolean;
  pinnedEventKeys: Set<string>;
  pinnedEvents: EventListItem[];
  sectionRef: (node: HTMLElement | null) => void;
  severityCounts: Record<EventSeverity, number>;
  severityFilter: EventSeverityFilter;
  showNewOnly: boolean;
  sortOrder: EventSortOrder;
  summary: string;
  timeRangeFilter: EventTimeRangeFilter;
  tone: DetailSectionTone;
  warning: string;
  events: ResourceEvent[];
}

export interface ResourceEventsSectionActions {
  clearNewEvents: () => void;
  dismissNotification: () => void;
  download: (format: EventExportFormat) => void;
  focusSection: () => void;
  refresh: () => void;
  resetControls: () => void;
  setFilter: (value: string) => void;
  setSeverityFilter: (value: EventSeverityFilter) => void;
  setShowNewOnly: (value: boolean) => void;
  setSortOrder: (value: EventSortOrder) => void;
  setTimeRangeFilter: (value: EventTimeRangeFilter) => void;
  showNewEvents: () => void;
  toggleAutoRefresh: () => void;
  toggleNotifications: () => void;
  togglePinned: (eventId: string) => void;
  toggleSection: () => void;
}

export function ResourceEventsSection({ actions, model }: { actions: ResourceEventsSectionActions; model: ResourceEventsSectionModel }) {
  const { events } = model;
  return (
    <DetailSection id="events" icon={Boxes} title="Events" summary={model.summary} tone={model.tone} open={model.open} active={model.active} sectionRef={model.sectionRef} onFocusSection={actions.focusSection} onToggle={actions.toggleSection}>
      {model.liveEnabled ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="ku-meta">live Events · 읽기 전용 · 저장 안 함</p>
            {model.loading ? <span className="ku-chip">조회 중</span> : null}
            {model.lastUpdatedAt ? <span className="ku-chip">마지막 조회 {formatRefreshTimestamp(model.lastUpdatedAt)}</span> : null}
            {model.autoRefreshActive ? <span className="ku-chip">자동 갱신 켜짐</span> : null}
            {model.notificationsEnabled && model.canRefresh ? <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#9a5a00]">Warning 알림 켜짐</span> : null}
            {model.hasNewEvents ? (
              <>
                <button className="rounded-full border border-[rgba(255,149,0,0.28)] bg-[rgba(255,149,0,0.14)] px-2 py-1 font-mono text-[10px] font-semibold uppercase text-[#9a5a00] transition hover:bg-[rgba(255,149,0,0.2)]" type="button" onClick={actions.showNewEvents} data-testid="events-new-count" title="새 Warning/Error Events만 보기">
                  NEW {model.newEventCount}
                </button>
                <button className="rounded-full border border-[rgba(255,149,0,0.22)] bg-white/75 px-2 py-1 text-[10px] font-semibold text-[#8a4d00] transition hover:bg-white" type="button" onClick={actions.clearNewEvents} data-testid="events-new-clear" title="새 Event 표시 지우기">
                  NEW 지우기
                </button>
              </>
            ) : null}
            {events.length > 0 ? <EventSeverityChips counts={model.severityCounts} /> : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              className={`inline-flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                model.notificationsEnabled && model.canRefresh
                  ? 'border-[rgba(255,149,0,0.28)] bg-[rgba(255,149,0,0.12)] text-[#8a4d00] hover:bg-[rgba(255,149,0,0.16)]'
                  : 'border-[rgba(60,60,67,0.14)] bg-white/75 text-[rgba(60,60,67,0.72)] hover:bg-white'
              }`}
              type="button"
              onClick={actions.toggleNotifications}
              disabled={!model.canRefresh}
              aria-pressed={model.notificationsEnabled && model.canRefresh}
              data-testid="events-warning-notifications-toggle"
              title="새 Warning/Error Events를 앱 내부 알림으로 표시"
            >
              <AlertTriangle size={14} aria-hidden="true" />
              Warning 알림
            </button>
            <button
              className={`inline-flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                model.autoRefreshActive
                  ? 'border-[rgba(52,199,89,0.24)] bg-[rgba(52,199,89,0.1)] text-[#248a3d] hover:bg-[rgba(52,199,89,0.14)]'
                  : 'border-[rgba(60,60,67,0.14)] bg-white/75 text-[rgba(60,60,67,0.72)] hover:bg-white'
              }`}
              type="button"
              onClick={actions.toggleAutoRefresh}
              disabled={!model.canRefresh}
              aria-pressed={model.autoRefreshActive}
              title="선택한 리소스의 Events를 30초마다 다시 조회"
            >
              <RefreshCw size={14} aria-hidden="true" />
              자동 30초
            </button>
            <button className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.13)] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={actions.refresh} disabled={!model.canRefresh || model.loading} data-testid="events-refresh" title="선택한 리소스의 Events를 다시 조회">
              <RefreshCw className={model.loading ? 'animate-spin' : undefined} size={14} aria-hidden="true" />
              {model.loading ? '조회 중' : '새로고침'}
            </button>
          </div>
        </div>
      ) : null}
      {model.notificationNotice ? (
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2 rounded-[10px] border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] p-2" data-testid="events-notification-banner">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <AlertTriangle size={15} className="text-[#9a5a00]" aria-hidden="true" />
              <p className="text-xs font-semibold text-[#7a4300]">새 Warning/Error Events {model.notificationNotice.count}개</p>
            </div>
            <p className="mt-1 break-words text-xs text-[rgba(60,60,67,0.72)]">
              {model.notificationNotice.reason || 'Event'} · {model.notificationNotice.source || 'source unknown'} · {formatEventTimestamp(model.notificationNotice.timestamp)}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button className="rounded-[9px] border border-[rgba(255,149,0,0.24)] bg-white/75 px-2.5 py-1.5 text-xs font-semibold text-[#8a4d00] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={actions.showNewEvents} disabled={!model.hasNewEvents} data-testid="events-notification-show-new">새 이벤트 보기</button>
            <button className="rounded-[9px] border border-[rgba(255,149,0,0.24)] bg-white/75 px-2.5 py-1.5 text-xs font-semibold text-[#8a4d00] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={actions.clearNewEvents} disabled={!model.hasNewEvents && !model.notificationNotice} data-testid="events-notification-clear">표시 지우기</button>
            <button className="rounded-[9px] border border-[rgba(255,149,0,0.24)] bg-white/75 px-2.5 py-1.5 text-xs font-semibold text-[#8a4d00] transition hover:bg-white" type="button" onClick={actions.dismissNotification} data-testid="events-notification-dismiss">닫기</button>
          </div>
        </div>
      ) : null}
      {model.warning ? <InlineWarning message="이벤트 조회 권한이 없거나 API가 없어 빈 목록으로 표시합니다." /> : null}
      {model.error ? <InlineWarning message={`이벤트 조회 실패: ${model.error}`} /> : null}
      {events.length > 0 ? (
        <div className="mb-2 grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2 lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,1fr)_auto] lg:items-center">
          <div className="grid gap-1.5">
            <div className="grid grid-cols-3 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5">
              {([
                { value: 'all', label: '전체', count: events.length },
                { value: 'warning', label: 'Warning', count: model.severityCounts.warning },
                { value: 'normal', label: 'Normal', count: model.severityCounts.normal },
              ] as const).map((option) => (
                <button key={option.value} className={`rounded-[7px] px-2.5 py-1 text-xs font-semibold transition ${model.severityFilter === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'}`} type="button" onClick={() => actions.setSeverityFilter(option.value)} aria-pressed={model.severityFilter === option.value} title={`${option.label} 이벤트만 보기`}>
                  {option.label} {option.count}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5">
              {eventTimeRangeOptions.map((option) => (
                <button key={option.value} className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${model.timeRangeFilter === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'}`} type="button" onClick={() => actions.setTimeRangeFilter(option.value)} aria-pressed={model.timeRangeFilter === option.value} title={option.value === 'all' ? '모든 이벤트 보기' : `최근 ${option.label} 이벤트만 보기`}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5">
              {([
                { value: 'newest', label: '최신순' },
                { value: 'oldest', label: '오래된순' },
              ] as const).map((option) => (
                <button key={option.value} className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${model.sortOrder === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'}`} type="button" onClick={() => actions.setSortOrder(option.value)} aria-pressed={model.sortOrder === option.value} title={`이벤트 ${option.label} 정렬`}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
            <input className="ku-input w-full pl-9" placeholder="이벤트 필터" value={model.eventFilter} onChange={(event) => actions.setFilter(event.target.value)} />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="ku-chip">{model.filteredCount} / {events.length}</span>
              {model.pinnedEventKeys.size > 0 ? <span className="ku-chip">고정 {model.pinnedEventKeys.size}</span> : null}
              {model.showNewOnly ? <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#9a5a00]">새 이벤트만</span> : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <button className={`inline-flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${model.showNewOnly ? 'border-[rgba(255,149,0,0.28)] bg-[rgba(255,149,0,0.12)] text-[#8a4d00] hover:bg-[rgba(255,149,0,0.16)]' : 'border-[rgba(60,60,67,0.12)] bg-white text-[rgba(60,60,67,0.72)] hover:bg-[rgba(242,242,247,0.9)]'}`} type="button" onClick={() => actions.setShowNewOnly(!model.showNewOnly)} disabled={!model.hasNewEvents} aria-pressed={model.showNewOnly} data-testid="events-new-only-toggle" title="새 Warning/Error Events만 보기">NEW만</button>
              <button className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => actions.download('csv')} disabled={!model.canExport} data-testid="events-export-csv" title="현재 표시된 Events를 CSV로 다운로드"><Download size={14} aria-hidden="true" />CSV</button>
              <button className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => actions.download('json')} disabled={!model.canExport} data-testid="events-export-json" title="현재 표시된 Events를 JSON으로 다운로드"><Download size={14} aria-hidden="true" />JSON</button>
              {model.controlsActive ? <button className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]" type="button" onClick={actions.resetControls}>초기화</button> : null}
            </div>
          </div>
        </div>
      ) : null}
      {model.loading && events.length === 0 ? (
        <p className="ku-meta">이벤트 조회 중...</p>
      ) : events.length === 0 ? (
        <p className="ku-meta">표시할 이벤트가 없습니다.</p>
      ) : model.filteredCount === 0 ? (
        <p className="ku-meta">필터와 일치하는 이벤트가 없습니다.{model.filterSummary ? ` · ${model.filterSummary}` : ''}</p>
      ) : (
        <ResourceEventGroups groups={model.groups} newEventKeys={model.newEventKeys} normalizedFilter={model.normalizedFilter} onTogglePinned={actions.togglePinned} pinnedEvents={model.pinnedEvents} />
      )}
    </DetailSection>
  );
}
