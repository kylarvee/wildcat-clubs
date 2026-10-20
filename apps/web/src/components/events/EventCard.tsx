import Link from "next/link";
import { Cast, CircleHelp, Clock, MapPin, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { EventBadges } from "@/components/events/EventBadges";
import { EventCover } from "@/components/events/EventCover";
import { KIND_LABEL, UNIVERSITY_COLOR } from "@/lib/events/labels";
import type { EventCardData } from "@/lib/events/types";
import { INSTITUTION } from "@/lib/institution";
import { fmtDate, fmtRange } from "@/lib/time";

/** Where, in a line: the place, "Online", or the place and online for hybrid events. */
function Place({ e }: { e: EventCardData }) {
  const Icon = e.mode === "online" ? Video : e.mode === "hybrid" ? Cast : e.mode === "tbd" ? CircleHelp : MapPin;
  const text = e.mode === "hybrid" ? `${e.location} · and online` : e.location;
  return (
    <p className="flex items-start gap-1.5 text-sm text-ink-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden="true" />
      <span className="min-w-0">{text}</span>
    </p>
  );
}

/**
 * One date of an event on the Events page: the cover (or the host club's
 * color and logo), the date, time and place, the host, and the badges. The
 * whole card opens the event page for that date.
 */
export function EventCard({ e }: { e: EventCardData }) {
  const host = e.club?.name ?? INSTITUTION.name;
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)] transition-shadow focus-within:ring-2 focus-within:ring-brand hover:shadow-[var(--shadow-pop)]">
      <EventCover src={e.coverUrl} color={e.club?.logoColor ?? UNIVERSITY_COLOR} name={host} logoUrl={e.club?.logoUrl} className="aspect-[2/1] w-full">
        <div className="absolute left-3 top-3 flex min-w-11 flex-col items-center rounded-lg bg-white/95 px-2 py-1 text-center shadow-sm" aria-hidden="true">
          <span className="text-[10px] font-bold uppercase tracking-wide text-brand-600">{fmtDate(e.startsAt, "MMM")}</span>
          <span className="text-lg font-bold leading-none text-ink">{fmtDate(e.startsAt, "d")}</span>
          <span className="text-[10px] font-medium uppercase text-ink-3">{fmtDate(e.startsAt, "EEE")}</span>
        </div>
        {e.cancelled ? (
          <Badge tone="danger" className="absolute right-3 top-3 shadow-sm">
            Cancelled
          </Badge>
        ) : e.happeningNow ? (
          <Badge tone="success" className="absolute right-3 top-3 shadow-sm">
            Happening now
          </Badge>
        ) : null}
      </EventCover>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{KIND_LABEL[e.kind]}</p>
        <h3 className={cn("font-semibold leading-snug text-ink", e.cancelled && "text-ink-3 line-through decoration-2")}>
          {/* Stretched link: the whole card opens the event. */}
          <Link href={`/events/${e.eventId}?o=${e.occurrenceId}`} className="after:absolute after:inset-0 after:content-[''] hover:text-brand focus-visible:outline-none">
            {e.title}
          </Link>
        </h3>
        <p className="flex items-start gap-1.5 text-sm text-ink-2">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden="true" />
          <span>{fmtRange(e.startsAt, e.endsAt, e.allDay)}</span>
        </p>
        <Place e={e} />
        <p className="text-sm text-ink-3">
          {e.club ? "Hosted by " : ""}
          <span className="font-medium text-ink-2">{host}</span>
          {e.cohostNames.length ? ` with ${e.cohostNames.join(", ")}` : ""}
        </p>
        {e.cancelled && e.note ? <p className="text-sm text-danger">{e.note}</p> : null}
        <EventBadges badges={e.badges} className="mt-auto pt-2" />
      </div>
    </article>
  );
}
