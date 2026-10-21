import { describe, expect, it, vi } from "vitest";

/**
 * Every role write ends in staffingAfterRoleChange (lib/domain/roles,
 * memberships: the org chart, hand-offs, elections, advisor acceptance,
 * graduations), and it syncs the club's renewal tasks too, once per club,
 * even when the staffing check itself fails.
 */

const synced = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/domain/renewals", () => ({ renewalAfterRoleChange: async (clubId: string) => void synced.push(clubId) }));
vi.mock("@/lib/db", () => ({
  db: {
    club: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id === "broken") throw new Error("database down");
        return null; // a club that's gone: nothing to staff
      },
    },
  },
}));

import { staffingAfterRoleChange } from "@/lib/domain/staffing";

describe("staffingAfterRoleChange", () => {
  it("syncs each club's renewal once, after its staffing check, even if that check failed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await staffingAfterRoleChange(["chess", "chess", "broken"], { since: new Date(), actorId: "ana" });
    expect(synced).toEqual(["chess", "broken"]);
    spy.mockRestore();
  });
});
