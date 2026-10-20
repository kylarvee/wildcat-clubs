"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin, { type EventResizeDoneArg } from "@fullcalendar/interaction";
import type { CalendarApi, DateSelectArg, EventClickArg, EventDropArg } from "@fullcalendar/core";
import * as Popover from "@radix-ui/react-popover";
import type { EventKind, Visibility } from "@prisma/client";
import { AlertCircle, ArrowRight, Ban, CalendarPlus, ExternalLink, Loader2, Pencil, QrCode, RotateCcw, RotateCw, X } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";
import { CalendarToolbar, calendarSource, campusNow, isNarrowScreen, OccurrenceDetails, useIsClient, type ViewName } from "@/components/calendar/shared";
import { WhenFields } from "@/components/events/WhenFields";
import { LocationFields, EMPTY_LOCATION, type BuildingOption, type LocationValue } from "@/components/events/LocationFields";
import { CohostPanel, type IncomingCohost, type OutgoingCohost } from "@/components/events/BuilderPanels";
import { defaultWhen, toSchedule, whenFrom, type WhenValue } from "@/components/events/when";
import { EVENT_KINDS, KIND_LABEL, VISIBILITY_LABEL } from "@/lib/events/labels";
import { fromFakeUtc, fromInputs } from "@/lib/events/wallclock";
import { fmtDate, fmtTime } from "@/lib/time";
import type { CalendarEventProps, TermJson } from "@/lib/events/types";
import { cancelOccurrenceAction, createEventAction, moveEventAction, restoreOccurrenceAction, setOccurrenceRoomAction } from "@/app/events/actions";

export type { IncomingCohost, OutgoingCohost } from "@/components/events/BuilderPanels";

export type EventsBuilderProps = {
  /** "university" = admin trainings and university events (clubId null). */
  mode: "club" | "university";
  club: { id: string; slug: string; name: string } | null;
  /** The builder's own URL (editor pages live at `${basePath}/new` and `${basePath}/<id>`). */
  basePath: string;
  incoming: IncomingCohost[];
  outgoing: OutgoingCohost[];
  buildings: BuildingOption[];
  terms: TermJson[];
  googleLive: boolean;
  /** Campus date to open on ("2026-10-20"). */
  initialDate?: string;
};

type Selected = { title: string; p: CalendarEventProps };
type QuickState = { when: WhenValue; title: string; kind: EventKind; visibility: Visibility; location: LocationValue };

/**
 * The Events Builder: a Google-Calendar-like editable calendar plus the
 * co-host inbox. Select a time to quick-create, click a meeting for
 * details and actions, drag one-time events to reschedule. Club mode needs
 * the "events" capability; university mode (admin trainings) needs admin.trainings.
 */
