import { describe, expect, it } from "vitest";
import { DAY_MS, campusDate } from "@/lib/time";
import {
  academicYearBuckets,
  accumulateNetwork,
  attendanceRate,
  bucketIndexOf,
  bucketsBetween,
  checkinLines,
  countsFromCheckins,
  evaluateClubActivity,
  individualRetention,
  involvementWindow,
  isActiveStudent,
  lastBuckets,
  linesFromCounts,
  occurrenceCounts,
  pilotPeriodEnd,
  retentionSeries,
  standingFromHistory,
  termEnd,
  type ClubActivityInput,
  type TermLike,
} from "./pure";

// A Weber State-shaped calendar. Dates are stored as campus midnight, like the seed.
const term = (name: string, academicYear: string, start: [number, number, number], end: [number, number, number], countsForActivity = true): TermLike => ({
  name,
  academicYear,
  startsOn: campusDate(...start),
  endsOn: campusDate(...end),
  countsForActivity,
});
const FALL_25 = term("Fall 2025", "2025-2026", [2025, 8, 25], [2025, 12, 13]);
const SPRING_26 = term("Spring 2026", "2025-2026", [2026, 1, 7], [2026, 5, 1]);
const SUMMER_26 = term("Summer 2026", "2025-2026", [2026, 5, 11], [2026, 8, 7], false);
const FALL_26 = term("Fall 2026", "2026-2027", [2026, 8, 24], [2026, 12, 12]);
const SPRING_27 = term("Spring 2027", "2026-2027", [2027, 1, 6], [2027, 4, 30]);
const TERMS = [SPRING_27, FALL_25, SUMMER_26, FALL_26, SPRING_26]; // unsorted on purpose

const RULE = { windowDays: 31, recentEvents: 2 };
const AT = campusDate(2026, 10, 16, 12);
const daysAgo = (n: number) => new Date(AT.getTime() - n * DAY_MS);

describe("active student", () => {
  it("counts anyone who attended inside the window, even if it isn't one of the last N events", () => {
    // Weekly club: attended three meetings ago (rank 3) but 21 days ago.
    expect(isActiveStudent({ lastAttendedAt: daysAgo(21), latestRank: 3 }, AT, RULE)).toBe(true);
  });

  it("counts anyone who attended one of the last N held events, however long ago (whichever is later)", () => {
    // A club that meets every other month: the last meeting was 50 days ago.
    expect(isActiveStudent({ lastAttendedAt: daysAgo(50), latestRank: 1 }, AT, RULE)).toBe(true);
    expect(isActiveStudent({ lastAttendedAt: daysAgo(110), latestRank: 2 }, AT, RULE)).toBe(true);
    expect(isActiveStudent({ lastAttendedAt: daysAgo(170), latestRank: 3 }, AT, RULE)).toBe(false);
  });

  it("is inactive when neither rule holds, and treats the window edge as inside", () => {
    expect(isActiveStudent({ lastAttendedAt: daysAgo(32), latestRank: 5 }, AT, RULE)).toBe(false);
    expect(isActiveStudent({ lastAttendedAt: daysAgo(31), latestRank: 5 }, AT, RULE)).toBe(true);
    expect(isActiveStudent({ lastAttendedAt: null, latestRank: null }, AT, RULE)).toBe(false);
  });

  it("follows the configured thresholds", () => {
    const strict = { windowDays: 7, recentEvents: 1 };
    expect(isActiveStudent({ lastAttendedAt: daysAgo(10), latestRank: 2 }, AT, strict)).toBe(false);
    expect(isActiveStudent({ lastAttendedAt: daysAgo(10), latestRank: 1 }, AT, strict)).toBe(true);
  });

  it("ranks the club's held events newest first and ignores ones after `at`", () => {
    const held = [
      { id: "e1", startsAt: daysAgo(70) },
      { id: "e2", startsAt: daysAgo(40) },
      { id: "e3", startsAt: daysAgo(35) },
      { id: "future", startsAt: new Date(AT.getTime() + DAY_MS) },
    ];
    // e3 is rank 1, e2 rank 2, e1 rank 3; the future event doesn't count.
    expect(standingFromHistory(held, ["e2"], AT)).toEqual({ lastAttendedAt: daysAgo(40), latestRank: 2 });
    expect(isActiveStudent(standingFromHistory(held, ["e2"], AT), AT, RULE)).toBe(true);
    expect(isActiveStudent(standingFromHistory(held, ["e1"], AT), AT, RULE)).toBe(false);
    expect(standingFromHistory(held, ["future"], AT)).toEqual({ lastAttendedAt: null, latestRank: null });
    expect(standingFromHistory(held, [], AT).latestRank).toBeNull();
  });
});

