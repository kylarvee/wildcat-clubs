import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Founding in lib/domain/clubs, against a small in-memory database:
 *  - revival requests: one open per club, students only; approving reinstates
 *    the club and seats the student who asked as President (through
 *    roles.grantRole, told once); declining needs a note;
 *  - the forming list: approval and rejection turn it off, approval tells
 *    followers (and closed co-founder invitees) it's official, and open
 *    co-founder invitations close with the decision.
 */

type Task = { id: string; sourceType: string; sourceId: string; status: string; createdById: string; description: string | null; createdAt: Date };
type ClubRow = Record<string, unknown> & { id: string; name: string; slug: string; status: string; officeId: string | null };

const state = vi.hoisted(() => ({
  club: null as ClubRow | null,
  users: new Map<string, { id: string; name: string; email: string; kind: string; status: string }>(),
  tasks: [] as Task[],
  created: [] as Record<string, unknown>[],
  clubUpdates: [] as Record<string, unknown>[],
  cofounderInvites: [] as { id: string; clubId: string; status: string; inviteeId: string | null }[],
  resolved: [] as string[],
  granted: [] as Record<string, unknown>[],
  notices: [] as { kind: string; to: string[]; title: string; body?: string }[],
  office: [] as { kind: string; title: string }[],
  logs: [] as string[],
  leaders: ["frank"],
  members: ["frank", "taylor"],
  followers: ["maya", "frank"],
  restored: [] as Record<string, unknown>[],
}));

const openTask = (sourceType: string, sourceId: string) => state.tasks.find((t) => t.sourceType === sourceType && t.sourceId === sourceId && t.status === "OPEN");

