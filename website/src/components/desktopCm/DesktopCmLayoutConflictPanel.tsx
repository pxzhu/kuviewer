import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { isDesktopCmKeyboardIgnoredTarget, slugifyDesktopCmTestId } from '../../features/desktop/desktopCmReorder';
import { formatDesktopCmSessionLayoutSummary, type DesktopCmSessionLayoutPreset } from '../../features/desktop/desktopCmSessionLayouts';

export type DesktopCmSessionLayoutConflictResolution = 'incoming' | 'current' | 'rename';

export interface DesktopCmSessionLayoutImportConflict {
  name: string;
  current: DesktopCmSessionLayoutPreset;
  incoming: DesktopCmSessionLayoutPreset;
}

export interface DesktopCmSessionLayoutImportConflictPreview {
  fileName: string;
  imported: number;
  updated: number;
  skipped: number;
  invalid: number;
  initialConflictCount: number;
  incomingResolved: number;
  currentResolved: number;
  renamedResolved: number;
  conflicts: DesktopCmSessionLayoutImportConflict[];
}

interface DesktopCmLayoutConflictPanelProps {
  preview: DesktopCmSessionLayoutImportConflictPreview;
  onResolve: (mode: DesktopCmSessionLayoutConflictResolution, conflictName?: string) => void;
}

const titleId = 'desktop-cm-session-layout-conflict-title';
const descriptionId = 'desktop-cm-session-layout-conflict-description';
const liveStatusId = 'desktop-cm-session-layout-conflict-live-status';

