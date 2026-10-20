import "server-only";
import { cache } from "react";
import type { ClubRole, ClubStatus, ExperienceSource, RoleEndReason, UserKind, UserStatus } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { isAdmin, ROLE_LABEL, ROLE_RANK } from "@/lib/authz";
import { canViewFile } from "@/lib/domain/files";
import { serviceSummary } from "@/lib/metrics";
import type { ServiceEntry } from "@/lib/metrics/types";
import { profileActivity, type ActivityItem } from "@/lib/profiles/activity";

/**
 * Read models for profiles (/u/[handle]) and the profile settings. Read-only;
 * every change goes through lib/domain/profiles.
 */

export type ProfileClub = { id: string; name: string; slug: string; logoUrl: string | null; logoColor: string; status: ClubStatus };
export type ProfileFile = { id: string; name: string; mimeType: string | null; sizeBytes: number | null };
export type ProfileProject = {
  id: string;
  title: string;
  descriptionHtml: string | null;
  url: string | null;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
  club: ProfileClub | null;
  roleAssignmentId: string | null;
  files: ProfileFile[];
  /** Attached files this viewer isn't allowed to open (counted, never named). */
  hiddenFiles: number;
};
export type ProfileRole = {
  id: string;
  title: string;
  role: ClubRole;
  startedAt: Date;
  endedAt: Date | null;
  endReason: RoleEndReason | null;
  viaClub: { name: string; slug: string } | null;
  projects: ProfileProject[];
};
export type ProfileRoleGroup = { club: ProfileClub; current: boolean; start: Date; end: Date | null; roles: ProfileRole[] };
/** Service hours (lib/metrics): the totals for every signed-in viewer; which events only for the person and admins. */
export type ProfileService = { minutes: number; events: number; entries: ServiceEntry[] | null };

const clubSelect = { id: true, name: true, slug: true, logoUrl: true, logoColor: true, status: true } as const;
const fileSelect = { id: true, name: true, mimeType: true, sizeBytes: true, clubId: true, ownerId: true, parentId: true, visibility: true, createdById: true, trashedAt: true, isFolder: true } as const;
const projectInclude = { club: { select: clubSelect }, files: { include: { file: { select: fileSelect } } } } as const;

/** Clubs still in founding (or rejected) stay off other people's view of a profile. */
const LISTED: ClubStatus[] = ["APPROVED", "RETIRED"];

export const profileUser = cache(async (handle: string) =>
  db.user.findUnique({
    where: { handle: handle.toLowerCase() },
    select: {
      id: true,
      name: true,
      handle: true,
      email: true,
      pronouns: true,
      headline: true,
      aboutHtml: true,
      avatarUrl: true,
      avatarColor: true,
      kind: true,
      status: true,
      platformRole: true,
      jobTitle: true,
      classYear: true,
      graduatedAt: true,
      linkedinUrl: true,
      createdAt: true,
      department: { select: { name: true } },
      majors: { select: { isMinor: true, major: { select: { id: true, name: true } } }, orderBy: { major: { name: "asc" } } },
    },
  }),
);

export type ProfileUser = NonNullable<Awaited<ReturnType<typeof profileUser>>>;

export type ProfileData = {
  user: ProfileUser;
  isSelf: boolean;
  majors: string[];
  minors: string[];
  roleGroups: ProfileRoleGroup[];
  experiences: { id: string; title: string; organization: string; location: string | null; startDate: Date; endDate: Date | null; description: string | null; source: ExperienceSource }[];
  educations: { id: string; school: string; degree: string | null; field: string | null; startYear: number | null; endYear: number | null; description: string | null }[];
  projects: ProfileProject[];
  clubs: (ProfileClub & { roleLabel: string | null })[];
  activity: ActivityItem[];
  activityHasMore: boolean;
  service: ProfileService;
};

async function toProject(
  viewer: Actor,
  p: { id: string; title: string; descriptionHtml: string | null; url: string | null; startDate: Date | null; endDate: Date | null; createdAt: Date; roleAssignmentId: string | null; club: ProfileClub | null; files: { file: Parameters<typeof canViewFile>[1] & ProfileFile & { isFolder: boolean } }[] },
): Promise<ProfileProject> {
  const files: ProfileFile[] = [];
  let hidden = 0;
  for (const { file } of p.files) {
    if (file.isFolder) continue;
    if (await canViewFile(viewer, file)) files.push({ id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes });
    else hidden++;
  }
  return { id: p.id, title: p.title, descriptionHtml: p.descriptionHtml, url: p.url, startDate: p.startDate, endDate: p.endDate, createdAt: p.createdAt, roleAssignmentId: p.roleAssignmentId, club: p.club, files, hiddenFiles: hidden };
}

