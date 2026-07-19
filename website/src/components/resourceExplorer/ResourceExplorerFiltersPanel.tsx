import { RotateCcw, Search, X } from 'lucide-react';
import { resourceListAllValue } from '../../features/resources/resourceListModel';
import type { ResourceViewPresetsController } from '../../features/resources/useResourceViewPresetsController';
import type { ActiveResourceFilterChip, ResourceViewFilters } from '../../features/resources/resourceViewState';
import { ResourceViewPresetsPanel } from './ResourceViewPresetsPanel';

interface ResourceExplorerFiltersPanelProps {
  activeFilterChips: ActiveResourceFilterChip[];
  filters: ResourceViewFilters;
  filtersAreDefault: boolean;
  options: Record<Exclude<keyof ResourceViewFilters, 'query'>, string[]>;
  resourceViewController: ResourceViewPresetsController;
  onChange: (filter: keyof ResourceViewFilters, value: string) => void;
  onClearFilter: (filter: keyof ResourceViewFilters) => void;
  onReset: () => void;
}

export function ResourceExplorerFiltersPanel({
  activeFilterChips,
  filters,
  filtersAreDefault,
  options,
  resourceViewController,
  onChange,
  onClearFilter,
  onReset,
}: ResourceExplorerFiltersPanelProps) {
  return (
    <div className="grid gap-2 border-b border-[rgba(60,60,67,0.1)] p-3">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={16} />
        <input
          className="ku-input w-full pl-9"
          placeholder="리소스 검색"
          value={filters.query}
          data-testid="resource-view-query"
          onChange={(event) => onChange('query', event.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <ResourceSelect label="Cluster" testId="resource-filter-cluster" value={filters.cluster} values={options.cluster} onChange={(value) => onChange('cluster', value)} />
        <ResourceSelect label="Namespace" testId="resource-filter-namespace" value={filters.namespace} values={options.namespace} onChange={(value) => onChange('namespace', value)} />
        <ResourceSelect label="Kind" testId="resource-filter-kind" value={filters.kind} values={options.kind} onChange={(value) => onChange('kind', value)} />
        <ResourceSelect label="Status" testId="resource-filter-status" value={filters.status} values={options.status} onChange={(value) => onChange('status', value)} />
      </div>
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[rgba(60,60,67,0.1)] bg-[rgba(248,248,252,0.72)] p-2"
        data-testid="resource-active-filters"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {activeFilterChips.length > 0 ? (
            activeFilterChips.map((chip) => (
              <span
                key={chip.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[rgba(0,122,255,0.18)] bg-white px-2 py-1 text-[10px] font-semibold text-[#0057b8] shadow-sm"
                data-testid={chip.testId}
              >
                <span className="min-w-0 truncate">
                  {chip.label}: {chip.value}
                </span>
                <button
                  className="rounded-full p-0.5 text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)]"
                  type="button"
                  onClick={() => onClearFilter(chip.id)}
                  aria-label={`${chip.label} 필터 지우기`}
                  data-testid={`${chip.testId}-clear`}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </span>
            ))
          ) : (
            <span className="inline-flex items-center rounded-full bg-[rgba(60,60,67,0.06)] px-2 py-1 text-[10px] font-semibold text-[rgba(60,60,67,0.58)]" data-testid="resource-active-filter-empty">
              모든 리소스
            </span>
          )}
        </div>
        {activeFilterChips.length > 0 ? (
          <button
            className="inline-flex items-center gap-1 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
            type="button"
            onClick={onReset}
            data-testid="resource-active-filter-clear-all"
          >
            <RotateCcw size={13} aria-hidden="true" />
            Clear all
          </button>
        ) : null}
      </div>
      <ResourceViewPresetsPanel controller={resourceViewController} currentFilters={filters} filtersAreDefault={filtersAreDefault} />
    </div>
  );
}

function ResourceSelect({ label, testId, value, values, onChange }: { label: string; testId: string; value: string; values: string[]; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="ku-meta">{label}</span>
      <select className="ku-select" value={value} data-testid={testId} onChange={(event) => onChange(event.target.value)}>
        <option value={resourceListAllValue}>전체</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
