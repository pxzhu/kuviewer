import type { TopologyNode } from '../types/topology';

interface ResourceListProps {
  nodes: TopologyNode[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}

export function ResourceList({ nodes, selectedNodeId, onSelectNode }: ResourceListProps) {
  return (
    <section className="ku-panel overflow-hidden">
      <div className="border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#1d1d1f]">리소스</h2>
            <p className="ku-meta mt-1">필터된 오브젝트</p>
          </div>
          <span className="ku-chip h-7 px-2.5">
            {nodes.length}
          </span>
        </div>
      </div>
      <div className="max-h-[320px] overflow-auto">
        {nodes.length === 0 ? <p className="px-4 py-5 text-sm font-medium text-[rgba(60,60,67,0.66)]">표시할 리소스가 없습니다.</p> : null}
        {nodes.map((node) => (
          <button
            key={node.id}
            className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[rgba(60,60,67,0.08)] px-4 py-3 text-left transition last:border-b-0 ${
              selectedNodeId === node.id ? 'bg-[rgba(0,122,255,0.08)]' : 'hover:bg-[rgba(242,242,247,0.68)]'
            }`}
            type="button"
            onClick={() => onSelectNode(node.id)}
          >
            <span>
              <span className="block truncate text-sm font-semibold text-[#1d1d1f]">{node.name}</span>
              <span className="mt-1 block truncate font-mono text-[11px] font-semibold text-[rgba(60,60,67,0.58)]">
                {node.namespace ? `${node.namespace} / ` : ''}
                {node.kind}
              </span>
            </span>
            <span
              className={`h-6 rounded-full border px-2 pt-1 font-mono text-[11px] font-semibold ${
                node.status === 'healthy'
                  ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.10)] text-[#248a3d]'
                  : node.status === 'warning'
                    ? 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]'
                    : node.status === 'error'
                      ? 'border-[rgba(255,59,48,0.22)] bg-[rgba(255,59,48,0.10)] text-[#d70015]'
                      : 'border-[rgba(142,142,147,0.22)] bg-[rgba(142,142,147,0.12)] text-[#636366]'
              }`}
            >
              {node.status}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
