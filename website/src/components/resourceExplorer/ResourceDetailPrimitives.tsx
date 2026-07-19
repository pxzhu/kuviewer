import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  detailOverviewToneClassName,
  detailSectionToneClassName,
  healthSignalBadgeClassName,
  healthSignalToneClassName,
} from './resourceDetailHealth';
import {
  keyValueEntries,
  keyValueEntryMatchesFilter,
  resourceDetailNavigatorItemClassName,
} from './resourceDetailActivity';
import { renderHighlightedText } from './resourceDetailHighlight';
import type {
  DetailOverviewItem,
  DetailSectionId,
  DetailSectionTone,
  EventSeverity,
  HealthSignal,
  KeyValueSearchMatch,
  ResourceDetailDensity,
} from './resourceDetailTypes';

export function InlineWarning({ message }: { message: string }) {
  return (
    <p className="mb-2 flex items-start gap-1.5 rounded-[9px] border border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] px-2 py-1.5 text-xs font-semibold text-[#8a4d00]">
      <AlertTriangle className="mt-0.5 shrink-0" size={13} aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

export function EventSeverityChips({ counts }: { counts: Record<EventSeverity, number> }) {
  return (
    <>
      {counts.warning > 0 ? (
        <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#9a5a00]">Warning {counts.warning}</span>
      ) : null}
      {counts.normal > 0 ? <span className="ku-chip">Normal {counts.normal}</span> : null}
      {counts.other > 0 ? <span className="ku-chip">Other {counts.other}</span> : null}
    </>
  );
}

export function HealthSignalPanel({ signals }: { signals: HealthSignal[] }) {
  if (signals.length === 0) {
    return null;
  }
  return (
    <div className="mb-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Health Signals">
      {signals.slice(0, 6).map((signal) => (
        <div key={`${signal.label}:${signal.value}`} className={`min-w-0 rounded-[10px] border px-2.5 py-2 ${healthSignalToneClassName(signal.tone)}`}>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="truncate font-mono text-[9px] font-semibold uppercase tracking-[0.04em] text-[rgba(60,60,67,0.56)]">{signal.label}</p>
            <span className={healthSignalBadgeClassName(signal.tone)}>{signal.tone}</span>
          </div>
          <p className="mt-1 truncate text-xs font-semibold text-[#1d1d1f]" title={signal.value}>
            {signal.value}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.58)]" title={signal.helper}>
            {signal.helper}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ResourceDetailOverview({ items }: { items: DetailOverviewItem[] }) {
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

export function ResourceDetailSectionNavigator({
  activeId,
  onFocusSection,
  openSections,
  sections,
  summaries,
  tones,
}: {
  activeId: DetailSectionId;
  onFocusSection: (id: DetailSectionId) => void;
  openSections: Set<DetailSectionId>;
  sections: Array<{ id: DetailSectionId; label: string }>;
  summaries: Record<DetailSectionId, string>;
  tones: Record<DetailSectionId, DetailSectionTone>;
}) {
  return (
    <div
      className="mt-3 grid gap-2 rounded-[12px] border border-[rgba(60,60,67,0.1)] bg-[rgba(242,242,247,0.42)] p-2"
      data-testid="resource-detail-section-navigator"
      aria-label="리소스 상세 섹션 목차"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="ku-meta">Detail sections</p>
        <span className="ku-chip" data-testid="resource-detail-section-navigator-count">
          {openSections.size} open
        </span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 md:grid md:grid-cols-3 md:overflow-visible xl:grid-cols-9">
        {sections.map((section) => {
          const open = openSections.has(section.id);
          const active = activeId === section.id;
          const tone = tones[section.id] || 'default';
          return (
            <button
              key={section.id}
              className={resourceDetailNavigatorItemClassName(active, open, tone)}
              type="button"
              onClick={() => onFocusSection(section.id)}
              aria-current={active ? 'true' : undefined}
              aria-expanded={open}
              data-testid={`resource-detail-section-nav-item-${section.id}`}
              title={`${section.label} section`}
            >
              <span className="truncate">{section.label}</span>
              <span className="flex items-center gap-1">
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${
                    tone === 'error'
                      ? 'bg-[rgba(255,59,48,0.12)] text-[#b42318]'
                      : tone === 'warning'
                        ? 'bg-[rgba(255,149,0,0.14)] text-[#9a5a00]'
                        : active
                          ? 'bg-white/85 text-[#0057b8]'
                          : 'bg-white/72 text-[rgba(60,60,67,0.58)]'
                  }`}
                  data-testid={`resource-detail-section-nav-summary-${section.id}`}
                >
                  {summaries[section.id]}
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${
                    open ? 'bg-[rgba(52,199,89,0.12)] text-[#248a3d]' : 'bg-[rgba(142,142,147,0.1)] text-[#636366]'
                  }`}
                  data-testid={`resource-detail-section-nav-state-${section.id}`}
                >
                  {open ? 'open' : 'closed'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DetailSection({
  active = false,
  children,
  id,
  icon: Icon,
  onFocusSection,
  onToggle,
  open,
  sectionRef,
  summary,
  tone = 'default',
  title,
}: {
  active?: boolean;
  children: ReactNode;
  id: DetailSectionId;
  icon: LucideIcon;
  onFocusSection?: () => void;
  onToggle: () => void;
  open: boolean;
  sectionRef?: (node: HTMLElement | null) => void;
  summary: string;
  tone?: DetailSectionTone;
  title: string;
}) {
  return (
    <section
      ref={sectionRef}
      className={`rounded-[12px] border transition focus:outline-none focus:ring-2 focus:ring-[rgba(0,122,255,0.22)] ${detailSectionToneClassName(active, tone)}`}
      onFocusCapture={onFocusSection}
      tabIndex={-1}
      data-testid={`resource-detail-section-${id}`}
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
          <span
            className={
              tone === 'error'
                ? 'ku-chip border-[rgba(255,59,48,0.24)] bg-[rgba(255,59,48,0.1)] text-[#b42318]'
                : tone === 'warning'
                  ? 'ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#9a5a00]'
                  : 'ku-chip'
            }
          >
            {summary}
          </span>
          <ChevronDown className={`text-[rgba(60,60,67,0.48)] transition ${open ? 'rotate-180' : ''}`} size={15} aria-hidden="true" />
        </button>
      </div>
      {open ? <div className="px-3 pb-3" data-testid={`resource-detail-section-body-${id}`}>{children}</div> : null}
    </section>
  );
}

export function KeyValueGrid({
  activeMatch,
  density = 'comfortable',
  empty = '데이터 없음',
  filter = '',
  filteredEmpty = '일치하는 항목 없음',
  limit = 20,
  testId,
  values,
}: {
  activeMatch?: KeyValueSearchMatch | null;
  density?: ResourceDetailDensity;
  empty?: string;
  filter?: string;
  filteredEmpty?: string;
  limit?: number;
  testId: string;
  values: Record<string, unknown>;
}) {
  const entries = useMemo(() => keyValueEntries(values), [values]);
  const [expanded, setExpanded] = useState(false);
  const entriesKey = useMemo(() => entries.map((entry) => entry.key).join('\u001f'), [entries]);
  const normalizedFilter = filter.trim();

  useEffect(() => {
    setExpanded(false);
  }, [entriesKey, normalizedFilter]);

  if (entries.length === 0) {
    return <p className="ku-meta">{empty}</p>;
  }
  const filteredEntries = normalizedFilter ? entries.filter((entry) => keyValueEntryMatchesFilter(entry, normalizedFilter)) : entries;
  if (filteredEntries.length === 0) {
    return <p className="ku-meta" data-testid={`resource-key-value-empty-${testId}`}>{filteredEmpty}</p>;
  }
  const compact = density === 'compact';
  const visibleEntries = normalizedFilter || expanded ? filteredEntries : filteredEntries.slice(0, limit);
  const hiddenCount = Math.max(0, filteredEntries.length - visibleEntries.length);
  const gridClassName = compact ? 'grid gap-1' : 'grid gap-1.5';
  const rowClassName = compact
    ? 'grid grid-cols-[minmax(84px,0.32fr)_minmax(0,1fr)] gap-2 rounded-[7px] border border-[rgba(60,60,67,0.06)] bg-[rgba(242,242,247,0.62)] px-2 py-1'
    : 'grid grid-cols-[minmax(112px,0.34fr)_minmax(0,1fr)] gap-2 rounded-[8px] border border-[rgba(60,60,67,0.06)] bg-[rgba(242,242,247,0.68)] px-2.5 py-1.5';
  const keyClassName = compact
    ? 'min-w-0 truncate font-mono text-[9px] font-semibold text-[rgba(60,60,67,0.58)]'
    : 'min-w-0 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.58)]';
  const valueClassName = compact
    ? 'min-w-0 break-words font-mono text-[9px] font-semibold leading-4 text-[#1d1d1f]'
    : 'min-w-0 break-words font-mono text-[10px] font-semibold leading-5 text-[#1d1d1f]';
  return (
    <div className="grid gap-2" data-testid={`resource-key-value-grid-${testId}`} data-density={density}>
      <div className={gridClassName}>
        {visibleEntries.map((entry) => {
          const entryIndex = entries.findIndex((candidate) => candidate.key === entry.key);
          const activeKeyMatch = activeMatch?.entryIndex === entryIndex && activeMatch.field === 'key' ? activeMatch : undefined;
          const activeValueMatch = activeMatch?.entryIndex === entryIndex && activeMatch.field === 'value' ? activeMatch : undefined;
          return (
            <div key={entry.key} className={rowClassName} data-testid={`resource-key-value-row-${testId}`}>
              <span className={keyClassName} title={entry.key}>{renderHighlightedText(entry.key, normalizedFilter, activeKeyMatch, 'active-key-value-search-match')}</span>
              <span className={valueClassName} title={entry.valueText}>{renderHighlightedText(entry.valueText, normalizedFilter, activeValueMatch, 'active-key-value-search-match')}</span>
            </div>
          );
        })}
      </div>
      {!normalizedFilter && entries.length > limit ? (
        <button
          className="inline-flex w-fit items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          data-testid={`resource-key-value-toggle-${testId}`}
        >
          <ChevronDown className={`transition ${expanded ? 'rotate-180' : ''}`} size={13} aria-hidden="true" />
          {expanded ? '접기' : `더 보기 · ${hiddenCount}개`}
        </button>
      ) : null}
    </div>
  );
}
