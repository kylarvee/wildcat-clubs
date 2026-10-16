import "server-only";
import type { ClubRole, MembershipStatus, RoleEndReason, RoleRequirement } from "@prisma/client";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/authz";
import { requirementStatus } from "@/lib/authz/requirements";
import { seatSort } from "@/lib/domain/orgchart";

/**
 * Read models for the org chart, roster and role history. Read-only; every
 * write goes through lib/domain/roles, orgchart or memberships.
 */

const personSelect = { id: true, name: true, handle: true, avatarUrl: true, avatarColor: true, status: true } as const;

export type Person = { id: string; name: string; handle: string; avatarUrl: string | null; avatarColor: string };

export type ChartHolder = {
  assignmentId: string;
  person: Person;
  role: ClubRole;
  permissions: string[];
  startedAt: Date;
  internalTitle: string | null;
  viaClub: { name: string; slug: string } | null;
};

export type ChartSeat = {
  id: string;
  name: string;
  role: ClubRole;
  roleLabel: string;
  responsibilities: string[];
  defaultPermissions: string[];
  maxHolders: number;
  isCore: boolean;
  /** Holders whose assignment has no seat (e.g. a founder granted before seats existed) — shown, not editable. */
  virtual: boolean;
  holders: ChartHolder[];
};

export type OrgChartData = {
  seats: ChartSeat[];
  archived: { id: string; name: string; role: ClubRole; archivedAt: Date }[];
  advisors: Person[];
};

const CHART_ROLES: ClubRole[] = ["PRESIDENT", "VP", "OFFICER", "AMBASSADOR"];

/** The live org chart: active seats in tier order with who holds each one now. */
export async function orgChartData(clubId: string): Promise<OrgChartData> {
  const [positions, assignments] = await Promise.all([
    db.position.findMany({ where: { clubId } }),
    db.roleAssignment.findMany({
      where: { clubId, endedAt: null },
      orderBy: { startedAt: "asc" },
      include: { user: { select: personSelect }, viaClub: { select: { name: true, slug: true } } },
    }),
  ]);
  const titles = new Map(
    (
      await db.membership.findMany({
        where: { clubId, userId: { in: [...new Set(assignments.map((a) => a.userId))] } },
        select: { userId: true, internalTitle: true },
      })
    ).map((m) => [m.userId, m.internalTitle]),
  );
  const toHolder = (a: (typeof assignments)[number]): ChartHolder => ({
    assignmentId: a.id,
    person: { id: a.user.id, name: a.user.name, handle: a.user.handle, avatarUrl: a.user.avatarUrl, avatarColor: a.user.avatarColor },
    role: a.role,
    permissions: a.permissions,
    startedAt: a.startedAt,
    internalTitle: titles.get(a.userId) ?? null,
    viaClub: a.viaClub,
  });

  const live = positions.filter((p) => !p.archivedAt).sort(seatSort);
  const liveIds = new Set(live.map((p) => p.id));
  const seats: ChartSeat[] = live.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    roleLabel: ROLE_LABEL[p.role],
    responsibilities: p.responsibilities,
    defaultPermissions: p.defaultPermissions,
    maxHolders: p.maxHolders,
    isCore: p.isCore,
    virtual: false,
    holders: assignments.filter((a) => a.positionId === p.id).map(toHolder),
  }));

  // Leaders whose seat is missing or archived still appear, under their role.
  const unseated = assignments.filter((a) => CHART_ROLES.includes(a.role) && (!a.positionId || !liveIds.has(a.positionId)));
  for (const role of CHART_ROLES) {
    const hs = unseated.filter((a) => a.role === role);
    if (!hs.length) continue;
    const tierEnd = seats.reduce((idx, s, i) => (CHART_ROLES.indexOf(s.role) <= CHART_ROLES.indexOf(role) ? i + 1 : idx), 0);
    seats.splice(tierEnd, 0, {
      id: `unseated:${role}`,
      name: ROLE_LABEL[role],
      role,
      roleLabel: ROLE_LABEL[role],
      responsibilities: [],
      defaultPermissions: [],
      maxHolders: hs.length,
      isCore: false,
      virtual: true,
      holders: hs.map(toHolder),
    });
  }

  return {
    seats,
    archived: positions
      .filter((p) => p.archivedAt)
      .map((p) => ({ id: p.id, name: p.name, role: p.role, archivedAt: p.archivedAt! }))
      .sort((a, b) => b.archivedAt.getTime() - a.archivedAt.getTime()),
    advisors: assignments.filter((a) => a.role === "ADVISOR").map((a) => toHolder(a).person),
  };
}

