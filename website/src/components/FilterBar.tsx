import { Search } from 'lucide-react';
import type { ColorMode, TopologyFilters } from '../features/topology/useTopology';
import type { ClusterSummary } from '../types/topology';
import { KuInput } from './ui/KuInput';
import { KuSegmentedControl, type KuSegmentedOption } from './ui/KuSegmentedControl';

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
          <select
            className="ku-field w-full"
            value={filters.cluster}
            onChange={(event) => onFiltersChange({ ...filters, cluster: event.target.value })}
          >
            <option value="all">전체 Cluster</option>
            {clusters.map((cluster) => (
              <option key={cluster.id} value={cluster.id}>
                {cluster.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[rgba(60,60,67,0.72)]">Namespace</span>
          <select
            className="ku-field w-full"
            value={filters.namespace}
            onChange={(event) => onFiltersChange({ ...filters, namespace: event.target.value })}
          >
            <option value="all">전체 Namespace</option>
            {namespaces.map((namespace) => (
              <option key={namespace} value={namespace}>
                {namespace}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[rgba(60,60,67,0.72)]">Node</span>
          <select
            className="ku-field w-full"
            value={filters.node}
            onChange={(event) => onFiltersChange({ ...filters, node: event.target.value })}
          >
            <option value="all">전체 Node</option>
            {nodeNames.map((nodeName) => (
              <option key={nodeName} value={nodeName}>
                {nodeName}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[rgba(60,60,67,0.72)]">종류</span>
          <select
            className="ku-field w-full"
            value={filters.kind}
            onChange={(event) => onFiltersChange({ ...filters, kind: event.target.value })}
          >
            <option value="all">전체 종류</option>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[rgba(60,60,67,0.72)]">상태</span>
          <select
            className="ku-field w-full"
            value={filters.status}
            onChange={(event) => onFiltersChange({ ...filters, status: event.target.value })}
          >
            <option value="all">전체 상태</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
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
