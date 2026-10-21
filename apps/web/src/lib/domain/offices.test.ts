import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Offices in the write path, against a small fake database: createTask
 * routes ADMINS tasks to the club's office (with the umbrella stored as
 * null), an office with no staff falls back to the platform admins, the
 * inbox scope follows the person's offices, a new club's office follows its
 * scope and category, and moving a club moves its open admin tasks.
 */

type Office = { id: string; key: string; umbrella: boolean; decidesFunding: boolean };
const state = vi.hoisted(() => ({
  offices: [] as Office[],
  clubs: new Map<string, { officeId: string | null }>(),
  members: [] as { officeId: string; userId: string; active: boolean }[],
  admins: ["alex", "sydney"],
  updates: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
}));

const officeRow = (o: Office | undefined) => (o ? { ...o, name: o.key, shortName: o.key, location: null, hours: null, email: null, phone: null, reviewDays: 10 } : null);
const fakeDb = vi.hoisted(() => ({
  task: {
    create: async ({ data }: { data: Record<string, unknown> }) => data,
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      state.updates.push(args);
      return { count: 1 };
    },
  },
  club: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const c = state.clubs.get(where.id);
      if (!c) return null;
      const office = state.offices.find((o) => o.id === c.officeId);
      return { officeId: c.officeId, office: office ? { umbrella: office.umbrella, decidesFunding: office.decidesFunding } : null };
    },
    update: async ({ where, data }: { where: { id: string }; data: { officeId: string | null } }) => {
      state.clubs.set(where.id, { officeId: data.officeId });
      return data;
    },
  },
  office: {
    findUnique: async ({ where }: { where: { id?: string; key?: string } }) => officeRow(state.offices.find((o) => (where.id ? o.id === where.id : o.key === where.key))),
    findFirst: async () => officeRow(state.offices.find((o) => o.umbrella)),
    findMany: async ({ where }: { where?: { umbrella?: boolean } } = {}) =>
      state.offices
        .filter((o) => where?.umbrella === undefined || o.umbrella === where.umbrella)
        // members: { none: { user: { status: "ACTIVE" } } }: offices nobody active staffs.
        .filter((o) => !("members" in (where ?? {})) || !state.members.some((m) => m.officeId === o.id && m.active))
        .map((o) => officeRow(o)!),
  },
  officeMember: {
    findMany: async ({ where }: { where: { officeId: string } }) => state.members.filter((m) => m.officeId === where.officeId && m.active).map((m) => ({ userId: m.userId })),
  },
}));

vi.mock("@/lib/db", () => ({ db: fakeDb }));
vi.mock("@/lib/authz/people", () => ({
  adminIds: async () => state.admins,
  capabilitiesByClub: async () => [],
  capabilitiesFromTasks: async () => [],
  clubCapabilityHolders: async () => [],
  roleCapabilities: async () => new Set(),
}));

import { createTask, taskScopeFor } from "@/lib/domain/tasks";
import { applyClubOffice, routedOfficeId } from "@/lib/domain/offices";
import { officeStaffIds } from "@/lib/offices";
import type { Actor } from "@/lib/auth/session";

const WSUSA: Office = { id: "wsusa-id", key: "wsusa", umbrella: true, decidesFunding: true };
const REC: Office = { id: "rec", key: "campus-rec", umbrella: false, decidesFunding: true };
const FSL: Office = { id: "fsl", key: "fsl", umbrella: false, decidesFunding: false };

beforeEach(() => {
  state.offices = [WSUSA, REC, FSL];
  state.clubs = new Map([
    ["wildcats", { officeId: null }],
    ["paintball", { officeId: "rec" }],
    ["kappa", { officeId: "fsl" }],
  ]);
  state.members = [{ officeId: "rec", userId: "rowan", active: true }];
  state.updates = [];
});

const admins = { type: "ADMINS" } as const;
const officeOf = async (clubId: string | null, sourceType = "club", assignee: Parameters<typeof createTask>[0]["assignee"] = admins) =>
  (await createTask({ kind: "APPROVAL", title: "t", assignee, clubId, source: { type: sourceType, id: "s1" } })).officeId;

describe("createTask routes admin tasks by office", () => {
  it("sends a club's work to the club's office", async () => {
    expect(await officeOf("paintball")).toBe("rec");
    expect(await officeOf("kappa", "clubStaffing")).toBe("fsl");
    expect(await officeOf("wildcats")).toBeNull();
  });

  it("keeps platform-wide work with WSUSA, and funding with whoever decides it", async () => {
    expect(await officeOf("paintball", "reviewBombing")).toBeNull();
    expect(await officeOf("paintball", "googleAccount")).toBeNull();
    expect(await officeOf("paintball", "funding")).toBe("rec");
    expect(await officeOf("kappa", "funding")).toBeNull();
  });

  it("takes an explicit office or umbrella override, and never stores the umbrella's id", async () => {
    expect(await officeOf("paintball", "club", { type: "ADMINS", umbrella: true })).toBeNull();
    expect(await officeOf(null, "testAttempt", { type: "ADMINS", officeId: "fsl" })).toBe("fsl");
    expect(await officeOf(null, "testAttempt", { type: "ADMINS", officeId: "wsusa-id" })).toBeNull();
    expect(await officeOf(null, "testAttempt", { type: "ADMINS", officeId: null })).toBeNull();
  });

  it("leaves other tasks without an office", async () => {
    expect(await officeOf("paintball", "club", { type: "USER", userId: "maya" })).toBeNull();
  });
});

