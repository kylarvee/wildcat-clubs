import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { joinEventLinks, splitEventLinks } from "@/lib/events/links";
import { describeRecurrence } from "@/lib/events/summary";
import { fromFakeUtc, fromInputs, toDateInput, toFakeUtc, toTimeInput, toWallClockIso } from "@/lib/events/wallclock";
import { defaultFundingSource } from "@/lib/funding/defaults";
import { toSchedule, whenFrom } from "@/components/events/when";
import { campusDate, fmtRange } from "@/lib/time";

describe("event links", () => {
  it("round-trips links through the description", () => {
    const html = joinEventLinks("<p>Hello</p>", [
      { label: "Slides", url: "https://docs.google.com/x?a=1&b=2" },
      { label: "", url: "https://weber.edu" },
    ]);
    const { body, links } = splitEventLinks(html);
    expect(body).toBe("<p>Hello</p>");
    expect(links).toEqual([
      { label: "Slides", url: "https://docs.google.com/x?a=1&b=2" },
      { label: "", url: "https://weber.edu" },
    ]);
  });
  it("survives sanitizer-style attributes on anchors", () => {
    const html = '<p>x</p><ul data-type="eventLinks"><li><a href="https://a.test/?q=1&amp;r=2" target="_blank" rel="noopener noreferrer">A &amp; B</a></li></ul>';
    expect(splitEventLinks(html).links).toEqual([{ label: "A & B", url: "https://a.test/?q=1&r=2" }]);
  });
  it("drops non-http links and leaves plain descriptions alone", () => {
    expect(joinEventLinks("<p>x</p>", [{ label: "bad", url: "javascript:alert(1)" }])).toBe("<p>x</p>");
    expect(splitEventLinks("<p>Just text</p>")).toEqual({ body: "<p>Just text</p>", links: [] });
  });
});

/** Years show only outside the current campus year, so these tests pin "today". */
function pinToday() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T18:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

describe("describeRecurrence", () => {
  pinToday();
  const tue = campusDate(2026, 9, 1, 18, 0); // Tuesday
  it("names weekly days and the end date", () => {
    expect(describeRecurrence({ startsAt: tue, recurrence: "WEEKLY", weekdays: [2, 4], until: campusDate(2026, 12, 11, 23, 59) })).toBe("Every Tuesday and Thursday until Dec 11");
  });
  it("handles intervals, counts and the default horizon", () => {
    expect(describeRecurrence({ startsAt: tue, recurrence: "WEEKLY", interval: 2, weekdays: [2] })).toBe("Every 2 weeks on Tuesdays for a year");
    expect(describeRecurrence({ startsAt: tue, recurrence: "MONTHLY", count: 6 })).toBe("Every month on the 1st, 6 times");
    expect(describeRecurrence({ startsAt: tue, recurrence: "DAILY", interval: 3, until: campusDate(2027, 1, 5) })).toBe("Every 3 days until Jan 5, 2027");
    expect(describeRecurrence({ startsAt: tue, recurrence: "WEEKLY", weekdays: [1, 2, 3, 4, 5], count: 10 })).toBe("Every weekday, 10 times");
    expect(describeRecurrence({ startsAt: tue, recurrence: "NONE" })).toBe("Does not repeat");
  });
  it("shows the end year for a series from another year", () => {
    const wed = campusDate(2024, 9, 4, 18, 0); // Wednesday
    expect(describeRecurrence({ startsAt: wed, recurrence: "WEEKLY", weekdays: [3], until: campusDate(2024, 12, 6, 23, 59) })).toBe("Every Wednesday until Dec 6, 2024");
  });
});

describe("campus wall clock", () => {
  it("converts between real instants and campus inputs", () => {
    const at = campusDate(2026, 11, 3, 18, 30); // after DST ends
    expect(toDateInput(at)).toBe("2026-11-03");
    expect(toTimeInput(at)).toBe("18:30");
    expect(toWallClockIso(at)).toBe("2026-11-03T18:30:00");
    expect(fromInputs("2026-11-03", "18:30")?.getTime()).toBe(at.getTime());
    expect(fromFakeUtc(toFakeUtc(at)).getTime()).toBe(at.getTime());
  });
});

describe("toSchedule", () => {
  it("turns a When into the domain's schedule input", () => {
    const w = { ...whenFrom(campusDate(2026, 10, 20, 18, 0), 90), recurrence: "WEEKLY" as const, weekdays: [2], ends: "on" as const, until: "2026-12-08" };
    const s = toSchedule(w);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.value.durationMinutes).toBe(90);
    expect(s.value.recurrenceWeekdays).toEqual([2]);
    expect(s.value.recurrenceUntil).toBe(campusDate(2026, 12, 8, 23, 59).toISOString());
    expect(s.value.recurrenceCount).toBeNull();
  });
  it("runs past midnight when the end time is earlier on the same date", () => {
    const w = { ...whenFrom(campusDate(2026, 10, 20, 21, 0), 60), endTime: "01:00" };
    const s = toSchedule(w);
    expect(s.ok && s.value.durationMinutes).toBe(240);
  });
  it("rejects an end date before the start", () => {
    const w = { ...whenFrom(campusDate(2026, 10, 20, 18, 0), 60), recurrence: "DAILY" as const, ends: "on" as const, until: "2026-10-01" };
    expect(toSchedule(w).ok).toBe(false);
  });
});

describe("defaultFundingSource", () => {
  it("follows ARCHITECTURE §6", () => {
    expect(defaultFundingSource({ type: "REGISTERED", departmentId: "d1" })).toBe("WSUSA");
    expect(defaultFundingSource({ type: "SPONSORED", departmentId: "d1" })).toBe("DEPARTMENT");
    expect(defaultFundingSource({ type: "AFFILIATE", departmentId: null })).toBe("WSUSA");
    expect(defaultFundingSource(null)).toBe("UNIVERSITY");
  });
});

describe("fmtRange", () => {
  pinToday();
  it("names AM and PM on the start when a same-day event crosses noon", () => {
    expect(fmtRange(campusDate(2026, 10, 17, 10, 0), campusDate(2026, 10, 17, 14, 0))).toBe("Sat, Oct 17 · 10:00 AM – 2:00 PM");
  });
  it("names the half of the day once when both ends share it", () => {
    expect(fmtRange(campusDate(2026, 10, 16, 18, 30), campusDate(2026, 10, 16, 20, 0))).toBe("Fri, Oct 16 · 6:30 – 8:00 PM");
  });
  it("shows a one-day all-day event as one day (the end is the next midnight)", () => {
    expect(fmtRange(campusDate(2026, 10, 20), campusDate(2026, 10, 21), true)).toBe("Tue, Oct 20 · All day");
    expect(fmtRange(campusDate(2027, 3, 14), campusDate(2027, 3, 15), true)).toBe("Sun, Mar 14, 2027 · All day");
  });
  it("shows the last day of a multi-day all-day range", () => {
    expect(fmtRange(campusDate(2026, 10, 20), campusDate(2026, 10, 23), true)).toBe("Oct 20 – Oct 22");
  });
  it("shows the year of a date outside the current campus year", () => {
    expect(fmtRange("2024-12-05T01:00:00Z", "2024-12-05T02:30:00Z")).toBe("Wed, Dec 4, 2024 · 6:00 – 7:30 PM");
    expect(fmtRange(campusDate(2026, 12, 31, 20, 0), campusDate(2027, 1, 1, 1, 0))).toBe("Dec 31, 8:00 PM – Jan 1, 2027, 1:00 AM");
  });
});
