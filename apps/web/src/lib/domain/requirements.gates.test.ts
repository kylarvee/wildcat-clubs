/**
 * Office requirements and single-permission requirements, on the in-memory
 * database the equivalence tests use (src/test/requirements/fake-db).
 *
 *   - An office's requirement reaches only its own clubs' leaders and members.
 *   - A single-permission requirement ("Event Safety Training", Events)
 *     reaches only leaders who hold that permission (presidents and VPs hold
 *     them all), and overdue it pauses only that permission.
 *   - Gaining or losing the permission opens or cancels the task.
 * The header's count on random worlds with offices and single-permission
 * requirements is checked with the other equivalence tests
 * (requirements.equivalence.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cloneTables, FakeDb, type Tables } from "@/test/requirements/fake-db";

const state = vi.hoisted(() => ({ db: null as unknown as import("@/test/requirements/fake-db").FakeDb }));
vi.mock("@/lib/db", async () => ({ db: (await import("@/test/requirements/fake-db")).fakeClient(() => state.db) }));
vi.mock("@/lib/domain/notify", async (original) => {
  type Input = { userIds: string[]; kind: string; title: string; body?: string; href?: string; exceptUserId?: string | null };
  const bell = async (input: Input) => {
    const ids = [...new Set(input.userIds)].filter((id) => id && id !== input.exceptUserId);
    await state.db.delegate("notification").createMany({ data: ids.map((userId) => ({ userId, kind: input.kind, title: input.title, body: input.body ?? null, href: input.href ?? null })) });
  };
  return {
    ...(await original<object>()),
    notify: bell,
    notifyEach: async (input: { kind: string; notices: Omit<Input, "kind">[] }) => {
      for (const n of input.notices) await bell({ ...n, kind: input.kind });
    },
  };
});

import { getClubAccess, pausedNote, type ClubAccess } from "@/lib/authz";
import { requirementStatus } from "@/lib/authz/requirements";
import { notifyOverdueRequirements, requirementCompliance, syncAllRequirementHolders, syncUserRequirements } from "@/lib/domain/requirements";
import { taskScopeFor } from "@/lib/domain/tasks";

const NOW = new Date("2026-10-20T18:00:00Z");
const d = (iso: string) => new Date(iso);
const LEADERS = ["OFFICER", "VP", "PRESIDENT"];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

/** WSUSA's Robotics club and Campus Recreation's Ultimate club; Event Safety Training (Events) and Campus Rec's safety forms, both overdue. */
function small(): Tables {
  const person = (id: string) => ({ id, email: `${id}@mail.weber.edu`, name: `Person ${id}`, handle: id, avatarUrl: null, avatarColor: "#4b2e83", kind: "STUDENT", status: "ACTIVE", platformRole: "USER" });
  const seat = (id: string, clubId: string, userId: string, role: string, permissions: string[]) => ({ id, clubId, userId, role, permissions, positionId: null, viaClubId: null, startedAt: d("2025-09-01T16:00:00Z"), endedAt: null });
  const member = (id: string, clubId: string, userId: string) => ({ id, clubId, userId, status: "ACTIVE", source: "REGISTER", requestedAt: d("2025-08-20T16:00:00Z"), joinedAt: d("2025-08-21T16:00:00Z"), endedAt: null });
  const requirement = (id: string, over: Record<string, unknown>) => ({ id, description: null, kind: "TEST", trainingEventId: null, renewal: "ACADEMIC_YEAR", graceDays: 10, active: true, createdAt: d("2026-08-01T16:00:00Z"), officeId: null, gatesCapability: null, ...over });
  return {
    term: [
      { id: "t1", name: "Spring 2026", academicYear: "2025-2026", startsOn: d("2026-01-05T07:00:00Z"), endsOn: d("2026-04-25T05:59:00Z"), countsForActivity: true },
      { id: "t2", name: "Fall 2026", academicYear: "2026-2027", startsOn: d("2026-08-31T06:00:00Z"), endsOn: d("2026-12-19T06:59:00Z"), countsForActivity: true },
    ],
    office: [{ id: "o-rec", key: "campus-rec", name: "Campus Recreation", shortName: "Campus Rec", umbrella: false }],
    club: [
      { id: "robotics", name: "Robotics", slug: "robotics", status: "APPROVED", approvedAt: d("2024-01-10T17:00:00Z"), type: "REGISTERED", officeId: null },
      { id: "ultimate", name: "Ultimate", slug: "ultimate", status: "APPROVED", approvedAt: d("2024-01-10T17:00:00Z"), type: "AFFILIATE", officeId: "o-rec" },
    ],
    user: ["pres", "events", "treasurer", "sport", "fan"].map(person),
    personalDetails: [],
    roleAssignment: [
      seat("a1", "robotics", "pres", "PRESIDENT", []),
      seat("a2", "robotics", "events", "OFFICER", ["events", "budget"]),
      seat("a3", "robotics", "treasurer", "OFFICER", ["budget"]),
      seat("a4", "ultimate", "sport", "OFFICER", ["roster"]),
    ],
    membership: [member("m1", "robotics", "pres"), member("m2", "robotics", "events"), member("m3", "robotics", "treasurer"), member("m4", "ultimate", "sport"), member("m5", "ultimate", "fan"), member("m6", "robotics", "fan")],
    test: [
      { id: "tSafety", title: "Event Safety Training", isForm: false, audience: "ROLE_REQUIREMENT", clubId: null, status: "PUBLISHED", officeId: null },
      { id: "tRec", title: "Sport club safety forms", isForm: true, audience: "ROLE_REQUIREMENT", clubId: null, status: "PUBLISHED", officeId: "o-rec" },
    ],
    roleRequirement: [
      requirement("rSafety", { name: "Event Safety Training", testId: "tSafety", appliesTo: LEADERS, gatesCapability: "events" }),
      requirement("rRec", { name: "Sport club safety forms", testId: "tRec", appliesTo: LEADERS, officeId: "o-rec" }),
      requirement("rWaiver", { name: "Campus Rec waiver", testId: "tRec", appliesTo: ["MEMBER"], officeId: "o-rec", graceDays: 60 }),
    ],
    testAttempt: [],
    attendance: [],
    event: [],
    eventOccurrence: [],
    task: [],
    testAssignment: [],
    notification: [],
    reminderLog: [],
  };
}

