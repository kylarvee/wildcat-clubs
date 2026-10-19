import { describe, expect, it } from "vitest";
import {
  gapNotice,
  gapsOpenedBy,
  gapTask,
  hasOrphanedRequests,
  orphanRequestsTask,
  parseStaffingSourceId,
  seatApproves,
  staffingGaps,
  staffingSourceId,
  staffingTaskPlan,
  type HeldRole,
  type StaffingFacts,
} from "./rules";

const president: HeldRole = { role: "PRESIDENT", permissions: [] };
const vp: HeldRole = { role: "VP", permissions: [] };
const advisor: HeldRole = { role: "ADVISOR", permissions: [] };
const treasurer: HeldRole = { role: "OFFICER", permissions: ["budget"] };
const membership: HeldRole = { role: "OFFICER", permissions: ["roster", "events"] };
const member: HeldRole = { role: "MEMBER", permissions: [] };

const facts = (p: Partial<StaffingFacts>): StaffingFacts => ({ status: "APPROVED", joinPolicy: "OPEN", current: [president, advisor], approvers: 2, ...p });

describe("staffingGaps", () => {
  it("finds nothing missing in a staffed club", () => {
    expect(staffingGaps(facts({}))).toEqual([]);
  });
  it("finds a missing President and a missing advisor", () => {
    expect(staffingGaps(facts({ current: [vp, treasurer, member] }))).toEqual(["president", "advisor"]);
    expect(staffingGaps(facts({ current: [president] }))).toEqual(["advisor"]);
  });
  it("only asks for an approver when the club approves join requests", () => {
    expect(staffingGaps(facts({ current: [president, advisor], approvers: 0 }))).toEqual([]);
    expect(staffingGaps(facts({ joinPolicy: "APPROVAL", current: [president, advisor], approvers: 0 }))).toEqual(["approver"]);
    expect(staffingGaps(facts({ joinPolicy: "APPROVAL", current: [treasurer], approvers: 0 }))).toEqual(["president", "advisor", "approver"]);
    expect(staffingGaps(facts({ joinPolicy: "APPROVAL", current: [membership], approvers: 1 }))).toEqual(["president", "advisor"]);
  });
  it("leaves founding, retired and rejected clubs alone", () => {
    for (const status of ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "RETIRED", "REJECTED"] as const) {
      expect(staffingGaps(facts({ status, current: [], joinPolicy: "APPROVAL", approvers: 0 }))).toEqual([]);
    }
  });
});

describe("seatApproves", () => {
  it("follows the seat rule: advisors, Presidents and VPs, and officers whose seat grants Members", () => {
    expect([advisor, president, vp, membership].every(seatApproves)).toBe(true);
    expect([treasurer, member, { role: "AMBASSADOR", permissions: [] } as HeldRole].some(seatApproves)).toBe(false);
    expect(seatApproves({ role: "AMBASSADOR", permissions: ["roster"] })).toBe(true);
  });
});

describe("gapsOpenedBy", () => {
  it("opens a gap only when the change ended someone who filled it", () => {
    expect(gapsOpenedBy(["president"], [president])).toEqual(["president"]);
    expect(gapsOpenedBy(["president", "advisor"], [president])).toEqual(["president"]);
    expect(gapsOpenedBy(["advisor"], [advisor])).toEqual(["advisor"]);
  });
  it("never opens a gap that was already there (no backfill)", () => {
    // Nobody's role ended: an assignment, a permission change or the scheduled re-check.
    expect(gapsOpenedBy(["president", "advisor", "approver"], [])).toEqual([]);
    // A treasurer stepped down in a club that had no President or advisor before.
    expect(gapsOpenedBy(["president", "advisor"], [treasurer])).toEqual([]);
  });
  it("opens the approver gap when the last seat with Members goes", () => {
    expect(gapsOpenedBy(["approver"], [membership])).toEqual(["approver"]);
    expect(gapsOpenedBy(["approver"], [vp])).toEqual(["approver"]);
    expect(gapsOpenedBy(["approver"], [treasurer])).toEqual([]);
  });
});