/**
 * Everything the profile page shows, filtered for this viewer: files they
 * may open, founding clubs only for the person and admins, check-ins only
 * where attendance privacy allows, and service hours as a total (which
 * events only for the person and admins).
 */
export async function loadProfile(user: ProfileUser, viewer: Actor, opts: { activityTake?: number } = {}): Promise<ProfileData> {
  const isSelf = viewer.id === user.id;
  const seesAll = isSelf || isAdmin(viewer);
  const clubVisible = (c: { status: ClubStatus } | null) => !c || seesAll || LISTED.includes(c.status);

  const [assignments, experiences, educations, looseProjects, memberships, activity, service] = await Promise.all([
    db.roleAssignment.findMany({
      where: { userId: user.id, role: { not: "MEMBER" } },
      orderBy: { startedAt: "desc" },
      include: {
        club: { select: clubSelect },
        position: { select: { name: true } },
        viaClub: { select: { name: true, slug: true, status: true } },
        projects: { orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], include: projectInclude },
      },
    }),
    db.experience.findMany({ where: { userId: user.id }, orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { startDate: "desc" }] }),
    db.education.findMany({ where: { userId: user.id }, orderBy: [{ endYear: { sort: "desc", nulls: "first" } }, { startYear: "desc" }] }),
    db.project.findMany({ where: { userId: user.id, roleAssignmentId: null }, orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], include: projectInclude }),
    db.membership.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: { club: { select: clubSelect } },
      orderBy: { club: { name: "asc" } },
    }),
    profileActivity(user, viewer, { take: opts.activityTake }),
    serviceSummary(user.id),
  ]);

  // ── Club roles, grouped by club (current clubs first, then most recent). ──
  const groups = new Map<string, ProfileRoleGroup>();
  for (const a of assignments) {
    if (!clubVisible(a.club)) continue;
    const role: ProfileRole = {
      id: a.id,
      title: a.position?.name ?? ROLE_LABEL[a.role],
      role: a.role,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
      endReason: a.endReason,
      viaClub: a.viaClub && clubVisible(a.viaClub) ? { name: a.viaClub.name, slug: a.viaClub.slug } : null,
      projects: await Promise.all(a.projects.map((p) => toProject(viewer, p))),
    };
    const g = groups.get(a.clubId);
    if (g) g.roles.push(role);
    else groups.set(a.clubId, { club: a.club, current: false, start: a.startedAt, end: a.endedAt, roles: [role] });
  }
  for (const g of groups.values()) {
    g.current = g.roles.some((r) => !r.endedAt);
    g.start = new Date(Math.min(...g.roles.map((r) => r.startedAt.getTime())));
    g.end = g.current ? null : new Date(Math.max(...g.roles.map((r) => r.endedAt!.getTime())));
    // Current roles first, then newest.
    g.roles.sort((a, b) => Number(Boolean(a.endedAt)) - Number(Boolean(b.endedAt)) || b.startedAt.getTime() - a.startedAt.getTime());
  }
  const roleGroups = [...groups.values()].sort(
    (a, b) => Number(b.current) - Number(a.current) || (b.end ?? new Date(8.64e15)).getTime() - (a.end ?? new Date(8.64e15)).getTime() || b.start.getTime() - a.start.getTime(),
  );

  // ── Current clubs, with the highest role held in each. ──
  const topRole = new Map<string, { rank: number; label: string }>();
  for (const a of assignments) {
    if (a.endedAt) continue;
    const rank = ROLE_RANK[a.role];
    const cur = topRole.get(a.clubId);
    if (!cur || rank > cur.rank) topRole.set(a.clubId, { rank, label: a.position?.name ?? ROLE_LABEL[a.role] });
  }
  const clubs = memberships.filter((m) => clubVisible(m.club)).map((m) => ({ ...m.club, roleLabel: topRole.get(m.clubId)?.label ?? null }));
  // Advisors hold roles without a student membership row sometimes; list those clubs too.
  for (const a of assignments) {
    if (a.endedAt || clubs.some((c) => c.id === a.clubId) || !clubVisible(a.club)) continue;
    clubs.push({ ...a.club, roleLabel: topRole.get(a.clubId)?.label ?? null });
  }
  clubs.sort((a, b) => a.name.localeCompare(b.name));

  return {
    user,
    isSelf,
    majors: user.majors.filter((m) => !m.isMinor).map((m) => m.major.name),
    minors: user.majors.filter((m) => m.isMinor).map((m) => m.major.name),
    roleGroups,
    experiences,
    educations,
    projects: await Promise.all(looseProjects.filter((p) => clubVisible(p.club)).map((p) => toProject(viewer, p))),
    clubs,
    activity: activity.items,
    activityHasMore: activity.hasMore,
    service: { minutes: service.minutes, events: service.events, entries: seesAll ? service.entries : null },
  };
}

