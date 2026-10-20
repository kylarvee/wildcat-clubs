import "server-only";
import { after } from "next/server";
import type { Prisma, Visibility } from "@prisma/client";
import { db } from "@/lib/db";
import { clubCapabilityHolders } from "@/lib/authz/people";
import { notifyInBatches } from "@/lib/domain/notify";
import { INSTITUTION } from "@/lib/institution";
import {
  cancelledNotice,
  editNotice,
  eventAudience,
  placeOf,
  restoredNotice,
  roomNotice,
  type EventNotice,
  type NoticeDate,
  type NoticeEvent,
  type RepeatRule,
  type Snapshot,
} from "@/lib/events/notices";

/**
 * Event-change notices for the Events Builder's write path (lib/domain/events):
 * capture the event before a change, work out the one notice it deserves
 * (lib/events/notices: dates in the next 14 days only, one summary per series),
 * and send it to the event's followers after the response, in batches, so a
 * club with a thousand followers doesn't slow the save. Co-host leaders keep
 * their own notice (events.tellCohostsAboutChange); when they got one for the
 * same change, this one leaves them out. Nothing here can fail the write.
 */

const EVENT_SELECT = {
  id: true,
  title: true,
  status: true,
  clubId: true,
  visibility: true,
  recurrence: true,
  recurrenceInterval: true,
  recurrenceWeekdays: true,
  locationType: true,
  room: true,
  address: true,
  virtualUrl: true,
  building: { select: { name: true, code: true } },
  club: { select: { name: true, slug: true } },
  cohosts: { where: { status: "APPROVED" }, select: { clubId: true } },
} satisfies Prisma.EventSelect;

const DATE_SELECT = { id: true, startsAt: true, endsAt: true, roomOverride: true } satisfies Prisma.EventOccurrenceSelect;

type EventRow = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;
type DateRow = Prisma.EventOccurrenceGetPayload<{ select: typeof DATE_SELECT }>;

/** Who made the change, and the moment "upcoming" is measured from (the same before and after a save). */
export type NoticeContext = { actorId: string; now: Date };

const noticeEvent = (e: EventRow): NoticeEvent => ({ title: e.title, host: e.club?.name ?? INSTITUTION.studentGovernment });
const repeatOf = (e: EventRow): RepeatRule | null => (e.recurrence === "NONE" ? null : { recurrence: e.recurrence, interval: e.recurrenceInterval, weekdays: e.recurrenceWeekdays });
const toDate = (e: EventRow, o: DateRow): NoticeDate => ({ id: o.id, startsAt: o.startsAt, endsAt: o.endsAt, place: placeOf(e, o.roomOverride) });

function loadEvent(eventId: string) {
  return db.event.findUnique({ where: { id: eventId }, select: EVENT_SELECT });
}

/** An event's upcoming scheduled dates (from `now`), optionally narrowed. */
function upcomingDates(eventId: string, now: Date, where: Prisma.EventOccurrenceWhereInput = {}) {
  return db.eventOccurrence.findMany({ where: { ...where, eventId, status: "SCHEDULED", startsAt: { gte: now } }, select: DATE_SELECT, orderBy: { startsAt: "asc" } });
}

async function snapshotOf(e: EventRow, now: Date): Promise<Snapshot> {
  return { dates: (await upcomingDates(e.id, now)).map((o) => toDate(e, o)), repeat: repeatOf(e), place: placeOf(e) };
}

/** The event as people expect it, taken before a save to compare with after. Null when it's cancelled (nobody expects it). */
export async function snapshotEvent(eventId: string, now: Date): Promise<Snapshot | null> {
  try {
    const e = await loadEvent(eventId);
    return e && e.status === "SCHEDULED" ? await snapshotOf(e, now) : null;
  } catch (err) {
    console.error("[event notices] couldn't read the event before the change", err);
    return null;
  }
}

/** A save in the Events Builder (editor or drag): one notice when it moved or re-placed a date in the next 14 days. */
export async function noticeEdit(eventId: string, before: Snapshot | null, ctx: NoticeContext & { cohostsTold: boolean }) {
  if (!before) return;
  await guard(async () => {
    const e = await loadEvent(eventId);
    if (!e || e.status !== "SCHEDULED") return;
    send(e, editNotice(noticeEvent(e), before, await snapshotOf(e, ctx.now), ctx.now), ctx);
  });
}

