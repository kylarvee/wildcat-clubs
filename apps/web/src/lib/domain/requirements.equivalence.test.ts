/**
 * The batch evaluator must give the old per-person answers. Each fixture
 * world (src/test/requirements/world) runs through the old code
 * (src/test/requirements/legacy, verbatim from before the batch) and the new
 * code, against two copies of the same in-memory data, and the results must
 * match: every person's status in every role, the full sweep's writes and
 * notices, the event path for each person, overdue notices and admin
 * compliance. The new code must also be idempotent, and the header's stored
 * pauses must match the live rule once tasks are in sync, also in worlds
 * with offices and single-permission requirements (which the old code never
 * knew about, so only the new code runs those).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ClubRole } from "@prisma/client";
import { cloneTables, FakeDb, type Tables } from "@/test/requirements/fake-db";
import { buildWorld, type World } from "@/test/requirements/world";

const state = vi.hoisted(() => ({ db: null as unknown as import("@/test/requirements/fake-db").FakeDb }));
vi.mock("@/lib/db", async () => ({ db: (await import("@/test/requirements/fake-db")).fakeClient(() => state.db) }));
// notify() writes the bell notification (what later runs dedupe against); email and push are out of scope here.
vi.mock("@/lib/domain/notify", async (original) => {
  type Input = { userIds: string[]; kind: string; title: string; body?: string; href?: string; exceptUserId?: string | null };
  const bell = async (input: Input) => {
    const ids = [...new Set(input.userIds)].filter((id) => id && id !== input.exceptUserId);
    await state.db.delegate("notification").createMany({ data: ids.map((userId) => ({ userId, kind: input.kind, title: input.title, body: input.body ?? null, href: input.href ?? null })) });
  };
  return {
    ...(await original<object>()),
    notify: bell,
    // The new code sends a sweep's notices together; each still lands on the bell in order.
    notifyEach: async (input: { kind: string; notices: Omit<Input, "kind">[] }) => {
      for (const n of input.notices) await bell({ ...n, kind: input.kind });
    },
  };
});

import * as legacy from "@/test/requirements/legacy";
import { requirementStatus } from "@/lib/authz/requirements";
import { notifyOverdueRequirements, requirementCompliance, syncAllRequirementHolders, syncUserRequirements } from "@/lib/domain/requirements";
import { taskScopeFor } from "@/lib/domain/tasks";
import { getClubAccess } from "@/lib/authz";

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const ROLES: ClubRole[] = ["MEMBER", "AMBASSADOR", "OFFICER", "VP", "PRESIDENT", "ADVISOR"];
const worlds = SEEDS.map((seed) => buildWorld(seed));

beforeAll(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterAll(() => vi.useRealTimers());

/** Runs `fn` against a fresh copy of the world's data, with the clock at the world's "now". */
async function inCopy<T>(w: World, fn: () => Promise<T>, tables: Tables = w.tables): Promise<{ result: T; db: FakeDb }> {
  const db = new FakeDb(cloneTables(tables));
  state.db = db;
  vi.setSystemTime(w.now);
  return { result: await fn(), db };
}

/** A table as comparable rows: rows made during the run lose their generated id and timestamp. */
function rows(db: FakeDb, model: string, before: Tables): string[] {
  const existing = new Set((before[model] ?? []).map((r) => (r.id ?? r.key) as string));
  return db.tables[model]
    .map((r) => {
      const keep = existing.has((r.id ?? r.key) as string);
      const out = Object.fromEntries(Object.entries(r).filter(([k]) => keep || (k !== "id" && k !== "createdAt" && k !== "sentAt")));
      return JSON.stringify(out, Object.keys(out).sort());
    })
    .sort();
}

function sameTables(a: FakeDb, b: FakeDb, before: Tables, label: string) {
  for (const model of ["task", "testAssignment", "notification"]) expect(rows(b, model, before), `${label}: ${model}`).toEqual(rows(a, model, before));
}

const view = (s: { items: legacy.RequirementItem[]; overdue: boolean; allMet: boolean }) => ({
  overdue: s.overdue,
  allMet: s.allMet,
  items: s.items.map((i) => ({ id: i.requirement.id, met: i.met, awaitingGrade: i.awaitingGrade, gradingPending: i.gradingPending, periodStart: i.periodStart.getTime(), dueAt: i.dueAt.getTime(), overdue: i.overdue, state: i.state })),
});

