import "server-only";

/**
 * DERIVED METRICS — read-only views over the data lake. Nothing here writes.
 * Every number a surface shows about activity, retention, attendance,
 * ratings or interconnection comes from these functions, so the clubs list,
 * club pages, dashboards, admin analytics, the network canvas and the mobile
 * app can never disagree.
 *
 * Definitions (thresholds come from system config, see lib/config):
 *
 * ACTIVE STUDENT (per club) — attended one of the club's events in the last
 *   `activity.studentWindowDays` (31) days, OR attended at least one of the
 *   club's last `activity.studentRecentEvents` (2) held events.
 *
 * HELD EVENT — a SCHEDULED occurrence that has started and has ≥1 check-in.
 *   Co-hosted events count for the host and every approved co-host.
 *
 * ACTIVE CLUB — status APPROVED and either in its PILOT PERIOD, or
 *   (≥ `activity.clubMinEvents` (2) held events in the current term or the
 *   previous activity term) AND ≥ `activity.clubMinMembers` (8) registered
 *   (ACTIVE) members.
 *
 * PILOT PERIOD — from approval (or creation if never approved) until the end
 *   of the first full activity-counting term that starts after the club was
 *   created. Created mid-Fall → pilot runs through Spring.
 *
 * ATTENDANCE RATE (event) — members who checked in ÷ ACTIVE members at the
 *   time of the event (joinedAt ≤ start, not ended before it). Non-member
 *   attendees are counted separately as guests.
 *
 * RETENTION (period P) — of the people who attended ≥1 club event in the
 *   period before P, the share who attended ≥1 in P. Periods: calendar month,
 *   calendar quarter, academic year (from Terms), calendar year.
 *   Individual retention = the share of periods since joining with ≥1 check-in.
 *
 * ACTIVITY SCORE (clubs list "Activity") — scheduled occurrences in the last
 *   30 days plus the next 30 days.
 *
 * INTERCONNECTION — for each check-in at an event whose participating clubs
 *   are P (host + approved co-hosts), and each club M the attendee was a
 *   member of: every club X in P with X ≠ M gains weight 1 on edge (M, X).
 *   Node size = check-ins at the club's events. Centrality emerges from the
 *   force layout; nothing is placed by hand.
 *
 * Owner: metrics builder. Signatures are a contract; implementations below are stubs.
 */

export type ClubActivity = {
  active: boolean;
  inPilot: boolean;
  pilotEndsAt: Date | null;
  heldEventsCurrentTerm: number;
  heldEventsPreviousTerm: number;
  registeredMembers: number;
  activeMembers: number;
  /** Plain-language reasons, e.g. "Only 1 event this term (needs 2)". */
  reasons: string[];
};

export type RetentionPeriod = "month" | "quarter" | "academicYear" | "year";

export type RetentionPoint = {
  label: string; // "Oct 2026", "Q3 2026", "2025-2026", "2026"
  start: Date;
  end: Date;
  attendees: number; // distinct people with ≥1 check-in in the period
  retained: number; // of the previous period's attendees, how many came back
  previousAttendees: number;
  rate: number | null; // retained ÷ previousAttendees (null when the previous period had nobody)
};

export type OccurrenceAttendance = {
  occurrenceId: string;
  eventId: string;
  title: string;
  startsAt: Date;
  attendees: number; // everyone who checked in
  memberAttendees: number;
  guests: number; // non-members (cross-club attendance)
  membersAtTime: number;
  rate: number | null; // memberAttendees ÷ membersAtTime
};

export type MemberClubSummary = {
  attended: number; // check-ins at this club's events
  heldSinceJoined: number;
  rate: number | null; // attended ÷ heldSinceJoined
  lastAttendedAt: Date | null;
  active: boolean;
  reviewEligible: boolean;
  reviewThreshold: number;
};

