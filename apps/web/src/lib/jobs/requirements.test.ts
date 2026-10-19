/**
 * The "WSUSA requirements" job's schedule: the first run of a campus day does
 * the full sweep and remembers it (ReminderLog); later runs that day only send
 * the notices for deadlines just crossed; a sweep that fails gives the day back.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cloneTables, FakeDb } from "@/test/requirements/fake-db";
import { buildWorld } from "@/test/requirements/world";

const state = vi.hoisted(() => ({ db: null as unknown as import("@/test/requirements/fake-db").FakeDb, failSweep: false }));
vi.mock("@/lib/db", async () => ({ db: (await import("@/test/requirements/fake-db")).fakeClient(() => state.db) }));
vi.mock("@/lib/domain/notify", async (original) => {
  const bell = async (input: { userIds: string[]; kind: string; title: string; body?: string; href?: string }) => {
    await state.db.delegate("notification").createMany({ data: input.userIds.map((userId) => ({ userId, kind: input.kind, title: input.title, body: input.body ?? null, href: input.href ?? null })) });
  };
  return {
    ...(await original<object>()),
    notify: bell,
    notifyEach: async (input: { kind: string; notices: { userIds: string[]; title: string; body?: string; href?: string }[] }) => {
      for (const n of input.notices) await bell({ ...n, kind: input.kind });
    },
  };
});
vi.mock("@/lib/domain/requirements", async (original) => {
  const real = await original<typeof import("@/lib/domain/requirements")>();
  return { ...real, syncAllRequirementHolders: (opts: Parameters<typeof real.syncAllRequirementHolders>[0]) => (state.failSweep ? Promise.reject(new Error("database went away")) : real.syncAllRequirementHolders(opts)) };
});

import { runRequirementsJob } from "@/lib/jobs/requirements";
import { fullSweepKey } from "@/lib/domain/requirements";

const world = buildWorld(7);
const at = (h: number) => new Date(world.now.getTime() + h * 3_600_000);

beforeAll(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterAll(() => vi.useRealTimers());

describe("runRequirementsJob", () => {
  it("sweeps on the day's first run, then only checks deadlines", async () => {
    state.db = new FakeDb(cloneTables(world.tables));
    vi.setSystemTime(world.now);
    const first = await runRequirementsJob(world.now);
    expect(first).toMatch(/^Full sweep: \d+ people, opened \d+, closed \d+(, updated \d+)?; \d+ now overdue\.$/);
    expect(state.db.tables.reminderLog).toHaveLength(1);

    vi.setSystemTime(at(0.25));
    const later = await runRequirementsJob(at(0.25));
    expect(later).toMatch(/^Deadlines only: 0 now overdue \(today's full sweep ran at \d{1,2}:\d{2} [AP]M\)\.$/);
    expect(state.db.tables.reminderLog).toHaveLength(1);
  });

  it("tells people when a deadline passes between sweeps, once", async () => {
    state.db = new FakeDb(cloneTables(world.tables));
    vi.setSystemTime(world.now);
    await runRequirementsJob(world.now);
    // A day of 15-minute runs: deadlines keep passing, and each is told once.
    let told = 0;
    for (let q = 1; q <= 24 * 4; q++) {
      const when = new Date(world.now.getTime() + q * 15 * 60_000);
      vi.setSystemTime(when);
      const line = await runRequirementsJob(when);
      const m = /(\d+) now overdue/.exec(line);
      told += Number(m?.[1] ?? 0);
      // The only other full sweep is the next campus day's first run.
      if (line.startsWith("Full sweep")) expect(fullSweepKey(when)).not.toBe(fullSweepKey(world.now));
    }
    const notices = state.db.tables.notification.filter((n) => n.kind === "requirement.overdue" && (n.createdAt as Date) > world.now).length;
    expect(told).toBe(notices);
  });

  it("gives the day back when the sweep fails, so the next run tries again", async () => {
    state.db = new FakeDb(cloneTables(world.tables));
    vi.setSystemTime(world.now);
    state.failSweep = true;
    await expect(runRequirementsJob(world.now)).rejects.toThrow("database went away");
    expect(state.db.tables.reminderLog).toHaveLength(0);
    state.failSweep = false;
    expect(await runRequirementsJob(world.now)).toMatch(/^Full sweep/);
  });
});
