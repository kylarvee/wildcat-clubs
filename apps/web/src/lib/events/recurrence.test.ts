import { describe, expect, it } from "vitest";
import type { Term } from "@prisma/client";
import { expandOccurrences } from "@/lib/events/recurrence";
import { toDateInput, toTimeInput } from "@/lib/events/wallclock";
import { campusDate } from "@/lib/time";

const days = (xs: { startsAt: Date }[]) => xs.map((x) => toDateInput(x.startsAt));

describe("expandOccurrences", () => {
  it("makes one occurrence for NONE", () => {
    const s = campusDate(2026, 10, 20, 18, 0);
    expect(expandOccurrences({ startsAt: s, durationMinutes: 90, recurrence: "NONE" })).toEqual([{ startsAt: s, endsAt: new Date(s.getTime() + 90 * 60_000) }]);
  });

  it("repeats weekly on several days until a date, keeping 6 PM across daylight saving", () => {
    const occ = expandOccurrences({ startsAt: campusDate(2026, 10, 27, 18, 0), durationMinutes: 60, recurrence: "WEEKLY", weekdays: [2, 4], until: campusDate(2026, 11, 12, 23, 59) });
    expect(days(occ)).toEqual(["2026-10-27", "2026-10-29", "2026-11-03", "2026-11-05", "2026-11-10", "2026-11-12"]);
    expect(occ.every((o) => toTimeInput(o.startsAt) === "18:00")).toBe(true);
  });

  it("honors a count beyond one year", () => {
    const occ = expandOccurrences({ startsAt: campusDate(2026, 9, 1, 18, 0), durationMinutes: 60, recurrence: "WEEKLY", count: 60 });
    expect(occ).toHaveLength(60);
  });

  it("runs a year by default", () => {
    const occ = expandOccurrences({ startsAt: campusDate(2026, 9, 1, 18, 0), durationMinutes: 60, recurrence: "MONTHLY" });
    expect(occ).toHaveLength(13);
  });

  it("repeats once per semester at the same offset", () => {
    const term = (id: string, kind: Term["kind"], from: Date, to: Date): Term => ({ id, name: id, kind, academicYear: "x", startsOn: from, endsOn: to, countsForActivity: kind !== "SUMMER" });
    const terms = [
      term("F26", "FALL", campusDate(2026, 8, 24), campusDate(2026, 12, 18)),
      term("S27", "SPRING", campusDate(2027, 1, 11), campusDate(2027, 5, 1)),
      term("U27", "SUMMER", campusDate(2027, 5, 10), campusDate(2027, 8, 7)),
      term("F27", "FALL", campusDate(2027, 8, 23), campusDate(2027, 12, 17)),
    ];
    const occ = expandOccurrences({ startsAt: campusDate(2026, 9, 3, 12, 0), durationMinutes: 60, recurrence: "SEMESTERLY", until: campusDate(2027, 12, 31) }, terms);
    expect(days(occ)).toEqual(["2026-09-03", "2027-01-21", "2027-09-02"]);
  });
});
