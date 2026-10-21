import type { AttemptStatus, ClubRole, RenewalPeriod, RequirementKind, UserKind } from "@prisma/client";
import { TZDate } from "@date-fns/tz";
import { detailsCurrent, type DetailsLike } from "@/lib/details/rules";
import { TZ } from "@/lib/time";

/**
 * The pure part of the requirement rule (lib/authz/requirements), shared with
 * the task list, admin compliance and the seed checks. Client-safe.
 *
 * A requirement test someone handed in by its deadline that's waiting for a
 * grader (NEEDS_REVIEW) isn't overdue, so nobody's permissions pause over a
 * grader's delay. It isn't met either: it's met once it's graded as passed.
 * If it's graded as not passed, the normal rule applies again on the same
 * clock (so past the deadline it's overdue). tests.markMissedAssignments
 * treats a test assignment the same way.
 */

export type RequirementState = "met" | "review" | "due" | "overdue";

/** How tasks and admin compliance word the "review" state. */
export const AWAITING_GRADE_LABEL = "Submitted — waiting for grading";

export type AttemptLike = { status: AttemptStatus; submittedAt: Date | null };

/** True when one of these attempts was handed in by `dueAt` and is waiting for a grader. No deadline: any one waiting counts. */
export function awaitingGrade(attempts: readonly AttemptLike[], dueAt: Date | null): boolean {
  return attempts.some((a) => a.status === "NEEDS_REVIEW" && a.submittedAt !== null && (dueAt === null || a.submittedAt.getTime() <= dueAt.getTime()));
}

/** Where one requirement stands for one person at `at`. Only "overdue" pauses a leader's permissions. */
export function requirementState(v: { met: boolean; awaitingGrade: boolean; dueAt: Date; at: Date }): RequirementState {
  if (v.met) return "met";
  if (v.awaitingGrade) return "review";
  return v.at.getTime() > v.dueAt.getTime() ? "overdue" : "due";
}

// ─── The whole rule, given what was loaded ───────────────────────────────────
// lib/authz/requirements loads the inputs (one person, or everyone at once);
// these decide. "Met" depends only on the person and the renewal period, so
// it's decided once per person and requirement; the deadline (and so "due",
// "overdue" or "waiting for grading") depends on the seat it reaches them through.

/** What the rule reads from a requirement. */
export type RuleRequirement = {
  id: string;
  kind: RequirementKind;
  testId: string | null;
  trainingEventId: string | null;
  renewal: RenewalPeriod;
  graceDays: number;
  createdAt: Date;
};

export type TermLike = { academicYear: string; startsOn: Date; endsOn: Date };

/**
 * When the current renewal period started, by lib/terms' calendar (terms in
 * date order): NONE never renews, SEMESTER is the current (or last) term,
 * ACADEMIC_YEAR that term's year, ANNUAL Jan 1 campus time. With no term yet
 * on the calendar, the period is all time.
 */
export function periodStartIn(renewal: RenewalPeriod, at: Date, terms: readonly TermLike[]): Date {
  if (renewal === "NONE") return new Date(0);
  if (renewal === "ANNUAL") return new TZDate(new TZDate(at, TZ).getFullYear(), 0, 1, TZ);
  const term = terms.find((t) => t.startsOn <= at && at <= t.endsOn) ?? [...terms].reverse().find((t) => t.startsOn <= at);
  if (!term) return new Date(0);
  if (renewal === "SEMESTER") return term.startsOn;
  return terms.find((t) => t.academicYear === term.academicYear)!.startsOn;
}

/** What one person did that requirements count, from lib/authz/requirements' loaders. */
export type RequirementEvidence = {
  /** Their requirement-test attempts that passed or are waiting for a grader, any period. */
  attempts: readonly (AttemptLike & { testId: string; passed: boolean | null })[];
  /** Their latest check-in per training event. */
  lastCheckIn: ReadonlyMap<string, Date>;
  /** Kind and member details, for PROFILE requirements (null: no such person). */
  person: { kind: UserKind; details: DetailsLike | null } | null;
};

export type Fulfillment = {
  met: boolean;
  /** This period's attempts that passed or wait for a grader (TEST requirements). */
  attempts: readonly AttemptLike[];
};

/**
 * Has the person met the requirement this period? Passed this period (a
 * submitted form counts as passed), checked in to the training this period,
 * or member details complete and confirmed this period. A requirement whose
 * test or training is gone can't be met.
 */
export function fulfillmentOf(r: RuleRequirement, periodStart: Date, e: RequirementEvidence): Fulfillment {
  if (r.kind === "TEST" && r.testId) {
    const attempts = e.attempts.filter((a) => a.testId === r.testId && a.submittedAt !== null && a.submittedAt >= periodStart && (a.passed === true || a.status === "NEEDS_REVIEW"));
    return { met: attempts.some((a) => a.passed), attempts };
  }
  if (r.kind === "TRAINING" && r.trainingEventId) {
    const last = e.lastCheckIn.get(r.trainingEventId);
    return { met: last !== undefined && last >= periodStart, attempts: [] };
  }
  if (r.kind === "PROFILE") return { met: Boolean(e.person && detailsCurrent(e.person.details, e.person.kind, periodStart)), attempts: [] };
  return { met: false, attempts: [] };
}

