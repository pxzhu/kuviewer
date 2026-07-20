import { Search } from 'lucide-react';
import type { ColorMode, TopologyFilters } from '../features/topology/useTopology';
import type { ClusterSummary } from '../types/topology';
import { KuInput } from './ui/KuInput';
import { KuSegmentedControl, type KuSegmentedOption } from './ui/KuSegmentedControl';
import { KuSelect } from './ui/KuSelect';

interface FilterBarProps {
  filters: TopologyFilters;
  clusters: ClusterSummary[];
  namespaces: string[];
  nodeNames: string[];
  kinds: string[];
  statuses: string[];
  colorMode: ColorMode;
  onFiltersChange: (filters: TopologyFilters) => void;
  onColorModeChange: (mode: ColorMode) => void;
}

const colorModeOptions: Array<KuSegmentedOption<ColorMode>> = (
  ['status', 'cluster', 'namespace', 'kind', 'node'] as ColorMode[]
).map((value) => ({ value, label: colorModeLabel(value) }));

export function FilterBar({
  filters,
  clusters,
  namespaces,
  nodeNames,
  kinds,
  statuses,
  colorMode,
  onFiltersChange,
  onColorModeChange,
}: FilterBarProps) {
  return (
    <section className="ku-panel p-3 sm:p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-[minmax(220px,1fr)_150px_165px_150px_145px_135px_310px]">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[rgba(60,60,67,0.72)]">검색</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={17} />
            <KuInput
              className="w-full pl-9"
              value={filters.query}
              onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
              placeholder="리소스 검색"
            />
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[rgba(60,60,67,0.72)]">Cluster</span>
          <KuSelect
            ariaLabel="Cluster"
            value={filters.cluster}
            options={[
              { value: 'all', label: '전체 Cluster' },
              ...clusters.map((cluster) => ({ value: cluster.id, label: cluster.name })),
            ]}
            onChange={(cluster) => onFiltersChange({ ...filters, cluster })}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[rgba(60,60,67,0.72)]">Namespace</span>
          <KuSelect
            ariaLabel="Namespace"
            value={filters.namespace}
            options={toFilterOptions(namespaces, '전체 Namespace')}
            onChange={(namespace) => onFiltersChange({ ...filters, namespace })}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[rgba(60,60,67,0.72)]">Node</span>
          <KuSelect
            ariaLabel="Node"
            value={filters.node}
            options={toFilterOptions(nodeNames, '전체 Node')}
            onChange={(node) => onFiltersChange({ ...filters, node })}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[rgba(60,60,67,0.72)]">종류</span>
          <KuSelect
            ariaLabel="종류"
            value={filters.kind}
            options={toFilterOptions(kinds, '전체 종류')}
            onChange={(kind) => onFiltersChange({ ...filters, kind })}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[rgba(60,60,67,0.72)]">상태</span>
          <KuSelect
            ariaLabel="상태"
            value={filters.status}
            options={toFilterOptions(statuses, '전체 상태')}
            onChange={(status) => onFiltersChange({ ...filters, status })}
          />
        </label>

        <div className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[rgba(60,60,67,0.72)]">색상 기준</span>
          <KuSegmentedControl
            ariaLabel="토폴로지 색상 기준"
            className="grid-cols-5"
            options={colorModeOptions}
            value={colorMode}
            onChange={onColorModeChange}
          />
        </div>
      </div>
    </section>
  );
}

function toFilterOptions(values: string[], allLabel: string) {
  return [{ value: 'all', label: allLabel }, ...values.map((value) => ({ value, label: value }))];
}

function colorModeLabel(mode: ColorMode) {
  if (mode === 'status') {
    return '상태';
  }
  if (mode === 'cluster') {
    return 'Cluster';
  }
  if (mode === 'namespace') {
    return 'Namespace';
  }
  if (mode === 'kind') {
    return '종류';
  }
  return 'Node';
}
