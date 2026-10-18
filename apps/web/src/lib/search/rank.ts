/**
 * THE RANKING for the clubs list. Pure (no database), so it's unit-tested
 * and every surface (web list, mobile, the assistant) orders clubs the same.
 *
 *   score = relevance (only with a query) + popularity + personalization
 *
 * Every input is scaled to 0–1 first, then multiplied by its weight below.
 * Popularity comes from lib/metrics (clubListMetrics); personalization from
 * the viewer's own majors, clubs, calendars and check-ins (lib/search/personal).
 * Reasons mention counts, never other people's names.
 */

export const WEIGHTS = {
  /** A text match outweighs everything else: relevance 1.0 is worth 20 points. */
  relevance: 20,
  popularity: {
    /** Active members, log-scaled: 60 active members is full marks. */
    members: 1.2,
    membersFull: 60,
    /** Events in the last and next 30 days (activityScore), log-scaled: 12 is full marks. */
    activity: 0.8,
    activityFull: 12,
    /** Bayesian average rating (1–5 → 0–1), shrunk toward the campus mean. */
    rating: 0.6,
    /** How many "average" reviews every club starts with: few reviews barely move a club. */
    ratingPrior: 5,
    /** Counts as active (pilot clubs included). */
    active: 0.4,
  },
  personal: {
    /** The club's focus is the viewer's major (or minor). */
    major: 1.6,
    minor: 1.2,
    /** Same department as one of the viewer's majors. */
    department: 1.0,
    /** Same college as one of the viewer's majors. */
    college: 0.4,
    /**
     * People who share a club with the viewer and are members here, measured
     * as lift: the share of this club's members who are in the viewer's clubs,
     * over the share you'd expect by chance. Lift 1 = no signal; `peersFullLift`
     * = full marks. (A raw count would just favor big clubs again.)
     */
    peers: 1.0,
    peersFullLift: 3,
    /** The viewer's check-ins at the club's events, log-scaled: 4 is full marks. */
    attended: 1.5,
    attendedFull: 4,
    /** The viewer follows the club's calendar. */
    subscribed: 0.8,
    /**
     * Recommended only: clubs the viewer is in (or asked to join) take this
     * instead of their personal points, so they sink below every other club
     * (popularity tops out at 3) — they're under "My clubs".
     */
    member: -4,
  },
  reasons: {
    /** Show "N people in your clubs are members" from this many, when the overlap is at least `minPeerLift` times chance. */
    minPeers: 2,
    minPeerLift: 1.5,
    /** "Popular this term": at least this many active members and in the top 5% of clubs. */
    popularMin: 15,
    /** "Busy calendar": at least this many events in the last and next 30 days and in the top tenth. */
    busyMin: 8,
    /** "Highly rated": Bayesian rating at least this, from at least `ratedMinReviews` reviews. */
    ratedMin: 4.5,
    ratedMinReviews: 5,
    /** Reasons shown per club. */
    max: 2,
  },
} as const;

export type RankMode = "relevance" | "recommended";

export type MajorMatch = { level: "major" | "minor" | "department" | "college"; label: string };

/** What the viewer's own record says about one club. Never anyone else's identity. */
export type PersonalSignals = {
  majorMatch: MajorMatch | null;
  /** People who share at least one other club with the viewer and are active members here. */
  peers: number;
  /** How much likelier this club's members are to be in the viewer's clubs than chance (1 = as expected). */
  peerLift: number;
  /** The viewer's check-ins at events this club hosted. */
  attended: number;
  subscribed: boolean;
  /** Member, leader, or a join request is waiting. */
  member: boolean;
};

export type RankMetrics = { activeMembers: number; activityScore: number; avgRating: number | null; reviewCount: number; isActive: boolean };

export type RankInput = {
  id: string;
  name: string;
  metrics: RankMetrics;
  /** 0–1 text relevance; null without a query. */
  relevance: number | null;
  personal: PersonalSignals | null;
};

export type RankContext = { meanRating: number; popularMin: number; busyMin: number };

export type Ranked<T> = T & { score: number; reasons: string[] };

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
/** 0 → 0, `full` → 1, more than `full` stays 1; log-shaped so the first few count most. */
export const logScale = (n: number, full: number) => clamp01(Math.log1p(Math.max(0, n)) / Math.log1p(full));