export function EventsBuilder(props: EventsBuilderProps) {
  const { mode, club, basePath, incoming, outgoing, buildings, terms, googleLive } = props;
  const isClient = useIsClient();
  const isClub = mode === "club" && club !== null;
  const [api, setApi] = useState<CalendarApi | null>(null);
  // Stable callback ref: runs only on mount/unmount, so a remount hands us the new calendar.
  const calendarRef = useCallback((r: FullCalendar | null) => setApi(r ? r.getApi() : null), []);
  const [title, setTitle] = useState("");
  const [view, setView] = useState<ViewName>("dayGridMonth");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Selected | null>(null);
  const anchor = useRef<{ getBoundingClientRect: () => DOMRect }>({ getBoundingClientRect: () => new DOMRect() });
  const [quick, setQuick] = useState<QuickState | null>(null);

  const query = isClub ? `scope=club&clubId=${encodeURIComponent(club.id)}` : "scope=trainings";
  const events = useMemo(() => calendarSource(query, setError), [query]);
  const pendingCohosts = incoming.filter((c) => c.status === "PENDING").length;
  const refetch = () => api?.refetchEvents();

  /** The campus date the calendar is looking at (for "New event"). */
  function focusDate(): string {
    if (!api) return defaultWhen().date;
    const d = api.getDate();
    const today = campusNow();
    // In the current month, default to today rather than the 1st.
    const sameMonth = d.getUTCFullYear() === today.getUTCFullYear() && d.getUTCMonth() === today.getUTCMonth();
    return (sameMonth ? today : d).toISOString().slice(0, 10);
  }

  function openQuick(when: WhenValue) {
    setSelected(null);
    setQuick({ when, title: "", kind: isClub ? "MEETING" : "TRAINING", visibility: isClub ? "PUBLIC" : "UNIVERSITY", location: EMPTY_LOCATION });
  }

  function onSelect(arg: DateSelectArg) {
    arg.view.calendar.unselect();
    if (arg.allDay) {
      const date = arg.startStr.slice(0, 10);
      // The all-day row makes an all-day event; a month-view day starts as a typical evening meeting.
      openQuick(arg.view.type.startsWith("timeGrid") ? { ...defaultWhen(date), allDay: true } : defaultWhen(date));
    } else {
      const start = fromFakeUtc(arg.start);
      const minutes = Math.max(15, Math.round((arg.end.getTime() - arg.start.getTime()) / 60_000));
      openQuick(whenFrom(start, minutes));
    }
  }

  function onEventClick(arg: EventClickArg) {
    arg.jsEvent.preventDefault();
    const el = arg.el;
    anchor.current = { getBoundingClientRect: () => el.getBoundingClientRect() };
    setSelected({ title: arg.event.title, p: arg.event.extendedProps as CalendarEventProps });
  }

  async function onMove(arg: EventDropArg | EventResizeDoneArg) {
    const e = arg.event;
    const p = e.extendedProps as CalendarEventProps;
    if (!e.start) return arg.revert();
    const start = fromFakeUtc(e.start);
    const end = e.end ? fromFakeUtc(e.end) : null;
    const durationMinutes = e.allDay ? undefined : end ? Math.max(5, Math.round((end.getTime() - start.getTime()) / 60_000)) : 60;
    const res = await moveEventAction(p.eventId, { startsAt: start.toISOString(), durationMinutes, allDay: e.allDay });
    if (!res.ok) {
      arg.revert();
      toast.error(res.error);
      return;
    }
    toast.success(`Moved to ${fmtDate(start)}${e.allDay ? "" : ` at ${fmtTime(start)}`}`, {
      action: { label: "Undo", onClick: () => void moveEventAction(p.eventId, { startsAt: p.startsAt, durationMinutes: Math.round((Date.parse(p.endsAt) - Date.parse(p.startsAt)) / 60_000), allDay: p.allDay }).then(() => refetch()) },
    });
    refetch();
  }

  const views: ViewName[] = ["dayGridMonth", "timeGridWeek", "timeGridDay", "listMonth"];
  const narrow = isClient && isNarrowScreen();

  const toolbarExtras = (
    <div className="flex w-full flex-wrap gap-2 sm:w-auto">
      <Button size="sm" className="flex-1 sm:flex-none" onClick={() => openQuick(defaultWhen(focusDate()))}>
        <CalendarPlus className="h-4 w-4" /> New event
      </Button>
    </div>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      {/* The calendar comes first on phones; on wide screens the co-host panel sits on the left, like Google Calendar. */}
      <div className="order-1 min-w-0 xl:order-2">
        {!isClient ? (
          <div aria-hidden className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-[600px] w-full" />
          </div>
        ) : (
          <>
            <CalendarToolbar api={api} title={title} view={view} views={views} loading={loading}>
              {toolbarExtras}
            </CalendarToolbar>
            {error ? (
              <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-danger-50 px-3 py-2 text-sm text-red-900">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{error}</span>
                <Button size="sm" variant="outline" onClick={refetch}>
                  <RotateCw className="h-3.5 w-3.5" /> Try again
                </Button>
              </div>
            ) : null}
            <div className={cn("rounded-xl border border-line bg-surface p-2 transition-opacity sm:p-3", loading && "opacity-70")} aria-busy={loading}>
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
                initialView={narrow ? "listMonth" : "dayGridMonth"}
                initialDate={props.initialDate}
                headerToolbar={false}
                timeZone="UTC"
                now={campusNow}
                height={narrow ? "auto" : 720}
                events={events}
                selectable
                selectMirror
                editable
                eventInteractive
                select={onSelect}
                eventClick={onEventClick}
                eventDrop={(a) => void onMove(a)}
                eventResize={(a) => void onMove(a)}
                dayMaxEvents
                nowIndicator
                snapDuration="00:15:00"
                scrollTime="08:00:00"
                eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
                eventClassNames={(arg) => ((arg.event.extendedProps as CalendarEventProps).cancelled ? ["line-through", "opacity-60"] : [])}
                noEventsContent={() => <p className="py-6 text-center text-sm text-ink-3">Nothing scheduled here yet. Use “New event” or drag across the calendar.</p>}
                loading={setLoading}
                datesSet={(arg) => {
                  setTitle(arg.view.title);
                  setView(arg.view.type as ViewName);
                }}
              />
            </div>
            <p className="mt-2 text-xs text-ink-3">
              Tip: drag across the calendar to create an event. Drag a one-time event to move it. Times are Ogden campus time.
            </p>
          </>
        )}
      </div>

      {isClub ? (
        <aside id="builder-panel" aria-label="Co-host requests" className="order-2 min-w-0 scroll-mt-20 xl:order-1">
          <h2 className="mb-4 border-b border-line pb-2 text-sm font-semibold text-ink">
            Co-host requests {pendingCohosts ? <span className="ml-1 rounded-full bg-brand px-1.5 text-xs text-white">{pendingCohosts}</span> : null}
          </h2>
          <CohostPanel incoming={incoming} outgoing={outgoing} basePath={basePath} />
        </aside>
      ) : null}

      <Popover.Root open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <Popover.Anchor virtualRef={anchor} />
        <Popover.Portal>
          <Popover.Content
            side="right"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="z-50 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-pop)] focus:outline-none"
          >
            {selected ? (
              <OccurrenceActions
                selected={selected}
                basePath={basePath}
                onDone={() => {
                  setSelected(null);
                  refetch();
                }}
              />
            ) : null}
            <Popover.Close className="absolute right-3 top-3 rounded-md p-1 text-ink-3 hover:bg-muted hover:text-ink" aria-label="Close">
              <X className="h-4 w-4" />
            </Popover.Close>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <QuickCreateDialog
        state={quick}
        onChange={setQuick}
        club={club}
        basePath={basePath}
        buildings={buildings}
        terms={terms}
        googleLive={googleLive}
        onCreated={() => {
          setQuick(null);
          refetch();
        }}
      />
    </div>
  );
}

