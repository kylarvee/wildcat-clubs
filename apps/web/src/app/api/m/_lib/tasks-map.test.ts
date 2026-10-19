import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/authz", () => ({ CAPABILITIES: { budget: { label: "Budget & funding", description: "" } } }));

import { campusDate } from "@/lib/time";
import { decisionMessage, toMTask } from "./tasks-map";

type Row = Parameters<typeof toMTask>[0];

const now = campusDate(2026, 10, 16, 9, 0); // Friday 9:00 AM in Ogden
const club = { name: "RC Wrecker Bots Club", slug: "rc-wrecker-bots-club", logoColor: "#1d4ed8", logoUrl: null };
const row = (over: Record<string, unknown> = {}) =>
  ({
    id: "t1", kind: "APPROVAL", title: "Jordan Lee asked to join RC Wrecker Bots Club", description: null, assigneeType: "CLUB", assigneeId: null, clubId: "c1", club,
    capability: "roster", href: "/clubs/rc-wrecker-bots-club/manage/members", dueAt: null, required: false, status: "OPEN", sourceType: "membership", sourceId: "m1",
    createdById: "u2", createdBy: { name: "Jordan Lee", handle: "jordanlee" }, createdAt: now, completedAt: null, completedById: null, completedBy: null, assignee: null, ...over,
  }) as unknown as Row;

describe("toMTask", () => {
  it("words a join request like the web, with the app's Approve / Decline", () => {
    const decision = { kind: "JOIN" as const, id: "m1", personName: "Jordan Lee", clubName: "RC Wrecker Bots Club" };
    const t = toMTask(row(), "me", now, decision);
    expect(t).toMatchObject({ id: "t1", kind: "APPROVAL", badge: "Approval", required: false, checkable: false, decision, note: null });
    expect(t.club).toEqual({ id: "c1", name: "RC Wrecker Bots Club", slug: "rc-wrecker-bots-club", logoUrl: null, logoColor: "#1d4ed8" });
    // Approval tasks have no "From" line; that's for club tasks someone handed you.
    expect(t.fromLabel).toBeNull();
  });

  it("keeps the self-closing note on approvals the app can't decide", () => {
    const t = toMTask(row({ sourceType: "funding", sourceId: "f1", href: "/admin/funding/f1" }), "me", now);
    expect(t.decision).toBeNull();
    expect(t.note).toMatch(/^Closes on its own once a decision is made/);
    expect(t.path).toBe("/admin/funding/f1");
  });

  it("puts the Required by WSUSA badge on required tasks, and the due date in campus time", () => {
    const t = toMTask(row({ kind: "REQUIREMENT", title: "Pass: Club Officer Policy Test", required: true, assigneeType: "USER", assigneeId: "me", sourceType: "requirement", href: "/tests/x", dueAt: campusDate(2026, 10, 17, 23, 59) }), "me", now);
    expect(t.badge).toBe("Required by WSUSA");
    expect(t.required).toBe(true);
    expect(t.dueLabel).toBe("Due tomorrow");
    expect(t).toMatchObject({ overdue: false, dueSoon: true, path: "/tests/x" });
  });

  it("says a test handed in on time is waiting for grading, not overdue", () => {
    const t = toMTask(row({ kind: "REQUIREMENT", required: true, assigneeType: "USER", assigneeId: "me", dueAt: campusDate(2026, 10, 14, 18, 0), awaitingGrade: true }), "me", now);
    expect(t.waitingLabel).toBe("Submitted — waiting for grading");
    expect(t.dueLabel).toBeNull();
    expect(t.overdue).toBe(false);
    expect(t.note).toMatch(/isn't late while it waits/);
  });

  it("calls a club's quiz a Club test, and flags overdue ones", () => {
    const t = toMTask(row({ kind: "TEST", title: "Take: Event Safety Quiz", assigneeType: "USER", assigneeId: "me", sourceType: "testAssignment", href: "/tests/q", dueAt: campusDate(2026, 10, 14, 23, 59) }), "me", now);
    expect(t.badge).toBe("Club test");
    expect(t.dueLabel).toBe("Overdue · was due Oct 14");
    expect(t.overdue).toBe(true);
  });

  it("lets club and personal to-dos be checked off, and says who handed them out", () => {
    const club_ = toMTask(row({ kind: "CLUB", title: "Book the room", assigneeType: "USER", assigneeId: "me", sourceType: null, sourceId: null, href: "/tasks", createdById: "u9", createdBy: { name: "Priya Patel", handle: "priyapatel" } }), "me", now);
    expect(club_).toMatchObject({ badge: "Club task", checkable: true, fromLabel: "From Priya Patel", note: null });
    // A link back to the task list isn't worth an "Open" button.
    expect(club_.path).toBeNull();
    const group = toMTask(row({ kind: "CLUB", assigneeType: "CLUB", capability: "budget", sourceType: null, sourceId: null, href: "/tasks" }), "me", now);
    expect(group.forGroup).toBe("Everyone with Budget & funding");
    const mine = toMTask(row({ kind: "PERSONAL", title: "Print flyers", assigneeType: "USER", assigneeId: "me", clubId: null, club: null, sourceType: null, sourceId: null, href: null, createdById: "me" }), "me", now);
    expect(mine).toMatchObject({ badge: "Personal", checkable: true, club: null, fromLabel: null, path: null });
  });
});

describe("decisionMessage", () => {
  const join = { kind: "JOIN" as const, id: "m1", personName: "Jordan Lee", clubName: "RC Wrecker Bots Club" };
  const cohost = { kind: "COHOST" as const, id: "c1", eventTitle: "Women in Cybersecurity Panel", hostName: "Cyber Security Club (CSC)", clubName: "Society of Women Engineers (SWE)" };

  it("says what happened to a join request", () => {
    expect(decisionMessage(join, true)).toBe("Jordan Lee is now a member of RC Wrecker Bots Club.");
    expect(decisionMessage(join, false)).toBe("Declined Jordan Lee's request to join RC Wrecker Bots Club.");
  });

  it("says what happened to a co-host invitation", () => {
    expect(decisionMessage(cohost, true)).toBe("Society of Women Engineers (SWE) is co-hosting “Women in Cybersecurity Panel” now. It's on the club's calendar.");
    expect(decisionMessage(cohost, false)).toBe("Declined. Society of Women Engineers (SWE) won't co-host “Women in Cybersecurity Panel”.");
    expect(decisionMessage(cohost, false, { leaving: true })).toBe("Society of Women Engineers (SWE) stepped back from co-hosting “Women in Cybersecurity Panel”.");
  });
});
