import { describe, expect, it } from "vitest";
import type { ClubRole } from "@prisma/client";
import { confirmersFor, firstToAccept, leadersBelow, nextInLine, pipelineCandidates, pipelineOrder, unanimousChoice, type PipelineSeat } from "@/lib/roles/pipeline";

const day = (n: number) => new Date(Date.UTC(2026, 0, n));
let seq = 0;
const seat = (id: string, role: ClubRole, sortOrder: number, holders: [string, number][] = []): PipelineSeat => ({
  id,
  role,
  name: id,
  sortOrder,
  holders: holders.map(([userId, d]) => ({ userId, assignmentId: `a${++seq}`, startedAt: day(d) })),
});

/** A regular club: President, two VPs, three officer seats (listed out of order), a college ambassador. */
const club = () => [
  seat("events", "OFFICER", 4, [["eve", 3], ["ed", 1]]),
  seat("president", "PRESIDENT", 0, [["pat", 1]]),
  seat("ambassador", "AMBASSADOR", 7, [["amb", 1]]),
  seat("vp", "VP", 1, [["vic", 5], ["val", 2]]),
  seat("secretary", "OFFICER", 2, [["sue", 9]]),
  seat("treasurer", "OFFICER", 3, []),
];

describe("pipeline order", () => {
  it("runs President, VP, officers by chart order, then ambassadors", () => {
    expect(pipelineOrder(club()).map((s) => s.id)).toEqual(["president", "vp", "secretary", "treasurer", "events", "ambassador"]);
  });

  it("lists everyone below a seat once, at their highest seat, longest-serving co-holder first", () => {
    const seats = club();
    seats.find((s) => s.id === "secretary")!.holders.push({ userId: "val", assignmentId: "x", startedAt: day(1) });
    expect(leadersBelow(seats, "president", "REGISTERED").map((p) => `${p.userId}@${p.seatId}`)).toEqual(["val@vp", "vic@vp", "sue@secretary", "ed@events", "eve@events"]);
  });

  it("leaves a regular club's college ambassadors out of its pipeline, but not an ambassador org's", () => {
    expect(leadersBelow(club(), "secretary", "REGISTERED")).toEqual([]);
    expect(leadersBelow(club(), "secretary", "COLLEGE_AMBASSADORS").map((p) => p.userId)).toEqual(["amb"]);
  });

  it("doesn't count peers in the same tier as below a seat", () => {
    expect(leadersBelow(club(), "treasurer", "REGISTERED").map((p) => p.userId)).toEqual([]);
    expect(leadersBelow(club(), "vp", "REGISTERED").map((p) => p.userId)).toEqual(["sue", "ed", "eve"]);
  });
});

describe("next in line", () => {
  it("is the tier just below: the VPs for President, the officers for a VP", () => {
    expect(nextInLine(club(), "president", "REGISTERED").map((p) => p.userId)).toEqual(["val", "vic"]);
    expect(nextInLine(club(), "vp", "REGISTERED").map((p) => p.userId)).toEqual(["sue", "ed", "eve"]);
  });

  it("skips an empty tier to the first one with people in it", () => {
    const seats = club().map((s) => (s.id === "vp" ? { ...s, holders: [] } : s));
    expect(nextInLine(seats, "president", "REGISTERED").map((p) => p.userId)).toEqual(["sue", "ed", "eve"]);
  });

  it("is nobody for the bottom of a regular club's pipeline", () => {
    expect(nextInLine(club(), "events", "REGISTERED")).toEqual([]);
  });

  it("adds only the next in line for NEXT_IN_LINE, and everyone below for the other modes", () => {
    expect(pipelineCandidates(club(), "president", "REGISTERED", "NEXT_IN_LINE").map((p) => p.userId)).toEqual(["val", "vic"]);
    for (const m of ["SELF_SELECT", "MEMBER_VOTE", "ADVISOR_PRESIDENT"] as const) {
      expect(pipelineCandidates(club(), "president", "REGISTERED", m)).toHaveLength(5);
    }
  });

  it("moves up the first person in pipeline order who said yes", () => {
    const asked = nextInLine(club(), "vp", "REGISTERED").map((p) => ({ ...p, acceptedAt: null as Date | null }));
    expect(firstToAccept(asked)).toBeNull();
    asked[2].acceptedAt = day(10); // eve (Events, joined the seat later)
    expect(firstToAccept(asked)?.userId).toBe("eve");
    asked[1].acceptedAt = day(12); // ed answered later, but sits ahead of eve
    expect(firstToAccept(asked)?.userId).toBe("ed");
  });
});

