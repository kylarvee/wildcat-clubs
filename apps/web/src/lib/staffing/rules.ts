import type { ClubRole, ClubStatus, ClubType, JoinPolicy } from "@prisma/client";

/**
 * Keeping approved clubs staffed: the gap rules and their words, pure and
 * client-safe (type imports only), so the write path (lib/domain/staffing),
 * the scheduled "Club staffing" job, the seed and the tests agree.
 *
 * An approved club has a gap when it has
 *   president — nobody in a President seat;
 *   advisor   — no advisor;
 *   approver  — an approval join policy, and nobody who can approve join
 *               requests right now (nobody holds the Members permission).
 *
 * A role change opens a gap when the gap is there after it and an assignment
 * that filled it ended during the change. That transition is what gets a
 * WSUSA task. A gap that was already there gets none (Club analytics' No
 * President and No advisor filters list those), so WSUSA's queue never fills
 * up with old gaps.
 */

export type StaffingGap = "president" | "advisor" | "approver";
export const STAFFING_GAPS: StaffingGap[] = ["president", "advisor", "approver"];

/** Task.sourceType of a gap's WSUSA task. Its sourceId is staffingSourceId(clubId, gap). */
export const STAFFING_SOURCE = "clubStaffing";
/** Task.sourceType of "Join requests waiting at {club}". Its sourceId is the club's id. */
export const ORPHAN_REQUESTS_SOURCE = "orphanRequests";
/** A join request is orphaned once it has waited longer than this and nobody in the club can approve it. */
export const ORPHAN_REQUEST_DAYS = 7;

const DAY_MS = 86_400_000;

export function staffingSourceId(clubId: string, gap: StaffingGap): string {
  return `${clubId}:${gap}`;
}

export function parseStaffingSourceId(sourceId: string | null | undefined): { clubId: string; gap: StaffingGap } | null {
  const m = /^(.+):(president|advisor|approver)$/.exec(sourceId ?? "");
  return m ? { clubId: m[1], gap: m[2] as StaffingGap } : null;
}

// ─── The rules ───────────────────────────────────────────────────────────────

/** A role someone holds, or held, in the club, as far as the gap rules care. */
export type HeldRole = { role: ClubRole; permissions: readonly string[] };

/**
 * Whether a seat comes with the Members permission (`roster`), which approves
 * join requests. lib/authz's seat rule: advisors, Presidents and Vice
 * Presidents hold every permission, and officers and ambassadors hold what
 * their seat grants.
 */
export function seatApproves(r: HeldRole): boolean {
  return r.role === "ADVISOR" || r.role === "PRESIDENT" || r.role === "VP" || r.permissions.includes("roster");
}

export type StaffingFacts = {
  status: ClubStatus;
  joinPolicy: JoinPolicy;
  /** Every role held in the club right now. */
  current: HeldRole[];
  /** How many people can approve join requests right now (lib/authz/people's holders of `roster`, so paused leaders don't count). */
  approvers: number;
};

/** The club's gaps right now. Only approved clubs have them: founding clubs are still filling their seats, and retired ones are closed. */
export function staffingGaps(f: StaffingFacts): StaffingGap[] {
  if (f.status !== "APPROVED") return [];
  const gaps: StaffingGap[] = [];
  if (!f.current.some((r) => r.role === "PRESIDENT")) gaps.push("president");
  if (!f.current.some((r) => r.role === "ADVISOR")) gaps.push("advisor");
  if (f.joinPolicy === "APPROVAL" && f.approvers === 0) gaps.push("approver");
  return gaps;
}

/** Whether a role filled this gap: losing it is what can open the gap. */
export function filledGap(r: HeldRole, gap: StaffingGap): boolean {
  if (gap === "president") return r.role === "PRESIDENT";
  if (gap === "advisor") return r.role === "ADVISOR";
  return seatApproves(r);
}

/** The gaps a role change opened: there now, and someone who filled the gap lost that role in the change. */
export function gapsOpenedBy(gaps: StaffingGap[], ended: HeldRole[]): StaffingGap[] {
  return gaps.filter((g) => ended.some((r) => filledGap(r, g)));
}

/** What to do with a club's WSUSA staffing tasks: open one for each gap the change opened that has none, and close the ones whose gap is filled. */
export function staffingTaskPlan(gaps: StaffingGap[], opened: StaffingGap[], openTasks: StaffingGap[]): { open: StaffingGap[]; close: StaffingGap[] } {
  return {
    open: opened.filter((g) => !openTasks.includes(g)),
    close: openTasks.filter((g) => !gaps.includes(g)),
  };
}