// ─── Occurrence popover ──────────────────────────────────────────────────────

function OccurrenceActions({ selected, basePath, onDone }: { selected: Selected; basePath: string; onDone: () => void }) {
  const { p, title } = selected;
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"view" | "cancel" | "room">("view");
  const [note, setNote] = useState("");
  const [room, setRoom] = useState("");
  const manage = p.canManage;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Something went wrong.");
      toast.success(done);
      onDone();
    });

  return (
    <div className="space-y-4 pr-6">
      <OccurrenceDetails p={p} title={title} />
      {!p.hostedHere ? <p className="text-xs text-ink-3">Your club co-hosts this event. Only {p.clubName} can change it.</p> : null}

      {manage && mode === "cancel" ? (
        <form
          className="space-y-2 rounded-xl border border-line bg-muted/50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => cancelOccurrenceAction(p.occurrenceId, note), "Meeting cancelled");
          }}
        >
          <Label htmlFor="occ-note">Reason (optional, shown on calendars)</Label>
          <Input id="occ-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. No meeting during finals week" autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMode("view")}>
              Keep it
            </Button>
            <Button variant="danger" size="sm" type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Cancel this meeting
            </Button>
          </div>
        </form>
      ) : null}

      {manage && mode === "room" ? (
        <form
          className="space-y-2 rounded-xl border border-line bg-muted/50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => setOccurrenceRoomAction(p.occurrenceId, room.trim() || null), room.trim() ? `Room set to ${room.trim()} for this date` : "Back to the usual room");
          }}
        >
          <Label htmlFor="occ-room">Room for this date only</Label>
          <Input id="occ-room" value={room} maxLength={60} onChange={(e) => setRoom(e.target.value)} placeholder="Leave empty for the usual room" autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMode("view")}>
              Back
            </Button>
            <Button size="sm" type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save room
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "view" ? (
        <div className="flex flex-wrap gap-2">
          {manage ? (
            <ButtonLink size="sm" href={`${basePath}/${p.eventId}`}>
              <Pencil className="h-4 w-4" /> Edit event
            </ButtonLink>
          ) : null}
          {manage && !p.cancelled ? (
            <Button size="sm" variant="outline" onClick={() => setMode("cancel")}>
              <Ban className="h-4 w-4" /> Cancel this meeting
            </Button>
          ) : null}
          {manage && p.cancelled ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => restoreOccurrenceAction(p.occurrenceId), "Meeting restored")}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Restore meeting
            </Button>
          ) : null}
          {manage && p.locationType === "CAMPUS" && !p.cancelled ? (
            <Button size="sm" variant="ghost" onClick={() => setMode("room")}>
              Change room
            </Button>
          ) : null}
          {manage && !p.cancelled ? (
            <ButtonLink size="sm" variant="ghost" href={`/checkin/live/${p.occurrenceId}`}>
              <QrCode className="h-4 w-4" /> Open check-in
            </ButtonLink>
          ) : null}
          <ButtonLink size="sm" variant="ghost" href={`/events/${p.eventId}?o=${p.occurrenceId}`}>
            <ExternalLink className="h-4 w-4" /> Event page
          </ButtonLink>
        </div>
      ) : null}
    </div>
  );
}

