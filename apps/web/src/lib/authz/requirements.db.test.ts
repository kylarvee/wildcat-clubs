/**
 * The batch evaluator against the real database: for every seat in it, the
 * old per-person rule (src/test/requirements/legacy) and the new evaluator
 * must give the same answers. Read-only, so it can run against the dev
 * database, but it needs one, so it only runs when asked:
 *
 *   REQUIREMENTS_DB=1 npx vitest run src/lib/authz/requirements.db.test.ts
 */
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as legacy from "@/test/requirements/legacy";
import { loadRequirementBatch, requirementStatus } from "@/lib/authz/requirements";
import { requirementCompliance } from "@/lib/domain/requirements";

const on = process.env.REQUIREMENTS_DB === "1";
const ROLES = ["MEMBER", "AMBASSADOR", "OFFICER", "VP", "PRESIDENT"] as const;

/** Items keyed for comparison (the old order came from the database, the new one is oldest first). */
const view = (s: { items: legacy.RequirementItem[]; overdue: boolean; allMet: boolean }) => ({
  overdue: s.overdue,
  allMet: s.allMet,
  items: Object.fromEntries(
    s.items.map((i) => [i.requirement.id, { met: i.met, awaitingGrade: i.awaitingGrade, gradingPending: i.gradingPending, periodStart: i.periodStart.getTime(), dueAt: i.dueAt.getTime(), overdue: i.overdue, state: i.state }]),
  ),
});

describe.skipIf(!on)("requirements on the real database", () => {
  afterAll(() => db.$disconnect());
  const now = new Date();

  it("gives every seat the same status as the old per-person rule", async () => {
    const [roles, members] = await Promise.all([
      db.roleAssignment.findMany({ where: { endedAt: null }, select: { userId: true, role: true, startedAt: true, club: { select: { approvedAt: true } } } }),
      db.membership.findMany({ where: { status: "ACTIVE" }, select: { userId: true, joinedAt: true, requestedAt: true, club: { select: { approvedAt: true } } } }),
    ]);
    const seats = [
      ...roles.map((r) => ({ userId: r.userId, role: r.role, startedAt: r.startedAt, clubApprovedAt: r.club.approvedAt })),
      ...members.map((m) => ({ userId: m.userId, role: "MEMBER" as const, startedAt: m.joinedAt ?? m.requestedAt, clubApprovedAt: m.club.approvedAt })),
    ];
    const batch = await loadRequirementBatch([...new Set(seats.map((s) => s.userId))], { at: now });
    let compared = 0;
    for (const s of seats) {
      const ctx = { assignmentStartedAt: s.startedAt, clubApprovedAt: s.clubApprovedAt, at: now };
      const old = view(await legacy.requirementStatus(s.userId, s.role, ctx));
      expect(view(await requirementStatus(s.userId, s.role, ctx)), `${s.userId} as ${s.role}`).toEqual(old);
      expect(view(batch.status(s.userId, s.role, { startedAt: s.startedAt, clubApprovedAt: s.clubApprovedAt })), `${s.userId} as ${s.role} (batch)`).toEqual(old);
      compared++;
    }
    // Every role for a sample of people, on clocks the data doesn't have.
    const sample = [...new Set(seats.map((s) => s.userId))].filter((_, i) => i % 7 === 0);
    for (const userId of sample)
      for (const role of ROLES)
        for (const startedAt of [new Date(0), new Date(now.getTime() - 40 * 86_400_000), now]) {
          const ctx = { assignmentStartedAt: startedAt, clubApprovedAt: null, at: now };
          expect(view(await requirementStatus(userId, role, ctx))).toEqual(view(await legacy.requirementStatus(userId, role, ctx)));
          compared++;
        }
    console.log(`compared ${compared} seats`);
  }, 600_000);

  it("counts the header's tasks with stored pauses exactly as the live scope does", async () => {
    const { taskScopeFor, countOpenTasks } = await import("@/lib/domain/tasks");
    const { getClubAccess } = await import("@/lib/authz");
    const people = await db.user.findMany({
      where: { roleAssignments: { some: { endedAt: null } } },
      select: { id: true, platformRole: true, status: true, roleAssignments: { where: { endedAt: null }, select: { clubId: true } } },
    });
    let paused = 0;
    for (const p of people) {
      const actor = { id: p.id, platformRole: p.platformRole, status: p.status } as Parameters<typeof countOpenTasks>[0];
      expect(JSON.stringify(await taskScopeFor(actor, { pauses: "tasks" })), p.id).toBe(JSON.stringify(await taskScopeFor(actor)));
      expect(await countOpenTasks(actor), p.id).toBe(await db.task.count({ where: { AND: [await taskScopeFor(actor), { status: "OPEN" }] } }));
      for (const r of p.roleAssignments) if ((await getClubAccess({ ...actor, platformRole: "USER" }, r.clubId))?.suspended) paused++;
    }
    console.log(`compared ${people.length} people's task scopes (${paused} paused club roles among them)`);
  }, 600_000);

  it("gives admin compliance the same rows as before", async () => {
    const [old, next] = await Promise.all([legacy.requirementCompliance(now), requirementCompliance(now)]);
    expect(next).toEqual(old);
    console.log(`compared ${next.length} compliance rows`);
  }, 600_000);
});

/**
 * The sync itself, old against new: run one implementation's sweep and
 * overdue notices against a scratch copy of the database (it writes), the
 * other against an identical copy, then diff the two. Refuses the dev database.
 *
 *   REQUIREMENTS_SYNC=legacy|new REQUIREMENTS_NOW=2027-09-01T18:00:00Z DATABASE_URL=…/scratch npx vitest run src/lib/authz/requirements.db.test.ts
 */
const syncWith = process.env.REQUIREMENTS_SYNC;
describe.skipIf(syncWith !== "legacy" && syncWith !== "new")("one sweep on a scratch copy", () => {
  afterAll(() => db.$disconnect());
  it("runs", async () => {
    if (!/scratch|_req_/.test(process.env.DATABASE_URL ?? "")) throw new Error("Point DATABASE_URL at a scratch copy; this writes.");
    const now = process.env.REQUIREMENTS_NOW ? new Date(process.env.REQUIREMENTS_NOW) : new Date();
    const impl = syncWith === "legacy" ? legacy : await import("@/lib/domain/requirements");
    const started = Date.now();
    const swept = await impl.syncAllRequirementHolders({ notify: "due", now });
    const ms = Date.now() - started;
    const overdue = await impl.notifyOverdueRequirements(now);
    console.log(JSON.stringify({ impl: syncWith, now, swept, overdue, ms }));
  }, 600_000);
});
