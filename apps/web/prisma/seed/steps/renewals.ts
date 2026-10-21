import type { Prisma, PrismaClient } from "@prisma/client";
import { loadRenewalStates, type ClubRenewalState } from "@/lib/renewals/facts";
import {
  RENEWAL_SOURCE,
  renewalDueNotice,
  renewalHref,
  renewalSourceId,
  renewalTaskDescription,
  renewalTaskTitle,
  renewalTerm,
  renewalWindow,
  renewedNotice,
  snapshotChecks,
  tookOfficeDuringWindow,
  type RenewalWindow,
} from "@/lib/renewals/rules";
import { UMBRELLA_DEFAULTS } from "@/lib/offices/rules";
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
 * first week and the last few days). The tasks are the history the renewal
 * sync (lib/domain/renewals syncClubRenewal) would have left: each President
 * and advisor seated since renewal opened got one, when the window opened or
 * the day they took the seat; it closed as done when the club renewed, and
 * was cancelled the day they left the seat before that. So every club that's
 * asked and hasn't renewed has one open task per current President and
 * advisor. Story clubs:
 *   - RC Wrecker Bots Club (Priya) hasn't renewed. Every required check
 *     passes and one recommended check is amber (its VP stepped down), so her
 *     card's Renew button works.
 *   - SWE renewed in mid-September; Vanessa did it as VP.
 *   - Clubs whose advisor's term ended (Microbiology Club, for one) can't
 *     renew: the advisor check blocks them.
 *   - A club whose President changed after renewal opened (Military-
 *     Affiliated Club, whose hand-off steps/roles pins three weeks into the
 *     fall term; else the first club whose history fits; the log line names
 *     it) hasn't renewed: the new President holds the task, and the
 *     outgoing President's was cancelled when they left.
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

type Seat = { clubId: string; userId: string; role: "PRESIDENT" | "VP" | "ADVISOR"; startedAt: Date; endedAt: Date | null };

/** Story clubs to try first for the President change mid-window ("veterans" has it pinned in steps/roles); the role history decides whether one fits. */
const HANDOVER_STORY = ["veterans", "anime", "bsu"];

