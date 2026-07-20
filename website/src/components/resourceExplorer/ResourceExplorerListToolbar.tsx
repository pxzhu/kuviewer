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
import { KuSegmentedControl, type KuSegmentedOption } from '../ui/KuSegmentedControl';
import { KuSelect } from '../ui/KuSelect';

const sortDirectionOptions: Array<KuSegmentedOption<ResourceListSortPreference['direction']>> = [
  { value: 'asc', label: '오름', icon: ArrowUp, testId: 'resource-list-sort-asc' },
  { value: 'desc', label: '내림', icon: ArrowDown, testId: 'resource-list-sort-desc' },
];

const densityOptions: Array<KuSegmentedOption<ResourceListDensity>> = [
  { value: 'comfortable', label: '기본', testId: 'resource-list-density-comfortable' },
  { value: 'compact', label: '촘촘', testId: 'resource-list-density-compact' },
];

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
            <KuSelect
              ariaLabel="리소스 목록 정렬 기준"
              className="text-xs"
              value={sort.field}
              testId="resource-list-sort-field"
              options={resourceListSortOptions}
              onChange={(field) => setSort((current) => ({ ...current, field: field as ResourceListSortField }))}
            />
          </label>
          <div className="grid gap-1">
            <span className="ku-meta">방향</span>
            <KuSegmentedControl
              ariaLabel="리소스 목록 정렬 방향"
              className="grid-cols-2"
              options={sortDirectionOptions}
              value={sort.direction}
              onChange={(direction) => setSort((current) => ({ ...current, direction }))}
            />
          </div>
          <KuSegmentedControl
            ariaLabel="리소스 목록 밀도"
            className="grid-cols-2"
            options={densityOptions}
            value={density}
            onChange={setDensity}
          />
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
