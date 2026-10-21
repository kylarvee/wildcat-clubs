import "server-only";
import type { ClubRole } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { adminScope, CAPABILITIES, getClubAccess, isAdmin, isSysadmin, ROLE_LABEL, ROLE_RANK } from "@/lib/authz";
import { getConfig } from "@/lib/config";
import { currentOrLastTerm, getTerms, nextTerm, termAt } from "@/lib/terms";
import { fmtDate } from "@/lib/time";
import { INSTITUTION } from "@/lib/institution";
import { CONTEXT_MARKER } from "@/lib/ai/knowledge";
import { listOffices } from "@/lib/offices";

/**
 * The per-person context note. It's sent as a mid-conversation system message
 * right after the person's message — after the cached prefix — and appended
 * again only when it changes (a new day, a new club, a new role), so the
 * conversation history stays append-only and cacheable.
 *
 * Day-level only: no clock time, or the note would change on every message.
 */

/** Recognition in the platform's words (lib/labels/clubs), with what it means for a founder. */
const STATUS_WORD: Record<string, string> = {
  DRAFT: "Draft: founding, not yet submitted for review",
  SUBMITTED: "In review with its office",
  CHANGES_REQUESTED: "Changes requested by its office",
  APPROVED: "Approved",
  REJECTED: "Not approved by its office",
  RETIRED: "Retired",
};