export type ClubListMetrics = {
  clubId: string;
  registeredMembers: number;
  activeMembers: number;
  retentionRate: number | null; // latest complete month vs. the one before (month retention)
  avgRating: number | null;
  reviewCount: number;
  activityScore: number;
  isActive: boolean;
  inPilot: boolean;
};

export type NetworkNode = {
  id: string;
  name: string;
  slug: string;
  type: string;
  logoColor: string;
  collegeId: string | null;
  collegeName: string | null;
  departmentName: string | null;
  majorName: string | null;
  size: number; // check-ins at this club's events in the window
  members: number;
};

export type NetworkEdge = { source: string; target: string; weight: number };

export type NetworkData = { nodes: NetworkNode[]; edges: NetworkEdge[]; since: Date; until: Date };

export async function isMemberActive(userId: string, clubId: string, at: Date = new Date()): Promise<boolean> {
  void userId; void clubId; void at;
  return false;
}

/** Ids of ACTIVE-membership users who are active per the definition. */
export async function activeMemberIdsFor(clubId: string, at: Date = new Date()): Promise<string[]> {
  void clubId; void at;
  return [];
}

export async function clubActivity(clubId: string, at: Date = new Date()): Promise<ClubActivity> {
  void clubId; void at;
  return { active: false, inPilot: false, pilotEndsAt: null, heldEventsCurrentTerm: 0, heldEventsPreviousTerm: 0, registeredMembers: 0, activeMembers: 0, reasons: [] };
}

export async function clubRetention(clubId: string, period: RetentionPeriod, opts: { count?: number; at?: Date } = {}): Promise<RetentionPoint[]> {
  void clubId; void period; void opts;
  return [];
}

/** Retention for one person in one club (periods since joining with ≥1 check-in ÷ periods since joining). */
export async function memberRetention(userId: string, clubId: string, period: RetentionPeriod): Promise<{ periods: number; attendedPeriods: number; rate: number | null }> {
  void userId; void clubId; void period;
  return { periods: 0, attendedPeriods: 0, rate: null };
}

export async function clubAttendanceByOccurrence(clubId: string, opts: { from?: Date; to?: Date } = {}): Promise<OccurrenceAttendance[]> {
  void clubId; void opts;
  return [];
}

export async function memberClubSummary(userId: string, clubId: string): Promise<MemberClubSummary> {
  void userId; void clubId;
  return { attended: 0, heldSinceJoined: 0, rate: null, lastAttendedAt: null, active: false, reviewEligible: false, reviewThreshold: 3 };
}

/** Review gate: has this student attended at least `reviews.minAttendance` of the club's events? */
export async function reviewEligibility(userId: string, clubId: string): Promise<{ eligible: boolean; attended: number; required: number }> {
  void userId; void clubId;
  return { eligible: false, attended: 0, required: 3 };
}

/** Batch metrics for the clubs list and admin tables (one pass, no N+1). Omit ids for every approved club. */
export async function clubListMetrics(clubIds?: string[]): Promise<Map<string, ClubListMetrics>> {
  void clubIds;
  return new Map();
}

export async function networkData(opts: { since?: Date; until?: Date } = {}): Promise<NetworkData> {
  return { nodes: [], edges: [], since: opts.since ?? new Date(0), until: opts.until ?? new Date() };
}

export type PlatformSummary = {
  clubsByStatus: Record<string, number>;
  activeClubs: number;
  pilotClubs: number;
  inactiveClubs: number;
  students: number;
  activeStudents: number; // active in ≥1 club
  checkinsThisTerm: number;
  eventsThisTerm: number;
  crossClubCheckinsThisTerm: number;
  monthlyCheckins: { month: string; checkins: number; uniqueAttendees: number }[];
};

export async function platformSummary(at: Date = new Date()): Promise<PlatformSummary> {
  void at;
  return { clubsByStatus: {}, activeClubs: 0, pilotClubs: 0, inactiveClubs: 0, students: 0, activeStudents: 0, checkinsThisTerm: 0, eventsThisTerm: 0, crossClubCheckinsThisTerm: 0, monthlyCheckins: [] };
}
