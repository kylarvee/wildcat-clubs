import { describe, expect, it } from "vitest";
import {
  cancelledNotice,
  editNotice,
  eventAudience,
  inNoticeWindow,
  placeOf,
  repeatPhrase,
  restoredNotice,
  roomNotice,
  samePlace,
  seriesName,
  type NoticeDate,
  type Place,
  type RepeatRule,
  type Snapshot,
} from "@/lib/events/notices";
import { campusDate } from "@/lib/time";

// Sunday, Oct 18, 2026 at noon on campus. Oct 20 is a Tuesday, Oct 22 a Thursday.
const NOW = campusDate(2026, 10, 18, 12, 0);
const NB150: Place = { kind: "CAMPUS", text: "NB 150 (Makerspace)", link: null };
const NB220: Place = { kind: "CAMPUS", text: "NB 220", link: null };
const HOST = { title: "Build Night", host: "RC Wrecker Bots Club" };
const WEEKLY_TUE: RepeatRule = { recurrence: "WEEKLY", interval: 1, weekdays: [2] };
const WEEKLY_THU: RepeatRule = { recurrence: "WEEKLY", interval: 1, weekdays: [4] };

let n = 0;
function date(m: number, d: number, H: number, opts: { M?: number; minutes?: number; place?: Place; id?: string } = {}): NoticeDate {
  const startsAt = campusDate(2026, m, d, H, opts.M ?? 0);
  return { id: opts.id ?? `o${++n}`, startsAt, endsAt: new Date(startsAt.getTime() + (opts.minutes ?? 120) * 60_000), place: opts.place ?? NB150 };
}
const snap = (dates: NoticeDate[], repeat: RepeatRule | null, place: Place = NB150): Snapshot => ({ dates, repeat, place });
const tuesdays = (place: Place = NB150) => [date(10, 20, 18, { place }), date(10, 27, 18, { place }), date(11, 3, 18, { place }), date(11, 10, 18, { place })];

describe("the 14-day window", () => {
  it("covers now through 14 days out, never the past", () => {
    expect(inNoticeWindow(NOW, NOW)).toBe(true);
    expect(inNoticeWindow(new Date(NOW.getTime() + 14 * 86_400_000), NOW)).toBe(true);
    expect(inNoticeWindow(new Date(NOW.getTime() + 14 * 86_400_000 + 60_000), NOW)).toBe(false);
    expect(inNoticeWindow(new Date(NOW.getTime() - 60_000), NOW)).toBe(false);
  });
});

