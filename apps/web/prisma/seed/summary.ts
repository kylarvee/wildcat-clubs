import type { PrismaClient } from "@prisma/client";
import { PERSONAS } from "@/lib/auth/personas";
import type { Ctx } from "./ctx";
import { writtenBytes } from "./lib/assets";
import { human } from "./lib/dates";

/** End-of-seed report: row counts straight from the database, then a persona guide. */

export async function printSummary(db: PrismaClient, ctx: Ctx, log: (s: string) => void) {
  const counts: [string, number][] = [
    ["Colleges / departments / majors", 0],
    ["Users", await db.user.count()],
    ["  students (active / alumni)", 0],
    ["Clubs", await db.club.count()],
    ["Memberships", await db.membership.count()],
    ["Role assignments", await db.roleAssignment.count()],
    ["Events / occurrences", 0],
    ["Attendance (check-ins)", await db.attendance.count()],
    ["Calendar subscriptions", await db.calendarSubscription.count()],
    ["Reviews (flags)", 0],
    ["Budget items", await db.budgetItem.count()],
    ["Funding requests / invoices", 0],
    ["Files (bytes on disk)", 0],
    ["Club documents / drafts", 0],
    ["Announcements", await db.announcement.count()],
    ["Conversations / messages", 0],
    ["Elections / votes", 0],
    ["Policies", await db.policy.count()],
    ["Tests / attempts", 0],
    ["Complaints", await db.complaint.count()],
    ["Tasks (open)", 0],
    ["Notifications (unread)", 0],
    ["Outbox", await db.outboxMessage.count()],
    ["Activity log", await db.activityLog.count()],
  ];
  const pair = async (a: Promise<number>, b: Promise<number>) => `${await a} / ${await b}`;
  const special: Record<string, string> = {
    "Colleges / departments / majors": `${await db.college.count()} / ${await db.department.count()} / ${await db.major.count()}`,
    "  students (active / alumni)": await pair(db.user.count({ where: { kind: "STUDENT", status: "ACTIVE" } }), db.user.count({ where: { kind: "STUDENT", status: "ALUMNI" } })),
    "Events / occurrences": await pair(db.event.count(), db.eventOccurrence.count()),
    "Reviews (flags)": `${await db.review.count()} (${await db.reviewFlag.count()})`,
    "Funding requests / invoices": await pair(db.fundingRequest.count(), db.invoice.count()),
    "Files (bytes on disk)": `${await db.fileItem.count()} (${(writtenBytes() / 1024).toFixed(0)} KB)`,
    "Club documents / drafts": await pair(db.clubDocument.count(), db.constitutionDraft.count()),
    "Conversations / messages": await pair(db.conversation.count(), db.message.count()),
    "Elections / votes": await pair(db.election.count(), db.vote.count()),
    "Tests / attempts": await pair(db.test.count(), db.testAttempt.count()),
    "Tasks (open)": `${await db.task.count()} (${await db.task.count({ where: { status: "OPEN" } })})`,
    "Notifications (unread)": `${await db.notification.count()} (${await db.notification.count({ where: { readAt: null } })})`,
  };
  log("");
  log("┌──────────────────────────────────┬──────────────────┐");
  for (const [label, n] of counts) log(`│ ${label.padEnd(32)} │ ${(special[label] ?? String(n)).padStart(16)} │`);
  log("└──────────────────────────────────┴──────────────────┘");

  const live = ctx.club("service").events.find((e) => e.id === ctx.refs.liveEventId)!.occurrences[0];
  const later = ctx.club("psych").events.find((e) => e.id === ctx.refs.laterEventId)!.occurrences[0];
  const build = ctx.club("robotics").events.find((e) => e.id === ctx.refs.buildEventId)!.occurrences[0];
  const pastGrace = ctx.refs.pastGraceUserId ? ctx.person(ctx.refs.pastGraceUserId) : null;
  const pastGraceClub = ctx.refs.pastGraceClubId ? ctx.clubById.get(ctx.refs.pastGraceClubId) : null;
  const tips: Record<string, string> = {
    sam: "No clubs, no history. Register for a club (try an open one, then Wildcat Robotics' approval gate) and subscribe to a calendar.",
    maya: `Member of Psychology Club, Pre-Med Society, Wildcat Climbing Club, Service & Volunteer Club. LIVE NOW: check in to “Care Kit Assembly” (code ${live.checkinCode}, until ${human(live.endsAt)}); later today: “Grad School Q&A” (code ${later.checkinCode}). Vote in the Psychology Club election; review Pre-Med or Psychology (eligible); 1 unread DM from Priya.`,
    oscar: "Treasurer of Finance & Investment Club (started ~20 days ago): budget items, one DRAFT and one SUBMITTED funding request; Club Officer Policy Test due in ~10 days, training in ~25 (makeup session on the calendar).",
    vanessa: "VP of Society of Women Engineers: approve Cybersecurity Club's co-host request (task); SWE's closed President election is waiting — a VP can't apply it.",
    priya: `President of Wildcat Robotics (~90 members, approval gate): 5 join requests waiting; co-hosts with ACM and SWE; extra build night is live now (code ${build.checkinCode}) — open the QR screen.`,
    amir: "Club Representative Ambassador (Goddard School Ambassadors), placed in Accounting Society and Marketing Association.",
    frank: "Wildcat Beekeeping Society is a half-finished DRAFT (advisor invite pending with Prof. Reed); Board Game Guild is SUBMITTED and waiting on WSUSA.",
    gwen: "Alumni (graduated May 2026). Former Applied AI Lab President 2024–2026; projects with files on her profile.",
    elena: "Advisor of Wildcat Robotics and Pre-Med Society — full permissions in both.",
    nathan: "Pending request to advise Wildcat Beekeeping Society (in Tasks).",
    alex: "Admin queues: Board Game Guild review, Aviation department request, Theatre Guild custom bylaws, 3 funding requests, 2 open invoices, Political Science review bombing, 5 reports.",
    sydney: "System settings, AI switches, integrations, admins, outbox and scheduled jobs.",
  };
  log("");
  log("Test personas (sign in at /login):");
  for (const p of PERSONAS) log(`  • ${p.name.padEnd(20)} ${p.email.padEnd(32)} ${p.label}\n      ${tips[p.key] ?? p.blurb}`);
  if (pastGrace && pastGraceClub) log(`  • Paused permissions demo: ${pastGrace.name} (${pastGrace.email}), ${pastGraceClub.name} — officer requirements overdue.`);
  log("  Full walkthroughs: prisma/seed/PERSONAS.md");
}
