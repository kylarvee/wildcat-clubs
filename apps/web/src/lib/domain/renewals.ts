import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { adminClubWhere, getClubAccess } from "@/lib/authz";
import { umbrellaOffice } from "@/lib/offices";
import { getConfig } from "@/lib/config";
import { logActivity } from "@/lib/lake/activity";
import { getTerms } from "@/lib/terms";
import { fmtLongDate } from "@/lib/time";
import { assertCan, assertSignedIn, conflict, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { notify } from "@/lib/domain/notify";
import { resolveTasks } from "@/lib/domain/tasks";
import { loadRenewalStates, type ClubRenewalState, type RenewalPerson } from "@/lib/renewals/facts";
import {
  activeConfirmation,
  blockedMessage,
  checkFix,
  isRequiredCheck,
  RENEWAL_NOTE_MAX,
  RENEWAL_SOURCE,
  renewalCardHint,
  renewalCardIntro,
  renewalDueNotice,
  renewalHref,
  renewalSourceId,
  renewalTaskDescription,
  renewalTaskPlan,
  renewalTaskTitle,
  renewalTerm,
  renewalWindow,
  renewedNotice,
  renewerBlocker,
  snapshotChecks,
  tookOfficeDuringWindow,
  type RenewalCheck,
  type RenewalHolder,
  type RenewalStatus,
  type RenewalTerm,
  type RenewalWindow,
} from "@/lib/renewals/rules";

/**
 * Yearly club renewal with the club's office (WSUSA, or the office that
 * oversees it: lib/offices): the write path for ClubRenewal and for the
 * renewal tasks, and the reads the workspace overview, the club page and
 * Admin → Club approvals → Renewals use. The rules (window, checks, status
 * names, who renews, which tasks a club should have) are pure in
 * lib/renewals/rules.
 *
 * The tasks: syncClubRenewal brings one club's tasks in line with where it
 * stands. The "Club renewals" scheduled job (lib/jobs/renewals) runs it for
 * every club that's out of line, and every role change runs it for its club
 * (renewalAfterRoleChange, from lib/domain/staffing), so a President who
 * takes office while the club hasn't renewed has "Renew … for 2026–27" at
 * once and the outgoing President's task is cancelled.
 *
 * Renewing is the club's own act, not a review. It writes the ClubRenewal
 * with the checks as they stood, logs club.renewed (public), closes the
 * club's renewal tasks for everyone and tells the office nothing. A club that
 * doesn't renew loses nothing automatically: its office sees it on the
 * Renewals tab (each office its own clubs) and decides.
 */

/** This academic year's window (null without terms), and the term "an event this term" reads. */
export async function currentRenewalWindow(now: Date = new Date()): Promise<{ window: RenewalWindow | null; term: RenewalTerm | null }> {
  const [terms, cfg] = await Promise.all([getTerms(), getConfig()]);
  return { window: renewalWindow(terms, now, cfg["renewal.dueDays"]), term: renewalTerm(terms, now) };
}

// ─── The tasks ───────────────────────────────────────────────────────────────

/** What renewalTaskPlan reads of a task. */
export const RENEWAL_TASK_SELECT = { id: true, sourceId: true, assigneeId: true, dueAt: true, officeId: true, title: true } satisfies Prisma.TaskSelect;

/** A club's open renewal tasks, any year (sourceId "<clubId>:<year>"). */
const openRenewalTasks = (clubId: string) => ({ sourceType: RENEWAL_SOURCE, status: "OPEN" as const, sourceId: { startsWith: `${clubId}:` } });

export type RenewalSyncResult = { opened: number; done: number; cancelled: number; updated: number };

/**
 * THE RENEWAL SYNC: one club's renewal tasks, made to match
 * lib/renewals/rules renewalTaskPlan. While renewal is open and the club
 * hasn't renewed, each current President and advisor has one required
 * "Renew {club} for 2026–27" task, due when the window is (one window for
 * every club) and marked as required by the club's office; whoever took the
 * seat after renewal opened is told it's theirs to finish. A renewal closes
 * them as done; someone leaving the seat, the window closing or the club
 * leaving the list cancels theirs. Runs under a per-club lock with the facts
 * read inside it, so the job and a role change can't both open a task.
 * `at` skips re-reading the window (the job passes it once for every club).
 */
export async function syncClubRenewal(clubId: string, opts: { now?: Date; at?: { window: RenewalWindow | null; term: RenewalTerm | null } } = {}): Promise<RenewalSyncResult> {
  const now = opts.now ?? new Date();
  const { window, term } = opts.at ?? (await currentRenewalWindow(now));
  const umbrella = (await umbrellaOffice()).name;
  const r = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`${RENEWAL_SOURCE}:${clubId}`}))`;
      const [[state], tasks] = await Promise.all([
        loadRenewalStates(tx, { window, term, now, clubIds: [clubId] }),
        tx.task.findMany({ where: openRenewalTasks(clubId), select: RENEWAL_TASK_SELECT }),
      ]);
      const plan = renewalTaskPlan(state ?? null, tasks, window, now);
      const office = state?.club.office?.name ?? umbrella;
      const out = { club: state?.club ?? null, office, opened: plan.open, cancelled: 0, done: 0, updated: plan.update.length };
      if (plan.cancel.length) out.cancelled = (await tx.task.updateMany({ where: { id: { in: plan.cancel }, status: "OPEN" }, data: { status: "CANCELLED", completedAt: now } })).count;
      const renewal = state?.renewal;
      if (plan.done.length && renewal) {
        out.done = (await tx.task.updateMany({ where: { id: { in: plan.done }, status: "OPEN" }, data: { status: "DONE", completedAt: renewal.submittedAt, completedById: renewal.submittedBy?.id ?? null } })).count;
      }
      if (!state || !window || !(plan.update.length || plan.open.length)) return out;
      const title = renewalTaskTitle(state.club.name, window.year);
      if (plan.update.length) await tx.task.updateMany({ where: { id: { in: plan.update } }, data: { dueAt: window.dueAt, officeId: state.club.officeId, title } });
      // Written here rather than through createTask, which names an office only on ADMINS tasks: a required task names who requires it.
      await tx.task.createMany({
        data: plan.open.map((h) => ({
          kind: "REQUIREMENT" as const,
          title,
          description: renewalTaskDescription(office, tookOfficeDuringWindow(h, window)),
          assigneeType: "USER" as const,
          assigneeId: h.id,
          clubId: state.club.id,
          href: renewalHref(state.club.slug),
          dueAt: window.dueAt,
          required: true,
          sourceType: RENEWAL_SOURCE,
          sourceId: renewalSourceId(state.club.id, window.year),
          officeId: state.club.officeId,
        })),
      });
      return out;
    },
    { timeout: 15_000 },
  );

  // Whoever's task just opened hears about it: someone new to the seat that it's theirs to finish, everyone else that it's time.
  if (r.club && window && r.opened.length) {
    const late = now > window.dueAt;
    const href = renewalHref(r.club.slug);
    const fresh = r.opened.filter((h) => tookOfficeDuringWindow(h, window));
    for (const h of fresh) await notify({ userIds: [h.id], kind: "club.renewal_due", ...renewalDueNotice(r.club.name, window, late, r.office, h), href });
    const rest = r.opened.filter((h) => !fresh.includes(h)).map((h) => h.id);
    if (rest.length) await notify({ userIds: rest, kind: "club.renewal_due", ...renewalDueNotice(r.club.name, window, late, r.office), href });
  }
  return { opened: r.opened.length, done: r.done, cancelled: r.cancelled, updated: r.updated };
}

/**
 * For write paths, right after a role change (lib/domain/staffing
 * staffingAfterRoleChange runs it for every club a change touched). Never
 * throws: the change has already happened, so a failed sync is logged and
 * the "Club renewals" job brings the tasks in line on its next run.
 */
export async function renewalAfterRoleChange(clubId: string): Promise<void> {
  try {
    await syncClubRenewal(clubId);
  } catch (e) {
    console.error(`[renewals] couldn't sync club ${clubId}'s renewal tasks after a role change`, e);
  }
}

export type RenewalCheckRow = RenewalCheck & { required: boolean; fix: { label: string; href: string } };
export type RenewalDone = { at: Date; byName: string | null; note: string | null };

function checkRows(slug: string, checks: RenewalCheck[]): RenewalCheckRow[] {
  return checks.map((c) => ({ ...c, required: isRequiredCheck(c.key), fix: checkFix(slug, c.key) }));
}

const done = (s: ClubRenewalState): RenewalDone | null => (s.renewal ? { at: s.renewal.submittedAt, byName: s.renewal.submittedBy?.name ?? null, note: s.renewal.note } : null);

// ─── The club's own view (workspace overview) ───────────────────────────────

export type RenewalView = {
  club: { id: string; name: string; slug: string };
  /** Who the club renews with: the office that oversees it (lib/offices). */
  office: string;
  window: RenewalWindow | null;
  status: RenewalStatus;
  checks: RenewalCheckRow[];
  renewal: RenewalDone | null;
  /** The overview shows the card while renewal is due or late, and once the club renewed. */
  showCard: boolean;
  canRenew: boolean;
  /** Why the Renew button is off, in plain words; null when it's on or the club already renewed. */
  whyNot: string | null;
  /** The card's first lines (lib/renewals/rules renewalCardIntro). */
  intro: string;
  /** The line beside the Renew button while it's on (lib/renewals/rules renewalCardHint). */
  hint: string;
  /** The viewer is a President or advisor who took the seat after renewal opened, while the club hasn't renewed. */
  tookOffice: { role: RenewalHolder["role"]; since: Date } | null;
};

/** The renewal card for a club's leaders (anyone who can open its workspace). */
export async function renewalView(actor: Actor | null, clubId: string, now: Date = new Date()): Promise<RenewalView> {
  assertSignedIn(actor);
  const access = await getClubAccess(actor, String(clubId));
  if (!access) throw notFound("Club");
  if (!access.isLeader) throw forbidden();
  const { window, term } = await currentRenewalWindow(now);
  const [state] = await loadRenewalStates(db, { window, term, now, clubIds: [access.clubId] });
  if (!state) throw notFound("Club");
  const { status } = state;
  const whyNot =
    status.kind === "renewed"
      ? null
      : status.kind === "upcoming"
        ? status.hint
        : state.blocking.length
          ? blockedMessage(state.club.name, state.blocking)
          : renewerBlocker(access, state.club.name);
  const office = state.club.office?.name ?? (await umbrellaOffice()).name;
  // A President or advisor who took the seat mid-window picks up the renewal as it stands (one window for every club), so the card says so.
  const mine = state.holders.find((h) => h.id === actor.id);
  const open = status.kind === "due" || status.kind === "overdue";
  const tookOffice = window && mine && open && tookOfficeDuringWindow(mine, window) ? { role: mine.role, since: mine.since } : null;
  return {
    club: { id: state.club.id, name: state.club.name, slug: state.club.slug },
    office,
    window,
    status,
    checks: checkRows(state.club.slug, state.checks),
    renewal: done(state),
    showCard: status.kind !== "upcoming",
    canRenew: whyNot === null && open,
    whyNot,
    intro: window ? renewalCardIntro(state.club.name, office, window, tookOffice) : "",
    hint: window ? renewalCardHint(status, window, tookOffice) : status.hint,
    tookOffice,
  };
}

/** The club page's "Re-registered 2026–27": the renewal for this academic year, or null. Public. */
export async function renewedThisYear(clubId: string, now: Date = new Date()): Promise<{ year: string; at: Date } | null> {
  const { window } = await currentRenewalWindow(now);
  if (!window) return null;
  const row = await db.clubRenewal.findUnique({ where: { clubId_academicYear: { clubId, academicYear: window.year } }, select: { submittedAt: true } });
  return row ? { year: window.year, at: row.submittedAt } : null;
}

// ─── Renewing ────────────────────────────────────────────────────────────────

const RenewInput = z.object({
  clubId: z.string({ error: "Choose a club." }).trim().min(1, "Choose a club.").max(64),
  confirmActive: z.boolean().optional(),
  note: z
    .string()
    .trim()
    .max(RENEWAL_NOTE_MAX, `Keep the note under ${RENEWAL_NOTE_MAX.toLocaleString("en-US")} characters.`)
    .nullish()
    .transform((v) => v || null),
});

export type RenewClubInput = z.input<typeof RenewInput>;

/**
 * Re-registers a club for this academic year. The President, a Vice
 * President, an advisor or an admin confirms the club will be active; every
 * required check must pass. Writes the ClubRenewal with the checks snapshot,
 * closes the renewal tasks for everyone, logs club.renewed (public) and lets
 * the club's other Presidents and advisors know. WSUSA isn't notified.
 */
export async function renewClub(actor: Actor | null, input: unknown, now: Date = new Date()) {
  assertSignedIn(actor);
  const v = parse(RenewInput, input);
  const access = await getClubAccess(actor, v.clubId);
  if (!access) throw notFound("Club");
  const { window, term } = await currentRenewalWindow(now);
  const [state] = await loadRenewalStates(db, { window, term, now, clubIds: [v.clubId] });
  if (!state) throw notFound("Club");
  const name = state.club.name;

  const office = state.club.office?.name ?? (await umbrellaOffice()).name;
  const who = renewerBlocker(access, name);
  if (who) throw forbidden(who);
  if (!window) throw conflict("Renewal isn't open: the academic calendar doesn't have any terms yet.");
  if (state.renewal) throw conflict(`${name} is already re-registered for ${window.year}.`);
  if (state.exemption) throw conflict(`${name} doesn't renew for ${window.year}. ${state.exemption}`);
  if (now < window.opensAt) throw conflict(`Renewal for ${window.year} opens ${fmtLongDate(window.opensAt)}.`);
  if (state.blocking.length) throw invalid(blockedMessage(name, state.blocking));
  if (v.confirmActive !== true) throw invalid(`To renew, confirm that ${activeConfirmation(name).replace(/\.$/, "")}.`);

  let renewal;
  try {
    renewal = await db.$transaction(async (tx) => {
      const row = await tx.clubRenewal.create({
        data: { clubId: state.club.id, academicYear: window.year, submittedById: actor.id, submittedAt: now, checks: snapshotChecks(state.checks), note: v.note },
      });
      await resolveTasks(RENEWAL_SOURCE, renewalSourceId(state.club.id, window.year), actor.id, tx);
      await logActivity({ actorId: actor.id, action: "club.renewed", entityType: "club", entityId: state.club.id, clubId: state.club.id, data: { year: window.year, office: office }, isPublic: true }, tx);
      return row;
    });
  } catch (e) {
    // Two leaders renewing at once: the second finds the first's renewal.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict(`${name} is already re-registered for ${window.year}.`);
    throw e;
  }

  // Their renewal tasks just closed, so say why.
  await notify({
    userIds: [...state.presidents, ...state.advisors].map((p) => p.id),
    exceptUserId: actor.id,
    kind: "club.renewed",
    ...renewedNotice(name, window.year, actor.name, office),
    href: `/clubs/${state.club.slug}/manage`,
  });
  return { year: window.year, at: renewal.submittedAt, slug: state.club.slug };
}

