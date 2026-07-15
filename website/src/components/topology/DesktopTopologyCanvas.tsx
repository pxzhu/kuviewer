import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Eye, EyeOff, Focus, Minus, Plus, Route, RotateCcw } from 'lucide-react';
import { getEdgeColor } from '../../features/topology/useTopology';
import {
  buildDisplayGraph,
  buildFlowLayout,
  edgeLegend,
  hashString,
  loadSavedPositions,
  statusLegend,
  statusPillClassName,
  summaryPreview,
  type FlowEdge,
  type FlowNode,
  type GroupNodeData,
  type ResourceNodeData,
  type SavedPositions,
  type TopologyCanvasProps,
} from './topologyCanvasLayout';

const nodeTypes = {
  resource: ResourceNode,
  group: GroupNode,
} as NodeTypes;

export function DesktopTopologyCanvas(props: TopologyCanvasProps) {
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
              <div className="ku-map-toolbar flex flex-wrap gap-2 p-2">
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
      className={`ku-topology-node relative h-[106px] w-[220px] rounded-[13px] border bg-white/92 px-3 py-2 text-left backdrop-blur-xl transition-[box-shadow,opacity,transform,border-color] ${
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
