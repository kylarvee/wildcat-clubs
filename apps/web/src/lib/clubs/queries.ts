import "server-only";
import { cache } from "react";
import type { Prisma, Visibility } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { isAdmin, ROLE_RANK, type ClubAccess } from "@/lib/authz";
import { canViewFile } from "@/lib/domain/files";
import { clubListMetrics, type ClubListMetrics } from "@/lib/metrics";
import { CLUB_SCOPE_LABEL, CLUB_TYPE_LABEL } from "@/components/clubs/labels";
import type { ClubListParams } from "@/components/clubs/list-params";

/**
 * Read-only queries for the public site: landing page, clubs list, club page.
 * Nothing here writes (writes go through lib/domain). Every derived number —
 * members, retention, rating, activity — comes from lib/metrics so the list,
 * the club page and dashboards agree.
 */

// ─── Club rows for cards and the list ─────────────────────────────────────────

const clubCardSelect = {
  id: true,
  slug: true,
  name: true,
  type: true,
  status: true,
  scope: true,
  shortDescription: true,
  logoUrl: true,
  logoColor: true,
  joinPolicy: true,
  createdAt: true,
  focusOther: true,
  college: { select: { id: true, name: true, shortName: true, slug: true } },
  department: { select: { name: true } },
  focusMajor: { select: { name: true } },
} satisfies Prisma.ClubSelect;

type ClubCardRow = Prisma.ClubGetPayload<{ select: typeof clubCardSelect }>;

export type ClubMetricsView = Omit<ClubListMetrics, "clubId">;

export type ClubListItem = {
  id: string;
  slug: string;
  name: string;
  type: ClubCardRow["type"];
  status: ClubCardRow["status"];
  scope: ClubCardRow["scope"];
  shortDescription: string;
  logoUrl: string | null;
  logoColor: string;
  joinPolicy: ClubCardRow["joinPolicy"];
  createdAt: Date;
  college: { id: string; name: string; shortName: string; slug: string } | null;
  departmentName: string | null;
  /** Focus major or discipline, as typed. */
  focus: string | null;
  /** "College of Science", "University-wide", … */
  placement: string;
  metrics: ClubMetricsView;
  /** False until the metrics layer has numbers for this club (badges stay hidden rather than guess). */
  hasMetrics: boolean;
};

const EMPTY_METRICS: ClubMetricsView = {
  registeredMembers: 0,
  activeMembers: 0,
  retentionRate: null,
  avgRating: null,
  reviewCount: 0,
  activityScore: 0,
  isActive: false,
  inPilot: false,
};

function toItem(c: ClubCardRow, m: ClubListMetrics | undefined): ClubListItem {
  const { clubId: _ignored, ...metrics } = m ?? { clubId: c.id, ...EMPTY_METRICS };
  void _ignored;
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    type: c.type,
    status: c.status,
    scope: c.scope,
    shortDescription: c.shortDescription,
    logoUrl: c.logoUrl,
    logoColor: c.logoColor,
    joinPolicy: c.joinPolicy,
    createdAt: c.createdAt,
    college: c.college,
    departmentName: c.department?.name ?? null,
    focus: c.focusMajor?.name ?? c.focusOther ?? null,
    placement: c.scope === "COLLEGE" && c.college ? c.college.name : CLUB_SCOPE_LABEL[c.scope],
    metrics,
    hasMetrics: Boolean(m),
  };
}