// ─── WSUSA's view (Admin → Club approvals → Renewals, the Overview) ─────────

export type RenewalFilter = "not-renewed" | "overdue" | "renewed";

export const RENEWAL_FILTERS: { key: RenewalFilter; label: string }[] = [
  { key: "not-renewed", label: "Not renewed" },
  { key: "overdue", label: "Overdue" },
  { key: "renewed", label: "Renewed" },
];

export type AdminRenewalRow = {
  club: ClubRenewalState["club"];
  status: RenewalStatus;
  presidents: RenewalPerson[];
  advisors: RenewalPerson[];
  /** The checks that fail right now, required first, so WSUSA knows how to help. */
  missing: RenewalCheckRow[];
  /** A required check fails: the club can't renew until it's fixed. */
  blocked: boolean;
  renewal: RenewalDone | null;
};

export type RenewalCounts = {
  /** Clubs asked to renew this window (approved before it opened). */
  expected: number;
  renewed: number;
  notRenewed: number;
  overdue: number;
  /** Not renewed, and a required check fails. */
  blocked: number;
  /** Approved after the window opened: their first renewal is next year. */
  startingNextYear: number;
};

/** Every approved club's renewal state, or just the viewer's office's clubs (lib/authz adminClubWhere). */
async function allStates(actor: Actor, now: Date) {
  const { window, term } = await currentRenewalWindow(now);
  const states = await loadRenewalStates(db, { window, term, now, clubs: adminClubWhere(actor) });
  const renewed = states.filter((s) => s.renewal);
  const notRenewed = states.filter((s) => !s.renewal && !s.exemption);
  const counts: RenewalCounts = {
    expected: renewed.length + notRenewed.length,
    renewed: renewed.length,
    notRenewed: notRenewed.length,
    overdue: notRenewed.filter((s) => s.status.kind === "overdue").length,
    blocked: notRenewed.filter((s) => s.blocking.length > 0).length,
    startingNextYear: states.filter((s) => !s.renewal && s.exemption).length,
  };
  return { window, renewed, notRenewed, counts };
}

