import "server-only";
import type { ClubStatus, ClubType } from "@prisma/client";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { ROLE_LABEL } from "@/lib/authz";
import { clubActivityMany } from "@/lib/metrics";
import { STANDING_LABEL } from "@/lib/labels/clubs";
import { actionPhrase, BUSY_ACTIONS } from "@/lib/lake/actions";
import { getTerms, currentOrLastTerm } from "@/lib/terms";
import { fmtLongDate } from "@/lib/time";

/**
 * Read side of the admin overview (/admin): what's waiting on WSUSA, which
 * clubs are at risk of going inactive, club counts and recent platform
 * activity. Activity numbers come from lib/metrics; nothing here writes.
 * Reports (complaints) only ever appear as a count — never their content.
 */

// ─── Waiting on WSUSA ────────────────────────────────────────────────────────

export type Queue = { key: string; label: string; detail: string; href: string; count: number; oldest: Date | null };

/** The admin inboxes, in the order WSUSA staff work them. Open ADMINS tasks are grouped by sourceType. */
const QUEUES: { key: string; sources: (string | null)[]; label: string; detail: string; href: string }[] = [
  { key: "club", sources: ["club"], label: "New club submissions", detail: "Clubs asking WSUSA for recognition", href: "/admin/clubs" },
  { key: "departmentRequest", sources: ["departmentRequest"], label: "Department requests", detail: "Departments to add for Sponsored clubs", href: "/admin/clubs?tab=departments" },
  { key: "clubDocument", sources: ["clubDocument"], label: "Custom constitutions & bylaws", detail: "Uploaded documents to approve", href: "/admin/clubs?tab=documents" },
  // No admin list shows these; each task links to its club's Google account section.
  { key: "googleAccount", sources: ["googleAccount"], label: "Club Google accounts to verify", detail: "Confirm a club's own Workspace account before Google sync runs as it", href: "/tasks?kind=APPROVAL" },
  { key: "funding", sources: ["funding"], label: "Funding requests", detail: "Requests in WSUSA review", href: "/admin/funding" },
  { key: "invoice", sources: ["invoice"], label: "Invoices to process", detail: "Approved funding to push through", href: "/admin/funding" },
  { key: "reviews", sources: ["reviewBombing", "reviewFlag"], label: "Reviews to check", detail: "Possible review bombing and flagged reviews", href: "/admin/reviews" },
  // Count only: report details never leave the Reports tool.
  { key: "complaint", sources: ["complaint"], label: "New reports", detail: "Open them in Reports", href: "/admin/complaints" },
];

export async function waitingOnWsusa(): Promise<{ queues: Queue[]; other: Queue | null; total: number }> {
  const groups = await db.task.groupBy({
    by: ["sourceType"],
    where: { status: "OPEN", assigneeType: "ADMINS" },
    _count: { _all: true },
    _min: { createdAt: true },
  });
  const known = new Set(QUEUES.flatMap((q) => q.sources));
  const sum = (sources: (string | null)[]) => {
    const gs = groups.filter((g) => sources.includes(g.sourceType));
    const oldest = gs.map((g) => g._min.createdAt).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    return { count: gs.reduce((n, g) => n + g._count._all, 0), oldest };
  };
  const queues = QUEUES.map((q) => ({ key: q.key, label: q.label, detail: q.detail, href: q.href, ...sum(q.sources) }));
  const rest = sum(groups.map((g) => g.sourceType).filter((s) => !known.has(s)));
  const other = rest.count ? { key: "other", label: "Other admin tasks", detail: "Everything else assigned to WSUSA", href: "/tasks", ...rest } : null;
  return { queues, other, total: queues.reduce((n, q) => n + q.count, 0) + (other?.count ?? 0) };
}

// ─── Club counts ─────────────────────────────────────────────────────────────

export async function clubCounts(): Promise<{ byStatus: Partial<Record<ClubStatus, number>>; approvedByType: Partial<Record<ClubType, number>> }> {
  const [status, type] = await Promise.all([
    db.club.groupBy({ by: ["status"], _count: { _all: true } }),
    db.club.groupBy({ by: ["type"], where: { status: "APPROVED" }, _count: { _all: true } }),
  ]);
  return {
    byStatus: Object.fromEntries(status.map((s) => [s.status, s._count._all])),
    approvedByType: Object.fromEntries(type.map((t) => [t.type, t._count._all])),
  };
}

// ─── At-risk clubs ───────────────────────────────────────────────────────────

