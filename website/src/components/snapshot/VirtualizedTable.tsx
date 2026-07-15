import { useEffect, useRef, useState, type ReactNode } from 'react';

export const VIRTUALIZE_AFTER_ROWS = 80;

const rowHeight = 64;
const viewportHeight = 560;
const overscan = 6;

interface VirtualizedTableProps<T> {
  ariaLabel: string;
  columnCount: number;
  header: ReactNode;
  minWidth: string;
  rows: T[];
  testId: string;
  renderRow: (row: T, index: number) => ReactNode;
}

export function VirtualizedTable<T>({
  ariaLabel,
  columnCount,
  header,
  minWidth,
  rows,
  testId,
  renderRow,
}: VirtualizedTableProps<T>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const virtualized = rows.length > VIRTUALIZE_AFTER_ROWS;

  useEffect(() => {
    setScrollTop(0);
    viewportRef.current?.scrollTo({ top: 0 });
  }, [rows]);

  const firstVisibleIndex = virtualized ? Math.floor(scrollTop / rowHeight) : 0;
  const startIndex = virtualized ? Math.max(0, firstVisibleIndex - overscan) : 0;
  const visibleRowCount = Math.ceil(viewportHeight / rowHeight) + (overscan * 2);
  const endIndex = virtualized ? Math.min(rows.length, startIndex + visibleRowCount) : rows.length;
  const visibleRows = rows.slice(startIndex, endIndex);
  const topSpacerHeight = virtualized ? startIndex * rowHeight : 0;
  const bottomSpacerHeight = virtualized ? Math.max(0, (rows.length - endIndex) * rowHeight) : 0;

  return (
    <div
      ref={viewportRef}
      className={virtualized ? 'max-h-[560px] overflow-auto overscroll-contain' : 'overflow-x-auto'}
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
      data-testid={testId}
      data-total-count={rows.length}
      data-rendered-count={visibleRows.length}
      data-virtualized={virtualized ? 'true' : 'false'}
      onScroll={(event) => {
        if (virtualized) {
          setScrollTop(event.currentTarget.scrollTop);
        }
      }}
    >
      <table className="w-full border-collapse text-left text-sm" style={{ minWidth }} aria-rowcount={rows.length + 1}>
        <thead className="sticky top-0 z-[1] bg-white">{header}</thead>
        <tbody>
          {topSpacerHeight > 0 ? (
            <tr aria-hidden="true"><td colSpan={columnCount} style={{ height: topSpacerHeight, padding: 0 }} /></tr>
          ) : null}
          {visibleRows.map((row, index) => renderRow(row, startIndex + index))}
          {bottomSpacerHeight > 0 ? (
            <tr aria-hidden="true"><td colSpan={columnCount} style={{ height: bottomSpacerHeight, padding: 0 }} /></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