const actor = (id: string) => ({ id, platformRole: "USER", status: "ACTIVE", kind: "STUDENT", officeIds: [], fundingOfficeIds: [] }) as unknown as Parameters<typeof taskScopeFor>[0];

async function run<T>(tables: Tables, fn: (db: FakeDb) => Promise<T>): Promise<{ result: T; db: FakeDb }> {
  const db = new FakeDb(cloneTables(tables));
  state.db = db;
  return { result: await fn(db), db };
}

const caps = (a: ClubAccess | null) => [...(a?.capabilities ?? [])].sort();
const openTasks = (db: FakeDb, userId: string) =>
  db.tables.task.filter((t) => t.assigneeId === userId && t.status === "OPEN" && t.sourceType === "requirement").map((t) => String(t.sourceId).split(":")[0]).sort();

describe("a single-permission requirement", () => {
  it("pauses only its permission when it's overdue: the rest of the role keeps working", async () => {
    await run(small(), async () => {
      const officer = await getClubAccess(actor("events"), "robotics");
      expect(officer?.suspended).toBe(false);
      expect(caps(officer)).toEqual(["budget"]);
      expect(officer?.pausedCapabilities).toEqual([{ capability: "events", requirements: ["Event Safety Training"] }]);
      expect(pausedNote(officer, "events")).toBe("Events is paused until you finish Event Safety Training. Your title and your other permissions keep working.");
      expect(pausedNote(officer, "budget")).toBeNull();

      // A president holds every permission, so it reaches them too, and only Events pauses.
      const pres = await getClubAccess(actor("pres"), "robotics");
      expect(pres?.suspended).toBe(false);
      expect(pres?.capabilities.has("events")).toBe(false);
      expect(pres?.capabilities.has("roster")).toBe(true);
      expect(pres?.assignableRoles).toContain("VP");
      expect(pres?.canRetire).toBe(true);
    });
  });

  it("never reaches a leader without the permission", async () => {
    await run(small(), async () => {
      const treasurer = await getClubAccess(actor("treasurer"), "robotics");
      expect(treasurer?.suspended).toBe(false);
      expect(caps(treasurer)).toEqual(["budget"]);
      expect(treasurer?.pausedCapabilities).toEqual([]);
      const status = await requirementStatus("treasurer", "OFFICER", { assignmentStartedAt: d("2025-09-01T16:00:00Z"), clubApprovedAt: null, at: NOW, clubOfficeId: null, holds: new Set(["budget"]) });
      expect(status.items.map((i) => i.requirement.id)).toEqual([]);
    });
  });

  it("comes back as soon as it's passed", async () => {
    const t = small();
    t.testAttempt.push({ id: "x1", testId: "tSafety", userId: "events", cycleKey: "2026-2027", startedAt: d("2026-10-19T18:00:00Z"), submittedAt: d("2026-10-19T18:30:00Z"), status: "GRADED", passed: true });
    await run(t, async () => {
      const officer = await getClubAccess(actor("events"), "robotics");
      expect(caps(officer)).toEqual(["budget", "events"]);
      expect(officer?.pausedCapabilities).toEqual([]);
    });
  });

  it("opens a task when someone gains the permission and cancels it when they lose it", async () => {
    const synced = await run(small(), async () => syncAllRequirementHolders({ now: NOW }));
    expect(openTasks(synced.db, "treasurer")).toEqual([]);
    expect(openTasks(synced.db, "events")).toEqual(["rSafety"]);
    expect(openTasks(synced.db, "pres")).toEqual(["rSafety"]);

    // The President gives the treasurer Events: their next sync owes Event Safety Training.
    const gained = cloneTables(synced.db.tables);
    gained.roleAssignment.find((a) => a.id === "a3")!.permissions = ["budget", "events"];
    const after = await run(gained, async () => syncUserRequirements("treasurer", { notify: "new-role", now: NOW }));
    expect(after.result.opened).toEqual(["Event Safety Training"]);
    expect(openTasks(after.db, "treasurer")).toEqual(["rSafety"]);
    const notice = after.db.tables.notification.find((n) => n.userId === "treasurer");
    expect(notice?.title).toBe("Your new role has WSUSA requirements");
    expect(notice?.body).toBe("Finish Event Safety Training to turn your Events permission back on.");

    // And takes it away again: the task is cancelled, nothing is owed.
    const lost = cloneTables(after.db.tables);
    lost.roleAssignment.find((a) => a.id === "a3")!.permissions = ["budget"];
    const back = await run(lost, async () => syncUserRequirements("treasurer", { now: NOW }));
    expect(back.result.open).toBe(0);
    expect(openTasks(back.db, "treasurer")).toEqual([]);
    expect(back.db.tables.task.find((t) => t.assigneeId === "treasurer" && t.sourceId === "rSafety:treasurer")?.status).toBe("CANCELLED");
  });

  it("tells leaders only that permission paused, and admin compliance says the same", async () => {
    const { db, result } = await run(small(), async () => {
      await syncAllRequirementHolders({ now: NOW });
      await notifyOverdueRequirements(NOW);
      return requirementCompliance(NOW);
    });
    const told = (userId: string) => db.tables.notification.filter((n) => n.userId === userId && n.kind === "requirement.overdue").map((n) => [n.title, n.body]);
    expect(told("events")).toEqual([["Events paused in Robotics", "Event Safety Training is overdue, so Events is paused. Your title and your other permissions stay, and Events comes back as soon as it's done."]]);
    expect(told("sport")).toEqual([["Permissions paused in Ultimate", "Sport club safety forms is overdue. Your title stays, and your permissions come back as soon as it's done."]]);
    const row = (userId: string) => result.find((r) => r.person.id === userId);
    expect([row("events")?.paused, row("events")?.pausedCapabilities]).toEqual([false, ["events"]]);
    expect([row("sport")?.paused, row("sport")?.pausedCapabilities]).toEqual([true, undefined]);
    expect([row("treasurer")?.paused, Object.keys(row("treasurer")?.cells ?? {})]).toEqual([false, []]);
  });
});

