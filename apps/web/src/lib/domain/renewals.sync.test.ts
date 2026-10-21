import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The per-club renewal sync (lib/domain/renewals syncClubRenewal), against a
 * small fake database: a President who takes office while the club hasn't
 * renewed gets "Renew … for 2026–27" at once and the outgoing President's
 * task is cancelled, through the same hook every role change runs
 * (renewalAfterRoleChange); nothing happens without a renewal window or once
 * the club renewed; and the daily job syncs only the clubs that are out of
 * line, through the same function.
 */

type Row = Record<string, unknown> & { id: string; status: string; sourceType: string; sourceId: string | null; assigneeId: string | null };
const state = vi.hoisted(() => ({
  tasks: [] as Row[],
  club: null as Record<string, unknown> | null,
  terms: [] as { name: string; academicYear: string; startsOn: Date; endsOn: Date }[],
  notices: [] as { userIds: string[]; kind: string; title: string; body?: string; href?: string }[],
  locks: 0,
}));

const fakeDb = vi.hoisted(() => {
  const inIds = (where: { id?: { in: string[] }; status?: string }, t: Row) => (!where.id || where.id.in.includes(t.id)) && (!where.status || t.status === where.status);
  const tx = {
    $queryRaw: async () => {
      state.locks++;
      return [];
    },
    task: {
      findMany: async ({ where }: { where: { sourceType: string; status: string; sourceId?: { startsWith: string } } }) =>
        state.tasks.filter((t) => t.sourceType === where.sourceType && t.status === where.status && (!where.sourceId || (t.sourceId ?? "").startsWith(where.sourceId.startsWith))),
      updateMany: async ({ where, data }: { where: { id?: { in: string[] }; status?: string }; data: Record<string, unknown> }) => {
        const hit = state.tasks.filter((t) => inIds(where, t));
        for (const t of hit) Object.assign(t, data);
        return { count: hit.length };
      },
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const d of data) state.tasks.push({ id: `new-${String(d.assigneeId)}`, status: "OPEN", ...d } as Row);
        return { count: data.length };
      },
    },
  };
  return { ...tx, $transaction: async <T,>(fn: (t: typeof tx) => Promise<T>) => fn(tx) };
});

vi.mock("@/lib/db", () => ({ db: fakeDb }));
vi.mock("@/lib/renewals/facts", () => ({
  loadRenewalStates: async (_client: unknown, opts: { clubIds?: string[] }) => {
    const c = state.club as { club: { id: string } } | null;
    return c && (!opts.clubIds || opts.clubIds.includes(c.club.id)) ? [c] : [];
  },
}));
vi.mock("@/lib/offices", () => ({ umbrellaOffice: async () => ({ name: "WSUSA" }) }));
vi.mock("@/lib/domain/notify", () => ({ notify: async (n: (typeof state.notices)[number]) => void state.notices.push(n) }));
vi.mock("@/lib/terms", () => ({ getTerms: async () => state.terms }));
vi.mock("@/lib/config", () => ({ getConfig: async () => ({ "renewal.dueDays": 30 }) }));

import { campusDate } from "@/lib/time";
import { renewalAfterRoleChange } from "@/lib/domain/renewals";
import { syncRenewalTasks } from "@/lib/jobs/renewals";
import { renewalSourceId, renewalTaskTitle, renewalWindow, type RenewalHolder } from "@/lib/renewals/rules";

const term = (name: string, academicYear: string, start: [number, number, number], end: [number, number, number]) => ({
  name,
  academicYear,
  startsOn: campusDate(...start),
  endsOn: campusDate(end[0], end[1], end[2], 23, 59),
});
const TERMS = [term("Spring 2026", "2025-2026", [2026, 1, 5], [2026, 5, 1]), term("Fall 2026", "2026-2027", [2026, 8, 31], [2026, 12, 18])];
const NOW = campusDate(2026, 10, 20, 12);
const window = renewalWindow(TERMS, NOW, 30)!;
const SOURCE = renewalSourceId("chess", window.year);
const TITLE = renewalTaskTitle("Chess Club", window.year);

const ana: RenewalHolder = { id: "ana", name: "Ana Lee", role: "PRESIDENT", since: campusDate(2026, 5, 1) };
const ben: RenewalHolder = { id: "ben", name: "Ben Ruiz", role: "PRESIDENT", since: campusDate(2026, 10, 20, 11, 58) };
const elena: RenewalHolder = { id: "elena", name: "Dr. Elena Alvarez", role: "ADVISOR", since: campusDate(2022, 9, 1) };

