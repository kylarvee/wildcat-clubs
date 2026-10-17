import "server-only";
import type { ClubRole, ClubStatus } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { isAdmin, ROLE_LABEL, ROLE_RANK } from "@/lib/authz";
import { listTasks, type TaskRow } from "@/lib/domain/tasks";
import { inviteHref } from "@/lib/domain/advisors";
import { memberClubSummaries } from "@/lib/metrics";
import { getTerms, termAt } from "@/lib/terms";
import { resolveRange } from "@/lib/attendance/ranges";

/**
 * Read model for /dashboard. Read-only; every change goes through a domain
 * function. Numbers about attendance come from lib/metrics (memberClubSummaries)
 * so the dashboard and /me/attendance never disagree.
 */

export type DashClub = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  logoColor: string;
  status: ClubStatus;
  /** "President", "Treasurer", "Member", "Advisor" … highest first. */
  roles: string[];
  topRole: ClubRole | null;
  pending: boolean;
  /** Ambassador and up, or advisor: may open the club workspace. */
  leads: boolean;
};

export type LedClub = DashClub & { joinRequests: number; cohostRequests: number; otherApprovals: number };

export type AdminQueueRow = { key: string; label: string; href: string; count: number };

export type AdvisorInviteRow = { id: string; clubName: string; clubSlug: string; inviterName: string; href: string; createdAt: Date };

const clubSelect = { id: true, name: true, slug: true, logoUrl: true, logoColor: true, status: true } as const;
const HIDDEN: ClubStatus[] = ["RETIRED", "REJECTED"];

/** Every club you're connected to right now: member, pending request or role (advisors included). */
async function myClubs(userId: string): Promise<DashClub[]> {
  const [memberships, roles] = await Promise.all([
    db.membership.findMany({ where: { userId, status: { in: ["ACTIVE", "PENDING"] }, club: { status: { notIn: HIDDEN } } }, select: { status: true, club: { select: clubSelect } } }),
    db.roleAssignment.findMany({
      where: { userId, endedAt: null, club: { status: { notIn: HIDDEN } } },
      select: { role: true, position: { select: { name: true } }, club: { select: clubSelect } },
    }),
  ]);
  const map = new Map<string, DashClub>();
  const at = (c: (typeof memberships)[number]["club"]) => {
    let row = map.get(c.id);
    if (!row) map.set(c.id, (row = { ...c, roles: [], topRole: null, pending: false, leads: false }));
    return row;
  };
  for (const m of memberships) {
    const row = at(m.club);
    if (m.status === "PENDING") row.pending = true;
    else if (!row.topRole) row.topRole = "MEMBER";
  }
  for (const r of [...roles].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role])) {
    const row = at(r.club);
    row.pending = false;
    if (!row.topRole || ROLE_RANK[r.role] > ROLE_RANK[row.topRole]) row.topRole = r.role;
    if (r.role !== "MEMBER") row.roles.push(r.position?.name ?? ROLE_LABEL[r.role]);
    if (ROLE_RANK[r.role] >= 1) row.leads = true;
  }
  return [...map.values()]
    .map((c) => ({ ...c, roles: c.roles.length ? c.roles : c.topRole === "MEMBER" ? ["Member"] : [] }))
    .sort((a, b) => Number(b.leads) - Number(a.leads) || Number(a.pending) - Number(b.pending) || a.name.localeCompare(b.name));
}

/** WSUSA's shared queue, counted by what it is and where it's handled. */
async function adminQueue(): Promise<AdminQueueRow[]> {
  const rows = await db.task.groupBy({ by: ["sourceType", "kind"], where: { assigneeType: "ADMINS", status: "OPEN" }, _count: { _all: true } });
  const buckets: Record<string, { label: string; href: string }> = {
    club: { label: "Club submissions to review", href: "/admin/clubs?tab=submissions" },
    departmentRequest: { label: "Departments to add", href: "/admin/clubs?tab=departments" },
    clubDocument: { label: "Custom constitutions & bylaws", href: "/admin/clubs?tab=documents" },
    // No admin list shows these; each task links to its club's Google account section.
    googleAccount: { label: "Club Google accounts to verify", href: "/tasks?kind=APPROVAL" },
    funding: { label: "Funding requests", href: "/admin/funding" },
    invoice: { label: "Invoices to process", href: "/admin/funding" },
    reviewBombing: { label: "Possible review bombing", href: "/admin/reviews" },
    reviewFlag: { label: "Reported reviews", href: "/admin/reviews" },
  };
  const out = new Map<string, AdminQueueRow>();
  for (const r of rows) {
    const key = r.sourceType && buckets[r.sourceType] ? r.sourceType : "other";
    const b = buckets[key] ?? { label: "Other WSUSA tasks", href: "/tasks" };
    const cur = out.get(key);
    if (cur) cur.count += r._count._all;
    else out.set(key, { key, label: b.label, href: b.href, count: r._count._all });
  }
  const order = [...Object.keys(buckets), "other"];
  return [...out.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

async function advisorInvites(user: Actor): Promise<AdvisorInviteRow[]> {
  const rows = await db.advisorInvite.findMany({
    where: { status: "PENDING", OR: [{ inviteeId: user.id }, { email: { equals: user.email, mode: "insensitive" } }], club: { status: { notIn: HIDDEN } } },
    select: { id: true, token: true, createdAt: true, club: { select: { name: true, slug: true } }, invitedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ id: r.id, clubName: r.club.name, clubSlug: r.club.slug, inviterName: r.invitedBy.name, href: inviteHref(r.token), createdAt: r.createdAt }));
}

export async function loadDashboard(user: Actor) {
  const now = new Date();
  const [me, clubs, openTasks, summaries, terms, queue, invites] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { hasMobileApp: true, appPromptDismissedAt: true, graduatedAt: true, status: true } }),
    myClubs(user.id),
    listTasks(user, { status: "OPEN", take: 300 }),
    memberClubSummaries(user.id),
    getTerms(),
    isAdmin(user) ? adminQueue() : Promise.resolve([] as AdminQueueRow[]),
    user.kind === "FACULTY_STAFF" ? advisorInvites(user) : Promise.resolve([] as AdvisorInviteRow[]),
  ]);

  // ── Leaders: approvals waiting in each club they lead. ──
  const approvals = (clubId: string, pred: (t: TaskRow) => boolean) => openTasks.filter((t) => t.kind === "APPROVAL" && t.clubId === clubId && pred(t)).length;
  const led: LedClub[] = clubs
    .filter((c) => c.leads)
    .map((c) => ({
      ...c,
      joinRequests: approvals(c.id, (t) => t.sourceType === "membership"),
      cohostRequests: approvals(c.id, (t) => t.sourceType === "cohost"),
      otherApprovals: approvals(c.id, (t) => t.sourceType !== "membership" && t.sourceType !== "cohost"),
    }));

  // ── Attendance snapshot (this term's check-ins; the rest from metrics). ──
  const term = termAt(terms, now);
  const range = resolveRange({ range: "term" }, terms, now);
  const termCheckins = await db.attendance.count({ where: { userId: user.id, occurrence: { startsAt: { gte: range.from, lte: range.to } } } });
  const memberSummaries = summaries.filter((s) => s.membershipStatus === "ACTIVE");

  return {
    now,
    me,
    clubs,
    led,
    openTasks,
    summaries: memberSummaries,
    attendance: {
      termLabel: range.label,
      termCheckins,
      activeIn: memberSummaries.filter((s) => s.summary.active).length,
    },
    term,
    queue,
    invites,
    advisedCount: clubs.filter((c) => c.topRole === "ADVISOR").length,
  };
}

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;
