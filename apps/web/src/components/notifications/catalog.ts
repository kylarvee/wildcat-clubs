/**
 * The notification registry: every notification kind the code sends, once
 * (the `kind` of each lib/domain/notify call, like "event.changed"), with the
 * Settings → Notifications category it belongs to and the channels it uses by
 * default. In-app (the bell) is always on. Pure and import-free, so the seed's
 * verify.ts can read it too.
 *
 * notify() asks resolveDelivery() about every recipient. A person's choice for
 * the kind's category beats the defaults, including a call site's situational
 * default ("a cancellation within 48 hours also emails"). The master "Email me
 * notifications" switch turns every email off. Two marks change that:
 * `always` (account and security notices reach everyone by email and push,
 * whatever their settings say) and `admins: "digest"` (WSUSA admins get these
 * in one daily email instead of one each; lib/jobs/notifications).
 *
 * catalog.test.ts reads the source and fails on a kind sent without an entry
 * here, and on an entry nothing sends; prisma/seed/verify.ts fails on a seeded
 * notification of any other kind, so the test bells only show what the app
 * really sends. Icons live in kinds.ts.
 */

// ─── Categories ──────────────────────────────────────────────────────────────

/** Settings → Notifications rows, in order. `key` is what User.notificationPrefs stores. */
export const NOTIFICATION_CATEGORIES = [
  {
    key: "events",
    label: "Events & reminders",
    hint: "Cancellations, moves and reminders for events at clubs you're in or follow, check-ins a leader adds for you, co-hosting, and your club's event reviews.",
    adminHint: "Events sent to your office for review come in your daily digest.",
  },
  { key: "membership", label: "Membership", hint: "Join requests and their answers, to-dos your clubs give you, and forming clubs you follow being approved." },
  {
    key: "leadership",
    label: "Leadership & elections",
    hint: "Your roles and elections, co-founders, advisors and ambassadors, and WSUSA's decisions on your club.",
    note: "Always sent: a club you lead losing its last President, advisor or member who approves join requests.",
    adminHint: "Club submissions, revival requests and custom documents come in your daily digest.",
  },
  { key: "requirements", label: "WSUSA requirements", hint: "Requirements, trainings, tests and forms to finish, their due dates, and your club's yearly renewal." },
  { key: "funding", label: "Funding", hint: "Funding requests and invoices for the clubs whose budget you help run.", adminHint: "New funding requests come in your daily digest." },
  { key: "announcements", label: "Announcements", hint: "New posts from your clubs and from WSUSA." },
  { key: "messages", label: "Messages", hint: "Direct messages, leader groups and files shared with you." },
  {
    key: "reviews",
    label: "Reviews & reports",
    hint: "When you can review a club, reviews of yours that were hidden, and reports you sent.",
    adminHint: "New reports and possible review bombing are emailed as they happen; flagged reviews come in your daily digest.",
  },
  { key: "account", label: "Your account", hint: "Graduating, and changes to your administrator access. These always reach you by email and push." },
] as const satisfies readonly { key: string; label: string; hint: string; note?: string; adminHint?: string }[];

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]["key"];
export type Channel = "email" | "push";

// ─── Kinds ───────────────────────────────────────────────────────────────────

export type KindRule = {
  category: NotificationCategory;
  /** Emailed by default. */
  email: boolean;
  /** Pushed to the phone app by default. */
  push: boolean;
  /** Account and security notices: in-app, email and push for everyone, whatever their settings say (even with email off). */
  always?: true;
  /**
   * WSUSA admins (and an office's staff, for their office's work) hear about
   * it by email in the daily digest instead of one email each; in-app and
   * push still arrive at once. Admins who turn the
   * digest off get these emails one at a time. Everyone else follows `email`.
   */
  admins?: "digest";
};

