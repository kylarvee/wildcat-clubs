import type { Recurrence, Term } from "@prisma/client";
import { expandOccurrences, type OccurrenceTimes } from "@/lib/events/recurrence";
import { addDaysToDateInput, campusParts, fromInputs, toDateInput, toTimeInput } from "@/lib/events/wallclock";
import type { TermJson } from "@/lib/events/types";

/**
 * The "When" form model shared by quick-create, the idea scheduler and the full
 * editor: campus date/time inputs plus a repeat rule, converted to the domain's
 * schedule input (real instants + duration).
 */

export type WhenValue = {
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  recurrence: Recurrence;
  interval: number;
  weekdays: number[];
  ends: "never" | "on" | "after";
  until: string;
  count: number;
};

export type ScheduleOut = {
  startsAt: string;
  durationMinutes: number;
  allDay: boolean;
  recurrence: Recurrence;
  recurrenceInterval: number;
  recurrenceWeekdays: number[];
  recurrenceUntil: string | null;
  recurrenceCount: number | null;
};

/** A new When starting at `start` (campus), lasting `minutes`. */
export function whenFrom(start: Date, minutes = 60, allDay = false): WhenValue {
  const end = new Date(start.getTime() + minutes * 60_000);
  return {
    date: toDateInput(start),
    startTime: toTimeInput(start),
    endDate: toDateInput(end),
    endTime: toTimeInput(end),
    allDay,
    recurrence: "NONE",
    interval: 1,
    weekdays: [],
    ends: "never",
    until: "",
    count: 10,
  };
}

/** Today (or `day`) at 6 PM campus time, an hour long — the usual club meeting. */
export function defaultWhen(day?: string): WhenValue {
  const d = day ?? toDateInput(new Date());
  return whenFrom(fromInputs(d, "18:00")!, 60);
}

export function whenFromEvent(e: {
  startsAt: string | Date;
  durationMinutes: number;
  allDay: boolean;
  recurrence: Recurrence;
  recurrenceInterval: number;
  recurrenceWeekdays: number[];
  recurrenceUntil: string | Date | null;
  recurrenceCount: number | null;
}): WhenValue {
  const w = whenFrom(new Date(e.startsAt), e.allDay ? 60 : e.durationMinutes, e.allDay);
  return {
    ...w,
    recurrence: e.recurrence,
    interval: e.recurrenceInterval || 1,
    weekdays: e.recurrenceWeekdays ?? [],
    ends: e.recurrenceUntil ? "on" : e.recurrenceCount ? "after" : "never",
    until: e.recurrenceUntil ? toDateInput(new Date(e.recurrenceUntil)) : "",
    count: e.recurrenceCount ?? 10,
  };
}

export function toSchedule(w: WhenValue): { ok: true; value: ScheduleOut } | { ok: false; error: string } {
  const start = fromInputs(w.date, w.allDay ? "00:00" : w.startTime);
  if (!start) return { ok: false, error: "Pick a start date and time." };
  let duration = 24 * 60;
  if (!w.allDay) {
    let end = fromInputs(w.endDate || w.date, w.endTime);
    if (!end) return { ok: false, error: "Pick an end time." };
    // "7 PM – 1 AM" on one date means it runs past midnight.
    if (end <= start && (w.endDate || w.date) === w.date) end = fromInputs(addDaysToDateInput(w.date, 1), w.endTime)!;
    duration = Math.round((end.getTime() - start.getTime()) / 60_000);
    if (duration < 5) return { ok: false, error: "The event needs to end after it starts." };
    if (duration > 14 * 24 * 60) return { ok: false, error: "Events can last up to two weeks. For longer, make it repeat." };
  }
  const repeating = w.recurrence !== "NONE";
  let until: string | null = null;
  if (repeating && w.ends === "on") {
    const u = fromInputs(w.until, "23:59");
    if (!u) return { ok: false, error: "Pick the date the event stops repeating." };
    if (u < start) return { ok: false, error: "The repeat end date needs to be after the first meeting." };
    until = u.toISOString();
  }
  if (repeating && w.ends === "after" && (!Number.isInteger(w.count) || w.count < 1 || w.count > 400)) return { ok: false, error: "Repeat between 1 and 400 times." };
  if (repeating && (!Number.isInteger(w.interval) || w.interval < 1 || w.interval > 52)) return { ok: false, error: "Pick how often it repeats (1–52)." };
  return {
    ok: true,
    value: {
      startsAt: start.toISOString(),
      durationMinutes: duration,
      allDay: w.allDay,
      recurrence: w.recurrence,
      recurrenceInterval: repeating ? w.interval : 1,
      recurrenceWeekdays: w.recurrence === "WEEKLY" ? (w.weekdays.length ? w.weekdays : [campusParts(start).dow]) : [],
      recurrenceUntil: until,
      recurrenceCount: repeating && w.ends === "after" ? w.count : null,
    },
  };
}

export function termsFromJson(terms: TermJson[]): Term[] {
  return terms.map((t) => ({ ...t, startsOn: new Date(t.startsOn), endsOn: new Date(t.endsOn) }));
}

/** The meetings a rule would create (client preview; the server is the authority). */
export function previewOccurrences(w: WhenValue, terms: Term[]): OccurrenceTimes[] {
  const s = toSchedule(w);
  if (!s.ok) return [];
  const v = s.value;
  return expandOccurrences(
    {
      startsAt: new Date(v.startsAt),
      durationMinutes: v.durationMinutes,
      allDay: v.allDay,
      recurrence: v.recurrence,
      interval: v.recurrenceInterval,
      weekdays: v.recurrenceWeekdays,
      until: v.recurrenceUntil ? new Date(v.recurrenceUntil) : null,
      count: v.recurrenceCount,
    },
    terms,
  );
}