/** Lowercase, accent-free text for forgiving search ("café" matches "cafe"). */
function fold(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function matchesSearch(item: ClubListItem, q: string) {
  if (!q) return true;
  const hay = fold(
    [item.name, item.shortDescription, item.focus, item.college?.name, item.college?.shortName, item.departmentName, CLUB_TYPE_LABEL[item.type], item.placement]
      .filter(Boolean)
      .join(" "),
  );
  return fold(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => hay.includes(token));
}

type Comparable = string | number | null;

function sortKey(item: ClubListItem, sort: ClubListParams["sort"]): Comparable {
  switch (sort) {
    case "name":
      return item.name;
    case "rating":
      return item.metrics.reviewCount > 0 ? item.metrics.avgRating : null;
    case "members":
      return item.metrics.activeMembers;
    case "retention":
      return item.metrics.retentionRate;
    case "activity":
      return item.metrics.activityScore;
    case "college":
      // Clubs without a college sort after every college, grouped by scope.
      return item.college ? item.college.name : `~${CLUB_SCOPE_LABEL[item.scope]}`;
    case "major":
      return item.focus;
    case "type":
      return CLUB_TYPE_LABEL[item.type];
  }
}

function compare(a: Comparable, b: Comparable, dir: 1 | -1) {
  // Missing values always go last, whichever way the list is sorted.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * dir;
  return String(a).localeCompare(String(b), "en", { sensitivity: "base" }) * dir;
}

export function sortClubs(items: ClubListItem[], sort: ClubListParams["sort"], order: "asc" | "desc") {
  const dir = order === "asc" ? 1 : -1;
  return [...items].sort((a, b) => compare(sortKey(a, sort), sortKey(b, sort), dir) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

// ─── Viewer state (register / subscribe buttons) ──────────────────────────────

export type ViewerClubState = {
  member: boolean;
  pending: boolean;
  subscribed: boolean;
  /** Ambassador and up (or advisor) in this club. */
  leader: boolean;
};

export const NO_CLUB_STATE: ViewerClubState = { member: false, pending: false, subscribed: false, leader: false };

/**
 * The viewer's membership, subscription and leadership in every club, in three
 * queries total (so a grid of cards never asks per club). Display only —
 * permission checks happen in lib/authz when an action runs.
 */
export const viewerClubStates = cache(async (userId: string): Promise<Map<string, ViewerClubState>> => {
  const [memberships, subs, roles] = await Promise.all([
    db.membership.findMany({ where: { userId, status: { in: ["ACTIVE", "PENDING"] } }, select: { clubId: true, status: true } }),
    db.calendarSubscription.findMany({ where: { userId }, select: { clubId: true } }),
    db.roleAssignment.findMany({ where: { userId, endedAt: null }, select: { clubId: true, role: true } }),
  ]);
  const map = new Map<string, ViewerClubState>();
  const at = (clubId: string) => {
    let s = map.get(clubId);
    if (!s) map.set(clubId, (s = { ...NO_CLUB_STATE }));
    return s;
  };
  for (const m of memberships) {
    if (m.status === "ACTIVE") at(m.clubId).member = true;
    else at(m.clubId).pending = true;
  }
  for (const s of subs) at(s.clubId).subscribed = true;
  for (const r of roles) {
    const s = at(r.clubId);
    s.member = true;
    s.pending = false;
    if (ROLE_RANK[r.role] >= 1) s.leader = true;
  }
  return map;
});

/** Should a "get the mobile app" prompt appear after this person registers? */
export async function shouldPromptForApp(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { hasMobileApp: true, appPromptDismissedAt: true } });
  return Boolean(u && !u.hasMobileApp && !u.appPromptDismissedAt);
}

// ─── Clubs list ───────────────────────────────────────────────────────────────

export type ClubListResult = {
  items: ClubListItem[];
  /** Clubs in this listing before search and filters. */
  total: number;
  archivedCount: number;
  colleges: { id: string; name: string; shortName: string; slug: string }[];
  states: Map<string, ViewerClubState>;
};

/** The clubs list: approved clubs (or retired ones in the archive), filtered and sorted per the URL. */
export async function listClubs(params: ClubListParams, viewer: Actor | null): Promise<ClubListResult> {
  const [clubs, colleges, archivedCount, states] = await Promise.all([
    db.club.findMany({ where: { status: params.archived ? "RETIRED" : "APPROVED" }, select: clubCardSelect }),
    db.college.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, shortName: true, slug: true } }),
    db.club.count({ where: { status: "RETIRED" } }),
    viewer ? viewerClubStates(viewer.id) : Promise.resolve(new Map<string, ViewerClubState>()),
  ]);
  const metrics = clubs.length ? await clubListMetrics(clubs.map((c) => c.id)) : new Map<string, ClubListMetrics>();
  const all = clubs.map((c) => toItem(c, metrics.get(c.id)));

  const filtered = all.filter((c) => {
    if (params.type && c.type !== params.type) return false;
    if (params.scope && c.scope !== params.scope) return false;
    if (params.college && c.college?.slug !== params.college) return false;
    if (params.status === "active" && !c.metrics.isActive) return false;
    if (params.status === "pilot" && !c.metrics.inPilot) return false;
    if (params.status === "inactive" && c.metrics.isActive) return false;
    if (params.mine) {
      const s = states.get(c.id);
      if (!s || !(s.member || s.pending || s.leader)) return false;
    }
    return matchesSearch(c, params.q);
  });

  return { items: sortClubs(filtered, params.sort, params.dir), total: all.length, archivedCount, colleges, states };
}

