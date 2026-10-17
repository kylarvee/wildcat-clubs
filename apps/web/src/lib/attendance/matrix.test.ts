import { describe, expect, it } from "vitest";
import { buildMatrix, csvCell, memberAt, pct, sortRows, toCsv, type MxCheckin, type MxMembership } from "./matrix";

const d = (day: number, h = 18) => new Date(Date.UTC(2026, 9, day, h));
const occ = (id: string, day: number) => ({ id, startsAt: d(day) });
const ci = (occurrenceId: string, userId: string, method: MxCheckin["method"] = "QR"): MxCheckin => ({ id: `${occurrenceId}-${userId}`, occurrenceId, userId, method, checkedInAt: d(Number(occurrenceId.slice(1)), 18) });

// Three weekly meetings. Ana joined before all; Ben joined *at* the second meeting
// (check-in auto-join happens after the start), Cal left after the first; Dee is a guest.
const memberships: MxMembership[] = [
  { userId: "ana", status: "ACTIVE", joinedAt: d(1), endedAt: null },
  { userId: "ben", status: "ACTIVE", joinedAt: d(9, 19), endedAt: null },
  { userId: "cal", status: "LEFT", joinedAt: d(1), endedAt: d(5) },
  { userId: "eve", status: "PENDING", joinedAt: null, endedAt: null },
];
const occurrences = [occ("o2", 2), occ("o9", 9), occ("o16", 16), occ("o23", 23)];
const checkins = [ci("o2", "ana"), ci("o2", "cal"), ci("o9", "ana", "SELF"), ci("o9", "ben"), ci("o9", "dee", "MANUAL"), ci("o16", "ben")];

describe("membership at a moment", () => {
  it("needs a join date on or before, and no end at or before", () => {
    expect(memberAt(memberships[0], d(2))).toBe(true);
    expect(memberAt(memberships[1], d(9))).toBe(false); // joined during the meeting
    expect(memberAt(memberships[2], d(9))).toBe(false); // already left
    expect(memberAt(memberships[3], d(9))).toBe(false); // still pending
  });
});

describe("attendance matrix", () => {
  const m = buildMatrix({ occurrences, checkins, memberships });

  it("totals each column with the metrics definitions", () => {
    const [c2, c9, c16, c23] = m.columns;
    expect(c2).toMatchObject({ held: true, total: 2, memberAttendees: 2, guests: 0, membersAtTime: 2, rate: 1 });
    // Ben joined at this meeting, so he counts as a guest here; Dee is a guest.
    expect(c9).toMatchObject({ held: true, total: 3, memberAttendees: 1, guests: 2, membersAtTime: 1, rate: 1 });
    expect(c16).toMatchObject({ held: true, total: 1, memberAttendees: 1, membersAtTime: 2, rate: 0.5 });
    expect(c23).toMatchObject({ held: false, total: 0, rate: null });
  });

  it("rows are current members; everyone else who came is a guest", () => {
    expect(m.members.map((r) => r.userId).sort()).toEqual(["ana", "ben"]);
    expect(m.guests.map((r) => [r.userId, r.kind]).sort()).toEqual([
      ["cal", "FORMER"],
      ["dee", "GUEST"],
    ]);
  });

  it("row rates count held events since someone got involved", () => {
    const ana = m.members.find((r) => r.userId === "ana")!;
    expect(ana).toMatchObject({ attended: 2, attendedAsMember: 2, eligible: 3, rate: 2 / 3 });
    // Ben's involvement starts at his first check-in (the meeting where he joined).
    const ben = m.members.find((r) => r.userId === "ben")!;
    expect(ben).toMatchObject({ attended: 2, attendedAsMember: 1, eligible: 2, rate: 1 });
    expect(ben.cells.get("o9")?.asMember).toBe(false);
  });

  it("involvement before the range counts every held event in it", () => {
    const n = buildMatrix({ occurrences, checkins, memberships, involvedBefore: new Set(["ben"]) });
    expect(n.members.find((r) => r.userId === "ben")).toMatchObject({ eligible: 3, rate: 2 / 3 });
  });

  it("pending requests aren't members at the time", () => {
    expect(memberAt({ status: "PENDING", joinedAt: d(1), endedAt: null }, d(9))).toBe(false);
  });

  it("takes column numbers from metrics when given", () => {
    const stats = new Map([["o16", { memberAttendees: 1, guests: 0, membersAtTime: 4, rate: 0.25 }]]);
    const n = buildMatrix({ occurrences, checkins, memberships, columnStats: stats });
    expect(n.columns[2]).toMatchObject({ membersAtTime: 4, rate: 0.25 });
  });

  it("summarises the range", () => {
    expect(m.summary).toMatchObject({ events: 4, held: 3, checkins: 6, memberCheckins: 4, guestCheckins: 2, uniqueAttendees: 4, uniqueGuests: 2 });
    expect(m.summary.avgRate).toBeCloseTo((1 + 1 + 0.5) / 3);
  });

  it("ignores check-ins for occurrences outside the range", () => {
    const n = buildMatrix({ occurrences: occurrences.slice(0, 1), checkins, memberships });
    expect(n.summary.checkins).toBe(2);
    expect(n.guests.map((r) => r.userId)).toEqual(["cal"]);
  });

  it("sorts rows by rate with unrated people last", () => {
    const names: Record<string, string> = { ana: "Ana", ben: "Ben" };
    expect(sortRows(m.members, "rate", (id) => names[id]).map((r) => r.userId)).toEqual(["ben", "ana"]);
    expect(sortRows(m.members, "name", (id) => names[id]).map((r) => r.userId)).toEqual(["ana", "ben"]);
  });
});

describe("csv", () => {
  it("quotes and neutralises spreadsheet formulas", () => {
    expect(toCsv([["Name", "Note"], ['Ana "A" Lee', "=1+1"], [3, null]])).toBe('Name,Note\r\n"Ana ""A"" Lee",\'=1+1\r\n3,\r\n');
  });

  it("defuses every formula lead character, but leaves numbers alone", () => {
    expect(csvCell('=HYPERLINK("http://x","Open")')).toBe(`"'=HYPERLINK(""http://x"",""Open"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("\rx")).toBe(`"'\rx"`);
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell("Ana, Lee")).toBe('"Ana, Lee"');
    expect(csvCell(undefined)).toBe("");
  });

  it("formats rates", () => {
    expect(pct(2 / 3)).toBe("67%");
    expect(pct(null)).toBe("—");
  });
});
