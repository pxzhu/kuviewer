import { GitBranch, Link2, Search } from 'lucide-react';
import type { ResourceExplorerItem } from '../../types/resourceExplorer';
import { DetailSection } from './ResourceDetailPrimitives';
import { renderHighlightedText } from './resourceDetailHighlight';
import type { RelationGroup } from './resourceDetailTypes';

export function ResourceRelationsSection({
  active,
  expanded,
  filter,
  filteredRelations,
  groups,
  hiddenCount,
  normalizedFilter,
  onFilterChange,
  onFocusSection,
  onOpenTopologyNode,
  onSelectNode,
  onToggle,
  onToggleExpanded,
  open,
  resource,
  sectionRef,
  summary,
}: {
  active: boolean;
  expanded: boolean;
  filter: string;
  filteredRelations: ResourceExplorerItem['related'];
  groups: RelationGroup[];
  hiddenCount: number;
  normalizedFilter: string;
  onFilterChange: (value: string) => void;
  onFocusSection: () => void;
  onOpenTopologyNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onToggle: () => void;
  onToggleExpanded: () => void;
  open: boolean;
  resource: ResourceExplorerItem;
  sectionRef: (node: HTMLElement | null) => void;
  summary: string;
}) {
  return (
    <DetailSection id="relations" icon={Link2} title="Relations" summary={summary} open={open} active={active} sectionRef={sectionRef} onFocusSection={onFocusSection} onToggle={onToggle}>
      {resource.related.length === 0 ? (
        <p className="ku-meta">관계 없음</p>
      ) : (
        <div className="grid gap-2">
          <div className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
              <input className="ku-input w-full pl-9" placeholder="관계 검색" value={filter} onChange={(event) => onFilterChange(event.target.value)} />
            </label>
            <div className="flex items-center justify-between gap-2">
              <span className="ku-chip">
                {filteredRelations.length} / {resource.related.length}
              </span>
              {filter ? (
                <button
                  className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                  type="button"
                  onClick={() => onFilterChange('')}
                >
                  초기화
                </button>
              ) : null}
            </div>
          </div>
          {filteredRelations.length === 0 ? (
            <p className="ku-meta">필터와 일치하는 관계가 없습니다.</p>
          ) : (
            <div className="grid gap-2">
              {groups.map((group) => (
                <div key={group.key} className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">
                      {renderHighlightedText(group.label, normalizedFilter)}
                    </p>
                    <span className="ku-chip">{group.count}</span>
                  </div>
                  <div className="grid gap-1.5">
                    {group.items.map((related) => (
                      <div key={`${related.direction}:${related.edgeType}:${related.nodeId}`} className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.12)] bg-white/75 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <button className="min-w-0 text-left" type="button" onClick={() => onSelectNode(related.nodeId)}>
                          <p className="truncate text-xs font-semibold text-[#1d1d1f]">
                            {related.direction === 'outgoing' ? '→' : '←'} {renderHighlightedText(related.name, normalizedFilter)}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.58)]">
                            {renderHighlightedText(`${related.edgeType} · ${related.namespace ? `${related.namespace} / ` : ''}${related.kind}`, normalizedFilter)}
                          </p>
                        </button>
                        <button
                          className="inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.06)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)]"
                          type="button"
                          onClick={() => onOpenTopologyNode(related.nodeId)}
                        >
                          <GitBranch size={13} aria-hidden="true" />
                          토폴로지
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {hiddenCount > 0 || expanded ? (
                <button
                  className="rounded-[9px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                  type="button"
                  onClick={onToggleExpanded}
                >
                  {expanded ? '접기' : `+${hiddenCount} more`}
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </DetailSection>
  );
}
