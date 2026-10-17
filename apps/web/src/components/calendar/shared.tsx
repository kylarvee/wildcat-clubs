"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import type { CalendarApi, EventSourceFunc } from "@fullcalendar/core";
import { CalendarClock, ChevronLeft, ChevronRight, MapPin, Users, Video, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { fmtMoney, fmtRange } from "@/lib/time";
import { KIND_LABEL, VISIBILITY_LABEL } from "@/lib/events/labels";
import { campusParts, fromFakeUtc } from "@/lib/events/wallclock";
import type { CalendarEventJson, CalendarEventProps } from "@/lib/events/types";

/**
 * Pieces shared by CalendarView (read-only) and the Events Builder (editable):
 * the toolbar, the JSON feed source, and the occurrence details block.
 */

export type ViewName = "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "listMonth";

export const VIEW_LABEL: Record<ViewName, string> = { dayGridMonth: "Month", timeGridWeek: "Week", timeGridDay: "Day", listMonth: "List" };

/** True only after hydration — FullCalendar renders in the browser so "today" and times match the viewer. */
export function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Narrow screens start on the list view. */
export function isNarrowScreen() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
}

/** "Now" in campus wall-clock, in FullCalendar's UTC frame (see lib/events/wallclock). */
export function campusNow(): Date {
  const p = campusParts(new Date());
  return new Date(Date.UTC(p.y, p.m - 1, p.d, p.H, p.M));
}

/**
 * FullCalendar event source for GET /api/calendar. The calendar's range arrives
 * as fake-UTC wall clock; we convert it to real instants for the query.
 */
export function calendarSource(query: string, onError: (message: string | null) => void): EventSourceFunc {
  return async (info, success, failure) => {
    try {
      const start = fromFakeUtc(info.start).toISOString();
      const end = fromFakeUtc(info.end).toISOString();
      const res = await fetch(`/api/calendar?${query}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "We couldn't load this calendar.");
      }
      const events = (await res.json()) as CalendarEventJson[];
      onError(null);
      success(events);
    } catch (e) {
      const message = e instanceof Error ? e.message : "We couldn't load this calendar.";
      onError(message === "Failed to fetch" ? "You seem to be offline. Check your connection and try again." : message);
      failure(e instanceof Error ? e : new Error(message));
    }
  };
}

export function CalendarToolbar({
  api,
  title,
  view,
  views,
  compact,
  loading,
  children,
}: {
  api: CalendarApi | null;
  title: string;
  view: ViewName;
  views: ViewName[];
  compact?: boolean;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", compact ? "mb-2" : "mb-3")}>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className={compact ? "h-8 w-8" : undefined} onClick={() => api?.prev()} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className={compact ? "h-8 w-8" : undefined} onClick={() => api?.next()} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => api?.today()}>
          Today
        </Button>
      </div>
      {/* min-w: in a narrow container the view switcher wraps to its own line instead of squeezing the title to "O…". */}
      <h2 className={cn("min-w-[10rem] flex-1 truncate font-semibold text-ink", compact ? "text-sm" : "text-base sm:text-lg")} aria-live="polite">
        {title}
        {loading ? <span className="sr-only"> (loading)</span> : null}
      </h2>
      {views.length > 1 ? (
        <div role="group" aria-label="Calendar view" className="flex rounded-lg border border-line-2 bg-surface p-0.5">
          {views.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => api?.changeView(v)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand sm:text-sm",
                view === v ? "bg-brand-50 text-brand" : "text-ink-3 hover:text-ink",
              )}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** The body of the click-for-details dialog / popover. */
export function OccurrenceDetails({ p, title, showCost = true }: { p: CalendarEventProps; title: string; showCost?: boolean }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: p.clubColor }} aria-hidden />
        <div className="min-w-0">
          <p className={cn("text-base font-semibold leading-snug text-ink", p.cancelled && "line-through decoration-2")}>{title}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {p.cancelled ? <Badge tone="danger">Cancelled</Badge> : null}
            <Badge>{KIND_LABEL[p.kind]}</Badge>
            {p.visibility !== "PUBLIC" ? <Badge tone="brand">{VISIBILITY_LABEL[p.visibility]}</Badge> : null}
          </div>
        </div>
      </div>
      {p.cancelled && p.note ? <p className="rounded-lg bg-danger-50 px-3 py-2 text-danger">{p.note}</p> : null}
      <p className="flex gap-2 text-ink-2">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
        <span>
          {fmtRange(p.startsAt, p.endsAt, p.allDay)}
          {p.recurrence !== "NONE" ? <span className="block text-xs text-ink-3">{p.scheduleLabel}</span> : null}
        </span>
      </p>
      <p className="flex gap-2 text-ink-2">
        {p.locationType === "VIRTUAL" ? <Video className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden /> : <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />}
        <span className="min-w-0">
          {p.location}
          {p.virtualUrl ? (
            <a href={p.virtualUrl} target="_blank" rel="noopener noreferrer" className="ml-1.5 font-medium text-brand-600 hover:underline">
              Join link
            </a>
          ) : null}
        </span>
      </p>
      {p.clubName ? (
        <p className="flex gap-2 text-ink-2">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <span>
            Hosted by{" "}
            <Link href={`/clubs/${p.clubSlug}`} className="font-medium text-brand-600 hover:underline">
              {p.clubName}
            </Link>
            {p.cohostNames.length ? <span className="text-ink-3"> with {p.cohostNames.join(", ")}</span> : null}
          </span>
        </p>
      ) : (
        <p className="flex gap-2 text-ink-2">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <span>Weber State university event</span>
        </p>
      )}
      {showCost && p.expectedCostCents != null ? (
        <div className="flex gap-2 rounded-lg border border-line bg-muted/50 px-3 py-2 text-ink-2">
          <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <div className="min-w-0">
            <p>
              Expected cost <span className="font-semibold text-ink">{fmtMoney(p.expectedCostCents)}</span>
              {p.recurrence !== "NONE" && p.eventTotalCents != null ? <span className="text-ink-3"> · {fmtMoney(p.eventTotalCents)} for all meetings</span> : null}
            </p>
            {p.clubSlug ? (
              <Link href={`/clubs/${p.clubSlug}/manage/budget?event=${p.eventId}`} className="text-xs font-medium text-brand-600 hover:underline">
                Request funding
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
