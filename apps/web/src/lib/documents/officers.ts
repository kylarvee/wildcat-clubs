import type { ClubRole, ClubStatus, ClubType, PrismaClient } from "@prisma/client";
import { UMBRELLA_DEFAULTS } from "@/lib/offices/rules";
import { inClubPipeline, pipelineOrder } from "@/lib/roles/pipeline";
import { TIERS } from "@/lib/roles/labels";
import { renewalExemption, renewalStatus, type RenewalWindow } from "@/lib/renewals/rules";
import { fmtDate } from "@/lib/time";

/**
 * THE OFFICERS OF RECORD: who leads a club right now, as its org chart says,
 * with the office that oversees it and where the club stands (recognized
 * since, this academic year's re-registration). One read model for the
 * one-page letter (./officers-pdf), the org chart's and the admin club
 * page's download (lib/domain/officers) and the public /verify page, so they
 * can't disagree. A Treasurer hands it to a bank, a room booking or a
 * sponsor who asks who runs the club.
 *
 * Names, seat titles and start dates only: no student's email, phone or
 * anything else from their account (the loader never reads them). The only
 * contacts are the overseeing office's public ones (Admin → Offices).
 *
 * The officers are the club's own pipeline seats (lib/roles/pipeline:
 * President, Vice Presidents, then officer seats in chart order; for a
 * college's ambassador program, its ambassador seats too), then its
 * advisors. A regular club's College Ambassador is placed by the college, so
 * it isn't one of the club's officers.
 *
 * Pure, except loadOfficersRecord, which reads with the Prisma client it's
 * given and imports nothing server-only, so prisma/seed/verify.ts builds
 * exactly what the platform does.
 */

export type OfficerRow = { id: string; title: string; role: ClubRole; name: string; since: Date };
export type AdvisorRow = { id: string; name: string; since: Date };
/** An office's public contacts (its Office row), as components/offices/OfficeContact shows them. */
export type OfficeContactInfo = { name: string; location: string | null; hours: string | null; email: string | null; phone: string | null };

export type OfficersRenewal =
  | { kind: "renewed"; year: string; at: Date }
  | { kind: "due" | "overdue"; year: string; dueAt: Date }
  /** Approved after this academic year's window opened: it first re-registers next year. */
  | { kind: "firstYear"; year: string }
  /** No academic calendar yet, or a college's ambassador program (they don't renew). */
  | { kind: "none" };

export type OfficersRecord = {
  club: { id: string; name: string; slug: string; status: ClubStatus; type: ClubType; retiredAt: Date | null };
  office: OfficeContactInfo;
  /** When it was approved ("Recognized since …"); null if it never was. */
  recognizedSince: Date | null;
  renewal: OfficersRenewal;
  officers: OfficerRow[];
  advisors: AdvisorRow[];
  generatedAt: Date;
};

/** A current role assignment as the loader reads it: never anything from the person's account but their name. */
export type SeatAssignment = {
  id: string;
  role: ClubRole;
  startedAt: Date;
  position: { name: string; sortOrder: number; archivedAt: Date | null } | null;
  user: { id: string; name: string };
};

const roleLabel = (role: ClubRole) => TIERS.find((t) => t.roles.includes(role))?.label ?? "Officer";

/**
 * The officer and advisor rows, from the club's current assignments: seats in
 * pipeline order (tier, the chart's order, then name), co-holders by who took
 * the seat first; someone without a live seat is listed under their role,
 * after that tier's seats. Each assignment is one row (a person holding two
 * seats is on the letter twice, once per title).
 */
export function officerRows(assignments: SeatAssignment[], clubType: ClubType): { officers: OfficerRow[]; advisors: AdvisorRow[] } {
  const live = (a: SeatAssignment) => (a.position && !a.position.archivedAt ? a.position : null);
  const byStart = [...assignments].sort((x, y) => x.startedAt.getTime() - y.startedAt.getTime());
  // pipelineOrder's sort is stable, so co-holders of a seat stay in the order they took it.
  const officers = pipelineOrder(
    byStart
      .filter((a) => inClubPipeline(a.role, clubType))
      .map((a) => ({ a, role: a.role, name: live(a)?.name ?? roleLabel(a.role), sortOrder: live(a)?.sortOrder ?? Number.MAX_SAFE_INTEGER })),
  ).map((r): OfficerRow => ({ id: r.a.id, title: r.name, role: r.role, name: r.a.user.name, since: r.a.startedAt }));
  const advisors = byStart.filter((a) => a.role === "ADVISOR").map((a): AdvisorRow => ({ id: a.id, name: a.user.name, since: a.startedAt }));
  return { officers, advisors };
}

/** This academic year's re-registration, by the renewal rules (lib/renewals/rules): one window for every club. */
export function officersRenewal(club: { status: string; type: string; approvedAt: Date | null }, window: RenewalWindow | null, renewedAt: Date | null, now: Date): OfficersRenewal {
  if (!window) return { kind: "none" };
  if (renewedAt) return { kind: "renewed", year: window.year, at: renewedAt };
  const exemption = renewalExemption(club, window);
  if (exemption) return club.status === "APPROVED" && club.type !== "COLLEGE_AMBASSADORS" ? { kind: "firstYear", year: window.year } : { kind: "none" };
  const status = renewalStatus({ window, now, renewedAt: null, exemption: null });
  return status.kind === "overdue" ? { kind: "overdue", year: window.year, dueAt: window.dueAt } : { kind: "due", year: window.year, dueAt: window.dueAt };
}

