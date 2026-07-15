import { CheckCircle2, FileJson, X } from 'lucide-react';
import type { ImportedSnapshotDiff } from '../../features/snapshot/importSnapshotDiff';
import { formatLastSync } from '../../utils/formatTime';

const PREVIEW_ITEMS = 12;

export function SnapshotDiffImportPreview({
  fileName,
  report,
  onClose,
}: {
  fileName: string;
  report: ImportedSnapshotDiff;
  onClose: () => void;
}) {
  const visibleItems = report.items.slice(0, PREVIEW_ITEMS);
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
        <button className="ku-icon-button" type="button" title="Diff 미리보기 닫기" aria-label="Diff 미리보기 닫기" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>

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