/** When someone started holding a seat, and when its club was approved. */
export type SeatClock = { startedAt: Date; clubApprovedAt: Date | null };

/** `graceDays` after the latest of taking the seat, the club's approval, the period's start and the day the requirement was added. */
export function seatDueAt(r: Pick<RuleRequirement, "graceDays" | "createdAt">, periodStart: Date, seat: SeatClock): Date {
  const clock = Math.max(seat.startedAt.getTime(), seat.clubApprovedAt?.getTime() ?? 0, periodStart.getTime(), r.createdAt.getTime());
  return new Date(clock + r.graceDays * 86_400_000);
}

export type SeatStatus = {
  met: boolean;
  /** Handed in by this seat's deadline and waiting for a grader: not met yet, not overdue either. */
  awaitingGrade: boolean;
  /** An attempt this period is waiting for a grader, on time or not. */
  gradingPending: boolean;
  periodStart: Date;
  dueAt: Date;
  overdue: boolean;
  state: RequirementState;
};

/** Where one requirement stands for one person through one seat at `at`. */
export function seatStatus(r: Pick<RuleRequirement, "graceDays" | "createdAt">, periodStart: Date, f: Fulfillment, seat: SeatClock, at: Date): SeatStatus {
  const dueAt = seatDueAt(r, periodStart, seat);
  const waiting = !f.met && awaitingGrade(f.attempts, dueAt);
  const gradingPending = !f.met && f.attempts.some((a) => a.status === "NEEDS_REVIEW");
  const state = requirementState({ met: f.met, awaitingGrade: waiting, dueAt, at });
  return { met: f.met, awaitingGrade: waiting, gradingPending, periodStart, dueAt, overdue: state === "overdue", state };
}

// ─── Who a requirement reaches, and what it pauses ───────────────────────────
// A requirement may belong to an office (RoleRequirement.officeId): it reaches
// only the members and leaders of that office's clubs; null is the umbrella's
// (WSUSA), which reaches every club. It may also gate one permission
// (gatesCapability, like "events"): it reaches only leaders who hold that
// permission, and when it's overdue only that permission pauses. Presidents,
// VPs and advisors hold every permission; other seats hold what their seat
// grants. Holding is read from the person's roles, never from their pauses,
// so a requirement doesn't stop applying because it paused someone.

/** What the reach rule reads from a requirement (fields missing on older rows read as null). */
export type ReachRule = { appliesTo: readonly ClubRole[]; officeId?: string | null; gatesCapability?: string | null };

/** The permissions a person's roles in one club give them before any pause: "all" for presidents, VPs and advisors. */
export type Holdings = "all" | ReadonlySet<string>;

/** One seat as the reach rule reads it: its role, its club's office (null = the umbrella) and what the person holds there. */
export type SeatReach = { role: ClubRole; clubOfficeId?: string | null; holds?: Holdings | null };

/** What a person's current roles in one club give them (clubCapabilities' rule, without pauses or the club's phase). */
export function heldCapabilities(assignments: readonly { role: ClubRole; permissions: readonly string[] }[]): Holdings {
  if (assignments.some((a) => a.role === "PRESIDENT" || a.role === "VP" || a.role === "ADVISOR")) return "all";
  return new Set(assignments.flatMap((a) => a.permissions));
}

export function holdsCapability(h: Holdings | null | undefined, capability: string): boolean {
  return h === "all" || Boolean(h?.has(capability));
}

/** Does the requirement reach someone through this seat? Its roles, its office's clubs, and its one permission's holders. */
export function requirementReaches(r: ReachRule, seat: SeatReach): boolean {
  if (!r.appliesTo.includes(seat.role)) return false;
  if (r.officeId != null && r.officeId !== (seat.clubOfficeId ?? null)) return false;
  // Members hold no permissions, so a single-permission requirement never reaches them.
  if (r.gatesCapability != null) return seat.role !== "MEMBER" && holdsCapability(seat.holds, r.gatesCapability);
  return true;
}

/** What overdue requirements pause in one club: every leader permission (`all`), or just the ones listed. */
export type Pause = { all: boolean; capabilities: string[] };

export const NO_PAUSE: Pause = { all: false, capabilities: [] };

/**
 * The pause for a person's overdue requirements in one club: everything when
 * any of them gates no single permission, else exactly the permissions they gate.
 */
export function pauseFor(overdue: readonly { gatesCapability?: string | null }[]): Pause {
  if (!overdue.length) return NO_PAUSE;
  if (overdue.some((r) => r.gatesCapability == null)) return { all: true, capabilities: [] };
  return { all: false, capabilities: [...new Set(overdue.map((r) => r.gatesCapability!))].sort() };
}
