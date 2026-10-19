import type { Prisma, PrismaClient } from "@prisma/client";
import { loadRenewalStates, type ClubRenewalState } from "@/lib/renewals/facts";
import {
  RENEWAL_SOURCE,
  RENEWAL_TASK_DESCRIPTION,
  renewalDueNotice,
  renewalHref,
  renewalSourceId,
  renewalTaskTitle,
  renewalTerm,
  renewalWindow,
  renewedNotice,
  snapshotChecks,
  type RenewalWindow,
} from "@/lib/renewals/rules";
import type { Ctx } from "../ctx";
import { addDays, addHours, addMin, atLocal, DAY, maxDate, minDate } from "../lib/dates";
import { createRng } from "../lib/rng";

/**
 * This academic year's club renewals (lib/renewals), written after insertAll
 * because the checks are read from the database by the same loader the
 * platform uses (lib/renewals/facts), so a seeded renewal's snapshot is
 * exactly what the club would have seen.
 *
 * About 60% of the active clubs re-registered inside the window (more in the
 * first week and the last few days). Every other club that's asked to renew
 * has one open required task per current President and advisor, as the
 * "Club renewals" job opens them; renewed clubs' tasks are done. Story clubs:
 *   - RC Wrecker Bots Club (Priya) hasn't renewed. Every required check
 *     passes and one recommended check is amber (its VP stepped down), so her
 *     card's Renew button works.
 *   - SWE renewed in mid-September; Vanessa did it as VP.
 *   - Clubs whose advisor's term ended (Microbiology Club, for one) can't
 *     renew: the advisor check blocks them.
 * Dormant clubs with nobody in the President's or advisor's seat get no task;
 * WSUSA sees them on the Renewals tab.
 */

/** lib/config's default for renewal.dueDays (the seed clears SystemConfig, so the default applies). */
const DUE_DAYS = 30;
const RENEWED_SHARE = 0.6;
const NOTES = [
  "Same meeting time and room as last year.",
  "New officers took over in August, and the org chart is up to date.",
  "We'll add spring events once rooms are booked.",
  "Planning more co-hosted events with other clubs this year.",
];

type Seat = { clubId: string; userId: string; role: "PRESIDENT" | "VP" | "ADVISOR"; startedAt: Date };

