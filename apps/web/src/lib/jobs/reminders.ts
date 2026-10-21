import "server-only";
import { db } from "@/lib/db";
import { tasksAwaitingGrade } from "@/lib/authz/requirements";
import { eventFollowers } from "@/lib/domain/event-notices";
import { notifyEach, notifyInBatches } from "@/lib/domain/notify";
import { eventAudience, placeOf } from "@/lib/events/notices";
import { UNDER_REVIEW } from "@/lib/events/review";
import { dueSoonNotice, dueStage, PRUNED_KEY_PREFIXES, pruneBefore, reminderKeys, startingSoonNotice, startingSoonWindow } from "@/lib/jobs/reminder-rules";

/**
 * The "Reminders" scheduled job (lib/jobs/tick), every ~15 minutes:
 *
 *  - Events starting soon: dates starting 45–75 minutes from now. Club events
 *    remind the followers of the host's and approved co-hosts' calendars (a
 *    members-only event: their members and leaders) who keep "Remind me before
 *    events" on and haven't checked in yet. University trainings remind only
 *    the people whose open WSUSA requirement asks them to attend. In-app and
 *    push, never email. Events still waiting for their office's review
 *    (lib/events/review) aren't posted, so they remind nobody.
 *  - Requirements due: each open required task a week and a day before it's
 *    due (reminder-rules dueStage), in-app, by email and push. A test handed in
 *    on time that's waiting for grading is left alone. They go out together
 *    (notifyEach), so a requirement every member owes queues its emails for
 *    the "Send queued messages" job instead of sending hundreds at once.
 *
 * Every reminder claims its ReminderLog key before it's sent, so a run that
 * repeats or overlaps another sends nothing twice. Keys older than 30 days are
 * pruned (only this job's; see PRUNED_KEY_PREFIXES).
 */

export type ReminderRun = { events: number; eventPeople: number; dueTasks: number; pruned: number };

export async function sendReminders(now: Date = new Date()): Promise<ReminderRun> {
  const pruned = await pruneReminderKeys(now);
  const soon = await remindEventsStartingSoon(now);
  const dueTasks = await remindRequirementsDue(now);
  return { events: soon.events, eventPeople: soon.people, dueTasks, pruned };
}

/** True when this run is the one that sends it (nobody claimed the key yet). */
async function claim(key: string, now: Date): Promise<boolean> {
  const r = await db.reminderLog.createMany({ data: [{ key, sentAt: now }], skipDuplicates: true });
  return r.count === 1;
}

async function pruneReminderKeys(now: Date): Promise<number> {
  const r = await db.reminderLog.deleteMany({ where: { sentAt: { lt: pruneBefore(now) }, OR: PRUNED_KEY_PREFIXES.map((p) => ({ key: { startsWith: p } })) } });
  return r.count;
}

// ─── Events starting soon ────────────────────────────────────────────────────

async function remindEventsStartingSoon(now: Date): Promise<{ events: number; people: number }> {
  const { from, to } = startingSoonWindow(now);
  const dates = await db.eventOccurrence.findMany({
    where: {
      status: "SCHEDULED",
      startsAt: { gte: from, lte: to },
      // All-day events have no start time to remind about; unapproved clubs' events and events under review are hidden.
      event: { status: "SCHEDULED", allDay: false, reviewStatus: { notIn: [...UNDER_REVIEW] }, OR: [{ clubId: null }, { club: { status: "APPROVED" } }] },
    },
    select: {
      id: true,
      startsAt: true,
      roomOverride: true,
      event: {
        select: {
          id: true,
          title: true,
          clubId: true,
          visibility: true,
          locationType: true,
          room: true,
          address: true,
          virtualUrl: true,
          building: { select: { name: true, code: true } },
          club: { select: { name: true } },
          cohosts: { where: { status: "APPROVED" }, select: { clubId: true } },
        },
      },
    },
    orderBy: { startsAt: "asc" },
  });

  let events = 0;
  let people = 0;
  for (const o of dates) {
    if (!(await claim(reminderKeys.startingSoon(o.id, o.startsAt), now))) continue;
    const e = o.event;
    const [{ followerIds, memberIds }, checkedIn] = await Promise.all([
      eventFollowers({ id: e.id, clubId: e.clubId, visibility: e.visibility, cohostClubIds: e.cohosts.map((c) => c.clubId) }, { reminders: true }),
      db.attendance.findMany({ where: { occurrenceId: o.id }, select: { userId: true } }),
    ]);
    const userIds = eventAudience({ visibility: e.visibility, followerIds, memberIds, excludeIds: checkedIn.map((a) => a.userId) });
    if (!userIds.length) continue;
    const copy = startingSoonNotice({ title: e.title, startsAt: o.startsAt, place: placeOf(e, o.roomOverride).text, host: e.club?.name ?? null, required: !e.clubId });
    await notifyInBatches({ userIds, kind: "event.starting_soon", title: copy.title, body: copy.body, href: `/events/${e.id}?o=${o.id}` });
    events++;
    people += userIds.length;
  }
  return { events, people };
}

// ─── Requirements due ────────────────────────────────────────────────────────

async function remindRequirementsDue(now: Date): Promise<number> {
  const tasks = await db.task.findMany({
    where: {
      status: "OPEN",
      required: true,
      assigneeType: "USER",
      assigneeId: { not: null },
      dueAt: { gt: now, lte: new Date(now.getTime() + 7 * 86_400_000) },
      assignee: { status: "ACTIVE" },
    },
    select: { id: true, status: true, sourceType: true, sourceId: true, assigneeId: true, title: true, href: true, dueAt: true, createdAt: true, club: { select: { name: true } } },
    orderBy: { dueAt: "asc" },
  });
  const waiting = await tasksAwaitingGrade(tasks, now);
  const notices: { userIds: string[]; title: string; body: string; href: string }[] = [];
  for (const t of tasks) {
    if (!t.dueAt || !t.assigneeId || waiting.has(t.id)) continue;
    const stage = dueStage({ dueAt: t.dueAt, createdAt: t.createdAt }, now);
    if (!stage || !(await claim(reminderKeys.due(t.id, stage, t.dueAt), now))) continue;
    // A leader's requirement names the club whose permissions pause if it's late (lib/domain/requirements).
    const gatesClub = t.sourceType === "requirement" ? (t.club?.name ?? null) : null;
    const copy = dueSoonNotice({ title: t.title, dueAt: t.dueAt, gatesClub }, now);
    notices.push({ userIds: [t.assigneeId], title: copy.title, body: copy.body, href: t.href ?? "/tasks" });
  }
  await notifyEach({ kind: "requirement.due_soon", notices });
  return notices.length;
}
