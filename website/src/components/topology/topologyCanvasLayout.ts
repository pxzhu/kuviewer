import type { Edge, MarkerType, Node } from '@xyflow/react';
import { getEdgeColor, getNodeColor } from '../../features/topology/useTopology';
import type { ColorMode } from '../../features/topology/useTopology';
import type { EdgeType, ResourceKind, TopologyEdge, TopologyNode } from '../../types/topology';

export interface TopologyCanvasProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedNodeId: string;
  colorMode: ColorMode;
  brandTheme: 'yaml-flow' | 'radar';
  sourceKey: string;
  onSelectNode: (nodeId: string) => void;
}

export type SavedPositions = Record<string, { x: number; y: number }>;

export type ResourceNodeData = Record<string, unknown> & {
  resource: TopologyNode;
  color: string;
  brandTheme: 'yaml-flow' | 'radar';
  isSelected: boolean;
  related: boolean;
  muted: boolean;
  outgoingEdges: TopologyEdge[];
};

export type GroupNodeData = Record<string, unknown> & {
  label: string;
  caption: string;
  color: string;
  tint: string;
};

export type FlowNode = Node<ResourceNodeData | GroupNodeData>;
export type FlowEdge = Edge<Record<string, unknown>>;

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

export const flowNodeWidth = 220;
export const flowNodeHeight = 106;
const rowStep = 134;
const wrappedColumnGap = 24;
const columnGap = 46;
const groupPadding = 30;
const namespaceGap = 58;
const clusterGap = 96;
const maxRowsPerLane = 4;
export const minMobileZoom = 0.25;
export const maxMobileZoom = 2.5;
const columnOrder: LayoutColumn[] = ['scope', 'ingress', 'service', 'workload', 'pod', 'policy', 'config', 'storage', 'node'];

export const statusLegend = [
  { label: 'healthy', color: '#34c759' },
  { label: 'warning', color: '#ff9500' },
  { label: 'error', color: '#ff3b30' },
  { label: 'unknown', color: '#8e8e93' },
];

export const edgeLegend = [
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

export function buildDisplayGraph(nodes: TopologyNode[], edges: TopologyEdge[], hideSystemNamespaces: boolean, trafficOnly: boolean) {
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

export function buildFlowLayout(nodes: TopologyNode[], edges: TopologyEdge[], savedPositions: SavedPositions, colorMode: ColorMode, brandTheme: 'yaml-flow' | 'radar', selectedNodeId: string): LayoutResult {
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
    const scopedNodes = sortResources(clusterNodes.filter((node) => !node.namespace && node.kind !== 'Namespace'));
    const namespaceNames = uniqueStrings(
      clusterNodes.flatMap((node) => {
        if (node.kind === 'Namespace') {
          return [node.name];
        }
        return node.namespace ? [node.namespace] : [];
      }),
    );
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

export function placeColumns(nodes: TopologyNode[], startX: number, startY: number, savedPositions: SavedPositions) {
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

export function toFlowEdge(edge: TopologyEdge, selectedNodeId: string, brandTheme: 'yaml-flow' | 'radar'): FlowEdge {
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
    markerEnd: { type: 'arrowclosed' as MarkerType, color },
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

export function boundsForFlowNodes(nodes: FlowNode[]) {
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

export function fitMobileCamera(bounds: { width: number; height: number }, viewport: { width: number; height: number }) {
  const scale = clamp(Math.min((viewport.width - 32) / bounds.width, (viewport.height - 32) / bounds.height), minMobileZoom, maxMobileZoom);
  return {
    scale,
    x: Math.round((viewport.width - bounds.width * scale) / 2),
    y: Math.round((viewport.height - bounds.height * scale) / 2),
  };
}

export function mobileFlowEdgePath(source: FlowNode, target: FlowNode) {
  const sourceX = source.position.x + flowNodeWidth;
  const sourceY = source.position.y + flowNodeHeight / 2;
  const targetX = target.position.x;
  const targetY = target.position.y + flowNodeHeight / 2;
  const controlOffset = Math.max(28, Math.abs(targetX - sourceX) * 0.46);
  return `M ${sourceX} ${sourceY} C ${sourceX + controlOffset} ${sourceY}, ${targetX - controlOffset} ${targetY}, ${targetX} ${targetY}`;
}

export function mobileFlowEdgeLabelPoint(source: FlowNode, target: FlowNode) {
  return {
    x: (source.position.x + flowNodeWidth + target.position.x) / 2,
    y: (source.position.y + target.position.y) / 2 + flowNodeHeight / 2 - 8,
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function touchDistance(firstTouch: { clientX: number; clientY: number }, secondTouch: { clientX: number; clientY: number }) {
  return Math.hypot(firstTouch.clientX - secondTouch.clientX, firstTouch.clientY - secondTouch.clientY);
}

export function touchMidpointX(firstTouch: { clientX: number }, secondTouch: { clientX: number }) {
  return (firstTouch.clientX + secondTouch.clientX) / 2;
}

export function touchMidpointY(firstTouch: { clientY: number }, secondTouch: { clientY: number }) {
  return (firstTouch.clientY + secondTouch.clientY) / 2;
}

export function numericStyleValue(value: unknown, fallback: number) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : fallback;
  }
  return fallback;
}

export function statusFill(status: TopologyNode['status'], brandTheme: 'yaml-flow' | 'radar' = 'yaml-flow') {
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

export function statusTextColor(status: TopologyNode['status'], brandTheme: 'yaml-flow' | 'radar' = 'yaml-flow') {
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

export function themeValue(brandTheme: 'yaml-flow' | 'radar', yamlFlowValue: string, radarValue: string) {
  return brandTheme === 'radar' ? radarValue : yamlFlowValue;
}

export function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  const headLength = Math.max(3, Math.floor((maxLength - 1) * 0.58));
  const tailLength = Math.max(2, maxLength - headLength - 1);
  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`;
}

export function boundsForResources(resources: PositionedResource[], padding: number) {
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

export function columnForKind(kind: ResourceKind): LayoutColumn {
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

export function isSystemNode(node: TopologyNode) {
  if (node.kind === 'Cluster' || node.kind === 'Node' || node.kind === 'PersistentVolume' || node.kind === 'StorageClass' || node.kind === 'CustomResourceDefinition') {
    return false;
  }

  const namespace = node.kind === 'Namespace' ? node.name : node.namespace;
  return Boolean(namespace && isSystemNamespace(namespace));
}

export function isSystemNamespace(namespace: string) {
  return (
    namespace === 'default' ||
    namespace === 'local-path-storage' ||
    namespace === 'kube-system' ||
    namespace === 'kube-public' ||
    namespace === 'kube-node-lease' ||
    namespace.startsWith('kuviewer-smoke-')
  );
}

export function isTrafficEdge(edgeType: EdgeType) {
  return edgeType === 'routes-to' || edgeType === 'service-endpoint' || edgeType === 'attaches-to' || edgeType === 'allows-ingress' || edgeType === 'allows-egress';
}

export function sortResources<T extends TopologyNode>(resources: T[]) {
  return [...resources].sort((left, right) => `${left.kind}:${left.namespace || ''}:${left.name}`.localeCompare(`${right.kind}:${right.namespace || ''}:${right.name}`));
}

export function uniqueStrings(values: string[]) {
  return Array.from(new Set(values)).sort();
}

export function summaryPreview(node: TopologyNode) {
  return Object.entries(node.summary)
    .slice(0, 2)
    .map(([key, value]) => `${key}:${String(value)}`);
}

export function statusPillClassName(status: TopologyNode['status']) {
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

export function loadSavedPositions(key: string): SavedPositions {
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

export function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
