import type { ReactNode } from 'react';
import type { LogSearchMatch } from './resourceDetailTypes';

export function renderHighlightedText(
  text: string,
  filter: string,
  activeMatch?: Pick<LogSearchMatch, 'start' | 'end'>,
  activeTestId = 'active-log-search-match',
): ReactNode {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) {
    return text || ' ';
  }

  const lowerText = text.toLowerCase();
  const fragments: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(normalizedFilter, cursor);
  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      fragments.push(text.slice(cursor, matchIndex));
    }
    const matchEnd = matchIndex + normalizedFilter.length;
    const active = activeMatch?.start === matchIndex && activeMatch.end === matchEnd;
    fragments.push(
      <mark
        key={`${matchIndex}:${matchEnd}`}
        className={`rounded-[3px] px-0.5 text-[#1d1d1f] ${active ? 'bg-[#ff9500] ring-1 ring-[#ffd60a]' : 'bg-[#ffd60a]'}`}
        data-testid={active ? activeTestId : undefined}
      >
        {text.slice(matchIndex, matchEnd)}
      </mark>,
    );
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(normalizedFilter, cursor);
  }
  if (cursor < text.length) {
    fragments.push(text.slice(cursor));
  }
  return fragments.length > 0 ? fragments : ' ';
}