describe("staffingTaskPlan", () => {
  it("opens one task per new gap and never a second for the same gap", () => {
    expect(staffingTaskPlan(["president"], ["president"], [])).toEqual({ open: ["president"], close: [] });
    expect(staffingTaskPlan(["president"], ["president"], ["president"])).toEqual({ open: [], close: [] });
  });
  it("closes tasks whose gap is filled, and keeps the rest", () => {
    expect(staffingTaskPlan([], [], ["president", "approver"])).toEqual({ open: [], close: ["president", "approver"] });
    expect(staffingTaskPlan(["advisor"], [], ["president", "advisor"])).toEqual({ open: [], close: ["president"] });
  });
});

describe("hasOrphanedRequests", () => {
  const now = new Date("2026-10-18T18:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
  it("applies after a week with nobody who can approve", () => {
    expect(hasOrphanedRequests({ oldestPendingAt: daysAgo(8), approvers: 0, now })).toBe(true);
    expect(hasOrphanedRequests({ oldestPendingAt: daysAgo(7.01), approvers: 0, now })).toBe(true);
  });
  it("waits a full week, and stops once someone can approve or nothing is pending", () => {
    expect(hasOrphanedRequests({ oldestPendingAt: daysAgo(6.9), approvers: 0, now })).toBe(false);
    expect(hasOrphanedRequests({ oldestPendingAt: daysAgo(30), approvers: 1, now })).toBe(false);
    expect(hasOrphanedRequests({ oldestPendingAt: null, approvers: 0, now })).toBe(false);
  });
});

describe("source ids and words", () => {
  it("round-trips the task source id", () => {
    expect(staffingSourceId("club_1", "approver")).toBe("club_1:approver");
    expect(parseStaffingSourceId("club_1:president")).toEqual({ clubId: "club_1", gap: "president" });
    expect(parseStaffingSourceId("club_1:treasurer")).toBeNull();
    expect(parseStaffingSourceId(null)).toBeNull();
  });
  const club = { name: "Chess Club", slug: "chess-club", type: "REGISTERED" as const };
  it("names the club and the gap, and links where it's fixed", () => {
    expect(gapTask({ club, gap: "president", leftName: "Jo Lee", hasAdvisor: true })).toMatchObject({ title: "Chess Club has no President", href: "/clubs/chess-club/manage/org-chart" });
    expect(gapTask({ club, gap: "president", leftName: "Jo Lee", hasAdvisor: true }).description).toMatch(/^Jo Lee's role as President ended, .*Fill this seat/);
    expect(gapTask({ club, gap: "advisor", leftName: null, hasAdvisor: false })).toMatchObject({ title: "Chess Club has no advisor", href: "/clubs/chess-club/manage/settings" });
    expect(gapTask({ club: { ...club, type: "COLLEGE_AMBASSADORS" }, gap: "advisor", leftName: null, hasAdvisor: false }).href).toBe("/admin/clubs?tab=ambassadors");
    expect(gapTask({ club, gap: "approver", leftName: null, hasAdvisor: false }).title).toBe("Chess Club has no one to approve join requests");
    expect(gapNotice({ club, gap: "president", leftName: null, hasAdvisor: false })).toMatchObject({ title: "Chess Club has no President", href: "/clubs/chess-club/manage/org-chart" });
    expect(gapNotice({ club, gap: "advisor", leftName: "Dr. Kim", hasAdvisor: false }).body).toMatch(/^Dr\. Kim no longer advises Chess Club\./);
    expect(gapNotice({ club, gap: "advisor", leftName: null, hasAdvisor: false }).body).toMatch(/^Chess Club's last advisor left\./);
    expect(orphanRequestsTask(club)).toMatchObject({ title: "Join requests waiting at Chess Club", href: "/clubs/chess-club/manage/members" });
  });
});
