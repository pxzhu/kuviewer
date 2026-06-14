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
const columnOrder: LayoutColumn[] = ['scope', 'ingress', 'service', 'workload', 'pod', 'policy', 'config', 'storage', 'node'];

const statusLegend = [
  { label: 'healthy', color: '#34c759' },
  { label: 'warning', color: '#ff9500' },
  { label: 'error', color: '#ff3b30' },
  { label: 'unknown', color: '#8e8e93' },
];

const edgeLegend = [
  { label: '트래픽', color: '#007aff' },
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
    visibleEdges = visibleEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target) && (isTrafficEdge(edge.type) || ['owns', 'scheduled-on', 'binds-storage', 'env-from', 'uses-service-account', 'targets-scale', 'applies-to'].includes(edge.type)));
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
  if (kind === 'Ingress') {
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
  return edgeType === 'routes-to' || edgeType === 'service-endpoint';
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