/**
 * The Renewals tab: one filter's clubs. Clubs that haven't renewed list the
 * ones with a President or advisor to contact first, then by name; renewed
 * clubs are by name.
 */
export async function renewalsForAdmin(actor: Actor | null, opts: { filter?: string | null } = {}, now: Date = new Date()) {
  assertCan(actor, "admin.clubs");
  const filter: RenewalFilter = RENEWAL_FILTERS.some((f) => f.key === opts.filter) ? (opts.filter as RenewalFilter) : "not-renewed";
  const { window, renewed, notRenewed, counts } = await allStates(actor, now);
  // A stable sort, so each group stays in name order.
  const nobody = (s: ClubRenewalState) => (s.presidents.length || s.advisors.length ? 0 : 1);
  const staffedFirst = (list: ClubRenewalState[]) => [...list].sort((a, b) => nobody(a) - nobody(b));
  const shown = filter === "renewed" ? renewed : staffedFirst(filter === "overdue" ? notRenewed.filter((s) => s.status.kind === "overdue") : notRenewed);
  const rows: AdminRenewalRow[] = shown.map((s) => ({
    club: s.club,
    status: s.status,
    presidents: s.presidents,
    advisors: s.advisors,
    missing: checkRows(s.club.slug, s.checks).filter((c) => !c.ok),
    blocked: s.blocking.length > 0,
    renewal: done(s),
  }));
  return { window, filter, rows, counts };
}

/** The admin Overview's count. */
export async function renewalCounts(actor: Actor | null, now: Date = new Date()): Promise<{ window: RenewalWindow | null; counts: RenewalCounts }> {
  assertCan(actor, "admin.access");
  const { window, counts } = await allStates(actor, now);
  return { window, counts };
}