describe("an office's requirement", () => {
  it("reaches only its own clubs' leaders and members, and pauses them like WSUSA's", async () => {
    const { db } = await run(small(), async (db) => {
      await syncAllRequirementHolders({ notify: "new-role", now: NOW });
      return db;
    });
    expect(openTasks(db, "sport")).toEqual(["rRec", "rWaiver"]);
    // Leaders of WSUSA's club never see it; a member of both clubs owes only the waiver, through Ultimate.
    expect(openTasks(db, "events")).toEqual(["rSafety"]);
    expect(openTasks(db, "fan")).toEqual(["rWaiver"]);
    const waiver = db.tables.task.find((t) => t.sourceId === "rWaiver:fan");
    expect(waiver?.clubId).toBeNull();
    expect(db.tables.notification.find((n) => n.userId === "fan")?.title).toBe("Required by Campus Recreation");
    expect(db.tables.notification.find((n) => n.userId === "fan")?.body).toMatch(/^Campus Recreation asks every member of its clubs to finish Campus Rec waiver by /);
    expect(db.tables.notification.find((n) => n.userId === "sport")?.title).toBe("Your new role has Campus Recreation requirements");

    await run(db.tables, async () => {
      const sport = await getClubAccess(actor("sport"), "ultimate");
      expect(sport?.suspended).toBe(true);
      expect(caps(sport)).toEqual([]);
    });
  });
});
