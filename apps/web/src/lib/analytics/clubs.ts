import "server-only";
import type { ClubRole, FundingSource, FundingStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { clubActivityMany, clubAverageAttendance, clubListMetrics, type OccurrenceAttendance } from "@/lib/metrics";
import { lastBuckets } from "@/lib/metrics/pure";
import { academicYearAt, currentOrLastTerm, getTerms } from "@/lib/terms";
import { orgChartData } from "@/lib/roles/queries";
import { connectionCounts } from "./network";
import { stageOf, type ClubAnalyticsRow } from "./club-table";
import { membershipGrowth, trimLeadingEmpty, type GrowthPoint } from "./growth";

/**
 * Read side of admin club analytics (/admin/analytics and its drill-down).
 * Every activity, retention, attendance and rating number comes from
 * lib/metrics; this module only joins them to club facts and adds what
 * metrics doesn't cover (membership over time, seat coverage, funding
 * totals). Nothing here writes.
 */

/** Mean member attendance rate over held events — the Attendance Tracker's "Avg. attendance". */
export function averageRate(occurrences: OccurrenceAttendance[]): number | null {
  const rates = occurrences.filter((o) => o.held !== false).map((o) => o.rate).filter((r): r is number => r !== null);
  return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
}

/** The current term (or the last one, between terms) up to now. */
export async function termWindow(now: Date) {
  const terms = await getTerms();
  const term = currentOrLastTerm(terms, now);
  if (!term) return null;
  return { name: term.name, from: term.startsOn, to: term.endsOn < now ? term.endsOn : now, endsOn: term.endsOn, startsOn: term.startsOn };
}


/** One row per club (every status), for the analytics table and its CSV. */
export async function clubAnalyticsRows(now = new Date()): Promise<{ rows: ClubAnalyticsRow[]; termName: string | null }> {
  const [clubs, term] = await Promise.all([
    db.club.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, type: true, status: true, scope: true, collegeId: true, college: { select: { name: true, shortName: true } } },
    }),
    termWindow(now),
  ]);
  const ids = clubs.map((c) => c.id);
  // Founding clubs have no events; only clubs that could have run one this term go in the attendance query.
  const withEvents = clubs.filter((c) => c.status === "APPROVED" || c.status === "RETIRED").map((c) => c.id);
  const [activity, list, links, rateBy, leaders] = await Promise.all([
    clubActivityMany(ids),
    clubListMetrics(ids),
    connectionCounts(),
    // The tracker's "Avg. attendance" for every club at once (lib/metrics; the same figure as averageRate above).
    term ? clubAverageAttendance(withEvents, { from: term.from, to: term.to }) : Promise.resolve(new Map<string, number | null>()),
    // Current Presidents and advisors, for the No President and No advisor filters.
    db.roleAssignment.groupBy({ by: ["clubId", "role"], where: { endedAt: null, role: { in: ["PRESIDENT", "ADVISOR"] } }, _count: { _all: true } }),
  ]);
  const heldBy = new Map(leaders.map((g) => [`${g.clubId}:${g.role}`, g._count._all]));
  const held = (clubId: string, role: ClubRole) => heldBy.get(`${clubId}:${role}`) ?? 0;

  const rows: ClubAnalyticsRow[] = clubs.map((c) => {
    const a = activity.get(c.id);
    const m = list.get(c.id);
    const l = links.get(c.id);
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      type: c.type,
      status: c.status,
      stage: stageOf(c.status, a),
      scope: c.scope,
      collegeId: c.collegeId,
      collegeName: c.college?.name ?? null,
      collegeShort: c.college?.shortName ?? null,
      registered: m?.registeredMembers ?? a?.registeredMembers ?? 0,
      active: m?.activeMembers ?? a?.activeMembers ?? 0,
      retention: m?.retentionRate ?? null,
      retentionSummary: m?.retention ?? null,
      avgAttendance: rateBy.get(c.id) ?? null,
      heldEvents: a?.heldEventsCurrentTerm ?? 0,
      rating: m?.avgRating ?? null,
      reviews: m?.reviewCount ?? 0,
      connections: l?.clubs ?? 0,
      crossCheckins: l?.weight ?? 0,
      presidents: held(c.id, "PRESIDENT"),
      advisors: held(c.id, "ADVISOR"),
    };
  });
  return { rows, termName: term?.name ?? null };
}

// ─── Drill-down ──────────────────────────────────────────────────────────────

/**
 * Members at the end of each month for the last two years (from the club's first member, when that's later).
 * Students only, like the "Registered members" number (lib/metrics registeredMemberCount).
 */
export async function membershipGrowthFor(clubId: string, now = new Date()): Promise<GrowthPoint[]> {
  const memberships = await db.membership.findMany({ where: { clubId, user: { kind: "STUDENT" } }, select: { joinedAt: true, endedAt: true, status: true } });
  return trimLeadingEmpty(membershipGrowth(memberships, lastBuckets("month", now, 24), now));
}

export type SeatCoverage = {
  seats: number;
  filled: number;
  holders: number;
  vacancies: { id: string; name: string; roleLabel: string; role: ClubRole; isCore: boolean; vacantSince: Date | null; neverFilled: boolean }[];
  advisors: { id: string; name: string; handle: string }[];
};

