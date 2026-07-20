import { useEffect, useMemo, useState } from 'react';
import { Boxes, FileJson, GitCompareArrows, Link2, RotateCcw, Search, TableProperties } from 'lucide-react';
import {
  compareTopologySnapshots,
  type SnapshotBaseline,
  type SnapshotChangeType,
} from '../features/snapshot/compareSnapshots';
import {
  downloadSnapshotDiff,
  type SnapshotDiffChangeFilter,
  type SnapshotDiffScope,
} from '../features/snapshot/exportSnapshotDiff';
import {
  filterSnapshotComparison,
  filterSnapshotRelationsByTypes,
  relationTypeCounts,
  retainAvailableRelationTypes,
  snapshotScopeLabel,
  snapshotScopeSearchPlaceholder,
  snapshotScopeTotalCount,
  snapshotVisibleChangeCount,
  toggleRelationTypeSelection,
} from '../features/snapshot/snapshotComparisonView';
import type { SnapshotHistoryEntry } from '../features/snapshot/snapshotHistory';
import type { TopologySnapshot } from '../types/topology';
import { formatLastSync } from '../utils/formatTime';
import {
  ClusterChangeTable,
  RelationChangeTable,
  RelationTypeFilter,
  ResourceChangeTable,
} from './snapshot/SnapshotChangeTables';
import { SnapshotHistoryControls } from './snapshot/SnapshotHistoryControls';
import { VIRTUALIZE_AFTER_ROWS } from './snapshot/VirtualizedTable';

interface SnapshotComparePanelProps {
  baseline: SnapshotBaseline | null;
  baselineId: string;
  canCaptureCurrent: boolean;
  currentId: string;
  currentLabel: string;
  currentSnapshot: TopologySnapshot;
  history: SnapshotHistoryEntry[];
  liveCurrentLabel: string;
  liveNodeIds: Set<string>;
  onCapture: () => void;
  onClearHistory: () => void;
  onDeleteHistory: (id: string) => void;
  onImport: (file: File) => Promise<void>;
  onOpenTopologyNode: (nodeId: string) => void;
  onRenameHistory: (id: string, label: string) => void;
  onSelectBaseline: (id: string) => void;
  onSelectCurrent: (id: string) => void;
}

type ChangeFilter = SnapshotDiffChangeFilter;
type ComparisonScope = SnapshotDiffScope;

const changeFilterOptions: Array<{ value: ChangeFilter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'changed', label: '변경' },
  { value: 'added', label: '추가' },
  { value: 'removed', label: '삭제' },
];

const comparisonScopeOptions: Array<{ value: ComparisonScope; label: string }> = [
  { value: 'resources', label: '리소스' },
  { value: 'relations', label: '관계' },
  { value: 'clusters', label: '클러스터' },
];

