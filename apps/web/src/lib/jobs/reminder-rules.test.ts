import { describe, expect, it } from "vitest";
import {
  dueSoonNotice,
  dueStage,
  dueWhen,
  isStartingSoon,
  PRUNED_KEY_PREFIXES,
  pruneBefore,
  reminderKeys,
  reviewUnlockedNotice,
  startingSoonNotice,
  startingSoonWindow,
} from "@/lib/jobs/reminder-rules";
import { campusDate } from "@/lib/time";

const NOW = campusDate(2026, 10, 20, 15, 0); // Tue, Oct 20 at 3 PM on campus
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("events starting soon", () => {
  it("picks dates starting 45 to 75 minutes from now", () => {
    expect(startingSoonWindow(NOW)).toEqual({ from: at(45 * MIN), to: at(75 * MIN) });
    expect(isStartingSoon(at(44 * MIN), NOW)).toBe(false);
    expect(isStartingSoon(at(45 * MIN), NOW)).toBe(true);
    expect(isStartingSoon(at(75 * MIN), NOW)).toBe(true);
    expect(isStartingSoon(at(76 * MIN), NOW)).toBe(false);
  });

  it("catches every date in at least one run, every 15 minutes", () => {
    const start = at(3 * HOUR + 7 * MIN);
    const runs = Array.from({ length: 20 }, (_, i) => at(i * 15 * MIN)).filter((run) => isStartingSoon(start, run));
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.length).toBeLessThanOrEqual(3);
  });

  it("says when and where", () => {
    const startsAt = campusDate(2026, 10, 20, 18, 0);
    expect(startingSoonNotice({ title: "Build Night", startsAt, place: "NB 220", host: "RC Wrecker Bots Club" })).toEqual({
      title: "Starting soon: Build Night",
      body: "Starts at 6:00 PM · NB 220 · RC Wrecker Bots Club",
    });
    expect(startingSoonNotice({ title: "Club Officer Training", startsAt, place: null, host: null, required: true }).body).toBe("Starts at 6:00 PM · Required by WSUSA");
  });
});

describe("requirements due", () => {
  const due = at(7 * DAY);

  it("reminds a week ahead and a day ahead", () => {
    const createdAt = at(-20 * DAY);
    expect(dueStage({ dueAt: due, createdAt }, NOW)).toBe("7d");
    expect(dueStage({ dueAt: due, createdAt }, at(3 * DAY))).toBe("7d");
    expect(dueStage({ dueAt: due, createdAt }, at(6 * DAY + HOUR))).toBe("1d");
    expect(dueStage({ dueAt: due, createdAt }, at(-HOUR))).toBeNull(); // more than a week out
    expect(dueStage({ dueAt: due, createdAt }, at(7 * DAY + MIN))).toBeNull(); // overdue: the overdue notice covers it
  });

  it("skips a reminder whose mark came before the task existed", () => {
    // Assigned three days before the deadline: no week-ahead reminder, but the day-ahead one comes.
    const createdAt = at(4 * DAY);
    expect(dueStage({ dueAt: due, createdAt }, at(4 * DAY + HOUR))).toBeNull();
    expect(dueStage({ dueAt: due, createdAt }, at(6 * DAY + 2 * HOUR))).toBe("1d");
    // Assigned the day before: just the assignment notice.
    expect(dueStage({ dueAt: due, createdAt: at(6 * DAY + 3 * HOUR) }, at(6 * DAY + 4 * HOUR))).toBeNull();
  });

  it("counts campus days", () => {
    expect(dueWhen(campusDate(2026, 10, 20, 23, 0), NOW)).toBe("today");
    expect(dueWhen(campusDate(2026, 10, 21, 9, 0), NOW)).toBe("tomorrow");
    expect(dueWhen(campusDate(2026, 10, 27, 15, 0), NOW)).toBe("in 7 days");
  });

  it("says what to do by when, and what happens to a leader's permissions", () => {
    const dueAt = campusDate(2026, 10, 27, 15, 0);
    expect(dueSoonNotice({ title: "Pass: Club Officer Policy Test", dueAt, gatesClub: "Wildcat Investors" }, NOW)).toEqual({
      title: "Club Officer Policy Test is due in 7 days",
      body: "Pass it by Tue, Oct 27 at 3:00 PM to keep your permissions in Wildcat Investors.",
    });
    expect(dueSoonNotice({ title: "Attend: Club Officer Training", dueAt: campusDate(2026, 10, 21, 17, 30), gatesClub: null }, NOW)).toEqual({
      title: "Club Officer Training is due tomorrow",
      body: "Attend a session by Wed, Oct 21 at 5:30 PM. WSUSA requires it.",
    });
    expect(dueSoonNotice({ title: "Club Member Agreements", dueAt, gatesClub: null }, NOW).body).toBe("Finish it by Tue, Oct 27 at 3:00 PM. WSUSA requires it.");
  });
});

describe("review unlocked", () => {
  it("says now, or from when the event starts", () => {
    expect(reviewUnlockedNotice({ clubName: "Pre-Med Club", attended: 3, opensAt: null })).toEqual({
      title: "You can review Pre-Med Club now",
      body: "You've been to 3 of its events. Tell other students what it's like.",
    });
    expect(reviewUnlockedNotice({ clubName: "Pre-Med Club", attended: 3, opensAt: campusDate(2026, 10, 20, 18, 0) }).title).toBe("You can review Pre-Med Club from 6:00 PM");
  });
});

describe("keys", () => {
  it("names each reminder so it's sent once, and again only when its time moves", () => {
    const s = campusDate(2026, 10, 20, 18, 0);
    expect(reminderKeys.startingSoon("occ1", s)).toBe(`event:occ1:${s.getTime()}`);
    expect(reminderKeys.startingSoon("occ1", s)).not.toBe(reminderKeys.startingSoon("occ1", new Date(s.getTime() + HOUR)));
    expect(reminderKeys.due("t1", "7d", s)).not.toBe(reminderKeys.due("t1", "1d", s));
    expect(reminderKeys.reviewUnlocked("u1", "c1")).toBe("review:u1:c1");
  });

  it("prunes only the job's own keys, after 30 days", () => {
    expect(pruneBefore(NOW)).toEqual(at(-30 * DAY));
    expect(PRUNED_KEY_PREFIXES.some((p) => reminderKeys.startingSoon("o", NOW).startsWith(p))).toBe(true);
    expect(PRUNED_KEY_PREFIXES.some((p) => reminderKeys.due("t", "1d", NOW).startsWith(p))).toBe(true);
    expect(PRUNED_KEY_PREFIXES.some((p) => reminderKeys.reviewUnlocked("u", "c").startsWith(p))).toBe(false);
    expect(PRUNED_KEY_PREFIXES.some((p) => "job:requirements:full:2026-10-20".startsWith(p))).toBe(false);
  });
});
