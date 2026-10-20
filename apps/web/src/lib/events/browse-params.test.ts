import { describe, expect, it } from "vitest";
import {
  CLEARED,
  dateRange,
  dayHeading,
  eventsHref,
  filterSearchParams,
  hasFilters,
  LIST_STEP,
  listWindow,
  parseEventParams,
  rangeLabel,
  resolveScope,
  shortcutRange,
  validDate,
} from "@/lib/events/browse-params";
import { eventFilterWhere } from "@/lib/events/browse-where";
import { campusDate } from "@/lib/time";

/** A campus instant: campus(2026, 10, 20, 9, 30) is 9:30 AM in Ogden. */
const campus = campusDate;
const iso = (d: Date) => d.toISOString();

describe("Events page URL", () => {
  it("leaves defaults out of links", () => {
    expect(eventsHref(parseEventParams({}))).toBe("/events");
    expect(parseEventParams({})).toMatchObject({ scope: null, view: "list", when: null, date: null, q: "", food: false, show: LIST_STEP });
  });

  it("round-trips scope, view, dates and every filter", () => {
    const p = parseEventParams({ scope: "mine", view: "month", when: "weekend", q: " robots ", type: "SOCIAL", category: "ACADEMIC", food: "1", stuff: "1", service: "1", online: "1", following: "1" });
    expect(p).toMatchObject({ scope: "mine", view: "month", when: "weekend", q: "robots", type: "SOCIAL", category: "ACADEMIC", food: true, stuff: true, service: true, online: true, following: true });
    const href = eventsHref(p);
    expect(href).toBe("/events?scope=mine&view=month&when=weekend&q=robots&type=SOCIAL&category=ACADEMIC&food=1&stuff=1&service=1&online=1&following=1");
    expect(parseEventParams(new URLSearchParams(href.split("?")[1]))).toEqual(p);
  });

  it("a date replaces the shortcut, and a shortcut replaces the date", () => {
    const p = parseEventParams({ when: "today" });
    expect(eventsHref(p, { date: "2026-10-24" })).toBe("/events?date=2026-10-24");
    expect(eventsHref(parseEventParams({ date: "2026-10-24" }), { when: "tomorrow" })).toBe("/events?when=tomorrow");
    // Both in the URL: the date wins.
    expect(parseEventParams({ when: "today", date: "2026-10-24" })).toMatchObject({ when: null, date: "2026-10-24" });
  });

  it("any change starts the list over; Show more keeps going", () => {
    const p = parseEventParams({ show: "60", food: "1" });
    expect(p.show).toBe(60);
    expect(eventsHref(p, { show: 90 })).toBe("/events?food=1&show=90");
    expect(eventsHref(p, { service: true })).toBe("/events?food=1&service=1");
    expect(parseEventParams({ show: "45" }).show).toBe(60); // whole steps
    expect(parseEventParams({ show: "99999" }).show).toBe(600);
  });

  it("Clear all keeps the scope and view", () => {
    const p = parseEventParams({ scope: "all", view: "month", q: "pizza", food: "1", type: "SOCIAL", when: "today" });
    expect(hasFilters(p)).toBe(true);
    expect(eventsHref(p, CLEARED)).toBe("/events?scope=all&view=month");
    expect(hasFilters(parseEventParams({ scope: "all" }))).toBe(false);
  });

  it("ignores junk", () => {
    expect(parseEventParams({ scope: "everyone", view: "grid", when: "someday", type: "PARTY", category: "SPORTS", food: "yes", date: "2026-02-31", q: "x".repeat(200) })).toMatchObject({
      scope: null,
      view: "list",
      when: null,
      type: null,
      category: null,
      food: false,
      date: null,
    });
    expect(parseEventParams({ q: "x".repeat(200) }).q).toHaveLength(100);
    expect(validDate("2026-10-24")).toBe("2026-10-24");
    expect(validDate("2026-13-01")).toBeNull();
    expect(validDate("24/10/2026")).toBeNull();
  });

  it("the month view's feed gets the filters without dates or paging", () => {
    const p = parseEventParams({ when: "today", show: "60", food: "1", type: "SERVICE", q: "cans" });
    expect(filterSearchParams(p).toString()).toBe("q=cans&type=SERVICE&food=1");
  });
});

describe("Mine or All of Weber State", () => {
  it("defaults to Mine when signed in and following clubs, otherwise All", () => {
    expect(resolveScope({ scope: null }, { signedIn: true, followsClubs: true })).toBe("mine");
    expect(resolveScope({ scope: null }, { signedIn: true, followsClubs: false })).toBe("all");
    expect(resolveScope({ scope: null }, { signedIn: false, followsClubs: false })).toBe("all");
  });
  it("the URL's choice wins, except Mine signed out", () => {
    expect(resolveScope({ scope: "all" }, { signedIn: true, followsClubs: true })).toBe("all");
    expect(resolveScope({ scope: "mine" }, { signedIn: true, followsClubs: false })).toBe("mine");
    expect(resolveScope({ scope: "mine" }, { signedIn: false, followsClubs: false })).toBe("all");
  });
});

