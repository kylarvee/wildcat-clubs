import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Co-founder invitations (lib/domain/cofounders) against a small in-memory
 * database: only students may be co-founders, only founders invite, at most
 * COFOUNDER_PENDING_CAP wait at once, accepting makes the invitee a member
 * with source FOUNDER (so a founder can seat them), and cancel closes the
 * invitation and its task.
 */

type Invite = { id: string; clubId: string; name: string; email: string; token: string; status: string; invitedById: string; inviteeId: string | null; createdAt: Date; respondedAt: Date | null };
type Member = { userId: string; clubId: string; status: string; source: string; joinedAt: Date | null; endedAt: Date | null };

const state = vi.hoisted(() => ({
  clubs: new Map<string, { id: string; name: string; slug: string; status: string; createdById: string; shortDescription: string }>(),
  users: [] as { id: string; email: string; kind: string; status: string }[],
  members: [] as Member[],
  subs: [] as { userId: string; clubId: string }[],
  invites: [] as Invite[],
  access: new Map<string, Record<string, unknown>>(),
  tasks: [] as { source: string; id: string; assignee: string; status: string }[],
  notices: [] as { kind: string; to: string[] }[],
  emails: [] as { to: string; subject: string }[],
  logs: [] as string[],
  seq: 0,
}));

const club = (id: string) => state.clubs.get(id) ?? null;
const inviteOf = (where: { id?: string; token?: string }) => state.invites.find((i) => (where.id ? i.id === where.id : i.token === where.token)) ?? null;

vi.mock("@/lib/db", () => {
  const db = {
    club: { findUnique: async ({ where }: { where: { id: string } }) => club(where.id) },
    user: {
      findFirst: async ({ where }: { where: { email: { equals: string }; kind?: string; status?: string } }) =>
        state.users.find((u) => u.email.toLowerCase() === where.email.equals.toLowerCase() && (!where.kind || u.kind === where.kind) && (!where.status || u.status === where.status)) ?? null,
    },
    membership: {
      count: async ({ where }: { where: { userId: string; clubId: string; status: string } }) => state.members.filter((m) => m.userId === where.userId && m.clubId === where.clubId && m.status === where.status).length,
      findUnique: async ({ where }: { where: { userId_clubId: { userId: string; clubId: string } } }) => state.members.find((m) => m.userId === where.userId_clubId.userId && m.clubId === where.userId_clubId.clubId) ?? null,
      upsert: async ({ where, create, update }: { where: { userId_clubId: { userId: string; clubId: string } }; create: Member; update: Partial<Member> }) => {
        const m = state.members.find((x) => x.userId === where.userId_clubId.userId && x.clubId === where.userId_clubId.clubId);
        if (m) return Object.assign(m, update);
        const row: Member = { ...create, endedAt: create.endedAt ?? null };
        state.members.push(row);
        return row;
      },
    },
    calendarSubscription: {
      upsert: async ({ where }: { where: { userId_clubId: { userId: string; clubId: string } } }) => {
        if (!state.subs.some((s) => s.userId === where.userId_clubId.userId && s.clubId === where.userId_clubId.clubId)) state.subs.push({ ...where.userId_clubId });
      },
    },
    cofounderInvite: {
      findUnique: async ({ where }: { where: { id?: string; token?: string } }) => {
        const i = inviteOf(where);
        return i ? { ...i, club: club(i.clubId), invitedBy: { name: "Frank Okafor", email: "frank@mail.weber.edu" } } : null;
      },
      findMany: async ({ where }: { where: { clubId: string; status: string } }) => state.invites.filter((i) => i.clubId === where.clubId && i.status === where.status),
      create: async ({ data }: { data: Omit<Invite, "id" | "status" | "createdAt" | "respondedAt"> }) => {
        const row = { id: `inv${++state.seq}`, status: "PENDING", createdAt: new Date(), respondedAt: null, ...data };
        state.invites.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Invite> }) => Object.assign(inviteOf(where)!, data),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<Invite> }) => {
        const i = inviteOf(where);
        if (!i || i.status !== where.status) return { count: 0 };
        Object.assign(i, data);
        return { count: 1 };
      },
    },
    task: { count: async ({ where }: { where: { sourceId: string; status: string } }) => state.tasks.filter((t) => t.id === where.sourceId && t.status === where.status).length },
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db };
});
vi.mock("@/lib/authz", async (original) => ({
  ...(await original<object>()),
  getClubAccess: async (actor: { id: string }, clubId: string) => state.access.get(`${actor.id}:${clubId}`) ?? null,
}));
vi.mock("@/lib/lake/activity", () => ({ logActivity: async (a: { action: string }) => void state.logs.push(a.action) }));
vi.mock("@/lib/offices", () => ({ officeForClub: async () => ({ name: "WSUSA" }) }));
vi.mock("@/lib/domain/tasks", () => ({
  createTask: async (t: { source: { type: string; id: string }; assignee: { userId: string } }) => void state.tasks.push({ source: t.source.type, id: t.source.id, assignee: t.assignee.userId, status: "OPEN" }),
  resolveTasks: async (type: string, id: string, _by: string, _tx?: unknown, status = "DONE") => {
    for (const t of state.tasks) if (t.source === type && t.id === id && t.status === "OPEN") t.status = status;
  },
}));
vi.mock("@/lib/domain/notify", () => ({
  notify: async (n: { kind: string; userIds: string[]; exceptUserId?: string }) => void state.notices.push({ kind: n.kind, to: [...new Set(n.userIds)].filter((u) => u !== n.exceptUserId) }),
  emailAddress: async (to: string, subject: string) => void state.emails.push({ to, subject }),
}));
vi.mock("@/lib/domain/clubs", async () => {
  const { invalid } = await vi.importActual<typeof import("@/lib/domain/kit")>("@/lib/domain/kit");
  return {
    clubLeaderIds: async () => ["frank"],
    parseForm: (schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: { message: string }[] } } }, input: unknown) => {
      const r = schema.safeParse(input);
      if (!r.success) throw invalid(r.error!.issues[0].message);
      return r.data;
    },
  };
});
vi.mock("@/lib/domain/advisors", () => ({ newInviteToken: () => `token-${++state.seq}` }));