describe("pilot period", () => {
  it("runs to the end of the next activity term for a club created mid-term", () => {
    // Created mid-Fall 2026 → pilot through the last day of Spring 2027.
    const end = pilotPeriodEnd(campusDate(2026, 9, 15), TERMS)!;
    expect(end.getTime()).toBe(campusDate(2027, 5, 1).getTime() - 1);
  });

  it("skips a summer that doesn't count for activity", () => {
    // Created mid-Spring 2026; Summer 2026 doesn't count → pilot through Fall 2026.
    expect(pilotPeriodEnd(campusDate(2026, 3, 1), TERMS)!.getTime()).toBe(campusDate(2026, 12, 13).getTime() - 1);
    const summerCounts = TERMS.map((t) => (t === SUMMER_26 ? { ...t, countsForActivity: true } : t));
    expect(pilotPeriodEnd(campusDate(2026, 3, 1), summerCounts)!.getTime()).toBe(campusDate(2026, 8, 8).getTime() - 1);
  });

  it("uses the next term when created between terms, and null when the calendar has none", () => {
    expect(pilotPeriodEnd(campusDate(2026, 12, 20), TERMS)!.getTime()).toBe(campusDate(2027, 5, 1).getTime() - 1);
    expect(pilotPeriodEnd(campusDate(2027, 2, 1), TERMS)).toBeNull();
    expect(pilotPeriodEnd(campusDate(2026, 1, 1), [])).toBeNull();
  });

  it("treats a term end stored at campus midnight as the whole last day", () => {
    expect(termEnd(FALL_26).getTime()).toBe(campusDate(2026, 12, 13).getTime() - 1);
    const exact = { endsOn: campusDate(2026, 12, 12, 17, 0) };
    expect(termEnd(exact)).toBe(exact.endsOn);
  });
});

describe("active club", () => {
  const base: ClubActivityInput = {
    status: "APPROVED",
    createdAt: campusDate(2024, 1, 10),
    heldEventsCurrentTerm: 0,
    heldEventsPreviousTerm: 0,
    registeredMembers: 0,
    activeMembers: 0,
    at: AT,
    terms: TERMS,
    rule: { minEvents: 2, minMembers: 8 },
    currentTermName: "Fall 2026",
    previousTermName: "Spring 2026",
  };

  it("is active with enough events in the current term or the previous one, plus enough members", () => {
    expect(evaluateClubActivity({ ...base, heldEventsCurrentTerm: 2, registeredMembers: 8 })).toMatchObject({ active: true, inPilot: false, reasons: [] });
    expect(evaluateClubActivity({ ...base, heldEventsPreviousTerm: 3, registeredMembers: 12 }).active).toBe(true);
  });

  it("needs the minimum within one term, not split across two", () => {
    const r = evaluateClubActivity({ ...base, heldEventsCurrentTerm: 1, heldEventsPreviousTerm: 1, registeredMembers: 20 });
    expect(r.active).toBe(false);
    expect(r.reasons).toEqual(["Only 1 event with check-ins in Fall 2026 and 1 in Spring 2026 (needs 2 in one term)."]);
  });

  it("requires the minimum registered members outside the pilot", () => {
    const r = evaluateClubActivity({ ...base, heldEventsCurrentTerm: 4, registeredMembers: 7 });
    expect(r.active).toBe(false);
    expect(r.reasons).toEqual(["Only 7 registered members (needs 8)."]);
    expect(evaluateClubActivity({ ...base }).reasons).toEqual([
      "No events with check-ins in Fall 2026 or in Spring 2026 (needs 2 in one term).",
      "No registered members yet (needs 8).",
    ]);
  });

  it("waives events and members during the pilot period", () => {
    const r = evaluateClubActivity({ ...base, createdAt: campusDate(2026, 9, 15) });
    expect(r.active).toBe(true);
    expect(r.inPilot).toBe(true);
    expect(r.pilotEndsAt!.getTime()).toBe(campusDate(2027, 5, 1).getTime() - 1);
    expect(r.reasons).toEqual(["New club: counts as active during its pilot period, through Apr 30, 2027."]);
  });

  it("ends the pilot when the term ends", () => {
    const created = campusDate(2026, 3, 1); // pilot through Fall 2026
    expect(evaluateClubActivity({ ...base, createdAt: created, at: campusDate(2026, 12, 12, 20) }).inPilot).toBe(true);
    const after = evaluateClubActivity({ ...base, createdAt: created, at: campusDate(2026, 12, 13, 0, 1) });
    expect(after.inPilot).toBe(false);
    expect(after.active).toBe(false);
  });

  it("gives the benefit of the doubt when the calendar has no full term after creation yet", () => {
    const r = evaluateClubActivity({ ...base, createdAt: campusDate(2027, 2, 1), at: campusDate(2027, 3, 1) });
    expect(r).toMatchObject({ active: true, inPilot: true, pilotEndsAt: null });
  });

  it("is never active unless approved", () => {
    const pending = evaluateClubActivity({ ...base, status: "SUBMITTED", createdAt: campusDate(2026, 9, 15), heldEventsCurrentTerm: 5, registeredMembers: 30 });
    expect(pending).toMatchObject({ active: false, inPilot: false, pilotEndsAt: null, reasons: ["This club hasn't been approved by WSUSA yet."] });
    expect(evaluateClubActivity({ ...base, status: "RETIRED", heldEventsCurrentTerm: 5, registeredMembers: 30 }).reasons).toEqual(["This club has been retired."]);
  });
});

