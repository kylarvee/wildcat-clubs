/**
 * Shapes returned by the metrics layer. Kept free of server imports so client
 * components (charts, tables) can import them directly.
 */

export type ClubActivity = {
  active: boolean;
  inPilot: boolean;
  pilotEndsAt: Date | null;
  heldEventsCurrentTerm: number;
  heldEventsPreviousTerm: number;
  registeredMembers: number;
  activeMembers: number;
  /**
   * Plain-language reasons for the status: each unmet requirement when the
   * club is inactive, the pilot note while it's in its pilot period, and
   * nothing when it's active on its own record.
   */
  reasons: string[];
  /** Names of the terms the event counts cover ("Fall 2026"), when the academic calendar has them. */
  currentTermName?: string | null;
  previousTermName?: string | null;
};

export type RetentionPeriod = "month" | "quarter" | "academicYear" | "year";

export type RetentionPoint = {
  label: string; // "Oct 2026", "Q3 2026", "2025-2026", "2026"
  /** The period this one is compared with ("Sep 2026"); null for a series' first bucket. */
  previousLabel: string | null;
  start: Date;
  end: Date; // last instant of the period (inclusive)
  attendees: number; // distinct people with ≥1 check-in in the period
  retained: number; // of the previous period's attendees, how many came back
  previousAttendees: number;
  rate: number | null; // retained ÷ previousAttendees (null unless both this period and the one before had attendees)
  /** True for the period that contains `at` (still running, so its numbers can still grow). */
  inProgress?: boolean;
};

/**
 * RETENTION, the one figure screens quote (lib/metrics/pure latestRetention):
 * the share of one complete period's attendees who came back the next
 * complete period, for the most recent such pair that both had attendees.
 */
export type RetentionSummary = {
  /** The two periods compared, oldest first ("Sep 2026", "Oct 2026"). */
  from: string;
  to: string;
  /** retained ÷ previousAttendees. */
  rate: number;
  retained: number;
  previousAttendees: number;
  /** The pair, short: "Sep → Oct". */
  months: string;
  /** How every screen shows it: "Sep → Oct: 62% came back". */
  label: string;
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
  /** False when nobody checked in, so it isn't a held event (filter these out of averages). */
  held?: boolean;
};

export type MemberClubSummary = {
  attended: number; // check-ins at this club's events
  heldSinceJoined: number;
  rate: number | null; // attended ÷ heldSinceJoined
  lastAttendedAt: Date | null;
  active: boolean;
  /** Whether this account may ever write reviews (an active student). When false, show no review progress. */
  canReview: boolean;
  /** canReview and attended ≥ reviewThreshold. */
  reviewEligible: boolean;
  reviewThreshold: number;
};

export type MemberClubSummaryEntry = {
  club: { id: string; name: string; slug: string; logoColor: string; logoUrl: string | null };
  summary: MemberClubSummary;
  /** The person's membership in the club, or null when they've only attended as a guest. */
  membershipStatus: "PENDING" | "ACTIVE" | "LEFT" | "ALUMNI" | "REMOVED" | "DECLINED" | null;
};

export type MemberAttendanceCount = {
  attended: number;
  lastAttendedAt: Date | null;
  /** Active per the club rule as of now (not limited to the requested range). */
  active: boolean;
};

export type ClubListMetrics = {
  clubId: string;
  registeredMembers: number;
  activeMembers: number;
  /** Month RETENTION (latestRetention over the last 12 months); null until two full months in a row have check-ins. */
  retention: RetentionSummary | null;
  /** retention's rate, for sorting and number-only readers. */
  retentionRate: number | null;
  avgRating: number | null;
  reviewCount: number;
  /** ACTIVITY SCORE: held events (started, ≥1 check-in) in the last 30 days, hosted or co-hosted. "Events held lately". */
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

export type PlatformSummary = {
  clubsByStatus: Record<string, number>;
  activeClubs: number; // approved clubs that count as active (pilot clubs included)
  pilotClubs: number; // of those, still in their pilot period
  inactiveClubs: number; // approved clubs that don't count as active
  students: number;
  activeStudents: number; // active in ≥1 club
  checkinsThisTerm: number;
  eventsThisTerm: number;
  crossClubCheckinsThisTerm: number;
  monthlyCheckins: { month: string; checkins: number; uniqueAttendees: number }[];
  /** The term the "this term" numbers cover, when the academic calendar has one. */
  termName?: string | null;
};

// ─── Service hours ───────────────────────────────────────────────────────────

/** A club as service records name it. */
export type ServiceClub = { id: string; name: string; slug: string };

/**
 * Service hours earned and the service events they came from. `events`
 * counts dates checked in (each check-in once), the way "Events attended"
 * counts check-ins.
 */
export type ServiceTotal = { minutes: number; events: number };

export type ServiceClubTotal = ServiceTotal & {
  /** A club that hosted or co-hosted the events; null for university events. */
  club: ServiceClub | null;
};

export type ServiceTermTotal = ServiceTotal & {
  /** The term the dates fall in (lib/metrics/service serviceTermOf); null for dates before the academic calendar starts. */
  term: string | null;
};

/** One check-in that earned service hours. */
export type ServiceEntry = {
  attendanceId: string;
  occurrenceId: string;
  eventId: string;
  title: string;
  startsAt: Date;
  /** What this check-in earned: the event's serviceMinutes as it is now. */
  minutes: number;
  /** The host club; null for university events. */
  club: ServiceClub | null;
  /** Approved co-hosts, after the host. */
  cohosts: ServiceClub[];
  term: string | null;
};

/**
 * SERVICE HOURS for one person (lib/metrics serviceSummary): the total, by
 * club (most hours first) and by term (newest first), and every date that
 * earned them (newest first). byTerm adds up to the total; in byClub a
 * co-hosted event counts for every club that put it on (as attendance does),
 * so byClub can add up to more.
 */
export type ServiceSummary = ServiceTotal & {
  byClub: ServiceClubTotal[];
  byTerm: ServiceTermTotal[];
  entries: ServiceEntry[];
};