// ─── Words the letter and the verify page share ──────────────────────────────

const longDay = (d: Date) => fmtDate(d, "MMMM d, yyyy");

/** "Since Aug 18, 2025": when someone took the seat. */
export const sinceLine = (d: Date) => fmtDate(d, "MMM d, yyyy");

/** "Recognized since September 20, 2022", or null for a club that was never approved. */
export function recognizedLine(r: Pick<OfficersRecord, "recognizedSince">): string | null {
  return r.recognizedSince ? `Recognized since ${longDay(r.recognizedSince)}` : null;
}

/** "Re-registered for 2026–27 on September 13, 2026", "Not yet re-registered for 2026–27 (due September 30, 2026)", or null when there's nothing to say. */
export function renewalLine(r: OfficersRenewal): string | null {
  switch (r.kind) {
    case "renewed":
      return `Re-registered for ${r.year} on ${longDay(r.at)}`;
    case "due":
      return `Not yet re-registered for ${r.year} (due ${longDay(r.dueAt)})`;
    case "overdue":
      return `Not yet re-registered for ${r.year} (it was due ${longDay(r.dueAt)})`;
    case "firstYear":
      return `Approved during ${r.year}, so it first re-registers next academic year`;
    case "none":
      return null;
  }
}

/** The renewal as a labelled fact for the letter ("2026–27 renewal": "Not yet re-registered", "It was due September 30, 2026"), or null when there's nothing to say. */
export function renewalFact(r: OfficersRenewal): { label: string; value: string; hint?: string } | null {
  switch (r.kind) {
    case "renewed":
      return { label: `${r.year} renewal`, value: `Re-registered ${longDay(r.at)}` };
    case "due":
      return { label: `${r.year} renewal`, value: "Not yet re-registered", hint: `Due ${longDay(r.dueAt)}` };
    case "overdue":
      return { label: `${r.year} renewal`, value: "Not yet re-registered", hint: `It was due ${longDay(r.dueAt)}` };
    case "firstYear":
      return { label: `${r.year} renewal`, value: "Starts next academic year", hint: "It was approved after this year's renewal opened" };
    case "none":
      return null;
  }
}

/** "officers-of-record-rc-wrecker-bots-club-2026-10-20.pdf" */
export const officersFileName = (r: Pick<OfficersRecord, "club" | "generatedAt">) => `officers-of-record-${r.club.slug}-${fmtDate(r.generatedAt, "yyyy-MM-dd")}.pdf`;

// ─── Loading ─────────────────────────────────────────────────────────────────

type Client = Pick<PrismaClient, "club" | "roleAssignment" | "office" | "clubRenewal">;

const contactSelect = { name: true, location: true, hours: true, email: true, phone: true } as const;

/**
 * The officers of record as they stand at `now` (null when there's no such
 * club). `window` is this academic year's renewal window (lib/domain/renewals
 * currentRenewalWindow on the platform). It checks nothing: callers decide
 * who may see it (lib/domain/officers).
 */
export async function loadOfficersRecord(client: Client, clubId: string, at: { window: RenewalWindow | null; now: Date }): Promise<OfficersRecord | null> {
  const club = await client.club.findUnique({
    where: { id: clubId },
    select: { id: true, name: true, slug: true, status: true, type: true, approvedAt: true, retiredAt: true, officeId: true },
  });
  if (!club) return null;
  const [assignments, office, renewal] = await Promise.all([
    client.roleAssignment.findMany({
      where: { clubId, endedAt: null, role: { not: "MEMBER" }, user: { status: { not: "DEACTIVATED" } } },
      orderBy: { startedAt: "asc" },
      // Names only: no student's email, phone or anything else goes on a document anyone can be handed.
      select: { id: true, role: true, startedAt: true, position: { select: { name: true, sortOrder: true, archivedAt: true } }, user: { select: { id: true, name: true } } },
    }),
    // A null officeId is the umbrella (lib/offices/rules); its defaults stand in until its row exists.
    client.office.findFirst({ where: club.officeId ? { id: club.officeId } : { umbrella: true }, select: contactSelect, orderBy: { createdAt: "asc" } }),
    at.window ? client.clubRenewal.findUnique({ where: { clubId_academicYear: { clubId, academicYear: at.window.year } }, select: { submittedAt: true } }) : null,
  ]);
  const { officers, advisors } = officerRows(assignments, club.type);
  return {
    club: { id: club.id, name: club.name, slug: club.slug, status: club.status, type: club.type, retiredAt: club.retiredAt },
    office: office ?? { name: UMBRELLA_DEFAULTS.name, location: UMBRELLA_DEFAULTS.location, hours: UMBRELLA_DEFAULTS.hours, email: UMBRELLA_DEFAULTS.email, phone: UMBRELLA_DEFAULTS.phone },
    recognizedSince: club.approvedAt,
    renewal: officersRenewal(club, at.window, renewal?.submittedAt ?? null, at.now),
    officers,
    advisors,
    generatedAt: at.now,
  };
}