import { acceptCofounderInvite, cancelCofounderInvite, declineCofounderInvite, inviteCofounder } from "@/lib/domain/cofounders";
import { COFOUNDER_PENDING_CAP } from "@/lib/founding/rules";

const person = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, email: `${id}@mail.weber.edu`, name: id === "frank" ? "Frank Okafor" : id, handle: id, kind: "STUDENT", platformRole: "USER", status: "ACTIVE", avatarColor: "#000", avatarUrl: null, officeIds: [], fundingOfficeIds: [], ...over }) as never;
const frank = person("frank");
const taylor = person("taylor");
const sam = person("sam");

beforeEach(() => {
  state.clubs = new Map([["bee", { id: "bee", name: "Wildcat Beekeeping Society", slug: "bee", status: "DRAFT", createdById: "frank", shortDescription: "Hives on campus." }]]);
  state.users = [
    { id: "frank", email: "frank@mail.weber.edu", kind: "STUDENT", status: "ACTIVE" },
    { id: "sam", email: "sam@mail.weber.edu", kind: "STUDENT", status: "ACTIVE" },
    { id: "gwen", email: "gwen@mail.weber.edu", kind: "STUDENT", status: "ALUMNI" },
  ];
  state.members = [{ userId: "frank", clubId: "bee", status: "ACTIVE", source: "FOUNDER", joinedAt: new Date(), endedAt: null }];
  state.subs = [];
  state.invites = [];
  state.access = new Map([
    ["frank:bee", { role: "PRESIDENT", rank: 3, suspended: false, isLeader: true, isMember: true, viaPlatform: null }],
    ["taylor:bee", { role: "VP", rank: 2, suspended: false, isLeader: true, isMember: true, viaPlatform: null }],
  ]);
  state.tasks = [];
  state.notices = [];
  state.emails = [];
  state.logs = [];
  state.seq = 0;
});

