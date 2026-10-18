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
    ["  approved (meet regularly)", 0],
    ["Memberships", await db.membership.count()],
    ["Member details (confirmed)", 0],
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
    "  approved (meet regularly)": `${await db.club.count({ where: { status: "APPROVED" } })} (${ctx.clubs.filter((c) => c.status === "APPROVED" && (c.def.life === "active" || c.def.life === "pilot" || c.def.life === "ambassadors")).length})`,
    "Reviews (flags)": `${await db.review.count()} (${await db.reviewFlag.count()})`,
    "Funding requests / invoices": await pair(db.fundingRequest.count(), db.invoice.count()),
    "Files (bytes on disk)": `${await db.fileItem.count()} (${(writtenBytes() / 1024).toFixed(0)} KB)`,
    "Club documents / drafts": await pair(db.clubDocument.count(), db.constitutionDraft.count()),
    "Conversations / messages": await pair(db.conversation.count(), db.message.count()),
    "Elections / votes": await pair(db.election.count(), db.vote.count()),
    "Tests / attempts": await pair(db.test.count(), db.testAttempt.count()),
    "Member details (confirmed)": `${await db.personalDetails.count()} (${await db.personalDetails.count({ where: { confirmedAt: { not: null, gte: ctx.academicYear(ctx.NOW).start } } })})`,
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
  const nm = (k: string) => ctx.club(k).name;
  const tips: Record<string, string> = {
    sam: `No clubs, no history. Register for a club (try ${nm("chess")}, then ${nm("robotics")}'s approval gate) and subscribe to a calendar.`,
    maya: `Member of ${nm("psych")}, ${nm("premed")}, ${nm("climbing")}, ${nm("service")}. LIVE NOW: check in to “Care Kit Assembly” (code ${live.checkinCode}, until ${human(live.endsAt)}); later today: “Grad School Q&A” (code ${later.checkinCode}). Vote in the Psi Chi election; review Pre-Med or Psi Chi (eligible); 1 unread DM from Priya.`,
    oscar: `Treasurer of ${nm("fic")} (started ~20 days ago): budget items, one DRAFT and one SUBMITTED funding request; Club Officer Policy Test due in ~10 days, training in ~25 (makeup session on the calendar). First in line for ${nm("fic")}'s open VP seat: answer "Move up to Vice President?" (task).`,
    vanessa: `VP of ${nm("swe")}: approve ${nm("cyber")}'s co-host request (task); SWE's unanimous self-select for President is waiting — a VP can't apply it.`,
    priya: `President of ${nm("robotics")} (~90 members, approval gate): 5 join requests waiting; co-hosts with CSWS and SWE; extra build night is live now (code ${build.checkinCode}) — open the QR screen. Proposed a new VP (waiting for Dr. Alvarez); the org chart's ambassador card asks EAST Ambassadors.`,
    amir: `Club Representative Ambassador (${nm("gsbe-amb")}), placed in ${nm("accounting")} and ${nm("marketing")}.`,
    frank: `${nm("beekeeping")} is a half-finished DRAFT (advisor invite pending with Prof. Reed); ${nm("boardgames")} is SUBMITTED and waiting on WSUSA.`,
    gwen: `Alumni (graduated May 2026). Former ${nm("ailab")} President 2024–2026; projects with files on her profile.`,
    elena: `Advisor of ${nm("robotics")} and ${nm("premed")} — full permissions in both. Confirm Priya's VP proposal (task).`,
    nathan: `Pending request to advise ${nm("beekeeping")} (in Tasks).`,
    alex: `Admin queues: ${nm("boardgames")} review, Aviation department request, ${nm("theatre")} custom bylaws, 3 funding requests, 2 open invoices, ${nm("discgolf")} review bombing, 5 reports (on ${nm("discgolf")} and ${nm("paintball")}). Ambassador programs: choose each program's advisor; ${ctx.refs.ambassadorRequestClub ?? "an EAST club"} is waiting on EAST Ambassadors for an ambassador.`,
    sydney: "System settings, AI switches, integrations, admins, outbox and scheduled jobs.",
  };

  log("");
  log("Test personas (sign in at /login):");
  for (const p of PERSONAS) log(`  • ${p.name.padEnd(20)} ${p.email.padEnd(32)} ${p.label}\n      ${tips[p.key] ?? p.blurb}`);
  if (pastGrace && pastGraceClub) log(`  • Paused permissions demo: ${pastGrace.name} (${pastGrace.email}), ${pastGraceClub.name} — officer requirements overdue.`);
  log("  Full walkthroughs: prisma/seed/PERSONAS.md");
}