export async function buildRenewals(db: PrismaClient, ctx: Ctx, log: (s: string) => void) {
  const { NOW } = ctx;
  const rng = createRng(20261019);
  const terms = await db.term.findMany({ orderBy: { startsOn: "asc" } });
  const window = renewalWindow(terms, NOW, DUE_DAYS);
  if (!window) return log("Renewals: no academic year on the calendar, skipped.");
  const states = await loadRenewalStates(db, { window, term: renewalTerm(terms, NOW), now: NOW });
  const asked = states.filter((s) => !s.exemption);
  // Every President, VP and advisor seat held at some point since renewal opened: today's, and the ones that ended since.
  const seats = (await db.roleAssignment.findMany({
    where: {
      clubId: { in: asked.map((s) => s.club.id) },
      role: { in: ["PRESIDENT", "VP", "ADVISOR"] },
      startedAt: { lte: NOW },
      OR: [{ endedAt: null }, { endedAt: { gt: window.opensAt } }],
      user: { status: { not: "DEACTIVATED" } },
    },
    select: { clubId: true, userId: true, role: true, startedAt: true, endedAt: true },
  })) as Seat[];
  const seatsOf = (clubId: string) => seats.filter((s) => s.clubId === clubId);
  const umbrella = (await db.office.findFirst({ where: { umbrella: true }, select: { name: true } }))?.name ?? UMBRELLA_DEFAULTS.name;

  // A President change after renewal opened: a President seated since then, and one who left after their task opened.
  const handedOver = (s: ClubRenewalState) => {
    const pres = seatsOf(s.club.id).filter((x) => x.role === "PRESIDENT");
    const fresh = pres.find((x) => !x.endedAt && x.startedAt > window.opensAt);
    return Boolean(fresh && pres.some((x) => x.endedAt && x.endedAt > addHours(window.opensAt, 1) && x.startedAt < fresh.startedAt));
  };
  const handover =
    [...HANDOVER_STORY.map((k) => asked.find((s) => s.club.id === ctx.club(k).id)), ...asked.filter((s) => ctx.clubById.get(s.club.id)?.def.story), ...asked].find(
      (s): s is ClubRenewalState => Boolean(s && handedOver(s)),
    ) ?? null;

  // Renewals happen between the window opening and the due date (or now, if that's sooner).
  const from = addHours(window.opensAt, 8);
  const until = minDate(window.dueAt, addHours(NOW, -2));
  const robotics = ctx.club("robotics").id;
  const swe = ctx.club("swe").id;
  const vanessa = ctx.p("vanessa").id;
  const life = (s: ClubRenewalState) => ctx.clubById.get(s.club.id)?.def.life;
  const active = asked.filter((s) => life(s) === "active" || life(s) === "pilot");
  const target = Math.round(active.length * RENEWED_SHARE);
  const ready = active.filter((s) => !s.blocking.length && s.club.id !== robotics && s.club.id !== handover?.club.id);
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

  // The renewal sync's history: a task per President and advisor seated since renewal opened, done at the renewal or cancelled when they left.
  const tasks: Prisma.TaskCreateManyInput[] = [];
  const bells: Prisma.NotificationCreateManyInput[] = [];
  const activity: Prisma.ActivityLogCreateManyInput[] = [];
  const priya = ctx.p("priya").id;
  for (const s of asked) {
    const done = renewedAt.get(s.club.id);
    const office = s.club.office?.name ?? umbrella;
    for (const seat of seatsOf(s.club.id).filter((x) => x.role !== "VP")) {
      const role = seat.role as "PRESIDENT" | "ADVISOR";
      // Seated before the window: the job's first run asked them. Seated since: the sync did, the moment they took the seat.
      const tookOffice = tookOfficeDuringWindow({ since: seat.startedAt }, window);
      const opened = minDate(tookOffice ? addMin(seat.startedAt, 0.05) : addMin(window.opensAt, rng.int(2, 14)), NOW);
      if (done && opened >= done.at) continue; // took the seat after the club renewed: nobody asked them
      if (seat.endedAt && seat.endedAt <= opened) continue; // left before their task opened
      const left = seat.endedAt && (!done || seat.endedAt < done.at) ? seat.endedAt : null;
      const status = left ? "CANCELLED" : done ? "DONE" : "OPEN";
      tasks.push({
        id: ctx.id(), kind: "REQUIREMENT", title: renewalTaskTitle(s.club.name, window.year), description: renewalTaskDescription(office, tookOffice), assigneeType: "USER", assigneeId: seat.userId,
        clubId: s.club.id, href: renewalHref(s.club.slug), dueAt: window.dueAt, required: true, sourceType: RENEWAL_SOURCE, sourceId: renewalSourceId(s.club.id, window.year), officeId: s.club.officeId,
        createdAt: opened, status, completedAt: left ?? done?.at ?? null, completedById: status === "DONE" ? done!.by : null,
      });
      const unread = seat.userId === priya || (status === "OPEN" && rng.chance(0.4));
      bells.push({
        id: ctx.id(), userId: seat.userId, kind: "club.renewal_due", ...renewalDueNotice(s.club.name, window, opened > window.dueAt, office, tookOffice ? { role, since: seat.startedAt } : null), href: renewalHref(s.club.slug),
        createdAt: opened, readAt: unread ? null : minDate(addHours(opened, rng.float(2, 60)), left ?? done?.at ?? NOW, NOW),
      });
      if (status === "DONE" && seat.userId !== done!.by) {
        bells.push({
          id: ctx.id(), userId: seat.userId, kind: "club.renewed", ...renewedNotice(s.club.name, window.year, ctx.person(done!.by).name, office), href: `/clubs/${s.club.slug}/manage`,
          createdAt: done!.at, readAt: rng.chance(0.7) ? minDate(addHours(done!.at, rng.float(1, 48)), NOW) : null,
        });
      }
    }
    if (done) activity.push({ at: done.at, actorId: done.by, action: "club.renewed", entityType: "club", entityId: s.club.id, clubId: s.club.id, data: { year: window.year, office }, isPublic: true });
  }

  await db.clubRenewal.createMany({ data: renewals });
  await db.task.createMany({ data: tasks });
  await db.notification.createMany({ data: bells });
  await db.activityLog.createMany({ data: activity.sort((a, b) => (a.at as Date).getTime() - (b.at as Date).getTime()) });
  const open = tasks.filter((t) => t.status === "OPEN").length;
  log(
    `Renewals ${window.year}: ${renewals.length} of ${active.length} active clubs re-registered (${asked.length} clubs asked); ${open} open renewal tasks.` +
      (handover ? ` ${handover.club.name}'s President changed mid-window: the new one holds its task.` : " No club's President changed mid-window."),
  );
}

/** Who renewed, and when: usually the President, sometimes a VP or the advisor, at an evening-ish campus hour inside the window. */
function renewer(s: ClubRenewalState, seats: Seat[], window: RenewalWindow, from: Date, until: Date, rng: ReturnType<typeof createRng>): { userId: string; at: Date } | null {
  const span = Math.max(0, Math.floor((until.getTime() - window.opensAt.getTime()) / DAY));
  const u = rng.next();
  // The first week and the last few days before it's due are busiest.
  const day = u < 0.35 ? rng.int(0, Math.min(6, span)) : u < 0.8 ? rng.int(Math.min(7, span), Math.max(Math.min(7, span), span - 4)) : rng.int(Math.max(0, span - 3), span);
  const at = minDate(maxDate(atLocal(addDays(window.opensAt, day), rng.int(9, 21), rng.int(0, 59)), from), until);
  const role = rng.weighted(["PRESIDENT", "VP", "ADVISOR"] as const, (r) => (r === "PRESIDENT" ? 0.7 : 0.15));
  const could = seats.filter((x) => x.startedAt < addHours(at, -1) && (!x.endedAt || x.endedAt > at));
  const who = could.find((x) => x.role === role) ?? could.find((x) => x.role === "PRESIDENT") ?? could[0];
  return who && s.presidents.length ? { userId: who.userId, at } : null;
}
