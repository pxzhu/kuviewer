import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import { Eye, EyeOff, Focus, Route, RotateCcw } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { ColorMode } from '../features/topology/useTopology';
import { getEdgeColor, getNodeColor } from '../features/topology/useTopology';
import type { EdgeType, ResourceKind, TopologyEdge, TopologyNode } from '../types/topology';

interface TopologyCanvasProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedNodeId: string;
  colorMode: ColorMode;
  sourceKey: string;
  onSelectNode: (nodeId: string) => void;
}

type SavedPositions = Record<string, { x: number; y: number }>;

type ResourceNodeData = Record<string, unknown> & {
  resource: TopologyNode;
  color: string;
  isSelected: boolean;
  related: boolean;
  muted: boolean;
  outgoingEdges: TopologyEdge[];
};

type GroupNodeData = Record<string, unknown> & {
  label: string;
  caption: string;
  color: string;
  tint: string;
};

type FlowNode = Node<ResourceNodeData | GroupNodeData>;
type FlowEdge = Edge<Record<string, unknown>>;

interface PositionedResource {
  node: TopologyNode;
  x: number;
  y: number;
}

interface GroupRegion {
  id: string;
  label: string;
  caption: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  tint: string;
}

interface LayoutResult {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  resourceCount: number;
  edgeCount: number;
}

interface MobilePositionedNode {
  node: TopologyNode;
  x: number;
  y: number;
  color: string;
  isSelected: boolean;
  related: boolean;
}

interface MobilePositionedEdge {
  edge: TopologyEdge;
  source: MobilePositionedNode;
  target: MobilePositionedNode;
  color: string;
  selected: boolean;
  traffic: boolean;
}

interface MobileLane {
  id: LayoutColumn;
  label: string;
  x: number;
  width: number;
  count: number;
}

interface MobileLayoutResult {
  nodes: MobilePositionedNode[];
  edges: MobilePositionedEdge[];
  lanes: MobileLane[];
  width: number;
  height: number;
}

type LayoutColumn = 'scope' | 'ingress' | 'service' | 'workload' | 'pod' | 'policy' | 'config' | 'storage' | 'node';

const flowNodeWidth = 220;
const flowNodeHeight = 106;
const rowStep = 134;
const wrappedColumnGap = 24;
const columnGap = 46;
const groupPadding = 30;
const namespaceGap = 58;
const clusterGap = 96;
const maxRowsPerLane = 4;
const mobileNodeWidth = 106;
const mobileNodeHeight = 42;
const mobileRowStep = 58;
const mobileLaneGap = 26;
const mobileWrappedLaneGap = 14;
const mobileMaxRowsPerLane = 8;
const columnOrder: LayoutColumn[] = ['scope', 'ingress', 'service', 'workload', 'pod', 'policy', 'config', 'storage', 'node'];

const statusLegend = [
  { label: 'healthy', color: '#34c759' },
  { label: 'warning', color: '#ff9500' },
  { label: 'error', color: '#ff3b30' },
  { label: 'unknown', color: '#8e8e93' },
];

const edgeLegend = [
  { label: '트래픽', color: '#007aff' },
  { label: '정책 의도', color: '#00c7be' },
  { label: '소유', color: '#8e8e93' },
  { label: '런타임 참조', color: '#5856d6' },
];

const groupPalette = [
  { color: '#007aff', tint: 'rgba(0, 122, 255, 0.06)' },
  { color: '#5856d6', tint: 'rgba(88, 86, 214, 0.06)' },
  { color: '#34c759', tint: 'rgba(52, 199, 89, 0.055)' },
  { color: '#ff9500', tint: 'rgba(255, 149, 0, 0.055)' },
  { color: '#af52de', tint: 'rgba(175, 82, 222, 0.055)' },
];

const nodeTypes = {
  resource: ResourceNode,
  group: GroupNode,
} as NodeTypes;

