import { fmtDate, fmtTime, inCampusTime } from "@/lib/time";

/**
 * The rules behind the daily digest (pure; lib/jobs/notifications sends it):
 * when it's due, the ReminderLog key that keeps it to once a day, and what it
 * says. The digest replaces one email per club submission, funding request,
 * custom document or flagged review (the registry's `admins: "digest"` kinds)
 * with one morning email: what's waiting in the reader's office queue (WSUSA's
 * for WSUSA staff, their own office's for an office's staff; lib/analytics/admin
 * officeQueue, the one definition) and the notices held back since the last
 * digest.
 */

/** The digest goes out with the first scheduled run at or after this hour, campus time. */
export const DIGEST_HOUR = 7;

export const DIGEST_KEY_PREFIX = "digest:admins:";

/** One digest per campus day: digest:admins:2026-10-19. */
export function digestKey(now: Date): string {
  return `${DIGEST_KEY_PREFIX}${fmtDate(now, "yyyy-MM-dd")}`;
}

export function digestDue(now: Date): boolean {
  return inCampusTime(now).getHours() >= DIGEST_HOUR;
}

/** How far back "new since the last digest" reaches when there's no earlier digest on record. */
export const DIGEST_LOOKBACK_MS = 86_400_000;

/** At most this many held-back notices are listed; the rest are counted. */
export const DIGEST_LIST_MAX = 15;

export type DigestRow = { label: string; count: number; oldest: Date | null; href: string; urgent: boolean };
export type DigestNotice = { title: string; createdAt: Date };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * The email, or null when there's nothing to say (nothing waiting and nothing
 * new). Plain text with full links, like every platform email; `href` is the
 * admin Overview, which sendEmail puts under the body.
 */
export function digestEmail(o: {
  rows: DigestRow[];
  notices: DigestNotice[];
  /** Held-back notices beyond the listed ones. */
  more: number;
  /** When the previous digest went out, or null when this is the first. */
  since: Date | null;
  now: Date;
  appUrl: string;
  /** Whose queue it is: "WSUSA", or an office's short name ("Campus Rec"). */
  office?: string;
}): { subject: string; body: string; href: string } | null {
  const waiting = o.rows.filter((r) => r.count > 0);
  const total = waiting.reduce((n, r) => n + r.count, 0);
  const fresh = o.notices.length + o.more;
  if (!total && !fresh) return null;
  const office = o.office ?? "WSUSA";
  const day = fmtDate(o.now, "EEE, MMM d");
  const url = (href: string) => (href.startsWith("http") ? href : `${o.appUrl.replace(/\/$/, "")}${href}`);
  const lines: string[] = [total ? `Here's what's waiting on ${office} in Wildcat Clubs this ${fmtDate(o.now, "EEEE")}.` : `Nothing is waiting on ${office} right now. Here's what came in since the last digest.`];

  if (total) {
    lines.push("", `WAITING ON ${office.toUpperCase()} (${total.toLocaleString("en-US")})`);
    for (const r of waiting) {
      const oldest = r.oldest ? `, ${r.count === 1 ? "waiting" : "the oldest waiting"} since ${fmtDate(r.oldest, "MMM d")}` : "";
      lines.push(`• ${r.label}: ${r.count.toLocaleString("en-US")}${oldest}${r.urgent ? " (urgent)" : ""}`, `  ${url(r.href)}`);
    }
  }
  if (fresh) {
    const since = o.since ? `since ${fmtDate(o.since, "EEE")} at ${fmtTime(o.since)}` : "in the last day";
    lines.push("", `NEW ${since.toUpperCase()} (${fresh.toLocaleString("en-US")})`);
    for (const n of o.notices) lines.push(`• ${n.title}`);
    if (o.more) lines.push(`• …and ${plural(o.more, "more notice")} on your bell.`);
  }
  lines.push(
    "",
    "New reports, possible review bombing and clubs that lose a leader are still emailed as they happen.",
    `Turn this digest off in Settings → Notifications: ${url("/settings/notifications")}`,
  );
  return {
    subject: total ? `Waiting on ${office}: ${plural(total, "item")} · ${day}` : `${office} digest · ${day}`,
    body: lines.join("\n"),
    href: "/admin",
  };
}