vi.mock("@/lib/db", () => {
  const tx = {
    $queryRaw: async () => [],
    club: {
      updateMany: async ({ where, data }: { where: { status: unknown }; data: Record<string, unknown> }) => {
        const want = where.status as string | { not: string } | { in: string[] };
        const ok =
          typeof want === "string" ? state.club?.status === want : "not" in want ? state.club?.status !== want.not : want.in.includes(state.club!.status);
        if (!ok) return { count: 0 };
        state.clubUpdates.push(data);
        Object.assign(state.club!, data);
        return { count: 1 };
      },
    },
    clubDecision: { create: async () => ({}) },
    membership: { updateMany: async () => ({ count: 0 }) },
    advisorInvite: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    cofounderInvite: {
      findMany: async ({ where }: { where: { clubId: string; status: string } }) => state.cofounderInvites.filter((i) => i.clubId === where.clubId && i.status === where.status),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { status: string } }) => {
        for (const i of state.cofounderInvites) if (where.id.in.includes(i.id)) i.status = data.status;
        return { count: where.id.in.length };
      },
    },
    task: { findFirst: async ({ where }: { where: { sourceType: string; sourceId: string } }) => openTask(where.sourceType, where.sourceId) ?? null },
  };
  const db = {
    ...tx,
    club: { ...tx.club, findUnique: async () => state.club, findFirst: async () => null, update: async () => state.club },
    clubDocument: { findMany: async () => [{ kind: "CONSTITUTION", status: "ACTIVE" }, { kind: "BYLAWS", status: "ACTIVE" }] },
    roleAssignment: {
      count: async () => 1,
      findMany: async ({ where }: { where: { endReason?: string } }) => (where.endReason ? state.restored : state.leaders.map((userId) => ({ userId }))),
    },
    membership: {
      ...tx.membership,
      findMany: async ({ where }: { where: { status: string; userId?: { notIn: string[] } } }) =>
        where.status === "ALUMNI" ? [] : state.members.filter((u) => !where.userId?.notIn.includes(u)).map((userId) => ({ userId })),
    },
    calendarSubscription: { findMany: async () => state.followers.map((userId) => ({ userId })) },
    position: { findFirst: async () => ({ id: "seat-president", maxHolders: 2 }) },
    task: {
      ...tx.task,
      findFirst: async ({ where }: { where: { sourceType: string; sourceId: string } }) => {
        const t = openTask(where.sourceType, where.sourceId);
        return t ? { ...t, createdBy: state.users.get(t.createdById) ?? null } : null;
      },
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: { status: string } }) => {
        const t = state.tasks.find((x) => x.id === where.id && x.status === where.status);
        if (!t) return { count: 0 };
        t.status = data.status;
        return { count: 1 };
      },
      update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => Object.assign(state.tasks.find((x) => x.id === where.id)!, data),
    },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { db };
});
vi.mock("@/lib/lake/activity", () => ({ logActivity: async (a: { action: string }) => void state.logs.push(a.action) }));
vi.mock("@/lib/domain/roles", () => ({ createDefaultPositions: async () => {}, grantRole: async (g: Record<string, unknown>) => void state.granted.push(g) }));
vi.mock("@/lib/domain/requirements", () => ({ reopenRequirementTasks: async () => {} }));
vi.mock("@/lib/domain/tasks", () => ({
  createTask: async (t: { source: { type: string; id: string }; createdById: string; description?: string; assignee: { type: string }; clubId: string; href: string }) => {
    state.created.push(t as never);
    state.tasks.push({ id: `t${state.tasks.length + 1}`, sourceType: t.source.type, sourceId: t.source.id, status: "OPEN", createdById: t.createdById, description: t.description ?? null, createdAt: new Date() });
  },
  resolveTasks: async (type: string, id: string, _by: string, _tx?: unknown, status = "DONE") => {
    state.resolved.push(`${type}:${id}:${status}`);
    for (const t of state.tasks) if (t.sourceType === type && t.sourceId === id && t.status === "OPEN") t.status = status;
  },
}));
vi.mock("@/lib/domain/notify", () => ({
  notify: async (n: { kind: string; userIds: string[]; title: string; body?: string; exceptUserId?: string }) => {
    const to = [...new Set(n.userIds)].filter((u) => u !== n.exceptUserId);
    if (to.length) state.notices.push({ kind: n.kind, to, title: n.title, body: n.body });
  },
}));
vi.mock("@/lib/domain/offices", () => ({ applyClubOffice: async () => false, routedOfficeId: async () => null }));
vi.mock("@/lib/offices", () => ({
  officeForClub: async () => ({ id: "wsusa", name: "WSUSA", umbrella: true }),
  notifyOffice: async (_target: unknown, n: { kind: string; title: string }) => void state.office.push({ kind: n.kind, title: n.title }),
}));
vi.mock("@/lib/files/storage", () => ({ guessMime: () => null, MAX_UPLOAD_BYTES: 1, putBytes: async () => "" }));
vi.mock("@/lib/search/fresh", () => ({ reindexClubSoon: () => {} }));

import { approveClubRevival, decideClub, declineClubRevival, requestClubRevival } from "@/lib/domain/clubs";

const person = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, email: `${id}@mail.weber.edu`, name: id, handle: id, kind: "STUDENT", platformRole: "USER", status: "ACTIVE", avatarColor: "#000", avatarUrl: null, officeIds: [], fundingOfficeIds: [], ...over }) as never;
const alex = person("alex", { kind: "FACULTY_STAFF", email: "alex@weber.edu", platformRole: "ADMIN" });
const rowan = person("rowan", { kind: "FACULTY_STAFF", email: "rowan@weber.edu", officeIds: ["campus-rec"] });
const casey = person("casey", { name: "Casey Lin" });

