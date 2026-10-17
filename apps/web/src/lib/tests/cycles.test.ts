import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import { cycleKeyLabel, renewalCycle, testCycle, type TermLike } from "@/lib/tests/cycles";

// Mirrors the seeded calendar shape (campus-time boundaries).
const terms: TermLike[] = [
  { name: "Spring 2026", academicYear: "2025-2026", startsOn: campusDate(2026, 1, 5), endsOn: campusDate(2026, 4, 24, 23, 59) },
  { name: "Summer 2026", academicYear: "2025-2026", startsOn: campusDate(2026, 5, 4), endsOn: campusDate(2026, 8, 7, 23, 59) },
  { name: "Fall 2026", academicYear: "2026-2027", startsOn: campusDate(2026, 8, 31), endsOn: campusDate(2026, 12, 18, 23, 59) },
  { name: "Spring 2027", academicYear: "2026-2027", startsOn: campusDate(2027, 1, 11), endsOn: campusDate(2027, 4, 30, 23, 59) },
  { name: "Summer 2027", academicYear: "2026-2027", startsOn: campusDate(2027, 5, 10), endsOn: campusDate(2027, 8, 13, 23, 59) },
];

describe("test cycles", () => {
  const at = campusDate(2026, 10, 16, 9);
  it("keys every recurrence", () => {
    expect(testCycle("ONE_OFF", at, terms).key).toBe("once");
    expect(testCycle("WEEKLY", at, terms).key).toBe("2026-W42");
    expect(testCycle("MONTHLY", at, terms).key).toBe("2026-10");
    expect(testCycle("SEMESTER", at, terms).key).toBe("Fall 2026");
    expect(testCycle("ACADEMIC_YEAR", at, terms).key).toBe("2026-2027");
    expect(testCycle("ANNUAL", at, terms).key).toBe("2026");
  });
  it("uses campus time at boundaries", () => {
    // 11:30 PM on Oct 31 in Ogden is already November in UTC — still October here.
    expect(testCycle("MONTHLY", campusDate(2026, 10, 31, 23, 30), terms).key).toBe("2026-10");
    expect(testCycle("ANNUAL", campusDate(2026, 12, 31, 23, 30), terms).key).toBe("2026");
    // Weeks start Monday (ISO): Sunday Oct 18 is still week 42, Monday Oct 19 is week 43.
    expect(testCycle("WEEKLY", campusDate(2026, 10, 18, 23), terms).key).toBe("2026-W42");
    expect(testCycle("WEEKLY", campusDate(2026, 10, 19, 0, 30), terms).key).toBe("2026-W43");
  });
  it("gives cycle bounds", () => {
    const m = testCycle("MONTHLY", at, terms);
    expect(m.start.getTime()).toBe(campusDate(2026, 10, 1).getTime());
    expect(m.end!.getTime()).toBe(campusDate(2026, 11, 1).getTime());
    const w = testCycle("WEEKLY", at, terms);
    expect(w.start.getTime()).toBe(campusDate(2026, 10, 12).getTime());
    expect(w.label).toBe("Week of Oct 12");
    const ay = testCycle("ACADEMIC_YEAR", at, terms);
    expect(ay.start.getTime()).toBe(campusDate(2026, 8, 31).getTime());
    expect(ay.label).toBe("2026–27");
  });
  it("keeps the last term between terms (summer break counts as the term before Fall)", () => {
    expect(testCycle("SEMESTER", campusDate(2026, 8, 20), terms).key).toBe("Summer 2026");
    expect(testCycle("ACADEMIC_YEAR", campusDate(2026, 8, 20), terms).key).toBe("2025-2026");
  });
  it("falls back sensibly without a calendar", () => {
    expect(testCycle("SEMESTER", at, []).key).toBe("2026");
    expect(testCycle("ACADEMIC_YEAR", at, []).key).toBe("2026-2027");
    expect(testCycle("ACADEMIC_YEAR", campusDate(2026, 3, 1), []).key).toBe("2025-2026");
  });
});

describe("requirement renewal cycles", () => {
  it("matches the seeded keys", () => {
    const at = campusDate(2026, 10, 16);
    expect(renewalCycle("NONE", at, terms).key).toBe("once");
    expect(renewalCycle("ACADEMIC_YEAR", at, terms).key).toBe("2026-2027");
    expect(renewalCycle("SEMESTER", at, terms).key).toBe("Fall 2026");
    expect(renewalCycle("ANNUAL", at, terms).key).toBe("2026");
  });
});

describe("cycle labels", () => {
  it("reads stored keys", () => {
    expect(cycleKeyLabel("once")).toBe("One time");
    expect(cycleKeyLabel("2026-2027")).toBe("2026–27");
    expect(cycleKeyLabel("2026-10")).toBe("October 2026");
    expect(cycleKeyLabel("2026-W07")).toBe("Week 7, 2026");
    expect(cycleKeyLabel("Fall 2026")).toBe("Fall 2026");
  });
});