/** Clubs to feature on the landing page: the most active first, topped up with the rest. */
export async function featuredClubs(limit = 6): Promise<ClubListItem[]> {
  const clubs = await db.club.findMany({ where: { status: "APPROVED", type: { not: "COLLEGE_AMBASSADORS" } }, select: clubCardSelect });
  if (clubs.length === 0) return [];
  const metrics = await clubListMetrics(clubs.map((c) => c.id));
  const items = clubs.map((c) => toItem(c, metrics.get(c.id)));
  const score = (c: ClubListItem) => (c.metrics.isActive ? 1_000_000 : 0) + c.metrics.activityScore * 1000 + c.metrics.activeMembers;
  // Logos and descriptions make the landing page — prefer clubs that filled theirs in.
  const finished = (c: ClubListItem) => (c.shortDescription ? 1 : 0);
  return items.sort((a, b) => finished(b) - finished(a) || score(b) - score(a) || a.name.localeCompare(b.name)).slice(0, limit);
}

// ─── Events ───────────────────────────────────────────────────────────────────

const occurrenceSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  roomOverride: true,
  event: {
    select: {
      id: true,
      title: true,
      kind: true,
      allDay: true,
      visibility: true,
      locationType: true,
      room: true,
      address: true,
      virtualUrl: true,
      building: { select: { name: true, code: true } },
      club: { select: { id: true, name: true, slug: true, logoUrl: true, logoColor: true } },
      cohosts: { where: { status: "APPROVED" }, select: { club: { select: { id: true, name: true, slug: true } } } },
    },
  },
} satisfies Prisma.EventOccurrenceSelect;

type OccurrenceRow = Prisma.EventOccurrenceGetPayload<{ select: typeof occurrenceSelect }>;

export type UpcomingEvent = {
  occurrenceId: string;
  eventId: string;
  title: string;
  kind: OccurrenceRow["event"]["kind"];
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string;
  isVirtual: boolean;
  host: { id: string; name: string; slug: string; logoUrl: string | null; logoColor: string } | null;
  cohosts: { id: string; name: string; slug: string }[];
  happeningNow: boolean;
};

function locationLabel(o: OccurrenceRow): { label: string; virtual: boolean } {
  const e = o.event;
  const room = o.roomOverride ?? e.room;
  switch (e.locationType) {
    case "CAMPUS":
      return { label: [e.building?.name ?? "On campus", room].filter(Boolean).join(" · "), virtual: false };
    case "ADDRESS":
      return { label: e.address || "Off campus", virtual: false };
    case "VIRTUAL":
      return { label: "Online", virtual: true };
    default:
      return { label: "Location to be announced", virtual: false };
  }
}

function toUpcoming(o: OccurrenceRow, now: Date): UpcomingEvent {
  const loc = locationLabel(o);
  return {
    occurrenceId: o.id,
    eventId: o.event.id,
    title: o.event.title,
    kind: o.event.kind,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    allDay: o.event.allDay,
    location: loc.label,
    isVirtual: loc.virtual,
    host: o.event.club,
    cohosts: o.event.cohosts.map((c) => c.club),
    happeningNow: o.startsAt <= now && now <= o.endsAt,
  };
}