export async function buildRenewals(db: PrismaClient, ctx: Ctx, log: (s: string) => void) {
  const { NOW } = ctx;
  const rng = createRng(20261019);
  const terms = await db.term.findMany({ orderBy: { startsOn: "asc" } });
  const window = renewalWindow(terms, NOW, DUE_DAYS);
  if (!window) return log("Renewals: no academic year on the calendar, skipped.");
  const states = await loadRenewalStates(db, { window, term: renewalTerm(terms, NOW), now: NOW });
  const asked = states.filter((s) => !s.exemption);
  const seats = (await db.roleAssignment.findMany({
    where: { clubId: { in: asked.map((s) => s.club.id) }, endedAt: null, role: { in: ["PRESIDENT", "VP", "ADVISOR"] }, user: { status: { not: "DEACTIVATED" } } },
    select: { clubId: true, userId: true, role: true, startedAt: true },
  })) as Seat[];
  const seatsOf = (clubId: string) => seats.filter((s) => s.clubId === clubId);

  // Renewals happen between the window opening and the due date (or now, if that's sooner).
  const from = addHours(window.opensAt, 8);
  const until = minDate(window.dueAt, addHours(NOW, -2));
  const robotics = ctx.club("robotics").id;
  const swe = ctx.club("swe").id;
  const vanessa = ctx.p("vanessa").id;
  const life = (s: ClubRenewalState) => ctx.clubById.get(s.club.id)?.def.life;
  const active = asked.filter((s) => life(s) === "active" || life(s) === "pilot");
  const target = Math.round(active.length * RENEWED_SHARE);
  const ready = active.filter((s) => !s.blocking.length && s.club.id !== robotics);
  const picks = until > from ? [...ready.filter((s) => s.club.id === swe), ...rng.shuffle(ready.filter((s) => s.club.id !== swe))].slice(0, target) : [];

  const renewals: Prisma.ClubRenewalCreateManyInput[] = [];
  const renewedAt = new Map<string, { at: Date; by: string }>();
  for (const s of picks) {
    const pick = s.club.id === swe ? { userId: vanessa, at: atLocal(addDays(window.opensAt, 13), 19, 40) } : renewer(s, seatsOf(s.club.id), window, from, until, rng);
    if (!pick) continue;
    const at = minDate(maxDate(pick.at, from), until);
    renewedAt.set(s.club.id, { at, by: pick.userId });
    renewals.push({
      id: ctx.id(),
      clubId: s.club.id,
      academicYear: window.year,
      submittedById: pick.userId,
      submittedAt: at,
      checks: snapshotChecks(s.checks) as unknown as Prisma.InputJsonValue,
      note: s.club.id !== swe && rng.chance(0.15) ? rng.pick(NOTES) : null,
    });
  }

  // One task per current President and advisor, as the "Club renewals" job opens them; closed when the club renewed.
  const tasks: Prisma.TaskCreateManyInput[] = [];
  const bells: Prisma.NotificationCreateManyInput[] = [];
  const activity: Prisma.ActivityLogCreateManyInput[] = [];
  const priya = ctx.p("priya").id;
  for (const s of asked) {
    const done = renewedAt.get(s.club.id);
    for (const seat of seatsOf(s.club.id).filter((x) => x.role !== "VP")) {
      const opened = addMin(maxDate(window.opensAt, seat.startedAt), rng.int(2, 14));
      if (done && opened >= done.at) continue; // took the seat after the club renewed: the job never asked them
      tasks.push({
        id: ctx.id(), kind: "REQUIREMENT", title: renewalTaskTitle(s.club.name, window.year), description: RENEWAL_TASK_DESCRIPTION, assigneeType: "USER", assigneeId: seat.userId,
        clubId: s.club.id, href: renewalHref(s.club.slug), dueAt: window.dueAt, required: true, sourceType: RENEWAL_SOURCE, sourceId: renewalSourceId(s.club.id, window.year),
        createdAt: opened, status: done ? "DONE" : "OPEN", completedAt: done?.at ?? null, completedById: done?.by ?? null,
      });
      const unread = seat.userId === priya || (!done && rng.chance(0.4));
      bells.push({
        id: ctx.id(), userId: seat.userId, kind: "club.renewal_due", ...renewalDueNotice(s.club.name, window, opened > window.dueAt), href: renewalHref(s.club.slug),
        createdAt: opened, readAt: unread ? null : minDate(addHours(opened, rng.float(2, 60)), done?.at ?? NOW, NOW),
      });
      if (done && seat.userId !== done.by) {
        bells.push({
          id: ctx.id(), userId: seat.userId, kind: "club.renewed", ...renewedNotice(s.club.name, window.year, ctx.person(done.by).name), href: `/clubs/${s.club.slug}/manage`,
          createdAt: done.at, readAt: rng.chance(0.7) ? minDate(addHours(done.at, rng.float(1, 48)), NOW) : null,
        });
      }
    }
    if (done) activity.push({ at: done.at, actorId: done.by, action: "club.renewed", entityType: "club", entityId: s.club.id, clubId: s.club.id, data: { year: window.year }, isPublic: true });
  }

  await db.clubRenewal.createMany({ data: renewals });
  await db.task.createMany({ data: tasks });
  await db.notification.createMany({ data: bells });
  await db.activityLog.createMany({ data: activity.sort((a, b) => (a.at as Date).getTime() - (b.at as Date).getTime()) });
  const open = tasks.filter((t) => t.status === "OPEN").length;
  log(`Renewals ${window.year}: ${renewals.length} of ${active.length} active clubs re-registered (${asked.length} clubs asked); ${open} open renewal tasks.`);
}

/** Who renewed, and when: usually the President, sometimes a VP or the advisor, at an evening-ish campus hour inside the window. */
function renewer(s: ClubRenewalState, seats: Seat[], window: RenewalWindow, from: Date, until: Date, rng: ReturnType<typeof createRng>): { userId: string; at: Date } | null {
  const span = Math.max(0, Math.floor((until.getTime() - window.opensAt.getTime()) / DAY));
  const u = rng.next();
  // The first week and the last few days before it's due are busiest.
  const day = u < 0.35 ? rng.int(0, Math.min(6, span)) : u < 0.8 ? rng.int(Math.min(7, span), Math.max(Math.min(7, span), span - 4)) : rng.int(Math.max(0, span - 3), span);
  const at = minDate(maxDate(atLocal(addDays(window.opensAt, day), rng.int(9, 21), rng.int(0, 59)), from), until);
  const role = rng.weighted(["PRESIDENT", "VP", "ADVISOR"] as const, (r) => (r === "PRESIDENT" ? 0.7 : 0.15));
  const could = seats.filter((x) => x.startedAt < addHours(at, -1));
  const who = could.find((x) => x.role === role) ?? could.find((x) => x.role === "PRESIDENT") ?? could[0];
  return who && s.presidents.length ? { userId: who.userId, at } : null;
}
