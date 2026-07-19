import { CheckCircle2, FileJson, GitCompareArrows, X } from 'lucide-react';
import { compareSnapshotDiffReports, type SnapshotDiffReportSummary } from '../../features/snapshot/compareSnapshotDiffReports';
import type { ImportedSnapshotDiff } from '../../features/snapshot/importSnapshotDiff';
import { formatLastSync } from '../../utils/formatTime';

const PREVIEW_ITEMS = 12;

export function SnapshotDiffImportPreview({
  fileName,
  report,
  comparisonError,
  comparisonFileName,
  comparisonReport,
  onClose,
  onCloseComparison,
  onSelectComparison,
}: {
  fileName: string;
  report: ImportedSnapshotDiff;
  comparisonError: string;
  comparisonFileName?: string;
  comparisonReport?: ImportedSnapshotDiff;
  onClose: () => void;
  onCloseComparison: () => void;
  onSelectComparison: () => void;
}) {
  const visibleItems = report.items.slice(0, PREVIEW_ITEMS);
  const comparison = comparisonReport ? compareSnapshotDiffReports(report, comparisonReport) : null;
  return (
    <section className="border-b border-[rgba(60,60,67,0.12)] bg-[rgba(52,199,89,0.055)] px-4 py-3" data-testid="snapshot-diff-import-preview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[#248a3d]">
            <CheckCircle2 size={16} aria-hidden="true" />
            <h3 className="text-sm font-semibold">검증된 diff 보고서</h3>
          </div>
          <p className="ku-meta mt-1 truncate" title={fileName}>{fileName} · schema v{report.schemaVersion} · {formatLastSync(report.exportedAt)}</p>
          <p className="mt-2 text-sm font-semibold text-[#1d1d1f]">
            {report.baseline.label} → {report.current.label}
          </p>
          <p className="ku-meta mt-1">
            {scopeLabel(report.filters.scope)} {report.items.length}개 · {changeLabel(report.filters.changeType)}
            {report.filters.relationTypes.length > 0 ? ` · 관계 유형 ${report.filters.relationTypes.length}개` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="ku-control" type="button" data-testid="snapshot-diff-compare-select" onClick={onSelectComparison}>
            <GitCompareArrows size={15} aria-hidden="true" />
            {comparison ? '비교 보고서 교체' : '두 번째 Diff 비교'}
          </button>
          <button className="ku-icon-button" type="button" title="Diff 미리보기 닫기" aria-label="Diff 미리보기 닫기" onClick={onClose}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      {comparison && comparisonReport && comparisonFileName ? (
        <SnapshotDiffReportComparison
          comparison={comparison}
          fileName={comparisonFileName}
          report={comparisonReport}
          onClose={onCloseComparison}
        />
      ) : null}
      {comparisonError ? <p className="mt-3 text-xs font-semibold text-[#b26a00]" data-testid="snapshot-diff-compare-error">{comparisonError}</p> : null}

      <div className="mt-3 overflow-hidden border-y border-[rgba(60,60,67,0.10)]" data-testid="snapshot-diff-import-items">
        {visibleItems.map((item, index) => (
          <div key={`${String(item.change)}:${index}`} className="flex min-w-0 items-center gap-2 border-b border-[rgba(60,60,67,0.07)] px-1 py-2 text-xs last:border-b-0">
            <span className="w-14 shrink-0 font-mono font-semibold uppercase text-[#0057b8]">{String(item.change)}</span>
            <span className="min-w-0 truncate text-[rgba(60,60,67,0.78)]" title={itemLabel(item, report.filters.scope)}>{itemLabel(item, report.filters.scope)}</span>
          </div>
        ))}
        {report.items.length === 0 ? (
          <div className="flex items-center gap-2 px-1 py-3 text-xs text-[rgba(60,60,67,0.62)]">
            <FileJson size={14} aria-hidden="true" />
            내보낸 변경 항목이 없습니다.
          </div>
        ) : null}
      </div>
      {report.items.length > visibleItems.length ? <p className="ku-meta mt-2">+{report.items.length - visibleItems.length}개 항목</p> : null}
      <p className="ku-meta mt-2">읽기 전용 미리보기이며 topology, 검색어, raw resource 값은 포함하지 않습니다.</p>
    </section>
  );
}

function SnapshotDiffReportComparison({
  comparison,
  fileName,
  report,
  onClose,
}: {
  comparison: ReturnType<typeof compareSnapshotDiffReports>;
  fileName: string;
  report: ImportedSnapshotDiff;
  onClose: () => void;
}) {
  const metrics: Array<{ key: keyof SnapshotDiffReportSummary; label: string }> = [
    { key: 'exported', label: '내보낸 항목' },
    { key: 'resources', label: '리소스 변화' },
    { key: 'relations', label: '관계 변화' },
    { key: 'clusters', label: '클러스터 변화' },
    { key: 'added', label: '추가' },
    { key: 'changed', label: '변경' },
    { key: 'removed', label: '삭제' },
  ];
  return (
    <div className="mt-3 border-y border-[rgba(60,60,67,0.12)] bg-white/70 py-3" data-testid="snapshot-diff-report-comparison">
      <div className="flex flex-wrap items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#1d1d1f]">Diff 보고서 요약 변화</p>
          <p className="ku-meta mt-1 truncate" title={fileName}>{fileName} · {report.baseline.label} → {report.current.label}</p>
        </div>
        <button className="ku-icon-button" type="button" title="비교 보고서 닫기" aria-label="비교 보고서 닫기" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {!comparison.sameScope ? (
        <p className="mt-2 px-1 text-xs font-semibold text-[#b26a00]" data-testid="snapshot-diff-report-scope-warning">
          보고서 범위가 달라 전체 합계만 참고용으로 표시합니다.
        </p>
      ) : null}
      <div className="mt-3 grid gap-px overflow-hidden border-y border-[rgba(60,60,67,0.1)] bg-[rgba(60,60,67,0.08)] sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ key, label }) => (
          <div key={key} className="bg-white px-3 py-2" data-testid={`snapshot-diff-report-delta-${key}`}>
            <p className="ku-meta">{label}</p>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-[#1d1d1f]">{comparison.right[key]}</span>
              <span className={`font-mono text-xs font-semibold ${deltaTone(comparison.delta[key])}`}>{formatDelta(comparison.delta[key])}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="ku-meta mt-2 px-1">요약 수치만 비교하며 raw resource, Events, Logs, Secret 값은 보관하지 않습니다.</p>
    </div>
  );
}

function formatDelta(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function deltaTone(value: number) {
  return value > 0 ? 'text-[#b05f00]' : value < 0 ? 'text-[#248a3d]' : 'text-[rgba(60,60,67,0.52)]';
}

function itemLabel(item: Record<string, unknown>, scope: ImportedSnapshotDiff['filters']['scope']) {
  if (scope === 'resources') {
    return [item.kind, item.namespace, item.name].filter(Boolean).join(' / ');
  }
  if (scope === 'relations') {
    const source = item.source as Record<string, unknown>;
    const target = item.target as Record<string, unknown>;
    return `${resourceLabel(source)} → ${String(item.relation)} → ${resourceLabel(target)}`;
  }
  return `${String(item.clusterName)} · ${String(item.clusterId)}`;
}

function resourceLabel(identity: Record<string, unknown>) {
  return [identity.kind, identity.namespace, identity.name].filter(Boolean).map(String).join('/');
}

function scopeLabel(scope: ImportedSnapshotDiff['filters']['scope']) {
  return scope === 'resources' ? '리소스' : scope === 'relations' ? '관계' : '클러스터';
}

function changeLabel(change: ImportedSnapshotDiff['filters']['changeType']) {
  return change === 'all' ? '전체 변경' : change === 'changed' ? '변경' : change === 'added' ? '추가' : '삭제';
}
