import type { TopologyEdge, TopologyNode } from '../types/topology';

interface DetailPanelProps {
  node?: TopologyNode;
  edges: TopologyEdge[];
  nodeMap: Map<string, TopologyNode>;
}

export function DetailPanel({ node, edges, nodeMap }: DetailPanelProps) {
  if (!node) {
    return (
      <section className="ku-panel p-4">
        <p className="text-sm font-medium text-[rgba(60,60,67,0.66)]">리소스를 선택하면 상세 정보를 볼 수 있습니다.</p>
      </section>
    );
  }

  const relatedEdges = edges.filter((edge) => edge.source === node.id || edge.target === node.id);

  return (
    <section className="ku-panel overflow-hidden">
      <div className="border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
        <p className="ku-meta">{node.kind}</p>
        <h2 className="mt-1 break-words text-lg font-semibold tracking-[-0.02em] text-[#1d1d1f]">{node.name}</h2>
        <p className="mt-1 font-mono text-[11px] font-semibold text-[rgba(60,60,67,0.58)]">{node.namespace || node.clusterId}</p>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <h3 className="text-sm font-semibold text-[#1d1d1f]">요약</h3>
          <dl className="mt-2 grid grid-cols-1 gap-2 text-sm">
            {Object.entries(node.summary).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3 rounded-[11px] border border-[rgba(60,60,67,0.12)] bg-[rgba(242,242,247,0.66)] px-3 py-2">
                <dt className="font-mono text-[11px] font-semibold uppercase text-[rgba(60,60,67,0.58)]">{key}</dt>
                <dd className="break-all text-sm font-semibold text-[#1d1d1f]">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#1d1d1f]">라벨</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(node.labels).map(([key, value]) => (
              <span key={key} className="rounded-full border border-[rgba(60,60,67,0.12)] bg-white/80 px-2.5 py-1 font-mono text-[11px] font-semibold text-[rgba(60,60,67,0.72)]">
                {key}={value}
              </span>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#1d1d1f]">관계</h3>
          <div className="mt-2 space-y-2">
            {relatedEdges.map((edge) => {
              const isOutgoing = edge.source === node.id;
              const related = nodeMap.get(isOutgoing ? edge.target : edge.source);

              return (
                <div key={edge.id} className="rounded-[11px] border border-[rgba(60,60,67,0.12)] bg-white/78 px-3 py-2">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.04em] text-[rgba(60,60,67,0.58)]">
                    {isOutgoing ? '대상' : '출처'} · {edge.type}
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold text-[#1d1d1f]">{related?.name || '알 수 없음'}</p>
                  <p className="mt-1 break-words font-mono text-[11px] font-semibold text-[rgba(60,60,67,0.58)]">{edge.sourceField}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