export type AtRiskKind = "inactive" | "pilot" | "slipping";
export type AtRiskClub = { id: string; name: string; slug: string; kind: AtRiskKind; tag: string; reasons: string[]; endsThisTerm: boolean };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Approved clubs that are inactive now, or will be soon:
 *   inactive — below the bar today (reasons straight from lib/metrics);
 *   pilot    — in their pilot period but not yet meeting the bar it hands
 *              over to (flagged harder when the pilot ends this term);
 *   slipping — active only on last term's record, with fewer than the
 *              minimum events this term once half the term has passed, or
 *              sitting exactly at the member minimum.
 */
export async function atRiskClubs(now = new Date()): Promise<AtRiskClub[]> {
  const [activity, cfg, terms, clubs] = await Promise.all([
    clubActivityMany(undefined, now),
    getConfig(),
    getTerms(),
    db.club.findMany({ where: { status: "APPROVED" }, select: { id: true, name: true, slug: true } }),
  ]);
  const minEvents = cfg["activity.clubMinEvents"];
  const minMembers = cfg["activity.clubMinMembers"];
  const term = currentOrLastTerm(terms, now);
  const termEnd = term?.endsOn ?? null;
  const pastHalf = term ? now.getTime() >= term.startsOn.getTime() + (term.endsOn.getTime() - term.startsOn.getTime()) / 2 : false;
  const termName = term?.name ?? "this term";

  const out: AtRiskClub[] = [];
  for (const c of clubs) {
    const a = activity.get(c.id);
    if (!a) continue;
    if (!a.active) {
      out.push({ ...c, kind: "inactive", tag: STANDING_LABEL.inactive, reasons: a.reasons, endsThisTerm: false });
      continue;
    }
    if (a.inPilot) {
      const reasons: string[] = [];
      if (a.heldEventsCurrentTerm < minEvents) reasons.push(`${a.heldEventsCurrentTerm === 0 ? "No" : `Only ${a.heldEventsCurrentTerm}`} ${a.heldEventsCurrentTerm === 1 ? "event" : "events"} with check-ins in ${termName} (needs ${minEvents} in one term).`);
      if (a.registeredMembers < minMembers) reasons.push(`${a.registeredMembers === 0 ? "No registered members yet" : `Only ${plural(a.registeredMembers, "registered member")}`} (needs ${minMembers}).`);
      if (!reasons.length) continue;
      const endsThisTerm = Boolean(a.pilotEndsAt && termEnd && a.pilotEndsAt.getTime() <= termEnd.getTime() + 86_400_000);
      out.push({ ...c, kind: "pilot", tag: a.pilotEndsAt ? `Pilot period ends ${fmtLongDate(a.pilotEndsAt)}` : STANDING_LABEL.pilot, reasons, endsThisTerm });
      continue;
    }
    const reasons: string[] = [];
    if (pastHalf && a.heldEventsCurrentTerm < minEvents) {
      const prev = a.previousTermName ?? "last term";
      reasons.push(`${a.heldEventsCurrentTerm === 0 ? "No" : `Only ${a.heldEventsCurrentTerm}`} ${a.heldEventsCurrentTerm === 1 ? "event" : "events"} with check-ins in ${termName} so far; active on ${prev}'s record (needs ${minEvents} in one term).`);
    }
    if (a.registeredMembers === minMembers) reasons.push(`Exactly ${minMembers} registered members, the minimum — one departure makes it inactive.`);
    if (reasons.length) out.push({ ...c, kind: "slipping", tag: "At the line", reasons, endsThisTerm: false });
  }
  const rank: Record<AtRiskKind, number> = { inactive: 0, pilot: 1, slipping: 2 };
  return out.sort((x, y) => rank[x.kind] - rank[y.kind] || Number(y.endsThisTerm) - Number(x.endsThisTerm) || x.name.localeCompare(y.name));
}

// ─── Recent activity ─────────────────────────────────────────────────────────

/** `text` follows the actor's name ("filled the Treasurer seat", lib/lake/actions); the club, when there is one, is shown beside it. */
export type FeedItem = { id: string; at: Date; actor: { name: string; avatarUrl: string | null; avatarColor: string } | null; text: string; club: { id: string; name: string; slug: string } | null };

/** The latest public platform activity (ActivityLog.isPublic), never anything about reports. */
export async function recentPlatformActivity(take = 12): Promise<FeedItem[]> {
  const rows = await db.activityLog.findMany({
    where: {
      isPublic: true,
      action: { notIn: BUSY_ACTIONS },
      NOT: [{ entityType: "complaint" }, { action: { startsWith: "complaint." } }],
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
