import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
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
  renewalSourceId,
  renewalTerm,
  renewalWindow,
  renewedNotice,
  renewerBlocker,
  snapshotChecks,
  type RenewalCheck,
  type RenewalStatus,
  type RenewalWindow,
} from "@/lib/renewals/rules";

/**
 * Yearly club renewal with WSUSA: the write path for ClubRenewal, and the
 * reads the workspace overview, the club page and Admin → Club approvals →
 * Renewals use. The rules (window, checks, status names, who renews) are pure
 * in lib/renewals/rules; the "Club renewals" scheduled job that opens and
 * closes the tasks is lib/jobs/renewals.
 *
 * Renewing is the club's own act, not a review. It writes the ClubRenewal
 * with the checks as they stood, logs club.renewed (public), closes the
 * club's renewal tasks for everyone and tells WSUSA nothing. A club that
 * doesn't renew loses nothing automatically: WSUSA sees it on the Renewals
 * tab and decides.
 */

/** This academic year's window (null without terms), and the term "an event this term" reads. */
export async function currentRenewalWindow(now: Date = new Date()) {
  const [terms, cfg] = await Promise.all([getTerms(), getConfig()]);
  return { window: renewalWindow(terms, now, cfg["renewal.dueDays"]), term: renewalTerm(terms, now) };
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
  window: RenewalWindow | null;
  status: RenewalStatus;
  checks: RenewalCheckRow[];
  renewal: RenewalDone | null;
  /** The overview shows the card while renewal is due or late, and once the club renewed. */
  showCard: boolean;
  canRenew: boolean;
  /** Why the Renew button is off, in plain words; null when it's on or the club already renewed. */
  whyNot: string | null;
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
  return {
    club: { id: state.club.id, name: state.club.name, slug: state.club.slug },
    window,
    status,
    checks: checkRows(state.club.slug, state.checks),
    renewal: done(state),
    showCard: status.kind !== "upcoming",
    canRenew: whyNot === null && (status.kind === "due" || status.kind === "overdue"),
    whyNot,
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
      await logActivity({ actorId: actor.id, action: "club.renewed", entityType: "club", entityId: state.club.id, clubId: state.club.id, data: { year: window.year }, isPublic: true }, tx);
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
    ...renewedNotice(name, window.year, actor.name),
    href: `/clubs/${state.club.slug}/manage`,
    email: false,
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

async function allStates(now: Date) {
  const { window, term } = await currentRenewalWindow(now);
  const states = await loadRenewalStates(db, { window, term, now });
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
  const { window, renewed, notRenewed, counts } = await allStates(now);
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
  const { window, counts } = await allStates(now);
  return { window, counts };
}