describe("self-select unanimity", () => {
  const leaders = ["pat", "val", "vic", "sue"];
  const tally = (votes: Record<string, number>) => Object.entries(votes).map(([userId, n]) => ({ candidateId: `c-${userId}`, userId, votes: n }));

  it("counts when everyone voted for the same person (who can't vote for themselves)", () => {
    expect(unanimousChoice({ eligibleVoterIds: leaders, voterIds: ["pat", "vic", "sue"], tally: tally({ val: 3, vic: 0 }) })).toBe("c-val");
  });

  it("counts when the choice isn't a leader and every leader voted", () => {
    expect(unanimousChoice({ eligibleVoterIds: leaders, voterIds: leaders, tally: tally({ mia: 4 }) })).toBe("c-mia");
  });

  it("fails when anyone didn't vote", () => {
    expect(unanimousChoice({ eligibleVoterIds: leaders, voterIds: ["pat", "vic"], tally: tally({ val: 2 }) })).toBeNull();
    expect(unanimousChoice({ eligibleVoterIds: leaders, voterIds: ["pat", "val", "vic"], tally: tally({ mia: 3 }) })).toBeNull();
  });

  it("fails when the votes are split, or nobody voted", () => {
    expect(unanimousChoice({ eligibleVoterIds: leaders, voterIds: leaders, tally: tally({ val: 3, vic: 1 }) })).toBeNull();
    expect(unanimousChoice({ eligibleVoterIds: leaders, voterIds: [], tally: tally({ val: 0 }) })).toBeNull();
  });
});

describe("who confirms an advisor-and-President proposal", () => {
  const keys = { presidentIds: ["pres"], advisorIds: ["adv"] };

  it("is the other side: the advisor for the President's proposal and the President for the advisor's", () => {
    expect(confirmersFor({ ...keys, proposerId: "pres", candidateUserId: "val", seatRole: "VP" })).toEqual(["adv"]);
    expect(confirmersFor({ ...keys, proposerId: "adv", candidateUserId: "val", seatRole: "VP" })).toEqual(["pres"]);
  });

  it("lets the President decide alone when there's no advisor, and an advisor when there's no President", () => {
    expect(confirmersFor({ presidentIds: ["pres", "co"], advisorIds: [], proposerId: "pres", candidateUserId: "val", seatRole: "VP" })).toEqual(["pres", "co"]);
    expect(confirmersFor({ presidentIds: [], advisorIds: ["adv", "adv2"], proposerId: "adv", candidateUserId: "val", seatRole: "PRESIDENT" })).toEqual(["adv", "adv2"]);
  });

  it("never lets the person proposed for President be the one who confirms it", () => {
    // The advisor proposes the sitting President again: with no other President, the advisor decides alone.
    expect(confirmersFor({ ...keys, proposerId: "adv", candidateUserId: "pres", seatRole: "PRESIDENT" })).toEqual(["adv"]);
    // A President proposing themselves with no advisor has nobody to confirm (an admin must).
    expect(confirmersFor({ presidentIds: ["pres"], advisorIds: [], proposerId: "pres", candidateUserId: "pres", seatRole: "PRESIDENT" })).toEqual([]);
    // For other seats the President is fine.
    expect(confirmersFor({ presidentIds: ["pres"], advisorIds: [], proposerId: "pres", candidateUserId: "val", seatRole: "VP" })).toEqual(["pres"]);
  });

  it("lets either side confirm what an admin proposed", () => {
    expect(confirmersFor({ ...keys, proposerId: "admin", candidateUserId: "val", seatRole: "VP" }).sort()).toEqual(["adv", "pres"]);
  });
});