/** Live seats on the org chart, which ones are empty and since when, and the club's advisors. */
export async function seatCoverage(clubId: string): Promise<SeatCoverage> {
  const chart = await orgChartData(clubId);
  const seats = chart.seats.filter((s) => !s.virtual);
  const empty = seats.filter((s) => s.holders.length === 0);
  const [lastEnded, created] = await Promise.all([
    empty.length
      ? db.roleAssignment.groupBy({ by: ["positionId"], where: { positionId: { in: empty.map((s) => s.id) }, endedAt: { not: null } }, _max: { endedAt: true } })
      : Promise.resolve([]),
    empty.length ? db.position.findMany({ where: { id: { in: empty.map((s) => s.id) } }, select: { id: true, createdAt: true } }) : Promise.resolve([]),
  ]);
  const endedBy = new Map(lastEnded.map((r) => [r.positionId, r._max.endedAt]));
  const createdBy = new Map(created.map((p) => [p.id, p.createdAt]));
  const vacancies = empty
    .map((s) => {
      const ended = endedBy.get(s.id) ?? null;
      return { id: s.id, name: s.name, roleLabel: s.roleLabel, role: s.role, isCore: s.isCore, vacantSince: ended ?? createdBy.get(s.id) ?? null, neverFilled: !ended };
    })
    // Core seats (President, VP) first, then the longest-empty.
    .sort((a, b) => Number(b.isCore) - Number(a.isCore) || (a.vacantSince?.getTime() ?? 0) - (b.vacantSince?.getTime() ?? 0));
  return {
    seats: seats.length,
    filled: seats.length - empty.length,
    holders: seats.reduce((n, s) => n + s.holders.length, 0),
    vacancies,
    advisors: chart.advisors.map((p) => ({ id: p.id, name: p.name, handle: p.handle })),
  };
}

export type FundingSummary = {
  yearLabel: string | null;
  /** Submitted for a decision (everything except drafts and withdrawn requests). */
  requestedCents: number;
  approvedCents: number;
  pendingCents: number;
  counts: { submitted: number; pending: number; approved: number; denied: number };
  /** requestedCents by the source the club expected; approvedCents by the source WSUSA funded it from (fundedSource ?? fundingSource). */
  bySource: { source: FundingSource; requestedCents: number; approvedCents: number }[];
  recent: { id: string; title: string; status: FundingStatus; requestedCents: number; approvedCents: number | null; termName: string; submittedAt: Date | null }[];
};

const DECIDED_OR_WAITING: FundingStatus[] = ["SUBMITTED", "APPROVED", "PARTIALLY_APPROVED", "DENIED"];

/** Funding requests for the academic year in progress (by the request's term). */
export async function fundingSummary(clubId: string, now = new Date()): Promise<FundingSummary> {
  const terms = await getTerms();
  const ay = academicYearAt(terms, now);
  const empty: FundingSummary = { yearLabel: ay?.label ?? null, requestedCents: 0, approvedCents: 0, pendingCents: 0, counts: { submitted: 0, pending: 0, approved: 0, denied: 0 }, bySource: [], recent: [] };
  if (!ay) return empty;
  const requests = await db.fundingRequest.findMany({
    where: { clubId, status: { in: DECIDED_OR_WAITING }, term: { academicYear: ay.label } },
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, title: true, status: true, fundingSource: true, fundedSource: true, amountRequestedCents: true, amountApprovedCents: true, submittedAt: true, term: { select: { name: true } } },
  });
  const out = { ...empty, bySource: [] as FundingSummary["bySource"] };
  const sources = new Map<FundingSource, { requestedCents: number; approvedCents: number }>();
  const source = (key: FundingSource) => {
    let s = sources.get(key);
    if (!s) sources.set(key, (s = { requestedCents: 0, approvedCents: 0 }));
    return s;
  };
  for (const r of requests) {
    const approved = r.status === "APPROVED" || r.status === "PARTIALLY_APPROVED" ? (r.amountApprovedCents ?? 0) : 0;
    out.requestedCents += r.amountRequestedCents;
    out.approvedCents += approved;
    out.counts.submitted++;
    if (r.status === "SUBMITTED") {
      out.pendingCents += r.amountRequestedCents;
      out.counts.pending++;
    } else if (r.status === "DENIED") out.counts.denied++;
    else out.counts.approved++;
    // Asked for: by the source the club expects. Granted: by the source WSUSA funded it from
    // (lib/funding/math requestTotals, the admin funding page and the budget breakdown agree).
    source(r.fundingSource).requestedCents += r.amountRequestedCents;
    if (approved) source(r.fundedSource ?? r.fundingSource).approvedCents += approved;
  }
  out.bySource = [...sources.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.requestedCents - a.requestedCents);
  out.recent = requests.slice(0, 5).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    requestedCents: r.amountRequestedCents,
    approvedCents: r.amountApprovedCents,
    termName: r.term.name,
    submittedAt: r.submittedAt,
  }));
  return out;
}
