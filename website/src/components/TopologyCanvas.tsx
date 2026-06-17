import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TouchEvent, WheelEvent } from 'react';
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
import { Eye, EyeOff, Focus, Minus, Plus, Route, RotateCcw } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { ColorMode } from '../features/topology/useTopology';
import { getEdgeColor, getNodeColor } from '../features/topology/useTopology';
import type { EdgeType, ResourceKind, TopologyEdge, TopologyNode } from '../types/topology';

interface TopologyCanvasProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedNodeId: string;
  colorMode: ColorMode;
  brandTheme: 'yaml-flow' | 'radar';
  sourceKey: string;
  onSelectNode: (nodeId: string) => void;
}

type SavedPositions = Record<string, { x: number; y: number }>;

type ResourceNodeData = Record<string, unknown> & {
  resource: TopologyNode;
  color: string;
  brandTheme: 'yaml-flow' | 'radar';
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
const minMobileZoom = 0.25;
const maxMobileZoom = 2.5;
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
  { color: '#2f8cff', tint: 'rgba(47, 140, 255, 0.11)' },
  { color: '#16d9d2', tint: 'rgba(22, 217, 210, 0.1)' },
  { color: '#4bea66', tint: 'rgba(75, 234, 102, 0.09)' },
  { color: '#ffad1f', tint: 'rgba(255, 173, 31, 0.09)' },
  { color: '#8f8cff', tint: 'rgba(143, 140, 255, 0.1)' },
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

function TopologyCanvasInner({ nodes, edges, selectedNodeId, colorMode, brandTheme, sourceKey, onSelectNode }: TopologyCanvasProps) {
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
    () => buildFlowLayout(displayGraph.nodes, displayGraph.edges, savedPositions, colorMode, brandTheme, selectedNodeId),
    [brandTheme, colorMode, displayGraph.edges, displayGraph.nodes, savedPositions, selectedNodeId],
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

      <div className="ku-radar-canvas relative h-[68vh] min-h-[560px] max-h-[860px] overflow-hidden">
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
            colorMode={brandTheme === 'radar' ? 'dark' : 'light'}
            edges={flowEdges}
            fitView
            fitViewOptions={{ padding: 0.16, minZoom: 0.18, maxZoom: 1.1 }}
            maxZoom={1.7}
            minZoom={0.12}
            nodes={flowNodes}
            nodeTypes={nodeTypes}
            onlyRenderVisibleElements
            panOnScroll={false}
            proOptions={{ hideAttribution: true }}
            zoomOnDoubleClick
            zoomOnPinch
            zoomOnScroll
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => {
              if (node.type === 'resource') {
                onSelectNode(node.id);
              }
            }}
            onNodeDragStop={(_, node) => saveNodePosition(node)}
            onNodesChange={onNodesChange}
          >
            <Background color={brandTheme === 'radar' ? 'rgba(102,154,206,0.18)' : 'rgba(137,158,186,0.18)'} gap={28} />
            <MiniMap
              pannable
              zoomable
              maskColor={brandTheme === 'radar' ? 'rgba(3,7,13,0.72)' : 'rgba(248,251,255,0.74)'}
              nodeBorderRadius={8}
              nodeColor={(node) => (node.type === 'resource' ? String((node.data as ResourceNodeData).color || '#8e8e93') : brandTheme === 'radar' ? 'rgba(125,173,220,0.16)' : 'rgba(137,158,186,0.2)')}
            />
            <Controls showInteractive={false} />
            <Panel position="top-left" className="!m-3">
              <div className="flex flex-wrap gap-2 rounded-[14px] border border-[rgba(60,60,67,0.14)] bg-white/85 p-2 shadow-[0_12px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl">
                <button className="ku-flow-button" type="button" onClick={() => reactFlow.fitView({ padding: 0.18, duration: 260 })}>
                  <Focus size={14} aria-hidden="true" />
                  맞춤
                </button>
                <button className="ku-flow-button" data-testid="zoom-in-topology" type="button" onClick={() => reactFlow.zoomIn({ duration: 180 })}>
                  <Plus size={14} aria-hidden="true" />
                </button>
                <button className="ku-flow-button" data-testid="zoom-out-topology" type="button" onClick={() => reactFlow.zoomOut({ duration: 180 })}>
                  <Minus size={14} aria-hidden="true" />
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

function MobileTopologyCanvas({ nodes, edges, selectedNodeId, colorMode, brandTheme, onSelectNode }: TopologyCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<{ mode: 'pan' | 'pinch'; x: number; y: number; distance: number; scale: number } | null>(null);
  const displayGraph = useMemo(() => buildDisplayGraph(nodes, edges, true, false), [edges, nodes]);
  const selectedNode = displayGraph.nodes.find((node) => node.id === selectedNodeId) || displayGraph.nodes[0] || nodes[0];
  const layout = useMemo(
    () => buildFlowLayout(displayGraph.nodes, displayGraph.edges, {}, colorMode, brandTheme, selectedNode?.id || ''),
    [brandTheme, colorMode, displayGraph.edges, displayGraph.nodes, selectedNode?.id],
  );
  const svgBounds = useMemo(() => boundsForFlowNodes(layout.flowNodes), [layout.flowNodes]);
  const [viewport, setViewport] = useState({ width: 390, height: 420 });
  const [camera, setCamera] = useState({ scale: 1, x: 0, y: 0 });
  const resourceFlowNodes = useMemo(() => layout.flowNodes.filter((node) => node.type === 'resource') as Array<Node<ResourceNodeData>>, [layout.flowNodes]);
  const groupFlowNodes = useMemo(() => layout.flowNodes.filter((node) => node.type === 'group') as Array<Node<GroupNodeData>>, [layout.flowNodes]);
  const resourceNodeById = useMemo(() => new Map(resourceFlowNodes.map((node) => [node.id, node])), [resourceFlowNodes]);
  const relatedEdgeCount = selectedNode ? displayGraph.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id).length : 0;
  const fitCamera = useCallback(() => setCamera(fitMobileCamera(svgBounds, viewport)), [svgBounds, viewport]);
  const resetCamera = useCallback(() => setCamera({ scale: 1, x: 0, y: 0 }), []);
  const zoomAt = useCallback(
    (nextScale: number, centerX = viewport.width / 2, centerY = viewport.height / 2) => {
      setCamera((currentCamera) => {
        const scale = clamp(nextScale, minMobileZoom, maxMobileZoom);
        const graphX = (centerX - currentCamera.x) / currentCamera.scale;
        const graphY = (centerY - currentCamera.y) / currentCamera.scale;
        return { scale, x: centerX - graphX * scale, y: centerY - graphY * scale };
      });
    },
    [viewport.height, viewport.width],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const updateViewport = () => {
      const rect = element.getBoundingClientRect();
      setViewport({ width: Math.max(320, rect.width), height: Math.max(320, rect.height) });
    };
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fitCamera();
  }, [fitCamera]);

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      zoomAt(camera.scale * (event.deltaY < 0 ? 1.12 : 0.88), event.clientX - rect.left, event.clientY - rect.top);
    },
    [camera.scale, zoomAt],
  );

  const handleTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (event.touches.length === 1) {
        gestureRef.current = { mode: 'pan', x: event.touches[0].clientX, y: event.touches[0].clientY, distance: 0, scale: camera.scale };
        return;
      }
      if (event.touches.length === 2) {
        gestureRef.current = {
          mode: 'pinch',
          x: touchMidpointX(event.touches[0], event.touches[1]),
          y: touchMidpointY(event.touches[0], event.touches[1]),
          distance: touchDistance(event.touches[0], event.touches[1]),
          scale: camera.scale,
        };
      }
    },
    [camera.scale],
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (!gesture) {
        return;
      }

      event.preventDefault();
      if (gesture.mode === 'pan' && event.touches.length === 1) {
        const touch = event.touches[0];
        const deltaX = touch.clientX - gesture.x;
        const deltaY = touch.clientY - gesture.y;
        gestureRef.current = { ...gesture, x: touch.clientX, y: touch.clientY };
        setCamera((currentCamera) => ({ ...currentCamera, x: currentCamera.x + deltaX, y: currentCamera.y + deltaY }));
        return;
      }

      if (gesture.mode === 'pinch' && event.touches.length === 2) {
        const rect = event.currentTarget.getBoundingClientRect();
        const distance = touchDistance(event.touches[0], event.touches[1]);
        zoomAt(gesture.scale * (distance / Math.max(1, gesture.distance)), gesture.x - rect.left, gesture.y - rect.top);
      }
    },
    [zoomAt],
  );

  const handleTouchEnd = useCallback(() => {
    gestureRef.current = null;
  }, []);

  return (
    <section className="ku-panel overflow-hidden" data-testid="mobile-topology-list">
      <div className="border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#1d1d1f]">토폴로지 맵</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="ku-chip">{layout.resourceCount} 노드 · {layout.edgeCount} 엣지</span>
          <span className="ku-chip">SVG 토폴로지</span>
          <span className="ku-chip">{Math.round(camera.scale * 100)}%</span>
        </div>
      </div>

      <div className="grid gap-3 p-3">
        {layout.resourceCount > 0 ? (
          <div
            ref={containerRef}
            className="ku-radar-canvas relative h-[64vh] min-h-[360px] max-w-full overflow-hidden overscroll-contain rounded-[14px] border border-[rgba(60,60,67,0.12)]"
            data-testid="mobile-topology-map"
            style={{ touchAction: 'none' }}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
            onTouchStart={handleTouchStart}
            onWheel={handleWheel}
          >
            <div className="absolute left-2 top-2 z-10 flex flex-wrap gap-1.5 rounded-[12px] border border-[rgba(60,60,67,0.14)] bg-white/85 p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.08)] backdrop-blur-xl">
              <button className="ku-flow-button" data-testid="mobile-zoom-in" type="button" onClick={() => zoomAt(camera.scale * 1.18)}>
                <Plus size={14} aria-hidden="true" />
              </button>
              <button className="ku-flow-button" data-testid="mobile-zoom-out" type="button" onClick={() => zoomAt(camera.scale / 1.18)}>
                <Minus size={14} aria-hidden="true" />
              </button>
              <button className="ku-flow-button" data-testid="mobile-zoom-fit" type="button" onClick={fitCamera}>
                <Focus size={14} aria-hidden="true" />
                맞춤
              </button>
              <button className="ku-flow-button" data-testid="mobile-zoom-reset" type="button" onClick={resetCamera}>
                <RotateCcw size={14} aria-hidden="true" />
              </button>
            </div>
            <svg
              className="block h-full w-full"
              data-testid="mobile-topology-svg"
              role="img"
              aria-label="SVG 토폴로지 맵"
              viewBox={`0 0 ${viewport.width} ${viewport.height}`}
            >
              <defs>
                <marker id="mobile-arrow" markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5">
                  <path d="M0,0 L7,3.5 L0,7 Z" fill="#6e6e73" />
                </marker>
              </defs>

              <g data-testid="mobile-topology-viewport" transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
              {groupFlowNodes.map((groupNode) => {
                const data = groupNode.data;
                const width = numericStyleValue(groupNode.style?.width, 320);
                const height = numericStyleValue(groupNode.style?.height, 180);
                return (
                  <g key={groupNode.id} transform={`translate(${groupNode.position.x}, ${groupNode.position.y})`}>
                    <rect
                      fill={String(data.tint)}
                      height={height}
                      rx="18"
                      stroke={`${String(data.color)}80`}
                      strokeDasharray="7 6"
                      width={width}
                    />
                    <text fill={String(data.color)} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="800" x="16" y="28">
                      {data.label}
                    </text>
                    <text fill={themeValue(brandTheme, 'rgba(94,116,143,0.66)', 'rgba(196,218,240,0.72)')} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="10" fontWeight="700" x="16" y="47">
                      {data.caption}
                    </text>
                  </g>
                );
              })}

              {layout.flowEdges.map((flowEdge) => {
                const source = resourceNodeById.get(flowEdge.source);
                const target = resourceNodeById.get(flowEdge.target);
                if (!source || !target) {
                  return null;
                }
                const stroke = String(flowEdge.style?.stroke || '#8e8e93');
                const strokeWidth = numericStyleValue(flowEdge.style?.strokeWidth, 1.3);
                const labelPoint = mobileFlowEdgeLabelPoint(source, target);
                return (
                  <g key={flowEdge.id} data-testid={`mobile-topology-edge-${flowEdge.id}`}>
                    <path
                      d={mobileFlowEdgePath(source, target)}
                      fill="none"
                      markerEnd="url(#mobile-arrow)"
                      opacity={flowEdge.zIndex === 20 ? 0.92 : 0.62}
                      stroke={stroke}
                      strokeDasharray={String(flowEdge.style?.strokeDasharray || '') || undefined}
                      strokeLinecap="round"
                      strokeWidth={strokeWidth}
                      vectorEffect="non-scaling-stroke"
                    />
                    {flowEdge.label ? (
                      <text
                        fill={stroke}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        fontSize="10"
                        fontWeight="800"
                        paintOrder="stroke"
                        stroke={themeValue(brandTheme, 'rgba(255,255,255,0.9)', 'rgba(3,7,13,0.86)')}
                        strokeWidth="5"
                        x={labelPoint.x}
                        y={labelPoint.y}
                      >
                        {String(flowEdge.label)}
                      </text>
                    ) : null}
                  </g>
                );
              })}

              {resourceFlowNodes.map((flowNode) => {
                const data = flowNode.data;
                const resource = data.resource;
                const selected = data.isSelected;
                return (
                  <g
                    key={flowNode.id}
                    data-testid={`mobile-topology-node-${resource.id}`}
                    role="button"
                    tabIndex={0}
                    transform={`translate(${flowNode.position.x}, ${flowNode.position.y})`}
                    onClick={() => onSelectNode(resource.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectNode(resource.id);
                      }
                    }}
                  >
                    <rect
                      fill={themeValue(brandTheme, 'rgba(255,255,255,0.94)', 'rgba(9,20,34,0.94)')}
                      height={flowNodeHeight}
                      rx="13"
                      stroke={selected ? String(data.color) : `${String(data.color)}66`}
                      strokeWidth={selected ? 2 : 1}
                      width={flowNodeWidth}
                    />
                    {selected || data.related ? (
                      <rect
                        fill="none"
                        height={flowNodeHeight + (selected ? 8 : 4)}
                        rx="16"
                        stroke={selected ? themeValue(brandTheme, 'rgba(38,122,255,0.28)', 'rgba(47,140,255,0.42)') : themeValue(brandTheme, 'rgba(137,158,186,0.2)', 'rgba(125,173,220,0.22)')}
                        strokeWidth={selected ? 5 : 3}
                        width={flowNodeWidth + (selected ? 8 : 4)}
                        x={selected ? -4 : -2}
                        y={selected ? -4 : -2}
                      />
                    ) : null}
                    <rect fill={String(data.color)} height="4" rx="2" width={flowNodeWidth} />
                    <circle cx="0" cy={flowNodeHeight / 2} fill={String(data.color)} r="5" stroke={themeValue(brandTheme, '#ffffff', '#07111d')} strokeWidth="2" />
                    <circle cx={flowNodeWidth} cy={flowNodeHeight / 2} fill={String(data.color)} r="5" stroke={themeValue(brandTheme, '#ffffff', '#07111d')} strokeWidth="2" />
                    <text fill={themeValue(brandTheme, '#1e2b3c', '#eef7ff')} fontFamily="Inter, ui-sans-serif, system-ui, sans-serif" fontSize="13" fontWeight="800" x="12" y="28">
                      {truncateMiddle(resource.name, 25)}
                    </text>
                    <text fill={themeValue(brandTheme, 'rgba(94,116,143,0.66)', 'rgba(196,218,240,0.72)')} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="10" fontWeight="800" x="12" y="46">
                      {truncateMiddle(`${resource.namespace ? `${resource.namespace} / ` : ''}${resource.kind}`, 30)}
                    </text>
                    <rect fill={statusFill(resource.status, brandTheme)} height="18" rx="9" width="66" x={flowNodeWidth - 76} y="18" />
                    <text fill={statusTextColor(resource.status, brandTheme)} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="9" fontWeight="800" textAnchor="middle" x={flowNodeWidth - 43} y="30">
                      {resource.status}
                    </text>
                    {summaryPreview(resource).map((item, index) => (
                      <g key={item} transform={`translate(${12 + index * 94}, 64)`}>
                        <rect fill={themeValue(brandTheme, 'rgba(241,247,255,0.86)', 'rgba(15,29,46,0.86)')} height="20" rx="10" stroke={themeValue(brandTheme, 'rgba(137,158,186,0.16)', 'rgba(125,173,220,0.16)')} width="86" />
                        <text fill={themeValue(brandTheme, 'rgba(47,65,89,0.74)', 'rgba(196,218,240,0.78)')} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="9" fontWeight="700" x="7" y="13">
                          {truncateMiddle(item, 13)}
                        </text>
                      </g>
                    ))}
                  </g>
                );
              })}
              </g>
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
  const isRadar = data.brandTheme === 'radar';

  return (
    <div
      className={`relative h-[106px] w-[220px] rounded-[13px] border bg-white/92 px-3 py-2 text-left backdrop-blur-xl transition ${
        isRadar ? 'shadow-[0_16px_34px_rgba(0,0,0,0.32)]' : 'shadow-[0_16px_34px_rgba(73,104,143,0.14)]'
      } ${selected ? (isRadar ? 'ring-[3px] ring-[rgba(47,140,255,0.42)]' : 'ring-[3px] ring-[rgba(38,122,255,0.24)]') : related ? (isRadar ? 'ring-2 ring-[rgba(125,173,220,0.2)]' : 'ring-2 ring-[rgba(137,158,186,0.2)]') : ''
      } ${muted ? 'opacity-35' : 'opacity-100'}`}
      data-testid={`topology-node-${resource.id}`}
      style={{ borderColor: selected ? color : `${color}66`, borderWidth: selected ? 2 : 1 } as CSSProperties}
    >
      <Handle className={`!h-2.5 !w-2.5 !border-2 ${isRadar ? '!border-[#07111d]' : '!border-white'}`} position={Position.Left} style={{ backgroundColor: color }} type="target" />
      <Handle className={`!h-2.5 !w-2.5 !border-2 ${isRadar ? '!border-[#07111d]' : '!border-white'}`} position={Position.Right} style={{ backgroundColor: color }} type="source" />
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
    visibleEdges = visibleEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target) && (isTrafficEdge(edge.type) || ['owns', 'scheduled-on', 'binds-storage', 'env-from', 'uses-service-account', 'targets-scale', 'applies-to', 'attaches-to', 'references'].includes(edge.type)));
  }

  return { nodes: visibleNodes, edges: visibleEdges };
}