export function DesktopCmLayoutConflictPanel({ preview, onResolve }: DesktopCmLayoutConflictPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [activeConflictName, setActiveConflictName] = useState(() => preview.conflicts[0]?.name || '');
  const conflictNames = useMemo(() => preview.conflicts.map((conflict) => conflict.name), [preview.conflicts]);
  const summary = useMemo(() => {
    const total = preview.initialConflictCount;
    const remaining = preview.conflicts.length;
    return {
      total,
      remaining,
      resolved: Math.max(0, total - remaining),
      imported: preview.imported,
      updated: preview.updated,
      skipped: preview.skipped,
      invalid: preview.invalid,
      incomingResolved: preview.incomingResolved,
      currentResolved: preview.currentResolved,
      renamedResolved: preview.renamedResolved,
    };
  }, [preview]);
  const previewFocusKey = `${preview.fileName}:${preview.initialConflictCount}:${preview.invalid}`;
  const liveText = `Layout conflicts: ${summary.resolved} of ${summary.total} resolved, ${summary.remaining} remaining. Incoming ${summary.incomingResolved}, keep current ${summary.currentResolved}, rename ${summary.renamedResolved}.`;

  useEffect(() => {
    if (activeConflictName && !conflictNames.some((name) => name.toLowerCase() === activeConflictName.toLowerCase())) {
      setActiveConflictName(conflictNames[0] || '');
    }
  }, [activeConflictName, conflictNames]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [previewFocusKey]);

  const moveActiveConflict = (direction: 'previous' | 'next' | 'first' | 'last') => {
    if (conflictNames.length === 0) {
      return;
    }
    const activeIndex = conflictNames.findIndex((name) => name.toLowerCase() === activeConflictName.toLowerCase());
    if (direction === 'first' || direction === 'last') {
      setActiveConflictName(direction === 'first' ? conflictNames[0] : conflictNames[conflictNames.length - 1]);
      return;
    }
    if (activeIndex < 0) {
      setActiveConflictName(direction === 'previous' ? conflictNames[conflictNames.length - 1] : conflictNames[0]);
      return;
    }
    const nextIndex = direction === 'previous' ? Math.max(0, activeIndex - 1) : Math.min(conflictNames.length - 1, activeIndex + 1);
    setActiveConflictName(conflictNames[nextIndex]);
  };

  const resolveConflict = (mode: DesktopCmSessionLayoutConflictResolution, conflictName?: string) => {
    if (conflictName) {
      const conflictIndex = conflictNames.findIndex((name) => name.toLowerCase() === conflictName.toLowerCase());
      const remainingNames = conflictNames.filter((name) => name.toLowerCase() !== conflictName.toLowerCase());
      setActiveConflictName(remainingNames[Math.min(Math.max(conflictIndex, 0), Math.max(remainingNames.length - 1, 0))] || '');
    }
    onResolve(mode, conflictName);
  };

  const resolveActiveConflict = (mode: DesktopCmSessionLayoutConflictResolution) => {
    if (activeConflictName) {
      resolveConflict(mode, activeConflictName);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isDesktopCmKeyboardIgnoredTarget(event.target)) {
      return;
    }
    const navigationByKey = {
      ArrowUp: 'previous',
      ArrowDown: 'next',
      Home: 'first',
      End: 'last',
    } as const;
    if (event.key in navigationByKey) {
      event.preventDefault();
      moveActiveConflict(navigationByKey[event.key as keyof typeof navigationByKey]);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      resolveActiveConflict('incoming');
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (activeConflictName) {
        setActiveConflictName('');
      } else {
        panelRef.current?.blur();
      }
      return;
    }
    const resolutionByKey = { k: 'current', r: 'rename' } as const;
    const mode = resolutionByKey[event.key.toLowerCase() as keyof typeof resolutionByKey];
    if (mode) {
      event.preventDefault();
      resolveActiveConflict(mode);
    }
  };

  return (
    <div
      ref={panelRef}
      aria-describedby={`${descriptionId} ${liveStatusId}`}
      aria-labelledby={titleId}
      className="grid gap-2 rounded-[10px] border border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,149,0,0.28)]"
      data-testid="desktop-cm-session-layout-conflict-preview"
      onKeyDown={handleKeyDown}
      role="group"
      tabIndex={0}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-white/65 text-[#9a5a00]" data-testid="desktop-cm-session-layout-conflict-title" id={titleId}>
          layout conflict preview · {preview.fileName} · {preview.conflicts.length} conflict{preview.conflicts.length === 1 ? '' : 's'}
        </span>
        <button aria-label="Use incoming layout for all remaining layout conflicts" className="ku-control h-8 text-xs" data-testid="desktop-cm-session-layout-conflict-use-incoming" type="button" onClick={() => resolveConflict('incoming')}>
          incoming 우선
        </button>
        <button aria-label="Keep current layout for all remaining layout conflicts" className="ku-control h-8 text-xs" data-testid="desktop-cm-session-layout-conflict-keep-current" type="button" onClick={() => resolveConflict('current')}>
          현재 유지
        </button>
        <button aria-label="Rename incoming layout for all remaining layout conflicts" className="ku-control h-8 text-xs" data-testid="desktop-cm-session-layout-conflict-rename-incoming" type="button" onClick={() => resolveConflict('rename')}>
          이름 바꿔 둘 다 보관
        </button>
      </div>
      <p className="sr-only" data-testid="desktop-cm-session-layout-conflict-description" id={descriptionId}>
        Same-name layout conflicts are kept in browser memory until explicitly resolved. Use arrow keys, Home, End, Enter, K, R, and Escape when this preview has focus.
      </p>
      <p aria-live="polite" className="sr-only" data-testid="desktop-cm-session-layout-conflict-live-status" id={liveStatusId}>
        {liveText}
      </p>
      <div className="grid gap-1 rounded-[8px] border border-[rgba(255,149,0,0.16)] bg-white/58 px-2 py-2 text-xs font-semibold text-[rgba(60,60,67,0.68)]" data-testid="desktop-cm-session-layout-conflict-summary">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="ku-chip border-[rgba(255,149,0,0.18)] bg-white/65 text-[#9a5a00]" data-testid="desktop-cm-session-layout-conflict-summary-progress">
            충돌 {summary.total}개 중 {summary.resolved}개 해결
          </span>
          <span className="ku-chip" data-testid="desktop-cm-session-layout-conflict-summary-remaining">남은 {summary.remaining}개</span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[11px]" data-testid="desktop-cm-session-layout-conflict-summary-resolutions">
          <span>incoming 반영 {summary.incomingResolved}</span><span>현재 유지 {summary.currentResolved}</span><span>rename {summary.renamedResolved}</span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[11px]" data-testid="desktop-cm-session-layout-conflict-summary-import">
          <span>new {summary.imported}</span><span>updated {summary.updated}</span><span>skipped {summary.skipped}</span><span>invalid {summary.invalid}</span>
        </div>
      </div>
      <div aria-label="Layout import conflicts" className="grid gap-1" role="list">
        {preview.conflicts.map((conflict) => {
          const active = activeConflictName.toLowerCase() === conflict.name.toLowerCase();
          const conflictSlug = slugifyDesktopCmTestId(conflict.name);
          const currentSummary = formatDesktopCmSessionLayoutSummary(conflict.current.viewPreferences);
          const incomingSummary = formatDesktopCmSessionLayoutSummary(conflict.incoming.viewPreferences);
          return (
            <div
              key={conflict.name}
              aria-label={`${conflict.name}. Current layout ${currentSummary}. Incoming layout ${incomingSummary}.${active ? ' Active conflict row.' : ''}`}
              aria-current={active ? 'true' : undefined}
              className={`grid gap-1 rounded-[8px] border px-2 py-1 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition ${active ? 'border-[rgba(255,149,0,0.42)] bg-white/86 shadow-[0_0_0_2px_rgba(255,149,0,0.14)]' : 'border-[rgba(60,60,67,0.08)] bg-white/64'}`}
              data-testid={`desktop-cm-session-layout-conflict-${conflictSlug}`}
              id={`desktop-cm-session-layout-conflict-row-${conflictSlug}`}
              onClick={() => setActiveConflictName(conflict.name)}
              role="listitem"
            >
              <span className="truncate text-[rgba(60,60,67,0.86)]">{conflict.name}</span>
              <span className="font-mono">현재 · {currentSummary}</span>
              <span className="font-mono">incoming · {incomingSummary}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {([
                  ['incoming', 'incoming', 'Use incoming layout'],
                  ['current', '현재 유지', 'Keep current layout'],
                  ['rename', 'rename', 'Rename incoming layout'],
                ] as const).map(([mode, label, ariaLabel]) => (
                  <button
                    key={mode}
                    aria-label={`${ariaLabel} for ${conflict.name}`}
                    className="ku-control h-7 text-[11px]"
                    data-testid={`desktop-cm-session-layout-conflict-row-${mode === 'current' ? 'keep-current' : mode === 'rename' ? 'rename-incoming' : 'use-incoming'}-${conflictSlug}`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      resolveConflict(mode, conflict.name);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs font-semibold text-[rgba(60,60,67,0.58)]">same-name layout은 선택 전까지 덮어쓰지 않음 · conflict preview는 브라우저 메모리에만 유지</p>
    </div>
  );
}