describe("periods", () => {
  it("builds campus-time months, quarters and years ending with the current one", () => {
    expect(lastBuckets("month", campusDate(2026, 2, 10), 3).map((b) => b.label)).toEqual(["Dec 2025", "Jan 2026", "Feb 2026"]);
    expect(lastBuckets("quarter", AT, 3).map((b) => b.label)).toEqual(["Q2 2026", "Q3 2026", "Q4 2026"]);
    expect(lastBuckets("year", AT, 2).map((b) => b.label)).toEqual(["2025", "2026"]);
    const [oct] = lastBuckets("month", AT, 1);
    expect(oct.start.getTime()).toBe(campusDate(2026, 10, 1).getTime());
    expect(oct.end.getTime()).toBe(campusDate(2026, 11, 1).getTime());
  });

  it("buckets by campus time, not UTC", () => {
    // 7 PM on July 31 in Ogden is already August 1 in UTC.
    const buckets = lastBuckets("month", AT, 4); // Jul, Aug, Sep, Oct
    expect(bucketIndexOf(campusDate(2026, 7, 31, 19), buckets)).toBe(0);
    expect(bucketIndexOf(campusDate(2026, 8, 1, 0), buckets)).toBe(1);
    expect(bucketIndexOf(campusDate(2026, 6, 30, 23), buckets)).toBe(-1);
  });

  it("makes back-to-back academic years from the Term table", () => {
    const years = academicYearBuckets(TERMS);
    expect(years.map((y) => y.label)).toEqual(["2025-2026", "2026-2027"]);
    // Summer and the August gap belong to the year they follow.
    expect(years[0].end.getTime()).toBe(FALL_26.startsOn.getTime());
    expect(bucketIndexOf(campusDate(2026, 8, 15), years)).toBe(0);
    expect(lastBuckets("academicYear", AT, 5, TERMS).map((y) => y.label)).toEqual(["2025-2026", "2026-2027"]);
    expect(lastBuckets("academicYear", campusDate(2024, 1, 1), 2, TERMS)).toEqual([]);
  });

  it("lists every period between two dates", () => {
    expect(bucketsBetween("month", campusDate(2025, 11, 20), campusDate(2026, 1, 5)).map((b) => b.label)).toEqual(["Nov 2025", "Dec 2025", "Jan 2026"]);
    expect(bucketsBetween("academicYear", campusDate(2026, 9, 1), AT, TERMS).map((b) => b.label)).toEqual(["2026-2027"]);
    expect(bucketsBetween("month", AT, campusDate(2026, 1, 1))).toEqual([]);
  });
});

