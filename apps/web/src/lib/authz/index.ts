import "server-only";
import { cache } from "react";
import type { ClubRole, ClubStatus } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { requirementStatus } from "@/lib/authz/requirements";

/**
 * THE permission authority. Every page, server action, API route, mobile
 * endpoint and AI tool asks this module — nothing else decides who may do what.
 *
 * Hierarchy (highest first):
 *   SYSADMIN  everything, including system config and granting ADMIN
 *   ADMIN     everything in every club + admin tools; no system config, can't add admins
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

export function can(actor: Actor | null, action: PlatformAction): boolean {
  if (!actor || actor.status === "DEACTIVATED") return action === "network.view";
  if (action.startsWith("system.")) return isSysadmin(actor);
  if (action.startsWith("admin.")) return isAdmin(actor);
  switch (action) {
    case "club.create":
      return actor.status === "ACTIVE";
    case "complaint.submit":
    case "network.view":
      return true;
  }
  return false;
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
  viaPlatform: "ADMIN" | "SYSADMIN" | null;
  capabilities: Set<Capability>;
  /** Overdue officer requirements (tests/trainings): role kept, capabilities paused. */
  suspended: boolean;
  /** Roles this person may assign in this club. */
  assignableRoles: ClubRole[];
  canRetire: boolean;
  canInviteAdvisor: boolean;
};

const computeClubAccess = cache(async (actorId: string | null, platformRole: string | null, clubId: string): Promise<ClubAccess | null> => {
  const club = await db.club.findUnique({ where: { id: clubId }, select: { id: true, status: true, approvedAt: true, type: true } });
  if (!club) return null;
  const ambassadorOrg = club.type === "COLLEGE_AMBASSADORS";

  const viaPlatform = platformRole === "ADMIN" || platformRole === "SYSADMIN" ? (platformRole as "ADMIN" | "SYSADMIN") : null;

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

  // Requirements only bind student leaders of approved clubs.
  let suspended = false;
  if (actorId && top && club.status === "APPROVED" && rank >= 1 && !isAdvisor) {
    const status = await requirementStatus(actorId, top.role, {
      assignmentStartedAt: top.startedAt,
      clubApprovedAt: club.approvedAt,
    });
    suspended = status.overdue;
  }

  const caps = new Set<Capability>();
  const full = viaPlatform !== null || isAdvisor;
  if (full || (!suspended && (role === "PRESIDENT" || role === "VP"))) {
    ALL_CAPABILITIES.forEach((c) => caps.add(c));
  } else if (!suspended) {
    for (const a of assignments) for (const p of a.permissions) if (p in CAPABILITIES) caps.add(p as Capability);
  }
  const allowed = new Set(PHASE_CAPABILITIES[club.status]);
  for (const c of [...caps]) if (!allowed.has(c)) caps.delete(c);

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
    assignableRoles,
    canRetire: club.status !== "RETIRED" && (full || (role === "PRESIDENT" && !suspended)),
    // WSUSA appoints an ambassador program's advisor (ambassadors.setAmbassadorAdvisor); nobody invites one.
    canInviteAdvisor: club.status !== "RETIRED" && !ambassadorOrg && (full || ((role === "PRESIDENT" || role === "VP") && !suspended)),
  };
});

/** Everything `actor` may do in a club. Cached per request. Null if the club doesn't exist. */
export function getClubAccess(actor: Actor | null, clubId: string) {
  return computeClubAccess(actor?.id ?? null, actor?.platformRole ?? null, clubId);
}

export function hasCap(access: ClubAccess | null, cap: Capability): boolean {
  return Boolean(access?.capabilities.has(cap));
}
