/**
 * Read-only checks that the mock database still matches the persona guide and
 * the platform's rules. Run after seeding:  npx tsx prisma/seed/verify.ts
 */
import { PrismaClient, type ClubRole } from "@prisma/client";
import { PERSONAS } from "@/lib/auth/personas";

const db = new PrismaClient();
// Must match the seed run (SEED_NOW pins both).
const NOW = process.env.SEED_NOW ? new Date(process.env.SEED_NOW) : new Date();
const DAY = 86_400_000;
let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

async function user(key: string) {
  const p = PERSONAS.find((x) => x.key === key)!;
  return db.user.findUniqueOrThrow({ where: { email: p.email } });
}
async function club(slug: string) {
  return db.club.findUniqueOrThrow({ where: { slug } });
}

/** Same rule as lib/authz/requirements (period = academic year containing now), for an officer seat. */
async function requirementState(userId: string, assignmentStartedAt: Date, clubApprovedAt: Date | null) {
  const terms = await db.term.findMany({ orderBy: { startsOn: "asc" } });
  const t = terms.find((x) => x.startsOn <= NOW && NOW <= x.endsOn) ?? [...terms].reverse().find((x) => x.startsOn <= NOW)!;
  const periodStart = terms.find((x) => x.academicYear === t.academicYear)!.startsOn;
  const reqs = await db.roleRequirement.findMany({ where: { active: true, appliesTo: { has: "OFFICER" } } });
  const out: { name: string; met: boolean; dueAt: Date; overdue: boolean }[] = [];
  for (const r of reqs) {
    const met =
      r.kind === "TEST"
        ? (await db.testAttempt.count({ where: { testId: r.testId!, userId, passed: true, submittedAt: { gte: periodStart } } })) > 0
        : (await db.attendance.count({ where: { userId, checkedInAt: { gte: periodStart }, occurrence: { eventId: r.trainingEventId! } } })) > 0;
    const clock = Math.max(assignmentStartedAt.getTime(), clubApprovedAt?.getTime() ?? 0, periodStart.getTime(), r.createdAt.getTime());
    const dueAt = new Date(clock + r.graceDays * DAY);
    out.push({ name: r.name, met, dueAt, overdue: !met && NOW > dueAt });
  }
  return out;
}

async function hostCheckins(userId: string, clubId: string) {
  return db.attendance.count({ where: { userId, clubId } });
}

