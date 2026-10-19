import { describe, expect, it } from "vitest";
import {
  attendanceRows,
  earliestVotingOpen,
  meetsAttendance,
  NO_SELECTION_RULES,
  noticeEarliest,
  NOTICE_GRACE_MS,
  quorumOf,
  readSelectionRules,
  selectionRulesJson,
  tieResolution,
  voterStatusIn,
  type VoterRoll,
} from "@/lib/roles/pipeline";

/** The bylaw rules a member vote follows (lib/roles/pipeline): eligibility, quorum, ties and notice. */

const DAY = 86_400_000;

describe("eligibility under the bylaws' attendance requirement", () => {
  const counts: Record<string, number> = { ana: 7, ben: 2, cy: 1, dee: 0 };
  const rows = attendanceRows(["dee", "cy", "ben", "ana"], (id) => counts[id] ?? 0, 2);
  const roll = (final: boolean): VoterRoll => ({
    basis: "attendance",
    minEvents: 2,
    termName: "Fall 2026",
    countedUntil: new Date("2026-10-17T16:00:00Z"),
    final,
    eligibleIds: rows.filter((r) => r.eligible).map((r) => r.userId),
    rows,
  });

  it("counts every member, most events first, and lets in exactly those who reach the minimum", () => {
    expect(rows.map((r) => [r.userId, r.attended, r.eligible])).toEqual([
      ["ana", 7, true],
      ["ben", 2, true],
      ["cy", 1, false],
      ["dee", 0, false],
    ]);
    expect(meetsAttendance(2, 2)).toBe(true);
    expect(meetsAttendance(1, 2)).toBe(false);
  });

  it("tells a member who can vote their count and the rule", () => {
    expect(voterStatusIn(roll(true), "ben")).toEqual({ eligible: true, attended: 2, minEvents: 2 });
  });

  it("tells a member who can't vote why, in the tense of where the vote is", () => {
    const opened = voterStatusIn(roll(true), "cy");
    expect(opened.eligible).toBe(false);
    expect(opened.reason).toBe("You'd been to 1 club event this semester when voting opened. The club's bylaws ask for 2 club events to vote.");
    expect(voterStatusIn(roll(true), "dee").reason).toContain("You'd been to no club events this semester");
    const before = voterStatusIn(roll(false), "cy");
    expect(before.reason).toBe("So far this semester you've been to 1 club event. The club's bylaws ask for 2 club events by the time voting opens.");
  });

  it("turns away people who aren't members, and explains the other bases", () => {
    expect(voterStatusIn(roll(true), "stranger")).toEqual({ eligible: false, reason: "Only members of the club can vote." });
    const leaders: VoterRoll = { ...roll(true), basis: "leaders", minEvents: null, rows: [], eligibleIds: ["pat"] };
    expect(voterStatusIn(leaders, "pat").eligible).toBe(true);
    expect(voterStatusIn(leaders, "ana").reason).toContain("current student leaders");
    const active: VoterRoll = { ...roll(true), basis: "active", minEvents: null, rows: [], eligibleIds: ["ana"] };
    expect(voterStatusIn(active, "cy").reason).toBe("Only active members of the club can vote.");
  });
});

describe("quorum", () => {
  it("has none without a rule", () => {
    expect(quorumOf({ quorumPercent: null, eligibleVoters: 40, votes: 0 })).toBeNull();
  });

  it("rounds the votes needed up, and counts the result only once they're in", () => {
    expect(quorumOf({ quorumPercent: 25, eligibleVoters: 46, votes: 11 })).toEqual({ percent: 25, needed: 12, met: false });
    expect(quorumOf({ quorumPercent: 25, eligibleVoters: 46, votes: 12 })).toEqual({ percent: 25, needed: 12, met: true });
    expect(quorumOf({ quorumPercent: 25, eligibleVoters: 48, votes: 12 })?.needed).toBe(12);
    expect(quorumOf({ quorumPercent: 7, eligibleVoters: 100, votes: 7 })).toEqual({ percent: 7, needed: 7, met: true });
  });

  it("never counts a vote nobody cast, even with no eligible voters", () => {
    expect(quorumOf({ quorumPercent: 25, eligibleVoters: 0, votes: 0 })).toEqual({ percent: 25, needed: 1, met: false });
    expect(quorumOf({ quorumPercent: 1, eligibleVoters: 3, votes: 0 })?.met).toBe(false);
  });
});