export const NOTIFICATION_REGISTRY = {
  "advisor.accepted": { category: "leadership", email: true, push: true },
  "advisor.declined": { category: "leadership", email: true, push: true },
  // The invitation itself is emailed separately (lib/domain/advisors), since it can reach someone without an account.
  "advisor.invited": { category: "leadership", email: false, push: true },
  "ambassador.advisor_set": { category: "leadership", email: false, push: true },
  "ambassador.placed": { category: "leadership", email: false, push: true },
  "ambassador.placement_ended": { category: "leadership", email: true, push: true },
  "ambassador.request_declined": { category: "leadership", email: true, push: true },
  "ambassador.requested": { category: "leadership", email: false, push: true },
  "announcement.new": { category: "announcements", email: true, push: true },
  "attendance.added": { category: "events", email: false, push: true },
  "club.approved": { category: "leadership", email: true, push: true },
  "club.changes_requested": { category: "leadership", email: true, push: true },
  "club.department_added": { category: "leadership", email: false, push: true },
  // Followers of a club that was forming (and co-founder invitees whose invitation closed) hear it's official (lib/domain/clubs decideClub).
  "club.forming_approved": { category: "membership", email: true, push: true },
  "club.google_account_verified": { category: "leadership", email: false, push: true },
  // WSUSA moved the club to another office (lib/domain/offices): its leaders hear who oversees it now.
  "club.office_changed": { category: "leadership", email: true, push: true },
  "club.reinstated": { category: "leadership", email: true, push: true },
  "club.rejected": { category: "leadership", email: true, push: true },
  "club.renewal_due": { category: "requirements", email: true, push: true },
  "club.renewed": { category: "requirements", email: false, push: true },
  "club.retired": { category: "leadership", email: true, push: true },
  // The student who asked to bring a retired club back hears the office's answer.
  "club.revival_approved": { category: "leadership", email: true, push: true },
  "club.revival_declined": { category: "leadership", email: true, push: true },
  // A request to bring a retired club back, for its office's staff (notifyOffice); in the admins' digest.
  "club.revival_requested": { category: "leadership", email: false, push: true, admins: "digest" },
  // The founders' copy stays in-app; WSUSA's comes in the digest.
  "club.submitted": { category: "leadership", email: false, push: true, admins: "digest" },
  // Co-founder invitations (lib/domain/cofounders): the invitee with an account, and the founders hearing back.
  "cofounder.accepted": { category: "leadership", email: false, push: true },
  "cofounder.declined": { category: "leadership", email: false, push: true },
  // Someone without an account gets the invitation by email instead (it has no kind).
  "cofounder.invited": { category: "leadership", email: true, push: true },
  // A report of concern reaches WSUSA right away (never with its content).
  "complaint.new": { category: "reviews", email: true, push: true },
  "complaint.received": { category: "reviews", email: false, push: false },
  "complaint.updated": { category: "reviews", email: false, push: false },
  "constitution.adopted": { category: "leadership", email: false, push: true },
  "constitution.custom_approved": { category: "leadership", email: true, push: true },
  "constitution.custom_rejected": { category: "leadership", email: true, push: true },
  "constitution.custom_submitted": { category: "leadership", email: false, push: true, admins: "digest" },
  "constitution.settings_changed": { category: "leadership", email: false, push: false, admins: "digest" },
  "election.accepted": { category: "leadership", email: false, push: true },
  "election.applied": { category: "leadership", email: false, push: true },
  "election.cancelled": { category: "leadership", email: false, push: true },
  "election.candidate_added": { category: "leadership", email: false, push: true },
  "election.created": { category: "leadership", email: true, push: true },
  "election.next_in_line": { category: "leadership", email: true, push: true },
  "election.nominated": { category: "leadership", email: true, push: true },
  "election.nominations_open": { category: "leadership", email: false, push: true },
  "election.proposal_declined": { category: "leadership", email: true, push: true },
  "election.proposal_withdrawn": { category: "leadership", email: false, push: true },
  "election.proposed": { category: "leadership", email: true, push: true },
  "election.results": { category: "leadership", email: false, push: true },
  "election.voting_opened": { category: "leadership", email: true, push: true },
  "election.withdrawn": { category: "leadership", email: false, push: true },
  // A cancellation within 48 hours also emails (lib/events/notices decides; the call site passes it).
  "event.cancelled": { category: "events", email: false, push: true },
  "event.changed": { category: "events", email: false, push: true },
  "event.cohost_added": { category: "events", email: false, push: true },
  "event.cohost_approved": { category: "events", email: false, push: true },
  "event.cohost_cancelled": { category: "events", email: true, push: true },
  "event.cohost_changed": { category: "events", email: false, push: true },
  "event.cohost_declined": { category: "events", email: false, push: true },
  // Inviting every club at once stays off email (the call site says so).
  "event.cohost_request": { category: "events", email: true, push: true },
  // The club's office approved an event it reviewed (lib/events/review): its creator and events holders hear.
  "event.review_approved": { category: "events", email: true, push: true },
  // The office sent an event back with a note.
  "event.review_changes_requested": { category: "events", email: true, push: true },
  // An event sent to the club's office for review (notifyOffice); office staff and admins get it in the digest.
  "event.review_requested": { category: "events", email: false, push: true, admins: "digest" },
  "event.starting_soon": { category: "events", email: false, push: true },
  "file.shared": { category: "messages", email: true, push: false },
  "funding.approved": { category: "funding", email: true, push: true },
  "funding.denied": { category: "funding", email: true, push: true },
  // WSUSA admins, once per request in review past the office's review time (lib/jobs/funding).
  "funding.overdue": { category: "funding", email: false, push: false },
  "funding.partially_approved": { category: "funding", email: true, push: true },
  // The submitter's fellow budget holders hear in-app; WSUSA's copy comes in the digest.
  "funding.submitted": { category: "funding", email: false, push: true, admins: "digest" },
  "funding.withdrawn": { category: "funding", email: false, push: false },
  "invoice.created": { category: "funding", email: false, push: false },
  // WSUSA admins, once per invoice still open past its due date (lib/jobs/funding).
  "invoice.overdue": { category: "funding", email: false, push: false },
  "invoice.processed": { category: "funding", email: true, push: true },
  "membership.approved": { category: "membership", email: true, push: true },
  "membership.declined": { category: "membership", email: true, push: true },
  "membership.requested": { category: "membership", email: false, push: true },
  "message.group_added": { category: "messages", email: false, push: true },
  "message.new": { category: "messages", email: false, push: true },
  // Admin access for an office's clubs (lib/domain/offices), like an administrator's.
  "office.staff_added": { category: "account", email: true, push: true, always: true },
  "office.staff_removed": { category: "account", email: true, push: true, always: true },
  "profile.alumni": { category: "account", email: true, push: true, always: true },
  "project.added": { category: "leadership", email: false, push: true },
  "requirement.assigned": { category: "requirements", email: true, push: true },
  "requirement.due_soon": { category: "requirements", email: true, push: true },
  "requirement.overdue": { category: "requirements", email: true, push: true },
  // Possible review bombing reaches WSUSA right away.
  "review.bombing": { category: "reviews", email: true, push: true },
  "review.flagged": { category: "reviews", email: false, push: true, admins: "digest" },
  "review.hidden": { category: "reviews", email: true, push: false },
  "review.unlocked": { category: "reviews", email: false, push: true },
  "role.assigned": { category: "leadership", email: true, push: true },
  "role.ended": { category: "leadership", email: true, push: true },
  "role.handoff": { category: "leadership", email: true, push: true },
  "role.vacated": { category: "leadership", email: false, push: true },
  // A club left without its last President, advisor or approver (lib/domain/staffing).
  "staffing.gap": { category: "leadership", email: true, push: true, always: true },
  "system.admin_granted": { category: "account", email: true, push: true, always: true },
  "system.admin_revoked": { category: "account", email: true, push: true, always: true },
  "system.sysadmin_granted": { category: "account", email: true, push: true, always: true },
  "system.sysadmin_revoked": { category: "account", email: true, push: true, always: true },
  "task.assigned": { category: "membership", email: true, push: true },
  "task.completed": { category: "membership", email: false, push: false },
  "test.assigned": { category: "requirements", email: true, push: true },
  // A test's "Notify admins" automation: a university test's goes to WSUSA (digest), a club test's to its leaders.
  "test.automation": { category: "requirements", email: true, push: true, admins: "digest" },
  "test.completed": { category: "requirements", email: true, push: true },
  "test.failed": { category: "requirements", email: true, push: true },
  "test.missed": { category: "requirements", email: true, push: true },
  "test.permissions_paused": { category: "requirements", email: true, push: true },
  "test.permissions_resumed": { category: "requirements", email: true, push: true },
} as const satisfies Record<string, KindRule>;

