import "server-only";
import type { ClubRole } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { CAPABILITIES, getClubAccess, isAdmin, isSysadmin, ROLE_LABEL, ROLE_RANK } from "@/lib/authz";
import { getConfig } from "@/lib/config";
import { currentOrLastTerm, getTerms, nextTerm, termAt } from "@/lib/terms";
import { fmtDate } from "@/lib/time";
import { INSTITUTION } from "@/lib/institution";
import { CONTEXT_MARKER } from "@/lib/ai/knowledge";

/**
 * The per-person context note. It's sent as a mid-conversation system message
 * right after the person's message — after the cached prefix — and appended
 * again only when it changes (a new day, a new club, a new role), so the
 * conversation history stays append-only and cacheable.
 *
 * Day-level only: no clock time, or the note would change on every message.
 */

const STATUS_WORD: Record<string, string> = {
  DRAFT: "founding draft, not yet submitted to WSUSA",
  SUBMITTED: "submitted, waiting for WSUSA review",
  CHANGES_REQUESTED: "WSUSA asked for changes",
  APPROVED: "approved",
  REJECTED: "not approved by WSUSA",
  RETIRED: "retired",
};

export async function buildContextNote(actor: Actor, now = new Date()): Promise<string> {
  const [cfg, terms, memberships, roles, subs] = await Promise.all([
    getConfig(),
    getTerms(),
    db.membership.findMany({
      where: { userId: actor.id, status: { in: ["ACTIVE", "PENDING"] } },
      select: { status: true, club: { select: { id: true, name: true, slug: true, status: true } } },
    }),
    db.roleAssignment.findMany({
      where: { userId: actor.id, endedAt: null },
      select: { role: true, position: { select: { name: true } }, club: { select: { id: true, name: true, slug: true, status: true } } },
    }),
    db.calendarSubscription.findMany({ where: { userId: actor.id }, select: { club: { select: { id: true, name: true } } } }),
  ]);

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
  const status = actor.status === "ALUMNI" ? " Account status: alumni (can't join new clubs, self check-in or review)." : "";
  lines.push(`You're helping ${actor.name}, a ${kind}. Platform role: ${platform}.${status}`);

  // ── Their clubs ──
  type Entry = { name: string; slug: string; status: string; roles: { role: ClubRole; seat: string | null }[]; member: boolean; pending: boolean; clubId: string };
  const byClub = new Map<string, Entry>();
  const entry = (c: { id: string; name: string; slug: string; status: string }) => {
    let e = byClub.get(c.id);
    if (!e) {
      e = { clubId: c.id, name: c.name, slug: c.slug, status: c.status, roles: [], member: false, pending: false };
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
      if (access?.suspended) caps = "; permissions paused until an overdue officer requirement is done";
      else if (access) {
        const list = [...access.capabilities].map((c) => CAPABILITIES[c].label);
        caps = top.role === "PRESIDENT" || top.role === "VP" || top.role === "ADVISOR" ? "; every club tool this phase allows" : list.length ? `; can use ${list.join(", ")}` : "; no club tools granted";
      }
    }
    const statusNote = e.status === "APPROVED" ? "" : ` [${STATUS_WORD[e.status] ?? e.status.toLowerCase()}]`;
    const href = top && ROLE_RANK[top.role] >= 1 ? `/clubs/${e.slug}/manage` : `/clubs/${e.slug}`;
    clubLines.push(`- ${e.name}${statusNote}: ${roleText}${caps} (${href})`);
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
      `- Active club: at least ${cfg["activity.clubMinEvents"]} held events in the current or previous term and at least ${cfg["activity.clubMinMembers"]} registered members (waived during the pilot period).`,
      `- Reviews unlock after attending ${cfg["reviews.minAttendance"]} of a club's events.`,
      `- Check-in opens ${cfg["checkin.opensMinutesBefore"]} minutes before an event and closes ${cfg["checkin.closesMinutesAfter"]} minutes after it ends.`,
    ].join("\n"),
  );
  const office = cfg["wsusa.office"];
  const officeBits = [office.location, office.hours, office.email, office.phone].filter(Boolean).join(" · ");
  lines.push(`WSUSA clubs office (for founders and questions about review): ${office.name} — ${officeBits}. Typical review time: about ${office.reviewDays} business days.`);

  return lines.join("\n\n");
}
