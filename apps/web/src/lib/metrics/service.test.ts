import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import type { TermLike } from "./pure";
import {
  earnedMinutes,
  fmtServiceHours,
  serviceEventsLabel,
  serviceHours,
  serviceHoursLabel,
  serviceLine,
  serviceTermOf,
  summarizeService,
  totalsByTerm,
  type ServiceCheckin,
} from "./service";

// A Weber State-shaped calendar, stored as campus midnight like the seed (unsorted on purpose).
const term = (name: string, start: [number, number, number], end: [number, number, number]): TermLike => ({
  name,
  academicYear: name.endsWith("2025") ? "2025-2026" : "2026-2027",
  startsOn: campusDate(...start),
  endsOn: campusDate(...end),
  countsForActivity: true,
});
const FALL_25 = term("Fall 2025", [2025, 8, 25], [2025, 12, 13]);
const SPRING_26 = term("Spring 2026", [2026, 1, 7], [2026, 5, 1]);
const FALL_26 = term("Fall 2026", [2026, 8, 24], [2026, 12, 12]);
const TERMS = [FALL_26, FALL_25, SPRING_26];

const SERVICE_CLUB = { id: "svc", name: "Wildcat Service Club", slug: "wildcat-service-club" };
const PREMED = { id: "pre", name: "Pre-Med Club", slug: "pre-med-club" };

let n = 0;
const checkin = (p: Partial<ServiceCheckin> & Pick<ServiceCheckin, "startsAt">): ServiceCheckin => {
  n++;
  return { attendanceId: `a${n}`, occurrenceId: `o${n}`, eventId: `e${n}`, title: `Event ${n}`, serviceMinutes: 120, club: SERVICE_CLUB, cohosts: [], ...p };
};

describe("the hours rule", () => {
  it("earns the event's minutes, and nothing at events that don't count", () => {
    expect(earnedMinutes(120)).toBe(120);
    expect(earnedMinutes(90)).toBe(90);
    expect(earnedMinutes(null)).toBe(0);
    expect(earnedMinutes(undefined)).toBe(0);
    expect(earnedMinutes(0)).toBe(0);
    expect(earnedMinutes(-30)).toBe(0);
    expect(earnedMinutes(Number.NaN)).toBe(0);
  });

  it("totals come from the check-ins every time: remove one and its hours go", () => {
    const a = checkin({ startsAt: campusDate(2026, 9, 12, 9) });
    const b = checkin({ startsAt: campusDate(2026, 10, 3, 9), serviceMinutes: 180 });
    const meeting = checkin({ startsAt: campusDate(2026, 10, 5, 18), serviceMinutes: null });
    expect(summarizeService([a, b, meeting], TERMS)).toMatchObject({ minutes: 300, events: 2 });
    // The leader removed check-in b.
    expect(summarizeService([a, meeting], TERMS)).toMatchObject({ minutes: 120, events: 1 });
  });

  it("follows the event's hours as they are now: an edit changes every attendee's total", () => {
    const dates = [campusDate(2026, 9, 5, 9), campusDate(2026, 9, 12, 9)];
    const before = dates.map((startsAt) => checkin({ startsAt, eventId: "tutoring", serviceMinutes: 60 }));
    const after = before.map((c) => ({ ...c, serviceMinutes: 90 }));
    expect(summarizeService(before, TERMS).minutes).toBe(120);
    expect(summarizeService(after, TERMS).minutes).toBe(180);
    // Turning service hours off for the event takes them all away.
    expect(summarizeService(before.map((c) => ({ ...c, serviceMinutes: null })), TERMS)).toMatchObject({ minutes: 0, events: 0, entries: [] });
  });

  it("counts every check-in, whichever way it was recorded, once per date", () => {
    // Two dates of one repeating event are two service events.
    const s = summarizeService([checkin({ startsAt: campusDate(2026, 9, 5, 9), eventId: "e" }), checkin({ startsAt: campusDate(2026, 9, 12, 9), eventId: "e" })], TERMS);
    expect(s.events).toBe(2);
    expect(s.entries.map((x) => x.eventId)).toEqual(["e", "e"]);
  });
});