describe("date shortcuts (campus time)", () => {
  const tue = campus(2026, 10, 20, 9, 30); // Tuesday morning in Ogden

  it("Today and Tomorrow are campus days, midnight to midnight", () => {
    expect(shortcutRange("today", tue)).toEqual({ start: campus(2026, 10, 20), end: campus(2026, 10, 21) });
    expect(shortcutRange("tomorrow", tue)).toEqual({ start: campus(2026, 10, 21), end: campus(2026, 10, 22) });
    // 11:30 PM in Ogden is already the next day in UTC; it's still "today" on campus.
    const late = campus(2026, 10, 20, 23, 30);
    expect(late.getUTCDate()).toBe(21);
    expect(shortcutRange("today", late)).toEqual({ start: campus(2026, 10, 20), end: campus(2026, 10, 21) });
  });

  it("Next 7 days is today and the six days after", () => {
    expect(shortcutRange("week", tue)).toEqual({ start: campus(2026, 10, 20), end: campus(2026, 10, 27) });
  });

  it("This weekend runs Friday 5 PM through Sunday: the coming one on weekdays, the one under way on Friday to Sunday", () => {
    const weekend = { start: campus(2026, 10, 23, 17, 0), end: campus(2026, 10, 26) };
    for (const day of [19, 20, 21, 22, 23, 24, 25]) expect(shortcutRange("weekend", campus(2026, 10, day, 12, 0))).toEqual(weekend);
    // The Monday after starts the next one.
    expect(shortcutRange("weekend", campus(2026, 10, 26, 8, 0))).toEqual({ start: campus(2026, 10, 30, 17, 0), end: campus(2026, 11, 2) });
  });

  it("keeps to campus wall clock across the daylight-saving change", () => {
    // DST ends Sunday Nov 1, 2026: that Sunday is 25 hours long.
    const r = shortcutRange("weekend", campus(2026, 10, 28, 12, 0));
    expect(r).toEqual({ start: campus(2026, 10, 30, 17, 0), end: campus(2026, 11, 2) });
    expect(iso(r.start)).toBe("2026-10-30T23:00:00.000Z"); // 5 PM MDT
    expect(iso(r.end)).toBe("2026-11-02T07:00:00.000Z"); // midnight MST
    const sunday = shortcutRange("today", campus(2026, 11, 1, 12, 0));
    expect(sunday.end.getTime() - sunday.start.getTime()).toBe(25 * 3_600_000);
  });

  it("a picked date is that campus day; no date means everything coming up", () => {
    expect(dateRange({ when: null, date: "2026-10-24" }, tue)).toEqual({ start: campus(2026, 10, 24), end: campus(2026, 10, 25) });
    expect(dateRange({ when: null, date: null }, tue)).toBeNull();
  });

  it("the list drops what already ended, unless the whole day is in the past", () => {
    const today = shortcutRange("today", tue);
    expect(listWindow(today, tue)).toEqual({ start: tue, end: today.end });
    const past = { start: campus(2026, 10, 1), end: campus(2026, 10, 2) };
    expect(listWindow(past, tue)).toEqual(past);
    const ahead = shortcutRange("tomorrow", tue);
    expect(listWindow(ahead, tue)).toEqual(ahead);
    const upcoming = listWindow(null, tue);
    expect(upcoming.start).toEqual(tue);
    expect(upcoming.end.getTime()).toBeGreaterThan(tue.getTime() + 300 * 86_400_000);
  });

  it("labels the range and the day headings", () => {
    expect(rangeLabel({ when: "weekend", date: null }, tue)).toBe("This weekend · Fri, Oct 23 – Sun, Oct 25");
    expect(rangeLabel({ when: "today", date: null }, tue)).toBe("Today · Tue, Oct 20");
    expect(rangeLabel({ when: null, date: "2027-01-08" }, tue)).toBe("Fri, Jan 8, 2027");
    expect(rangeLabel({ when: null, date: null }, tue)).toBeNull();
    expect(dayHeading("2026-10-20", tue)).toBe("Today");
    expect(dayHeading("2026-10-21", tue)).toBe("Tomorrow");
    expect(dayHeading("2026-10-23", tue)).toBe("Friday, Oct 23");
  });
});

describe("the filters as one event filter", () => {
  const none = { type: null, category: null, food: false, stuff: false, service: false, online: false, following: false } as const;
  const viewer = { followedClubIds: ["c1", "c2"] };

  it("no filters, no conditions", () => {
    expect(eventFilterWhere(none, viewer)).toEqual({});
  });

  it("perks: either one when both are picked", () => {
    expect(eventFilterWhere({ ...none, food: true }, viewer)).toEqual({ AND: [{ perks: { hasSome: ["FREE_FOOD"] } }] });
    expect(eventFilterWhere({ ...none, food: true, stuff: true }, viewer)).toEqual({ AND: [{ perks: { hasSome: ["FREE_FOOD", "FREE_STUFF"] } }] });
  });

  it("type, the host club's category, service hours, online or hybrid, clubs I follow, and the search's matches", () => {
    expect(eventFilterWhere({ ...none, type: "SOCIAL", category: "CULTURAL", service: true, online: true, following: true }, viewer, ["e1"])).toEqual({
      AND: [
        { kind: "SOCIAL" },
        { club: { category: "CULTURAL" } },
        { serviceMinutes: { gt: 0 } },
        { OR: [{ locationType: "VIRTUAL" }, { locationType: { in: ["CAMPUS", "ADDRESS"] }, virtualUrl: { not: null } }] },
        { OR: [{ clubId: { in: ["c1", "c2"] } }, { cohosts: { some: { status: "APPROVED", clubId: { in: ["c1", "c2"] } } } }] },
        { id: { in: ["e1"] } },
      ],
    });
  });
});
