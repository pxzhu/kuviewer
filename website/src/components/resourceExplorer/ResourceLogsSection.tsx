import type { MutableRefObject } from 'react';
import { ArrowDown, ArrowUp, Copy, Download, FileText, Search } from 'lucide-react';
import { DetailSection, InlineWarning } from './ResourceDetailPrimitives';
import { ResourceLogLines } from './ResourceLogLines';
import { eventTimeRangeOptions, logSortOptions } from './resourceDetailTypes';
import type { LogDensity, LogSearchMatch, LogSortOrder, LogTimeRangeFilter, ParsedLogLine } from './resourceDetailTypes';

export interface ResourceLogsSectionModel {
  active: boolean;
  activeMatch?: LogSearchMatch;
  activeMatchNumber: number;
  canCopyAll: boolean;
  canCopyVisible: boolean;
  canDownloadAll: boolean;
  canDownloadVisible: boolean;
  canFetch: boolean;
  containerOptions: Array<{ name: string; init: boolean }>;
  controlsActive: boolean;
  copyStatus: { tone: 'success' | 'warning'; message: string } | null;
  density: LogDensity;
  effectiveContainer: string;
  error: string;
  filter: string;
  filterActive: boolean;
  filteredLines: ParsedLogLine[];
  lineRefs: MutableRefObject<Record<number, HTMLDivElement | null>>;
  lines: string[];
  loading: boolean;
  normalizedFilter: string;
  open: boolean;
  paused: boolean;
  pendingCount: number;
  previous: boolean;
  rowClassName: string;
  searchMatchCount: number;
  sectionRef: (node: HTMLElement | null) => void;
  sortOrder: LogSortOrder;
  streaming: boolean;
  summary: string;
  timeRangeFilter: LogTimeRangeFilter;
  viewportClassName: string;
  warning: string;
}

export interface ResourceLogsSectionActions {
  changeContainer: (value: string) => void;
  changeFilter: (value: string) => void;
  changePrevious: (value: boolean) => void;
  changeSortOrder: (value: LogSortOrder) => void;
  changeTimeRange: (value: LogTimeRangeFilter) => void;
  copy: (mode: 'visible' | 'all') => void;
  download: (mode: 'visible' | 'all') => void;
  fetch: () => void;
  focusSection: () => void;
  moveMatch: (offset: number) => void;
  resetControls: () => void;
  setDensity: (value: LogDensity) => void;
  stream: () => void;
  togglePause: () => void;
  toggleSection: () => void;
}