// ─── Quick create ────────────────────────────────────────────────────────────

function QuickCreateDialog({
  state,
  onChange,
  club,
  basePath,
  buildings,
  terms,
  googleLive,
  onCreated,
}: {
  state: QuickState | null;
  onChange: (s: QuickState | null) => void;
  club: { id: string } | null;
  basePath: string;
  buildings: BuildingOption[];
  terms: TermJson[];
  googleLive: boolean;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<QuickState>) => state && onChange({ ...state, ...patch });

  function moreOptions() {
    if (!state) return;
    const s = toSchedule(state.when);
    const q = new URLSearchParams();
    if (s.ok) {
      q.set("start", s.value.startsAt);
      q.set("end", new Date(Date.parse(s.value.startsAt) + s.value.durationMinutes * 60_000).toISOString());
      if (s.value.allDay) q.set("allDay", "1");
    }
    if (state.title.trim()) q.set("title", state.title.trim());
    router.push(`${basePath}/new?${q.toString()}`);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!state) return;
    setError(null);
    if (!state.title.trim()) return setError("Give the event a title.");
    const s = toSchedule(state.when);
    if (!s.ok) return setError(s.error);
    const l = state.location;
    if (l.locationType === "CAMPUS" && !l.buildingId) return setError("Pick the campus building, or choose another location type.");
    if (l.locationType === "ADDRESS" && !l.address.trim()) return setError("Add the address, or choose another location type.");
    if (l.locationType === "VIRTUAL" && !l.virtualUrl.trim() && !l.createMeetLink) return setError("Add the meeting link, or ask for a Google Meet link.");
    start(async () => {
      const res = await createEventAction({
        clubId: club?.id ?? null,
        title: state.title.trim(),
        kind: state.kind,
        visibility: state.visibility,
        ...s.value,
        locationType: l.locationType,
        buildingId: l.buildingId || null,
        room: l.room,
        address: l.address,
        // Quick create has no online-link field for in-person events (no hidden hybrid from an earlier tab).
        virtualUrl: l.locationType === "VIRTUAL" ? l.virtualUrl.trim() : "",
        createMeetLink: l.createMeetLink,
      });
      if (!res.ok) return setError(res.error);
      toast.success(`“${state.title.trim()}” is on the calendar`, { action: { label: "Edit details", onClick: () => router.push(`${basePath}/${res.data.id}`) } });
      if (res.data.google.status === "failed" && res.data.google.message) toast.warning(res.data.google.message);
      onCreated();
    });
  }

  return (
    <Dialog
      open={state !== null}
      onOpenChange={(o) => {
        if (!o) {
          onChange(null);
          setError(null);
        }
      }}
    >
      {state ? (
        <DialogContent title="New event" description="The basics now — add details, costs and co-hosts any time." wide>
          <form onSubmit={submit} className="space-y-5" noValidate>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="qc-title">
                  Title <span className="text-danger">*</span>
                </Label>
                <Input id="qc-title" autoFocus value={state.title} maxLength={140} placeholder="e.g. General meeting" onChange={(e) => set({ title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qc-kind">Type</Label>
                <Select id="qc-kind" value={state.kind} onChange={(e) => set({ kind: e.target.value as EventKind })}>
                  {EVENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <WhenFields compact value={state.when} onChange={(when) => set({ when })} terms={terms} />
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Where</p>
              <LocationFields compact value={state.location} onChange={(location) => set({ location })} buildings={buildings} googleLive={googleLive} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qc-vis">Who can see it</Label>
              <Select id="qc-vis" value={state.visibility} onChange={(e) => set({ visibility: e.target.value as Visibility })}>
                {(club ? (["PUBLIC", "UNIVERSITY", "MEMBERS"] as Visibility[]) : (["PUBLIC", "UNIVERSITY"] as Visibility[])).map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY_LABEL[v]}
                  </option>
                ))}
              </Select>
            </div>
            {error ? (
              <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
            <DialogFooter className="justify-between">
              <Button variant="link" onClick={moreOptions}>
                More options <ArrowRight className="h-4 w-4" />
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onChange(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
