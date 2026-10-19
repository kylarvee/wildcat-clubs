import { TZDate } from "@date-fns/tz";
import type { LabelTone } from "@/lib/labels/clubs";
import { currentOrLastTermOf, shortAcademicYear } from "@/lib/tests/cycles";
import { campusDate, fmtDate, fmtLongDate, TZ } from "@/lib/time";

/**
 * A club's yearly renewal with WSUSA ("Re-registered 2026–27"): the window,
 * the checks, who may renew and the status names. Pure and client-safe (no
 * database), so the club workspace, the club page, Admin → Club approvals →
 * Renewals, the scheduled job, the seed and its checks all agree.
 * lib/domain/renewals is the write path.
 *
 * Timing: the window opens on the first day of the academic year's first term
 * (lib/terms) and renewal is due `renewal.dueDays` days later (system config),
 * at the end of that campus day. Clubs approved after the window opened start
 * renewing the next year, and College Ambassadors programs (WSUSA's own) don't
 * renew. Missing the deadline changes nothing on its own: no pausing, no
 * retiring. WSUSA decides what to do.
 */

// ─── Names shared with tasks and the activity log ───────────────────────────

/** Task source for renewal tasks. sourceId = renewalSourceId(clubId, year). */
export const RENEWAL_SOURCE = "clubRenewal";
export const renewalSourceId = (clubId: string, year: string) => `${clubId}:${year}`;
/** "Renew RC Wrecker Bots Club for 2026–27" */
export const renewalTaskTitle = (clubName: string, year: string) => `Renew ${clubName} for ${year}`;
export const RENEWAL_TASK_DESCRIPTION =
  "WSUSA re-registers every club once a year. Check the club's details on its workspace Overview and confirm it will be active this academic year.";
/** The one thing nothing can compute: the person renewing confirms it. */
export const activeConfirmation = (clubName: string) => `${clubName} will be active this academic year.`;
export const RENEWAL_NOTE_MAX = 1000;
/** Tasks and bells open the workspace overview at the renewal card. */
export const renewalHref = (slug: string) => `/clubs/${slug}/manage#renewal`;

// ─── The window ──────────────────────────────────────────────────────────────

export type RenewalTerm = { name: string; academicYear: string; startsOn: Date; endsOn: Date };

export type RenewalWindow = {
  /** "2026–27": what people see, and what ClubRenewal.academicYear stores. */
  year: string;
  /** "2026-2027": the Term.academicYear it comes from. */
  termYear: string;
  /** The first day of the academic year's first term. */
  opensAt: Date;
  /** The end of the campus day `dueDays` days after it opens. */
  dueAt: Date;
};

/** The renewal window of the academic year at `now` (the term containing it, else the last one that started). Null without terms. */
export function renewalWindow(terms: RenewalTerm[], now: Date, dueDays: number): RenewalWindow | null {
  const term = currentOrLastTermOf(terms, now);
  if (!term) return null;
  const opensAt = terms.filter((t) => t.academicYear === term.academicYear).reduce((first, t) => (t.startsOn < first ? t.startsOn : first), term.startsOn);
  const day = new TZDate(opensAt, TZ);
  const days = Math.max(0, Math.round(dueDays));
  return { year: shortAcademicYear(term.academicYear), termYear: term.academicYear, opensAt, dueAt: campusDate(day.getFullYear(), day.getMonth() + 1, day.getDate() + days, 23, 59) };
}

/** The term "an event this term" looks at: the one containing `now`, else the next one (between terms, clubs plan ahead). */
export function renewalTerm<T extends RenewalTerm>(terms: T[], now: Date): T | null {
  const sorted = [...terms].sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime());
  return sorted.find((t) => t.startsOn <= now && now <= t.endsOn) ?? sorted.find((t) => t.startsOn > now) ?? null;
}

/** Why a club isn't asked to renew in this window, as a sentence about it, or null when it is asked. */
export function renewalExemption(club: { status: string; type: string; approvedAt: Date | null }, window: RenewalWindow | null): string | null {
  if (!window) return "Renewal opens once the academic calendar has terms.";
  if (club.type === "COLLEGE_AMBASSADORS") return "College ambassador programs don't renew: WSUSA runs them.";
  if (club.status !== "APPROVED") return "Only approved clubs renew with WSUSA.";
  if (club.approvedAt && club.approvedAt >= window.opensAt) return "It was approved this academic year, so it renews starting next year.";
  return null;
}

/** The bell when someone's renewal task opens (lib/jobs/renewals and the seed). `late`: it opened after the due date. */
export function renewalDueNotice(clubName: string, window: RenewalWindow, late: boolean): { title: string; body: string } {
  return {
    title: `Time to renew ${clubName} for ${window.year}`,
    body: late
      ? `${clubName}'s renewal with WSUSA was due ${fmtLongDate(window.dueAt)}. Check the club's details and renew when you can.`
      : `WSUSA re-registers every club once a year. Check ${clubName}'s details and renew by ${fmtDate(window.dueAt, "MMM d")}.`,
  };
}