export type NotificationKind = keyof typeof NOTIFICATION_REGISTRY;

/** Every kind, in registry order (sorted; catalog.test.ts checks). */
export const NOTIFICATION_KINDS = Object.keys(NOTIFICATION_REGISTRY) as NotificationKind[];

const KINDS = new Set<string>(NOTIFICATION_KINDS);

/** Is this a kind the code sends? */
export function isNotificationKind(kind: string): kind is NotificationKind {
  return KINDS.has(kind);
}

/** A kind's rule, or null for a kind the registry doesn't know (catalog.test.ts keeps those out of the code). */
export function kindRule(kind: string): KindRule | null {
  return isNotificationKind(kind) ? NOTIFICATION_REGISTRY[kind] : null;
}

/** The kinds in a category, in registry order. */
export function kindsIn(category: NotificationCategory): NotificationKind[] {
  return NOTIFICATION_KINDS.filter((k) => NOTIFICATION_REGISTRY[k].category === category);
}

/** The kinds WSUSA admins get in the daily digest instead of one email each. */
export const DIGEST_KINDS: NotificationKind[] = NOTIFICATION_KINDS.filter((k) => (NOTIFICATION_REGISTRY[k] as KindRule).admins === "digest");

// ─── People's choices ────────────────────────────────────────────────────────

/** The admins' daily digest switch, kept in User.notificationPrefs beside the categories ({ email: false } = off). */
export const DIGEST_PREF = "adminDigest";

