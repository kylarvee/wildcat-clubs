import type { ClubRole, ClubStatus, MembershipStatus, UserKind, UserStatus } from "@prisma/client";
import { fmtDate } from "@/lib/time";
import type { TermLike } from "@/lib/metrics/pure";
import { serviceTermOf } from "@/lib/metrics/service";
import type { ServiceSummary } from "@/lib/metrics/types";

/**
 * THE INVOLVEMENT RECORD: one read model for a person's club involvement at
 * Weber State. Leadership seats (from the role history), service hours (from
 * lib/metrics), club attendance by term, and the WSUSA trainings, tests and
 * forms they've completed. My involvement (/me/involvement), its PDF, the
 * admin People page's PDF and the public verify page all build from this one
 * shape, so they can't disagree.
 *
 * Each fact appears once. Service dates are listed under service hours;
 * attendance by term counts club events (a co-hosted one for each club that
 * put it on, as lib/metrics does); university events show up under service
 * hours or trainings rather than under a club. Only clubs WSUSA recognized
 * (approved, or retired with their history) are on the record, so a club
 * still in founding isn't on a document people hand to others.
 *
 * Pure and client-safe; lib/documents/involvement gathers the facts.
 */

export type RecordClub = { id: string; name: string; slug: string };

export type RecordPerson = {
  id: string;
  name: string;
  handle: string;
  email: string;
  kind: UserKind;
  status: UserStatus;
  majors: string[];
  minors: string[];
  classYear: number | null;
  graduatedAt: Date | null;
  jobTitle: string | null;
  department: string | null;
};

export type RecordSeat = {
  id: string;
  /** The seat's name ("Treasurer"), else the role's ("Advisor"). */
  title: string;
  role: ClubRole;
  club: RecordClub;
  /** The college ambassador program that placed them, for ambassador seats. */
  via: string | null;
  startedAt: Date;
  endedAt: Date | null;
  /** How it ended, in words ("Stepped down"); null while they hold it. */
  endReason: string | null;
};

export type RecordTermClub = { club: RecordClub; events: number; asMember: boolean };
/** Club events attended in one term; `term` null for dates before the academic calendar starts. */
export type RecordTerm = { term: string | null; events: number; clubs: RecordTermClub[] };

export type RecordCompletionKind = "training" | "workshop" | "test" | "form";
export type RecordCompletion = { id: string; name: string; kind: RecordCompletionKind; at: Date; required: boolean };

export const COMPLETION_LABEL: Record<RecordCompletionKind, string> = {
  training: "Training attended",
  workshop: "Workshop attended",
  test: "Test passed",
  form: "Form submitted",
};

/** The four numbers on top of every version of the record. */
export type InvolvementSummary = { serviceMinutes: number; serviceEvents: number; clubs: number; leadershipRoles: number };

export type InvolvementRecord = {
  person: RecordPerson;
  generatedAt: Date;
  summary: InvolvementSummary;
  /** Current seats first, then the most recent. */
  leadership: RecordSeat[];
  service: ServiceSummary;
  /** Club events attended (all time) and by term, newest first. */
  attendance: { events: number; byTerm: RecordTerm[] };
  /** Newest first. */
  completed: RecordCompletion[];
};

type Listed = { status: ClubStatus };
const LISTED: ReadonlySet<ClubStatus> = new Set(["APPROVED", "RETIRED"]);
/** Memberships that mean they belonged (requests that were never approved don't). */
const BELONGED: ReadonlySet<MembershipStatus> = new Set(["ACTIVE", "ALUMNI", "LEFT", "REMOVED"]);

export type RecordFacts = {
  person: RecordPerson;
  generatedAt: Date;
  /** Leadership seats: every non-member role assignment, current and ended. */
  seats: (Omit<RecordSeat, "club"> & { club: RecordClub & Listed })[];
  service: ServiceSummary;
  /** Their check-ins: when, the clubs that put the event on (host first; none for university events), and the ones they weren't a member of then. */
  checkins: { startsAt: Date; clubs: RecordClub[]; guestOf: string[] }[];
  memberships: { club: RecordClub & Listed; status: MembershipStatus; joinedAt: Date | null }[];
  completed: RecordCompletion[];
  terms: readonly TermLike[];
};

