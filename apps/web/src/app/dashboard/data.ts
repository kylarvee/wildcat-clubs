import "server-only";
import type { ClubRole, ClubStatus } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { can, isAdmin, ROLE_LABEL, ROLE_RANK } from "@/lib/authz";
import { eventVisibilityWhere } from "@/lib/authz/events";
import { listTasks } from "@/lib/domain/tasks";
import { queueFor, type QueueRow } from "@/lib/analytics/admin";
import { clubLeaderCompliance, requirementsOverview } from "@/lib/domain/requirements";
import { feedOccurrences, viewerContext, type FeedOccurrence, type ViewerContext } from "@/lib/events/feed";
import { shortLocationText } from "@/lib/events/labels";
import { getTerms, termAt } from "@/lib/terms";
import { DAY_MS } from "@/lib/time";

/**
 * Read model for /dashboard. Read-only; every change goes through a domain
 * function. Each card previews a tool that has its own page (Tasks, Calendar,
 * the club workspace, Admin), except announcements, which are read here.
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
  /** The club's next meeting (the next date of any repeating event: meetings, practices…) the viewer may see. */
  nextMeeting: Date | null;
};

/** One line of "Coming up": an event, or (admins) a requirement deadline. */
export type AgendaItem = {
  key: string;
  kind: "event" | "deadline";
  href: string;
  title: string;
  at: Date;
  allDay: boolean;
  /** "NB 220 · Wildcat Robotics", "128 still to do". */
  detail: string;
  color: string;
  /** An event of a club the viewer leads or advises. */
  leading: boolean;
};

const clubSelect = { id: true, name: true, slug: true, logoUrl: true, logoColor: true, status: true } as const;
const HIDDEN: ClubStatus[] = ["RETIRED", "REJECTED"];
/** "Coming up" on the dashboard (and the mobile Home) looks this far ahead. */
const COMING_UP_DAYS = 14;

