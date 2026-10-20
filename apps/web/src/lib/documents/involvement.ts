import "server-only";
import { cache } from "react";
import type { ClubStatus, MembershipStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/authz";
import { END_REASON_LABEL } from "@/lib/roles/labels";
import { getTerms } from "@/lib/terms";
import { serviceSummary } from "@/lib/metrics";
import { loadPersonAttendance } from "@/lib/attendance/queries";
import { buildInvolvementRecord, type InvolvementRecord, type RecordCompletion } from "./record";
import { verifyDocumentToken } from "./tokens";

/**
 * Gathers the facts for THE INVOLVEMENT RECORD (./record) from the tools that
 * own them: role history (Org Chart), service hours (lib/metrics, from
 * attendance), check-ins (Attendance Tool), and WSUSA trainings, tests and
 * forms (Attendance Tool and Test Tool). Read-only, and it checks nothing:
 * callers decide who may see whose record (lib/domain/involvement, pages).
 */

/** A person's check-in history and memberships, read once per request (the record and My involvement's history table share it). */
export const personAttendance = cache((userId: string) => loadPersonAttendance(userId));

export const loadInvolvementRecord = cache(async (userId: string): Promise<InvolvementRecord | null> => {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      handle: true,
      email: true,
      kind: true,
      status: true,
      classYear: true,
      graduatedAt: true,
      jobTitle: true,
      department: { select: { name: true } },
      majors: { select: { isMinor: true, major: { select: { name: true } } }, orderBy: { major: { name: "asc" } } },
    },
  });
  if (!user) return null;
  const [seats, service, attendance, completed, terms] = await Promise.all([
    db.roleAssignment.findMany({
      where: { userId, role: { not: "MEMBER" } },
      select: {
        id: true,
        role: true,
        startedAt: true,
        endedAt: true,
        endReason: true,
        position: { select: { name: true } },
        club: { select: { id: true, name: true, slug: true, status: true } },
        viaClub: { select: { name: true } },
      },
    }),
    serviceSummary(userId),
    personAttendance(userId),
    completedRequirements(userId),
    getTerms(),
  ]);
  return buildInvolvementRecord({
    person: {
      id: user.id,
      name: user.name,
      handle: user.handle,
      email: user.email,
      kind: user.kind,
      status: user.status,
      majors: user.majors.filter((m) => !m.isMinor).map((m) => m.major.name),
      minors: user.majors.filter((m) => m.isMinor).map((m) => m.major.name),
      classYear: user.classYear,
      graduatedAt: user.graduatedAt,
      jobTitle: user.jobTitle,
      department: user.department?.name ?? null,
    },
    generatedAt: new Date(),
    seats: seats.map((s) => ({
      id: s.id,
      title: s.position?.name ?? ROLE_LABEL[s.role],
      role: s.role,
      club: s.club,
      via: s.viaClub?.name ?? null,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      endReason: s.endReason ? END_REASON_LABEL[s.endReason] : null,
    })),
    service,
    checkins: attendance.rows.map((r) => ({ startsAt: r.startsAt, clubs: r.clubs, guestOf: r.otherClubs.map((c) => c.id) })),
    // lib/attendance/queries types these statuses as plain strings; they're the Prisma enums.
    memberships: attendance.memberships.map((m) => ({ club: { ...m.club, status: m.club.status as ClubStatus }, status: m.status as MembershipStatus, joinedAt: m.joinedAt })),
    completed,
    terms,
  });
});

export type VerifiedRecord =
  | { state: "valid"; record: InvolvementRecord; issuedAt: Date }
  /** Signed by us, but the account is gone or closed: nothing live to show. */
  | { state: "closed"; issuedAt: Date }
  | { state: "invalid" };

/**
 * What a /verify link shows: the record as it stands now when the link is
 * one we signed for an account that's still open. Public (the link is the
 * permission), so pages show only its summary and leadership.
 */
export async function verifiedRecord(token: string): Promise<VerifiedRecord> {
  const claim = verifyDocumentToken(token);
  if (!claim || claim.kind !== "involvement") return { state: "invalid" };
  const record = await loadInvolvementRecord(claim.subjectId);
  if (!record || record.person.status === "DEACTIVATED") return { state: "closed", issuedAt: claim.issuedAt };
  return { state: "valid", record, issuedAt: claim.issuedAt };
}

/**
 * WSUSA trainings and workshops they checked in to (university events, and
 * any requirement's training), and WSUSA tests and forms they passed (a
 * submitted form counts as passed, as the requirements engine says). Marked
 * required when a WSUSA requirement asks for it.
 */
async function completedRequirements(userId: string): Promise<RecordCompletion[]> {
  const requirements = await db.roleRequirement.findMany({ select: { kind: true, testId: true, trainingEventId: true } });
  const requiredTests = new Set(requirements.flatMap((r) => (r.kind === "TEST" && r.testId ? [r.testId] : [])));
  const requiredEvents = new Set(requirements.flatMap((r) => (r.kind === "TRAINING" && r.trainingEventId ? [r.trainingEventId] : [])));
  const [trainings, attempts] = await Promise.all([
    db.attendance.findMany({
      where: { userId, occurrence: { event: { OR: [{ id: { in: [...requiredEvents] } }, { clubId: null, kind: { in: ["TRAINING", "WORKSHOP"] } }] } } },
      select: { id: true, occurrence: { select: { startsAt: true, event: { select: { id: true, title: true, kind: true } } } } },
    }),
    db.testAttempt.findMany({
      where: { userId, passed: true, submittedAt: { not: null }, test: { OR: [{ clubId: null }, { id: { in: [...requiredTests] } }] } },
      select: { id: true, submittedAt: true, gradedAt: true, test: { select: { id: true, title: true, isForm: true } } },
    }),
  ]);
  return [
    ...trainings.map((t): RecordCompletion => ({
      id: t.id,
      name: t.occurrence.event.title,
      kind: t.occurrence.event.kind === "WORKSHOP" ? "workshop" : "training",
      at: t.occurrence.startsAt,
      required: requiredEvents.has(t.occurrence.event.id),
    })),
    ...attempts.map((a): RecordCompletion => ({
      id: a.id,
      name: a.test.title,
      kind: a.test.isForm ? "form" : "test",
      at: a.gradedAt ?? a.submittedAt!,
      required: requiredTests.has(a.test.id),
    })),
  ];
}