/** Public events (anyone may see them) in the next `days` days, across every approved club and the university. */
export async function upcomingPublicEvents({ days = 14, limit = 6 }: { days?: number; limit?: number } = {}): Promise<UpcomingEvent[]> {
  const now = new Date();
  const until = new Date(now.getTime() + days * 86_400_000);
  const rows = await db.eventOccurrence.findMany({
    where: {
      status: "SCHEDULED",
      endsAt: { gte: now },
      startsAt: { lte: until },
      event: { status: "SCHEDULED", visibility: "PUBLIC", OR: [{ clubId: null }, { club: { status: "APPROVED" } }] },
    },
    orderBy: { startsAt: "asc" },
    take: limit,
    select: occurrenceSelect,
  });
  return rows.map((o) => toUpcoming(o, now));
}

/** Visibility levels this viewer may see on a club's events. */
function visibleLevels(viewer: Actor | null, access: ClubAccess | null): Visibility[] {
  const levels: Visibility[] = ["PUBLIC"];
  if (viewer) levels.push("UNIVERSITY");
  if (access?.isMember || access?.isLeader) levels.push("MEMBERS");
  return levels;
}

/** A club's next events (hosted or co-hosted), filtered to what the viewer may see. */
export async function clubUpcomingEvents(clubId: string, viewer: Actor | null, access: ClubAccess | null, limit = 5): Promise<UpcomingEvent[]> {
  const now = new Date();
  const rows = await db.eventOccurrence.findMany({
    where: {
      status: "SCHEDULED",
      endsAt: { gte: now },
      event: {
        status: "SCHEDULED",
        visibility: { in: visibleLevels(viewer, access) },
        OR: [{ clubId }, { cohosts: { some: { clubId, status: "APPROVED" } } }],
      },
    },
    orderBy: { startsAt: "asc" },
    take: limit,
    select: occurrenceSelect,
  });
  return rows.map((o) => toUpcoming(o, now));
}

// ─── Club page: resources and announcements ──────────────────────────────────

const fileLikeSelect = { id: true, clubId: true, ownerId: true, parentId: true, visibility: true, createdById: true, trashedAt: true } as const;

export type ClubResourceFile = { id: string; name: string; mimeType: string | null; sizeBytes: number | null; updatedAt: Date };
export type ClubResourceDoc = {
  id: string;
  kind: "CONSTITUTION" | "BYLAWS" | "OTHER";
  title: string;
  version: number;
  adoptedAt: Date;
  contentHtml: string | null;
  /** Set only when the viewer may open the attached file. */
  fileId: string | null;
  /** True when a file exists but this viewer can't open it. */
  fileLocked: boolean;
};

/** Featured club files the viewer may open, plus the club's active governing documents. */
export async function clubResources(clubId: string, viewer: Actor | null): Promise<{ files: ClubResourceFile[]; documents: ClubResourceDoc[] }> {
  const [files, docs] = await Promise.all([
    db.fileItem.findMany({
      where: { clubId, featured: true, trashedAt: null, isFolder: false },
      orderBy: { name: "asc" },
      take: 24,
      select: { ...fileLikeSelect, name: true, mimeType: true, sizeBytes: true, updatedAt: true },
    }),
    db.clubDocument.findMany({
      where: { clubId, status: "ACTIVE" },
      orderBy: [{ kind: "asc" }, { version: "desc" }],
      select: { id: true, kind: true, title: true, version: true, contentHtml: true, createdAt: true, decidedAt: true, file: { select: fileLikeSelect } },
    }),
  ]);

  // Featured lists are short, so a permission check per file is cheap.
  const visible = await Promise.all(files.map(async (f) => ((await canViewFile(viewer, f)) ? f : null)));
  const documents = await Promise.all(
    docs.map(async (d): Promise<ClubResourceDoc> => {
      const canOpen = d.file && !d.file.trashedAt ? await canViewFile(viewer, d.file) : false;
      return {
        id: d.id,
        kind: d.kind,
        title: d.title,
        version: d.version,
        adoptedAt: d.decidedAt ?? d.createdAt,
        contentHtml: d.contentHtml,
        fileId: canOpen && d.file ? d.file.id : null,
        fileLocked: Boolean(d.file) && !canOpen,
      };
    }),
  );
  return {
    files: visible.filter((f): f is NonNullable<typeof f> => f !== null).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, updatedAt: f.updatedAt })),
    documents,
  };
}