/** Every club you're connected to right now: member, pending request or role (advisors included), leaders first. */
async function myClubs(user: Actor, ctx: ViewerContext, now: Date): Promise<DashClub[]> {
  const [memberships, roles] = await Promise.all([
    db.membership.findMany({ where: { userId: user.id, status: { in: ["ACTIVE", "PENDING"] }, club: { status: { notIn: HIDDEN } } }, select: { status: true, club: { select: clubSelect } } }),
    db.roleAssignment.findMany({
      where: { userId: user.id, endedAt: null, club: { status: { notIn: HIDDEN } } },
      select: { role: true, position: { select: { name: true } }, club: { select: clubSelect } },
    }),
  ]);
  const map = new Map<string, DashClub>();
  const at = (c: (typeof memberships)[number]["club"]) => {
    let row = map.get(c.id);
    if (!row) map.set(c.id, (row = { ...c, roles: [], topRole: null, pending: false, leads: false, nextMeeting: null }));
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
  const clubs = [...map.values()].map((c) => ({ ...c, roles: c.roles.length ? c.roles : c.topRole === "MEMBER" ? ["Member"] : [] }));

  // Next meeting per approved club: the next date of any repeating event it hosts (a weekly
  // meeting, a practice…), filtered by lib/authz/events like every calendar. Two queries for
  // every club at once: each repeating event's next date, then which club hosts it.
  const visible = eventVisibilityWhere({ signedIn: true, admin: ctx.admin, memberClubIds: ctx.memberClubIds });
  const approved = clubs.filter((c) => c.status === "APPROVED" && !c.pending);
  if (approved.length) {
    const firsts = await db.eventOccurrence.groupBy({
      by: ["eventId"],
      where: { startsAt: { gt: now }, status: "SCHEDULED", event: { AND: [{ clubId: { in: approved.map((c) => c.id) }, recurrence: { not: "NONE" }, status: "SCHEDULED" }, visible] } },
      _min: { startsAt: true },
    });
    const hosts = firsts.length ? await db.event.findMany({ where: { id: { in: firsts.map((f) => f.eventId) } }, select: { id: true, clubId: true } }) : [];
    const hostOf = new Map(hosts.map((e) => [e.id, e.clubId]));
    const next = new Map<string, Date>();
    for (const f of firsts) {
      const clubId = hostOf.get(f.eventId);
      const at = f._min.startsAt;
      if (!clubId || !at) continue;
      const soonest = next.get(clubId);
      if (!soonest || at < soonest) next.set(clubId, at);
    }
    for (const c of approved) c.nextMeeting = next.get(c.id) ?? null;
  }

  return clubs.sort((a, b) => Number(b.leads) - Number(a.leads) || Number(a.pending) - Number(b.pending) || a.name.localeCompare(b.name));
}

/**
 * The viewer's office queue: the rows of lib/analytics/admin's queueFor (the
 * admin Overview's and nav's too) that have something waiting. WSUSA staff see
 * WSUSA's; an office's staff see their office's.
 */
async function adminQueue(user: Actor): Promise<{ rows: QueueRow[]; name: string }> {
  const q = await queueFor(user);
  return { rows: q.rows.filter((r) => r.count > 0), name: q.name };
}

function toAgendaItem(o: FeedOccurrence, ctx: ViewerContext): AgendaItem {
  const e = o.event;
  const where = shortLocationText({ ...e, roomOverride: o.roomOverride });
  return {
    key: o.id,
    kind: "event",
    href: `/events/${e.id}`,
    title: e.title,
    at: o.startsAt,
    allDay: e.allDay,
    detail: [where, e.club?.name ?? "WSUSA"].filter(Boolean).join(" · "),
    color: e.club?.logoColor ?? "#492365",
    leading: Boolean(e.clubId && ctx.leaderClubIds.includes(e.clubId)),
  };
}

const live = (o: FeedOccurrence) => o.status !== "CANCELLED" && o.event.status !== "CANCELLED";

/** "Coming up": your calendar for the next two weeks (followed clubs and university events), like the calendar page. */
async function weekAgenda(ctx: ViewerContext, now: Date): Promise<AgendaItem[]> {
  const rows = await feedOccurrences(ctx, { scope: "me" }, { start: now, end: new Date(now.getTime() + COMING_UP_DAYS * DAY_MS) }, { take: 60 });
  return rows.filter(live).slice(0, 10).map((o) => toAgendaItem(o, ctx));
}

export async function loadDashboard(user: Actor) {
  const now = new Date();
  const admin = isAdmin(user);
  // Platform admins and office staff each work a shared queue.
  const staff = can(user, "admin.access");
  const ctx = await viewerContext(user);
  const [me, clubs, openTasks, terms, queue, overview] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { hasMobileApp: true, appPromptDismissedAt: true, graduatedAt: true, status: true } }),
    myClubs(user, ctx, now),
    listTasks(user, { status: "OPEN", take: 300 }),
    getTerms(),
    staff ? adminQueue(user) : Promise.resolve({ rows: [] as QueueRow[], name: "" }),
    admin && (can(user, "admin.tests") || can(user, "admin.trainings")) ? requirementsOverview(user, now) : Promise.resolve(null),
  ]);

  const advised = clubs.filter((c) => c.topRole === "ADVISOR" && c.status === "APPROVED");
  const [officers, agenda] = await Promise.all([
    advised.length ? clubLeaderCompliance(user, advised.map((c) => c.id), now) : Promise.resolve([]),
    admin ? adminAgenda(ctx, now, overview?.rows ?? []) : weekAgenda(ctx, now),
  ]);

  return {
    now,
    me,
    clubs,
    // Admins and office staff see the shared work in their queue, so their task card holds only what's theirs.
    tasks: staff ? openTasks.filter((t) => t.assigneeType !== "ADMINS") : openTasks,
    term: termAt(terms, now),
    queue: queue.rows,
    queueName: queue.name,
    staff,
    overview,
    officers,
    agenda,
  };
}

/** Admins: university events and requirement deadlines in the next two weeks. */
async function adminAgenda(ctx: ViewerContext, now: Date, reqs: NonNullable<Awaited<ReturnType<typeof requirementsOverview>>>["rows"]): Promise<AgendaItem[]> {
  const end = new Date(now.getTime() + COMING_UP_DAYS * DAY_MS);
  const rows = await feedOccurrences(ctx, { scope: "trainings" }, { start: now, end }, { take: 30 });
  const deadlines: AgendaItem[] = reqs
    .filter((r) => r.nextDue && r.nextDue <= end)
    .map((r) => ({
      key: `deadline:${r.id}`,
      kind: "deadline" as const,
      href: `/admin/requirements/${r.id}`,
      title: `${r.name}: next deadline`,
      at: r.nextDue!,
      allDay: true,
      detail: `Requirement deadline · ${r.open - r.waiting} still to do${r.waiting ? `, ${r.waiting} waiting for grading` : ""}`,
      color: "#b91c1c",
      leading: false,
    }));
  return [...rows.filter(live).map((o) => toAgendaItem(o, ctx)), ...deadlines].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 10);
}

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;