export function SnapshotComparePanel({
  baseline,
  baselineId,
  canCaptureCurrent,
  currentId,
  currentLabel,
  currentSnapshot,
  history,
  liveCurrentLabel,
  liveNodeIds,
  onCapture,
  onClearHistory,
  onDeleteHistory,
  onImport,
  onOpenTopologyNode,
  onRenameHistory,
  onSelectBaseline,
  onSelectCurrent,
}: SnapshotComparePanelProps) {
  const [scope, setScope] = useState<ComparisonScope>('resources');
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedRelationTypes, setSelectedRelationTypes] = useState<Set<string>>(() => new Set());
  const comparison = useMemo(
    () => baseline ? compareTopologySnapshots(baseline.snapshot, currentSnapshot) : null,
    [baseline, currentSnapshot],
  );
  const currentNodeIds = useMemo(
    () => new Set(currentSnapshot.nodes.map((node) => node.id).filter((id) => liveNodeIds.has(id))),
    [currentSnapshot.nodes, liveNodeIds],
  );
  const matchingChanges = useMemo(
    () => comparison ? filterSnapshotComparison(comparison, changeFilter, query) : { nodes: [], edges: [], clusters: [] },
    [changeFilter, comparison, query],
  );
  const relationTypeOptions = useMemo(() => relationTypeCounts(matchingChanges.edges), [matchingChanges.edges]);
  const relationTypeKey = relationTypeOptions.map((option) => option.relation).join('\u0000');
  useEffect(() => {
    setSelectedRelationTypes((current) => retainAvailableRelationTypes(current, relationTypeOptions));
  }, [relationTypeKey, relationTypeOptions]);
  const visibleEdgeChanges = useMemo(
    () => filterSnapshotRelationsByTypes(matchingChanges.edges, selectedRelationTypes),
    [matchingChanges.edges, selectedRelationTypes],
  );
  const visibleChanges = useMemo(
    () => ({ ...matchingChanges, edges: visibleEdgeChanges }),
    [matchingChanges, visibleEdgeChanges],
  );
  const activeVisibleChangeCount = snapshotVisibleChangeCount(scope, visibleChanges);

  const toggleRelationType = (relation: string) => {
    setSelectedRelationTypes((current) => toggleRelationTypeSelection(current, relation));
  };

  const handleExport = (format: 'json' | 'csv') => {
    if (!baseline || !comparison || activeVisibleChangeCount === 0) {
      return;
    }
    downloadSnapshotDiff({
      baseline,
      changeFilter,
      clusters: visibleChanges.clusters,
      comparison,
      currentLabel,
      currentSnapshot,
      edges: visibleEdgeChanges,
      nodes: visibleChanges.nodes,
      relationTypes: [...selectedRelationTypes],
      scope,
    }, format);
  };

  return (
    <section className="ku-panel overflow-hidden" data-testid="snapshot-compare-panel">
      <SnapshotHistoryControls
        baselineId={baselineId}
        canCaptureCurrent={canCaptureCurrent}
        currentId={currentId}
        history={history}
        liveCurrentLabel={liveCurrentLabel}
        onCapture={onCapture}
        onClearHistory={onClearHistory}
        onDeleteHistory={onDeleteHistory}
        onImportBaseline={onImport}
        onRenameHistory={onRenameHistory}
        onSelectBaseline={onSelectBaseline}
        onSelectCurrent={onSelectCurrent}
      />

      {!baseline ? (
        <div className="flex min-h-[420px] items-center justify-center p-6 text-center">
          <div className="max-w-md">
            <GitCompareArrows className="mx-auto text-[rgba(60,60,67,0.42)]" size={32} aria-hidden="true" />
            <h3 className="mt-3 text-base font-semibold text-[#1d1d1f]">비교할 기준이 없습니다</h3>
            <p className="ku-copy mt-2 text-sm">현재 토폴로지를 기준으로 저장한 뒤 업로드 파일이나 live 상태가 바뀌면 리소스와 관계 차이를 확인할 수 있습니다.</p>
          </div>
        </div>
      ) : comparison ? (
        <div className="space-y-4 p-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
            <SnapshotMetric label="기준" value={`${baseline.snapshot.nodes.length} resources`} detail={`${baseline.label} · ${formatLastSync(baseline.capturedAt)}`} testId="snapshot-compare-baseline-count" />
            <SnapshotMetric label="현재" value={`${currentSnapshot.nodes.length} resources`} detail={currentLabel} testId="snapshot-compare-current-count" />
            <SnapshotMetric label="변경" value={String(comparison.counts.changed)} detail="safe field changes" tone="warning" testId="snapshot-compare-changed-count" />
            <SnapshotMetric label="추가" value={String(comparison.counts.added)} detail="new resources" tone="success" testId="snapshot-compare-added-count" />
            <SnapshotMetric label="삭제" value={String(comparison.counts.removed)} detail="removed resources" tone="danger" testId="snapshot-compare-removed-count" />
            <SnapshotMetric label="관계 변화" value={String(comparison.edges.length)} detail={formatChangeCounts(comparison.edgeCounts)} tone="warning" testId="snapshot-compare-relation-count" />
            <SnapshotMetric label="클러스터 변화" value={String(comparison.clusters.length)} detail={formatChangeCounts(comparison.clusterCounts)} tone="warning" testId="snapshot-compare-cluster-count" />
          </div>

          <div className="grid gap-3 border-y border-[rgba(60,60,67,0.12)] py-3 xl:grid-cols-[auto_auto_minmax(240px,1fr)] xl:items-center">
            <div className="ku-segmented grid-cols-3" aria-label="비교 범위">
              {comparisonScopeOptions.map((option) => (
                <button
                  key={option.value}
                  className={`ku-segmented-button ${scope === option.value ? 'ku-segmented-button-active' : ''}`}
                  type="button"
                  aria-pressed={scope === option.value}
                  data-testid={`snapshot-compare-scope-${option.value}`}
                  onClick={() => setScope(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="ku-segmented grid-cols-4" aria-label="변경 유형 필터">
              {changeFilterOptions.map((option) => (
                <button
                  key={option.value}
                  className={`ku-segmented-button ${changeFilter === option.value ? 'ku-segmented-button-active' : ''}`}
                  type="button"
                  aria-pressed={changeFilter === option.value}
                  onClick={() => setChangeFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="relative block min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.52)]" size={15} aria-hidden="true" />
              <input
                className="ku-input w-full pl-9 pr-9"
                type="search"
                value={query}
                placeholder={snapshotScopeSearchPlaceholder(scope)}
                aria-label="스냅샷 변경 검색"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1" type="button" title="검색 초기화" onClick={() => setQuery('')}>
                  <RotateCcw size={14} aria-hidden="true" />
                </button>
              ) : null}
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="snapshot-compare-export-bar">
            <p className="ku-meta">
              현재 {snapshotScopeLabel(scope)} {activeVisibleChangeCount} / {snapshotScopeTotalCount(scope, comparison)}개
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className="ku-control"
                type="button"
                disabled={activeVisibleChangeCount === 0}
                data-testid="snapshot-compare-export-json"
                onClick={() => handleExport('json')}
              >
                <FileJson size={14} aria-hidden="true" />
                JSON
              </button>
              <button
                className="ku-control"
                type="button"
                disabled={activeVisibleChangeCount === 0}
                data-testid="snapshot-compare-export-csv"
                onClick={() => handleExport('csv')}
              >
                <TableProperties size={14} aria-hidden="true" />
                CSV
              </button>
            </div>
          </div>

          {scope === 'relations' && relationTypeOptions.length > 0 ? (
            <RelationTypeFilter
              options={relationTypeOptions}
              selected={selectedRelationTypes}
              onClear={() => setSelectedRelationTypes(new Set())}
              onToggle={toggleRelationType}
            />
          ) : null}

          {scope === 'resources' ? (
            <ResourceChangeTable changes={visibleChanges.nodes} currentNodeIds={currentNodeIds} onOpenTopologyNode={onOpenTopologyNode} />
          ) : scope === 'relations' ? (
            <RelationChangeTable changes={visibleEdgeChanges} currentNodeIds={currentNodeIds} onOpenTopologyNode={onOpenTopologyNode} />
          ) : (
            <ClusterChangeTable changes={visibleChanges.clusters} />
          )}

          {activeVisibleChangeCount === 0 ? (
            <ComparisonEmptyState scope={scope} />
          ) : null}
          {activeVisibleChangeCount > VIRTUALIZE_AFTER_ROWS ? (
            <p className="ku-meta" data-testid="snapshot-compare-virtualized-note">전체 {activeVisibleChangeCount}개 결과를 유지하고 현재 스크롤 구간만 렌더링합니다.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ComparisonEmptyState({ scope }: { scope: ComparisonScope }) {
  const Icon = scope === 'relations' ? Link2 : Boxes;
  const label = scope === 'resources' ? '리소스' : scope === 'relations' ? '관계' : '클러스터';
  return (
    <div className="py-10 text-center" data-testid="snapshot-compare-empty-state">
      <Icon className="mx-auto text-[rgba(60,60,67,0.38)]" size={24} aria-hidden="true" />
      <p className="mt-2 text-sm font-semibold text-[#1d1d1f]">조건에 맞는 {label} 변경이 없습니다.</p>
      <p className="ku-meta mt-1">검색어나 변경 유형 필터를 조정해 보세요.</p>
    </div>
  );
}

interface SnapshotMetricProps {
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  testId?: string;
}

function SnapshotMetric({ label, value, detail, tone = 'neutral', testId }: SnapshotMetricProps) {
  const toneClass = {
    neutral: 'text-[#1d1d1f]',
    success: 'text-[#248a3d]',
    warning: 'text-[#b05f00]',
    danger: 'text-[#c9342f]',
  }[tone];
  return (
    <div className="border-l-2 border-[rgba(60,60,67,0.14)] px-3 py-1" data-testid={testId}>
      <p className="ku-meta">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>
      <p className="mt-1 truncate text-xs text-[rgba(60,60,67,0.58)]" title={detail}>{detail}</p>
    </div>
  );
}

function formatChangeCounts(counts: Record<SnapshotChangeType, number>) {
  return `~${counts.changed} / +${counts.added} / -${counts.removed}`;
}