/** How many announcements this viewer can see (so the club page can skip an empty section). */
export async function visibleAnnouncementCount(clubId: string, access: ClubAccess | null): Promise<number> {
  const audiences: ("PUBLIC" | "MEMBERS" | "LEADERS")[] = ["PUBLIC"];
  if (access?.isMember || access?.isLeader) audiences.push("MEMBERS");
  if (access?.isLeader) audiences.push("LEADERS");
  return db.announcement.count({ where: { clubId, audience: { in: audiences } } });
}

/** Single-club metrics row (the same numbers the clubs list shows). Cached per request: the hero and stats share it. */
export const clubMetricsFor = cache(async (clubId: string): Promise<ClubMetricsView & { hasMetrics: boolean }> => {
  const m = (await clubListMetrics([clubId])).get(clubId);
  if (!m) return { ...EMPTY_METRICS, hasMetrics: false };
  const { clubId: _ignored, ...rest } = m;
  void _ignored;
  return { ...rest, hasMetrics: true };
});

// ─── Reviews ──────────────────────────────────────────────────────────────────

export type ReviewView = {
  id: string;
  rating: number;
  body: string | null;
  createdAt: Date;
  updatedAt: Date;
  hidden: boolean;
  hiddenReason: string | null;
  flagCount: number;
  flaggedByViewer: boolean;
  mine: boolean;
  author: { name: string; handle: string; avatarUrl: string | null; avatarColor: string; alumni: boolean };
};

export type ClubReviewsData = {
  reviews: ReviewView[];
  /** Over visible (not hidden) reviews. */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  visibleCount: number;
  average: number | null;
  mine: ReviewView | null;
};

/**
 * Reviews for a club page. Hidden reviews are left out except for admins (who
 * moderate them) and the author (who sees why theirs was hidden).
 */
export async function clubReviewsData(clubId: string, viewer: Actor | null): Promise<ClubReviewsData> {
  const admin = isAdmin(viewer);
  const where: Prisma.ReviewWhereInput = admin ? { clubId } : viewer ? { clubId, OR: [{ hiddenAt: null }, { userId: viewer.id }] } : { clubId, hiddenAt: null };
  const [rows, metrics] = await Promise.all([
    db.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        rating: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        hiddenAt: true,
        hiddenReason: true,
        userId: true,
        user: { select: { name: true, handle: true, avatarUrl: true, avatarColor: true, status: true } },
        _count: { select: { flags: true } },
        flags: { where: { userId: viewer?.id ?? "" }, select: { id: true } },
      },
    }),
    clubListMetrics([clubId]),
  ]);

  const reviews: ReviewView[] = rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    body: r.body,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    hidden: Boolean(r.hiddenAt),
    hiddenReason: r.hiddenReason,
    flagCount: r._count.flags,
    flaggedByViewer: r.flags.length > 0,
    mine: viewer?.id === r.userId,
    author: { name: r.user.name, handle: r.user.handle, avatarUrl: r.user.avatarUrl, avatarColor: r.user.avatarColor, alumni: r.user.status === "ALUMNI" },
  }));

  const distribution: ClubReviewsData["distribution"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let count = 0;
  for (const r of reviews) {
    if (r.hidden) continue;
    const k = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
    distribution[k]++;
    sum += r.rating;
    count++;
  }
  // The metrics layer owns the headline rating; fall back to the visible reviews before it has data.
  const m = metrics.get(clubId);
  const average = m && m.reviewCount > 0 && m.avgRating != null ? m.avgRating : count ? sum / count : null;

  return { reviews, distribution, visibleCount: count, average, mine: reviews.find((r) => r.mine) ?? null };
}