export function TopologyCanvas(props: TopologyCanvasProps) {
  const coarsePointer = useCoarsePointer();
  if (coarsePointer) {
    return <MobileTopologyCanvas {...props} />;
  }

  return (
    <ReactFlowProvider>
      <TopologyCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function TopologyCanvasInner({ nodes, edges, selectedNodeId, colorMode, sourceKey, onSelectNode }: TopologyCanvasProps) {
  const [hideSystemNamespaces, setHideSystemNamespaces] = useState(true);
  const [trafficOnly, setTrafficOnly] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const positionStorageKey = useMemo(() => `kuviewer-node-positions:${sourceKey}:${hashString(nodes.map((node) => node.id).sort().join('|'))}`, [nodes, sourceKey]);
  const [savedPositions, setSavedPositions] = useState<SavedPositions>(() => loadSavedPositions(positionStorageKey));
  const reactFlow = useReactFlow<FlowNode, FlowEdge>();

  useEffect(() => {
    setSavedPositions(loadSavedPositions(positionStorageKey));
  }, [layoutVersion, positionStorageKey]);

  const displayGraph = useMemo(() => buildDisplayGraph(nodes, edges, hideSystemNamespaces, trafficOnly), [edges, hideSystemNamespaces, nodes, trafficOnly]);
  const layout = useMemo(
    () => buildFlowLayout(displayGraph.nodes, displayGraph.edges, savedPositions, colorMode, selectedNodeId),
    [colorMode, displayGraph.edges, displayGraph.nodes, savedPositions, selectedNodeId],
  );
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<FlowNode>(layout.flowNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<FlowEdge>(layout.flowEdges);

  useEffect(() => {
    setFlowNodes(layout.flowNodes);
  }, [layout.flowNodes, setFlowNodes]);

  useEffect(() => {
    setFlowEdges(layout.flowEdges);
  }, [layout.flowEdges, setFlowEdges]);

  const saveNodePosition = useCallback(
    (node: FlowNode) => {
      if (node.type !== 'resource') {
        return;
      }

      setSavedPositions((currentPositions) => {
        const nextPositions = {
          ...currentPositions,
          [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
        };
        window.localStorage.setItem(positionStorageKey, JSON.stringify(nextPositions));
        return nextPositions;
      });
    },
    [positionStorageKey],
  );

  const resetLayout = useCallback(() => {
    window.localStorage.removeItem(positionStorageKey);
    setSavedPositions({});
    setLayoutVersion((currentVersion) => currentVersion + 1);
    window.requestAnimationFrame(() => reactFlow.fitView({ padding: 0.18, duration: 260 }));
  }, [positionStorageKey, reactFlow]);

  return (
    <section className="ku-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[rgba(60,60,67,0.12)] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#1d1d1f]">토폴로지 맵</h2>
          <p className="ku-meta mt-1">Kubernetes 런타임 그래프 · 드래그 가능한 노드 · Cluster/Namespace 영역</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[...statusLegend, ...edgeLegend].map((item) => (
            <span key={item.label} className="ku-chip">
              <span className="h-3 w-3 rounded-[4px] border" style={{ backgroundColor: item.color, borderColor: item.color }} />
              {item.label}
            </span>
          ))}
          <span className="ku-chip">
            {layout.resourceCount} 노드 · {layout.edgeCount} 엣지
          </span>
        </div>
      </div>

      <div className="relative h-[68vh] min-h-[560px] max-h-[860px] overflow-hidden bg-[linear-gradient(rgba(60,60,67,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(60,60,67,.055)_1px,transparent_1px)] bg-[size:28px_28px]">
        {layout.resourceCount === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="rounded-[14px] border border-dashed border-[rgba(60,60,67,0.18)] bg-white/80 px-5 py-4 text-center shadow-[0_8px_24px_rgba(0,0,0,0.05)] backdrop-blur-xl">
              <p className="text-sm font-semibold text-[#1d1d1f]">현재 소스 또는 필터에 맞는 토폴로지 노드가 없습니다.</p>
              <p className="mt-1 text-xs font-medium text-[rgba(60,60,67,0.62)]">매니페스트를 업로드하거나 실시간 모드를 연결하고 필터 범위를 넓혀보세요.</p>
            </div>
          </div>
        ) : (
          <ReactFlow
            className="ku-react-flow"
            colorMode="light"
            edges={flowEdges}
            fitView
            fitViewOptions={{ padding: 0.16, minZoom: 0.18, maxZoom: 1.1 }}
            maxZoom={1.7}
            minZoom={0.12}
            nodes={flowNodes}
            nodeTypes={nodeTypes}
            onlyRenderVisibleElements
            panOnScroll
            proOptions={{ hideAttribution: true }}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => {
              if (node.type === 'resource') {
                onSelectNode(node.id);
              }
            }}
            onNodeDragStop={(_, node) => saveNodePosition(node)}
            onNodesChange={onNodesChange}
          >
            <Background color="rgba(60,60,67,0.16)" gap={28} />
            <MiniMap
              pannable
              zoomable
              maskColor="rgba(245,245,247,0.72)"
              nodeBorderRadius={8}
              nodeColor={(node) => (node.type === 'resource' ? String((node.data as ResourceNodeData).color || '#8e8e93') : 'rgba(142,142,147,0.2)')}
            />
            <Controls showInteractive={false} />
            <Panel position="top-left" className="!m-3">
              <div className="flex flex-wrap gap-2 rounded-[14px] border border-[rgba(60,60,67,0.14)] bg-white/85 p-2 shadow-[0_12px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl">
                <button className="ku-flow-button" type="button" onClick={() => reactFlow.fitView({ padding: 0.18, duration: 260 })}>
                  <Focus size={14} aria-hidden="true" />
                  맞춤
                </button>
                <button className="ku-flow-button" data-testid="reset-topology-layout" type="button" onClick={resetLayout}>
                  <RotateCcw size={14} aria-hidden="true" />
                  초기화
                </button>
                <button
                  className={`ku-flow-button ${trafficOnly ? 'ku-flow-button-active' : ''}`}
                  data-testid="toggle-traffic-only"
                  type="button"
                  aria-pressed={trafficOnly}
                  onClick={() => setTrafficOnly((current) => !current)}
                >
                  <Route size={14} aria-hidden="true" />
                  트래픽
                </button>
                <button
                  className={`ku-flow-button ${hideSystemNamespaces ? 'ku-flow-button-active' : ''}`}
                  data-testid="toggle-system-namespaces"
                  type="button"
                  aria-pressed={hideSystemNamespaces}
                  onClick={() => setHideSystemNamespaces((current) => !current)}
                >
                  {hideSystemNamespaces ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                  시스템
                </button>
              </div>
            </Panel>
          </ReactFlow>
        )}
      </div>
    </section>
  );
}

function MobileTopologyCanvas({ nodes, edges, selectedNodeId, colorMode, onSelectNode }: TopologyCanvasProps) {
  const displayGraph = useMemo(() => buildDisplayGraph(nodes, edges, true, false), [edges, nodes]);
  const selectedNode = displayGraph.nodes.find((node) => node.id === selectedNodeId) || displayGraph.nodes[0] || nodes[0];
  const layout = useMemo(
    () => buildMobileTopologyLayout(displayGraph.nodes, displayGraph.edges, colorMode, selectedNode?.id || ''),
    [colorMode, displayGraph.edges, displayGraph.nodes, selectedNode?.id],
  );
  const selectedLayoutNode = selectedNode ? layout.nodes.find((node) => node.node.id === selectedNode.id) : undefined;
  const relatedEdgeCount = selectedNode ? displayGraph.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id).length : 0;

  return (
    <section className="ku-panel overflow-hidden" data-testid="mobile-topology-list">
      <div className="border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#1d1d1f]">토폴로지 맵</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="ku-chip">{layout.nodes.length} 노드 · {layout.edges.length} 엣지</span>
          <span className="ku-chip">모바일 SVG 맵</span>
        </div>
      </div>

      <div className="grid gap-3 p-3">
        {layout.nodes.length > 0 ? (
          <div
            className="max-w-full overflow-x-auto overscroll-contain rounded-[14px] border border-[rgba(60,60,67,0.12)] bg-[linear-gradient(rgba(60,60,67,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(60,60,67,.055)_1px,transparent_1px)] bg-[size:24px_24px]"
            data-testid="mobile-topology-map"
            style={{ touchAction: 'pan-x pan-y' }}
          >
            <svg
              className="block"
              data-testid="mobile-topology-svg"
              role="img"
              aria-label="모바일 토폴로지 맵"
              style={{ width: layout.width, height: layout.height, minWidth: layout.width }}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
            >
              <defs>
                <marker id="mobile-arrow" markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5">
                  <path d="M0,0 L7,3.5 L0,7 Z" fill="#6e6e73" />
                </marker>
              </defs>

              {layout.lanes.map((lane) => (
                <g key={lane.id}>
                  <rect
                    fill="rgba(255,255,255,0.62)"
                    height={layout.height - 24}
                    rx="14"
                    stroke="rgba(60,60,67,0.1)"
                    strokeDasharray="5 5"
                    width={lane.width}
                    x={lane.x - 10}
                    y="12"
                  />
                  <text fill="rgba(60,60,67,0.62)" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="10" fontWeight="800" x={lane.x} y="32">
                    {lane.label} · {lane.count}
                  </text>
                </g>
              ))}

              {layout.edges.map((positionedEdge) => (
                <path
                  key={positionedEdge.edge.id}
                  d={mobileEdgePath(positionedEdge.source, positionedEdge.target)}
                  data-testid={`mobile-topology-edge-${positionedEdge.edge.id}`}
                  fill="none"
                  markerEnd="url(#mobile-arrow)"
                  opacity={positionedEdge.selected ? 0.92 : 0.38}
                  stroke={positionedEdge.color}
                  strokeDasharray={positionedEdge.edge.confidence === 'inferred' ? '5 5' : undefined}
                  strokeLinecap="round"
                  strokeWidth={positionedEdge.selected ? (positionedEdge.traffic ? 2.4 : 1.8) : 1.2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}

              {layout.nodes.map((positionedNode) => (
                <g
                  key={positionedNode.node.id}
                  data-testid={`mobile-topology-node-${positionedNode.node.id}`}
                  role="button"
                  tabIndex={0}
                  transform={`translate(${positionedNode.x}, ${positionedNode.y})`}
                  onClick={() => onSelectNode(positionedNode.node.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectNode(positionedNode.node.id);
                    }
                  }}
                >
                  <rect
                    fill={positionedNode.isSelected ? 'rgba(0,122,255,0.12)' : 'rgba(255,255,255,0.92)'}
                    height={mobileNodeHeight}
                    rx="10"
                    stroke={positionedNode.isSelected ? '#007aff' : `${positionedNode.color}88`}
                    strokeWidth={positionedNode.isSelected ? 2 : positionedNode.related ? 1.6 : 1}
                    width={mobileNodeWidth}
                  />
                  <rect fill={positionedNode.color} height="4" rx="2" width={mobileNodeWidth - 14} x="7" y="6" />
                  <text fill="#1d1d1f" fontFamily="Inter, ui-sans-serif, system-ui, sans-serif" fontSize="10.5" fontWeight="800" x="8" y="23">
                    {truncateMiddle(positionedNode.node.name, 14)}
                  </text>
                  <text fill="rgba(60,60,67,0.62)" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="8.5" fontWeight="800" x="8" y="35">
                    {positionedNode.node.kind}
                  </text>
                </g>
              ))}

              {selectedLayoutNode ? (
                <circle
                  cx={selectedLayoutNode.x + mobileNodeWidth - 9}
                  cy={selectedLayoutNode.y + 14}
                  fill="#007aff"
                  r="4.5"
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              ) : null}
            </svg>
          </div>
        ) : null}

        {selectedNode ? (
          <div className="rounded-[12px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.07)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#1d1d1f]">{selectedNode.name}</p>
                <p className="mt-0.5 truncate font-mono text-[11px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.62)]">
                  {selectedNode.namespace ? `${selectedNode.namespace} / ` : ''}
                  {selectedNode.kind}
                </p>
              </div>
              <span className={statusPillClassName(selectedNode.status)}>{selectedNode.status}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {summaryPreview(selectedNode).map((item) => (
                <span key={item} className="rounded-full border border-[rgba(60,60,67,0.1)] bg-white/75 px-2 py-1 font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.72)]">
                  {item}
                </span>
              ))}
              <span className="rounded-full border border-[rgba(0,122,255,0.16)] bg-white/75 px-2 py-1 font-mono text-[10px] font-semibold text-[#0066cc]">
                관련 {relatedEdgeCount} edges
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-[12px] border border-dashed border-[rgba(60,60,67,0.18)] bg-white/80 p-4 text-center">
            <p className="text-sm font-semibold text-[#1d1d1f]">현재 소스 또는 필터에 맞는 토폴로지 노드가 없습니다.</p>
          </div>
        )}

        <div className="grid gap-2">
          {displayGraph.nodes.slice(0, 120).map((node) => {
            const selected = node.id === selectedNode?.id;
            const color = getNodeColor(node, colorMode);
            const edgeCount = displayGraph.edges.filter((edge) => edge.source === node.id || edge.target === node.id).length;
            return (
              <button
                key={node.id}
                className={`min-w-0 rounded-[12px] border bg-white/86 p-3 text-left shadow-[0_4px_16px_rgba(0,0,0,0.04)] ${selected ? 'ring-[3px] ring-[rgba(0,122,255,0.22)]' : ''}`}
                data-testid={`topology-node-${node.id}`}
                style={{ borderColor: selected ? color : 'rgba(60,60,67,0.13)' }}
                type="button"
                onClick={() => onSelectNode(node.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#1d1d1f]">{node.name}</p>
                    <p className="mt-0.5 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">
                      {node.namespace ? `${node.namespace} / ` : ''}
                      {node.kind}
                    </p>
                  </div>
                  <span className={statusPillClassName(node.status)}>{node.status}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {summaryPreview(node).slice(0, 3).map((item) => (
                    <span key={item} className="rounded-full border border-[rgba(60,60,67,0.1)] bg-[rgba(242,242,247,0.78)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.72)]">
                      {item}
                    </span>
                  ))}
                  <span className="rounded-full bg-[rgba(0,122,255,0.08)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#0066cc]">
                    {edgeCount} edges
                  </span>
                </div>
              </button>
            );
          })}
          {displayGraph.nodes.length > 120 ? (
            <div className="rounded-[12px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-3 text-center text-xs font-semibold text-[rgba(60,60,67,0.62)]">
              +{displayGraph.nodes.length - 120} more
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function useCoarsePointer() {
  const [coarsePointer, setCoarsePointer] = useState(() => isCoarsePointer());

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(pointer: coarse)');
    const handleChange = () => setCoarsePointer(isCoarsePointer());
    handleChange();
    mediaQuery?.addEventListener('change', handleChange);
    return () => mediaQuery?.removeEventListener('change', handleChange);
  }, []);

  return coarsePointer;
}

function isCoarsePointer() {
  return window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

function ResourceNode({ data }: NodeProps<Node<ResourceNodeData>>) {
  const color = data.color;
  const resource = data.resource;
  const outgoingEdges = data.outgoingEdges;
  const selected = data.isSelected;
  const related = data.related;
  const muted = data.muted;

  return (
    <div
      className={`relative h-[106px] w-[220px] rounded-[13px] border bg-white/92 px-3 py-2 text-left shadow-[0_10px_28px_rgba(0,0,0,0.08)] backdrop-blur-xl transition ${
        selected ? 'ring-[3px] ring-[rgba(0,122,255,0.28)]' : related ? 'ring-2 ring-[rgba(60,60,67,0.18)]' : ''
      } ${muted ? 'opacity-35' : 'opacity-100'}`}
      data-testid={`topology-node-${resource.id}`}
      style={{ borderColor: selected ? color : `${color}66`, borderWidth: selected ? 2 : 1 } as CSSProperties}
    >
      <Handle className="!h-2.5 !w-2.5 !border-2 !border-white" position={Position.Left} style={{ backgroundColor: color }} type="target" />
      <Handle className="!h-2.5 !w-2.5 !border-2 !border-white" position={Position.Right} style={{ backgroundColor: color }} type="source" />
      <div className="absolute inset-x-0 top-0 h-1 rounded-t-[13px]" style={{ backgroundColor: color }} />
      <div className="mt-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-5 text-[#1d1d1f]">{resource.name}</div>
          <div className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">
            {resource.namespace ? `${resource.namespace} / ` : ''}
            {resource.kind}
          </div>
        </div>
        <span className={statusPillClassName(resource.status)}>{resource.status}</span>
      </div>
      <div className="mt-2 flex min-h-[22px] flex-wrap gap-1 overflow-hidden">
        {summaryPreview(resource).map((item) => (
          <span key={item} className="rounded-full border border-[rgba(60,60,67,0.1)] bg-[rgba(242,242,247,0.78)] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[rgba(60,60,67,0.72)]">
            {item}
          </span>
        ))}
      </div>
      <div className="mt-1 flex gap-1 overflow-hidden border-t border-dashed border-[rgba(60,60,67,0.12)] pt-1">
        {outgoingEdges.length === 0 ? (
          <span className="font-mono text-[9px] font-semibold text-[rgba(60,60,67,0.42)]">참조 없음</span>
        ) : (
          outgoingEdges.slice(0, 2).map((edge) => (
            <span key={edge.id} className="truncate rounded-full bg-white/75 px-1.5 py-0.5 font-mono text-[9px] font-semibold" style={{ color: getEdgeColor(edge), border: `1px solid ${getEdgeColor(edge)}26` }}>
              {edge.type}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function GroupNode({ data }: NodeProps<Node<GroupNodeData>>) {
  return (
    <div
      className="pointer-events-none h-full w-full rounded-[18px] border border-dashed px-4 py-3"
      style={{ backgroundColor: data.tint, borderColor: `${data.color}80` }}
    >
      <div className="font-mono text-[11px] font-extrabold uppercase tracking-[0.04em]" style={{ color: data.color }}>
        {data.label}
      </div>
      <div className="mt-1 font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.58)]">{data.caption}</div>
    </div>
  );
}

function buildDisplayGraph(nodes: TopologyNode[], edges: TopologyEdge[], hideSystemNamespaces: boolean, trafficOnly: boolean) {
  let visibleNodes = hideSystemNamespaces ? nodes.filter((node) => !isSystemNode(node)) : [...nodes];
  let visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  let visibleEdges = edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));

  if (trafficOnly) {
    const trafficEdges = visibleEdges.filter((edge) => isTrafficEdge(edge.type));
    const trafficNodeIds = new Set(trafficEdges.flatMap((edge) => [edge.source, edge.target]));

    visibleEdges.forEach((edge) => {
      if (trafficNodeIds.has(edge.source) && ['scheduled-on', 'binds-storage', 'env-from', 'uses-service-account'].includes(edge.type)) {
        trafficNodeIds.add(edge.target);
      }
      if (edge.type === 'attaches-to' && trafficNodeIds.has(edge.source)) {
        trafficNodeIds.add(edge.target);
      }
    });

    const trafficNodes = visibleNodes.filter((node) => trafficNodeIds.has(node.id));
    const contextClusters = new Set(trafficNodes.map((node) => node.clusterId));
    const contextNamespaces = new Set(trafficNodes.map((node) => node.namespace).filter(Boolean) as string[]);

    visibleNodes.forEach((node) => {
      if (node.kind === 'Cluster' && contextClusters.has(node.clusterId)) {
        trafficNodeIds.add(node.id);
      }
      if (node.kind === 'Namespace' && contextNamespaces.has(node.name)) {
        trafficNodeIds.add(node.id);
      }
    });

    visibleNodes = visibleNodes.filter((node) => trafficNodeIds.has(node.id));
    visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    visibleEdges = visibleEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target) && (isTrafficEdge(edge.type) || ['owns', 'scheduled-on', 'binds-storage', 'env-from', 'uses-service-account', 'targets-scale', 'applies-to', 'attaches-to'].includes(edge.type)));
  }

  return { nodes: visibleNodes, edges: visibleEdges };
}

function buildFlowLayout(nodes: TopologyNode[], edges: TopologyEdge[], savedPositions: SavedPositions, colorMode: ColorMode, selectedNodeId: string): LayoutResult {
  const positionedResources: PositionedResource[] = [];
  const groups: GroupRegion[] = [];
  const clusterIds = uniqueStrings(nodes.map((node) => node.clusterId));
  const selectedEdges = edges.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId);
  const selectedNeighborIds = new Set(selectedEdges.flatMap((edge) => [edge.source, edge.target]));
  const displayNodeIds = new Set(nodes.map((node) => node.id));

  let cursorY = 56;
  clusterIds.forEach((clusterId, clusterIndex) => {
    const clusterNodes = nodes.filter((node) => node.clusterId === clusterId);
    const clusterResources: PositionedResource[] = [];
    const clusterStartY = cursorY;
    const scopedNodes = sortResources(clusterNodes.filter((node) => !node.namespace));
    const namespaceNames = uniqueStrings(clusterNodes.map((node) => node.namespace).filter(Boolean) as string[]);
    const clusterLabel = clusterNodes.find((node) => node.kind === 'Cluster')?.name || clusterId;
    let clusterCursorY = clusterStartY + 74;

    if (scopedNodes.length > 0) {
      const scopedPlacement = placeColumns(scopedNodes, 64, clusterCursorY, savedPositions);
      positionedResources.push(...scopedPlacement.resources);
      clusterResources.push(...scopedPlacement.resources);
      clusterCursorY += scopedPlacement.height + 42;
    }

    namespaceNames.forEach((namespace, namespaceIndex) => {
      const namespaceNodes = sortResources(clusterNodes.filter((node) => node.namespace === namespace || (node.kind === 'Namespace' && node.name === namespace)));
      if (namespaceNodes.length === 0) {
        return;
      }

      const placement = placeColumns(namespaceNodes, 64, clusterCursorY + 56, savedPositions);
      positionedResources.push(...placement.resources);
      clusterResources.push(...placement.resources);
      const namespaceBounds = boundsForResources(placement.resources, groupPadding);
      const palette = groupPalette[(clusterIndex + namespaceIndex + 1) % groupPalette.length];
      groups.push({
        id: `namespace:${clusterId}:${namespace}`,
        label: `Namespace: ${namespace}`,
        caption: `${placement.resources.length}개 리소스 표시 중`,
        x: namespaceBounds.x,
        y: namespaceBounds.y,
        width: namespaceBounds.width,
        height: namespaceBounds.height,
        color: palette.color,
        tint: palette.tint,
      });
      clusterCursorY = Math.max(clusterCursorY + placement.height + namespaceGap + 56, namespaceBounds.y + namespaceBounds.height + namespaceGap);
    });

    if (clusterResources.length > 0) {
      const palette = groupPalette[clusterIndex % groupPalette.length];
      const clusterBounds = boundsForResources(clusterResources, groupPadding + 28);
      groups.unshift({
        id: `cluster:${clusterId}`,
        label: `Cluster: ${clusterLabel}`,
        caption: `${clusterResources.length}개 리소스 표시 중`,
        x: Math.min(24, clusterBounds.x),
        y: clusterStartY,
        width: Math.max(clusterBounds.width + Math.max(0, clusterBounds.x - 24), 1180),
        height: Math.max(clusterBounds.y + clusterBounds.height - clusterStartY + 30, 260),
        color: palette.color,
        tint: 'rgba(255,255,255,0.38)',
      });
      cursorY = Math.max(clusterCursorY + clusterGap, clusterBounds.y + clusterBounds.height + clusterGap);
    }
  });

  const resourceNodes: FlowNode[] = positionedResources.map((positionedResource) => {
    const color = getNodeColor(positionedResource.node, colorMode);
    const isSelected = positionedResource.node.id === selectedNodeId;
    const related = selectedNeighborIds.has(positionedResource.node.id);
    const muted = Boolean(selectedNodeId) && !isSelected && !related;
    const outgoingEdges = edges.filter((edge) => edge.source === positionedResource.node.id && displayNodeIds.has(edge.target));

    return {
      id: positionedResource.node.id,
      type: 'resource',
      position: { x: positionedResource.x, y: positionedResource.y },
      data: { resource: positionedResource.node, color, isSelected, related, muted, outgoingEdges },
      style: { width: flowNodeWidth, height: flowNodeHeight },
      zIndex: 10,
    };
  });

  const groupNodes: FlowNode[] = groups.map((group, index) => ({
    id: `group:${group.id}`,
    type: 'group',
    position: { x: group.x, y: group.y },
    data: { label: group.label, caption: group.caption, color: group.color, tint: group.tint },
    draggable: false,
    selectable: false,
    connectable: false,
    style: { width: group.width, height: group.height },
    zIndex: index,
  }));

  const resourceIds = new Set(resourceNodes.map((node) => node.id));
  const flowEdges = edges
    .filter((edge) => resourceIds.has(edge.source) && resourceIds.has(edge.target))
    .map((edge) => toFlowEdge(edge, selectedNodeId));

  return {
    flowNodes: [...groupNodes, ...resourceNodes],
    flowEdges,
    resourceCount: resourceNodes.length,
    edgeCount: flowEdges.length,
  };
}

function placeColumns(nodes: TopologyNode[], startX: number, startY: number, savedPositions: SavedPositions) {
  const resources: PositionedResource[] = [];
  const byColumn = new Map<LayoutColumn, TopologyNode[]>();
  nodes.forEach((node) => {
    const column = columnForKind(node.kind);
    byColumn.set(column, [...(byColumn.get(column) || []), node]);
  });

  let cursorX = startX;
  let maxHeight = flowNodeHeight;
  columnOrder.forEach((column) => {
    const columnNodes = sortResources(byColumn.get(column) || []);
    const wraps = Math.max(1, Math.ceil(columnNodes.length / maxRowsPerLane));
    const laneWidth = wraps * flowNodeWidth + (wraps - 1) * wrappedColumnGap;
    const visibleRows = Math.min(maxRowsPerLane, Math.max(1, columnNodes.length));
    maxHeight = Math.max(maxHeight, flowNodeHeight + (visibleRows - 1) * rowStep);

    columnNodes.forEach((node, index) => {
      const wrapIndex = Math.floor(index / maxRowsPerLane);
      const rowIndex = index % maxRowsPerLane;
      const savedPosition = savedPositions[node.id];
      resources.push({
        node,
        x: savedPosition?.x ?? cursorX + wrapIndex * (flowNodeWidth + wrappedColumnGap),
        y: savedPosition?.y ?? startY + rowIndex * rowStep,
      });
    });

    cursorX += laneWidth + columnGap;
  });

  return {
    resources,
    width: Math.max(flowNodeWidth, cursorX - startX - columnGap),
    height: maxHeight,
  };
}

function toFlowEdge(edge: TopologyEdge, selectedNodeId: string): FlowEdge {
  const traffic = isTrafficEdge(edge.type);
  const selected = !selectedNodeId || edge.source === selectedNodeId || edge.target === selectedNodeId;
  const color = selected ? (traffic ? '#007aff' : getEdgeColor(edge)) : 'rgba(142,142,147,0.34)';
  const label = selected && (selectedNodeId || traffic) ? edge.type : undefined;

  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    animated: traffic && selected,
    label,
    markerEnd: { type: MarkerType.ArrowClosed, color },
    style: {
      stroke: color,
      strokeWidth: selected ? (traffic ? 2.5 : 1.9) : 1.3,
      strokeDasharray: edge.confidence === 'inferred' || edge.type === 'env-from' || edge.type === 'binds-storage' ? '6 5' : undefined,
    },
    labelBgBorderRadius: 8,
    labelBgPadding: [6, 3],
    labelStyle: { fill: color, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, fontWeight: 800 },
    interactionWidth: 18,
    zIndex: traffic ? 20 : 5,
  };
}

function buildMobileTopologyLayout(nodes: TopologyNode[], edges: TopologyEdge[], colorMode: ColorMode, selectedNodeId: string): MobileLayoutResult {
  const selectedEdges = edges.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId);
  const selectedNeighborIds = new Set(selectedEdges.flatMap((edge) => [edge.source, edge.target]));
  const positionedNodes: MobilePositionedNode[] = [];
  const lanes: MobileLane[] = [];

  let cursorX = 22;
  let maxRows = 1;
  columnOrder.forEach((column) => {
    const columnNodes = sortResources(nodes.filter((node) => columnForKind(node.kind) === column));
    if (columnNodes.length === 0) {
      return;
    }

    const wraps = Math.max(1, Math.ceil(columnNodes.length / mobileMaxRowsPerLane));
    const laneWidth = wraps * mobileNodeWidth + (wraps - 1) * mobileWrappedLaneGap;
    lanes.push({
      id: column,
      label: mobileColumnLabel(column),
      x: cursorX,
      width: laneWidth + 20,
      count: columnNodes.length,
    });

    columnNodes.forEach((node, index) => {
      const wrapIndex = Math.floor(index / mobileMaxRowsPerLane);
      const rowIndex = index % mobileMaxRowsPerLane;
      maxRows = Math.max(maxRows, rowIndex + 1);
      positionedNodes.push({
        node,
        x: cursorX + wrapIndex * (mobileNodeWidth + mobileWrappedLaneGap),
        y: 52 + rowIndex * mobileRowStep,
        color: getNodeColor(node, colorMode),
        isSelected: node.id === selectedNodeId,
        related: selectedNeighborIds.has(node.id),
      });
    });

    cursorX += laneWidth + mobileLaneGap;
  });

  const nodeById = new Map(positionedNodes.map((positionedNode) => [positionedNode.node.id, positionedNode]));
  const positionedEdges = edges.flatMap((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      return [];
    }

    const traffic = isTrafficEdge(edge.type);
    const selected = !selectedNodeId || edge.source === selectedNodeId || edge.target === selectedNodeId;
    return [
      {
        edge,
        source,
        target,
        color: selected ? (traffic ? '#007aff' : getEdgeColor(edge)) : 'rgba(142,142,147,0.58)',
        selected,
        traffic,
      },
    ];
  });

  return {
    nodes: positionedNodes,
    edges: positionedEdges,
    lanes,
    width: Math.max(360, cursorX + 14),
    height: Math.max(240, 52 + maxRows * mobileRowStep + 26),
  };
}

function mobileEdgePath(source: MobilePositionedNode, target: MobilePositionedNode) {
  const sourceX = source.x + mobileNodeWidth;
  const sourceY = source.y + mobileNodeHeight / 2;
  const targetX = target.x;
  const targetY = target.y + mobileNodeHeight / 2;
  const controlOffset = Math.max(28, Math.abs(targetX - sourceX) * 0.46);
  return `M ${sourceX} ${sourceY} C ${sourceX + controlOffset} ${sourceY}, ${targetX - controlOffset} ${targetY}, ${targetX} ${targetY}`;
}

function mobileColumnLabel(column: LayoutColumn) {
  const labels: Record<LayoutColumn, string> = {
    scope: 'Scope',
    ingress: 'Ingress',
    service: 'Service',
    workload: 'Workload',
    pod: 'Pod',
    policy: 'Policy',
    config: 'Config',
    storage: 'Storage',
    node: 'Node',
  };
  return labels[column];
}

function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  const headLength = Math.max(3, Math.floor((maxLength - 1) * 0.58));
  const tailLength = Math.max(2, maxLength - headLength - 1);
  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`;
}

function boundsForResources(resources: PositionedResource[], padding: number) {
  const left = Math.min(...resources.map((resource) => resource.x));
  const top = Math.min(...resources.map((resource) => resource.y));
  const right = Math.max(...resources.map((resource) => resource.x + flowNodeWidth));
  const bottom = Math.max(...resources.map((resource) => resource.y + flowNodeHeight));
  return {
    x: Math.max(24, left - padding),
    y: Math.max(18, top - padding - 30),
    width: Math.max(320, right - left + padding * 2),
    height: Math.max(180, bottom - top + padding * 2 + 34),
  };
}

function columnForKind(kind: ResourceKind): LayoutColumn {
  if (kind === 'Cluster' || kind === 'Namespace') {
    return 'scope';
  }
  if (kind === 'Ingress' || kind === 'Gateway' || kind === 'HTTPRoute' || kind === 'GRPCRoute' || kind === 'TLSRoute' || kind === 'TCPRoute') {
    return 'ingress';
  }
  if (kind === 'Service' || kind === 'EndpointSlice') {
    return 'service';
  }
  if (kind === 'Deployment' || kind === 'ReplicaSet' || kind === 'StatefulSet' || kind === 'DaemonSet' || kind === 'Job' || kind === 'CronJob' || kind === 'HorizontalPodAutoscaler') {
    return 'workload';
  }
  if (kind === 'Pod') {
    return 'pod';
  }
  if (kind === 'NetworkPolicy') {
    return 'policy';
  }
  if (kind === 'ConfigMap' || kind === 'Secret' || kind === 'ServiceAccount') {
    return 'config';
  }
  if (kind === 'PersistentVolume' || kind === 'PersistentVolumeClaim' || kind === 'StorageClass') {
    return 'storage';
  }
  return 'node';
}

function isSystemNode(node: TopologyNode) {
  if (node.kind === 'Cluster' || node.kind === 'Node' || node.kind === 'PersistentVolume' || node.kind === 'StorageClass') {
    return false;
  }

  const namespace = node.kind === 'Namespace' ? node.name : node.namespace;
  return Boolean(namespace && isSystemNamespace(namespace));
}

function isSystemNamespace(namespace: string) {
  return (
    namespace === 'default' ||
    namespace === 'local-path-storage' ||
    namespace === 'kube-system' ||
    namespace === 'kube-public' ||
    namespace === 'kube-node-lease' ||
    namespace.startsWith('kuviewer-smoke-')
  );
}

function isTrafficEdge(edgeType: EdgeType) {
  return edgeType === 'routes-to' || edgeType === 'service-endpoint' || edgeType === 'attaches-to' || edgeType === 'allows-ingress' || edgeType === 'allows-egress';
}

function sortResources<T extends TopologyNode>(resources: T[]) {
  return [...resources].sort((left, right) => `${left.kind}:${left.namespace || ''}:${left.name}`.localeCompare(`${right.kind}:${right.namespace || ''}:${right.name}`));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function summaryPreview(node: TopologyNode) {
  return Object.entries(node.summary)
    .slice(0, 2)
    .map(([key, value]) => `${key}:${String(value)}`);
}

function statusPillClassName(status: TopologyNode['status']) {
  if (status === 'healthy') {
    return 'shrink-0 rounded-full border border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#248a3d]';
  }
  if (status === 'warning') {
    return 'shrink-0 rounded-full border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#a05a00]';
  }
  if (status === 'error') {
    return 'shrink-0 rounded-full border border-[rgba(255,59,48,0.24)] bg-[rgba(255,59,48,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#c01f17]';
  }
  return 'shrink-0 rounded-full border border-[rgba(142,142,147,0.22)] bg-[rgba(142,142,147,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#636366]';
}

function loadSavedPositions(key: string): SavedPositions {
  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) {
      return {};
    }

    const parsedValue = JSON.parse(rawValue) as SavedPositions;
    return Object.fromEntries(
      Object.entries(parsedValue).filter(([, position]) => Number.isFinite(position.x) && Number.isFinite(position.y)),
    );
  } catch {
    return {};
  }
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
