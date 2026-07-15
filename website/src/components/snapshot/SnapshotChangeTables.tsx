import { useMemo, useState, type ReactNode } from 'react';
import type {
  SnapshotChangeType,
  SnapshotClusterChange,
  SnapshotEdgeChange,
  SnapshotNodeChange,
} from '../../features/snapshot/compareSnapshots';
import { VirtualizedTable } from './VirtualizedTable';

export interface RelationTypeOption {
  relation: string;
  count: number;
}

export function ResourceChangeTable({
  changes,
  currentNodeIds,
  onOpenTopologyNode,
}: {
  changes: SnapshotNodeChange[];
  currentNodeIds: Set<string>;
  onOpenTopologyNode: (nodeId: string) => void;
}) {
  return (
    <VirtualizedTable
      ariaLabel="리소스 변경"
      columnCount={5}
      minWidth="720px"
      rows={changes}
      testId="snapshot-compare-resource-table"
      header={(
        <tr className="border-b border-[rgba(60,60,67,0.12)] text-[11px] uppercase text-[rgba(60,60,67,0.58)]">
          <TableHeading>변경</TableHeading>
          <TableHeading>Kind</TableHeading>
          <TableHeading>Namespace / Name</TableHeading>
          <TableHeading>Status</TableHeading>
          <TableHeading>Changed fields</TableHeading>
        </tr>
      )}
      renderRow={(change, index) => (
        <tr key={`${change.type}:${change.id}`} className="h-16 border-b border-[rgba(60,60,67,0.08)]" aria-rowindex={index + 2}>
          <TableCell><ChangeBadge type={change.type} /></TableCell>
          <TableCell className="font-mono text-xs font-semibold">{change.kind}</TableCell>
          <TableCell>
            <button
              className="max-w-[420px] text-left font-semibold text-[#0066cc] hover:underline disabled:text-[#1d1d1f] disabled:no-underline"
              type="button"
              disabled={change.type === 'removed' || !currentNodeIds.has(change.id)}
              onClick={() => onOpenTopologyNode(change.id)}
            >
              <span className="block text-[11px] font-medium text-[rgba(60,60,67,0.58)]">{change.namespace}</span>
              <span className="block max-w-[420px] truncate">{change.name}</span>
            </button>
          </TableCell>
          <TableCell className="font-mono text-xs">{formatStatusChange(change.beforeStatus, change.afterStatus)}</TableCell>
          <TableCell className="max-w-[220px] truncate text-xs text-[rgba(60,60,67,0.72)]">{change.changedFields.join(', ') || '-'}</TableCell>
        </tr>
      )}
    />
  );
}

