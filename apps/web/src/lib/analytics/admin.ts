import "server-only";
import type { ClubStatus, ClubType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { adminScope, ROLE_LABEL, type AdminScope } from "@/lib/authz";
import { clubsAtRisk, type AtRiskClub } from "@/lib/metrics";
import { actionPhrase, BUSY_ACTIONS } from "@/lib/lake/actions";
import { ORPHAN_REQUESTS_SOURCE, STAFFING_SOURCE } from "@/lib/staffing/rules";
import { fundingTasks } from "@/lib/funding/review";
import { listOffices, unstaffedOfficeIds, type OfficeInfo } from "@/lib/offices";
import { FUNDING_TASK_SOURCES, UMBRELLA_TASK_SOURCES } from "@/lib/offices/rules";

/**
 * Read side of the admin overview (/admin): what's waiting on an office,
 * which clubs are at risk of going inactive, club counts and recent platform
 * activity. Activity numbers come from lib/metrics; nothing here writes.
 * Reports (complaints) only ever appear as a count — never their content.
 */

// ─── Waiting on an office ────────────────────────────────────────────────────

/** The admin tools that list queue items themselves, named as in the admin menu: Club approvals, Event reviews, Funding, Tests, Reports, Review moderation. */
export type AdminSection = "clubs" | "events" | "funding" | "tests" | "complaints" | "reviews";

export type QueueRow = {
  key: string;
  label: string;
  /** What the row holds, shown while it's empty. */
  detail: string;
  /** Where it's worked. */
  href: string;
  count: number;
  oldest: Date | null;
  /** Reports and reviews (possible harm to students): red on the dashboard. */
  urgent: boolean;
  /** The admin tool whose side-nav count includes it; null when only Tasks lists it. */
  section: AdminSection | null;
};

export type OfficeQueue = { rows: QueueRow[]; total: number; bySection: Record<AdminSection, number> };

/**
 * What waits on an office, in the order staff work it. Each row is open
 * ADMINS tasks with these sourceTypes; `only` narrows a row to some of them
 * (funding's on-time and late rows split the same tasks by lib/funding/review's
 * rule, with each office's own review time). `whenAny` rows are left out while
 * they're empty.
 */
const QUEUES: {
  key: string;
  sources: string[];
  label: string;
  detail: string;
  href: string;
  section: AdminSection | null;
  urgent?: true;
  only?: (now: Date, reviewDays: number) => ReturnType<typeof fundingTasks>;
  whenAny?: true;
}[] = [
  { key: "club", sources: ["club"], label: "Club submissions", detail: "New clubs asking for recognition", href: "/admin/clubs", section: "clubs" },
  // The other engineer's event review (lib/domain/events): flagged events wait here before they're published.
  { key: "eventReview", sources: ["eventReview"], label: "Events to review", detail: "Events with something flagged, waiting for the office", href: "/admin/events", section: "events" },
  { key: "departmentRequest", sources: ["departmentRequest"], label: "Department requests", detail: "Departments to add for Sponsored clubs", href: "/admin/clubs?tab=departments", section: "clubs" },
  { key: "clubDocument", sources: ["clubDocument"], label: "Custom constitutions & bylaws", detail: "Uploaded documents to approve", href: "/admin/clubs?tab=documents", section: "clubs" },
  // No admin list shows these; each task links to its club's Google account section.
  { key: "googleAccount", sources: ["googleAccount"], label: "Club Google accounts to verify", detail: "Confirm a club's own Workspace account before Google sync runs as it", href: "/tasks?kind=APPROVAL", section: null },
  // lib/domain/staffing: each task links to the club's org chart or settings.
  { key: "clubStaffing", sources: [STAFFING_SOURCE], label: "Clubs missing a leader", detail: "Approved clubs that just lost their last President, advisor or member who approves join requests", href: "/tasks?kind=APPROVAL", section: null },
  { key: "orphanRequests", sources: [ORPHAN_REQUESTS_SOURCE], label: "Join requests nobody can approve", detail: "Requests waiting over a week where nobody holds the Members permission", href: "/tasks?kind=APPROVAL", section: null },
  // Funding (lib/funding/review): requests waiting longer than the office's review time and invoices past due are urgent rows of their own.
  // The "Funding follow-ups" job reminds the admins about each once.
  { key: "fundingLate", sources: ["funding"], only: (now, days) => fundingTasks("review", true, now, days), label: "Funding requests past review time", detail: "Requests waiting longer than the office's review time", href: "/admin/funding", section: "funding", urgent: true, whenAny: true },
  { key: "funding", sources: ["funding"], only: (now, days) => fundingTasks("review", false, now, days), label: "Funding requests", detail: "Requests waiting for a decision", href: "/admin/funding", section: "funding" },
  { key: "invoiceLate", sources: ["invoice"], only: (now, days) => fundingTasks("invoice", true, now, days), label: "Invoices past due", detail: "Approved funding not yet through the finance system by its due date", href: "/admin/funding?queue=approved", section: "funding", urgent: true, whenAny: true },
  { key: "invoice", sources: ["invoice"], only: (now, days) => fundingTasks("invoice", false, now, days), label: "Invoices to process", detail: "Approved funding to push through", href: "/admin/funding?queue=approved", section: "funding" },
  { key: "testAttempt", sources: ["testAttempt"], label: "Test answers to grade", detail: "Written answers on the office's tests", href: "/admin/tests", section: "tests" },
  { key: "reviews", sources: ["reviewBombing", "reviewFlag"], label: "Reviews to check", detail: "Possible review bombing and flagged reviews", href: "/admin/reviews", section: "reviews", urgent: true },
  // One task per new report, with no content: report details never leave the Reports tool.
  { key: "complaint", sources: ["complaint"], label: "New reports", detail: "Open them in Reports", href: "/admin/complaints", section: "complaints", urgent: true },
];

/**
 * Whose queue: some offices' (`offices`, where null is the umbrella), or
 * every office's. Built by queueScopeFor, which knows who's asking.
 */
export type QueueScope = { offices: (string | null)[] } | { offices: "all" };

/** A queue filter for umbrella admins: WSUSA (the default), one office, or all of them. */
export type QueueFilter = { key: string; label: string };

export const ALL_OFFICES = "all";

/**
 * Which queue a person sees, and the filters they may switch between.
 *  - Platform admins (the umbrella's staff): WSUSA's queue by default, which
 *    holds the umbrella's tasks and those of any office nobody staffs (so
 *    nothing goes unseen); `filter` picks one office by key, or "all".
 *  - Office staff: their offices' queue, with no filter.
 *  - Anyone else: an empty queue.
 * `name` says whose it is in "Waiting on …".
 */
export async function queueScopeFor(actor: Actor | null, filter?: string | null): Promise<QueueChoice> {
  return queueScopeOf(adminScope(actor), filter);
}

export type QueueChoice = { scope: QueueScope; filter: string | null; name: string; filters: QueueFilter[]; offices: OfficeInfo[] };

/** queueScopeFor for an admin scope already in hand (the digest job's recipients). */
export async function queueScopeOf(s: AdminScope, filter?: string | null): Promise<QueueChoice> {
  const offices = await listOffices();
  const umbrella = offices[0];
  if (s.all) {
    const filters: QueueFilter[] = [...offices.map((o) => ({ key: o.key, label: o.shortName })), { key: ALL_OFFICES, label: "All offices" }];
    if (filter === ALL_OFFICES) return { scope: { offices: "all" }, filter: ALL_OFFICES, name: "every office", filters, offices };
    const picked = offices.find((o) => o.key === filter && !o.umbrella);
    if (picked) return { scope: { offices: [picked.id] }, filter: picked.key, name: picked.shortName, filters, offices };
    return { scope: { offices: [null, ...(await unstaffedOfficeIds())] }, filter: umbrella.key, name: umbrella.shortName, filters, offices };
  }
  const mine = offices.filter((o) => !o.umbrella && s.officeIds.includes(o.id));
  return { scope: { offices: mine.map((o) => o.id) }, filter: null, name: mine.length === 1 ? mine[0].shortName : mine.length ? "your offices" : "you", filters: [], offices };
}

/** The person's default queue (no filter): what the dashboard, the admin nav and the digest show them. */
export async function queueFor(actor: Actor | null, now: Date = new Date()): Promise<OfficeQueue & { name: string }> {
  const { scope, name } = await queueScopeFor(actor);
  return { ...(await officeQueue(scope, now)), name };
}

/**
 * The one answer to "what's waiting on this office": every open ADMINS task
 * for the offices in scope (Task.officeId, lib/domain/tasks routes them),
 * grouped by what it is and where it's handled. The dashboard's queue, the
 * Overview's "Waiting on …", the admin side nav's counts and the daily digest
 * all read it, so they always agree. "Past review time" uses each office's
 * own review days. Tasks nobody grouped yet land in "Other tasks".
 */
export async function officeQueue(scope: QueueScope, now: Date = new Date()): Promise<OfficeQueue> {
  const all = await listOffices();
  const inScope = scope.offices === "all" ? all : all.filter((o) => (scope.offices as (string | null)[]).includes(o.umbrella ? null : o.id));
  const offices = inScope.map((o) => ({ officeId: o.umbrella ? null : o.id, reviewDays: o.reviewDays }));
  const open: Prisma.TaskWhereInput = { status: "OPEN", assigneeType: "ADMINS" };
  const where: Prisma.TaskWhereInput = scope.offices === "all" ? open : offices.length ? { ...open, OR: offices.map((o) => ({ officeId: o.officeId })) } : { id: { in: [] } };
  const [groups, narrowed] = await Promise.all([
    db.task.groupBy({
      by: ["sourceType"],
      where,
      _count: { _all: true },
      _min: { createdAt: true },
    }),
    // Rows that count only some of their sources' tasks, by each office's own review time.
    Promise.all(
      QUEUES.map((q) =>
        q.only
          ? db.task.aggregate({ where: offices.length ? { AND: [open, { OR: offices.map((o) => ({ officeId: o.officeId, ...q.only!(now, o.reviewDays) })) }] } : { id: { in: [] } }, _count: { _all: true }, _min: { createdAt: true } })
          : null,
      ),
    ),
  ]);
  const known = new Set(QUEUES.flatMap((q) => q.sources));
  const sum = (match: (sourceType: string | null) => boolean) => {
    const gs = groups.filter((g) => match(g.sourceType));
    const oldest = gs.map((g) => g._min.createdAt).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    return { count: gs.reduce((n, g) => n + g._count._all, 0), oldest };
  };
  // Rows no office in scope can ever hold are left out: WSUSA's platform-wide work, and funding where nobody in scope decides it.
  const umbrellaInScope = offices.some((o) => o.officeId === null);
  const decidesInScope = umbrellaInScope || inScope.some((o) => o.decidesFunding);
  const possible = (q: (typeof QUEUES)[number]) =>
    !q.sources.every((s) => (!umbrellaInScope && UMBRELLA_TASK_SOURCES.includes(s)) || (!decidesInScope && FUNDING_TASK_SOURCES.includes(s)));
  const rows: QueueRow[] = QUEUES.flatMap((q, i) => {
    const n = narrowed[i];
    const counted = n ? { count: n._count._all, oldest: n._min.createdAt } : sum((s) => s !== null && q.sources.includes(s));
    if (q.whenAny && !counted.count) return [];
    if (!counted.count && !possible(q)) return [];
    return [{ key: q.key, label: q.label, detail: q.detail, href: q.href, urgent: Boolean(q.urgent), section: q.section, ...counted }];
  });
  const rest = sum((s) => s === null || !known.has(s));
  if (rest.count) rows.push({ key: "other", label: "Other tasks", detail: "Everything else waiting on the office", href: "/tasks", urgent: false, section: null, ...rest });
  const bySection: Record<AdminSection, number> = { clubs: 0, events: 0, funding: 0, tests: 0, complaints: 0, reviews: 0 };
  for (const r of rows) if (r.section) bySection[r.section] += r.count;
  return { rows, total: rows.reduce((n, r) => n + r.count, 0), bySection };
}

// ─── Club counts ─────────────────────────────────────────────────────────────

/**
 * Clubs by status, approved clubs by type, and approved clubs with nobody in a
 * President seat or no advisor (Club analytics' No President and No advisor
 * filters). `clubs` narrows it (lib/authz adminClubWhere: an office's clubs).
 */
export async function clubCounts(clubs: Prisma.ClubWhereInput = {}): Promise<{
  byStatus: Partial<Record<ClubStatus, number>>;
  approvedByType: Partial<Record<ClubType, number>>;
  missing: { president: number; advisor: number };
}> {
  const [status, type, president, advisor] = await Promise.all([
    db.club.groupBy({ by: ["status"], where: clubs, _count: { _all: true } }),
    db.club.groupBy({ by: ["type"], where: { AND: [clubs, { status: "APPROVED" }] }, _count: { _all: true } }),
    db.club.count({ where: { AND: [clubs, { status: "APPROVED", roleAssignments: { none: { role: "PRESIDENT", endedAt: null } } }] } }),
    db.club.count({ where: { AND: [clubs, { status: "APPROVED", roleAssignments: { none: { role: "ADVISOR", endedAt: null } } }] } }),
  ]);
  return {
    byStatus: Object.fromEntries(status.map((s) => [s.status, s._count._all])),
    approvedByType: Object.fromEntries(type.map((t) => [t.type, t._count._all])),
    missing: { president, advisor },
  };
}

// ─── At-risk clubs ───────────────────────────────────────────────────────────

export type { AtRiskClub, AtRiskKind } from "@/lib/metrics";

/**
 * Approved clubs that are inactive now, or will be soon — lib/metrics'
 * clubsAtRisk (the AT RISK rule in lib/metrics/pure clubRisk), which the
 * assistant's club_health reads too, so the two lists always match.
 * `clubIds` narrows it to some clubs (an office's).
 */
export async function atRiskClubs(now = new Date(), clubIds?: string[]): Promise<AtRiskClub[]> {
  return clubsAtRisk({ at: now, clubIds });
}

// ─── Recent activity ─────────────────────────────────────────────────────────

/** `text` follows the actor's name ("filled the Treasurer seat", lib/lake/actions); the club, when there is one, is shown beside it. */
export type FeedItem = { id: string; at: Date; actor: { name: string; avatarUrl: string | null; avatarColor: string } | null; text: string; club: { id: string; name: string; slug: string } | null };

/** The latest public platform activity (ActivityLog.isPublic), never anything about reports. `clubs` narrows it to those clubs' rows. */
export async function recentPlatformActivity(take = 12, clubs?: Prisma.ClubWhereInput): Promise<FeedItem[]> {
  const rows = await db.activityLog.findMany({
    where: {
      isPublic: true,
      action: { notIn: BUSY_ACTIONS },
      NOT: [{ entityType: "complaint" }, { action: { startsWith: "complaint." } }],
      ...(clubs ? { club: { is: clubs } } : {}),
    },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      at: true,
      action: true,
      data: true,
      actor: { select: { name: true, avatarUrl: true, avatarColor: true } },
      club: { select: { id: true, name: true, slug: true } },
    },
  });
  return rows.map((r) => ({ id: String(r.id), at: r.at, actor: r.actor, text: actionPhrase(r.action, r.data, ROLE_LABEL), club: r.club }));
}
