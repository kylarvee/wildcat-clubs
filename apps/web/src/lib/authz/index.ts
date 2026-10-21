import "server-only";
import { cache } from "react";
import type { ClubRole, ClubStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { requirementStatus } from "@/lib/authz/requirements";
import { heldCapabilities, NO_PAUSE, type Pause } from "@/lib/authz/requirement-rules";

/**
 * THE permission authority. Every page, server action, API route, mobile
 * endpoint and AI tool asks this module — nothing else decides who may do what.
 *
 * Hierarchy (highest first):
 *   SYSADMIN  everything, including system config and granting ADMIN
 *   ADMIN     everything in every club + admin tools; no system config, can't add admins
 *   OFFICE    an office's staff (lib/offices): admin-level in that office's clubs, and
 *             the office-scoped admin tools (adminScope) for them only
 *   ADVISOR   everything in their club
 *   PRESIDENT everything in their club, incl. naming a successor and retiring the club
 *   VP        everything the president can, except assigning President/VP or retiring
 *   OFFICER   the capabilities granted on their seat (set when promoted)
 *   AMBASSADOR like an officer; no capabilities unless the club grants them
 *   MEMBER    member features (calendar, chat, reviews once eligible)
 *
 * Rule for roles: you may assign only roles ranked below your own; the President
 * may also name a President (successor or co-president).
 */

export const ROLE_RANK: Record<ClubRole, number> = {
  MEMBER: 0,
  AMBASSADOR: 1,
  OFFICER: 1,
  VP: 2,
  PRESIDENT: 3,
  ADVISOR: 4,
};

export const ROLE_LABEL: Record<ClubRole, string> = {
  MEMBER: "Member",
  AMBASSADOR: "Ambassador",
  OFFICER: "Officer",
  VP: "Vice President",
  PRESIDENT: "President",
  ADVISOR: "Advisor",
};

/** Modular club permissions. Officers and ambassadors get a chosen subset. */
export const CAPABILITIES = {
  profile: { label: "Club profile & page", description: "Edit the club's profile, page and logo." },
  roster: { label: "Members", description: "Approve join requests, set internal titles, remove members." },
  orgchart: { label: "Org chart", description: "Edit seats and responsibilities." },
  events: { label: "Events", description: "Plan events, event costs and co-hosting in the Events Builder." },
  attendance: { label: "Attendance", description: "Run check-in and see everyone's attendance." },
  budget: { label: "Budget & funding", description: "Budget items and funding requests." },
  files: { label: "Files", description: "Upload, organize and share club files." },
  announcements: { label: "Announcements", description: "Post announcements to members." },
  elections: { label: "Elections", description: "Run leadership elections." },
  constitution: { label: "Constitution & bylaws", description: "Update the constitution and bylaws." },
  tests: { label: "Club tests", description: "Build and grade the club's own tests." },
} as const;

export type Capability = keyof typeof CAPABILITIES;
export const ALL_CAPABILITIES = Object.keys(CAPABILITIES) as Capability[];

/** What a club can do in each stage of its life. Founding clubs only build their profile. */
const PHASE_CAPABILITIES: Record<ClubStatus, Capability[]> = {
  DRAFT: ["profile", "orgchart", "constitution", "files"],
  CHANGES_REQUESTED: ["profile", "orgchart", "constitution", "files"],
  SUBMITTED: ["profile", "orgchart", "constitution", "files"],
  REJECTED: [],
  APPROVED: ALL_CAPABILITIES,
  RETIRED: [],
};

// ─── Platform-level actions ──────────────────────────────────────────────────

export type PlatformAction =
  | "admin.access"
  | "admin.clubs" // review submissions, department requests, custom constitutions, retire/reinstate
  | "admin.funding"
  | "admin.policies"
  | "admin.tests"
  | "admin.trainings"
  | "admin.complaints"
  | "admin.directory" // colleges, departments, majors, buildings
  | "admin.reviews" // moderate reviews
  | "admin.analytics"
  | "admin.events" // review events flagged in the Events Builder
  | "admin.offices" // offices, their contacts and staff, and which office oversees a club
  | "admin.users"
  | "admin.announce" // university-wide announcements
  | "system.config"
  | "system.admins"
  | "club.create"
  | "complaint.submit"
  | "network.view";

export function isAdmin(actor: Actor | null): boolean {
  return actor?.platformRole === "ADMIN" || actor?.platformRole === "SYSADMIN";
}

export function isSysadmin(actor: Actor | null): boolean {
  return actor?.platformRole === "SYSADMIN";
}

/** Staff of an office besides the umbrella (lib/offices): they run the admin console for its clubs only. */
export function isOfficeStaff(actor: Actor | null): boolean {
  return Boolean(actor && actor.status !== "DEACTIVATED" && actor.officeIds?.length);
}

/**
 * The admin tools office staff use too, each filtered to their own office's
 * clubs (adminScope / adminClubWhere). admin.funding is theirs only when their
 * office decides its clubs' funding. Everything else under admin.* (people,
 * the directory, policies, review moderation, reports, university-wide
 * announcements, trainings, offices) and system.* stays WSUSA's.
 */
const OFFICE_ACTIONS: ReadonlySet<PlatformAction> = new Set<PlatformAction>(["admin.access", "admin.clubs", "admin.funding", "admin.tests", "admin.analytics", "admin.events"]);

export function can(actor: Actor | null, action: PlatformAction): boolean {
  if (!actor || actor.status === "DEACTIVATED") return action === "network.view";
  if (action.startsWith("system.")) return isSysadmin(actor);
  if (action.startsWith("admin.")) {
    if (isAdmin(actor)) return true;
    if (!isOfficeStaff(actor)) return false;
    if (action === "admin.funding") return OFFICE_ACTIONS.has(action) && (actor.fundingOfficeIds?.length ?? 0) > 0;
    return OFFICE_ACTIONS.has(action);
  }
  switch (action) {
    case "club.create":
      return actor.status === "ACTIVE";
    case "complaint.submit":
    case "network.view":
      return true;
  }
  return false;
}

// ─── Admin scope (which clubs an admin tool shows) ───────────────────────────

/**
 * Whose clubs this person administers. `all`: a platform admin (WSUSA staff
 * or a sysadmin, the umbrella office's staff), every club. Otherwise the
 * clubs of `officeIds`, the offices they staff; nobody else administers any.
 */
export type AdminScope = { all: boolean; officeIds: string[] };

export function adminScope(actor: Actor | null): AdminScope {
  if (!actor || actor.status === "DEACTIVATED") return { all: false, officeIds: [] };
  return { all: isAdmin(actor), officeIds: [...(actor.officeIds ?? [])] };
}

/** May this person administer this club (its office is theirs)? A null officeId is the umbrella's: platform admins only. */
export function canAdminClub(actor: Actor | null, club: { officeId: string | null }): boolean {
  const s = adminScope(actor);
  return s.all || (club.officeId !== null && s.officeIds.includes(club.officeId));
}

/** The clubs an admin tool lists for this person: every club, their offices' clubs, or none. */
export function adminClubWhere(actor: Actor | null): Prisma.ClubWhereInput {
  const s = adminScope(actor);
  if (s.all) return {};
  if (s.officeIds.length) return { officeId: { in: s.officeIds } };
  return { id: { in: [] } };
}

/** May this person decide this club's funding: platform admins, or staff of its office when that office decides funding. */
export function canAdminFunding(actor: Actor | null, club: { officeId: string | null }): boolean {
  if (!can(actor, "admin.funding")) return false;
  return isAdmin(actor) || (club.officeId !== null && (actor?.fundingOfficeIds ?? []).includes(club.officeId));
}

/** The clubs whose funding requests this person decides (the admin Funding tool). */
export function adminFundingClubWhere(actor: Actor | null): Prisma.ClubWhereInput {
  if (!can(actor, "admin.funding")) return { id: { in: [] } };
  if (isAdmin(actor)) return {};
  return { officeId: { in: actor?.fundingOfficeIds ?? [] } };
}

// ─── Club-level access ───────────────────────────────────────────────────────

export type ClubAccess = {
  clubId: string;
  clubStatus: ClubStatus;
  /** Highest active role, MEMBER for plain members, null for non-members. */
  role: ClubRole | null;
  rank: number; // -1 = not a member
  isMember: boolean;
  isPendingMember: boolean;
  /** Ambassador and up (or advisor/admin): may open the club workspace. */
  isLeader: boolean;
  isAdvisor: boolean;
  /**
   * Admin-level here without a club role: a platform admin, or ("OFFICE")
   * staff of the office that oversees the club. Either way an admin is acting.
   */
  viaPlatform: "ADMIN" | "SYSADMIN" | "OFFICE" | null;
  capabilities: Set<Capability>;
  /** An overdue requirement for their role (one that gates no single permission): role kept, every leader permission paused. */
  suspended: boolean;
  /**
   * Permissions paused by overdue single-permission requirements (like Event
   * Safety Training for Events), with those requirements' names; the rest of
   * the role keeps working. Empty when nothing like that is overdue.
   */
  pausedCapabilities: { capability: Capability; requirements: string[] }[];
  /** Roles this person may assign in this club. */
  assignableRoles: ClubRole[];
  canRetire: boolean;
  canInviteAdvisor: boolean;
};

const computeClubAccess = cache(async (actorId: string | null, platformRole: string | null, officeKey: string, clubId: string): Promise<ClubAccess | null> => {
  const club = await db.club.findUnique({ where: { id: clubId }, select: { id: true, status: true, approvedAt: true, type: true, officeId: true } });
  if (!club) return null;
  const ambassadorOrg = club.type === "COLLEGE_AMBASSADORS";

  const officeStaff = Boolean(club.officeId && officeKey && officeKey.split(",").includes(club.officeId));
  const viaPlatform: ClubAccess["viaPlatform"] = platformRole === "ADMIN" || platformRole === "SYSADMIN" ? (platformRole as "ADMIN" | "SYSADMIN") : officeStaff ? "OFFICE" : null;

  const [membership, assignments] = actorId
    ? await Promise.all([
        db.membership.findUnique({ where: { userId_clubId: { userId: actorId, clubId } }, select: { status: true } }),
        db.roleAssignment.findMany({ where: { clubId, userId: actorId, endedAt: null } }),
      ])
    : [null, []];

  const top = [...assignments].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role])[0];
  const role: ClubRole | null = top?.role ?? (membership?.status === "ACTIVE" ? "MEMBER" : null);
  const rank = role ? ROLE_RANK[role] : -1;
  const isAdvisor = role === "ADVISOR";

  // Requirements only bind student leaders of approved clubs. Overdue, one pauses every leader
  // permission, or only the one permission it gates (lib/authz/requirement-rules pauseFor).
  let pause: Pause = NO_PAUSE;
  let pausedBy = new Map<string, string[]>();
  if (actorId && top && club.status === "APPROVED" && rank >= 1 && !isAdvisor) {
    const status = await requirementStatus(actorId, top.role, {
      assignmentStartedAt: top.startedAt,
      clubApprovedAt: club.approvedAt,
      clubOfficeId: club.officeId,
      holds: heldCapabilities(assignments),
    });
    pause = status.pause;
    pausedBy = new Map(pause.capabilities.map((c) => [c, status.items.filter((i) => i.overdue && i.requirement.gatesCapability === c).map((i) => i.requirement.name)]));
  }
  const suspended = pause.all;

  const full = viaPlatform !== null || isAdvisor;
  const caps = clubCapabilities({ clubStatus: club.status, role, assignments, full, suspended, paused: pause.capabilities });
  const pausedCapabilities = full ? [] : [...pausedBy].filter(([c]) => c in CAPABILITIES).map(([c, names]) => ({ capability: c as Capability, requirements: names }));

  const effective = suspended ? -1 : rank;
  const ranked: ClubRole[] =
    full && club.status !== "RETIRED"
      ? ["PRESIDENT", "VP", "OFFICER", "AMBASSADOR"]
      : role === "PRESIDENT" && effective >= 0 && club.status !== "RETIRED"
        ? ["PRESIDENT", "VP", "OFFICER", "AMBASSADOR"]
        : role === "VP" && effective >= 0 && club.status !== "RETIRED"
          ? ["OFFICER", "AMBASSADOR"]
          : [];
  // A regular club's ambassador seats are filled only by its college's ambassador program (roles.placeAmbassador).
  const assignableRoles = ambassadorOrg ? ranked : ranked.filter((r) => r !== "AMBASSADOR");

  return {
    clubId,
    clubStatus: club.status,
    role,
    rank,
    isMember: role !== null,
    isPendingMember: membership?.status === "PENDING",
    isLeader: viaPlatform !== null || rank >= 1,
    isAdvisor,
    viaPlatform,
    capabilities: caps,
    suspended,
    pausedCapabilities,
    assignableRoles,
    canRetire: club.status !== "RETIRED" && (full || (role === "PRESIDENT" && !suspended)),
    // WSUSA appoints an ambassador program's advisor (ambassadors.setAmbassadorAdvisor); nobody invites one.
    canInviteAdvisor: club.status !== "RETIRED" && !ambassadorOrg && (full || ((role === "PRESIDENT" || role === "VP") && !suspended)),
  };
});