describe("inviting a co-founder", () => {
  it("takes students only: a staff address or a graduate is turned away", async () => {
    await expect(inviteCofounder(frank, "bee", { name: "Dr. Lee", email: "jordan.lee@weber.edu" })).rejects.toThrow(/Co-founders are students/);
    await expect(inviteCofounder(frank, "bee", { name: "Gwen", email: "gwen@mail.weber.edu" })).rejects.toThrow(/graduated/);
    expect(state.invites).toEqual([]);
  });

  it("is for the founders only: the President or whoever started the club", async () => {
    await expect(inviteCofounder(taylor, "bee", { name: "Sam Rivera", email: "sam@mail.weber.edu" })).rejects.toThrow(/founders/);
    state.clubs.get("bee")!.status = "APPROVED";
    await expect(inviteCofounder(frank, "bee", { name: "Sam Rivera", email: "sam@mail.weber.edu" })).rejects.toThrow(/join it from its club page/);
  });

  it("gives an invitee with an account a task and a notification, and emails anyone else", async () => {
    await inviteCofounder(frank, "bee", { name: "Sam Rivera", email: "Sam@Mail.Weber.edu" });
    expect(state.tasks).toEqual([{ source: "cofounderInvite", id: state.invites[0].id, assignee: "sam", status: "OPEN" }]);
    expect(state.invites[0]).toMatchObject({ email: "sam@mail.weber.edu", inviteeId: "sam", invitedById: "frank", status: "PENDING" });
    expect(state.notices).toEqual([{ kind: "cofounder.invited", to: ["sam"] }]);
    await inviteCofounder(frank, "bee", { name: "Jordan Lee", email: "jordan.lee@mail.weber.edu" });
    expect(state.emails.map((e) => e.to)).toEqual(["jordan.lee@mail.weber.edu"]);
    expect(state.logs).toEqual(["cofounder.invited", "cofounder.invited"]);
  });

  it("won't invite someone twice, or anyone already in the club", async () => {
    await inviteCofounder(frank, "bee", { name: "Sam Rivera", email: "sam@mail.weber.edu" });
    await expect(inviteCofounder(frank, "bee", { name: "Sam Rivera", email: "sam@mail.weber.edu" })).rejects.toThrow(/already have an invitation/);
    await expect(inviteCofounder(frank, "bee", { name: "Frank", email: "frank@mail.weber.edu" })).rejects.toThrow(/your own email/);
  });

  it(`caps waiting invitations at ${COFOUNDER_PENDING_CAP}`, async () => {
    for (let i = 0; i < COFOUNDER_PENDING_CAP; i++) await inviteCofounder(frank, "bee", { name: `Student ${i}`, email: `student${i}@mail.weber.edu` });
    await expect(inviteCofounder(frank, "bee", { name: "One More", email: "onemore@mail.weber.edu" })).rejects.toThrow(new RegExp(`${COFOUNDER_PENDING_CAP} invitations are already waiting`));
    // Answering one makes room.
    await cancelCofounderInvite(frank, state.invites[0].id);
    await expect(inviteCofounder(frank, "bee", { name: "One More", email: "onemore@mail.weber.edu" })).resolves.toBeTruthy();
  });
});

describe("answering", () => {
  beforeEach(async () => {
    await inviteCofounder(frank, "bee", { name: "Sam Rivera", email: "sam@mail.weber.edu" });
  });
  const token = () => state.invites[0].token;

  it("accepting makes the invitee a member with source FOUNDER, ready to be seated", async () => {
    await expect(acceptCofounderInvite(sam, token())).resolves.toEqual({ slug: "bee" });
    expect(state.members.find((m) => m.userId === "sam")).toMatchObject({ clubId: "bee", status: "ACTIVE", source: "FOUNDER" });
    expect(state.subs).toEqual([{ userId: "sam", clubId: "bee" }]);
    expect(state.invites[0].status).toBe("ACCEPTED");
    expect(state.tasks[0].status).toBe("DONE");
    expect(state.notices.at(-1)).toEqual({ kind: "cofounder.accepted", to: ["frank"] });
    await expect(acceptCofounderInvite(sam, token())).rejects.toThrow(/already answered/);
  });

  it("only the invited student can answer, while the club is being founded", async () => {
    await expect(acceptCofounderInvite(taylor, token())).rejects.toThrow(/for someone else/);
    await expect(acceptCofounderInvite(person("sam", { kind: "FACULTY_STAFF" }), token())).rejects.toThrow(/student accounts/);
    state.clubs.get("bee")!.status = "APPROVED";
    await expect(acceptCofounderInvite(sam, token())).rejects.toThrow(/already approved/);
    expect(state.members.some((m) => m.userId === "sam")).toBe(false);
  });

  it("declining tells the founders and makes nobody a member", async () => {
    await declineCofounderInvite(sam, token());
    expect(state.invites[0].status).toBe("DECLINED");
    expect(state.members.some((m) => m.userId === "sam")).toBe(false);
    expect(state.notices.at(-1)).toEqual({ kind: "cofounder.declined", to: ["frank"] });
  });

  it("cancelling closes the invitation and its task, so it can't be accepted", async () => {
    await cancelCofounderInvite(frank, state.invites[0].id);
    expect(state.invites[0].status).toBe("CANCELLED");
    expect(state.tasks[0].status).toBe("CANCELLED");
    await expect(acceptCofounderInvite(sam, token())).rejects.toThrow(/cancelled/);
    await expect(cancelCofounderInvite(frank, state.invites[0].id)).rejects.toThrow(/already answered or cancelled/);
    await expect(cancelCofounderInvite(taylor, state.invites[0].id)).rejects.toThrow(/founders/);
  });
});