export function ResourceLogsSection({ actions, model }: { actions: ResourceLogsSectionActions; model: ResourceLogsSectionModel }) {
  return (
    <DetailSection id="logs" icon={FileText} title="Logs" summary={model.summary} open={model.open} active={model.active} sectionRef={model.sectionRef} onFocusSection={actions.focusSection} onToggle={actions.toggleSection}>
      {!model.canFetch ? (
        <p className="ku-meta">Pod 로그 없음</p>
      ) : (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="ku-meta">최근 200줄 · 따라가기 최대 500줄 · 읽기 전용 · 저장 안 함</p>
            {model.containerOptions.length > 1 ? (
              <select className="ku-select min-w-[180px]" value={model.effectiveContainer} onChange={(event) => actions.changeContainer(event.target.value)} disabled={model.loading || model.streaming}>
                {model.containerOptions.map((option) => (
                  <option key={`${option.init ? 'init' : 'app'}:${option.name}`} value={option.name}>
                    {option.init ? `init: ${option.name}` : option.name}
                  </option>
                ))}
              </select>
            ) : null}
            <label className="flex items-center gap-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)]">
              <input className="h-3.5 w-3.5 accent-[#007aff]" type="checkbox" checked={model.previous} onChange={(event) => actions.changePrevious(event.target.checked)} disabled={model.loading || model.streaming} />
              이전 로그
            </label>
            <button className="rounded-[9px] border border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.13)] disabled:cursor-not-allowed disabled:opacity-55" type="button" onClick={actions.fetch} disabled={model.loading || model.streaming}>
              {model.loading ? '불러오는 중' : '로그 불러오기'}
            </button>
            <button className="rounded-[9px] border border-[rgba(52,199,89,0.28)] bg-[rgba(52,199,89,0.10)] px-2.5 py-1.5 text-xs font-semibold text-[#19783b] transition hover:bg-[rgba(52,199,89,0.16)] disabled:cursor-not-allowed disabled:opacity-55" type="button" onClick={actions.stream} disabled={model.loading || model.previous} title={model.previous ? '이전 로그는 고정 조회만 지원합니다.' : undefined}>
              {model.streaming ? '중지' : '따라가기'}
            </button>
            {model.streaming ? (
              <button className="rounded-[9px] border border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#8a4d00] transition hover:bg-[rgba(255,149,0,0.13)]" type="button" onClick={actions.togglePause} data-testid="log-stream-pause-toggle">
                {model.paused ? '재개' : '일시정지'}
              </button>
            ) : null}
            <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5">
              {(['comfortable', 'compact'] as const).map((density) => (
                <button key={density} className={`rounded-[7px] px-2.5 py-1 text-xs font-semibold transition ${model.density === density ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'}`} type="button" onClick={() => actions.setDensity(density)} aria-pressed={model.density === density}>
                  {density === 'comfortable' ? '기본' : '촘촘'}
                </button>
              ))}
            </div>
          </div>
          {model.effectiveContainer ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="ku-meta">컨테이너: {model.effectiveContainer}{model.previous ? ' · 이전 종료 인스턴스' : model.streaming ? ' · 실시간 따라가기' : ''}</p>
              {model.paused ? <span className="ku-chip">일시정지 · {model.pendingCount}줄 대기</span> : null}
            </div>
          ) : null}
          {model.lines.length > 0 ? (
            <div className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto] xl:items-center">
              <div className="grid gap-1.5">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
                  <input
                    className="ku-input w-full pl-9"
                    placeholder="로그 필터"
                    value={model.filter}
                    onChange={(event) => actions.changeFilter(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && model.filterActive) {
                        event.preventDefault();
                        actions.moveMatch(event.shiftKey ? -1 : 1);
                      }
                    }}
                  />
                </label>
                {model.filterActive ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="ku-chip" data-testid="log-search-match-summary">
                      {model.searchMatchCount > 0 ? `${model.activeMatchNumber} / ${model.searchMatchCount} matches` : '0 matches'}
                    </span>
                    <div className="grid grid-cols-2 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white/75 p-0.5" aria-label="로그 검색 매치 이동">
                      <button className="inline-flex items-center justify-center gap-1 rounded-[6px] px-2 py-1 text-[10px] font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45" type="button" onClick={() => actions.moveMatch(-1)} disabled={model.searchMatchCount === 0} aria-label="이전 로그 검색 매치" data-testid="log-search-previous"><ArrowUp size={12} aria-hidden="true" />이전</button>
                      <button className="inline-flex items-center justify-center gap-1 rounded-[6px] px-2 py-1 text-[10px] font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45" type="button" onClick={() => actions.moveMatch(1)} disabled={model.searchMatchCount === 0} aria-label="다음 로그 검색 매치" data-testid="log-search-next"><ArrowDown size={12} aria-hidden="true" />다음</button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="로그 시간 범위">
                {eventTimeRangeOptions.map((option) => (
                  <button key={option.value} className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${model.timeRangeFilter === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'}`} type="button" onClick={() => actions.changeTimeRange(option.value)} aria-pressed={model.timeRangeFilter === option.value} data-testid={`log-time-range-${option.value}`} title={option.value === 'all' ? '모든 로그 보기' : `최근 ${option.label} 로그만 보기`}>
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="로그 정렬">
                {logSortOptions.map((option) => (
                  <button key={option.value} className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${model.sortOrder === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'}`} type="button" onClick={() => actions.changeSortOrder(option.value)} aria-pressed={model.sortOrder === option.value} data-testid={`log-sort-${option.value}`} title={`로그 ${option.label} 보기`}>
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="ku-chip">{model.filteredLines.length} / {model.lines.length}</span>
                {model.controlsActive ? <button className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]" type="button" onClick={actions.resetControls}>초기화</button> : null}
              </div>
            </div>
          ) : null}
          {model.lines.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <button className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-55" type="button" onClick={() => actions.copy('visible')} disabled={!model.canCopyVisible}><Copy size={13} aria-hidden="true" />표시 로그 복사</button>
              {model.canCopyAll ? <button className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]" type="button" onClick={() => actions.copy('all')}><Copy size={13} aria-hidden="true" />전체 로그 복사</button> : null}
              <button className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-55" type="button" onClick={() => actions.download('visible')} disabled={!model.canDownloadVisible}><Download size={13} aria-hidden="true" />표시 로그 다운로드</button>
              {model.canDownloadAll ? <button className="inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]" type="button" onClick={() => actions.download('all')}><Download size={13} aria-hidden="true" />전체 로그 다운로드</button> : null}
              {model.copyStatus ? <span className={`rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold ${model.copyStatus.tone === 'success' ? 'border-[rgba(52,199,89,0.24)] bg-[rgba(52,199,89,0.1)] text-[#19783b]' : 'border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] text-[#8a4d00]'}`}>{model.copyStatus.message}</span> : null}
            </div>
          ) : null}
          {model.warning ? <InlineWarning message="로그 조회 권한이 없거나 API가 없어 빈 목록으로 표시합니다." /> : null}
          {model.error ? <InlineWarning message={`로그 조회 실패: ${model.error}`} /> : null}
          {model.lines.length === 0 ? (
            <p className="ku-meta">표시할 로그가 없습니다.</p>
          ) : model.filteredLines.length === 0 ? (
            <p className="ku-meta">필터와 일치하는 로그가 없습니다.</p>
          ) : (
            <ResourceLogLines activeMatch={model.activeMatch} lineRefs={model.lineRefs} lines={model.filteredLines} normalizedFilter={model.normalizedFilter} rowClassName={model.rowClassName} viewportClassName={model.viewportClassName} />
          )}
        </div>
      )}
    </DetailSection>
  );
}
