import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import { academicYearOf, academicYearsBetween, assignLanes, coverageGaps, fmtMonthRange, fmtTenure, mergeIntervals, spanPercent } from "@/lib/roles/history";
import { parseCampusLocal, toCampusLocal } from "@/lib/roles/datetime";

const d = (y: number, m: number, day = 1) => campusDate(y, m, day, 12);

describe("academic years", () => {
  it("runs July to June in campus time", () => {
    expect(academicYearOf(d(2025, 9)).label).toBe("2025–26");
    expect(academicYearOf(d(2026, 3)).label).toBe("2025–26");
    expect(academicYearOf(campusDate(2026, 7, 1, 0, 0)).label).toBe("2026–27");
    expect(academicYearOf(campusDate(2026, 6, 30, 23, 59)).label).toBe("2025–26");
  });
  it("lists every year a span touches", () => {
    expect(academicYearsBetween(d(2024, 9), d(2026, 2)).map((y) => y.label)).toEqual(["2024–25", "2025–26"]);
    expect(academicYearsBetween(d(2026, 1), d(2026, 3)).map((y) => y.label)).toEqual(["2025–26"]);
  });
});

describe("coverage and gaps", () => {
  it("merges overlapping holders", () => {
    const merged = mergeIntervals(
      [
        { start: d(2025, 1), end: d(2025, 6) },
        { start: d(2025, 5), end: d(2025, 9) },
        { start: d(2026, 1), end: null },
      ],
      d(2026, 3),
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].end).toEqual(d(2025, 9));
    expect(merged[1].end).toEqual(d(2026, 3));
  });

  it("finds the vacancy between two holders and a trailing one", () => {
    const gaps = coverageGaps(
      [
        { start: d(2024, 8), end: d(2025, 1) },
        { start: d(2025, 5), end: d(2025, 12) },
      ],
      d(2024, 8),
      d(2026, 3),
    );
    expect(gaps.map((g) => fmtMonthRange(g.start, g.end))).toEqual(["Jan–May 2025", "Dec 2025 – Mar 2026"]);
  });

  it("ignores hand-off blips shorter than a week", () => {
    const gaps = coverageGaps(
      [
        { start: d(2025, 1, 1), end: d(2025, 3, 1) },
        { start: d(2025, 3, 3), end: null },
      ],
      d(2025, 1, 1),
      d(2025, 6, 1),
    );
    expect(gaps).toEqual([]);
  });

  it("treats co-holders as one coverage", () => {
    const gaps = coverageGaps(
      [
        { start: d(2025, 1), end: d(2025, 4) },
        { start: d(2025, 3), end: d(2025, 8) },
      ],
      d(2025, 1),
      d(2025, 8),
    );
    expect(gaps).toEqual([]);
  });
});

describe("lanes", () => {
  it("puts overlapping holders on separate lanes and reuses freed lanes", () => {
    const items = [
      { id: "a", start: d(2025, 1), end: d(2025, 6) },
      { id: "b", start: d(2025, 3), end: d(2025, 9) },
      { id: "c", start: d(2025, 7), end: null },
    ];
    const lanes = Object.fromEntries(assignLanes(items, d(2026, 1)).map((l) => [l.item.id, l.lane]));
    expect(lanes).toEqual({ a: 0, b: 1, c: 0 });
  });
});

describe("formatting", () => {
  it("formats month ranges", () => {
    expect(fmtMonthRange(d(2025, 3), d(2025, 3, 20))).toBe("Mar 2025");
    expect(fmtMonthRange(d(2025, 1), d(2025, 5))).toBe("Jan–May 2025");
    expect(fmtMonthRange(d(2024, 8), d(2025, 1))).toBe("Aug 2024 – Jan 2025");
    expect(fmtMonthRange(d(2026, 3), null)).toBe("since Mar 2026");
  });
  it("formats tenure", () => {
    expect(fmtTenure(d(2025, 1), d(2025, 1, 4))).toBe("3 days");
    expect(fmtTenure(d(2025, 1), d(2025, 6))).toBe("5 mo");
    expect(fmtTenure(d(2024, 1), d(2025, 4))).toBe("1 yr 3 mo");
  });
  it("positions spans within a year", () => {
    const y = academicYearOf(d(2025, 9));
    const p = spanPercent({ start: y.start, end: new Date((y.start.getTime() + y.end.getTime()) / 2) }, { start: y.start, end: y.end })!;
    expect(p.left).toBe(0);
    expect(Math.round(p.width)).toBe(50);
    expect(spanPercent({ start: d(2020, 1), end: d(2020, 2) }, y)).toBeNull();
  });
});

describe("campus datetime-local", () => {
  it("round-trips campus wall time", () => {
    const at = parseCampusLocal("2026-10-20T18:30")!;
    expect(toCampusLocal(at)).toBe("2026-10-20T18:30");
    // 6:30 PM in Ogden (MDT, UTC-6) is 00:30 UTC the next day.
    expect(at.toISOString()).toBe("2026-10-21T00:30:00.000Z");
  });
  it("rejects malformed input", () => {
    expect(parseCampusLocal("")).toBeNull();
    expect(parseCampusLocal("2026-13-01T10:00")).toBeNull();
    expect(parseCampusLocal("tomorrow")).toBeNull();
  });
});
