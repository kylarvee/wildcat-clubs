import Link from "next/link";
import { Clock, MapPin, Video } from "lucide-react";
import type { UpcomingEvent } from "@/lib/clubs/queries";
import { fmtDate, fmtRange } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { ClubLogo } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { EVENT_KIND_LABEL, safeHex } from "@/components/clubs/labels";

type ClubLink = { id: string; name: string; slug: string };

/** "A, B, C" as club links (positioned, so they sit above the row's stretched link). */
function ClubLinks({ clubs, className }: { clubs: ClubLink[]; className?: string }) {
  return (
    <>
      {clubs.map((c, i) => (
        <span key={c.id}>
          {i > 0 ? ", " : ""}
          <Link href={`/clubs/${c.slug}`} className={cn("relative hover:text-brand hover:underline", className)}>
            {c.name}
          </Link>
        </span>
      ))}
    </>
  );
}

/**
 * Upcoming events as date-tile rows (landing page and club pages). Each row
 * opens the event page. On a club's page (`clubId`) the host line names the
 * other clubs: "Co-hosted with …" when this club hosts, "Hosted by …" when
 * it's a co-host.
 */
export function EventList({ events, showHost = true, clubId, className }: { events: UpcomingEvent[]; showHost?: boolean; clubId?: string; className?: string }) {
  return (
    <ol className={cn("divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)}>
      {events.map((e) => {
        const color = safeHex(e.host?.logoColor);
        const otherCohosts = e.cohosts.filter((c) => c.id !== clubId);
        return (
          <li key={e.occurrenceId} className="relative flex gap-4 p-4 hover:bg-muted/40">
            <div className="flex w-14 shrink-0 flex-col items-center overflow-hidden rounded-xl border border-line text-center" aria-hidden="true">
              <span className="w-full py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white" style={{ backgroundColor: color }}>
                {fmtDate(e.startsAt, "MMM")}
              </span>
              <span className="py-1 text-xl font-bold leading-none text-ink">{fmtDate(e.startsAt, "d")}</span>
              <span className="pb-1 text-[10px] font-medium uppercase text-ink-3">{fmtDate(e.startsAt, "EEE")}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-ink">
                  {/* Stretched link: the whole row opens the event; club links below sit above it. */}
                  <Link
                    href={`/events/${e.eventId}?o=${e.occurrenceId}`}
                    className="after:absolute after:inset-0 after:content-[''] hover:text-brand hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-brand"
                  >
                    {e.title}
                  </Link>
                </p>
                {e.happeningNow ? <Badge tone="success">Happening now</Badge> : <Badge>{EVENT_KIND_LABEL[e.kind]}</Badge>}
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2">
                <Clock className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden="true" />
                <span>{fmtRange(e.startsAt, e.endsAt, e.allDay)}</span>
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-2">
                {e.isVirtual ? <Video className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden="true" /> : <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden="true" />}
                <span className="truncate">{e.location}</span>
              </p>
              {showHost ? (
                <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-3">
                  {e.host ? (
                    <>
                      <ClubLogo name={e.host.name} src={e.host.logoUrl} color={e.host.logoColor} size="sm" className="h-5 w-5 rounded-md text-[9px]" />
                      <ClubLinks clubs={[e.host]} className="font-medium text-ink-2" />
                    </>
                  ) : (
                    <span className="font-medium text-ink-2">Weber State University</span>
                  )}
                  {e.cohosts.length ? (
                    <span>
                      with <ClubLinks clubs={e.cohosts} />
                    </span>
                  ) : null}
                </p>
              ) : e.host?.id !== clubId ? (
                // This club co-hosts: name the real host first.
                <p className="mt-2 text-sm text-ink-3">
                  Hosted by {e.host ? <ClubLinks clubs={[e.host]} className="font-medium text-ink-2" /> : <span className="font-medium text-ink-2">Weber State University</span>}
                  {otherCohosts.length ? (
                    <>
                      {" "}
                      with <ClubLinks clubs={otherCohosts} className="font-medium text-ink-2" />
                    </>
                  ) : null}
                </p>
              ) : otherCohosts.length ? (
                <p className="mt-2 text-sm text-ink-3">
                  Co-hosted with <ClubLinks clubs={otherCohosts} className="font-medium text-ink-2" />
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
