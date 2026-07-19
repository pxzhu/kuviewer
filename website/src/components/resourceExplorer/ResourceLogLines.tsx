import type { MutableRefObject } from 'react';
import { formatLogTimestamp } from './resourceDetailActivity';
import { renderHighlightedText } from './resourceDetailHighlight';
import type { LogSearchMatch, ParsedLogLine } from './resourceDetailTypes';

export function ResourceLogLines({
  activeMatch,
  lineRefs,
  lines,
  normalizedFilter,
  rowClassName,
  viewportClassName,
}: {
  activeMatch?: LogSearchMatch;
  lineRefs: MutableRefObject<Record<number, HTMLDivElement | null>>;
  lines: ParsedLogLine[];
  normalizedFilter: string;
  rowClassName: string;
  viewportClassName: string;
}) {
  return (
    <div className={viewportClassName}>
      {lines.map(({ line, message, index, timestamp }) => {
        const activeTimestampMatch = activeMatch?.lineIndex === index && activeMatch.field === 'timestamp' ? activeMatch : undefined;
        const activeMessageMatch = activeMatch?.lineIndex === index && activeMatch.field === 'message' ? activeMatch : undefined;
        const activeRow = Boolean(activeTimestampMatch || activeMessageMatch);
        return (
          <div
            key={`${index}:${line.slice(0, 16)}`}
            ref={(node) => {
              lineRefs.current[index] = node;
            }}
            className={`${rowClassName} ${activeRow ? 'bg-[rgba(255,214,10,0.12)] ring-1 ring-[rgba(255,214,10,0.28)]' : ''}`}
            data-testid={activeRow ? 'active-log-search-line' : undefined}
          >
            <span className="select-none text-right text-[rgba(209,213,219,0.42)]">{index + 1}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">
              {timestamp ? (
                <span className="mr-2 inline-flex rounded-[5px] bg-[rgba(96,165,250,0.16)] px-1.5 py-0.5 text-[rgba(191,219,254,0.9)]">
                  {renderHighlightedText(formatLogTimestamp(timestamp), normalizedFilter, activeTimestampMatch)}
                </span>
              ) : null}
              {renderHighlightedText(message || line || ' ', normalizedFilter, activeMessageMatch)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