describe("ties", () => {
  const keys = { presidentIds: ["pres"], advisorIds: ["adv"] };

  it("leaves it to whoever applies the result when the bylaws say nothing", () => {
    expect(tieResolution({ tieBreak: null, isRunoff: false, ...keys, tiedUserIds: ["a", "b"] })).toEqual({ kind: "choose", by: "organizer", userIds: [] });
  });

  it("calls a runoff, and gives a runoff that ties again to the advisor", () => {
    expect(tieResolution({ tieBreak: "RUNOFF", isRunoff: false, ...keys, tiedUserIds: ["a", "b"] })).toEqual({ kind: "runoff" });
    expect(tieResolution({ tieBreak: "RUNOFF", isRunoff: true, ...keys, tiedUserIds: ["a", "b"] })).toEqual({ kind: "choose", by: "advisor", userIds: ["adv"] });
  });

  it("lets only the advisor decide, or the President when there's no advisor", () => {
    expect(tieResolution({ tieBreak: "ADVISOR", isRunoff: false, ...keys, tiedUserIds: ["a", "b"] })).toEqual({ kind: "choose", by: "advisor", userIds: ["adv"] });
    expect(tieResolution({ tieBreak: "ADVISOR", isRunoff: false, presidentIds: ["pres"], advisorIds: [], tiedUserIds: ["a", "b"] })).toEqual({ kind: "choose", by: "president", userIds: ["pres"] });
  });

  it("lets only the President decide, unless they're one of the tied candidates", () => {
    expect(tieResolution({ tieBreak: "PRESIDENT", isRunoff: false, ...keys, tiedUserIds: ["a", "b"] })).toEqual({ kind: "choose", by: "president", userIds: ["pres"] });
    expect(tieResolution({ tieBreak: "PRESIDENT", isRunoff: false, ...keys, tiedUserIds: ["pres", "b"] })).toEqual({ kind: "choose", by: "advisor", userIds: ["adv"] });
  });

  it("goes to WSUSA when nobody in the club can decide", () => {
    expect(tieResolution({ tieBreak: "PRESIDENT", isRunoff: false, presidentIds: ["pres"], advisorIds: [], tiedUserIds: ["pres", "b"] })).toEqual({ kind: "choose", by: "wsusa", userIds: [] });
    expect(tieResolution({ tieBreak: "ADVISOR", isRunoff: false, presidentIds: [], advisorIds: [], tiedUserIds: ["a", "b"] })).toEqual({ kind: "choose", by: "wsusa", userIds: [] });
  });
});

describe("notice before a member vote opens", () => {
  const announced = new Date("2026-10-19T16:07:31Z");

  it("puts the earliest opening the bylaws' days after the announcement", () => {
    expect(earliestVotingOpen(announced, null)).toBeNull();
    expect(earliestVotingOpen(announced, 7)?.getTime()).toBe(announced.getTime() + 7 * DAY);
  });

  it("shows that moment rounded up to the quarter hour, never earlier", () => {
    const shown = noticeEarliest(announced, 7)!;
    const exact = earliestVotingOpen(announced, 7)!;
    expect(shown.getTime()).toBeGreaterThanOrEqual(exact.getTime());
    expect(shown.getTime() - exact.getTime()).toBeLessThan(NOTICE_GRACE_MS);
    expect(shown.getTime() % NOTICE_GRACE_MS).toBe(0);
    expect(noticeEarliest(announced, null)).toBeNull();
  });
});

describe("the rules a selection freezes (Election.rules)", () => {
  it("reads selections started before rules were recorded as having none", () => {
    expect(readSelectionRules({})).toEqual(NO_SELECTION_RULES);
    expect(readSelectionRules(null)).toEqual(NO_SELECTION_RULES);
    expect(readSelectionRules([1, 2])).toEqual(NO_SELECTION_RULES);
  });

  it("keeps valid rules and drops anything else", () => {
    expect(readSelectionRules({ minEvents: 2, quorumPercent: 25, tieBreak: "RUNOFF", noticeDays: 7 })).toEqual({ minEvents: 2, quorumPercent: 25, tieBreak: "RUNOFF", noticeDays: 7, runoffOf: null });
    expect(readSelectionRules({ minEvents: 0, quorumPercent: 140, tieBreak: "COIN_FLIP", noticeDays: "7", runoffOf: "" })).toEqual(NO_SELECTION_RULES);
    expect(readSelectionRules({ minEvents: 2.5 }).minEvents).toBeNull();
  });

  it("stores the four rules, and a runoff's link back to the tied vote", () => {
    const rules = { minEvents: 2, quorumPercent: 25, tieBreak: "ADVISOR" as const, noticeDays: null, runoffOf: null };
    expect(selectionRulesJson(rules)).toEqual({ minEvents: 2, quorumPercent: 25, tieBreak: "ADVISOR", noticeDays: null });
    expect(readSelectionRules(selectionRulesJson({ ...rules, runoffOf: "e1" }))).toEqual({ ...rules, runoffOf: "e1" });
  });
});
