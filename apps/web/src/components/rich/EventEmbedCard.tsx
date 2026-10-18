import "server-only";
import Link from "next/link";
import type { Recurrence } from "@prisma/client";
import { CalendarDays, CalendarX2, Lock, MapPin, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ClubLogo } from "@/components/ui/avatar";
import { EmbedNotice } from "@/components/embeds/EmbedNotice";
import type { Actor } from "@/lib/auth/session";
import { loadEventCard } from "@/lib/rich/embed-data";
import { safeHttpUrl } from "@/lib/rich/embeds";
import { fmtDate, fmtRange } from "@/lib/time";

const REPEATS: Partial<Record<Recurrence, string>> = {
  DAILY: "Repeats daily",
  WEEKLY: "Repeats weekly",
  MONTHLY: "Repeats monthly",
  SEMESTERLY: "Repeats each semester",
  ACADEMIC_YEARLY: "Repeats each academic year",
  YEARLY: "Repeats yearly",
};

/**
 * An event embedded in rich text: next date (campus time), place, host club
 * and a link to the event page. Respects Event.visibility — viewers who
 * can't see the event get a short notice instead (never the title).
 */
export async function EventEmbedCard({ eventId, viewer, signInHref }: { eventId: string | null; viewer: Actor | null; signInHref: string }) {
  const result = eventId ? await loadEventCard(viewer, eventId) : ({ state: "missing" } as const);

  if (result.state === "missing") {
    return <EmbedNotice icon={<CalendarX2 />} title="This event is no longer available." />;
  }
  if (result.state === "denied") {
    const signin = result.reason === "signin";
    return (
      <EmbedNotice
        icon={<Lock />}
        title={signin ? "Sign in to see this event." : result.reason === "members" ? "This event is for club members." : "This event isn't published yet."}
        action={
          signin ? (
            <ButtonLink href={signInHref} variant="outline" size="sm">
              Sign in
            </ButtonLink>
          ) : null
        }
      >
        {signin ? "It's shared with Weber State accounts only." : result.reason === "members" ? "Join the club to see its members-only events." : null}
      </EmbedNotice>
    );
  }

  const e = result.event;
  const href = `/events/${e.id}`;
  const when = e.next ? fmtRange(e.next.startsAt, e.next.endsAt, e.allDay) : null;
  const cancelled = e.status === "CANCELLED" || e.next?.cancelled;
  const past = e.next ? !e.next.upcoming : false;
  const repeats = REPEATS[e.recurrence];
  const virtual = safeHttpUrl(e.virtualUrl);

  return (
    <article className="flex gap-4 rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]" aria-label={`Event: ${e.title}`}>
      <div
        className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-line bg-canvas text-center"
        aria-hidden
      >
        {e.next ? (
          <>
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: e.host?.logoColor ?? "var(--color-brand)" }}>
              {fmtDate(e.next.startsAt, "MMM")}
            </span>
            <span className="text-xl font-bold leading-none text-ink">{fmtDate(e.next.startsAt, "d")}</span>
          </>
        ) : (
          <CalendarDays className="h-6 w-6 text-ink-3" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={href} className="min-w-0 font-semibold text-ink hover:text-brand focus-visible:outline-2 focus-visible:outline-brand">
            {e.title}
          </Link>
          {cancelled ? <Badge tone="danger">Cancelled</Badge> : past ? <Badge>Past event</Badge> : null}
          {e.visibility === "MEMBERS" ? <Badge tone="brand">Members only</Badge> : e.visibility === "UNIVERSITY" ? <Badge tone="info">Weber State only</Badge> : null}
        </div>
        <p className="flex items-start gap-1.5 text-sm text-ink-2">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <span>
            {when ? (
              <>
                {past ? "Last held " : repeats ? "Next: " : null}
                {when}
              </>
            ) : (
              "Date to be announced"
            )}
            {repeats && !past ? <span className="text-ink-3"> · {repeats}</span> : null}
          </span>
        </p>
        <p className="flex items-start gap-1.5 text-sm text-ink-2">
          {virtual ? <Video className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden /> : <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />}
          <span className="min-w-0">{e.location}</span>
        </p>
        {e.host ? (
          <p className="flex items-center gap-2 text-sm text-ink-3">
            <ClubLogo name={e.host.name} src={e.host.logoUrl} color={e.host.logoColor} size="sm" className="h-6 w-6 rounded-md text-[10px]" />
            <span className="min-w-0">
              Hosted by{" "}
              <Link href={`/clubs/${e.host.slug}`} className="font-medium text-ink-2 hover:text-brand hover:underline">
                {e.host.name}
              </Link>
              {e.cohosts.length ? <> with {e.cohosts.map((c) => c.name).join(", ")}</> : null}
            </span>
          </p>
        ) : (
          <p className="text-sm text-ink-3">A Weber State university event</p>
        )}
        <div className="pt-1 sm:hidden">
          <ButtonLink href={href} variant="outline" size="sm" className="w-full">
            View event
          </ButtonLink>
        </div>
      </div>
      <ButtonLink href={href} variant="outline" size="sm" className="hidden self-start sm:inline-flex">
        View event
      </ButtonLink>
    </article>
  );
}