/** The bell for the club's other Presidents and advisors once someone renewed: their task closed. */
export function renewedNotice(clubName: string, year: string, byName: string): { title: string; body: string } {
  return { title: `${clubName} is re-registered for ${year}`, body: `${byName} renewed the club with WSUSA, so your renewal task is done.` };
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type RenewalStatusKind = "upcoming" | "due" | "overdue" | "renewed";

export type RenewalStatus = {
  kind: RenewalStatusKind;
  /** "Not open yet", "Due Sep 30", "Overdue since Sep 30", "Re-registered 2026–27". */
  label: string;
  /** One sentence for under the label. */
  hint: string;
  tone: LabelTone;
};

/** Re-registered reads as recognition (brand, like Approved): green belongs to "Active" standing alone. */
export const RENEWAL_STATUS_TONE = {
  upcoming: "neutral",
  due: "warning",
  overdue: "danger",
  renewed: "brand",
} as const satisfies Record<RenewalStatusKind, LabelTone>;

export function renewalStatus(input: { window: RenewalWindow | null; now: Date; renewedAt: Date | null; exemption: string | null }): RenewalStatus {
  const { window, now } = input;
  const make = (kind: RenewalStatusKind, label: string, hint: string): RenewalStatus => ({ kind, label, hint, tone: RENEWAL_STATUS_TONE[kind] });
  if (window && input.renewedAt) return make("renewed", `Re-registered ${window.year}`, `Renewed with WSUSA on ${fmtLongDate(input.renewedAt)}.`);
  if (!window) return make("upcoming", "Not open yet", input.exemption ?? "Renewal opens once the academic calendar has terms.");
  if (input.exemption) return make("upcoming", "Not open yet", input.exemption);
  if (now < window.opensAt) return make("upcoming", "Not open yet", `Renewal for ${window.year} opens ${fmtLongDate(window.opensAt)}.`);
  if (now <= window.dueAt) return make("due", `Due ${fmtDate(window.dueAt, "MMM d")}`, `Renew by ${fmtLongDate(window.dueAt)}.`);
  return make("overdue", `Overdue since ${fmtDate(window.dueAt, "MMM d")}`, `It was due ${fmtLongDate(window.dueAt)}. Renew as soon as you can.`);
}

// ─── Checks ──────────────────────────────────────────────────────────────────

export type RenewalCheckKey = "profile" | "president" | "advisor" | "documents" | "vicePresident" | "events";

/** One check as computed, and as ClubRenewal.checks stores it at submission. */
export type RenewalCheck = { key: RenewalCheckKey; label: string; ok: boolean; detail: string };

export type DocState = "active" | "pending" | "missing";

/** What the checks read. lib/renewals/facts loads it; tests build it by hand. */
export type RenewalFacts = {
  /** lib/clubs/profile-rules profileGaps: empty = complete. */
  profileGaps: string[];
  presidents: string[];
  vicePresidents: string[];
  advisors: string[];
  constitution: DocState;
  bylaws: DocState;
  /** renewalTerm(): null when the calendar has no current or coming term. */
  termName: string | null;
  /** Scheduled meetings and events in that term, hosted or co-hosted. */
  eventsThisTerm: number;
};

type CheckDef = {
  label: string;
  /** Required checks block renewal; recommended ones don't. */
  required: boolean;
  /** The fix link: its words and the workspace tool it opens (/clubs/<slug>/manage/<tool>). */
  fix: string;
  tool: string;
  /** "Before X can renew, it needs …" */
  need: string;
  /** When it fails, in a list of clubs (Admin → Renewals, its CSV). */
  missing: string;
};

const CHECKS: Record<RenewalCheckKey, CheckDef> = {
  profile: { label: "Club profile is complete", required: true, fix: "Finish the profile", tool: "profile", need: "a complete club profile", missing: "Profile incomplete" },
  president: { label: "A current President", required: true, fix: "Fill the President seat", tool: "org-chart", need: "a President", missing: "No President" },
  advisor: { label: "A current advisor", required: true, fix: "Invite an advisor", tool: "settings", need: "a faculty or staff advisor", missing: "No advisor" },
  documents: {
    label: "Constitution and bylaws in effect",
    required: true,
    fix: "Open the constitution builder",
    tool: "constitution",
    need: "a constitution and bylaws in effect",
    missing: "Constitution or bylaws not in effect",
  },
  vicePresident: { label: "A Vice President", required: false, fix: "Fill this seat", tool: "org-chart", need: "a Vice President", missing: "No Vice President" },
  events: { label: "An event on the calendar this term", required: false, fix: "Plan an event", tool: "events", need: "an event this term", missing: "No events this term" },
};

/** "No advisor": a failing check in a list of clubs. */
export const missingLabel = (key: RenewalCheckKey) => CHECKS[key].missing;

/** Required first, then recommended: the order every screen lists them in. */
export const RENEWAL_CHECK_KEYS = Object.keys(CHECKS) as RenewalCheckKey[];

export const isRequiredCheck = (key: RenewalCheckKey) => CHECKS[key].required;

/** Where a check is fixed, as a link into the club's workspace. */
export function checkFix(slug: string, key: RenewalCheckKey): { label: string; href: string } {
  return { label: CHECKS[key].fix, href: `/clubs/${slug}/manage/${CHECKS[key].tool}` };
}

/** "Ana Lee", "Ana Lee and Ben Ruiz", "Ana Lee, Ben Ruiz and Cy Park". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function documentsDetail(constitution: DocState, bylaws: DocState): string {
  if (constitution === "active" && bylaws === "active") return "Both are adopted and in effect.";
  if (constitution === "missing" && bylaws === "missing") return "Neither a constitution nor bylaws are in effect yet.";
  const parts: string[] = [];
  for (const [noun, verb, state] of [["constitution", "is", constitution], ["bylaws", "are", bylaws]] as const) {
    if (state === "missing") parts.push(`No ${noun} in effect yet.`);
    if (state === "pending") parts.push(`Your custom ${noun} ${verb} waiting for WSUSA approval.`);
  }
  return parts.join(" ");
}

/** The checks, in RENEWAL_CHECK_KEYS order. */
export function renewalChecks(f: RenewalFacts): RenewalCheck[] {
  const n = f.eventsThisTerm;
  const detail: Record<RenewalCheckKey, [boolean, string]> = {
    profile: [f.profileGaps.length === 0, f.profileGaps.length ? `Still needed: ${f.profileGaps.join(", ")}.` : "Name, descriptions, category and where the club sits are all filled in."],
    president: [f.presidents.length > 0, f.presidents.length ? joinNames(f.presidents) : "Nobody holds the President seat right now."],
    advisor: [f.advisors.length > 0, f.advisors.length ? joinNames(f.advisors) : "Every club needs a Weber State faculty or staff advisor."],
    documents: [f.constitution === "active" && f.bylaws === "active", documentsDetail(f.constitution, f.bylaws)],
    vicePresident: [
      f.vicePresidents.length > 0,
      f.vicePresidents.length ? joinNames(f.vicePresidents) : "No Vice President right now. A VP backs up the President and is next in line for the seat.",
    ],
    events: [
      Boolean(f.termName) && n > 0,
      !f.termName ? "There's no current term on the academic calendar." : n > 0 ? `${n} ${n === 1 ? "event" : "events"} on the calendar for ${f.termName}.` : `Nothing on the calendar for ${f.termName} yet.`,
    ],
  };
  return RENEWAL_CHECK_KEYS.map((key) => ({ key, label: CHECKS[key].label, ok: detail[key][0], detail: detail[key][1] }));
}

/** Required checks that fail: any of them blocks renewal. */
export function blockingChecks(checks: RenewalCheck[]): RenewalCheck[] {
  return checks.filter((c) => isRequiredCheck(c.key) && !c.ok);
}

/** "Before Microbiology Club can renew, it needs a faculty or staff advisor." */
export function blockedMessage(clubName: string, blocking: RenewalCheck[]): string {
  const needs = blocking.map((c) => CHECKS[c.key].need);
  return `Before ${clubName} can renew, it needs ${joinNames(needs)}.`;
}

/** What ClubRenewal.checks stores: plain JSON, nothing derived. */
export function snapshotChecks(checks: RenewalCheck[]): RenewalCheck[] {
  return checks.map(({ key, label, ok, detail }) => ({ key, label, ok, detail }));
}

/** Reads a stored snapshot back, dropping anything malformed. */
export function readSnapshot(value: unknown): RenewalCheck[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const c = v as Partial<RenewalCheck> | null;
    if (!c || typeof c !== "object" || typeof c.key !== "string" || !(c.key in CHECKS) || typeof c.ok !== "boolean") return [];
    return [{ key: c.key, label: typeof c.label === "string" ? c.label : CHECKS[c.key].label, ok: c.ok, detail: typeof c.detail === "string" ? c.detail : "" }];
  });
}

// ─── Who renews ──────────────────────────────────────────────────────────────

/** The parts of lib/authz ClubAccess the rule reads. */
export type RenewerAccess = { viaPlatform: string | null; isAdvisor: boolean; role: string | null; suspended: boolean };

/** The President, a Vice President, an advisor or an admin. Paused leaders wait until they're caught up. */
export function mayRenew(a: RenewerAccess): boolean {
  return a.viaPlatform !== null || a.isAdvisor || (!a.suspended && (a.role === "PRESIDENT" || a.role === "VP"));
}

/** Why this person can't renew the club, or null when they can (the club's own state aside). */
export function renewerBlocker(a: RenewerAccess, clubName: string): string | null {
  if (mayRenew(a)) return null;
  if (a.suspended && (a.role === "PRESIDENT" || a.role === "VP")) return "Your leadership permissions are paused until you finish your overdue WSUSA requirement. Your advisor can renew in the meantime.";
  return `Only the President, a Vice President, an advisor or WSUSA can renew ${clubName}.`;
}
