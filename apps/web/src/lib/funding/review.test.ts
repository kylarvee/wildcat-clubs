import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import { businessDaysSince, fundingTasks, pastReviewTime, reviewCutoff } from "@/lib/funding/review";

// October 2026: the 5th is a Monday.
const at = (day: number, hour = 12) => campusDate(2026, 10, day, hour);

describe("business days in WSUSA review", () => {
  it("counts the weekdays after the submission day, through today", () => {
    expect(businessDaysSince(at(5, 9), at(5, 17))).toBe(0);
    expect(businessDaysSince(at(5), at(6))).toBe(1);
    expect(businessDaysSince(at(5), at(9))).toBe(4);
    // A weekend adds nothing.
    expect(businessDaysSince(at(9), at(11))).toBe(0);
    expect(businessDaysSince(at(9), at(12))).toBe(1);
    expect(businessDaysSince(at(10), at(12))).toBe(1);
  });

  it("is past review time only after more than reviewDays business days", () => {
    // Submitted Monday the 5th: 10 business days runs through Monday the 19th.
    expect(pastReviewTime(at(5), at(19, 23), 10)).toBe(false);
    expect(pastReviewTime(at(5), at(20, 0), 10)).toBe(true);
  });

  it("agrees with its query cutoff for every submission time over five weeks", () => {
    for (const reviewDays of [1, 3, 10]) {
      for (let nowDay = 1; nowDay <= 31; nowDay++) {
        const now = at(nowDay, 10);
        const cutoff = reviewCutoff(now, reviewDays);
        for (let h = 0; h < 24 * 35; h += 5) {
          const submitted = new Date(campusDate(2026, 9, 20).getTime() + h * 3_600_000);
          if (submitted > now) break;
          expect(submitted < cutoff, `${submitted.toISOString()} at ${now.toISOString()}, ${reviewDays} days`).toBe(pastReviewTime(submitted, now, reviewDays));
        }
      }
    }
  });

  it("starts the cutoff at a campus midnight", () => {
    // Tuesday the 20th: 10 business days back ends Tuesday the 6th, so the 5th and earlier are late.
    expect(reviewCutoff(at(20, 15), 10).getTime()).toBe(campusDate(2026, 10, 6).getTime());
  });
});

describe("WSUSA's funding tasks, on time or late", () => {
  const now = at(20, 15);
  it("splits review tasks at the cutoff and invoice tasks at their due date", () => {
    expect(fundingTasks("review", true, now, 10)).toEqual({ sourceType: "funding", createdAt: { lt: campusDate(2026, 10, 6) } });
    expect(fundingTasks("review", false, now, 10)).toEqual({ sourceType: "funding", createdAt: { gte: campusDate(2026, 10, 6) } });
    expect(fundingTasks("invoice", true, now, 10)).toEqual({ sourceType: "invoice", dueAt: { lt: now } });
    expect(fundingTasks("invoice", false, now, 10)).toEqual({ sourceType: "invoice", OR: [{ dueAt: null }, { dueAt: { gte: now } }] });
  });
});
