import { describe, expect, test } from "vitest";
import { clubListHref, hasActiveFilters, parseClubListParams } from "@/components/clubs/list-params";

describe("clubs list URL params", () => {
  test("defaults stay out of the URL", () => {
    expect(clubListHref(parseClubListParams({}))).toBe("/clubs");
  });

  test("round-trips filters, sort and view", () => {
    const p = parseClubListParams({ q: " robots ", type: "SPONSORED", sort: "rating", view: "list", college: "east" });
    expect(p).toMatchObject({ q: "robots", type: "SPONSORED", sort: "rating", dir: "desc", view: "list", college: "east" });
    expect(clubListHref(p)).toBe("/clubs?q=robots&type=SPONSORED&college=east&sort=rating&view=list");
    expect(parseClubListParams(new URLSearchParams(clubListHref(p).split("?")[1]))).toEqual(p);
  });

  test("changing the sort resets direction to that sort's natural one", () => {
    const p = parseClubListParams({ sort: "members", dir: "asc" });
    expect(clubListHref(p, { sort: "name" })).toBe("/clubs");
    expect(clubListHref(p, { sort: "name", dir: "desc" })).toBe("/clubs?dir=desc");
  });

  test("ignores junk", () => {
    expect(parseClubListParams({ type: "BOGUS", sort: "drop table", college: "../etc", status: "x", view: "cards" })).toMatchObject({
      type: null,
      sort: "name",
      dir: "asc",
      college: null,
      status: null,
      view: "grid",
    });
  });

  test("knows when filters are on", () => {
    expect(hasActiveFilters(parseClubListParams({ sort: "rating", view: "list" }))).toBe(false);
    expect(hasActiveFilters(parseClubListParams({ mine: "1" }))).toBe(true);
  });
});
