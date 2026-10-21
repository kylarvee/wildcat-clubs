import { describe, expect, it } from "vitest";
import { fundingOfficeId, OFFICE_KEYS, officeKeyForClub, routeAdminTask, storedOfficeId, UMBRELLA_TASK_SOURCES } from "@/lib/offices/rules";
import { adminClubWhere, adminFundingClubWhere, adminScope, can, canAdminClub, canAdminFunding, type PlatformAction } from "@/lib/authz";
import type { Actor } from "@/lib/auth/session";

/**
 * Offices (lib/offices/rules, lib/authz): the umbrella invariant, the
 * new-club rule, admin-task routing, and who administers which clubs.
 */

const actor = (over: Partial<Actor> = {}): Actor => ({
  id: "u1",
  email: "someone@weber.edu",
  name: "Someone",
  handle: "someone",
  kind: "FACULTY_STAFF",
  platformRole: "USER",
  status: "ACTIVE",
  avatarColor: "#000",
  avatarUrl: null,
  officeIds: [],
  fundingOfficeIds: [],
  ...over,
});

const alex = actor({ id: "alex", platformRole: "ADMIN" });
const sydney = actor({ id: "sydney", platformRole: "SYSADMIN" });
const rowan = actor({ id: "rowan", officeIds: ["rec"], fundingOfficeIds: ["rec"] });
const fslStaff = actor({ id: "fsl1", officeIds: ["fsl"], fundingOfficeIds: [] });
const student = actor({ id: "maya", kind: "STUDENT", email: "maya@mail.weber.edu" });

describe("the umbrella invariant", () => {
  it("stores the umbrella as null, never by id", () => {
    expect(storedOfficeId({ id: "wsusa-id", umbrella: true })).toBeNull();
    expect(storedOfficeId({ id: "rec", umbrella: false })).toBe("rec");
    expect(storedOfficeId(null)).toBeNull();
    expect(storedOfficeId(undefined)).toBeNull();
  });

  it("treats a club with no office as the umbrella's: only platform admins administer it", () => {
    const wsusaClub = { officeId: null };
    expect(canAdminClub(alex, wsusaClub)).toBe(true);
    expect(canAdminClub(sydney, wsusaClub)).toBe(true);
    expect(canAdminClub(rowan, wsusaClub)).toBe(false);
  });
});

describe("the new-club rule", () => {
  it("sends club sports to Campus Recreation, Greek chapters to FSL, and everything else to WSUSA", () => {
    expect(officeKeyForClub({ scope: "SPORTS", category: null })).toBe(OFFICE_KEYS.campusRec);
    expect(officeKeyForClub({ scope: "SPORTS", category: "STUDENT_LIFE" })).toBe(OFFICE_KEYS.campusRec);
    expect(officeKeyForClub({ scope: "UNIVERSITY", category: "FSL" })).toBe(OFFICE_KEYS.fsl);
    expect(officeKeyForClub({ scope: "COLLEGE", category: "ACADEMIC" })).toBe(OFFICE_KEYS.umbrella);
    expect(officeKeyForClub({ scope: "INDEPENDENT", category: null })).toBe(OFFICE_KEYS.umbrella);
  });

  it("lets the scope win when a club is both (Sports is checked first)", () => {
    expect(officeKeyForClub({ scope: "SPORTS", category: "FSL" })).toBe(OFFICE_KEYS.campusRec);
  });
});

describe("routing admin tasks", () => {
  const rec = { officeId: "rec", decidesFunding: true };
  const fsl = { officeId: "fsl", decidesFunding: false };

  it("sends a club's work to its office", () => {
    expect(routeAdminTask("club", rec)).toBe("rec");
    expect(routeAdminTask("clubStaffing", fsl)).toBe("fsl");
    expect(routeAdminTask("eventReview", rec)).toBe("rec");
    expect(routeAdminTask(null, rec)).toBe("rec");
  });

  it("keeps platform-wide work with the umbrella", () => {
    for (const source of UMBRELLA_TASK_SOURCES) expect(routeAdminTask(source, rec), source).toBeNull();
  });

  it("sends funding to the club's office only when it decides funding", () => {
    expect(routeAdminTask("funding", rec)).toBe("rec");
    expect(routeAdminTask("invoice", rec)).toBe("rec");
    expect(routeAdminTask("funding", fsl)).toBeNull();
    expect(routeAdminTask("invoice", fsl)).toBeNull();
    expect(fundingOfficeId(rec)).toBe("rec");
    expect(fundingOfficeId(fsl)).toBeNull();
  });

  it("gives tasks about WSUSA's clubs, or no club, to the umbrella", () => {
    expect(routeAdminTask("club", { officeId: null, decidesFunding: true })).toBeNull();
    expect(routeAdminTask("testAttempt", null)).toBeNull();
  });
});

