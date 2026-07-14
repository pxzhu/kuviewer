import { useMemo, useRef, useState } from 'react';
import { Camera, FileUp, GitCompareArrows, RotateCcw, Search, Trash2 } from 'lucide-react';
import { compareTopologySnapshots, type SnapshotBaseline, type SnapshotChangeType } from '../features/snapshot/compareSnapshots';
import type { TopologySnapshot } from '../types/topology';
import { formatLastSync } from '../utils/formatTime';

interface SnapshotComparePanelProps {
  baseline: SnapshotBaseline | null;
  currentLabel: string;
  currentSnapshot: TopologySnapshot;
  onCapture: () => void;
  onClear: () => void;
  onImport: (file: File) => Promise<void>;
  onOpenTopologyNode: (nodeId: string) => void;
}

type ChangeFilter = 'all' | SnapshotChangeType;

const changeFilterOptions: Array<{ value: ChangeFilter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'changed', label: '변경' },
  { value: 'added', label: '추가' },
  { value: 'removed', label: '삭제' },
];

export function SnapshotComparePanel({
  baseline,
  currentLabel,
  currentSnapshot,
  onCapture,
  onClear,
  onImport,
  onOpenTopologyNode,
}: SnapshotComparePanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>('all');
  const [query, setQuery] = useState('');
  const [importError, setImportError] = useState('');
  const comparison = useMemo(
    () => baseline ? compareTopologySnapshots(baseline.snapshot, currentSnapshot) : null,
    [baseline, currentSnapshot],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleNodeChanges = useMemo(() => {
    if (!comparison) {
      return [];
    }
    return comparison.nodes.filter((change) => {
      if (changeFilter !== 'all' && change.type !== changeFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return [change.kind, change.namespace, change.name, change.clusterId, ...change.changedFields]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [changeFilter, comparison, normalizedQuery]);

  const handleImport = async (file?: File) => {
    if (!file) {
      return;
    }
    setImportError('');
    try {
      await onImport(file);
    } catch {
      setImportError('유효한 Kuviewer topology JSON을 선택해 주세요.');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <section className="ku-panel overflow-hidden" data-testid="snapshot-compare-panel">
      <div className="flex flex-col gap-3 border-b border-[rgba(60,60,67,0.12)] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <GitCompareArrows size={17} aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[#1d1d1f]">스냅샷 비교</h2>
          </div>
          <p className="ku-meta mt-1">기준 스냅샷은 현재 브라우저 메모리에만 보관됩니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="ku-control" type="button" disabled={currentSnapshot.nodes.length === 0} onClick={onCapture} data-testid="snapshot-compare-capture">
            <Camera size={15} aria-hidden="true" />
            현재를 기준 저장
          </button>
          <button className="ku-control" type="button" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={15} aria-hidden="true" />
            기준 JSON 불러오기
          </button>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void handleImport(event.target.files?.[0])}
          />
          {baseline ? (
            <button className="ku-control" type="button" onClick={onClear}>
              <Trash2 size={15} aria-hidden="true" />
              기준 지우기
            </button>
          ) : null}
        </div>
      </div>

      {!baseline ? (
        <div className="flex min-h-[420px] items-center justify-center p-6 text-center">
          <div className="max-w-md">
            <GitCompareArrows className="mx-auto text-[rgba(60,60,67,0.42)]" size={32} aria-hidden="true" />
            <h3 className="mt-3 text-base font-semibold text-[#1d1d1f]">비교할 기준이 없습니다</h3>
            <p className="ku-copy mt-2 text-sm">현재 토폴로지를 기준으로 저장한 뒤 업로드 파일이나 live 상태가 바뀌면 리소스와 관계 차이를 확인할 수 있습니다.</p>
            {importError ? <p className="mt-3 text-sm font-semibold text-[#b26a00]">{importError}</p> : null}
          </div>
        </div>
      ) : comparison ? (
        <div className="space-y-4 p-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <SnapshotMetric label="기준" value={`${baseline.snapshot.nodes.length} resources`} detail={`${baseline.label} · ${formatLastSync(baseline.capturedAt)}`} testId="snapshot-compare-baseline-count" />
            <SnapshotMetric label="현재" value={`${currentSnapshot.nodes.length} resources`} detail={currentLabel} testId="snapshot-compare-current-count" />
            <SnapshotMetric label="변경" value={String(comparison.counts.changed)} detail="safe field changes" tone="warning" testId="snapshot-compare-changed-count" />
            <SnapshotMetric label="추가" value={String(comparison.counts.added)} detail="new resources" tone="success" testId="snapshot-compare-added-count" />
            <SnapshotMetric label="삭제" value={String(comparison.counts.removed)} detail={`${comparison.edges.length} relation changes`} tone="danger" testId="snapshot-compare-removed-count" />
          </div>

          <div className="flex flex-col gap-2 border-y border-[rgba(60,60,67,0.12)] py-3 lg:flex-row lg:items-center lg:justify-between">
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
            <label className="relative block min-w-0 lg:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.52)]" size={15} aria-hidden="true" />
              <input
                className="ku-input w-full pl-9 pr-9"
                type="search"
                value={query}
                placeholder="kind, namespace, name 검색"
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

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[rgba(60,60,67,0.12)] text-[11px] uppercase text-[rgba(60,60,67,0.58)]">
                  <th className="px-2 py-2 font-semibold">변경</th>
                  <th className="px-2 py-2 font-semibold">Kind</th>
                  <th className="px-2 py-2 font-semibold">Namespace / Name</th>
                  <th className="px-2 py-2 font-semibold">Status</th>
                  <th className="px-2 py-2 font-semibold">Changed fields</th>
                </tr>
              </thead>
              <tbody>
                {visibleNodeChanges.slice(0, 200).map((change) => (
                  <tr key={`${change.type}:${change.id}`} className="border-b border-[rgba(60,60,67,0.08)]">
                    <td className="px-2 py-2"><ChangeBadge type={change.type} /></td>
                    <td className="px-2 py-2 font-mono text-xs font-semibold">{change.kind}</td>
                    <td className="px-2 py-2">
                      <button
                        className="max-w-[420px] text-left font-semibold text-[#0066cc] hover:underline disabled:text-[#1d1d1f] disabled:no-underline"
                        type="button"
                        disabled={change.type === 'removed'}
                        onClick={() => onOpenTopologyNode(change.id)}
                      >
                        <span className="block text-[11px] font-medium text-[rgba(60,60,67,0.58)]">{change.namespace}</span>
                        <span className="block break-all">{change.name}</span>
                      </button>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">{formatStatusChange(change.beforeStatus, change.afterStatus)}</td>
                    <td className="px-2 py-2 text-xs text-[rgba(60,60,67,0.72)]">{change.changedFields.join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {visibleNodeChanges.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-semibold text-[#1d1d1f]">조건에 맞는 리소스 변경이 없습니다.</p>
              <p className="ku-meta mt-1">관계 변경 {comparison.edges.length}개</p>
            </div>
          ) : null}
          {visibleNodeChanges.length > 200 ? <p className="ku-meta">처음 200개만 표시합니다. 검색으로 범위를 좁혀 주세요.</p> : null}
          {importError ? <p className="text-sm font-semibold text-[#b26a00]">{importError}</p> : null}
        </div>
      ) : null}
    </section>
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

function ChangeBadge({ type }: { type: SnapshotChangeType }) {
  const label = type === 'added' ? '추가' : type === 'removed' ? '삭제' : '변경';
  const className = type === 'added'
    ? 'bg-[rgba(52,199,89,0.12)] text-[#248a3d]'
    : type === 'removed'
      ? 'bg-[rgba(255,59,48,0.10)] text-[#c9342f]'
      : 'bg-[rgba(255,149,0,0.12)] text-[#b05f00]';
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${className}`}>{label}</span>;
}

function formatStatusChange(before?: string, after?: string) {
  if (before && after && before !== after) {
    return `${before} -> ${after}`;
  }
  return after || before || '-';
}