/** Average rating shrunk toward the campus mean: (prior × mean + sum of ratings) ÷ (prior + count). */
export function bayesianRating(avg: number | null, count: number, mean: number, prior: number = WEIGHTS.popularity.ratingPrior): number {
  const n = avg == null || !Number.isFinite(avg) ? 0 : Math.max(0, count);
  return (prior * mean + (n ? avg! * n : 0)) / (prior + n);
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** Campus-wide numbers the per-club scores are measured against (computed over every listed club). */
export function rankContext(all: RankMetrics[]): RankContext {
  let sum = 0;
  let count = 0;
  for (const m of all) {
    if (m.avgRating != null && m.reviewCount > 0) {
      sum += m.avgRating * m.reviewCount;
      count += m.reviewCount;
    }
  }
  const R = WEIGHTS.reasons;
  return {
    meanRating: count ? sum / count : 4,
    popularMin: Math.max(R.popularMin, percentile(all.map((m) => m.activeMembers), 0.95)),
    busyMin: Math.max(R.busyMin, percentile(all.map((m) => m.activityScore), 0.9)),
  };
}

export function popularityScore(m: RankMetrics, ctx: RankContext): number {
  const W = WEIGHTS.popularity;
  const rating = (bayesianRating(m.avgRating, m.reviewCount, ctx.meanRating) - 1) / 4;
  return W.members * logScale(m.activeMembers, W.membersFull) + W.activity * logScale(m.activityScore, W.activityFull) + W.rating * clamp01(rating) + (m.isActive ? W.active : 0);
}

export function personalScore(p: PersonalSignals | null, mode: RankMode): number {
  if (!p) return 0;
  const W = WEIGHTS.personal;
  if (mode === "recommended" && p.member) return W.member;
  const major = p.majorMatch ? W[p.majorMatch.level] : 0;
  const peers = p.peers >= WEIGHTS.reasons.minPeers ? clamp01((p.peerLift - 1) / (W.peersFullLift - 1)) : 0;
  return major + W.peers * peers + W.attended * logScale(p.attended, W.attendedFull) + (p.subscribed ? W.subscribed : 0);
}

export function scoreClub(c: RankInput, mode: RankMode, ctx: RankContext): number {
  const relevance = mode === "relevance" && c.relevance != null ? WEIGHTS.relevance * clamp01(c.relevance) : 0;
  return relevance + popularityScore(c.metrics, ctx) + personalScore(c.personal, mode);
}

const MAJOR_REASON: Record<MajorMatch["level"], (label: string) => string> = {
  major: (l) => `Matches your major (${l})`,
  minor: (l) => `Matches your minor (${l})`,
  department: (l) => `Related to your major (${l})`,
  college: (l) => `In your college (${l})`,
};

/**
 * Up to WEIGHTS.reasons.max short reasons: the viewer's own first, then at
 * most one about the club's standing (so a page of popular clubs doesn't say
 * the same two things on every card).
 */
export function reasonsFor(c: Pick<RankInput, "metrics" | "personal">, ctx: RankContext): string[] {
  const R = WEIGHTS.reasons;
  const out: string[] = [];
  const p = c.personal;
  if (p?.majorMatch) out.push(MAJOR_REASON[p.majorMatch.level](p.majorMatch.label));
  if (p && !p.member) {
    if (p.attended > 0) out.push(p.attended === 1 ? "You've attended 1 of its events" : `You've attended ${p.attended} of its events`);
    if (p.peers >= R.minPeers && p.peerLift >= R.minPeerLift) out.push(`${p.peers} people in your clubs are members`);
    if (p.subscribed) out.push("You follow its calendar");
  }
  const m = c.metrics;
  const standing =
    m.activeMembers >= ctx.popularMin
      ? "Popular this term"
      : m.reviewCount >= R.ratedMinReviews && bayesianRating(m.avgRating, m.reviewCount, ctx.meanRating) >= R.ratedMin
        ? "Highly rated by students"
        : m.activityScore >= ctx.busyMin
          ? "Busy calendar lately"
          : null;
  if (standing) out.push(standing);
  return out.slice(0, R.max);
}

/** Scores, reasons and order (best first; ties by name). */
export function rankClubs<T extends RankInput>(clubs: T[], mode: RankMode, ctx: RankContext = rankContext(clubs.map((c) => c.metrics))): Ranked<T>[] {
  return clubs
    .map((c) => ({ ...c, score: scoreClub(c, mode, ctx), reasons: reasonsFor(c, ctx) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

type ViewerMajor = { id: string; name: string; minor: boolean; departmentId: string | null; collegeId: string | null; collegeName: string | null };
type ClubFacets = { focusMajorId: string | null; focusMajorDepartmentId: string | null; departmentId: string | null; collegeId: string | null };

/** The strongest link between the viewer's majors and a club: its focus major, then department, then college. */
export function majorMatch(majors: ViewerMajor[], club: ClubFacets): MajorMatch | null {
  const order = (m: ViewerMajor) => (m.minor ? 1 : 0);
  const sorted = [...majors].sort((a, b) => order(a) - order(b));
  const exact = sorted.find((m) => m.id === club.focusMajorId);
  if (exact) return { level: exact.minor ? "minor" : "major", label: exact.name };
  const dept = sorted.find((m) => !m.minor && m.departmentId && (m.departmentId === club.departmentId || m.departmentId === club.focusMajorDepartmentId));
  if (dept) return { level: "department", label: dept.name };
  const college = sorted.find((m) => !m.minor && m.collegeId && m.collegeId === club.collegeId);
  if (college) return { level: "college", label: college.collegeName ?? "your college" };
  return null;
}