// ─── Settings ────────────────────────────────────────────────────────────────

export type MajorOption = { id: string; name: string; college: string | null };

export const majorOptions = cache(async (): Promise<MajorOption[]> => {
  const rows = await db.major.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, college: { select: { shortName: true, name: true } } } });
  return rows.map((m) => ({ id: m.id, name: m.name, college: m.college?.name ?? null }));
});

export type SettingsUser = {
  id: string;
  name: string;
  handle: string;
  email: string;
  kind: UserKind;
  status: UserStatus;
  pronouns: string | null;
  headline: string | null;
  aboutHtml: string | null;
  jobTitle: string | null;
  classYear: number | null;
  graduatedAt: Date | null;
  linkedinUrl: string | null;
  avatarUrl: string | null;
  avatarColor: string;
  emailNotifications: boolean;
  hasMobileApp: boolean;
  appPromptDismissedAt: Date | null;
  majors: { majorId: string; name: string; isMinor: boolean }[];
};

export async function settingsUser(userId: string): Promise<SettingsUser | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      handle: true,
      email: true,
      kind: true,
      status: true,
      pronouns: true,
      headline: true,
      aboutHtml: true,
      jobTitle: true,
      classYear: true,
      graduatedAt: true,
      linkedinUrl: true,
      avatarUrl: true,
      avatarColor: true,
      emailNotifications: true,
      hasMobileApp: true,
      appPromptDismissedAt: true,
      majors: { select: { majorId: true, isMinor: true, major: { select: { name: true } } }, orderBy: { major: { name: "asc" } } },
    },
  });
  if (!u) return null;
  return { ...u, majors: u.majors.map((m) => ({ majorId: m.majorId, name: m.major.name, isMinor: m.isMinor })) };
}

export type MyRoleOption = { id: string; label: string; clubId: string; clubName: string; current: boolean; startedAt: Date; endedAt: Date | null };

/** Your own club roles (current and past), for linking a project to one. */
export async function myRoleOptions(userId: string): Promise<MyRoleOption[]> {
  const rows = await db.roleAssignment.findMany({
    where: { userId, role: { not: "MEMBER" } },
    orderBy: [{ endedAt: { sort: "desc", nulls: "first" } }, { startedAt: "desc" }],
    include: { club: { select: { id: true, name: true } }, position: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.position?.name ?? ROLE_LABEL[r.role],
    clubId: r.club.id,
    clubName: r.club.name,
    current: !r.endedAt,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  }));
}

export type MyProject = {
  id: string;
  title: string;
  descriptionHtml: string | null;
  url: string | null;
  startDate: Date | null;
  endDate: Date | null;
  roleAssignmentId: string | null;
  clubName: string | null;
  files: { id: string; name: string; mimeType: string | null }[];
};

export async function myProjects(userId: string): Promise<MyProject[]> {
  const rows = await db.project.findMany({
    where: { userId },
    orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    include: { club: { select: { name: true } }, files: { include: { file: { select: { id: true, name: true, mimeType: true, isFolder: true, trashedAt: true } } } } },
  });
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    url: p.url,
    startDate: p.startDate,
    endDate: p.endDate,
    roleAssignmentId: p.roleAssignmentId,
    clubName: p.club?.name ?? null,
    files: p.files.filter((f) => !f.file.isFolder && !f.file.trashedAt).map((f) => ({ id: f.file.id, name: f.file.name, mimeType: f.file.mimeType })),
  }));
}
