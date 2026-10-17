import { describe, expect, it } from "vitest";
import { lastBuckets } from "@/lib/metrics/pure";
import { membershipGrowth, trimLeadingEmpty, type MembershipSpan } from "./growth";

const d = (s: string) => new Date(s);

describe("membershipGrowth", () => {
  const now = d("2026-10-16T18:00:00Z");
  const buckets = lastBuckets("month", now, 4); // Jul–Oct 2026, campus time

  it("counts members at each month's end with the metrics rule", () => {
    const ms: MembershipSpan[] = [
      { joinedAt: d("2026-07-10T18:00:00Z"), endedAt: null, status: "ACTIVE" },
      { joinedAt: d("2026-08-02T18:00:00Z"), endedAt: d("2026-09-20T18:00:00Z"), status: "LEFT" },
      { joinedAt: d("2026-09-05T18:00:00Z"), endedAt: null, status: "ACTIVE" },
      { joinedAt: null, endedAt: null, status: "PENDING" },
      { joinedAt: d("2026-08-01T18:00:00Z"), endedAt: null, status: "DECLINED" },
    ];
    const pts = membershipGrowth(ms, buckets, now);
    expect(pts.map((p) => p.label)).toEqual(["Jul 2026", "Aug 2026", "Sep 2026", "Oct 2026"]);
    expect(pts.map((p) => p.members)).toEqual([1, 2, 2, 2]);
    expect(pts.map((p) => p.joined)).toEqual([1, 1, 1, 0]);
    expect(pts.map((p) => p.left)).toEqual([0, 0, 1, 0]);
    expect(pts.map((p) => p.inProgress)).toEqual([false, false, false, true]);
  });

  it("measures the month in progress as of now, not its end", () => {
    const ms: MembershipSpan[] = [{ joinedAt: d("2026-10-25T18:00:00Z"), endedAt: null, status: "ACTIVE" }];
    const pts = membershipGrowth(ms, buckets, now);
    expect(pts.at(-1)!.members).toBe(0);
    expect(pts.at(-1)!.joined).toBe(0);
  });

  it("puts a join at campus midnight on the 1st in the new month only", () => {
    // Oct 1, 00:00 in Ogden (MDT, UTC−6) is 06:00 UTC.
    const ms: MembershipSpan[] = [{ joinedAt: d("2026-10-01T06:00:00Z"), endedAt: null, status: "ACTIVE" }];
    const pts = membershipGrowth(ms, buckets, now);
    expect(pts.map((p) => p.joined)).toEqual([0, 0, 0, 1]);
    expect(pts.map((p) => p.members)).toEqual([0, 0, 0, 1]);
  });
});

describe("trimLeadingEmpty", () => {
  const pt = (members: number, joined = 0) => ({ key: String(Math.random()), label: "", members, joined, left: 0, inProgress: false });
  it("drops empty months before the first member, keeping a minimum", () => {
    const pts = [pt(0), pt(0), pt(0), pt(0), pt(1, 1), pt(2, 1), pt(3, 1)];
    expect(trimLeadingEmpty(pts, 2)).toHaveLength(3);
    expect(trimLeadingEmpty(pts, 5)).toHaveLength(5);
  });
  it("leaves a club with members from the start alone", () => {
    const pts = [pt(4), pt(5)];
    expect(trimLeadingEmpty(pts)).toEqual(pts);
  });
});
