import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TouchEvent, WheelEvent } from 'react';
import type { Node } from '@xyflow/react';
import { Focus, Minus, Plus, RotateCcw } from 'lucide-react';
import { getNodeColor } from '../../features/topology/useTopology';
import {
  boundsForFlowNodes,
  buildDisplayGraph,
  buildFlowLayout,
  clamp,
  fitMobileCamera,
  flowNodeHeight,
  flowNodeWidth,
  maxMobileZoom,
  minMobileZoom,
  mobileFlowEdgeLabelPoint,
  mobileFlowEdgePath,
  numericStyleValue,
  statusFill,
  statusPillClassName,
  statusTextColor,
  summaryPreview,
  themeValue,
  touchDistance,
  touchMidpointX,
  touchMidpointY,
  truncateMiddle,
  type GroupNodeData,
  type ResourceNodeData,
  type TopologyCanvasProps,
} from './topologyCanvasLayout';


export function MobileTopologyCanvas({ nodes, edges, selectedNodeId, colorMode, brandTheme, onSelectNode }: TopologyCanvasProps) {
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
            <div className="ku-map-toolbar absolute left-2 top-2 z-10 flex flex-wrap gap-1.5 p-1.5">
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