export async function buildContextNote(actor: Actor, now = new Date()): Promise<string> {
  const [cfg, terms, memberships, roles, subs, offices] = await Promise.all([
    getConfig(),
    getTerms(),
    db.membership.findMany({
      where: { userId: actor.id, status: { in: ["ACTIVE", "PENDING"] } },
      select: { status: true, club: { select: { id: true, name: true, slug: true, status: true, officeId: true } } },
    }),
    db.roleAssignment.findMany({
      where: { userId: actor.id, endedAt: null },
      select: { role: true, position: { select: { name: true } }, club: { select: { id: true, name: true, slug: true, status: true, officeId: true } } },
    }),
    db.calendarSubscription.findMany({ where: { userId: actor.id }, select: { club: { select: { id: true, name: true } } } }),
    // Who oversees clubs (lib/offices), the umbrella (WSUSA) first.
    listOffices(),
  ]);
  const officeName = (officeId: string | null) => (officeId ? offices.find((o) => o.id === officeId)?.name : null) ?? null;

  const lines: string[] = [CONTEXT_MARKER];

  // ── When ──
  const term = termAt(terms, now);
  const termLine = term
    ? `Current term: ${term.name} (${fmtDate(term.startsOn, "MMM d")} – ${fmtDate(term.endsOn, "MMM d, yyyy")}).`
    : (() => {
        const last = currentOrLastTerm(terms, now);
        const next = nextTerm(terms, now);
        if (!last && !next) return "The academic calendar has no terms set up yet.";
        return `Between terms${last ? ` — ${last.name} ended ${fmtDate(last.endsOn, "MMM d, yyyy")}` : ""}${next ? `; ${next.name} starts ${fmtDate(next.startsOn, "MMM d, yyyy")} and ends ${fmtDate(next.endsOn, "MMM d, yyyy")}` : ""}.`;
      })();
  lines.push(`Today is ${fmtDate(now, "EEEE, MMMM d, yyyy")} (campus time, ${INSTITUTION.timezone}). ${termLine}`);

  // ── Who ──
  const kind = actor.kind === "STUDENT" ? `student (@${INSTITUTION.studentEmailDomain} account)` : `faculty/staff (@${INSTITUTION.staffEmailDomain} account)`;
  const platform = isSysadmin(actor)
    ? "system administrator (full access, including system settings)"
    : isAdmin(actor)
      ? "WSUSA administrator (full access to every club and the admin tools; no system settings)"
      : "regular user";
  const status = actor.status === "ALUMNI" ? " Account status: alumni (can't join new clubs, check in or write reviews)." : "";
  // Office staff run the admin console for their own office's clubs only (lib/authz adminScope).
  const staffOf = adminScope(actor).all ? [] : offices.filter((o) => !o.umbrella && (actor.officeIds ?? []).includes(o.id)).map((o) => o.name);
  const staffNote = staffOf.length
    ? ` They're on ${staffOf.join(" and ")}'s staff: the admin console (/admin) for the clubs ${staffOf.length === 1 ? "that office oversees" : "those offices oversee"}, its queue, club approvals, renewals, analytics and tests, but not WSUSA's platform-wide tools (people, the directory, policies, review moderation, reports, university-wide announcements, system settings).`
    : "";
  lines.push(`You're helping ${actor.name}, a ${kind}. Platform role: ${platform}.${status}${staffNote}`);

  // ── Their clubs ──
  type Entry = { name: string; slug: string; status: string; office: string | null; roles: { role: ClubRole; seat: string | null }[]; member: boolean; pending: boolean; clubId: string };
  const byClub = new Map<string, Entry>();
  const entry = (c: { id: string; name: string; slug: string; status: string; officeId: string | null }) => {
    let e = byClub.get(c.id);
    if (!e) {
      e = { clubId: c.id, name: c.name, slug: c.slug, status: c.status, office: officeName(c.officeId), roles: [], member: false, pending: false };
      byClub.set(c.id, e);
    }
    return e;
  };
  for (const m of memberships) {
    const e = entry(m.club);
    if (m.status === "ACTIVE") e.member = true;
    else e.pending = true;
  }
  for (const r of roles) entry(r.club).roles.push({ role: r.role, seat: r.position?.name ?? null });

  const clubLines: string[] = [];
  const pendingNames: string[] = [];
  const entries = [...byClub.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.pending && !e.roles.length) {
      pendingNames.push(e.name);
      continue;
    }
    const top = [...e.roles].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role])[0];
    const roleText = e.roles.length
      ? e.roles.map((r) => (r.seat && r.seat !== ROLE_LABEL[r.role] ? `${r.seat} (${ROLE_LABEL[r.role]})` : ROLE_LABEL[r.role])).join(" and ")
      : "member";
    let caps = "";
    if (top && ROLE_RANK[top.role] >= 1) {
      const access = await getClubAccess(actor, e.clubId);
      if (access?.suspended) caps = "; permissions paused until an overdue WSUSA requirement is done";
      else if (access) {
        const list = [...access.capabilities].map((c) => CAPABILITIES[c].label);
        caps = top.role === "PRESIDENT" || top.role === "VP" || top.role === "ADVISOR" ? "; every permission this phase allows" : list.length ? `; permissions: ${list.join(", ")}` : "; no permissions granted";
      }
    }
    const statusNote = e.status === "APPROVED" ? "" : ` [${STATUS_WORD[e.status] ?? e.status.toLowerCase()}]`;
    const href = top && ROLE_RANK[top.role] >= 1 ? `/clubs/${e.slug}/manage` : `/clubs/${e.slug}`;
    clubLines.push(`- ${e.name}${statusNote}: ${roleText}${caps}${e.office ? `; overseen by ${e.office}` : ""} (${href})`);
  }
  if (clubLines.length) lines.push(`Their clubs:\n${clubLines.join("\n")}`);
  else lines.push(isAdmin(actor) ? "They aren't a member of any club themselves." : "They haven't joined any clubs yet.");
  if (pendingNames.length) lines.push(`Join requests waiting for a club's approval: ${pendingNames.join(", ")}.`);
  const subOnly = subs.filter((s) => !byClub.get(s.club.id)?.member).map((s) => s.club.name);
  if (subOnly.length) lines.push(`Calendars they follow without being a member: ${subOnly.sort().join(", ")}.`);

  // ── Today's rules (sysadmin-configurable) ──
  lines.push(
    [
      "Current platform settings:",
      `- Active student: attended in the last ${cfg["activity.studentWindowDays"]} days, or one of the club's last ${cfg["activity.studentRecentEvents"]} held events.`,
      `- Active (club standing): at least ${cfg["activity.clubMinEvents"]} held events in the current or previous term and at least ${cfg["activity.clubMinMembers"]} registered members (waived during the pilot period).`,
      `- Reviews unlock after attending ${cfg["reviews.minAttendance"]} of a club's events.`,
      `- Check-in opens ${cfg["checkin.opensMinutesBefore"]} minutes before an event and closes ${cfg["checkin.closesMinutesAfter"]} minutes after it ends.`,
      cfg["app.iosUrl"].trim() || cfg["app.androidUrl"].trim()
        ? "- The mobile app is in the stores: links are at /get-the-app."
        : "- The mobile app isn't in the App Store or Google Play yet, so don't suggest downloading it. Everything works on the web: pointing a phone's camera at a meeting's check-in QR code opens check-in in the browser.",
    ].join("\n"),
  );
  // Each office's contacts as set in Admin → Offices; any field can be blank, so mention only what's set.
  const reviewers = (cfg["wsusa.reviewers"] ?? []).filter((r) => r?.name).map((r) => [r.name, r.title, r.email].filter(Boolean).join(", "));
  const officeLines = offices.map((o) => {
    const bits = [o.location, o.hours, o.email && `email ${o.email}`, o.phone && `phone ${o.phone}`].filter(Boolean).join(" · ");
    const role = o.umbrella ? "every club no other office oversees" : o.key === "campus-rec" ? "club sports" : o.key === "fsl" ? "fraternities and sororities" : "its own clubs";
    return (
      `- ${o.name} (${role})${bits ? `: ${bits}` : ""}. Typical review time: about ${o.reviewDays} days.${o.umbrella ? "" : o.decidesFunding ? " Decides its clubs' funding." : " Its clubs' funding goes to WSUSA."}` +
      (o.umbrella && reviewers.length ? ` Reviewers founders can contact: ${reviewers.join("; ")}.` : "")
    );
  });
  lines.push(`Offices that oversee clubs (each club's page says "Overseen by …"; its office reviews it, handles its renewal and staffing gaps, and usually its funding):\n${officeLines.join("\n")}`);

  return lines.join("\n\n");
}
