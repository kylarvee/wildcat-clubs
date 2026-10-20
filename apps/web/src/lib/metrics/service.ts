import { termEnd, type TermLike } from "./pure";
import type { ServiceClub, ServiceClubTotal, ServiceEntry, ServiceSummary, ServiceTermTotal, ServiceTotal } from "./types";

/**
 * SERVICE HOURS — the rule, pure and client-safe (no database, no server
 * imports), so the involvement record, profiles, check-in confirmations,
 * analytics, the assistant and the app all count and say hours the same way.
 *
 * THE RULE: hours come only from attendance. Every check-in (QR scan, typed
 * code, one tap or added by a leader) at a date of an event whose
 * `serviceMinutes` is set earns that many minutes. Nothing is copied or
 * stored: totals are summed from the check-ins every time, so removing a
 * check-in takes its hours away and editing the event's hours changes every
 * attendee's total at once. Every check-in counts, including past dates of
 * an event cancelled later (they were held when people came), the same as
 * the attendance history.
 *
 * WHERE HOURS COUNT: an event's hours count for every club that put it on,
 * the host and each approved co-host, the way attendance and held events do;
 * university events have no club. So a person's hours by club can add up to
 * more than their total when they served at co-hosted events, and a club's
 * total (lib/metrics clubServiceTotals) is every check-in at events it hosted
 * or co-hosted. Totals by term always add up.
 *
 * TERMS: a date belongs to the term it falls in (term end dates cover the
 * whole day); dates between terms count toward the term just finished.
 */

/** Minutes one check-in earns at an event: its serviceMinutes when set (null or 0: the event doesn't count). */
export function earnedMinutes(serviceMinutes: number | null | undefined): number {
  return typeof serviceMinutes === "number" && Number.isFinite(serviceMinutes) && serviceMinutes > 0 ? Math.round(serviceMinutes) : 0;
}

/** Hours from minutes: 90 → 1.5. The Events Builder takes quarter hours, so this is exact. */
export function serviceHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/** "1.5", "12", "1,240.25" */
export function fmtServiceHours(minutes: number): string {
  return serviceHours(minutes).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** "1 service hour", "2.5 service hours", "0 service hours" */
export function serviceHoursLabel(minutes: number): string {
  return `${fmtServiceHours(minutes)} service ${serviceHours(minutes) === 1 ? "hour" : "hours"}`;
}

/** "1 service event", "12 service events" */
export function serviceEventsLabel(events: number): string {
  return `${events.toLocaleString("en-US")} service ${events === 1 ? "event" : "events"}`;
}

/** The one-line summary profiles show: "42.5 service hours · 12 service events". */
export function serviceLine(t: ServiceTotal): string {
  return `${serviceHoursLabel(t.minutes)} · ${serviceEventsLabel(t.events)}`;
}

function byStart<T extends TermLike>(terms: readonly T[]): T[] {
  return [...terms].sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime());
}

/**
 * The term a service date counts toward: the one it falls in, else the last
 * one that started before it (a winter-break project counts for fall); null
 * before the academic calendar starts. Pass terms in any order.
 */
export function serviceTermOf<T extends TermLike>(at: Date, terms: readonly T[]): T | null {
  const sorted = byStart(terms);
  const t = at.getTime();
  let last: T | null = null;
  for (const term of sorted) {
    if (term.startsOn.getTime() > t) break;
    last = term;
    if (t <= termEnd(term).getTime()) return term;
  }
  return last;
}

/** Facts per dated piece of service (a check-in, or an occurrence's check-ins), for adding up by term. */
export type DatedService = { startsAt: Date; minutes: number; events: number };

/** Totals per term, newest term first (dates before the calendar last, as term null). Adds up to the input. */
export function totalsByTerm(items: readonly DatedService[], terms: readonly TermLike[]): ServiceTermTotal[] {
  const sorted = byStart(terms);
  const order = new Map(sorted.map((t, i) => [t.name, i]));
  const out = new Map<string | null, ServiceTermTotal>();
  for (const it of items) {
    if (it.minutes <= 0) continue;
    const term = serviceTermOf(it.startsAt, sorted)?.name ?? null;
    const cur = out.get(term) ?? { term, minutes: 0, events: 0 };
    cur.minutes += it.minutes;
    cur.events += it.events;
    out.set(term, cur);
  }
  const rank = (term: string | null) => (term === null ? -1 : (order.get(term) ?? -1));
  return [...out.values()].sort((a, b) => rank(b.term) - rank(a.term));
}

/** A person's check-in at an event, before the rule decides what it earned. */
export type ServiceCheckin = Omit<ServiceEntry, "minutes" | "term"> & { serviceMinutes: number | null };

/**
 * A person's SERVICE HOURS from their check-ins (any of them: the ones at
 * events that don't count are left out here). Entries come newest first;
 * byTerm adds up to the total, and byClub counts a co-hosted event for each
 * club that put it on.
 */
export function summarizeService(checkins: readonly ServiceCheckin[], terms: readonly TermLike[]): ServiceSummary {
  const sorted = byStart(terms);
  const entries: ServiceEntry[] = [];
  for (const c of checkins) {
    const minutes = earnedMinutes(c.serviceMinutes);
    if (!minutes) continue;
    entries.push({
      attendanceId: c.attendanceId,
      occurrenceId: c.occurrenceId,
      eventId: c.eventId,
      title: c.title,
      startsAt: c.startsAt,
      minutes,
      club: c.club,
      cohosts: c.cohosts,
      term: serviceTermOf(c.startsAt, sorted)?.name ?? null,
    });
  }
  entries.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || (a.attendanceId < b.attendanceId ? -1 : a.attendanceId > b.attendanceId ? 1 : 0));

  const clubs = new Map<string, ServiceClubTotal>();
  for (const e of entries) {
    const credited: (ServiceClub | null)[] = e.club ? [e.club, ...e.cohosts.filter((c) => c.id !== e.club!.id)] : [null];
    for (const club of credited) {
      const key = club?.id ?? "";
      const cur = clubs.get(key) ?? { club, minutes: 0, events: 0 };
      cur.minutes += e.minutes;
      cur.events += 1;
      clubs.set(key, cur);
    }
  }
  const byClub = [...clubs.values()].sort((a, b) => b.minutes - a.minutes || b.events - a.events || clubName(a).localeCompare(clubName(b)));

  return {
    minutes: entries.reduce((n, e) => n + e.minutes, 0),
    events: entries.length,
    byClub,
    byTerm: totalsByTerm(entries.map((e) => ({ startsAt: e.startsAt, minutes: e.minutes, events: 1 })), sorted),
    entries,
  };
}

const clubName = (t: ServiceClubTotal) => t.club?.name ?? "";
