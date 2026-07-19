import { Bookmark } from 'lucide-react';
import {
  eventIdentityKey,
  eventSeverity,
  eventSeverityBadgeClassName,
  formatEventTimestamp,
  formatRelativeEventTimestamp,
  validEventTimestamp,
} from './resourceDetailActivity';
import { renderHighlightedText } from './resourceDetailHighlight';
import type { EventGroup, EventListItem } from './resourceDetailTypes';

export function ResourceEventGroups({
  groups,
  newEventKeys,
  normalizedFilter,
  onTogglePinned,
  pinnedEvents,
}: {
  groups: EventGroup[];
  newEventKeys: Set<string>;
  normalizedFilter: string;
  onTogglePinned: (eventId: string) => void;
  pinnedEvents: EventListItem[];
}) {
  const renderEventCard = (item: EventListItem) => {
    const { event, id, pinned } = item;
    const severity = eventSeverity(event);
    const isNewEvent = newEventKeys.has(eventIdentityKey(event));
    const timestampKnown = validEventTimestamp(event.timestamp);
    const relativeTime = formatRelativeEventTimestamp(event.timestamp);
    const absoluteTime = formatEventTimestamp(event.timestamp);
    return (
      <div
        key={id}
        className={`rounded-[10px] border p-2 ${
          isNewEvent
            ? 'border-[rgba(255,149,0,0.35)] bg-[rgba(255,149,0,0.08)]'
            : pinned
              ? 'border-[rgba(0,122,255,0.26)] bg-[rgba(0,122,255,0.06)]'
              : 'border-[rgba(60,60,67,0.12)] bg-white/75'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={eventSeverityBadgeClassName(severity)}>{renderHighlightedText(event.type || 'Normal', normalizedFilter)}</span>
              {isNewEvent ? (
                <span
                  data-testid="events-new-chip"
                  className="rounded-full border border-[rgba(255,149,0,0.28)] bg-[rgba(255,149,0,0.14)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#9a5a00]"
                >
                  NEW
                </span>
              ) : null}
              <p className="min-w-0 break-words text-xs font-semibold text-[#1d1d1f]">{renderHighlightedText(event.reason || event.type || 'Event', normalizedFilter)}</p>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className={`ku-chip ${timestampKnown ? '' : 'border-[rgba(142,142,147,0.2)] bg-[rgba(142,142,147,0.1)] text-[#636366]'}`}>
                {renderHighlightedText(relativeTime, normalizedFilter)}
              </span>
              {event.source ? <span className="ku-chip">{renderHighlightedText(event.source, normalizedFilter)}</span> : null}
            </div>
          </div>
          <button
            className={`inline-flex shrink-0 items-center gap-1 rounded-[7px] border px-1.5 py-1 text-[10px] font-semibold transition ${
              pinned
                ? 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.12)] text-[#0057b8]'
                : 'border-[rgba(60,60,67,0.12)] bg-white/78 text-[rgba(60,60,67,0.62)] hover:bg-white'
            }`}
            type="button"
            onClick={() => onTogglePinned(id)}
            aria-pressed={pinned}
            title={pinned ? '이벤트 고정 해제' : '이벤트 고정'}
          >
            <Bookmark size={12} aria-hidden="true" />
            {pinned ? '고정됨' : '고정'}
          </button>
        </div>
        <p className="mt-2 break-words text-xs text-[rgba(60,60,67,0.72)]">{renderHighlightedText(event.message, normalizedFilter)}</p>
        <p className="mt-1 break-words font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.54)]">
          {renderHighlightedText(absoluteTime, normalizedFilter)}
        </p>
      </div>
    );
  };

  return (
    <div className="grid gap-2">
      {pinnedEvents.length > 0 ? (
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[#0057b8]">Pinned</p>
            <span className="ku-chip">{pinnedEvents.length}</span>
          </div>
          <div className="grid gap-2">{pinnedEvents.map(renderEventCard)}</div>
        </div>
      ) : null}
      {groups.map((group) => (
        <div key={group.key} className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)]">{group.label}</p>
            <span className="ku-chip">{group.count}</span>
          </div>
          <div className="grid gap-2">{group.items.map(renderEventCard)}</div>
        </div>
      ))}
    </div>
  );
}
