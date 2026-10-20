"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import type { CalendarApi, EventClickArg } from "@fullcalendar/core";
import { AlertCircle, ArrowRight, RotateCw } from "lucide-react";
import { ButtonLink, Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";
import { CalendarToolbar, calendarSource, campusNow, isNarrowScreen, OccurrenceDetails, useIsClient, type ViewName } from "@/components/calendar/shared";
import type { CalendarEventProps } from "@/lib/events/types";

/**
 * CONTRACT (owner: events builder). Read-only calendar fed by
 * GET /api/calendar?scope=club&clubId=…  |  scope=me  |  scope=all  |  scope=university
 * (JSON events built from EventOccurrence), optionally with the Events page's
 * filters (lib/events/browse-params filterSearchParams). Google-Calendar-like
 * month/week/list views; clicking an event opens its details. The Events
 * Builder has its own editable calendar.
 *
 * Times always show in campus time (America/Denver), wherever the viewer is.
 */
export type CalendarSource = { scope: "club"; clubId: string } | { scope: "me" } | { scope: "all" } | { scope: "university" } | { scope: "trainings" };

export type CalendarViewProps = {
  source: CalendarSource;
  /** The Events page's filters as a query string ("food=1&type=SOCIAL"). */
  filters?: string;
  /** Campus date to open on ("2026-10-24"). */
  initialDate?: string;
  initialView?: "dayGridMonth" | "timeGridWeek" | "listMonth";
  /** Smaller toolbar and list-first layout for sidebars and the club hero. */
  compact?: boolean;
  height?: number | "auto";
  className?: string;
  /** Optional message when the visible range has no events (list view). */
  emptyMessage?: string;
  /** Change this to make the calendar reload its events (e.g. after a subscription toggle). */
  refreshKey?: string | number;
};

function sourceQuery(s: CalendarSource) {
  return s.scope === "club" ? `scope=club&clubId=${encodeURIComponent(s.clubId)}` : `scope=${s.scope}`;
}

export function CalendarView({ source, filters, initialDate, initialView, compact, height = "auto", className, emptyMessage, refreshKey }: CalendarViewProps) {
  const isClient = useIsClient();
  const [api, setApi] = useState<CalendarApi | null>(null);
  // Stable callback ref: runs only on mount/unmount, so a remount hands us the new calendar.
  const calendarRef = useCallback((r: FullCalendar | null) => setApi(r ? r.getApi() : null), []);
  const [title, setTitle] = useState("");
  const [view, setView] = useState<ViewName>(initialView ?? (compact ? "listMonth" : "dayGridMonth"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ title: string; p: CalendarEventProps } | null>(null);

  const query = filters ? `${sourceQuery(source)}&${filters}` : sourceQuery(source);
  const events = useMemo(() => calendarSource(query, setError), [query]);
  const views: ViewName[] = compact ? ["listMonth", "dayGridMonth"] : ["dayGridMonth", "timeGridWeek", "listMonth"];
  const startView: ViewName = initialView ?? (compact || isNarrowScreen() ? "listMonth" : "dayGridMonth");

  useEffect(() => {
    if (refreshKey !== undefined) api?.refetchEvents();
  }, [refreshKey, api]);

  function onEventClick(arg: EventClickArg) {
    arg.jsEvent.preventDefault();
    setSelected({ title: arg.event.title, p: arg.event.extendedProps as CalendarEventProps });
  }

  return (
    <div className={cn("wc-calendar", className)}>
      {!isClient ? (
        <div aria-hidden className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className={compact ? "h-48 w-full" : "h-96 w-full"} />
        </div>
      ) : (
        <>
          <CalendarToolbar api={api} title={title} view={view} views={views} compact={compact} loading={loading} />
          {error ? (
            <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-danger-50 px-3 py-2 text-sm text-red-900">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{error}</span>
              <Button size="sm" variant="outline" onClick={() => api?.refetchEvents()}>
                <RotateCw className="h-3.5 w-3.5" /> Try again
              </Button>
            </div>
          ) : null}
          <div className={cn("relative rounded-xl border border-line bg-surface p-2 transition-opacity sm:p-3", loading && "opacity-70")} aria-busy={loading}>
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
              initialView={startView}
              initialDate={initialDate}
              headerToolbar={false}
              timeZone="UTC"
              now={campusNow}
              // Week view needs a fixed height so it can scroll to the evening; month and list grow to fit.
              height={view.startsWith("timeGrid") && height === "auto" ? 680 : height}
              events={events}
              eventClick={onEventClick}
              eventInteractive
              dayMaxEvents={compact ? 2 : 3}
              nowIndicator
              eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
              scrollTime="08:00:00"
              eventClassNames={(arg) => ((arg.event.extendedProps as CalendarEventProps).cancelled ? ["line-through", "opacity-60"] : [])}
              // Don't say "no events" while they're still on their way.
              noEventsContent={() => <p className="py-6 text-center text-sm text-ink-3">{loading ? "Loading events…" : (emptyMessage ?? "No events in this stretch. Try the next month.")}</p>}
              loading={setLoading}
              datesSet={(arg) => {
                setTitle(arg.view.title);
                setView(arg.view.type as ViewName);
              }}
            />
          </div>
        </>
      )}

      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        {selected ? (
          <DialogContent title="Event details">
            <OccurrenceDetails p={selected.p} title={selected.title} />
            <DialogFooter>
              {selected.p.canManage ? (
                <ButtonLink variant="outline" href={selected.p.clubSlug ? `/clubs/${selected.p.clubSlug}/manage/events/${selected.p.eventId}` : `/admin/trainings/${selected.p.eventId}`}>
                  Edit event
                </ButtonLink>
              ) : null}
              <ButtonLink href={`/events/${selected.p.eventId}?o=${selected.p.occurrenceId}`}>
                View event <ArrowRight className="h-4 w-4" />
              </ButtonLink>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