describe("retention", () => {
  const buckets = lastBuckets("month", AT, 4); // Jul, Aug, Sep, Oct (in progress)
  const seen = (userId: string, bucket: number) => ({ userId, bucket });

  it("is the share of last period's attendees who came back", () => {
    const series = retentionSeries(buckets, [seen("a", 0), seen("b", 0), seen("c", 0), seen("a", 1), seen("b", 1), seen("d", 1), seen("a", 2), seen("d", 3)], AT);
    expect(series.map((p) => [p.label, p.attendees, p.previousAttendees, p.retained, p.rate])).toEqual([
      ["Jul 2026", 3, 0, 0, null],
      ["Aug 2026", 3, 3, 2, 2 / 3],
      ["Sep 2026", 1, 3, 1, 1 / 3],
      ["Oct 2026", 1, 1, 0, 0],
    ]);
    expect(series.map((p) => p.inProgress)).toEqual([false, false, false, true]);
    expect(series[3].end.getTime()).toBe(campusDate(2026, 11, 1).getTime() - 1);
  });

  it("is null, not zero, when the previous period had nobody", () => {
    const series = retentionSeries(buckets, [seen("a", 2), seen("a", 2), seen("x", 9)], AT);
    expect(series[2]).toMatchObject({ attendees: 1, previousAttendees: 0, rate: null });
    expect(series[3]).toMatchObject({ attendees: 0, previousAttendees: 1, retained: 0, rate: 0 });
  });

  it("measures a person over the periods since they joined; the current one only counts once they've come", () => {
    expect(individualRetention(buckets, [0, 2], AT)).toEqual({ periods: 3, attendedPeriods: 2, rate: 2 / 3 });
    expect(individualRetention(buckets, [0, 2, 3], AT)).toEqual({ periods: 4, attendedPeriods: 3, rate: 3 / 4 });
    expect(individualRetention(buckets.slice(3), [], AT)).toEqual({ periods: 0, attendedPeriods: 0, rate: null });
  });

  it("starts someone's history at their first check-in or joining, whichever came first", () => {
    const first = campusDate(2026, 2, 3, 18);
    const last = campusDate(2026, 9, 9, 18);
    // A guest who later joined keeps their guest history.
    expect(involvementWindow({ status: "ACTIVE", joinedAt: campusDate(2026, 4, 1), endedAt: null }, { firstAt: first, lastAt: last }, AT)).toEqual({ start: first, end: AT });
    // Never joined: from the first visit.
    expect(involvementWindow(null, { firstAt: first, lastAt: last }, AT)).toEqual({ start: first, end: AT });
    // Left the club, but came back as a guest afterwards: until the last visit.
    const left = campusDate(2026, 6, 1);
    expect(involvementWindow({ status: "LEFT", joinedAt: campusDate(2025, 9, 1), endedAt: left }, { firstAt: first, lastAt: last }, AT)!.end).toEqual(last);
    expect(involvementWindow({ status: "LEFT", joinedAt: campusDate(2025, 9, 1), endedAt: left }, null, AT)!.end).toEqual(left);
    // A pending request isn't membership yet.
    expect(involvementWindow({ status: "PENDING", joinedAt: null, endedAt: null }, null, AT)).toBeNull();
  });
});

describe("attendance rate", () => {
  const startsAt = campusDate(2026, 10, 2, 18);
  const memberships = [
    { userId: "m1", status: "ACTIVE", joinedAt: campusDate(2025, 1, 1), endedAt: null },
    { userId: "m2", status: "ACTIVE", joinedAt: campusDate(2025, 1, 1), endedAt: null },
    { userId: "m3", status: "ACTIVE", joinedAt: campusDate(2025, 1, 1), endedAt: null },
    { userId: "left-after", status: "LEFT", joinedAt: campusDate(2025, 1, 1), endedAt: campusDate(2026, 10, 9) },
    { userId: "left-before", status: "LEFT", joinedAt: campusDate(2025, 1, 1), endedAt: campusDate(2026, 9, 1) },
    { userId: "joined-later", status: "ACTIVE", joinedAt: campusDate(2026, 10, 2, 18, 5), endedAt: null },
    { userId: "pending", status: "PENDING", joinedAt: null, endedAt: null },
    { userId: "declined", status: "DECLINED", joinedAt: campusDate(2025, 1, 1), endedAt: null },
  ];

  it("divides member check-ins by members at the time and counts everyone else as guests", () => {
    // Members at the time: m1, m2, m3, left-after = 4.
    const r = occurrenceCounts(["m1", "m2", "left-before", "joined-later", "pending", "visitor"], memberships, startsAt);
    expect(r).toEqual({ attendees: 6, memberAttendees: 2, guests: 4, membersAtTime: 4, rate: 0.5 });
  });

  it("is null for a club with no members and never above 100%", () => {
    expect(occurrenceCounts(["visitor"], [], startsAt)).toEqual({ attendees: 1, memberAttendees: 0, guests: 1, membersAtTime: 0, rate: null });
    expect(attendanceRate(0, 0)).toBeNull();
    expect(attendanceRate(5, 4)).toBe(1);
  });
});