describe("series summary text", () => {
  it("reads a repeat rule as people say it", () => {
    const at = campusDate(2026, 10, 22, 18, 0);
    expect(repeatPhrase(WEEKLY_THU, at)).toBe("Thursdays at 6 PM");
    expect(repeatPhrase({ recurrence: "WEEKLY", interval: 1, weekdays: [4, 2] }, campusDate(2026, 10, 20, 18, 30))).toBe("Tuesdays and Thursdays at 6:30 PM");
    expect(repeatPhrase({ recurrence: "WEEKLY", interval: 2, weekdays: [1] }, campusDate(2026, 10, 19, 19, 0))).toBe("every other Monday at 7 PM");
    expect(repeatPhrase({ recurrence: "WEEKLY", interval: 3, weekdays: [] }, at)).toBe("every 3 weeks on Thursdays at 6 PM");
    expect(repeatPhrase({ recurrence: "DAILY", interval: 1, weekdays: [] }, campusDate(2026, 10, 22, 7, 0))).toBe("every day at 7 AM");
    expect(repeatPhrase({ recurrence: "MONTHLY", interval: 1, weekdays: [] }, at)).toBe("the 22nd of each month at 6 PM");
  });

  it("names a whole series once, without doubling a word the title already has", () => {
    expect(seriesName("Build Night", WEEKLY_TUE)).toBe("Weekly Build Night");
    expect(seriesName("Weekly Standup", WEEKLY_TUE)).toBe("Weekly Standup");
    expect(seriesName("Build Night", { recurrence: "WEEKLY", interval: 2, weekdays: [2] })).toBe("Build Night");
    expect(seriesName("Officer Training", { recurrence: "SEMESTERLY", interval: 1, weekdays: [] })).toBe("Officer Training");
    expect(seriesName("Build Night", null)).toBe("Build Night");
  });

  it("sends one summary when a whole weekly series moves, not a notice per date", () => {
    const before = snap(tuesdays(), WEEKLY_TUE);
    const thursdays = [date(10, 22, 18, { id: "thu1" }), date(10, 29, 18), date(11, 5, 18), date(11, 12, 18)];
    const notice = editNotice(HOST, before, snap(thursdays, WEEKLY_THU), NOW);
    expect(notice).toEqual({
      kind: "event.changed",
      title: "Weekly Build Night moves to Thursdays at 6 PM, starting Oct 22",
      body: "RC Wrecker Bots Club: it was Tuesdays at 6 PM.",
      email: false,
      occurrenceId: "thu1",
    });
  });

  it("says where, too, when the series moves rooms as well", () => {
    const thursdays = [date(10, 22, 18, { place: NB220 }), date(10, 29, 18, { place: NB220 })];
    const notice = editNotice(HOST, snap(tuesdays(), WEEKLY_TUE), snap(thursdays, WEEKLY_THU, NB220), NOW);
    expect(notice?.title).toBe("Weekly Build Night moves to Thursdays at 6 PM in NB 220, starting Oct 22");
    expect(notice?.body).toBe("RC Wrecker Bots Club: it was Tuesdays at 6 PM in NB 150 (Makerspace).");
  });

  it("moves a one-time event to its new date", () => {
    const robot = { title: "Girls in STEM Robot Day", host: "RC Wrecker Bots Club" };
    const notice = editNotice(robot, snap([date(10, 31, 10)], null), snap([date(11, 7, 10, { M: 30, id: "nov7" })], null), NOW);
    expect(notice?.title).toBe("Girls in STEM Robot Day moves to Sat, Nov 7 at 10:30 AM");
    expect(notice?.body).toBe("RC Wrecker Bots Club: it was Sat, Oct 31 at 10 AM.");
    expect(notice?.occurrenceId).toBe("nov7");
  });

  it("tells people about a move into the next 14 days, or out of it, but not one entirely beyond it", () => {
    const later = date(12, 1, 18);
    expect(editNotice(HOST, snap([later], null), snap([date(10, 22, 18)], null), NOW)?.kind).toBe("event.changed");
    expect(editNotice(HOST, snap([date(10, 22, 18)], null), snap([later], null), NOW)?.title).toBe("Build Night moves to Tue, Dec 1 at 6 PM");
    expect(editNotice(HOST, snap([later], null), snap([date(12, 8, 18)], null), NOW)).toBeNull();
  });

  it("reports a new room from the first date it applies to (dates with their own room keep it)", () => {
    const before = tuesdays();
    const NB101: Place = { kind: "CAMPUS", text: "NB 101", link: null };
    before[0].place = NB101; // Oct 20 already had its own room
    const after = tuesdays(NB220);
    after[0].place = NB101;
    const notice = editNotice(HOST, snap(before, WEEKLY_TUE), snap(after, WEEKLY_TUE, NB220), NOW);
    expect(notice?.title).toBe("Weekly Build Night moves to NB 220, starting Oct 27");
    expect(notice?.body).toBe("RC Wrecker Bots Club: same time; it was in NB 150 (Makerspace).");
  });

  it("covers going online, a new meeting link and a new end time", () => {
    const online: Place = { kind: "VIRTUAL", text: "Online", link: "https://meet.google.com/abc" };
    expect(editNotice(HOST, snap([date(10, 22, 18)], null), snap([date(10, 22, 18, { place: online })], null, online), NOW)?.title).toBe("Build Night on Thu, Oct 22 moves online");
    const relinked = { ...online, link: "https://meet.google.com/xyz" };
    const link = editNotice(HOST, snap([date(10, 22, 18, { place: online })], null, online), snap([date(10, 22, 18, { place: relinked })], null, relinked), NOW);
    expect(link?.title).toBe("Build Night on Thu, Oct 22 has a new meeting link");
    const ends = editNotice(HOST, snap(tuesdays(), WEEKLY_TUE), snap(tuesdays().map((d) => ({ ...d, endsAt: new Date(d.endsAt.getTime() + 3_600_000) })), WEEKLY_TUE), NOW);
    expect(ends?.title).toBe("Weekly Build Night now ends at 9 PM, starting Oct 20");
    expect(ends?.body).toBe("RC Wrecker Bots Club: same start; it used to end at 8 PM.");
  });

  it("treats dates an edit dropped as cancelled, and ignores dates it only added", () => {
    const all = tuesdays();
    const dropped = editNotice(HOST, snap(all, WEEKLY_TUE), snap(all.slice(1), WEEKLY_TUE), NOW);
    expect(dropped?.kind).toBe("event.cancelled");
    expect(dropped?.title).toBe("Build Night on Tue, Oct 20 is cancelled");
    expect(dropped?.body).toBe("RC Wrecker Bots Club cancelled this date. The rest of the schedule stays the same.");
    expect(editNotice(HOST, snap(all.slice(1), WEEKLY_TUE), snap(all, WEEKLY_TUE), NOW)).toBeNull();
    expect(editNotice(HOST, snap(all, WEEKLY_TUE), snap(all, WEEKLY_TUE), NOW)).toBeNull();
  });
});