const club = (c: RecordClub): RecordClub => ({ id: c.id, name: c.name, slug: c.slug });

export function buildInvolvementRecord(f: RecordFacts): InvolvementRecord {
  const leadership: RecordSeat[] = f.seats
    .filter((s) => LISTED.has(s.club.status))
    .map((s) => ({ ...s, club: club(s.club) }))
    .sort(
      (a, b) =>
        Number(Boolean(a.endedAt)) - Number(Boolean(b.endedAt)) ||
        (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0) ||
        b.startedAt.getTime() - a.startedAt.getTime(),
    );

  // Club attendance by term: each check-in once in its term, and once for every club that put the event on.
  const order = new Map([...f.terms].sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime()).map((t, i) => [t.name, i]));
  const terms = new Map<string | null, { events: number; clubs: Map<string, RecordTermClub> }>();
  let events = 0;
  for (const c of f.checkins) {
    if (!c.clubs.length) continue;
    events++;
    const name = serviceTermOf(c.startsAt, f.terms)?.name ?? null;
    const t = terms.get(name) ?? { events: 0, clubs: new Map<string, RecordTermClub>() };
    t.events++;
    for (const x of c.clubs) {
      const cur = t.clubs.get(x.id) ?? { club: club(x), events: 0, asMember: false };
      cur.events++;
      cur.asMember ||= !c.guestOf.includes(x.id);
      t.clubs.set(x.id, cur);
    }
    terms.set(name, t);
  }
  const rank = (term: string | null) => (term === null ? -1 : (order.get(term) ?? -1));
  const byTerm: RecordTerm[] = [...terms.entries()]
    .map(([term, t]) => ({ term, events: t.events, clubs: [...t.clubs.values()].sort((a, b) => b.events - a.events || a.club.name.localeCompare(b.club.name)) }))
    .sort((a, b) => rank(b.term) - rank(a.term));

  const clubs = new Set<string>();
  for (const c of f.checkins) for (const x of c.clubs) clubs.add(x.id);
  for (const m of f.memberships) if (BELONGED.has(m.status) && m.joinedAt && LISTED.has(m.club.status)) clubs.add(m.club.id);
  for (const s of leadership) clubs.add(s.club.id);

  return {
    person: f.person,
    generatedAt: f.generatedAt,
    summary: { serviceMinutes: f.service.minutes, serviceEvents: f.service.events, clubs: clubs.size, leadershipRoles: leadership.length },
    leadership,
    service: f.service,
    attendance: { events, byTerm },
    completed: [...f.completed].sort((a, b) => b.at.getTime() - a.at.getTime()),
  };
}

// ─── Words the page, the PDF and the verify page share ───────────────────────

/** "Sep 2025 – present", "Aug 2024 – May 2025" */
export function seatDates(s: Pick<RecordSeat, "startedAt" | "endedAt">): string {
  return `${fmtDate(s.startedAt, "MMM yyyy")} – ${s.endedAt ? fmtDate(s.endedAt, "MMM yyyy") : "present"}`;
}

/** "Psychology major · Spanish minor · Class of 2027", "Graduated May 2026", "Associate Professor · Department of Psychology" */
export function studyLine(p: RecordPerson): string {
  if (p.kind !== "STUDENT") return [p.jobTitle, p.department].filter(Boolean).join(" · ") || "Faculty & staff";
  return [
    p.majors.length ? `${p.majors.join(" & ")} major${p.majors.length === 1 ? "" : "s"}` : null,
    p.minors.length ? `${p.minors.join(" & ")} minor${p.minors.length === 1 ? "" : "s"}` : null,
    p.status === "ALUMNI" && p.graduatedAt ? `Graduated ${fmtDate(p.graduatedAt, "MMMM yyyy")}` : p.classYear ? `Class of ${p.classYear}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "1 club event", "14 club events" */
export const clubEventsLabel = (n: number) => `${n.toLocaleString("en-US")} club ${n === 1 ? "event" : "events"}`;
