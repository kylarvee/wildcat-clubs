import { describe, expect, it } from "vitest";
import type { ComplianceRow } from "@/lib/domain/requirements";
import { applyFilter, filterQuery, parseFilter } from "@/app/admin/requirements/filters";

const d = new Date("2026-11-01T12:00:00Z");
const row = (over: Partial<ComplianceRow> & { key: string }): ComplianceRow => ({
  person: { id: over.key, name: over.key, email: `${over.key}@mail.weber.edu`, handle: over.key, avatarUrl: null, avatarColor: "#000" },
  club: { id: "c1", name: "Chess Club", slug: "chess" },
  role: "OFFICER",
  seat: null,
  startedAt: d,
  cells: {},
  paused: false,
  ...over,
});

const rows = [
  row({ key: "maya", cells: { test: { state: "met", dueAt: d }, training: { state: "met", dueAt: d } } }),
  row({ key: "oscar", cells: { test: { state: "due", dueAt: d }, training: { state: "due", dueAt: d } } }),
  row({ key: "nina", role: "PRESIDENT", club: { id: "c2", name: "Robotics", slug: "robotics" }, cells: { test: { state: "overdue", dueAt: d }, training: { state: "met", dueAt: d } }, paused: true }),
  row({ key: "amir", role: "AMBASSADOR", cells: {} }),
];

describe("compliance filters", () => {
  it("reads only known values from the URL", () => {
    expect(parseFilter({ state: "bogus", role: "ADVISOR", q: " Maya " })).toEqual({ club: "", state: "", req: "", role: "", q: "Maya" });
    expect(filterQuery(parseFilter({ state: "overdue", club: "c2" }))).toBe("?club=c2&state=overdue");
  });

  it("filters by status across requirements or for one", () => {
    expect(applyFilter(rows, parseFilter({ state: "overdue" })).map((r) => r.key)).toEqual(["nina"]);
    expect(applyFilter(rows, parseFilter({ state: "met" })).map((r) => r.key)).toEqual(["maya"]);
    expect(applyFilter(rows, parseFilter({ state: "met", req: "training" })).map((r) => r.key)).toEqual(["maya", "nina"]);
    expect(applyFilter(rows, parseFilter({ state: "paused" })).map((r) => r.key)).toEqual(["nina"]);
  });

  it("filters by club, role and name, and leaves out people a requirement doesn't apply to", () => {
    expect(applyFilter(rows, parseFilter({ club: "c2" })).map((r) => r.key)).toEqual(["nina"]);
    expect(applyFilter(rows, parseFilter({ role: "OFFICER" })).map((r) => r.key)).toEqual(["maya", "oscar"]);
    expect(applyFilter(rows, parseFilter({ q: "OSC" })).map((r) => r.key)).toEqual(["oscar"]);
    expect(applyFilter(rows, parseFilter({ req: "test" })).map((r) => r.key)).not.toContain("amir");
  });
});
