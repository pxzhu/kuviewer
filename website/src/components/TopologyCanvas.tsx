import { lazy, Suspense, useEffect, useState } from 'react';
import type { TopologyCanvasProps } from './topology/topologyCanvasLayout';

const DesktopTopologyCanvas = lazy(async () => {
  const module = await import('./topology/DesktopTopologyCanvas');
  return { default: module.DesktopTopologyCanvas };
});

const MobileTopologyCanvas = lazy(async () => {
  const module = await import('./topology/MobileTopologyCanvas');
  return { default: module.MobileTopologyCanvas };
});

export function TopologyCanvas(props: TopologyCanvasProps) {
  const coarsePointer = useCoarsePointer();

  return (
    <Suspense fallback={<TopologyRendererFallback />}>
      {coarsePointer ? <MobileTopologyCanvas {...props} /> : <DesktopTopologyCanvas {...props} />}
    </Suspense>
  );
}

function TopologyRendererFallback() {
  return (
    <section className="ku-panel overflow-hidden" data-testid="topology-renderer-loading">
      <div className="border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#1d1d1f]">토폴로지 맵</h2>
      </div>
      <div className="ku-radar-canvas flex h-[68vh] min-h-[560px] items-center justify-center px-4 text-sm font-semibold text-[rgba(60,60,67,0.58)]">
        토폴로지 렌더러를 불러오는 중입니다.
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
