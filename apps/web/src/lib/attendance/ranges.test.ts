import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import { endOfDayInput, resolveRange, startOfDayInput, type TermLike } from "./ranges";

const term = (name: string, ay: string, s: [number, number, number], e: [number, number, number], counts = true): TermLike => ({
  name,
  academicYear: ay,
  startsOn: campusDate(...s),
  endsOn: campusDate(e[0], e[1], e[2], 23, 59),
  countsForActivity: counts,
});

const terms: TermLike[] = [
  term("Fall 2025", "2025-2026", [2025, 8, 25], [2025, 12, 12]),
  term("Spring 2026", "2025-2026", [2026, 1, 12], [2026, 5, 1]),
  term("Summer 2026", "2025-2026", [2026, 5, 11], [2026, 8, 7], false),
  term("Fall 2026", "2026-2027", [2026, 8, 24], [2026, 12, 11]),
];
const now = campusDate(2026, 10, 16, 12);

describe("tracker ranges", () => {
  it("defaults to this term", () => {
    const r = resolveRange({}, terms, now);
    expect(r).toMatchObject({ key: "term", label: "Fall 2026", fromInput: "2026-08-24", toInput: "2026-12-11" });
  });

  it("last term skips a summer term that doesn't count", () => {
    expect(resolveRange({ range: "lastTerm" }, terms, now)).toMatchObject({ key: "lastTerm", label: "Spring 2026" });
  });

  it("academic year spans every term with the same label", () => {
    const r = resolveRange({ range: "year" }, terms, campusDate(2026, 3, 1));
    expect(r).toMatchObject({ key: "year", fromInput: "2025-08-25", toInput: "2026-08-07", label: "2025–2026 academic year" });
  });

  it("between terms, 'this term' is the one that just ended", () => {
    expect(resolveRange({ range: "term" }, terms, campusDate(2026, 8, 15)).label).toBe("Summer 2026");
  });

  it("custom ranges are whole campus days, swapped if backwards", () => {
    const r = resolveRange({ range: "custom", from: "2026-10-10", to: "2026-09-01" }, terms, now);
    expect(r.key).toBe("custom");
    expect(r.from.getTime()).toBe(campusDate(2026, 9, 1).getTime());
    expect(r.to.getTime()).toBe(campusDate(2026, 10, 11).getTime() - 1);
    expect(r.label).toBe("Sep 1 – Oct 10, 2026");
  });

  it("custom with nothing usable falls back to this term", () => {
    expect(resolveRange({ range: "custom", from: "nope" }, terms, now).key).toBe("term");
  });

  it("works with no academic calendar yet", () => {
    expect(resolveRange({ range: "term" }, [], now).label).toBe("Last 120 days");
    expect(resolveRange({ range: "year" }, [], now).label).toBe("Last 12 months");
  });

  it("rejects impossible dates", () => {
    expect(startOfDayInput("2026-02-30")).toBeNull();
    expect(endOfDayInput("2026-13-01")).toBeNull();
    expect(startOfDayInput("2026-02-28")).not.toBeNull();
  });
});