describe("interconnection", () => {
  it("links the attendee's club to the host and every co-host", () => {
    // A member of A checks in at B's event co-hosted by C → A–B and A–C, not B–C.
    expect(checkinLines(["B", "C"], ["A"])).toEqual([
      ["A", "B"],
      ["A", "C"],
    ]);
  });

  it("never draws a line from a club to itself", () => {
    expect(checkinLines(["B"], ["B"])).toEqual([]);
    expect(checkinLines(["A", "B"], [])).toEqual([]);
    // A member of the host still links the host's co-host.
    expect(checkinLines(["B", "C"], ["B"])).toEqual([["B", "C"]]);
  });

  it("doesn't link your other clubs when you go to your own club's event", () => {
    // A member of A and B at B's regular meeting: just B attendance.
    expect(checkinLines(["B"], ["A", "B"])).toEqual([]);
    // At a B event co-hosted with C, only the co-hosting link counts.
    expect(checkinLines(["B", "C"], ["A", "B"])).toEqual([["B", "C"]]);
  });

  it("counts a line once per check-in, even for a member of both clubs", () => {
    expect(checkinLines(["A", "B"], ["A", "B"])).toEqual([["A", "B"]]);
  });

  it("weights lines and sizes nodes by check-ins", () => {
    const { edges, sizes, crossClubCheckins } = accumulateNetwork([
      { participants: ["B", "C"], memberOf: ["A"], count: 3 },
      { participants: ["B"], memberOf: ["A"], count: 2 },
      { participants: ["B"], memberOf: ["B"], count: 10 },
      { participants: ["C"], memberOf: ["Z"], count: 4 },
    ]);
    expect(edges).toEqual([
      { source: "A", target: "B", weight: 5 },
      { source: "C", target: "Z", weight: 4 },
      { source: "A", target: "C", weight: 3 },
    ]);
    expect(Object.fromEntries(sizes)).toEqual({ B: 15, C: 7 });
    expect(crossClubCheckins).toBe(9);
  });

  it("drops lines and sizes for clubs that aren't on the canvas", () => {
    const { edges, sizes, crossClubCheckins } = accumulateNetwork(
      [
        { participants: ["B", "C"], memberOf: ["A"], count: 3 },
        { participants: ["C"], memberOf: ["RETIRED"], count: 4 },
      ],
      new Set(["A", "B", "C"]),
    );
    expect(edges).toEqual([
      { source: "A", target: "B", weight: 3 },
      { source: "A", target: "C", weight: 3 },
    ]);
    expect(Object.fromEntries(sizes)).toEqual({ B: 3, C: 7 });
    expect(crossClubCheckins).toBe(7);
  });

  it("gets the same lines from the database's aggregate counts as from check-ins one by one", () => {
    // A member of both co-hosts is counted in both directions by the directed
    // counts; the overlap count takes the extra one back off.
    const both = [{ participants: ["B", "C"], memberOf: ["B", "C"], count: 2 }];
    const counts = countsFromCheckins(both);
    expect(counts.overlaps).toEqual([{ a: "B", b: "C", count: 2 }]);
    expect(linesFromCounts(counts.directed, counts.overlaps)).toEqual([{ source: "B", target: "C", weight: 2 }]);

    // And on a varied, deterministic mix of events and memberships.
    const clubs = ["A", "B", "C", "D", "E"];
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pick = (max: number) => clubs.filter(() => rand(clubs.length) < max);
    const groups = Array.from({ length: 300 }, () => ({ participants: pick(2).length ? pick(2) : ["A"], memberOf: pick(2), count: 1 + rand(4) }));
    const reference = accumulateNetwork(groups, new Set(["A", "B", "C", "D"]));
    const aggregate = countsFromCheckins(groups);
    expect(linesFromCounts(aggregate.directed, aggregate.overlaps, new Set(["A", "B", "C", "D"]))).toEqual(reference.edges);
    expect(reference.edges.length).toBeGreaterThan(3);
  });

  it("ignores self pairs and lines that cancel out", () => {
    expect(linesFromCounts([{ a: "A", b: "A", count: 4 }], [])).toEqual([]);
    expect(linesFromCounts([{ a: "A", b: "B", count: 1 }], [{ a: "B", b: "A", count: 1 }])).toEqual([]);
  });
});