/** The dates cancelEvent is about to take off the calendar (read them before, they're cancelled after). */
export function datesToCancel(eventId: string, now: Date): Promise<DateRow[]> {
  return upcomingDates(eventId, now, { attendances: { none: {} } }).catch((err) => {
    console.error("[event notices] couldn't read the dates being cancelled", err);
    return [];
  });
}

/** The whole event was cancelled: `dates` are the upcoming ones it took off the calendar. */
export async function noticeEventCancelled(eventId: string, dates: DateRow[], note: string | null, ctx: NoticeContext & { cohostsTold: boolean }) {
  await guard(async () => {
    const e = await loadEvent(eventId);
    if (!e) return;
    send(e, cancelledNotice(noticeEvent(e), { dates: dates.map((o) => toDate(e, o)), repeat: repeatOf(e), whole: true, note, now: ctx.now }), ctx);
  });
}

/** One date was cancelled; the rest of the schedule stays. */
export async function noticeDateCancelled(occurrenceId: string, note: string | null, ctx: NoticeContext) {
  await guard(async () => {
    const o = await db.eventOccurrence.findUnique({ where: { id: occurrenceId }, select: { ...DATE_SELECT, eventId: true } });
    const e = o ? await loadEvent(o.eventId) : null;
    if (!o || !e || e.status !== "SCHEDULED") return;
    const remaining = await db.eventOccurrence.count({ where: { eventId: e.id, status: "SCHEDULED", startsAt: { gte: ctx.now } } });
    send(e, cancelledNotice(noticeEvent(e), { dates: [toDate(e, o)], repeat: repeatOf(e), whole: false, remaining, note, now: ctx.now }), ctx);
  });
}

/** Cancelled dates are back on: every upcoming one (`whole`, restoreEvent) or one date (restoreOccurrence). */
export async function noticeRestored(eventId: string, occurrenceIds: string[], whole: boolean, ctx: NoticeContext) {
  if (!occurrenceIds.length) return;
  await guard(async () => {
    const e = await loadEvent(eventId);
    if (!e || e.status !== "SCHEDULED") return;
    const dates = await upcomingDates(eventId, ctx.now, { id: { in: occurrenceIds } });
    send(e, restoredNotice(noticeEvent(e), { dates: dates.map((o) => toDate(e, o)), repeat: repeatOf(e), whole, now: ctx.now }), ctx);
  });
}

/** One date's room changed; `before` is the room it had of its own before (null = the usual room). */
export async function noticeRoom(occurrenceId: string, before: string | null, ctx: NoticeContext) {
  await guard(async () => {
    const o = await db.eventOccurrence.findUnique({ where: { id: occurrenceId }, select: { ...DATE_SELECT, eventId: true, status: true } });
    const e = o ? await loadEvent(o.eventId) : null;
    if (!o || !e || o.status !== "SCHEDULED" || e.status !== "SCHEDULED") return;
    send(e, roomNotice(noticeEvent(e), { date: toDate(e, o), before: placeOf(e, before), usual: placeOf(e), now: ctx.now }), ctx);
  });
}

export type DeletedEvent = { e: EventRow; dates: DateRow[] } | null;

/** Read before deleting an event: afterwards its row, dates and co-hosts are gone. */
export async function beforeDelete(eventId: string, now: Date): Promise<DeletedEvent> {
  try {
    const e = await loadEvent(eventId);
    return e && e.status === "SCHEDULED" ? { e, dates: await upcomingDates(eventId, now) } : null;
  } catch (err) {
    console.error("[event notices] couldn't read the event before deleting it", err);
    return null;
  }
}

/** A deleted event's followers hear it's off, like a cancellation (the link goes to the club, since the event page is gone). */
export async function noticeDeleted(d: DeletedEvent, ctx: NoticeContext) {
  if (!d) return;
  await guard(async () => {
    const notice = cancelledNotice(noticeEvent(d.e), { dates: d.dates.map((o) => toDate(d.e, o)), repeat: repeatOf(d.e), whole: true, deleted: true, now: ctx.now });
    send(d.e, notice, ctx, d.e.club ? `/clubs/${d.e.club.slug}` : "/events");
  });
}