function buildFlowLayout(nodes: TopologyNode[], edges: TopologyEdge[], savedPositions: SavedPositions, colorMode: ColorMode, brandTheme: 'yaml-flow' | 'radar', selectedNodeId: string): LayoutResult {
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
        tint: 'rgba(9,21,35,0.36)',
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
      data: { resource: positionedResource.node, color, brandTheme, isSelected, related, muted, outgoingEdges },
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
    .map((edge) => toFlowEdge(edge, selectedNodeId, brandTheme));

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

function toFlowEdge(edge: TopologyEdge, selectedNodeId: string, brandTheme: 'yaml-flow' | 'radar'): FlowEdge {
  const traffic = isTrafficEdge(edge.type);
  const selected = !selectedNodeId || edge.source === selectedNodeId || edge.target === selectedNodeId;
  const color = selected ? (traffic ? themeValue(brandTheme, '#267aff', '#2f8cff') : getEdgeColor(edge)) : themeValue(brandTheme, 'rgba(137,158,186,0.32)', 'rgba(125,173,220,0.28)');
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

function boundsForFlowNodes(nodes: FlowNode[]) {
  if (nodes.length === 0) {
    return { width: 360, height: 240 };
  }

  const right = Math.max(...nodes.map((node) => node.position.x + numericStyleValue(node.style?.width, node.type === 'resource' ? flowNodeWidth : 320)));
  const bottom = Math.max(...nodes.map((node) => node.position.y + numericStyleValue(node.style?.height, node.type === 'resource' ? flowNodeHeight : 180)));
  return {
    width: Math.max(720, Math.ceil(right + 48)),
    height: Math.max(360, Math.ceil(bottom + 48)),
  };
}

function fitMobileCamera(bounds: { width: number; height: number }, viewport: { width: number; height: number }) {
  const scale = clamp(Math.min((viewport.width - 32) / bounds.width, (viewport.height - 32) / bounds.height), minMobileZoom, maxMobileZoom);
  return {
    scale,
    x: Math.round((viewport.width - bounds.width * scale) / 2),
    y: Math.round((viewport.height - bounds.height * scale) / 2),
  };
}

function mobileFlowEdgePath(source: FlowNode, target: FlowNode) {
  const sourceX = source.position.x + flowNodeWidth;
  const sourceY = source.position.y + flowNodeHeight / 2;
  const targetX = target.position.x;
  const targetY = target.position.y + flowNodeHeight / 2;
  const controlOffset = Math.max(28, Math.abs(targetX - sourceX) * 0.46);
  return `M ${sourceX} ${sourceY} C ${sourceX + controlOffset} ${sourceY}, ${targetX - controlOffset} ${targetY}, ${targetX} ${targetY}`;
}

function mobileFlowEdgeLabelPoint(source: FlowNode, target: FlowNode) {
  return {
    x: (source.position.x + flowNodeWidth + target.position.x) / 2,
    y: (source.position.y + target.position.y) / 2 + flowNodeHeight / 2 - 8,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function touchDistance(firstTouch: { clientX: number; clientY: number }, secondTouch: { clientX: number; clientY: number }) {
  return Math.hypot(firstTouch.clientX - secondTouch.clientX, firstTouch.clientY - secondTouch.clientY);
}

function touchMidpointX(firstTouch: { clientX: number }, secondTouch: { clientX: number }) {
  return (firstTouch.clientX + secondTouch.clientX) / 2;
}

function touchMidpointY(firstTouch: { clientY: number }, secondTouch: { clientY: number }) {
  return (firstTouch.clientY + secondTouch.clientY) / 2;
}

function numericStyleValue(value: unknown, fallback: number) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : fallback;
  }
  return fallback;
}

function statusFill(status: TopologyNode['status'], brandTheme: 'yaml-flow' | 'radar' = 'yaml-flow') {
  if (brandTheme === 'radar') {
    if (status === 'healthy') {
      return 'rgba(75,234,102,0.16)';
    }
    if (status === 'warning') {
      return 'rgba(255,173,31,0.18)';
    }
    if (status === 'error') {
      return 'rgba(255,69,58,0.18)';
    }
    return 'rgba(125,173,220,0.14)';
  }
  if (status === 'healthy') {
    return 'rgba(40,184,83,0.12)';
  }
  if (status === 'warning') {
    return 'rgba(255,149,0,0.14)';
  }
  if (status === 'error') {
    return 'rgba(255,59,48,0.12)';
  }
  return 'rgba(137,158,186,0.14)';
}

function statusTextColor(status: TopologyNode['status'], brandTheme: 'yaml-flow' | 'radar' = 'yaml-flow') {
  if (brandTheme === 'radar') {
    if (status === 'healthy') {
      return '#8cff9e';
    }
    if (status === 'warning') {
      return '#ffd27a';
    }
    if (status === 'error') {
      return '#ff9a92';
    }
    return '#b8c9dc';
  }
  if (status === 'healthy') {
    return '#1f8f42';
  }
  if (status === 'warning') {
    return '#a45b00';
  }
  if (status === 'error') {
    return '#c01f17';
  }
  return '#5e748f';
}

function themeValue(brandTheme: 'yaml-flow' | 'radar', yamlFlowValue: string, radarValue: string) {
  return brandTheme === 'radar' ? radarValue : yamlFlowValue;
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
  if (kind === 'ConfigMap' || kind === 'Secret' || kind === 'ServiceAccount' || kind === 'CustomResourceDefinition' || kind === 'CustomResource') {
    return 'config';
  }
  if (kind === 'PersistentVolume' || kind === 'PersistentVolumeClaim' || kind === 'StorageClass') {
    return 'storage';
  }
  return 'node';
}

function isSystemNode(node: TopologyNode) {
  if (node.kind === 'Cluster' || node.kind === 'Node' || node.kind === 'PersistentVolume' || node.kind === 'StorageClass' || node.kind === 'CustomResourceDefinition') {
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