describe("cancellations", () => {
  it("emails only a cancelled date in the next 48 hours", () => {
    // 30 hours away, then 54.
    const soon = cancelledNotice(HOST, { dates: [date(10, 19, 18)], repeat: WEEKLY_TUE, whole: false, remaining: 3, now: NOW });
    expect(soon).toMatchObject({ kind: "event.cancelled", title: "Build Night on Mon, Oct 19 is cancelled", email: true });
    const later = cancelledNotice(HOST, { dates: [date(10, 20, 18)], repeat: WEEKLY_TUE, whole: false, remaining: 3, now: NOW });
    expect(later?.email).toBe(false);
  });

  it("sums up a whole series, with the reason", () => {
    const notice = cancelledNotice(HOST, { dates: tuesdays(), repeat: WEEKLY_TUE, whole: true, note: "The Makerspace is closed for repairs", now: NOW });
    expect(notice?.title).toBe("Weekly Build Night is cancelled from Oct 20 on");
    expect(notice?.body).toBe("RC Wrecker Bots Club cancelled every upcoming date: The Makerspace is closed for repairs.");
  });

  it("says a one-time event is cancelled, or deleted", () => {
    const fair = { title: "Club Fair", host: "WSUSA" };
    expect(cancelledNotice(fair, { dates: [date(10, 22, 11)], repeat: null, whole: true, now: NOW })?.body).toBe("WSUSA cancelled it.");
    expect(cancelledNotice(fair, { dates: [date(10, 22, 11)], repeat: null, whole: false, remaining: 0, now: NOW })?.body).toBe("WSUSA cancelled it.");
    expect(cancelledNotice(fair, { dates: [date(10, 22, 11)], repeat: null, whole: true, deleted: true, now: NOW })?.body).toBe("WSUSA took it off the calendar.");
  });

  it("stays quiet about dates more than 14 days out", () => {
    expect(cancelledNotice(HOST, { dates: [date(11, 10, 18)], repeat: WEEKLY_TUE, whole: false, remaining: 3, now: NOW })).toBeNull();
  });

  it("brings dates back on", () => {
    expect(restoredNotice(HOST, { dates: tuesdays(), repeat: WEEKLY_TUE, whole: true, now: NOW })?.title).toBe("Weekly Build Night is back on, starting Oct 20");
    expect(restoredNotice(HOST, { dates: [date(10, 20, 18)], repeat: WEEKLY_TUE, whole: false, now: NOW })).toMatchObject({ kind: "event.changed", title: "Build Night on Tue, Oct 20 is back on", email: false });
  });
});

describe("one date's room", () => {
  it("says where it moves, and when it's back in the usual room", () => {
    const moved = roomNotice(HOST, { date: date(10, 20, 18, { place: NB220 }), before: NB150, usual: NB150, now: NOW });
    expect(moved?.title).toBe("Build Night on Tue, Oct 20 moves to NB 220");
    expect(moved?.body).toBe("RC Wrecker Bots Club: same time, 6 PM; it was in NB 150 (Makerspace).");
    expect(roomNotice(HOST, { date: date(10, 20, 18), before: NB220, usual: NB150, now: NOW })?.title).toBe("Build Night on Tue, Oct 20 is back in NB 150 (Makerspace)");
    expect(roomNotice(HOST, { date: date(10, 20, 18), before: NB150, usual: NB150, now: NOW })).toBeNull();
  });
});

describe("places", () => {
  it("uses the date's own room and compares what people would notice", () => {
    const e = { locationType: "CAMPUS" as const, building: { name: "Noorda Engineering", code: "NB" }, room: "Room 150 (Makerspace)" };
    expect(placeOf(e).text).toBe("NB 150 (Makerspace)");
    expect(placeOf(e, "220").text).toBe("NB 220");
    const meet = (link: string | null) => placeOf({ locationType: "VIRTUAL", virtualUrl: link });
    expect(samePlace(meet(null), meet("https://meet.google.com/abc"))).toBe(true);
    expect(samePlace(meet("https://meet.google.com/abc"), meet("https://meet.google.com/xyz"))).toBe(false);
    expect(samePlace(placeOf(e), meet("https://meet.google.com/abc"))).toBe(false);
  });
});

describe("recipients", () => {
  it("is everyone following, once, minus whoever's excluded", () => {
    expect(eventAudience({ visibility: "PUBLIC", followerIds: ["maya", "sam", "maya", "priya"], excludeIds: ["priya"] })).toEqual(["maya", "sam"]);
  });

  it("keeps a members-only event to members and leaders", () => {
    expect(eventAudience({ visibility: "MEMBERS", followerIds: ["maya", "follower", "vanessa"], memberIds: ["vanessa", "maya", "leader"] })).toEqual(["maya", "vanessa"]);
    expect(eventAudience({ visibility: "UNIVERSITY", followerIds: ["maya", "follower"], memberIds: [] })).toEqual(["maya", "follower"]);
  });
});