beforeEach(() => {
  state.users = new Map([
    ["casey", { id: "casey", name: "Casey Lin", email: "casey@mail.weber.edu", kind: "STUDENT", status: "ACTIVE" }],
    ["jo", { id: "jo", name: "Jo Park", email: "jo@mail.weber.edu", kind: "STUDENT", status: "ALUMNI" }],
  ]);
  state.tasks = [];
  state.created = [];
  state.clubUpdates = [];
  state.cofounderInvites = [];
  state.resolved = [];
  state.granted = [];
  state.notices = [];
  state.office = [];
  state.logs = [];
  state.restored = [];
  state.leaders = ["frank"];
  state.members = ["frank", "taylor"];
  state.followers = ["maya", "frank"];
});

const retired = (over: Record<string, unknown> = {}) => {
  state.club = { id: "photo", name: "Photographic Society", slug: "photographic-society", status: "RETIRED", type: "SPONSORED", officeId: null, retiredAt: new Date("2025-04-30"), approvedAt: new Date("2022-10-01"), ...over };
};

describe("asking to revive a retired club", () => {
  beforeEach(() => retired());

  it("files one APPROVAL task for the club's office and tells its staff", async () => {
    await expect(requestClubRevival(casey, { clubId: "photo", note: "A few of us want photo walks again." })).resolves.toEqual({ office: "WSUSA" });
    expect(state.created).toMatchObject([{ kind: "APPROVAL", assignee: { type: "ADMINS" }, clubId: "photo", source: { type: "clubRevival", id: "photo" }, createdById: "casey", description: "A few of us want photo walks again." }]);
    expect(state.office).toEqual([{ kind: "club.revival_requested", title: "Casey Lin asked to bring back Photographic Society" }]);
    expect(state.logs).toEqual(["club.revival_requested"]);
  });

  it("keeps one open request per club", async () => {
    await requestClubRevival(casey, { clubId: "photo" });
    await expect(requestClubRevival(casey, { clubId: "photo" })).rejects.toThrow(/You already asked/);
    await expect(requestClubRevival(person("dana"), { clubId: "photo" })).rejects.toThrow(/Someone already asked/);
    expect(state.created).toHaveLength(1);
  });

  it("is for students, and only for retired clubs", async () => {
    await expect(requestClubRevival(alex, { clubId: "photo" })).rejects.toThrow(/Only students/);
    await expect(requestClubRevival(person("gwen", { status: "ALUMNI" }), { clubId: "photo" })).rejects.toThrow(/Alumni/);
    retired({ status: "APPROVED" });
    await expect(requestClubRevival(casey, { clubId: "photo" })).rejects.toThrow(/isn't retired/);
  });
});

describe("the office's answer", () => {
  beforeEach(async () => {
    retired();
    await requestClubRevival(casey, { clubId: "photo" });
    state.notices = [];
  });

  it("approving reinstates the club and seats the student who asked as President, told once", async () => {
    await expect(approveClubRevival(alex, { clubId: "photo", note: "Welcome back!" })).resolves.toEqual({ status: "APPROVED", president: "Casey Lin" });
    expect(state.club!.status).toBe("APPROVED");
    expect(state.tasks[0].status).toBe("DONE");
    expect(state.granted).toEqual([{ clubId: "photo", userId: "casey", role: "PRESIDENT", positionId: "seat-president", assignedById: "alex", checkSeat: true, notifyHolder: false }]);
    expect(state.notices.map((n) => `${n.kind} → ${n.to.join(",")}`)).toEqual(["club.revival_approved → casey"]);
    expect(state.notices[0].body).toBe("Welcome back!");
    expect(state.logs).toEqual(["club.revival_requested", "club.reinstated", "club.revival_approved"]);
    await expect(approveClubRevival(alex, { clubId: "photo" })).rejects.toThrow(/already decided/);
  });

  it("returns a never-approved club to draft, with the student as President", async () => {
    state.club!.approvedAt = null;
    await expect(approveClubRevival(alex, { clubId: "photo" })).resolves.toMatchObject({ status: "DRAFT" });
  });

  it("is a fresh start: former leaders' seats don't come back, so the student who asked is the only President", async () => {
    state.restored = [
      { clubId: "photo", userId: "p1", role: "PRESIDENT", positionId: "seat-president" },
      { clubId: "photo", userId: "p2", role: "OFFICER", positionId: "seat-treasurer" },
    ];
    await approveClubRevival(alex, { clubId: "photo" });
    expect(state.club!.status).toBe("APPROVED");
    expect(state.granted).toEqual([{ clubId: "photo", userId: "casey", role: "PRESIDENT", positionId: "seat-president", assignedById: "alex", checkSeat: true, notifyHolder: false }]);
  });

  it("can't make a graduate President: decline instead", async () => {
    state.tasks[0].createdById = "jo";
    await expect(approveClubRevival(alex, { clubId: "photo" })).rejects.toThrow(/active student account/);
    expect(state.tasks[0].status).toBe("OPEN");
  });

  it("declining needs a note, and the student hears it", async () => {
    await expect(declineClubRevival(alex, { clubId: "photo", note: "" })).rejects.toThrow(/Add a note/);
    await declineClubRevival(alex, { clubId: "photo", note: "Its department ended the program." });
    expect(state.tasks[0].status).toBe("CANCELLED");
    expect(state.club!.status).toBe("RETIRED");
    expect(state.notices).toEqual([{ kind: "club.revival_declined", to: ["casey"], title: "WSUSA isn't bringing Photographic Society back right now", body: "Its department ended the program." }]);
  });

  it("is only for the club's office: another office's staff don't find it", async () => {
    await expect(approveClubRevival(rowan, { clubId: "photo" })).rejects.toThrow(/wasn't found/);
  });
});

describe("a forming club being decided", () => {
  beforeEach(() => {
    state.club = { id: "puzzle", name: "Wildcat Puzzle Society", slug: "wildcat-puzzle-society", status: "SUBMITTED", type: "REGISTERED", officeId: null, listedAsForming: true, approvedAt: null, requestedDepartmentName: null, departmentId: null };
    state.cofounderInvites = [{ id: "ci1", clubId: "puzzle", status: "PENDING", inviteeId: "sam" }];
  });

  it("approval takes it off the forming list and tells its followers it's official", async () => {
    await decideClub(alex, { clubId: "puzzle", decision: "APPROVE" });
    expect(state.clubUpdates[0]).toMatchObject({ status: "APPROVED", listedAsForming: false });
    expect(state.cofounderInvites[0].status).toBe("CANCELLED");
    expect(state.resolved).toContain("cofounderInvite:ci1:CANCELLED");
    const sent = state.notices.map((n) => `${n.kind} → ${n.to.join(",")}`);
    // The founding team hears from WSUSA (leaders with the workspace link, a co-founder without a seat with the club's page);
    // followers and the invitee whose invitation closed hear it's official.
    expect(sent).toEqual(["club.approved → frank", "club.approved → taylor", "club.forming_approved → maya,sam"]);
    expect(state.notices[2].title).toBe("Wildcat Puzzle Society is now an official Weber State club");
  });

  it("rejection takes it off the list too, without telling followers anything", async () => {
    await decideClub(alex, { clubId: "puzzle", decision: "REJECT", note: "Not this time." });
    expect(state.clubUpdates[0]).toMatchObject({ status: "REJECTED", listedAsForming: false });
    expect(state.notices.map((n) => n.kind)).toEqual(["club.rejected", "club.rejected"]);
  });

  it("asking for changes leaves it listed: it's still forming", async () => {
    await decideClub(alex, { clubId: "puzzle", decision: "CHANGES", note: "Add bylaws." });
    expect(state.clubUpdates[0]).not.toHaveProperty("listedAsForming");
    expect(state.cofounderInvites[0].status).toBe("PENDING");
    // Only the leaders can act on the changes, so only they hear.
    expect(state.notices.map((n) => `${n.kind} → ${n.to.join(",")}`)).toEqual(["club.changes_requested → frank"]);
  });
});
