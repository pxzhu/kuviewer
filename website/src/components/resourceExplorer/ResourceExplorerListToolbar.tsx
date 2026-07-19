import type { Dispatch, SetStateAction } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  resourceListOptionalColumns,
  resourceListSortOptions,
  type ResourceListColumnPreference,
  type ResourceListDensity,
  type ResourceListOptionalColumn,
  type ResourceListSortField,
  type ResourceListSortPreference,
} from '../../features/resources/resourceListModel';

interface ResourceExplorerListToolbarProps {
  activeFilterCount: number;
  columns: ResourceListColumnPreference;
  density: ResourceListDensity;
  error: string;
  loading: boolean;
  resultLabel: string;
  setDensity: Dispatch<SetStateAction<ResourceListDensity>>;
  setSort: Dispatch<SetStateAction<ResourceListSortPreference>>;
  sort: ResourceListSortPreference;
  toggleColumn: (column: ResourceListOptionalColumn) => void;
  visibleOptionalColumnCount: number;
}

export function ResourceExplorerListToolbar({
  activeFilterCount,
  columns,
  density,
  error,
  loading,
  resultLabel,
  setDensity,
  setSort,
  sort,
  toggleColumn,
  visibleOptionalColumnCount,
}: ResourceExplorerListToolbarProps) {
  return (
    <div className="border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#1d1d1f]">리소스 탐색</h2>
          <p className="ku-meta mt-1">읽기 전용 Kubernetes 리소스 목록 · Secret value 숨김</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <label className="grid min-w-[116px] gap-1">
            <span className="ku-meta">정렬</span>
            <select
              className="ku-select h-8 text-xs"
              value={sort.field}
              data-testid="resource-list-sort-field"
              onChange={(event) => setSort((current) => ({ ...current, field: event.target.value as ResourceListSortField }))}
            >
              {resourceListSortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-1">
            <span className="ku-meta">방향</span>
            <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="리소스 목록 정렬 방향">
              {([
                { value: 'asc', label: '오름차순', icon: ArrowUp },
                { value: 'desc', label: '내림차순', icon: ArrowDown },
              ] as const).map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                      sort.direction === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                    }`}
                    data-testid={`resource-list-sort-${option.value}`}
                    type="button"
                    onClick={() => setSort((current) => ({ ...current, direction: option.value }))}
                    aria-pressed={sort.direction === option.value}
                    aria-label={`리소스 목록 ${option.label} 정렬`}
                    title={`리소스 목록 ${option.label} 정렬`}
                  >
                    <Icon size={13} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-0.5" aria-label="리소스 목록 밀도">
            {([
              { value: 'comfortable', label: '기본' },
              { value: 'compact', label: '촘촘' },
            ] as const).map((option) => (
              <button
                key={option.value}
                className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                  density === option.value ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                }`}
                data-testid={`resource-list-density-${option.value}`}
                type="button"
                onClick={() => setDensity(option.value)}
                aria-pressed={density === option.value}
                title={`리소스 목록 ${option.label} 표시`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="grid gap-1">
            <span className="ku-meta">컬럼 · {visibleOptionalColumnCount + 3}</span>
            <div className="flex max-w-[280px] flex-wrap gap-1 rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-1" aria-label="리소스 목록 표시 컬럼">
              {resourceListOptionalColumns.map((column) => (
                <button
                  key={column.key}
                  className={`rounded-[7px] px-2 py-1 text-xs font-semibold transition ${
                    columns[column.key] ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white'
                  }`}
                  data-testid={`resource-list-column-${column.key}`}
                  type="button"
                  onClick={() => toggleColumn(column.key)}
                  aria-pressed={columns[column.key]}
                  title={`${column.label} 컬럼 ${columns[column.key] ? '숨기기' : '표시'}`}
                >
                  {column.label}
                </button>
              ))}
            </div>
          </div>
          <span className="ku-chip" data-testid="resource-result-count">{loading ? '로딩 중' : resultLabel}</span>
          {activeFilterCount > 0 ? (
            <span className="ku-chip border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] text-[#0057b8]" data-testid="resource-active-filter-count">
              필터 {activeFilterCount}
            </span>
          ) : null}
        </div>
      </div>
      {error ? <p className="mt-2 text-xs font-semibold text-[#b26a00]">API 오류: {error}</p> : null}
    </div>
  );
}
