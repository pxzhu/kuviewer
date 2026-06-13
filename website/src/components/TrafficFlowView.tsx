import { AlertTriangle, ArrowRight, Cloud, Database, GitBranch, Server, Settings, Shield, Workflow } from 'lucide-react';
import type { TopologyEdge, TopologyNode } from '../types/topology';

interface TrafficFlowViewProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  visibleNodeIds?: Set<string>;
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}

interface FlowStep {
  id: string;
  label: string;
  detail: string;
  node?: TopologyNode;
  tone?: 'blocked';
}

interface TrafficFlow {
  id: string;
  title: string;
  description: string;
  status: TopologyNode['status'];
  steps: FlowStep[];
  dependencies: TopologyNode[];
  evidence: FlowEvidence[];
  evidenceSummary: string;
  issue?: string;
}

interface FlowEvidence {
  id: string;
  relation: string;
  source: string;
  target: string;
  sourceField: string;
  confidence: TopologyEdge['confidence'];
}

export function TrafficFlowView({ nodes, edges, visibleNodeIds, selectedNodeId, onSelectNode }: TrafficFlowViewProps) {
  const allFlows = buildTrafficFlows(nodes, edges);
  const flows = visibleNodeIds ? allFlows.filter((flow) => flowMatchesVisibleNodes(flow, visibleNodeIds)) : allFlows;
  const flowCountLabel = flows.length === allFlows.length ? `${flows.length}개 흐름` : `${flows.length}/${allFlows.length}개 흐름`;

  return (
    <section className="ku-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[#1d1d1f]">트래픽 흐름</h2>
          <p className="ku-meta mt-1">Ingress/Service spec 및 EndpointSlice 상태에서 추론한 YAML 기반 요청 경로</p>
        </div>
        <div className="ku-chip">
          <Workflow size={16} aria-hidden="true" />
          <span>{flowCountLabel}</span>
        </div>
      </div>

      <div className="grid gap-4 p-4">
        {flows.map((flow) => (
          <article key={flow.id} className="rounded-[14px] border border-[rgba(60,60,67,0.12)] bg-white/80 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.05)] backdrop-blur-xl">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-[#1d1d1f]">{flow.title}</h3>
                  <span className={statusClassName(flow.status)}>{flow.status}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-[rgba(60,60,67,0.68)]">{flow.description}</p>
              </div>
              <span className={flowSummaryClassName(flow)}>
                {flow.evidenceSummary}
              </span>
            </div>

            <div className="mt-4 overflow-x-auto pb-2">
              <div className="flex min-w-max items-stretch gap-2">
                {flow.steps.map((step, index) => (
                  <div key={step.id} className="flex items-center gap-2">
                    <button
                      className={`min-h-[92px] w-44 rounded-[13px] border bg-white/90 p-3 text-left shadow-[0_4px_16px_rgba(0,0,0,0.05)] backdrop-blur-xl transition hover:border-[rgba(0,122,255,0.28)] disabled:cursor-default disabled:opacity-75 ${
                        step.node?.id === selectedNodeId ? 'border-[#007aff] ring-4 ring-[rgba(0,122,255,0.14)]' : 'border-[rgba(60,60,67,0.12)]'
                      }`}
                      type="button"
                      onClick={() => step.node && onSelectNode(step.node.id)}
                      disabled={!step.node}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-8 w-8 items-center justify-center rounded-[9px] ring-1 ${
                            step.tone === 'blocked'
                              ? 'bg-[rgba(255,59,48,0.10)] text-[#ff3b30] ring-[rgba(255,59,48,0.18)]'
                              : 'bg-[rgba(0,122,255,0.10)] text-[#007aff] ring-[rgba(0,122,255,0.16)]'
                          }`}
                        >
                          {stepIcon(step.node?.kind || step.label)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-[#1d1d1f]">{step.label}</span>
                          <span className="block truncate font-mono text-[11px] font-semibold text-[rgba(60,60,67,0.58)]">{step.detail}</span>
                        </span>
                      </div>
                    </button>

                    {index < flow.steps.length - 1 ? (
                      <ArrowRight className="shrink-0 text-[#007aff]" size={18} aria-hidden="true" />
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {flow.issue ? (
              <div className="mt-3 rounded-[11px] border border-[rgba(255,59,48,0.18)] bg-[rgba(255,59,48,0.08)] px-3 py-2">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.04em] text-[#ff3b30]">차단된 경로</p>
                <p className="mt-1 text-sm font-semibold text-[#7a1f19]">{flow.issue}</p>
              </div>
            ) : null}

            {flow.dependencies.length > 0 ? (
              <div className="mt-3 rounded-[11px] border border-[rgba(60,60,67,0.12)] bg-[rgba(242,242,247,0.66)] p-3">
                <p className="ku-meta">Pod 의존성</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {flow.dependencies.map((dependency) => (
                    <button
                      key={dependency.id}
                      className="rounded-full border border-[rgba(60,60,67,0.12)] bg-white/80 px-2.5 py-1 font-mono text-[11px] font-semibold text-[rgba(60,60,67,0.72)] transition hover:border-[rgba(0,122,255,0.22)] hover:bg-[rgba(0,122,255,0.08)] hover:text-[#007aff]"
                      type="button"
                      onClick={() => onSelectNode(dependency.id)}
                    >
                      {dependency.kind}: {dependency.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <details className="mt-3 rounded-[11px] border border-[rgba(60,60,67,0.12)] bg-white/78 px-3 py-2">
              <summary className="cursor-pointer font-mono text-[11px] font-semibold uppercase tracking-[0.04em] text-[rgba(60,60,67,0.58)]">
                YAML 근거 필드
              </summary>
              <div className="mt-2 grid gap-2">
                {flow.evidence.map((item) => (
                  <div key={item.id} className="rounded-[11px] border border-[rgba(60,60,67,0.12)] bg-[rgba(242,242,247,0.66)] px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="ku-meta">{item.relation}</p>
                      <span className={confidenceClassName(item.confidence)}>{confidenceLabel(item.confidence)}</span>
                    </div>
                    <p className="mt-1 break-words text-xs font-semibold text-[#1d1d1f]">
                      {item.source} -&gt; {item.target}
                    </p>
                    <code className="mt-1 block break-words font-mono text-[11px] font-semibold text-[rgba(60,60,67,0.58)]">{item.sourceField}</code>
                  </div>
                ))}
              </div>
            </details>
          </article>
        ))}

        {flows.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[rgba(60,60,67,0.18)] bg-white/70 p-6 text-sm font-medium text-[rgba(60,60,67,0.68)]">
            현재 필터에 맞는 트래픽 흐름이 없습니다.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function buildTrafficFlows(nodes: TopologyNode[], edges: TopologyEdge[]): TrafficFlow[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const routedServices = new Set(edges.filter((edge) => edge.type === 'routes-to').map((edge) => edge.target));
  const flows: TrafficFlow[] = [];

  edges
    .filter((edge) => edge.type === 'routes-to')
    .forEach((routeEdge) => {
      const ingress = nodeMap.get(routeEdge.source);
      const service = nodeMap.get(routeEdge.target);

      if (!ingress || !service) {
        return;
      }

      const endpointEdges = edges.filter((edge) => edge.source === service.id && edge.type === 'service-endpoint');
      if (endpointEdges.length === 0) {
        flows.push(createFlow({
          id: `external-${routeEdge.id}-missing-endpoint`,
          title: `${ingress.name} -> ${service.name}`,
          description: `${ingress.kind}가 외부 트래픽을 ${service.kind}로 라우팅하지만 표시되는 백엔드 Pod 엔드포인트가 없습니다.`,
          entryLabel: '외부 클라이언트',
          entryDetail: 'HTTP/TCP 요청',
          ingress,
          service,
          dependencies: [],
          evidenceEdges: [routeEdge],
          issue: 'Service에 표시 가능한 EndpointSlice 대상 또는 selector와 일치하는 Pod가 없습니다.',
          nodeMap,
        }));
        return;
      }

      endpointEdges.forEach((endpointEdge) => {
        const pod = nodeMap.get(endpointEdge.target);
        if (!pod) {
          return;
        }

        flows.push(createFlow({
          id: `external-${routeEdge.id}-${endpointEdge.id}`,
          title: `${ingress.name} -> ${service.name}`,
          description: `${ingress.kind}가 외부 트래픽을 ${service.kind}로 라우팅하고, EndpointSlice가 준비된 백엔드 Pod를 해석합니다.`,
          entryLabel: '외부 클라이언트',
          entryDetail: 'HTTP/TCP 요청',
          ingress,
          service,
          pod,
          node: targetNode(pod, edges, nodeMap),
          dependencies: podDependencies(pod, edges, nodeMap),
          evidenceEdges: [routeEdge, endpointEdge, ...podEvidenceEdges(pod, edges)],
          nodeMap,
        }));
      });
    });

  edges
    .filter((edge) => edge.type === 'service-endpoint' && !routedServices.has(edge.source))
    .forEach((endpointEdge) => {
      const service = nodeMap.get(endpointEdge.source);
      const pod = nodeMap.get(endpointEdge.target);

      if (!service || !pod) {
        return;
      }

      flows.push(createFlow({
        id: `internal-${endpointEdge.id}`,
        title: `클러스터 DNS -> ${service.name}`,
        description: '클러스터 내부 트래픽이 Service 이름을 해석하고, EndpointSlice가 백엔드 Pod를 가리킵니다.',
        entryLabel: '클러스터 내부 클라이언트',
        entryDetail: 'Service DNS 요청',
        service,
        pod,
        node: targetNode(pod, edges, nodeMap),
        dependencies: podDependencies(pod, edges, nodeMap),
        evidenceEdges: [endpointEdge, ...podEvidenceEdges(pod, edges)],
        nodeMap,
      }));
    });

  const servicesWithEndpoints = new Set(edges.filter((edge) => edge.type === 'service-endpoint').map((edge) => edge.source));
  nodes
    .filter((node) => node.kind === 'Service' && !servicesWithEndpoints.has(node.id) && !routedServices.has(node.id))
    .forEach((service) => {
      flows.push(createFlow({
        id: `internal-${service.id}-missing-endpoint`,
        title: `클러스터 DNS -> ${service.name}`,
        description: '클러스터 내부 트래픽이 Service 이름은 해석할 수 있지만 표시되는 백엔드 Pod 엔드포인트가 없습니다.',
        entryLabel: '클러스터 내부 클라이언트',
        entryDetail: 'Service DNS 요청',
        service,
        dependencies: [],
        evidenceEdges: [],
        issue: 'Service에 표시 가능한 EndpointSlice 대상 또는 selector와 일치하는 Pod가 없습니다.',
        nodeMap,
      }));
    });

  return flows;
}

function createFlow(input: {
  id: string;
  title: string;
  description: string;
  entryLabel: string;
  entryDetail: string;
  ingress?: TopologyNode;
  service: TopologyNode;
  pod?: TopologyNode;
  node?: TopologyNode;
  dependencies: TopologyNode[];
  evidenceEdges: TopologyEdge[];
  issue?: string;
  nodeMap: Map<string, TopologyNode>;
}): TrafficFlow {
  const steps: FlowStep[] = [
    { id: `${input.id}-client`, label: input.entryLabel, detail: input.entryDetail },
    ...compactSteps([
      input.ingress ? toStep(input.ingress) : undefined,
      toStep(input.service),
      input.pod ? toStep(input.pod) : undefined,
      input.node ? toStep(input.node) : undefined,
      input.issue ? { id: `${input.id}-missing-backend`, label: '백엔드 Pod 없음', detail: '엔드포인트 없음', tone: 'blocked' } : undefined,
    ]),
  ];
  const evidence = edgeEvidence(input.evidenceEdges, input.nodeMap);

  return {
    id: input.id,
    title: input.title,
    description: input.description,
    status: input.issue ? 'error' : worstStatus([input.ingress, input.service, input.pod, input.node].filter(Boolean) as TopologyNode[]),
    steps,
    dependencies: input.dependencies,
    evidence,
    evidenceSummary: input.issue ? '차단됨' : evidenceSummary(evidence),
    issue: input.issue,
  };
}

function flowMatchesVisibleNodes(flow: TrafficFlow, visibleNodeIds: Set<string>) {
  return flow.steps.some((step) => step.node && visibleNodeIds.has(step.node.id));
}

function toStep(node: TopologyNode): FlowStep {
  return {
    id: node.id,
    label: node.name,
    detail: node.namespace ? `${node.namespace} / ${node.kind}` : node.kind,
    node,
  };
}

function compactSteps(steps: Array<FlowStep | undefined>) {
  return steps.filter(Boolean) as FlowStep[];
}

function targetNode(pod: TopologyNode, edges: TopologyEdge[], nodeMap: Map<string, TopologyNode>) {
  const scheduledEdge = edges.find((edge) => edge.source === pod.id && edge.type === 'scheduled-on');
  return scheduledEdge ? nodeMap.get(scheduledEdge.target) : undefined;
}

function podDependencies(pod: TopologyNode, edges: TopologyEdge[], nodeMap: Map<string, TopologyNode>) {
  const dependencyTypes = new Set(['env-from', 'mounts', 'binds-storage']);
  return edges
    .filter((edge) => edge.source === pod.id && dependencyTypes.has(edge.type))
    .map((edge) => nodeMap.get(edge.target))
    .filter(Boolean) as TopologyNode[];
}

function podEvidenceEdges(pod: TopologyNode, edges: TopologyEdge[]) {
  return edges
    .filter((edge) => edge.source === pod.id && ['scheduled-on', 'env-from', 'mounts'].includes(edge.type))
    .filter(Boolean);
}

function edgeEvidence(edges: TopologyEdge[], nodeMap: Map<string, TopologyNode>) {
  const seen = new Set<string>();
  const evidence: FlowEvidence[] = [];

  edges.forEach((edge) => {
    const key = `${edge.source}->${edge.target}:${edge.type}:${edge.sourceField}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    evidence.push({
      id: key,
      relation: relationLabel(edge.type),
      source: nodeLabel(nodeMap.get(edge.source), edge.source),
      target: nodeLabel(nodeMap.get(edge.target), edge.target),
      sourceField: edge.sourceField,
      confidence: edge.confidence,
    });
  });

  return evidence;
}

function evidenceSummary(evidence: FlowEvidence[]) {
  const confidences = new Set(evidence.map((item) => item.confidence));
  if (confidences.has('observed') && confidences.has('inferred')) {
    return '관측 + 추론';
  }
  if (confidences.has('inferred')) {
    return '추론';
  }
  return '관측';
}

function confidenceLabel(confidence: TopologyEdge['confidence']) {
  return confidence === 'inferred' ? '추론' : '관측';
}

function relationLabel(edgeType: TopologyEdge['type']) {
  if (edgeType === 'routes-to') {
    return 'Ingress 백엔드';
  }
  if (edgeType === 'service-endpoint') {
    return 'Service 엔드포인트';
  }
  if (edgeType === 'scheduled-on') {
    return 'Pod 스케줄링';
  }
  if (edgeType === 'env-from') {
    return 'Pod env 참조';
  }
  if (edgeType === 'mounts') {
    return 'Pod 볼륨 마운트';
  }
  if (edgeType === 'binds-storage') {
    return 'Storage 바인딩';
  }
  if (edgeType === 'uses-service-account') {
    return 'ServiceAccount 바인딩';
  }
  return edgeType;
}

function nodeLabel(node: TopologyNode | undefined, fallback: string) {
  if (!node) {
    return fallback;
  }

  return node.namespace ? `${node.name} (${node.namespace} / ${node.kind})` : `${node.name} (${node.kind})`;
}

function worstStatus(nodes: TopologyNode[]) {
  if (nodes.some((node) => node.status === 'error')) {
    return 'error';
  }
  if (nodes.some((node) => node.status === 'warning')) {
    return 'warning';
  }
  if (nodes.some((node) => node.status === 'unknown')) {
    return 'unknown';
  }
  return 'healthy';
}

function statusClassName(status: TopologyNode['status']) {
  if (status === 'healthy') {
    return 'rounded-full border border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.10)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#248a3d]';
  }
  if (status === 'warning') {
    return 'rounded-full border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#b05f00]';
  }
  if (status === 'error') {
    return 'rounded-full border border-[rgba(255,59,48,0.22)] bg-[rgba(255,59,48,0.10)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#d70015]';
  }
  return 'rounded-full border border-[rgba(142,142,147,0.22)] bg-[rgba(142,142,147,0.12)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#636366]';
}

function flowSummaryClassName(flow: TrafficFlow) {
  if (flow.issue) {
    return 'rounded-full bg-[rgba(255,59,48,0.10)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#d70015] ring-1 ring-[rgba(255,59,48,0.20)]';
  }
  if (flow.evidence.some((item) => item.confidence === 'inferred')) {
    return 'rounded-full bg-[rgba(255,149,0,0.12)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#b05f00] ring-1 ring-[rgba(255,149,0,0.24)]';
  }

  return 'rounded-full bg-white/80 px-2.5 py-1 font-mono text-[11px] font-semibold text-[rgba(60,60,67,0.62)] ring-1 ring-[rgba(60,60,67,0.12)]';
}

function confidenceClassName(confidence: TopologyEdge['confidence']) {
  if (confidence === 'inferred') {
    return 'rounded-full border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#b05f00]';
  }

  return 'rounded-full border border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.10)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#248a3d]';
}

function stepIcon(kind: string) {
  if (kind === '백엔드 Pod 없음') {
    return <AlertTriangle size={17} aria-hidden="true" />;
  }
  if (kind === '외부 클라이언트' || kind === '클러스터 내부 클라이언트') {
    return <Cloud size={17} aria-hidden="true" />;
  }
  if (kind === 'Ingress' || kind === 'Service') {
    return <GitBranch size={17} aria-hidden="true" />;
  }
  if (kind === 'Pod') {
    return <Settings size={17} aria-hidden="true" />;
  }
  if (kind === 'Node') {
    return <Server size={17} aria-hidden="true" />;
  }
  if (kind === 'Secret') {
    return <Shield size={17} aria-hidden="true" />;
  }
  return <Database size={17} aria-hidden="true" />;
}
