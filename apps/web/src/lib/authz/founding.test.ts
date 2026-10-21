import { describe, expect, it } from "vitest";
import type { ClubAccess } from "@/lib/authz";
import { canAskToRevive, canSeeFormingClub, isFounder } from "@/lib/authz/founding";
import { foundersLine, isListedForming } from "@/lib/founding/rules";

/** Founding rules in the permission authority: forming visibility, who the founders are, who may ask to revive. */

const viewer = (over: Record<string, unknown> = {}) => ({ id: "u1", email: "u1@mail.weber.edu", name: "U", handle: "u", kind: "STUDENT", platformRole: "USER", status: "ACTIVE", avatarColor: "#000", avatarUrl: null, officeIds: [], fundingOfficeIds: [], ...over }) as never;
const access = (over: Partial<ClubAccess> = {}) => ({ role: "PRESIDENT", rank: 3, suspended: false, viaPlatform: null, isLeader: true, isMember: true, ...over }) as ClubAccess;

describe("a forming club's visibility", () => {
  const club = (status: string, listedAsForming = true) => ({ status, listedAsForming }) as never;

  it("is nothing at all for signed-out visitors", () => {
    expect(canSeeFormingClub(null, club("DRAFT"))).toBe(false);
    expect(canSeeFormingClub(null, club("SUBMITTED"))).toBe(false);
  });

  it("is for signed-in accounts while the club is being founded and listed", () => {
    for (const s of ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED"]) expect(canSeeFormingClub(viewer(), club(s)), s).toBe(true);
    expect(canSeeFormingClub(viewer({ kind: "FACULTY_STAFF" }), club("DRAFT"))).toBe(true);
  });

  it("ends when the club is decided, or when its founders take it off the list", () => {
    for (const s of ["APPROVED", "REJECTED", "RETIRED"]) expect(canSeeFormingClub(viewer(), club(s)), s).toBe(false);
    expect(canSeeFormingClub(viewer(), club("DRAFT", false))).toBe(false);
    expect(canSeeFormingClub(viewer({ status: "DEACTIVATED" }), club("DRAFT"))).toBe(false);
    expect(isListedForming({ status: "APPROVED", listedAsForming: true })).toBe(false);
  });

  it("shows founders' names only", () => {
    expect(foundersLine(["Frank Okafor"])).toBe("Frank Okafor");
    expect(foundersLine(["Frank Okafor", "Sam Rivera"])).toBe("Frank Okafor and Sam Rivera");
    expect(foundersLine(["A", "B", "C", "D", "E"])).toBe("A, B and 3 others");
  });
});

describe("the founders", () => {
  const founding = { createdById: "creator", status: "DRAFT" } as const;

  it("are the President while the club is being founded", () => {
    expect(isFounder(access(), founding, "someone")).toBe(true);
    expect(isFounder(access({ role: "VP", rank: 2 }), founding, "someone")).toBe(false);
  });

  it("include whoever started it while they hold a role (a faculty founder is its advisor)", () => {
    expect(isFounder(access({ role: "ADVISOR", rank: 4 }), founding, "creator")).toBe(true);
    expect(isFounder(access({ role: "MEMBER", rank: 0 }), founding, "creator")).toBe(false);
  });

  it("stop being founders once the club is decided, or while their permissions are paused", () => {
    expect(isFounder(access(), { createdById: "creator", status: "APPROVED" }, "creator")).toBe(false);
    expect(isFounder(access({ suspended: true }), founding, "creator")).toBe(false);
    expect(isFounder(null, founding, "creator")).toBe(false);
  });
});

describe("asking to revive a retired club", () => {
  it("is for current students, who'd lead it", () => {
    expect(canAskToRevive(viewer())).toBe(true);
    expect(canAskToRevive(viewer({ kind: "FACULTY_STAFF" }))).toBe(false);
    expect(canAskToRevive(viewer({ status: "ALUMNI" }))).toBe(false);
    expect(canAskToRevive(null)).toBe(false);
  });
});