export type Choice = { email?: boolean; push?: boolean };
export type PrefKey = NotificationCategory | typeof DIGEST_PREF;
/** User.notificationPrefs: { [category]: { email?, push? } }. A missing value means "the defaults". */
export type NotificationPrefs = Partial<Record<PrefKey, Choice>>;

const PREF_KEYS = new Set<string>([...NOTIFICATION_CATEGORIES.map((c) => c.key), DIGEST_PREF]);

/** User.notificationPrefs as stored (any JSON) → known keys with boolean choices only. */
export function readPrefs(json: unknown): NotificationPrefs {
  const out: NotificationPrefs = {};
  if (!json || typeof json !== "object" || Array.isArray(json)) return out;
  for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
    if (!PREF_KEYS.has(key) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    const choice: Choice = {};
    if (typeof v.email === "boolean") choice.email = v.email;
    if (typeof v.push === "boolean") choice.push = v.push;
    if (choice.email !== undefined || choice.push !== undefined) out[key as PrefKey] = choice;
  }
  return out;
}

/** The daily digest is on unless the admin turned it off. */
export function digestOn(prefs: NotificationPrefs): boolean {
  return prefs[DIGEST_PREF]?.email !== false;
}

/** Every kind in the category is `always`: its row has no switches. */
export function categoryAlways(category: NotificationCategory): boolean {
  return kindsIn(category).every((k) => (NOTIFICATION_REGISTRY[k] as KindRule).always === true);
}

/**
 * What a category's switch shows before the person chooses: on when any of
 * its kinds uses the channel by default (for admins, digest kinds count as
 * email). Today every category starts on for both, so a switch turns its
 * category off or back to the defaults.
 */
export function categoryDefault(category: NotificationCategory, channel: Channel, who: { admin: boolean }): boolean {
  return kindsIn(category).some((k) => {
    const rule: KindRule = NOTIFICATION_REGISTRY[k];
    return rule.always === true || rule[channel] || (channel === "email" && who.admin && rule.admins === "digest");
  });
}

/** A switch's state: the person's choice, else the category's default. */
export function categoryChoice(prefs: NotificationPrefs, category: NotificationCategory, channel: Channel, who: { admin: boolean }): boolean {
  return prefs[category]?.[channel] ?? categoryDefault(category, channel, who);
}

/**
 * The prefs after one switch changes. Choosing what the category does by
 * default clears the choice (back to each kind's defaults); the other way is
 * stored. The digest switch is on by default.
 */
export function withChoice(prefs: NotificationPrefs, key: PrefKey, channel: Channel, on: boolean, who: { admin: boolean }): NotificationPrefs {
  const usual = key === DIGEST_PREF ? true : categoryDefault(key, channel, who);
  const next: NotificationPrefs = { ...prefs };
  const choice: Choice = { ...next[key] };
  if (on === usual) delete choice[channel];
  else choice[channel] = on;
  if (choice.email === undefined && choice.push === undefined) delete next[key];
  else next[key] = choice;
  return next;
}

// ─── Who gets what ───────────────────────────────────────────────────────────

export type Recipient = {
  /** The master "Email me notifications" switch (User.emailNotifications). */
  emailOn: boolean;
  /** A WSUSA admin (platform role ADMIN or SYSADMIN). */
  admin: boolean;
  prefs: NotificationPrefs;
};

/** How one notice reaches one person besides the bell: email now, in the admins' daily digest, or not; push or not. */
export type Delivery = { email: "now" | "digest" | "off"; push: boolean };

/**
 * The one rule (lib/domain/notify applies it to every recipient):
 *   1. `always` kinds: email and push, whatever the settings say.
 *   2. Otherwise each channel is the person's choice for the kind's category,
 *      else the call site's situational default, else the kind's default.
 *   3. The master email switch off: no email.
 *   4. Digest kinds for an admin: in the daily digest, unless they turned it
 *      off; then one email each (unless their category choice says no).
 */
export function resolveDelivery(kind: string, who: Recipient, callSite: Choice = {}): Delivery {
  const rule = kindRule(kind);
  if (!rule) return { email: who.emailOn && callSite.email !== false ? "now" : "off", push: callSite.push !== false };
  if (rule.always) return { email: "now", push: true };
  const choice = who.prefs[rule.category] ?? {};
  const push = choice.push ?? callSite.push ?? rule.push;
  if (!who.emailOn) return { email: "off", push };
  if (who.admin && rule.admins === "digest") {
    if (digestOn(who.prefs)) return { email: "digest", push };
    return { email: (choice.email ?? callSite.email ?? true) ? "now" : "off", push };
  }
  return { email: (choice.email ?? callSite.email ?? rule.email) ? "now" : "off", push };
}