describe("who administers which clubs", () => {
  it("gives platform admins every club", () => {
    expect(adminScope(alex)).toEqual({ all: true, officeIds: [] });
    expect(adminClubWhere(alex)).toEqual({});
    expect(adminClubWhere(sydney)).toEqual({});
    expect(canAdminClub(alex, { officeId: "rec" })).toBe(true);
  });

  it("gives office staff their own office's clubs only", () => {
    expect(adminScope(rowan)).toEqual({ all: false, officeIds: ["rec"] });
    expect(adminClubWhere(rowan)).toEqual({ officeId: { in: ["rec"] } });
    expect(canAdminClub(rowan, { officeId: "rec" })).toBe(true);
    expect(canAdminClub(rowan, { officeId: "fsl" })).toBe(false);
    expect(canAdminClub(fslStaff, { officeId: "rec" })).toBe(false);
  });

  it("gives everyone else no clubs: an impossible filter", () => {
    expect(adminScope(student)).toEqual({ all: false, officeIds: [] });
    expect(adminClubWhere(student)).toEqual({ id: { in: [] } });
    expect(adminClubWhere(null)).toEqual({ id: { in: [] } });
    expect(canAdminClub(student, { officeId: "rec" })).toBe(false);
    expect(canAdminClub(null, { officeId: null })).toBe(false);
  });

  it("takes everything away from a deactivated staffer", () => {
    const gone = actor({ officeIds: ["rec"], fundingOfficeIds: ["rec"], status: "DEACTIVATED" });
    expect(adminScope(gone)).toEqual({ all: false, officeIds: [] });
    expect(canAdminClub(gone, { officeId: "rec" })).toBe(false);
    expect(can(gone, "admin.access")).toBe(false);
  });

  it("reads an actor built without office fields as staffing no office", () => {
    const bare = { id: "x", platformRole: "USER", status: "ACTIVE" } as unknown as Actor;
    expect(adminScope(bare)).toEqual({ all: false, officeIds: [] });
    expect(can(bare, "admin.access")).toBe(false);
  });
});

describe("what office staff may open", () => {
  const office: PlatformAction[] = ["admin.access", "admin.clubs", "admin.tests", "admin.analytics", "admin.events"];
  const wsusaOnly: PlatformAction[] = ["admin.policies", "admin.trainings", "admin.complaints", "admin.directory", "admin.reviews", "admin.users", "admin.announce", "admin.offices", "system.config", "system.admins"];

  it("opens the office-scoped tools", () => {
    for (const a of office) expect(can(rowan, a), a).toBe(true);
    for (const a of office) expect(can(fslStaff, a), a).toBe(true);
  });

  it("keeps WSUSA's platform-wide areas WSUSA's", () => {
    for (const a of wsusaOnly) expect(can(rowan, a), a).toBe(false);
    expect(can(alex, "admin.offices")).toBe(true);
    expect(can(student, "admin.access")).toBe(false);
  });

  it("opens Funding only to offices that decide their clubs' funding", () => {
    expect(can(rowan, "admin.funding")).toBe(true);
    expect(can(fslStaff, "admin.funding")).toBe(false);
    expect(canAdminFunding(rowan, { officeId: "rec" })).toBe(true);
    expect(canAdminFunding(rowan, { officeId: null })).toBe(false);
    expect(canAdminFunding(fslStaff, { officeId: "fsl" })).toBe(false);
    expect(canAdminFunding(alex, { officeId: "fsl" })).toBe(true);
    expect(adminFundingClubWhere(rowan)).toEqual({ officeId: { in: ["rec"] } });
    expect(adminFundingClubWhere(fslStaff)).toEqual({ id: { in: [] } });
    expect(adminFundingClubWhere(alex)).toEqual({});
  });
});