describe("who works an office's queue", () => {
  it("is the office's staff, or the platform admins for WSUSA", async () => {
    expect(await officeStaffIds("rec")).toEqual(["rowan"]);
    expect(await officeStaffIds(null)).toEqual(["alex", "sydney"]);
  });

  it("falls back to the platform admins when an office has no active staff, so nothing goes unseen", async () => {
    expect(await officeStaffIds("fsl")).toEqual(["alex", "sydney"]);
    state.members = [{ officeId: "rec", userId: "rowan", active: false }];
    expect(await officeStaffIds("rec")).toEqual(["alex", "sydney"]);
  });
});

describe("the inbox scope", () => {
  const actor = (over: Partial<Actor>) => ({ id: "u", platformRole: "USER", status: "ACTIVE", officeIds: [], fundingOfficeIds: [], ...over }) as Actor;
  const admin = (scope: { OR: Record<string, unknown>[] }) => scope.OR.filter((w) => w.assigneeType === "ADMINS");

  it("gives platform admins WSUSA's tasks and those of offices nobody staffs", async () => {
    const or = admin((await taskScopeFor(actor({ id: "alex", platformRole: "ADMIN" }))) as { OR: Record<string, unknown>[] });
    expect(or).toEqual([{ assigneeType: "ADMINS", OR: [{ officeId: null }, { officeId: { in: ["fsl"] } }] }]);
  });

  it("gives office staff their offices' tasks only", async () => {
    const or = admin((await taskScopeFor(actor({ id: "rowan", officeIds: ["rec"], fundingOfficeIds: ["rec"] }))) as { OR: Record<string, unknown>[] });
    expect(or).toEqual([{ assigneeType: "ADMINS", officeId: { in: ["rec"] } }]);
  });

  it("gives everyone else no admin tasks", async () => {
    expect(admin((await taskScopeFor(actor({ id: "maya" }))) as { OR: Record<string, unknown>[] })).toEqual([]);
  });
});

describe("which office a club belongs to", () => {
  it("follows the scope and category, storing WSUSA as null", async () => {
    expect(await routedOfficeId({ scope: "SPORTS", category: null })).toBe("rec");
    expect(await routedOfficeId({ scope: "UNIVERSITY", category: "FSL" })).toBe("fsl");
    expect(await routedOfficeId({ scope: "COLLEGE", category: "ACADEMIC" })).toBeNull();
  });

  it("falls back to WSUSA when the office isn't set up", async () => {
    state.offices = [WSUSA];
    expect(await routedOfficeId({ scope: "SPORTS", category: null })).toBeNull();
  });
});

describe("moving a club between offices", () => {
  it("stores the umbrella as null and moves the club's open admin tasks, except WSUSA's own work", async () => {
    expect(await applyClubOffice(fakeDb as never, "paintball", "wsusa-id")).toBe(true);
    expect(state.clubs.get("paintball")).toEqual({ officeId: null });
    const [club, funding] = state.updates;
    expect(club.data).toEqual({ officeId: null });
    expect(club.where).toMatchObject({ clubId: "paintball", assigneeType: "ADMINS", status: "OPEN" });
    expect(JSON.stringify(club.where)).toContain("reviewBombing");
    expect(funding.where).toMatchObject({ clubId: "paintball", sourceType: { in: ["funding", "invoice"] } });
    expect(funding.data).toEqual({ officeId: null });
  });

  it("sends funding along only when the new office decides it", async () => {
    await applyClubOffice(fakeDb as never, "wildcats", "fsl");
    expect(state.updates.map((u) => u.data)).toEqual([{ officeId: "fsl" }, { officeId: null }]);
    state.updates = [];
    await applyClubOffice(fakeDb as never, "kappa", "rec");
    expect(state.updates.map((u) => u.data)).toEqual([{ officeId: "rec" }, { officeId: "rec" }]);
  });

  it("does nothing when the club is already there", async () => {
    expect(await applyClubOffice(fakeDb as never, "wildcats", "wsusa-id")).toBe(false);
    expect(await applyClubOffice(fakeDb as never, "paintball", "rec")).toBe(false);
    expect(state.updates).toEqual([]);
  });
});
