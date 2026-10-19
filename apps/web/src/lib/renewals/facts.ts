import type { ClubStatus, ClubType, Prisma, PrismaClient } from "@prisma/client";
import { profileGaps } from "@/lib/clubs/profile-rules";
import {
  blockingChecks,
  renewalChecks,
  renewalExemption,
  renewalStatus,
  type DocState,
  type RenewalCheck,
  type RenewalFacts,
  type RenewalStatus,
  type RenewalTerm,
  type RenewalWindow,
} from "@/lib/renewals/rules";

/**
 * Loads what the renewal checks read, for one club or every approved club at
 * once (a handful of queries, whatever the number of clubs). It takes the
 * Prisma client as a parameter and imports nothing server-only, so the seed
 * and prisma/seed/verify.ts (plain tsx scripts) compute exactly what the
 * platform shows. lib/domain/renewals is its caller on the platform.
 */

type Client = Pick<PrismaClient, "club" | "roleAssignment" | "clubDocument" | "event" | "eventCohost" | "clubRenewal">;

export type RenewalPerson = { id: string; name: string };

export type RenewalRecord = {
  id: string;
  academicYear: string;
  submittedAt: Date;
  note: string | null;
  checks: Prisma.JsonValue;
  submittedBy: RenewalPerson | null;
};

export type ClubRenewalState = {
  club: { id: string; name: string; slug: string; type: ClubType; status: ClubStatus; approvedAt: Date | null; logoUrl: string | null; logoColor: string };
  presidents: RenewalPerson[];
  vicePresidents: RenewalPerson[];
  advisors: RenewalPerson[];
  facts: RenewalFacts;
  checks: RenewalCheck[];
  /** Required checks that fail: renewal waits for them. */
  blocking: RenewalCheck[];
  /** This window's renewal, once the club renewed. */
  renewal: RenewalRecord | null;
  /** Why the club isn't asked to renew this window (lib/renewals/rules renewalExemption), or null. */
  exemption: string | null;
  status: RenewalStatus;
};

const clubSelect = {
  id: true,
  name: true,
  slug: true,
  type: true,
  status: true,
  approvedAt: true,
  logoUrl: true,
  logoColor: true,
  shortDescription: true,
  descriptionHtml: true,
  scope: true,
  collegeId: true,
  departmentId: true,
  requestedDepartmentName: true,
  category: true,
} satisfies Prisma.ClubSelect;

/**
 * Renewal state for the clubs in `clubIds` (any status), or for every approved
 * club except College Ambassadors programs. Sorted by club name.
 */
export async function loadRenewalStates(
  client: Client,
  opts: { window: RenewalWindow | null; term: RenewalTerm | null; now: Date; clubIds?: string[] },
): Promise<ClubRenewalState[]> {
  const clubs = await client.club.findMany({
    where: opts.clubIds ? { id: { in: opts.clubIds } } : { status: "APPROVED", type: { not: "COLLEGE_AMBASSADORS" } },
    orderBy: { name: "asc" },
    select: clubSelect,
  });
  if (!clubs.length) return [];
  const ids = clubs.map((c) => c.id);
  const inTerm = opts.term ? ({ status: "SCHEDULED", startsAt: { gte: opts.term.startsOn, lte: opts.term.endsOn } } satisfies Prisma.EventOccurrenceWhereInput) : null;

  const [roles, docs, hosted, cohosted, renewals] = await Promise.all([
    client.roleAssignment.findMany({
      where: { clubId: { in: ids }, endedAt: null, role: { in: ["PRESIDENT", "VP", "ADVISOR"] }, user: { status: { not: "DEACTIVATED" } } },
      orderBy: { startedAt: "asc" },
      select: { clubId: true, role: true, user: { select: { id: true, name: true } } },
    }),
    client.clubDocument.findMany({
      where: { clubId: { in: ids }, kind: { in: ["CONSTITUTION", "BYLAWS"] }, status: { in: ["ACTIVE", "PENDING_APPROVAL"] } },
      select: { clubId: true, kind: true, status: true },
    }),
    inTerm
      ? client.event.findMany({
          where: { clubId: { in: ids }, status: "SCHEDULED", occurrences: { some: inTerm } },
          select: { clubId: true, _count: { select: { occurrences: { where: inTerm } } } },
        })
      : [],
    inTerm
      ? client.eventCohost.findMany({
          where: { clubId: { in: ids }, status: "APPROVED", event: { status: "SCHEDULED", occurrences: { some: inTerm } } },
          select: { clubId: true, event: { select: { _count: { select: { occurrences: { where: inTerm } } } } } },
        })
      : [],
    opts.window
      ? client.clubRenewal.findMany({
          where: { clubId: { in: ids }, academicYear: opts.window.year },
          select: { id: true, clubId: true, academicYear: true, submittedAt: true, note: true, checks: true, submittedBy: { select: { id: true, name: true } } },
        })
      : [],
  ]);

  const events = new Map<string, number>();
  for (const e of hosted) if (e.clubId) events.set(e.clubId, (events.get(e.clubId) ?? 0) + e._count.occurrences);
  for (const c of cohosted) events.set(c.clubId, (events.get(c.clubId) ?? 0) + c.event._count.occurrences);
  const renewalOf = new Map(renewals.map((r) => [r.clubId, r]));

  return clubs.map((club) => {
    const people = (role: "PRESIDENT" | "VP" | "ADVISOR") => {
      const seen = new Set<string>();
      return roles.filter((r) => r.clubId === club.id && r.role === role && !seen.has(r.user.id) && seen.add(r.user.id)).map((r) => r.user);
    };
    const docState = (kind: "CONSTITUTION" | "BYLAWS"): DocState => {
      const mine = docs.filter((d) => d.clubId === club.id && d.kind === kind);
      return mine.some((d) => d.status === "ACTIVE") ? "active" : mine.length ? "pending" : "missing";
    };
    const presidents = people("PRESIDENT");
    const vicePresidents = people("VP");
    const advisors = people("ADVISOR");
    const facts: RenewalFacts = {
      profileGaps: profileGaps(club),
      presidents: presidents.map((p) => p.name),
      vicePresidents: vicePresidents.map((p) => p.name),
      advisors: advisors.map((p) => p.name),
      constitution: docState("CONSTITUTION"),
      bylaws: docState("BYLAWS"),
      termName: opts.term?.name ?? null,
      eventsThisTerm: events.get(club.id) ?? 0,
    };
    const checks = renewalChecks(facts);
    const row = renewalOf.get(club.id);
    const renewal: RenewalRecord | null = row ? { id: row.id, academicYear: row.academicYear, submittedAt: row.submittedAt, note: row.note, checks: row.checks, submittedBy: row.submittedBy } : null;
    const exemption = renewalExemption(club, opts.window);
    return {
      club: { id: club.id, name: club.name, slug: club.slug, type: club.type, status: club.status, approvedAt: club.approvedAt, logoUrl: club.logoUrl, logoColor: club.logoColor },
      presidents,
      vicePresidents,
      advisors,
      facts,
      checks,
      blocking: blockingChecks(checks),
      renewal,
      exemption,
      status: renewalStatus({ window: opts.window, now: opts.now, renewedAt: renewal?.submittedAt ?? null, exemption }),
    };
  });
}