export function RelationTypeFilter({
  options,
  selected,
  onClear,
  onToggle,
}: {
  options: RelationTypeOption[];
  selected: Set<string>;
  onClear: () => void;
  onToggle: (relation: string) => void;
}) {
  return (
    <div className="border-b border-[rgba(60,60,67,0.10)] pb-3" data-testid="snapshot-compare-relation-type-filter">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="ku-meta">관계 유형 다중 필터 · {selected.size === 0 ? '전체' : `${selected.size}개 선택`}</p>
        {selected.size > 0 ? (
          <button className="text-xs font-semibold text-[#0066cc]" type="button" onClick={onClear}>전체 보기</button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="관계 유형 필터">
        <button
          className={`ku-chip transition ${selected.size === 0 ? 'border-[#007aff] bg-[rgba(0,122,255,0.10)] text-[#0057b8]' : ''}`}
          type="button"
          aria-pressed={selected.size === 0}
          data-testid="snapshot-compare-relation-type-all"
          onClick={onClear}
        >
          전체 {options.reduce((total, option) => total + option.count, 0)}
        </button>
        {options.map((option) => {
          const active = selected.has(option.relation);
          return (
            <button
              key={option.relation}
              className={`ku-chip transition ${active ? 'border-[#007aff] bg-[rgba(0,122,255,0.10)] text-[#0057b8]' : ''}`}
              type="button"
              aria-pressed={active}
              data-testid={`snapshot-compare-relation-type-${snapshotDomId(option.relation)}`}
              onClick={() => onToggle(option.relation)}
            >
              {option.relation} {option.count}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RelationChangeTable({
  changes,
  currentNodeIds,
  onOpenTopologyNode,
}: {
  changes: SnapshotEdgeChange[];
  currentNodeIds: Set<string>;
  onOpenTopologyNode: (nodeId: string) => void;
}) {
  const [groupByType, setGroupByType] = useState(true);
  const relationTypeCount = useMemo(() => new Set(changes.map((change) => change.relation)).size, [changes]);
  const rows = useMemo(() => buildRelationDisplayRows(changes, groupByType), [changes, groupByType]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ku-meta" data-testid="snapshot-compare-relation-summary">관계 {changes.length}개 · 유형 {relationTypeCount}개</p>
        <div className="ku-segmented grid-cols-2" aria-label="관계 표시 방식">
          <button
            className={`ku-segmented-button ${groupByType ? 'ku-segmented-button-active' : ''}`}
            type="button"
            aria-pressed={groupByType}
            data-testid="snapshot-compare-relation-grouped"
            onClick={() => setGroupByType(true)}
          >유형별</button>
          <button
            className={`ku-segmented-button ${!groupByType ? 'ku-segmented-button-active' : ''}`}
            type="button"
            aria-pressed={!groupByType}
            data-testid="snapshot-compare-relation-flat"
            onClick={() => setGroupByType(false)}
          >평면</button>
        </div>
      </div>
      <VirtualizedTable
        ariaLabel="관계 변경"
        columnCount={5}
        minWidth="880px"
        rows={rows}
        testId="snapshot-compare-relation-table"
        header={(
          <tr className="border-b border-[rgba(60,60,67,0.12)] text-[11px] uppercase text-[rgba(60,60,67,0.58)]">
            <TableHeading>변경</TableHeading>
            <TableHeading>관계</TableHeading>
            <TableHeading>Source</TableHeading>
            <TableHeading>Target</TableHeading>
            <TableHeading>근거</TableHeading>
          </tr>
        )}
        renderRow={(row, index) => row.kind === 'group' ? (
          <tr key={row.key} className="h-16 border-b border-[rgba(0,122,255,0.12)] bg-[rgba(0,122,255,0.045)]" aria-rowindex={index + 2} data-testid="snapshot-compare-relation-group-row">
            <td className="px-2 py-2" colSpan={5}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-[#0057b8]">{row.relation}</span>
                <span className="font-mono text-[10px] text-[rgba(60,60,67,0.62)]">{formatChangeCounts(row.counts)} · 총 {row.total}</span>
              </div>
            </td>
          </tr>
        ) : (
          <RelationChangeRow
            key={row.key}
            change={row.change}
            currentNodeIds={currentNodeIds}
            rowIndex={index + 2}
            onOpenTopologyNode={onOpenTopologyNode}
          />
        )}
      />
    </div>
  );
}

export function ClusterChangeTable({ changes }: { changes: SnapshotClusterChange[] }) {
  return (
    <VirtualizedTable
      ariaLabel="클러스터 변경"
      columnCount={6}
      minWidth="820px"
      rows={changes}
      testId="snapshot-compare-cluster-table"
      header={(
        <tr className="border-b border-[rgba(60,60,67,0.12)] text-[11px] uppercase text-[rgba(60,60,67,0.58)]">
          <TableHeading>변경</TableHeading>
          <TableHeading>Cluster</TableHeading>
          <TableHeading>Provider / Version</TableHeading>
          <TableHeading>Node readiness</TableHeading>
          <TableHeading>Workload summary</TableHeading>
          <TableHeading>Changed fields</TableHeading>
        </tr>
      )}
      renderRow={(change, index) => {
        const before = change.before;
        const after = change.after;
        return (
          <tr key={`${change.type}:${change.id}`} className="h-16 border-b border-[rgba(60,60,67,0.08)]" aria-rowindex={index + 2} data-testid="snapshot-compare-cluster-row">
            <TableCell><ChangeBadge type={change.type} /></TableCell>
            <TableCell>
              <span className="block max-w-[180px] truncate font-semibold" title={change.name}>{change.name}</span>
              <span className="block max-w-[180px] truncate font-mono text-[10px] text-[rgba(60,60,67,0.52)]" title={change.id}>{change.id}</span>
            </TableCell>
            <TableCell className="font-mono text-xs">{formatMetricChange(clusterProvider(before), clusterProvider(after))}</TableCell>
            <TableCell className="font-mono text-xs">{formatMetricChange(clusterNodes(before), clusterNodes(after))}</TableCell>
            <TableCell className="font-mono text-xs">{formatMetricChange(clusterWorkloads(before), clusterWorkloads(after))}</TableCell>
            <TableCell className="max-w-[220px] truncate text-xs text-[rgba(60,60,67,0.72)]">{change.changedFields.join(', ') || '-'}</TableCell>
          </tr>
        );
      }}
    />
  );
}

export function relationTypeCounts(changes: SnapshotEdgeChange[]): RelationTypeOption[] {
  const counts = new Map<string, number>();
  changes.forEach((change) => counts.set(change.relation, (counts.get(change.relation) || 0) + 1));
  return [...counts.entries()]
    .map(([relation, count]) => ({ relation, count }))
    .sort((left, right) => left.relation.localeCompare(right.relation));
}

function RelationChangeRow({
  change,
  currentNodeIds,
  rowIndex,
  onOpenTopologyNode,
}: {
  change: SnapshotEdgeChange;
  currentNodeIds: Set<string>;
  rowIndex: number;
  onOpenTopologyNode: (nodeId: string) => void;
}) {
  return (
    <tr className="h-16 border-b border-[rgba(60,60,67,0.08)]" aria-rowindex={rowIndex} data-testid="snapshot-compare-relation-row">
      <TableCell><ChangeBadge type={change.type} /></TableCell>
      <TableCell><span className="font-mono text-xs font-semibold text-[#0057b8]">{change.relation}</span></TableCell>
      <TableCell><SnapshotResourceLink identity={change.source} enabled={currentNodeIds.has(change.source.id)} onOpen={onOpenTopologyNode} /></TableCell>
      <TableCell><SnapshotResourceLink identity={change.target} enabled={currentNodeIds.has(change.target.id)} onOpen={onOpenTopologyNode} /></TableCell>
      <TableCell className="max-w-[280px]">
        <span className="block truncate font-mono text-[11px] text-[rgba(60,60,67,0.72)]" title={change.sourceField}>{change.sourceField || '-'}</span>
        <span className="mt-0.5 block text-[10px] uppercase text-[rgba(60,60,67,0.52)]">{change.confidence}</span>
        {change.changedFields.length > 0 ? <span className="mt-0.5 block truncate text-[10px] text-[#b05f00]">{change.changedFields.join(', ')}</span> : null}
      </TableCell>
    </tr>
  );
}

function SnapshotResourceLink({ identity, enabled, onOpen }: { identity: SnapshotEdgeChange['source']; enabled: boolean; onOpen: (nodeId: string) => void }) {
  return (
    <button
      className="max-w-[260px] text-left font-semibold text-[#0066cc] hover:underline disabled:text-[#1d1d1f] disabled:no-underline"
      type="button"
      disabled={!enabled}
      onClick={() => onOpen(identity.id)}
    >
      <span className="block truncate text-[11px] font-medium text-[rgba(60,60,67,0.58)]">{identity.kind} · {identity.namespace}</span>
      <span className="block truncate" title={identity.name}>{identity.name}</span>
    </button>
  );
}

function TableHeading({ children }: { children: ReactNode }) {
  return <th className="px-2 py-2 font-semibold">{children}</th>;
}

function TableCell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-2 py-2 ${className}`}>{children}</td>;
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

type RelationDisplayRow =
  | { kind: 'group'; key: string; relation: string; counts: Record<SnapshotChangeType, number>; total: number }
  | { kind: 'change'; key: string; change: SnapshotEdgeChange };

function buildRelationDisplayRows(changes: SnapshotEdgeChange[], grouped: boolean): RelationDisplayRow[] {
  if (!grouped) {
    return changes.map((change) => ({ kind: 'change', key: `${change.type}:${change.id}`, change }));
  }
  const groups = new Map<string, SnapshotEdgeChange[]>();
  changes.forEach((change) => {
    const group = groups.get(change.relation);
    if (group) {
      group.push(change);
    } else {
      groups.set(change.relation, [change]);
    }
  });
  const rows: RelationDisplayRow[] = [];
  [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).forEach(([relation, groupChanges]) => {
    rows.push({ kind: 'group', key: `group:${relation}`, relation, counts: countChanges(groupChanges), total: groupChanges.length });
    groupChanges.forEach((change) => rows.push({ kind: 'change', key: `${change.type}:${change.id}`, change }));
  });
  return rows;
}

function countChanges(changes: Array<{ type: SnapshotChangeType }>) {
  return {
    changed: changes.filter((change) => change.type === 'changed').length,
    added: changes.filter((change) => change.type === 'added').length,
    removed: changes.filter((change) => change.type === 'removed').length,
  };
}

function formatChangeCounts(counts: Record<SnapshotChangeType, number>) {
  return `~${counts.changed} / +${counts.added} / -${counts.removed}`;
}

function formatStatusChange(before?: string, after?: string) {
  if (before && after && before !== after) {
    return `${before} -> ${after}`;
  }
  return after || before || '-';
}

function clusterProvider(cluster?: SnapshotClusterChange['before']) {
  return cluster ? `${cluster.provider} · ${cluster.version}` : undefined;
}

function clusterNodes(cluster?: SnapshotClusterChange['before']) {
  return cluster ? `${cluster.nodeReady}/${cluster.nodeTotal} ready` : undefined;
}

function clusterWorkloads(cluster?: SnapshotClusterChange['before']) {
  return cluster ? `${cluster.podRunning} running · ${cluster.podWarning} warning · ${cluster.namespaces} ns` : undefined;
}

function formatMetricChange(before?: string, after?: string) {
  if (before && after && before !== after) {
    return `${before} -> ${after}`;
  }
  return after || before || '-';
}

function snapshotDomId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
