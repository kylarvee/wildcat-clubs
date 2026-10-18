import { describe, expect, test } from "vitest";
import { clubListHref, defaultSort, hasActiveFilters, isRankedSort, parseClubListParams, SORT_LABEL } from "@/components/clubs/list-params";

describe("clubs list URL params", () => {
  test("defaults stay out of the URL", () => {
    expect(clubListHref(parseClubListParams({}))).toBe("/clubs");
    expect(clubListHref(parseClubListParams({ q: "chess" }))).toBe("/clubs?q=chess");
  });

  test("Recommended is the default order, and Best match while searching", () => {
    expect(parseClubListParams({})).toMatchObject({ sort: "recommended", dir: "desc" });
    expect(parseClubListParams({ q: "robotics" })).toMatchObject({ sort: "relevance", dir: "desc" });
    expect(defaultSort("")).toBe("recommended");
    expect(defaultSort("x")).toBe("relevance");
    expect(SORT_LABEL.relevance).toBe("Best match");
    expect(SORT_LABEL.recommended).toBe("Recommended");
  });

  test("Best match without a query falls back to Recommended", () => {
    expect(parseClubListParams({ sort: "relevance" })).toMatchObject({ sort: "recommended" });
    expect(clubListHref(parseClubListParams({ q: "art" }), { sort: "relevance", q: "" })).toBe("/clubs");
  });

  test("ranked sorts always read best first and take no direction", () => {
    expect(isRankedSort("recommended") && isRankedSort("relevance") && !isRankedSort("name")).toBe(true);
    expect(parseClubListParams({ sort: "recommended", dir: "asc" })).toMatchObject({ sort: "recommended", dir: "desc" });
    expect(clubListHref(parseClubListParams({ q: "art" }), { dir: "asc" })).toBe("/clubs?q=art");
  });

  test("round-trips filters, sort and view", () => {
    const p = parseClubListParams({ q: " robots ", type: "SPONSORED", sort: "rating", view: "list", college: "east" });
    expect(p).toMatchObject({ q: "robots", type: "SPONSORED", sort: "rating", dir: "desc", view: "list", college: "east" });
    expect(clubListHref(p)).toBe("/clubs?q=robots&type=SPONSORED&college=east&sort=rating&view=list");
    expect(parseClubListParams(new URLSearchParams(clubListHref(p).split("?")[1]))).toEqual(p);
    const r = parseClubListParams({ q: "chess", sort: "recommended" });
    expect(clubListHref(r)).toBe("/clubs?q=chess&sort=recommended");
    expect(parseClubListParams(new URLSearchParams(clubListHref(r).split("?")[1]))).toEqual(r);
  });

  test("changing the sort resets direction to that sort's natural one", () => {
    const p = parseClubListParams({ sort: "members", dir: "asc" });
    expect(clubListHref(p, { sort: "name" })).toBe("/clubs?sort=name");
    expect(clubListHref(p, { sort: "name", dir: "desc" })).toBe("/clubs?sort=name&dir=desc");
    expect(clubListHref(p, { sort: "recommended" })).toBe("/clubs");
  });

  test("links from before Recommended still mean what they meant", () => {
    // The old default was Name A–Z, so a bare direction was a name sort.
    expect(parseClubListParams({ dir: "desc" })).toMatchObject({ sort: "name", dir: "desc" });
    expect(parseClubListParams({ dir: "asc", q: "art" })).toMatchObject({ sort: "name", dir: "asc" });
    expect(parseClubListParams({ sort: "name" })).toMatchObject({ sort: "name", dir: "asc" });
    expect(parseClubListParams({ sort: "rating" })).toMatchObject({ sort: "rating", dir: "desc" });
    expect(clubListHref(parseClubListParams({ dir: "desc" }))).toBe("/clubs?sort=name&dir=desc");
  });

  test("a new search moves a default-ordered list to Best match, and clearing it moves back", () => {
    const browsing = parseClubListParams({});
    expect(clubListHref(browsing, { q: "chess" })).toBe("/clubs?q=chess");
    const searching = parseClubListParams({ q: "chess" });
    expect(clubListHref(searching, { q: "" })).toBe("/clubs");
    expect(clubListHref(searching, { q: "chess club" })).toBe("/clubs?q=chess+club");
    // A sort someone chose stays chosen.
    const byRating = parseClubListParams({ sort: "rating" });
    expect(clubListHref(byRating, { q: "chess" })).toBe("/clubs?q=chess&sort=rating");
    const recommendedSearch = parseClubListParams({ q: "chess", sort: "recommended" });
    expect(clubListHref(recommendedSearch, { q: "art" })).toBe("/clubs?q=art&sort=recommended");
    expect(clubListHref(recommendedSearch, { q: "" })).toBe("/clubs");
  });

  test("ignores junk", () => {
    expect(parseClubListParams({ type: "BOGUS", sort: "drop table", college: "../etc", status: "x", view: "cards" })).toMatchObject({
      type: null,
      sort: "recommended",
      dir: "desc",
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