async function main() {
  console.log("Personas");
  const sam = await user("sam");
  check((await db.membership.count({ where: { userId: sam.id } })) === 0 && (await db.attendance.count({ where: { userId: sam.id } })) === 0, "Sam has no clubs or history");

  const maya = await user("maya");
  const mayaClubs = await db.membership.findMany({ where: { userId: maya.id, status: "ACTIVE" }, include: { club: true } });
  check(mayaClubs.length === 4, "Maya is an active member of 4 clubs", mayaClubs.map((m) => m.club.name).join(", "));
  const eligible = [];
  for (const m of mayaClubs) if ((await hostCheckins(maya.id, m.clubId)) >= 3) eligible.push(m.club.name);
  check(eligible.length === 3, "Maya has ≥3 check-ins in exactly 3 clubs", eligible.join(", "));
  check((await db.review.count({ where: { userId: maya.id } })) === 1, "Maya has left one review");
  const anime = await club("anime-club");
  check((await db.calendarSubscription.count({ where: { userId: maya.id, clubId: anime.id } })) === 1 && !mayaClubs.some((m) => m.clubId === anime.id), "Maya follows Anime Club's calendar without joining");
  const psych = await club("psychology-club");
  const election = await db.election.findFirst({ where: { clubId: psych.id, status: "VOTING" }, include: { candidates: true } });
  check(Boolean(election) && election!.candidates.length === 3 && election!.votingClosesAt > NOW, "Psychology Club has a VOTING President election with 3 candidates");
  check(election ? (await db.vote.count({ where: { electionId: election.id, voterId: maya.id } })) === 0 : false, "Maya hasn't voted yet");
  // Active = checked in within 31 days, or at one of the club's last two held events.
  const held = await db.eventOccurrence.findMany({
    where: { status: "SCHEDULED", startsAt: { lt: NOW }, event: { clubId: psych.id }, attendances: { some: {} } },
    orderBy: { startsAt: "desc" },
    take: 2,
    select: { id: true },
  });
  const recent = await db.attendance.count({ where: { userId: maya.id, clubId: psych.id, checkedInAt: { gte: new Date(NOW.getTime() - 31 * DAY) } } });
  const lastTwo = await db.attendance.count({ where: { userId: maya.id, occurrenceId: { in: held.map((h) => h.id) } } });
  check(recent > 0 || lastTwo > 0, "Maya is an active Psychology Club member");
  const live = await db.eventOccurrence.findFirst({ where: { startsAt: { lte: NOW }, endsAt: { gte: NOW }, event: { club: { slug: "service-volunteer-club" } } }, include: { event: true } });
  check(Boolean(live) && live!.event.allowSelfCheckIn && live!.startsAt.getTime() >= NOW.getTime() - 25 * 60_000, "A Service & Volunteer event is live now with self check-in", live ? `${live.event.title} (${live.checkinCode})` : "");
  check(live ? (await db.attendance.count({ where: { occurrenceId: live.id, userId: maya.id } })) === 0 : false, "Maya hasn't checked in to the live event");
  const endOfDay = new Date(NOW.getTime() + 8 * 3_600_000);
  check((await db.eventOccurrence.count({ where: { startsAt: { gt: NOW, lte: endOfDay }, event: { clubId: { in: mayaClubs.map((m) => m.clubId) } } } })) > 0, "Another of Maya's clubs has an event later today");

  const oscar = await user("oscar");
  const fic = await club("finance-investment-club");
  const tre = await db.roleAssignment.findFirst({ where: { userId: oscar.id, clubId: fic.id, endedAt: null }, include: { position: true } });
  check(tre?.role === "OFFICER" && tre.position?.name === "Treasurer" && tre.permissions.includes("budget"), "Oscar is Treasurer (OFFICER, budget permission)");
  check(Boolean(tre) && Math.abs(NOW.getTime() - tre!.startedAt.getTime() - 20 * DAY) < 2 * DAY, "Oscar's role started ~20 days ago");
  const os = tre ? await requirementState(oscar.id, tre.startedAt, fic.approvedAt) : [];
  check(os.length === 2 && os.every((r) => !r.met && !r.overdue), "Oscar has met neither requirement and is inside grace", os.map((r) => `${r.name} due ${r.dueAt.toISOString().slice(0, 10)}`).join("; "));
  check((await db.task.count({ where: { assigneeId: oscar.id, kind: "REQUIREMENT", status: "OPEN" } })) === 2, "Oscar has 2 open REQUIREMENT tasks");
  check((await db.fundingRequest.count({ where: { clubId: fic.id, status: "DRAFT" } })) >= 1 && (await db.fundingRequest.count({ where: { clubId: fic.id, status: "SUBMITTED", submittedById: oscar.id } })) === 1, "FIC has a DRAFT and Oscar's SUBMITTED funding request");

  const vanessa = await user("vanessa");
  const swe = await club("society-of-women-engineers");
  check((await db.roleAssignment.count({ where: { userId: vanessa.id, clubId: swe.id, role: "VP", endedAt: null } })) === 1, "Vanessa is VP of SWE");
  check((await db.eventCohost.count({ where: { clubId: swe.id, status: "PENDING" } })) >= 1, "SWE has a pending incoming co-host request");
  check((await db.task.count({ where: { clubId: swe.id, sourceType: "cohost", status: "OPEN", capability: "events" } })) >= 1, "…with an APPROVAL task for SWE's events holders");
  check((await db.election.count({ where: { clubId: swe.id, status: "CLOSED", method: "LEADERSHIP_VOTE" } })) === 1, "SWE has a CLOSED leadership-vote election awaiting apply");
  check(
    (await db.task.count({ where: { assigneeId: vanessa.id, required: true, status: "OPEN", title: "Fill out: Club Member Code of Conduct" } })) === 1,
    "Vanessa owes WSUSA's member code-of-conduct form (a required task)",
  );
  check((await db.task.count({ where: { sourceType: "requirement", required: false } })) === 0, "Every requirement task is marked required");

  const priya = await user("priya");
  const robotics = await club("wildcat-robotics");
  check((await db.roleAssignment.count({ where: { userId: priya.id, clubId: robotics.id, role: "PRESIDENT", endedAt: null } })) === 1, "Priya is President of Wildcat Robotics");
  const rActive = await db.membership.count({ where: { clubId: robotics.id, status: "ACTIVE" } });
  check(rActive >= 85 && rActive <= 100, "Wildcat Robotics has ~90 active members", String(rActive));
  check(robotics.joinPolicy === "APPROVAL" && (await db.membership.count({ where: { clubId: robotics.id, status: "PENDING" } })) === 5, "Robotics has an approval gate with 5 pending requests");
  check((await db.task.count({ where: { clubId: robotics.id, sourceType: "membership", status: "OPEN", capability: "roster" } })) === 5, "…each with an APPROVAL task (roster)");
  for (const [slug, label] of [["acm-computer-science-club", "ACM"], ["society-of-women-engineers", "SWE"]]) {
    const c = await club(slug);
    check((await db.eventCohost.count({ where: { clubId: c.id, status: "APPROVED", event: { clubId: robotics.id } } })) >= 3, `Robotics co-hosts with ${label}`);
  }
  for (const k of ["priya", "vanessa"]) {
    const u = await user(k);
    const a = await db.roleAssignment.findFirst({ where: { userId: u.id, endedAt: null, role: { in: ["PRESIDENT", "VP"] } }, include: { club: true } });
    const st = a ? await requirementState(u.id, a.startedAt, a.club.approvedAt) : [];
    check(st.length === 2 && st.every((r) => r.met), `${u.name} has met both officer requirements`);
  }

  const amir = await user("amir");
  const gsbe = await club("goddard-school-ambassadors");
  for (const slug of ["accounting-society", "marketing-association"]) {
    const c = await club(slug);
    const a = await db.roleAssignment.findFirst({ where: { userId: amir.id, clubId: c.id, endedAt: null }, include: { position: true } });
    check(a?.role === "AMBASSADOR" && a.viaClubId === gsbe.id && a.position?.name === "College Ambassador", `Amir is placed in ${c.name} as College Ambassador via the Goddard org`);
  }

  const frank = await user("frank");
  const bee = await club("wildcat-beekeeping-society");
  const bg = await club("board-game-guild");
  check(bee.status === "DRAFT" && bee.createdById === frank.id, "Frank's Wildcat Beekeeping Society is a DRAFT");
  const nathan = await user("nathan");
  const inv = await db.advisorInvite.findFirst({ where: { clubId: bee.id, status: "PENDING", inviteeId: nathan.id } });
  check(Boolean(inv), "Pending advisor invite to Prof. Nathan Reed (inviteeId set)");
  check((await db.task.count({ where: { assigneeId: nathan.id, sourceType: "advisorInvite", sourceId: inv?.id, status: "OPEN" } })) === 1, "Nathan has the advisor-invite APPROVAL task");
  check(bg.status === "SUBMITTED" && (await db.advisorInvite.count({ where: { clubId: bg.id, status: "ACCEPTED" } })) === 1, "Board Game Guild is SUBMITTED with an accepted advisor");
  check((await db.clubDocument.count({ where: { clubId: bg.id, status: "ACTIVE" } })) === 2, "…and an adopted constitution and bylaws");
  check((await db.task.count({ where: { sourceType: "club", sourceId: bg.id, status: "OPEN", assigneeType: "ADMINS" } })) === 1, "…and an admin review task");

  const gwen = await user("gwen");
  const ailab = await club("applied-ai-lab");
  const gp = await db.roleAssignment.findFirst({ where: { userId: gwen.id, clubId: ailab.id, role: "PRESIDENT" }, include: { projects: { include: { files: true } } } });
  check(gwen.status === "ALUMNI" && gwen.graduatedAt?.getUTCMonth() === 4, "Gwen is an alumna who graduated in May");
  check(gp?.endReason === "GRADUATED" && gp.startedAt.getUTCFullYear() === 2024 && gp.endedAt?.getUTCFullYear() === 2026, "Gwen was Applied AI Lab President 2024–2026 (GRADUATED)");
  check((gp?.projects.length ?? 0) >= 2 && gp!.projects.every((p) => p.files.length > 0), "Gwen's projects are tied to that role, with files");
  check((await db.election.count({ where: { clubId: ailab.id, status: "APPLIED" } })) >= 1, "Applied AI Lab has an APPLIED election in its history");

  const elena = await user("elena");
  for (const slug of ["wildcat-robotics", "pre-med-society"]) {
    const c = await club(slug);
    check((await db.roleAssignment.count({ where: { userId: elena.id, clubId: c.id, role: "ADVISOR", endedAt: null } })) === 1, `Dr. Alvarez advises ${c.name}`);
  }
  const alex = await user("alex");
  const sydney = await user("sydney");
  check(alex.platformRole === "ADMIN" && sydney.platformRole === "SYSADMIN", "Alex is ADMIN, Sydney is SYSADMIN");

  console.log("Rules");
  const approved = await db.club.findMany({ where: { status: "APPROVED" } });
  let noPres = 0;
  let noAdv = 0;
  for (const c of approved) {
    if (!(await db.roleAssignment.count({ where: { clubId: c.id, role: "PRESIDENT", endedAt: null } }))) noPres++;
    if (!(await db.roleAssignment.count({ where: { clubId: c.id, role: "ADVISOR", endedAt: null } }))) noAdv++;
  }
  check(noPres === 0 && noAdv === 0, "Every approved club has a current president and advisor", `${noPres} without president, ${noAdv} without advisor`);
  const leaders = await db.roleAssignment.findMany({ where: { endedAt: null, role: { in: ["OFFICER", "VP", "PRESIDENT"] as ClubRole[] }, club: { status: "APPROVED" } }, include: { club: true, user: true } });
  const overdue: string[] = [];
  for (const a of leaders) {
    const st = await requirementState(a.userId, a.startedAt, a.club.approvedAt);
    if (st.some((r) => r.overdue)) overdue.push(`${a.user.name} (${a.club.name})`);
  }
  const terms = await db.term.findMany({ orderBy: { startsOn: "asc" } });
  const cur = terms.find((x) => x.startsOn <= NOW && NOW <= x.endsOn) ?? [...terms].reverse().find((x) => x.startsOn <= NOW)!;
  const ayStart = terms.find((x) => x.academicYear === cur.academicYear)!.startsOn;
  const expectOverdue = NOW.getTime() - ayStart.getTime() > 31 * DAY ? 1 : 0; // nobody can be overdue in the first month
  check(overdue.length === expectOverdue, `Exactly ${expectOverdue} current officer(s) past their requirement grace period`, overdue.join(", "));
  const badMembers = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*) n from "RoleAssignment" r join "Membership" m on m."userId"=r."userId" and m."clubId"=r."clubId" where r.role <> 'ADVISOR' and (m."joinedAt" is null or m."joinedAt" > r."startedAt" + interval '1 day')`,
  );
  check(Number(badMembers[0].n) === 0, "Role holders were members when their role started", `${badMembers[0].n} exceptions`);
  const noMember = await db.$queryRawUnsafe<{ n: bigint }[]>(`select count(*) n from "RoleAssignment" r left join "Membership" m on m."userId"=r."userId" and m."clubId"=r."clubId" where m.id is null`);
  check(Number(noMember[0].n) === 0, "Every role holder has a membership row");
  const unsub = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*) n from "Membership" m join "Club" c on c.id=m."clubId" left join "CalendarSubscription" s on s."userId"=m."userId" and s."clubId"=m."clubId" where m.status='ACTIVE' and c.status='APPROVED' and s."userId" is null`,
  );
  check(Number(unsub[0].n) === 0, "Every active member of an approved club is subscribed to its calendar");
  check((await db.attendance.count({ where: { checkedInAt: { gt: NOW } } })) === 0, "No check-ins in the future");
  const futureAtt = await db.attendance.count({ where: { occurrence: { startsAt: { gt: NOW } } } });
  check(futureAtt === 0, "No check-ins at occurrences that haven't started");
  const polisci = await club("political-science-society");
  const bombs = await db.review.count({ where: { clubId: polisci.id, rating: 1, createdAt: { gte: new Date(NOW.getTime() - 36 * 3_600_000) } } });
  check(bombs === 4, "Political Science Society got four 1★ reviews in the last 36 hours");
  check((await db.task.count({ where: { sourceType: "reviewBombing", sourceId: polisci.id, status: "OPEN", assigneeType: "ADMINS" } })) === 1, "…and an open review-bombing admin task");
  check((await db.review.count({ where: { hiddenAt: { not: null } } })) === 1, "One hidden review");
  const ineligible = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*) n from "Review" r where (select count(*) from "Attendance" a where a."userId"=r."userId" and a."clubId"=r."clubId" and a."checkedInAt" < r."createdAt") < 3`,
  );
  check(Number(ineligible[0].n) === 0, "Every review was written after ≥3 check-ins", `${ineligible[0].n} exceptions`);
  for (const s of ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_APPROVED", "DENIED"] as const) {
    check((await db.fundingRequest.count({ where: { status: s } })) > 0, `Funding requests in status ${s}`);
  }
  check((await db.invoice.count({ where: { status: "OPEN" } })) > 0 && (await db.invoice.count({ where: { status: "PROCESSED" } })) > 0, "Invoices both OPEN and PROCESSED");
  const openInv = await db.invoice.findMany({ where: { status: "OPEN" } });
  check(openInv.every((i) => /^WC-\d{4}-\d{4}$/.test(i.number)), "Invoice numbers look like WC-2026-0001");
  const tests = await db.test.findMany({ include: { questions: true } });
  const officerTest = tests.find((t) => t.title === "Club Officer Policy Test");
  check(officerTest?.questions.length === 10 && officerTest.introHtml.includes('data-embed="video"'), "Officer test has 10 questions and a video embed");
  check((await db.testAttempt.count({ where: { testId: officerTest?.id, status: "NEEDS_REVIEW" } })) >= 4, "Officer test has attempts waiting for review");
  const complaints = await db.complaint.findMany();
  check(complaints.filter((c) => c.isAnonymous).every((c) => c.reporterId === null) && complaints.filter((c) => c.isAnonymous).length === 2, "Two anonymous reports with no reporter stored");
  const slugs = ["review-integrity", "anonymous-reporting", "club-registration", "officer-eligibility-and-training", "event-safety", "funding-and-purchasing", "hazing-prohibition", "non-discrimination", "files-and-messaging-acceptable-use"];
  check((await db.policy.count({ where: { slug: { in: slugs } } })) === slugs.length, "All nine policy slugs exist");
  check((await db.policy.count({ where: { documentFileId: { not: null }, bodyHtml: null } })) === 1 && (await db.policy.count({ where: { status: "DRAFT" } })) === 1, "One PDF-only policy and one draft");

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  await db.$disconnect();
  if (failures) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