/**
 * The capabilities roles give in a club, given whether the person's leader
 * permissions are paused (getClubAccess's rule; the header's task count
 * passes a pause read from stored tasks): `suspended` pauses them all,
 * `paused` only those. Platform admins and advisors hold everything and never
 * pause. Presidents and VPs hold everything unless paused. Other seats hold
 * their own permissions unless paused. Then only what the club's phase allows.
 */
export function clubCapabilities(v: {
  clubStatus: ClubStatus;
  role: ClubRole | null;
  assignments: readonly { permissions: readonly string[] }[];
  full: boolean;
  suspended: boolean;
  paused?: readonly string[];
}): Set<Capability> {
  const caps = new Set<Capability>();
  if (v.full || (!v.suspended && (v.role === "PRESIDENT" || v.role === "VP"))) {
    ALL_CAPABILITIES.forEach((c) => caps.add(c));
  } else if (!v.suspended) {
    for (const a of v.assignments) for (const p of a.permissions) if (p in CAPABILITIES) caps.add(p as Capability);
  }
  if (!v.full) for (const c of v.paused ?? []) caps.delete(c as Capability);
  const allowed = new Set(PHASE_CAPABILITIES[v.clubStatus]);
  for (const c of [...caps]) if (!allowed.has(c)) caps.delete(c);
  return caps;
}

/** Everything `actor` may do in a club. Cached per request (per person, platform role and offices). Null if the club doesn't exist. */
export function getClubAccess(actor: Actor | null, clubId: string) {
  const offices = actor && actor.status !== "DEACTIVATED" ? (actor.officeIds ?? []).join(",") : "";
  return computeClubAccess(actor?.id ?? null, actor?.platformRole ?? null, offices, clubId);
}

export function hasCap(access: ClubAccess | null, cap: Capability): boolean {
  return Boolean(access?.capabilities.has(cap));
}

/**
 * Why `cap` is paused when an overdue single-permission requirement paused it
 * ("Events is paused until you finish Event Safety Training."), for refusals
 * and empty states; null when it isn't (or everything is: see `suspended`).
 */
export function pausedNote(access: ClubAccess | null, cap: Capability): string | null {
  const p = access?.pausedCapabilities.find((x) => x.capability === cap);
  if (!p || access?.capabilities.has(cap)) return null;
  const names = p.requirements.length ? p.requirements.join(" and ") : "an overdue requirement";
  return `${CAPABILITIES[cap].label} is paused until you finish ${names}. Your title and your other permissions keep working.`;
}