describe("the batch evaluator gives the old per-person answers", () => {
  const clocks = (w: World) => [w.now, new Date(w.now.getTime() - 25 * 86_400_000), new Date("2024-01-01T00:00:00Z")];

  it("covers what it claims to (the fixtures aren't trivial)", async () => {
    const states = new Set<string>();
    for (const w of worlds.slice(0, 8)) {
      await inCopy(w, async () => {
        for (const userId of w.userIds)
          for (const role of ROLES)
            for (const startedAt of clocks(w))
              for (const i of (await requirementStatus(userId, role, { assignmentStartedAt: startedAt, clubApprovedAt: null, at: w.now })).items) states.add(`${i.requirement.kind}:${i.state}`);
      });
    }
    for (const s of ["TEST:met", "TEST:due", "TEST:overdue", "TEST:review", "TRAINING:met", "TRAINING:due", "TRAINING:overdue", "PROFILE:met", "PROFILE:due", "PROFILE:overdue"]) expect([...states].sort(), s).toContain(s);
  }, 120_000);

  it("gives every person the same status in every role, on every clock", async () => {
    for (const w of worlds.slice(0, 12)) {
      await inCopy(w, async () => {
        // Clocks paired with club approvals: just taken, inside grace with a recent approval, long ago.
        const [now, inGrace, longAgo] = clocks(w);
        const seats = [
          { startedAt: now, clubApprovedAt: null },
          { startedAt: inGrace, clubApprovedAt: new Date(w.now.getTime() - 5 * 86_400_000) },
          { startedAt: longAgo, clubApprovedAt: null },
        ];
        for (const userId of w.userIds)
          for (const role of ROLES)
            for (const s of seats) {
              const ctx = { assignmentStartedAt: s.startedAt, clubApprovedAt: s.clubApprovedAt, at: w.now };
              expect(view(await requirementStatus(userId, role, ctx)), `world ${w.seed}: ${userId} as ${role}`).toEqual(view(await legacy.requirementStatus(userId, role, ctx)));
            }
      });
    }
  }, 300_000);

  it("makes the same full sweep: the same tasks, assignments and notices", async () => {
    for (const w of worlds) {
      for (const mode of ["due", false] as const) {
        const old = await inCopy(w, () => legacy.syncAllRequirementHolders({ notify: mode, now: w.now }));
        const next = await inCopy(w, () => syncAllRequirementHolders({ notify: mode, now: w.now }));
        expect({ people: next.result.people, opened: next.result.opened }, `world ${w.seed}`).toEqual(old.result);
        sameTables(old.db, next.db, w.tables, `world ${w.seed} (notify ${mode})`);
      }
    }
  }, 120_000);

  it("makes the same overdue notices after the sweep", async () => {
    for (const w of worlds) {
      const old = await inCopy(w, async () => (await legacy.syncAllRequirementHolders({ notify: "due", now: w.now }), legacy.notifyOverdueRequirements(w.now)));
      const next = await inCopy(w, async () => (await syncAllRequirementHolders({ notify: "due", now: w.now }), notifyOverdueRequirements(w.now)));
      expect(next.result, `world ${w.seed}`).toEqual(old.result);
      sameTables(old.db, next.db, w.tables, `world ${w.seed}`);
      // Run again: nobody hears twice.
      const again = await inCopy(w, () => notifyOverdueRequirements(w.now), next.db.tables);
      expect(again.result.notified, `world ${w.seed}`).toBe(0);
    }
  }, 120_000);

  it("brings one person in line exactly as before (the event path), in every notice mode", async () => {
    for (const w of worlds.slice(0, 15)) {
      for (const userId of w.userIds) {
        const mode = (["new-role", "due", false] as const)[Number(userId.slice(1)) % 3];
        const old = await inCopy(w, () => legacy.syncUserRequirements(userId, { notify: mode, now: w.now }));
        const next = await inCopy(w, () => syncUserRequirements(userId, { notify: mode, now: w.now }));
        expect(next.result, `world ${w.seed}: ${userId}`).toEqual(old.result);
        sameTables(old.db, next.db, w.tables, `world ${w.seed}: ${userId}`);
      }
    }
  }, 300_000);

  it("gives admin compliance the same rows", async () => {
    for (const w of worlds) {
      const old = await inCopy(w, () => legacy.requirementCompliance(w.now));
      const next = await inCopy(w, () => requirementCompliance(w.now));
      expect(next.result, `world ${w.seed}`).toEqual(old.result);
      const some = await inCopy(w, () => requirementCompliance(w.now, { clubIds: ["c1", "c3"] }));
      expect(some.result, `world ${w.seed} (two clubs)`).toEqual((await inCopy(w, () => legacy.requirementCompliance(w.now, { clubIds: ["c1", "c3"] }))).result);
    }
  }, 120_000);
});