describe("summaries", () => {
  const rows = [
    checkin({ startsAt: campusDate(2025, 10, 4, 9), serviceMinutes: 180, title: "Trail Day" }),
    checkin({ startsAt: campusDate(2026, 2, 14, 10), serviceMinutes: 90, club: PREMED, title: "Blood Drive" }),
    checkin({ startsAt: campusDate(2026, 10, 3, 9), serviceMinutes: 120, title: "Food Drive" }),
    checkin({ startsAt: campusDate(2026, 9, 26, 9), serviceMinutes: 180, club: null, title: "WSUSA Day of Service" }),
    checkin({ startsAt: campusDate(2026, 10, 5, 18), serviceMinutes: null, title: "Project Planning Night" }),
  ];
  const s = summarizeService(rows, TERMS);

  it("lists the dates newest first, each with its event, club, term and hours", () => {
    expect(s.entries.map((e) => e.title)).toEqual(["Food Drive", "WSUSA Day of Service", "Blood Drive", "Trail Day"]);
    expect(s.entries[0]).toMatchObject({ minutes: 120, term: "Fall 2026", club: SERVICE_CLUB });
    expect(s.entries[1]).toMatchObject({ club: null, term: "Fall 2026" });
  });

  const sum = (xs: { minutes: number; events: number }[]) => xs.reduce((a, x) => ({ minutes: a.minutes + x.minutes, events: a.events + x.events }), { minutes: 0, events: 0 });

  it("adds up by club (university events as their own line) and by term, newest term first", () => {
    expect(s).toMatchObject({ minutes: 570, events: 4 });
    expect(s.byClub).toEqual([
      { club: SERVICE_CLUB, minutes: 300, events: 2 },
      { club: null, minutes: 180, events: 1 },
      { club: PREMED, minutes: 90, events: 1 },
    ]);
    expect(s.byTerm).toEqual([
      { term: "Fall 2026", minutes: 300, events: 2 },
      { term: "Spring 2026", minutes: 90, events: 1 },
      { term: "Fall 2025", minutes: 180, events: 1 },
    ]);
    expect(sum(s.byClub)).toEqual({ minutes: s.minutes, events: s.events });
    expect(sum(s.byTerm)).toEqual({ minutes: s.minutes, events: s.events });
  });

  it("counts a co-hosted event for every club that put it on, but once in the total", () => {
    const robotDay = checkin({ startsAt: campusDate(2026, 11, 7, 10), serviceMinutes: 90, club: PREMED, cohosts: [SERVICE_CLUB] });
    const c = summarizeService([robotDay, checkin({ startsAt: campusDate(2026, 11, 14, 9), serviceMinutes: 60 })], TERMS);
    expect(c).toMatchObject({ minutes: 150, events: 2 });
    expect(c.byClub).toEqual([
      { club: SERVICE_CLUB, minutes: 150, events: 2 },
      { club: PREMED, minutes: 90, events: 1 },
    ]);
    expect(sum(c.byTerm)).toEqual({ minutes: 150, events: 2 });
  });

  it("is empty with no check-ins", () => {
    expect(summarizeService([], TERMS)).toEqual({ minutes: 0, events: 0, byClub: [], byTerm: [], entries: [] });
  });
});

describe("terms", () => {
  it("puts a date in the term it falls in, finals day included", () => {
    expect(serviceTermOf(campusDate(2026, 10, 3, 9), TERMS)?.name).toBe("Fall 2026");
    expect(serviceTermOf(campusDate(2026, 12, 12, 21), TERMS)?.name).toBe("Fall 2026");
    expect(serviceTermOf(campusDate(2026, 8, 24, 0), TERMS)?.name).toBe("Fall 2026");
  });

  it("counts dates between terms toward the term just finished, and has none before the calendar", () => {
    expect(serviceTermOf(campusDate(2025, 12, 20, 10), TERMS)?.name).toBe("Fall 2025");
    expect(serviceTermOf(campusDate(2026, 6, 15, 10), TERMS)?.name).toBe("Spring 2026");
    expect(serviceTermOf(campusDate(2024, 6, 1), TERMS)).toBeNull();
  });

  it("adds per-term totals for analytics the same way, leaving out what earned nothing", () => {
    const totals = totalsByTerm(
      [
        { startsAt: campusDate(2026, 9, 1, 9), minutes: 600, events: 5 },
        { startsAt: campusDate(2026, 3, 1, 9), minutes: 120, events: 1 },
        { startsAt: campusDate(2026, 3, 8, 9), minutes: 0, events: 0 },
        { startsAt: campusDate(2020, 1, 1, 9), minutes: 60, events: 1 },
      ],
      TERMS,
    );
    expect(totals).toEqual([
      { term: "Fall 2026", minutes: 600, events: 5 },
      { term: "Spring 2026", minutes: 120, events: 1 },
      { term: null, minutes: 60, events: 1 },
    ]);
  });
});

describe("how hours read", () => {
  it("turns minutes into hours, exact to the quarter hour", () => {
    expect(serviceHours(90)).toBe(1.5);
    expect(serviceHours(45)).toBe(0.75);
    expect(serviceHours(2550)).toBe(42.5);
    expect(fmtServiceHours(120)).toBe("2");
    expect(fmtServiceHours(75)).toBe("1.25");
    expect(fmtServiceHours(74_415)).toBe("1,240.25");
  });

  it("says hours and events in words", () => {
    expect(serviceHoursLabel(60)).toBe("1 service hour");
    expect(serviceHoursLabel(120)).toBe("2 service hours");
    expect(serviceHoursLabel(90)).toBe("1.5 service hours");
    expect(serviceHoursLabel(0)).toBe("0 service hours");
    expect(serviceEventsLabel(1)).toBe("1 service event");
    expect(serviceLine({ minutes: 2550, events: 12 })).toBe("42.5 service hours · 12 service events");
  });
});