/** Officer requirements status per holder — "pending" (within grace) or "overdue" (permissions paused). */
export async function trainingStatusFor(holders: ChartHolder[], clubApprovedAt: Date | null): Promise<Map<string, "pending" | "overdue">> {
  const out = new Map<string, "pending" | "overdue">();
  if (!clubApprovedAt) return out; // requirements only bind leaders of approved clubs
  for (const h of holders) {
    if (h.role === "ADVISOR" || h.role === "MEMBER") continue;
    const s = await requirementStatus(h.person.id, h.role, { assignmentStartedAt: h.startedAt, clubApprovedAt });
    if (s.overdue) out.set(h.assignmentId, "overdue");
    else if (!s.allMet) out.set(h.assignmentId, "pending");
  }
  return out;
}

export type RequirementSummary = Pick<RoleRequirement, "id" | "name" | "description" | "kind" | "graceDays" | "renewal"> & { appliesTo: ClubRole[] };

/** Active officer requirements (tests/trainings) — what a new role brings with it. */
export async function activeRequirements(): Promise<RequirementSummary[]> {
  return db.roleRequirement.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, kind: true, graceDays: true, renewal: true, appliesTo: true },
  });
}

export type PickablePerson = Person & { seats: string[] };

/** Active student members (the people who can be given a role), with the seats they already hold. */
export async function activeStudentMembers(clubId: string): Promise<PickablePerson[]> {
  const rows = await db.membership.findMany({
    where: { clubId, status: "ACTIVE", user: { status: "ACTIVE", kind: "STUDENT" } },
    select: { user: { select: personSelect } },
    orderBy: { user: { name: "asc" } },
  });
  const seats = await db.roleAssignment.findMany({
    where: { clubId, endedAt: null, userId: { in: rows.map((r) => r.user.id) } },
    select: { userId: true, role: true, position: { select: { name: true } } },
  });
  return rows.map(({ user }) => ({
    id: user.id,
    name: user.name,
    handle: user.handle,
    avatarUrl: user.avatarUrl,
    avatarColor: user.avatarColor,
    seats: seats.filter((s) => s.userId === user.id).map((s) => s.position?.name ?? ROLE_LABEL[s.role]),
  }));
}

export type RosterRow = {
  membershipId: string;
  person: Person & { email: string; kind: "STUDENT" | "FACULTY_STAFF"; accountStatus: string };
  status: MembershipStatus;
  internalTitle: string | null;
  requestedAt: Date;
  joinedAt: Date | null;
  endedAt: Date | null;
  roles: { assignmentId: string; role: ClubRole; label: string; viaClub: string | null }[];
  topRank: number;
};

const RANK: Record<ClubRole, number> = { MEMBER: 0, AMBASSADOR: 1, OFFICER: 1, VP: 2, PRESIDENT: 3, ADVISOR: 4 };

