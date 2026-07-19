import { useEffect, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { FileText, Search } from 'lucide-react';
import { DetailSection, KeyValueGrid } from './ResourceDetailPrimitives';
import { collectKeyValueSearchMatches, keyValueEntries } from './resourceDetailActivity';
import type { ResourceDetailDensity } from './resourceDetailTypes';

interface ResourceSafePreviewSectionProps {
  active: boolean;
  density: ResourceDetailDensity;
  onEnsureOpen: () => void;
  onFocusSection: () => void;
  onToggle: () => void;
  open: boolean;
  sectionRef: (node: HTMLElement | null) => void;
  summary: string;
  values: Record<string, unknown>;
}

export function ResourceSafePreviewSection({
  active,
  density,
  onEnsureOpen,
  onFocusSection,
  onToggle,
  open,
  sectionRef,
  summary,
  values,
}: ResourceSafePreviewSectionProps) {
  const [filter, setFilter] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const entries = keyValueEntries(values);
  const matches = collectKeyValueSearchMatches(entries, filter);
  const filterActive = filter.trim().length > 0;
  const activeMatch = matches[activeMatchIndex] || null;

  useEffect(() => {
    setActiveMatchIndex((current) => (matches.length === 0 ? 0 : Math.min(current, matches.length - 1)));
  }, [matches.length]);

  const handleFilterChange = (value: string) => {
    setFilter(value);
    setActiveMatchIndex(0);
    if (value.trim()) {
      onEnsureOpen();
    }
  };

  const moveActiveMatch = (offset: number) => {
    if (matches.length === 0) {
      return;
    }
    onEnsureOpen();
    setActiveMatchIndex((current) => (current + offset + matches.length) % matches.length);
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    moveActiveMatch(event.shiftKey ? -1 : 1);
  };

  return (
    <DetailSection
      id="safe"
      icon={FileText}
      title="Safe Preview"
      summary={summary}
      open={open}
      active={active}
      sectionRef={sectionRef}
      onFocusSection={onFocusSection}
      onToggle={onToggle}
    >
      <div className="grid gap-2">
        <div className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
            <input
              className="ku-input w-full pl-9"
              data-testid="safe-preview-search-input"
              placeholder="Safe Preview 검색"
              value={filter}
              onChange={(event) => handleFilterChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              aria-label="Safe Preview 검색"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="ku-chip" data-testid="safe-preview-search-count">
              {filterActive ? `${matches.length} matches` : `${entries.length} items`}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => moveActiveMatch(-1)}
                disabled={matches.length === 0}
                data-testid="safe-preview-search-prev"
                title="이전 Safe Preview match"
              >
                이전
              </button>
              <button
                className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => moveActiveMatch(1)}
                disabled={matches.length === 0}
                data-testid="safe-preview-search-next"
                title="다음 Safe Preview match"
              >
                다음
              </button>
              {filter ? (
                <button
                  className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                  type="button"
                  onClick={() => handleFilterChange('')}
                  data-testid="safe-preview-search-clear"
                >
                  초기화
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {filterActive ? (
          <p className="ku-meta" data-testid="safe-preview-search-status">
            {matches.length > 0
              ? `검색 결과 ${Math.min(activeMatchIndex + 1, matches.length)} / ${matches.length}`
              : '검색 결과 0개'}
          </p>
        ) : null}
        <KeyValueGrid
          activeMatch={activeMatch}
          density={density}
          filter={filter}
          filteredEmpty="일치하는 Safe Preview 항목 없음"
          testId="safe"
          values={values}
        />
      </div>
    </DetailSection>
  );
}