/** Join requests nobody can approve: one has waited longer than ORPHAN_REQUEST_DAYS, and nobody in the club holds the Members permission. */
export function hasOrphanedRequests(f: { oldestPendingAt: Date | null; approvers: number; now: Date }): boolean {
  return f.approvers === 0 && f.oldestPendingAt !== null && f.now.getTime() - f.oldestPendingAt.getTime() > ORPHAN_REQUEST_DAYS * DAY_MS;
}

// ─── Words ───────────────────────────────────────────────────────────────────

/** The gap as a short label: filters, badges, queue details. */
export const GAP_LABEL: Record<StaffingGap, string> = {
  president: "No President",
  advisor: "No advisor",
  approver: "Nobody to approve join requests",
};

/** What a WSUSA task and the leaders' notice say about a gap. */
export type GapStory = {
  club: { name: string; slug: string; type: ClubType };
  gap: StaffingGap;
  /** Whoever held the seat last, when the change that opened the gap is known. */
  leftName: string | null;
  /** The club still has an advisor (who can fill the President seat). */
  hasAdvisor: boolean;
};

const orgChart = (slug: string) => `/clubs/${slug}/manage/org-chart`;
const isProgram = (s: GapStory) => s.club.type === "COLLEGE_AMBASSADORS";

function presidentLeft(s: GapStory) {
  return s.leftName ? `${s.leftName}'s role as President ended` : "The last President's role ended";
}

/** "Dr. Kim no longer advises the club", or "The club's last advisor left" when nobody is named. */
function advisorLeft(s: GapStory, who: string) {
  return s.leftName ? `${s.leftName} no longer advises ${who}` : `${who[0].toUpperCase()}${who.slice(1)}'s last advisor left`;
}

/** The WSUSA task (ADMINS, APPROVAL) for a gap. */
export function gapTask(s: GapStory): { title: string; description: string; href: string } {
  const { name, slug } = s.club;
  if (s.gap === "president") {
    return {
      title: `${name} has no President`,
      description: `${presidentLeft(s)}, and nobody holds the seat now. ${s.hasAdvisor ? "Check in with the club's advisor" : "The club has no advisor either, so check in with its officers"}, then fill the seat from the club's org chart: Fill this seat starts a selection, or assign a President directly.`,
      href: orgChart(slug),
    };
  }
  if (s.gap === "advisor") {
    return isProgram(s)
      ? { title: `${name} has no advisor`, description: `${advisorLeft(s, "the program")}. Choose its next advisor in Club approvals → Ambassador programs.`, href: "/admin/clubs?tab=ambassadors" }
      : {
          title: `${name} has no advisor`,
          description: `${advisorLeft(s, "the club")}, so it has no faculty or staff advisor. Help its leaders find one: the President or a Vice President invites an advisor from the club's settings.`,
          href: `/clubs/${slug}/manage/settings`,
        };
  }
  return {
    title: `${name} has no one to approve join requests`,
    description: `${name} approves each join request, but nobody there holds the Members permission now, so requests will wait. Fill the President seat or give an officer the Members permission in the org chart. Until then, you can decide its requests on the club's Members page.`,
    href: orgChart(slug),
  };
}

/** The in-app notice to the club's remaining leaders and advisors. */
export function gapNotice(s: GapStory): { title: string; body: string; href: string } {
  const { name, slug } = s.club;
  if (s.gap === "president") {
    return {
      title: `${name} has no President`,
      body: `${presidentLeft(s)}, so nobody holds the seat. ${s.hasAdvisor ? "An advisor can fill it from the org chart with Fill this seat, and WSUSA can help." : "WSUSA knows and can help you fill it from the org chart."}`,
      href: orgChart(slug),
    };
  }
  if (s.gap === "advisor") {
    return isProgram(s)
      ? { title: `${name} has no advisor`, body: `${advisorLeft(s, name)}. WSUSA names the program's next advisor.`, href: orgChart(slug) }
      : {
          title: `${name} has no advisor`,
          body: `${advisorLeft(s, name)}. Every club needs a faculty or staff advisor: the President or a Vice President can invite one from the club's settings.`,
          href: `/clubs/${slug}/manage/settings`,
        };
  }
  return {
    title: `Nobody in ${name} can approve join requests`,
    body: `${name} approves each join request, but nobody holds the Members permission now. Give an officer the Members permission in the org chart, or fill the President seat.`,
    href: orgChart(slug),
  };
}

/** The WSUSA task for join requests nobody can approve. */
export function orphanRequestsTask(club: { name: string; slug: string }): { title: string; description: string; href: string } {
  return {
    title: `Join requests waiting at ${club.name}`,
    description: `A join request has waited more than a week, and nobody in ${club.name} holds the Members permission to decide it. Approve or decline requests on the club's Members page, and help the club fill a seat that can.`,
    href: `/clubs/${club.slug}/manage/members`,
  };
}
