import { beforeEach, describe, expect, it, vi } from "vitest";

/** Following a forming club (lib/domain/memberships subscribeCalendar): listed forming clubs and approved clubs only. */

const state = vi.hoisted(() => ({ club: null as { status: string; listedAsForming: boolean } | null, subs: [] as string[] }));

vi.mock("@/lib/db", () => ({
  db: {
    club: { findUnique: async () => state.club },
    calendarSubscription: { upsert: async ({ where }: { where: { userId_clubId: { userId: string } } }) => void state.subs.push(where.userId_clubId.userId) },
  },
}));
vi.mock("@/lib/auth/accounts", () => ({ newCalendarToken: () => "t" }));
vi.mock("@/lib/lake/activity", () => ({ logActivity: async () => {} }));
vi.mock("@/lib/domain/tasks", () => ({ createTask: async () => {}, resolveTasks: async () => {} }));
vi.mock("@/lib/domain/notify", () => ({ notify: async () => {}, notifyClubCapability: async () => {} }));
vi.mock("@/lib/domain/requirements", () => ({ reopenRequirementTasks: async () => {}, syncUserRequirements: async () => {} }));
vi.mock("@/lib/domain/staffing", () => ({ staffingAfterRoleChange: async () => {} }));

import { subscribeCalendar } from "@/lib/domain/memberships";

const maya = { id: "maya", email: "maya@mail.weber.edu", name: "Maya", handle: "maya", kind: "STUDENT", platformRole: "USER", status: "ACTIVE", avatarColor: "#000", avatarUrl: null, officeIds: [], fundingOfficeIds: [] } as never;

beforeEach(() => {
  state.subs = [];
});

describe("following a club", () => {
  it("works for a club listed as forming, so its followers hear when it's approved", async () => {
    for (const status of ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED"]) {
      state.club = { status, listedAsForming: true };
      await subscribeCalendar(maya, "c1");
    }
    expect(state.subs).toEqual(["maya", "maya", "maya"]);
  });

  it("isn't possible for a founding club that isn't listed, or for signed-out visitors", async () => {
    state.club = { status: "DRAFT", listedAsForming: false };
    await expect(subscribeCalendar(maya, "c1")).rejects.toThrow(/wasn't found/);
    state.club = { status: "SUBMITTED", listedAsForming: true };
    await expect(subscribeCalendar(null, "c1")).rejects.toThrow(/sign in/);
    state.club = { status: "REJECTED", listedAsForming: true };
    await expect(subscribeCalendar(maya, "c1")).rejects.toThrow(/wasn't found/);
    expect(state.subs).toEqual([]);
  });

  it("still works for approved clubs", async () => {
    state.club = { status: "APPROVED", listedAsForming: false };
    await subscribeCalendar(maya, "c1");
    expect(state.subs).toEqual(["maya"]);
  });
});
