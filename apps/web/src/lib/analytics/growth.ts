import type { MembershipStatus } from "@prisma/client";
import { wasMemberAt, type PeriodBucket } from "@/lib/metrics/pure";

/**
 * Membership over time for the admin drill-down. "Members at a moment" is
 * the same rule metrics uses for attendance rates (wasMemberAt): joined by
 * then, not ended by then, and not a pending or declined request. Pure, so
 * it's tested on its own.
 */

export type MembershipSpan = { joinedAt: Date | null; endedAt: Date | null; status: MembershipStatus };

export type GrowthPoint = {
  key: string;
  label: string;
  /** Members at the end of the month (or now, for the month in progress). */
  members: number;
  joined: number;
  left: number;
  inProgress: boolean;
};

export function membershipGrowth(memberships: MembershipSpan[], buckets: PeriodBucket[], now: Date): GrowthPoint[] {
  return buckets.map((b) => {
    // Calendar buckets end at the first instant of the next month, so a finished month is measured just before it.
    const inProgress = b.start.getTime() <= now.getTime() && now.getTime() < b.end.getTime();
    const at = inProgress ? now : new Date(b.end.getTime() - 1);
    let members = 0;
    let joined = 0;
    let left = 0;
    for (const m of memberships) {
      if (wasMemberAt(m, at)) members++;
      const counts = m.status !== "PENDING" && m.status !== "DECLINED";
      if (counts && m.joinedAt && m.joinedAt >= b.start && m.joinedAt <= at) joined++;
      if (counts && m.joinedAt && m.endedAt && m.endedAt >= b.start && m.endedAt <= at) left++;
    }
    return { key: b.key, label: b.label, members, joined, left, inProgress };
  });
}

/** Trim leading months from before the club had anyone, keeping at least `min` months. */
export function trimLeadingEmpty(points: GrowthPoint[], min = 6): GrowthPoint[] {
  const first = points.findIndex((p) => p.members > 0 || p.joined > 0);
  if (first <= 0) return points;
  return points.slice(Math.min(first, Math.max(0, points.length - min)));
}
