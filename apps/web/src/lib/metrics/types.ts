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
  start: Date;
  end: Date; // last instant of the period (inclusive)
  attendees: number; // distinct people with ≥1 check-in in the period
  retained: number; // of the previous period's attendees, how many came back
  previousAttendees: number;
  rate: number | null; // retained ÷ previousAttendees (null when the previous period had nobody)
  /** True for the period that contains `at` (still running, so its numbers can still grow). */
  inProgress?: boolean;
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
