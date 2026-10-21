import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The office's review decisions (lib/domain/events approveEventReview,
 * requestEventChanges): only the club's office, or WSUSA's admins, decide;
 * approving posts the event and sends the co-host invitations it held back
 * (a club that approves co-hosts automatically is added, every other club is
 * asked); asking for changes keeps it hidden with the note; a cancelled event
 * has nothing to review. The database is a small in-memory fake.
 */

type Cohost = { id: string; eventId: string; status: string; decidedAt: Date | null; club: { id: string; name: string; slug: string; autoApproveCohosts: boolean } };
type FakeTask = { sourceType: string; sourceId: string; status: string; title: string };

const state = vi.hoisted(() => ({
  event: null as Record<string, unknown> | null,
  cohosts: [] as Cohost[],
  tasks: [] as FakeTask[],
  notices: [] as { kind: string; to: string; title: string; body: string }[],
  logs: [] as string[],
  google: [] as string[],
}));

const pick = (row: Cohost) => ({ id: row.id, club: row.club });

vi.mock("@/lib/db", () => {
  const tx = {
    event: {
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.event!, data),
    },
    eventCohost: {
      findMany: async ({ where }: { where: { eventId: string; status: string } }) => state.cohosts.filter((c) => c.eventId === where.eventId && c.status === where.status).map(pick),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: Partial<Cohost> }) => {
        for (const c of state.cohosts) if (where.id.in.includes(c.id)) Object.assign(c, data);
        return { count: where.id.in.length };
      },
    },
    task: {
      findMany: async ({ where }: { where: { sourceType: string; sourceId: { in: string[] }; status: string } }) =>
        state.tasks.filter((t) => t.sourceType === where.sourceType && where.sourceId.in.includes(t.sourceId) && t.status === where.status),
    },
  };
  return {
    db: {
      ...tx,
      event: {
        ...tx.event,
        findUnique: async ({ where }: { where: { id: string } }) => (state.event?.id === where.id ? state.event : null),
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock("@/lib/domain/tasks", () => ({
  createTask: async (t: { title: string; source: { type: string; id: string } }) => {
    state.tasks.push({ sourceType: t.source.type, sourceId: t.source.id, status: "OPEN", title: t.title });
  },
  resolveTasks: async (sourceType: string, sourceId: string, _by: string | null, _tx?: unknown, status = "DONE") => {
    for (const t of state.tasks) if (t.sourceType === sourceType && t.sourceId === sourceId && t.status === "OPEN") t.status = status;
  },
}));
vi.mock("@/lib/domain/notify", () => ({
  notify: async (n: { kind: string; userIds: string[]; title: string; body: string; exceptUserId?: string }) => {
    for (const u of new Set(n.userIds)) if (u !== n.exceptUserId) state.notices.push({ kind: n.kind, to: u, title: n.title, body: n.body });
  },
  notifyClubCapability: async (clubId: string, _cap: string, n: { kind: string; title: string; body: string }) => {
    state.notices.push({ kind: n.kind, to: `club:${clubId}`, title: n.title, body: n.body });
  },
}));
vi.mock("@/lib/authz/people", async (original) => ({ ...(await original<object>()), clubCapabilityHolders: async () => ["u-events"] }));
vi.mock("@/lib/lake/activity", () => ({ logActivity: async (a: { action: string }) => void state.logs.push(a.action) }));
vi.mock("@/lib/search/fresh", () => ({ reindexClubSoon: () => {}, reindexEventClubsSoon: () => {} }));
vi.mock("@/lib/integrations/google-calendar", () => ({
  syncEventToGoogle: async (id: string) => {
    state.google.push(id);
    return { status: "skipped", message: null };
  },
  removeEventFromGoogle: async () => {},
}));

import { approveEventReview, requestEventChanges } from "@/lib/domain/events";

const person = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, email: `${id}@weber.edu`, name: id, handle: id, kind: "STAFF", platformRole: "USER", status: "ACTIVE", avatarColor: "#492365", avatarUrl: null, officeIds: [] as string[], fundingOfficeIds: [] as string[], ...over }) as never;

const alex = person("u-alex", { platformRole: "ADMIN" });
const rowan = person("u-rowan", { officeIds: ["o-rec"] });
const fsl = person("u-fsl", { officeIds: ["o-fsl"] });
const priya = person("u-priya", { kind: "STUDENT" });

function waiting(over: Record<string, unknown> = {}, officeId: string | null = null) {
  state.event = {
    id: "e1",
    title: "Robot Demo at Roy High",
    clubId: "club1",
    createdById: "u-priya",
    status: "SCHEDULED",
    reviewStatus: "PENDING",
    reviewNote: null,
    riskFlags: ["MINORS", "TRAVEL"],
    locationType: "ADDRESS",
    virtualUrl: null,
    cohostAllClubs: false,
    club: { id: "club1", name: "RC Wrecker Bots Club", slug: "rc-wrecker-bots-club", type: "REGISTERED", status: "APPROVED", departmentId: null, officeId },
    ...over,
  };
  state.tasks.push({ sourceType: "eventReview", sourceId: "e1", status: "OPEN", title: "Review “Robot Demo at Roy High” (RC Wrecker Bots Club)" });
}

const club = (id: string, autoApproveCohosts: boolean) => ({ id, name: `Club ${id}`, slug: id, autoApproveCohosts });
const kinds = () => state.notices.map((n) => `${n.kind} → ${n.to}`).sort();

beforeEach(() => {
  state.event = null;
  state.cohosts = [];
  state.tasks = [];
  state.notices = [];
  state.logs = [];
  state.google = [];
});

describe("approving an event", () => {
  it("posts it: the office's task is done, Google gets its copy, and the club hears with the reviewer's note", async () => {
    waiting();
    await approveEventReview(alex, "e1", { note: "Bring the signed permission slips." });
    expect(state.event).toMatchObject({ reviewStatus: "APPROVED", reviewNote: "Bring the signed permission slips.", reviewedById: "u-alex" });
    expect(state.tasks.map((t) => [t.sourceType, t.status])).toEqual([["eventReview", "DONE"]]);
    expect(state.google).toEqual(["e1"]);
    expect(state.logs).toEqual(["event.review_approved"]);
    expect(kinds()).toEqual(["event.review_approved → u-events", "event.review_approved → u-priya"]);
    expect(state.notices[0].body).toBe("It's posted now. A note from the reviewer: Bring the signed permission slips.");
  });

  it("sends the co-host invitations it held: a club that approves co-hosts automatically is added, the others are asked", async () => {
    waiting();
    state.cohosts = [
      { id: "ch-auto", eventId: "e1", status: "PENDING", decidedAt: null, club: club("c-auto", true) },
      { id: "ch-ask", eventId: "e1", status: "PENDING", decidedAt: null, club: club("c-ask", false) },
      { id: "ch-old", eventId: "e1", status: "APPROVED", decidedAt: new Date("2026-10-01"), club: club("c-old", true) },
    ];
    await approveEventReview(alex, "e1");
    expect(state.cohosts.map((c) => [c.id, c.status])).toEqual([
      ["ch-auto", "APPROVED"],
      ["ch-ask", "PENDING"],
      ["ch-old", "APPROVED"],
    ]);
    expect(state.tasks.filter((t) => t.sourceType === "cohost").map((t) => [t.sourceId, t.status])).toEqual([["ch-ask", "OPEN"]]);
    expect(kinds()).toEqual(["event.cohost_added → club:c-auto", "event.cohost_request → club:c-ask", "event.review_approved → u-events", "event.review_approved → u-priya"]);
  });

  it("is up to the club's office, or WSUSA's admins: another office's staff can't see it", async () => {
    waiting({}, "o-rec");
    await expect(approveEventReview(fsl, "e1")).rejects.toThrow("Club wasn't found.");
    await expect(approveEventReview(priya, "e1")).rejects.toThrow("You don't have permission to do that.");
    await expect(approveEventReview(null, "e1")).rejects.toThrow("Please sign in first.");
    expect(state.event).toMatchObject({ reviewStatus: "PENDING" });
    await approveEventReview(rowan, "e1");
    expect(state.event).toMatchObject({ reviewStatus: "APPROVED", reviewedById: "u-rowan" });
  });

  it("leaves a WSUSA club's event to WSUSA's admins", async () => {
    waiting();
    await expect(approveEventReview(rowan, "e1")).rejects.toThrow("Club wasn't found.");
    await approveEventReview(alex, "e1");
    expect(state.event).toMatchObject({ reviewStatus: "APPROVED" });
  });

  it("can still approve one it sent back", async () => {
    waiting({ reviewStatus: "CHANGES_REQUESTED", reviewNote: "Add the second driver." });
    await approveEventReview(alex, "e1", {});
    expect(state.event).toMatchObject({ reviewStatus: "APPROVED", reviewNote: null });
  });

  it("has nothing to do for an approved, unreviewed or cancelled event", async () => {
    waiting({ reviewStatus: "APPROVED" });
    await expect(approveEventReview(alex, "e1")).rejects.toThrow("This event was already approved.");
    waiting({ reviewStatus: "NONE" });
    await expect(approveEventReview(alex, "e1")).rejects.toThrow("This event isn't waiting for review.");
    waiting({ status: "CANCELLED" });
    await expect(approveEventReview(alex, "e1")).rejects.toThrow(/cancelled, so there's nothing to review/);
    expect(state.notices).toEqual([]);
  });
});

describe("asking for changes", () => {
  it("sends it back with the note, still hidden, and closes the office's task", async () => {
    waiting({}, "o-rec");
    await requestEventChanges(rowan, "e1", { note: "Add the second driver's name and a phone number." });
    expect(state.event).toMatchObject({ reviewStatus: "CHANGES_REQUESTED", reviewNote: "Add the second driver's name and a phone number.", reviewedById: "u-rowan" });
    expect(state.tasks.map((t) => t.status)).toEqual(["DONE"]);
    expect(state.logs).toEqual(["event.review_changes_requested"]);
    expect(kinds()).toEqual(["event.review_changes_requested → u-events", "event.review_changes_requested → u-priya"]);
    expect(state.notices[0].body).toBe("Add the second driver's name and a phone number. Save your changes in the Events Builder to send it back for review.");
    expect(state.google).toEqual([]);
  });

  it("needs a note, and only once per submission", async () => {
    waiting();
    await expect(requestEventChanges(alex, "e1", { note: "no" })).rejects.toThrow(/what to change/);
    await requestEventChanges(alex, "e1", { note: "Say who's chaperoning." });
    await expect(requestEventChanges(alex, "e1", { note: "Say who's chaperoning." })).rejects.toThrow(/already asked for/);
    waiting({ status: "CANCELLED" });
    await expect(requestEventChanges(alex, "e1", { note: "Say who's chaperoning." })).rejects.toThrow(/cancelled/);
  });
});
