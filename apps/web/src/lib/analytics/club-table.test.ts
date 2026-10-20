import { describe, expect, it } from "vitest";
import { csvRows, filterRows, filtersToQuery, missingLeaders, parseTableFilters, sortRows, stageLabel, stageOf, type ClubAnalyticsRow } from "./club-table";

const row = (p: Partial<ClubAnalyticsRow>): ClubAnalyticsRow => ({
  id: p.name ?? "x",
  name: "Club",
  slug: "club",
  type: "REGISTERED",
  status: "APPROVED",
  stage: "active",
  scope: "COLLEGE",
  collegeId: "c1",
  collegeName: "College of Science",
  collegeShort: "Science",
  registered: 10,
  active: 5,
  retention: 0.5,
  retentionSummary: { from: "Sep 2026", to: "Oct 2026", rate: 0.5, retained: 5, previousAttendees: 10, months: "Sep → Oct", label: "Sep → Oct: 50% came back" },
  avgAttendance: 0.6,
  heldEvents: 3,
  serviceMinutes: 270,
  rating: 4,
  reviews: 2,
  connections: 3,
  crossCheckins: 40,
  presidents: 1,
  advisors: 1,
  ...p,
});

const rows = [
  row({ name: "Astronomy Club", retention: 0.9, registered: 8 }),
  row({ name: "Béisbol Club", collegeId: null, collegeName: null, collegeShort: null, scope: "SPORTS", retention: null, type: "AFFILIATE", advisors: 0 }),
  row({ name: "Chess Club", stage: "inactive", retention: 0.2, registered: 30, presidents: 0, advisors: 0 }),
  row({ name: "Drafty", status: "DRAFT", stage: "founding", retention: null, retentionSummary: null, rating: null, presidents: 0, advisors: 0 }),
  row({ name: "Pilot Club", stage: "pilot", retention: 1 }),
];

describe("stages", () => {
  it("follows metrics for approved clubs and the lifecycle otherwise", () => {
    expect(stageOf("APPROVED", { active: true, inPilot: true })).toBe("pilot");
    expect(stageOf("APPROVED", { active: true, inPilot: false })).toBe("active");
    expect(stageOf("APPROVED", { active: false, inPilot: false })).toBe("inactive");
    expect(stageOf("APPROVED", undefined)).toBe("inactive");
    expect(stageOf("SUBMITTED", undefined)).toBe("founding");
    expect(stageOf("RETIRED", undefined)).toBe("retired");
    expect(stageOf("REJECTED", undefined)).toBe("rejected");
  });
  it("names founding clubs by where they are in review", () => {
    expect(stageLabel({ stage: "founding", status: "SUBMITTED" })).toBe("In WSUSA review");
    expect(stageLabel({ stage: "founding", status: "CHANGES_REQUESTED" })).toBe("Changes requested");
    expect(stageLabel({ stage: "pilot", status: "APPROVED" })).toBe("Pilot period");
  });
});

describe("filters", () => {
  it("round-trips through the query string, leaving defaults out", () => {
    const f = parseTableFilters(new URLSearchParams("q=chess&college=none&type=AFFILIATE&status=approved&sort=retention"));
    expect(f).toMatchObject({ q: "chess", college: "none", type: "AFFILIATE", stage: "approved", sort: "retention", dir: "desc" });
    expect(filtersToQuery(f)).toBe("q=chess&college=none&type=AFFILIATE&status=approved&sort=retention");
    expect(filtersToQuery(parseTableFilters({}))).toBe("");
  });
  it("ignores unknown values instead of failing", () => {
    expect(parseTableFilters({ sort: "bogus", type: "NOPE", status: "x", dir: "sideways" })).toMatchObject({ sort: "name", type: null, stage: null, dir: "asc" });
  });
  it("matches names without accents, colleges, types and stages", () => {
    const base = parseTableFilters({});
    expect(filterRows(rows, { ...base, q: "beisbol" }).map((r) => r.name)).toEqual(["Béisbol Club"]);
    expect(filterRows(rows, { ...base, college: "none" }).map((r) => r.name)).toEqual(["Béisbol Club"]);
    expect(filterRows(rows, { ...base, type: "AFFILIATE" })).toHaveLength(1);
    expect(filterRows(rows, { ...base, stage: "approved" }).map((r) => r.name)).toEqual(["Astronomy Club", "Béisbol Club", "Chess Club", "Pilot Club"]);
    expect(filterRows(rows, { ...base, stage: "inactive" }).map((r) => r.name)).toEqual(["Chess Club"]);
  });
  it("finds approved clubs with no President or no advisor, leaving founding clubs out", () => {
    const base = parseTableFilters({});
    expect(filterRows(rows, { ...base, missing: "president" }).map((r) => r.name)).toEqual(["Chess Club"]);
    expect(filterRows(rows, { ...base, missing: "advisor" }).map((r) => r.name)).toEqual(["Béisbol Club", "Chess Club"]);
    expect(missingLeaders(rows[2])).toEqual(["president", "advisor"]);
    expect(missingLeaders(rows[3])).toEqual([]);
    const f = parseTableFilters(new URLSearchParams("missing=president&status=active"));
    expect(f).toMatchObject({ missing: "president", stage: "active" });
    expect(filtersToQuery(f)).toBe("status=active&missing=president");
    expect(parseTableFilters({ missing: "treasurer" }).missing).toBeNull();
  });
});

describe("sortRows", () => {
  it("puts missing values last in both directions", () => {
    expect(sortRows(rows, "retention", "desc").map((r) => r.name)).toEqual(["Pilot Club", "Astronomy Club", "Chess Club", "Béisbol Club", "Drafty"]);
    expect(sortRows(rows, "retention", "asc").map((r) => r.name)).toEqual(["Chess Club", "Astronomy Club", "Pilot Club", "Béisbol Club", "Drafty"]);
  });
  it("orders stages active → pilot → inactive → founding", () => {
    expect(sortRows(rows, "stage", "asc").map((r) => r.stage)).toEqual(["active", "active", "pilot", "inactive", "founding"]);
  });
  it("sorts by service hours this term, most first", () => {
    const withHours = [row({ name: "A", serviceMinutes: 60 }), row({ name: "B", serviceMinutes: 600 }), row({ name: "C", serviceMinutes: 0 })];
    expect(sortRows(withHours, "service", "desc").map((r) => r.name)).toEqual(["B", "A", "C"]);
    expect(parseTableFilters({ sort: "service" })).toMatchObject({ sort: "service", dir: "desc" });
  });
});

describe("csvRows", () => {
  it("writes percentages, blanks for missing data and full links", () => {
    const [header, first] = csvRows([rows[0], rows[3]], "Fall 2026", (p) => `https://clubs.example${p}`);
    expect(header).toContain("Average attendance rate (Fall 2026) (%)");
    expect(header.slice(6, 8)).toEqual(["Retention (%)", "Retention months"]);
    expect(header.slice(-3)).toEqual(["Presidents", "Advisors", "Club page"]);
    expect(header.slice(9, 11)).toEqual(["Events held (Fall 2026)", "Service hours (Fall 2026)"]);
    expect(first).toEqual(["Astronomy Club", "Registered", "College of Science", "Active", 8, 5, 90, "Sep 2026 → Oct 2026", 60, 3, 4.5, 4, 2, 3, 40, 1, 1, "https://clubs.example/clubs/club"]);
    const draft = csvRows([rows[3]], null)[1];
    expect(draft[3]).toBe("Draft");
    expect(draft[6]).toBe("");
    expect(draft[7]).toBe("");
    expect(draft[11]).toBe("");
  });
});