/** Everyone with a membership row in the club (current, alumni, past and pending), with their live roles. */
export async function rosterData(clubId: string): Promise<RosterRow[]> {
  const [members, roles] = await Promise.all([
    db.membership.findMany({
      where: { clubId },
      include: { user: { select: { ...personSelect, email: true, kind: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    db.roleAssignment.findMany({
      where: { clubId, endedAt: null },
      include: { position: { select: { name: true } }, viaClub: { select: { name: true } } },
      orderBy: { startedAt: "asc" },
    }),
  ]);
  return members.map((m) => {
    const mine = roles.filter((r) => r.userId === m.userId);
    return {
      membershipId: m.id,
      person: {
        id: m.user.id,
        name: m.user.name,
        handle: m.user.handle,
        avatarUrl: m.user.avatarUrl,
        avatarColor: m.user.avatarColor,
        email: m.user.email,
        kind: m.user.kind,
        accountStatus: m.user.status,
      },
      status: m.status,
      internalTitle: m.internalTitle,
      requestedAt: m.requestedAt,
      joinedAt: m.joinedAt,
      endedAt: m.endedAt,
      roles: mine.map((r) => ({ assignmentId: r.id, role: r.role, label: r.position?.name ?? ROLE_LABEL[r.role], viaClub: r.viaClub?.name ?? null })),
      topRank: Math.max(0, ...mine.map((r) => RANK[r.role])),
    };
  });
}

// ─── Role history ────────────────────────────────────────────────────────────

export type HistoryContribution = {
  id: string;
  title: string;
  descriptionHtml: string | null;
  url: string | null;
  createdAt: Date;
  files: { id: string; name: string; mimeType: string | null; clubId: string | null; ownerId: string | null; parentId: string | null; visibility: "INHERIT" | "PUBLIC" | "MEMBERS" | "LEADERS"; createdById: string; trashedAt: Date | null }[];
};

export type HistoryTerm = {
  assignmentId: string;
  person: Person & { alumni: boolean };
  role: ClubRole;
  startedAt: Date;
  endedAt: Date | null;
  endReason: RoleEndReason | null;
  assignedBy: string | null;
  viaClub: { name: string; slug: string } | null;
  contributions: HistoryContribution[];
};

export type HistorySeat = {
  key: string;
  name: string;
  role: ClubRole;
  roleLabel: string;
  archivedAt: Date | null;
  current: boolean;
  /** When the seat started needing a holder: the later of its creation and the club's approval (null for role groups). */
  openedAt: Date | null;
  terms: HistoryTerm[];
};

/**
 * Every seat the club has ever had (archived too) with every person who held
 * it, plus roles held without a seat (grouped by role). Feeds the Role History
 * page; alumni and retired clubs keep all of it.
 */
export async function roleHistoryData(clubId: string): Promise<HistorySeat[]> {
  const [club, positions, assignments] = await Promise.all([
    db.club.findUnique({ where: { id: clubId }, select: { approvedAt: true } }),
    db.position.findMany({ where: { clubId } }),
    db.roleAssignment.findMany({
      where: { clubId, role: { not: "MEMBER" } },
      orderBy: { startedAt: "asc" },
      include: {
        user: { select: personSelect },
        assignedBy: { select: { name: true } },
        viaClub: { select: { name: true, slug: true } },
        projects: {
          orderBy: { createdAt: "asc" },
          include: {
            files: {
              include: {
                file: { select: { id: true, name: true, mimeType: true, clubId: true, ownerId: true, parentId: true, visibility: true, createdById: true, trashedAt: true, isFolder: true } },
              },
            },
          },
        },
      },
    }),
  ]);
  const toTerm = (a: (typeof assignments)[number]): HistoryTerm => ({
    assignmentId: a.id,
    person: { id: a.user.id, name: a.user.name, handle: a.user.handle, avatarUrl: a.user.avatarUrl, avatarColor: a.user.avatarColor, alumni: a.user.status === "ALUMNI" },
    role: a.role,
    startedAt: a.startedAt,
    endedAt: a.endedAt,
    endReason: a.endReason,
    assignedBy: a.assignedBy?.name ?? null,
    viaClub: a.viaClub,
    contributions: a.projects.map((p) => ({
      id: p.id,
      title: p.title,
      descriptionHtml: p.descriptionHtml,
      url: p.url,
      createdAt: p.createdAt,
      files: p.files.map((f) => f.file).filter((f) => !f.isFolder),
    })),
  });

  const seats: HistorySeat[] = [...positions].sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) || seatSort(a, b)).map((p) => ({
    key: p.id,
    name: p.name,
    role: p.role,
    roleLabel: ROLE_LABEL[p.role],
    archivedAt: p.archivedAt,
    current: !p.archivedAt,
    openedAt: club?.approvedAt ? (club.approvedAt > p.createdAt ? club.approvedAt : p.createdAt) : null,
    terms: assignments.filter((a) => a.positionId === p.id).map(toTerm),
  }));
  const seatIds = new Set(positions.map((p) => p.id));
  const loose = assignments.filter((a) => !a.positionId || !seatIds.has(a.positionId));
  const order: ClubRole[] = ["PRESIDENT", "VP", "OFFICER", "AMBASSADOR", "ADVISOR"];
  for (const role of order) {
    const terms = loose.filter((a) => a.role === role).map(toTerm);
    if (!terms.length) continue;
    seats.push({
      key: `role:${role}`,
      name: role === "ADVISOR" ? "Faculty advisor" : `${ROLE_LABEL[role]} (no seat)`,
      role,
      roleLabel: ROLE_LABEL[role],
      archivedAt: null,
      current: true,
      openedAt: null,
      terms,
    });
  }
  // Seats nobody has ever held aren't history yet.
  return seats.filter((s) => s.terms.length > 0 || s.current);
}