describe("the new sweep", () => {
  it("changes nothing the second time", async () => {
    for (const w of worlds) {
      const first = await inCopy(w, () => syncAllRequirementHolders({ notify: "due", now: w.now }));
      const second = await inCopy(w, () => syncAllRequirementHolders({ notify: "due", now: w.now }), first.db.tables);
      expect({ opened: second.result.opened, closed: second.result.closed, updated: second.result.updated }, `world ${w.seed}`).toEqual({ opened: 0, closed: 0, updated: 0 });
      sameTables(first.db, second.db, first.db.tables, `world ${w.seed}`);
    }
  }, 120_000);

  it("closes a second open copy of a task still owed, keeping the oldest", async () => {
    const w = worlds.find((x) => x.tables.task.some((t) => t.status === "OPEN" && t.sourceType === "requirement"))!;
    const synced = await inCopy(w, () => syncAllRequirementHolders({ now: w.now }));
    const keep = synced.db.tables.task.find((t) => t.status === "OPEN" && t.sourceType === "requirement")!;
    const copy = { ...keep, id: "k-copy", createdAt: new Date(w.now.getTime() + 1000) };
    const again = await inCopy(w, () => syncAllRequirementHolders({ now: w.now }), { ...synced.db.tables, task: [...synced.db.tables.task, copy] });
    expect(again.result.closed).toBe(1);
    expect(again.db.tables.task.find((t) => t.id === "k-copy")?.status).toBe("CANCELLED");
    expect(again.db.tables.task.find((t) => t.id === keep.id)?.status).toBe("OPEN");
  });

  it("records the day it swept, once", async () => {
    const w = worlds[0];
    const { db } = await inCopy(w, async () => {
      await syncAllRequirementHolders({ now: w.now });
      await syncAllRequirementHolders({ now: w.now });
    });
    expect(db.tables.reminderLog.map((r) => r.key)).toEqual([`job:requirements:full:${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(w.now)}`]);
  });
});

describe("the header's count", () => {
  it("reads the same pauses from stored tasks as the live rule, once tasks are in sync", async () => {
    let paused = 0;
    for (const w of worlds) {
      const synced = await inCopy(w, () => syncAllRequirementHolders({ now: w.now }));
      await inCopy(
        w,
        async () => {
          // People who aren't active have no requirement tasks (the platform ends their roles), so only active ones.
          for (const u of synced.db.tables.user.filter((x) => x.status === "ACTIVE")) {
            const actor = { id: u.id, platformRole: "USER", status: "ACTIVE" } as Parameters<typeof taskScopeFor>[0];
            expect(JSON.stringify(await taskScopeFor(actor, { pauses: "tasks" })), `world ${w.seed}: ${u.id}`).toBe(JSON.stringify(await taskScopeFor(actor)));
            for (const clubId of new Set(synced.db.tables.roleAssignment.filter((a) => a.userId === u.id && !a.endedAt).map((a) => a.clubId as string)))
              if ((await getClubAccess(actor, clubId))?.suspended) paused++;
          }
        },
        synced.db.tables,
      );
    }
    // Plenty of paused leaders among the worlds, so the comparison means something.
    expect(paused).toBeGreaterThan(50);
  }, 120_000);

  it("still matches with offices' requirements and single-permission pauses (only that permission paused)", async () => {
    let partial = 0;
    let full = 0;
    for (const seed of SEEDS.slice(0, 30)) {
      const w = buildWorld(seed, { offices: true });
      const synced = await inCopy(w, () => syncAllRequirementHolders({ now: w.now }));
      await inCopy(
        w,
        async () => {
          for (const u of synced.db.tables.user.filter((x) => x.status === "ACTIVE")) {
            const actor = { id: u.id, platformRole: "USER", status: "ACTIVE", officeIds: [], fundingOfficeIds: [] } as unknown as Parameters<typeof taskScopeFor>[0];
            expect(JSON.stringify(await taskScopeFor(actor, { pauses: "tasks" })), `world ${w.seed} (offices): ${u.id}`).toBe(JSON.stringify(await taskScopeFor(actor)));
            for (const clubId of new Set(synced.db.tables.roleAssignment.filter((a) => a.userId === u.id && !a.endedAt).map((a) => a.clubId as string))) {
              const access = await getClubAccess(actor, clubId);
              if (access?.suspended) full++;
              else if (access?.pausedCapabilities.length) partial++;
            }
          }
        },
        synced.db.tables,
      );
      // Idempotent there too.
      const again = await inCopy(w, () => syncAllRequirementHolders({ now: w.now }), synced.db.tables);
      expect({ opened: again.result.opened, closed: again.result.closed, updated: again.result.updated }, `world ${w.seed} (offices)`).toEqual({ opened: 0, closed: 0, updated: 0 });
    }
    // Plenty of both kinds of pause, so the comparison means something.
    expect(partial).toBeGreaterThan(20);
    expect(full).toBeGreaterThan(20);
  }, 120_000);
});