// ─── Who hears it ────────────────────────────────────────────────────────────

/**
 * Everyone an event's news reaches, before exclusions (lib/events/notices
 * eventAudience applies the members-only rule and the exclusions): followers
 * of the host's and approved co-hosts' calendars, plus those clubs' members and
 * leaders for a members-only event; for a university training, the people
 * whose open WSUSA requirement asks them to attend. Never deactivated
 * accounts. `reminders`: only people with "Remind me before events" on.
 */
export async function eventFollowers(
  e: { id: string; clubId: string | null; visibility: Visibility; cohostClubIds: string[] },
  opts: { reminders?: boolean } = {},
): Promise<{ followerIds: string[]; memberIds: string[] }> {
  const person: Prisma.UserWhereInput = { status: { not: "DEACTIVATED" }, ...(opts.reminders ? { eventReminders: true } : {}) };
  if (!e.clubId) {
    const reqs = await db.roleRequirement.findMany({ where: { active: true, kind: "TRAINING", trainingEventId: e.id }, select: { id: true } });
    if (!reqs.length) return { followerIds: [], memberIds: [] };
    const tasks = await db.task.findMany({
      where: { sourceType: "requirement", status: "OPEN", OR: reqs.map((r) => ({ sourceId: { startsWith: `${r.id}:` } })), assignee: person },
      select: { assigneeId: true },
    });
    return { followerIds: tasks.map((t) => t.assigneeId).filter((id): id is string => Boolean(id)), memberIds: [] };
  }
  const clubIds = [...new Set([e.clubId, ...e.cohostClubIds])];
  const [follows, members] = await Promise.all([
    db.calendarSubscription.findMany({ where: { clubId: { in: clubIds }, user: person }, select: { userId: true } }),
    e.visibility === "MEMBERS" ? memberIdsOf(clubIds) : Promise.resolve<string[]>([]),
  ]);
  return { followerIds: follows.map((f) => f.userId), memberIds: members };
}

/** Members and current role holders of these clubs (who may see their members-only events, lib/authz/events). */
async function memberIdsOf(clubIds: string[]): Promise<string[]> {
  const [m, r] = await Promise.all([
    db.membership.findMany({ where: { clubId: { in: clubIds }, status: "ACTIVE" }, select: { userId: true } }),
    db.roleAssignment.findMany({ where: { clubId: { in: clubIds }, endedAt: null }, select: { userId: true } }),
  ]);
  return [...new Set([...m, ...r].map((x) => x.userId))];
}

// ─── Sending ─────────────────────────────────────────────────────────────────

/** Fans a notice out after the response, in batches of 100 (notifyInBatches). */
function send(e: EventRow, notice: EventNotice | null, ctx: NoticeContext & { cohostsTold?: boolean }, href?: string) {
  if (!notice) return;
  later(async () => {
    const { followerIds, memberIds } = await eventFollowers({ id: e.id, clubId: e.clubId, visibility: e.visibility, cohostClubIds: e.cohosts.map((c) => c.clubId) });
    // Co-host leaders already heard about this change from their own notice.
    const told = ctx.cohostsTold ? (await Promise.all(e.cohosts.map((c) => clubCapabilityHolders(c.clubId, "events")))).flat() : [];
    const userIds = eventAudience({ visibility: e.visibility, followerIds, memberIds, excludeIds: [ctx.actorId, ...told] });
    await notifyInBatches({ userIds, kind: notice.kind, title: notice.title, body: notice.body, href: href ?? `/events/${e.id}?o=${notice.occurrenceId}`, email: notice.email });
  });
}

function later(run: () => Promise<void>) {
  const safe = () => run().catch((err) => console.error("[event notices] sending failed", err));
  try {
    after(safe);
  } catch {
    // Outside a request (scripts, tests): send now, without holding up the caller.
    void safe();
  }
}

async function guard(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error("[event notices] couldn't work out the notice", err);
  }
}
