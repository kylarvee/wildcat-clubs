import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import { fmtDuration, fmtExperienceRange, fmtYearSpan, overallSpan, toMonthInput } from "./format";
import { parseCsv, parseLinkedInDate, parseLinkedInPositions, positionKey } from "./linkedin";

describe("profile date formatting", () => {
  it("counts months inclusively, like LinkedIn", () => {
    expect(fmtDuration(campusDate(2024, 9, 3), campusDate(2026, 5, 1))).toBe("1 yr 9 mos");
    expect(fmtDuration(campusDate(2025, 3, 1), campusDate(2025, 3, 28))).toBe("1 mo");
    expect(fmtDuration(campusDate(2024, 1, 1), campusDate(2025, 12, 31))).toBe("2 yrs");
    expect(fmtDuration(campusDate(2026, 6, 15), null, campusDate(2026, 10, 16))).toBe("5 mos");
  });

  it("uses campus time at month edges", () => {
    // 2026-05-01 02:00 UTC is still April 30 in Ogden.
    expect(fmtExperienceRange(campusDate(2025, 9, 1), new Date("2026-05-01T02:00:00Z"))).toBe("Sep 2025 – Apr 2026 · 8 mos");
    expect(toMonthInput(new Date("2026-05-01T02:00:00Z"))).toBe("2026-04");
  });

  it("shows Present for open roles", () => {
    expect(fmtExperienceRange(campusDate(2025, 8, 20), null, campusDate(2026, 10, 16))).toBe("Aug 2025 – Present · 1 yr 3 mos");
  });

  it("formats education years", () => {
    expect(fmtYearSpan(2022, 2026)).toBe("2022 – 2026");
    expect(fmtYearSpan(2022, null)).toBe("2022 – Present");
    expect(fmtYearSpan(null, 2026)).toBe("2026");
    expect(fmtYearSpan(null, null)).toBe("");
  });

  it("finds the overall span of several roles", () => {
    const a = { start: campusDate(2023, 10, 4), end: campusDate(2024, 5, 3) };
    const b = { start: campusDate(2024, 5, 3), end: campusDate(2026, 5, 1) };
    expect(overallSpan([b, a])).toEqual({ start: a.start, end: b.end });
    expect(overallSpan([a, { start: b.start, end: null }])?.end).toBeNull();
    expect(overallSpan([])).toBeNull();
  });
});

describe("LinkedIn Positions.csv", () => {
  it("parses quoted fields with commas, quotes and newlines", () => {
    const rows = parseCsv('a,"b, c","say ""hi""","line 1\nline 2"\r\nx,y,z,w\n');
    expect(rows).toEqual([
      ["a", "b, c", 'say "hi"', "line 1\nline 2"],
      ["x", "y", "z", "w"],
    ]);
  });

  it("reads LinkedIn's date styles", () => {
    expect(parseLinkedInDate("Mar 2023")).toEqual({ year: 2023, month: 3 });
    expect(parseLinkedInDate("September 2021")).toEqual({ year: 2021, month: 9 });
    expect(parseLinkedInDate("2019")).toEqual({ year: 2019, month: 1 });
    expect(parseLinkedInDate("03/2023")).toEqual({ year: 2023, month: 3 });
    expect(parseLinkedInDate("2023-11")).toEqual({ year: 2023, month: 11 });
    expect(parseLinkedInDate("")).toBeNull();
    expect(parseLinkedInDate("Smarch 2023")).toBeNull();
    expect(parseLinkedInDate("13/2023")).toBeNull();
  });

  it("turns the export into positions and explains skipped rows", () => {
    const csv = [
      "﻿Company Name,Title,Description,Location,Started On,Finished On",
      'Wasatch Analytics Group,Junior Data Analyst,"Dashboards, reporting","Salt Lake City, Utah",Jun 2026,',
      "Weber State Office of Institutional Research,Data Analytics Intern,,Ogden,May 2025,Aug 2025",
      ",No company,,,Jan 2020,",
      "Acme,Backwards,,,May 2025,Jan 2025",
      "Acme,Bad date,,,sometime,",
    ].join("\r\n");
    const r = parseLinkedInPositions(csv);
    expect(r.error).toBeUndefined();
    expect(r.positions).toHaveLength(2);
    expect(r.positions[0]).toMatchObject({ row: 1, company: "Wasatch Analytics Group", title: "Junior Data Analyst", description: "Dashboards, reporting", location: "Salt Lake City, Utah", startedOn: { year: 2026, month: 6 }, finishedOn: null });
    expect(r.positions[1].finishedOn).toEqual({ year: 2025, month: 8 });
    expect(r.skipped.map((s) => s.row)).toEqual([3, 4, 5]);
  });

  it("rejects files that aren't Positions.csv", () => {
    expect(parseLinkedInPositions("First Name,Last Name,Email\nA,B,c@d.e").error).toMatch(/Positions\.csv/);
    expect(parseLinkedInPositions("").error).toMatch(/empty/);
  });

  it("matches duplicates regardless of case and spacing", () => {
    const a = positionKey({ title: "Data  Analyst", company: "Acme", startedOn: { year: 2024, month: 2 } });
    const b = positionKey({ title: "data analyst", company: " ACME ", startedOn: { year: 2024, month: 2 } });
    expect(a).toBe(b);
  });
});

describe("shortName", () => {
  it("uses the first name, or title and last name", async () => {
    const { shortName } = await import("./format");
    expect(shortName("Maya Chen")).toBe("Maya");
    expect(shortName("Dr. Elena Alvarez")).toBe("Dr. Alvarez");
    expect(shortName("Prof. Nathan Reed")).toBe("Prof. Reed");
    expect(shortName("Cher")).toBe("Cher");
  });
});