function club(holders: RenewalHolder[], over: Record<string, unknown> = {}) {
  return { club: { id: "chess", name: "Chess Club", slug: "chess-club", officeId: "campus-rec", office: { name: "Campus Recreation" } }, holders, renewal: null, exemption: null, ...over };
}
const openTask = (id: string, assigneeId: string): Row => ({ id, status: "OPEN", sourceType: "clubRenewal", sourceId: SOURCE, assigneeId, dueAt: window.dueAt, officeId: "campus-rec", title: TITLE });
const statusOf = (id: string) => state.tasks.find((t) => t.id === id)?.status;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.terms = TERMS;
  state.tasks = [openTask("t-ana", "ana"), openTask("t-elena", "elena")];
  state.club = club([ana, elena]);
  state.notices = [];
  state.locks = 0;
});
afterEach(() => vi.useRealTimers());

describe("a President change while the club hasn't renewed", () => {
  it("gives the new President the renewal task at once and cancels the outgoing President's", async () => {
    state.club = club([ben, elena]); // the hand-off just happened
    await renewalAfterRoleChange("chess");

    const bens = state.tasks.filter((t) => t.assigneeId === "ben");
    expect(bens).toHaveLength(1);
    expect(bens[0]).toMatchObject({ status: "OPEN", kind: "REQUIREMENT", required: true, title: "Renew Chess Club for 2026–27", dueAt: window.dueAt, officeId: "campus-rec", href: "/clubs/chess-club/manage#renewal", sourceId: SOURCE });
    expect(bens[0].description).toMatch(/^You took office after renewal opened, and the club hasn't re-registered with Campus Recreation yet/);
    expect(statusOf("t-ana")).toBe("CANCELLED");
    expect(statusOf("t-elena")).toBe("OPEN");
    // Only the new President hears about it, in words for someone who just took office.
    expect(state.notices).toEqual([
      { userIds: ["ben"], kind: "club.renewal_due", title: "Chess Club still needs to renew for 2026–27", body: expect.stringContaining("before you took office"), href: "/clubs/chess-club/manage#renewal" },
    ]);
    expect(state.locks).toBe(1);

    // Running it again (the job, another role change) changes nothing.
    await renewalAfterRoleChange("chess");
    expect(state.tasks.filter((t) => t.status === "OPEN").map((t) => t.assigneeId).sort()).toEqual(["ben", "elena"]);
    expect(state.notices).toHaveLength(1);
  });

  it("changes nothing without a renewal window, or for a club that isn't asked to renew", async () => {
    state.tasks = [];
    state.club = club([ben, elena]);
    state.terms = [];
    await renewalAfterRoleChange("chess");
    state.terms = TERMS;
    state.club = club([ben, elena], { exemption: "It was approved this academic year, so it renews starting next year." });
    await renewalAfterRoleChange("chess");
    expect(state.tasks).toEqual([]);
    expect(state.notices).toEqual([]);
  });

  it("changes nothing once the club renewed", async () => {
    state.tasks = [];
    state.club = club([ben, elena], { renewal: { submittedAt: campusDate(2026, 9, 14), submittedBy: { id: "ana", name: "Ana Lee" } } });
    await renewalAfterRoleChange("chess");
    expect(state.tasks).toEqual([]);
    expect(state.notices).toEqual([]);
  });

  it("never throws into the role change that ran it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.terms = null as unknown as typeof TERMS; // the calendar can't be read
    await expect(renewalAfterRoleChange("chess")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("the Club renewals job", () => {
  it("syncs only the clubs that are out of line, through the same per-club sync", async () => {
    await syncRenewalTasks(NOW);
    expect(state.locks).toBe(0); // already in line: nothing to do

    state.club = club([ben, elena]);
    const r = await syncRenewalTasks(NOW);
    expect(state.locks).toBe(1);
    expect(r).toMatchObject({ year: "2026–27", expected: 1, renewed: 0, opened: 1, clubs: 1, cancelled: 1 });
    expect(statusOf("t-ana")).toBe("CANCELLED");
  });

  it("cancels tasks for a club that's no longer on the list, and ones that name no club", async () => {
    state.club = null;
    state.tasks.push({ ...openTask("t-junk", "ana"), sourceId: "no-club-here" });
    const r = await syncRenewalTasks(NOW);
    expect(r.cancelled).toBe(3);
    expect(state.tasks.every((t) => t.status === "CANCELLED")).toBe(true);
  });
});
