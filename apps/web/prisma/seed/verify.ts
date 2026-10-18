/**
 * Read-only checks that the mock database still matches the persona guide and
 * the platform's rules. Run after seeding:  npx tsx prisma/seed/verify.ts
 */
import { PrismaClient, type ClubRole } from "@prisma/client";
import { PERSONAS } from "@/lib/auth/personas";
import { evaluateClubActivity } from "@/lib/metrics/pure";
import { unanimousChoice } from "@/lib/roles/pipeline";
import { CLUBS, DEMO_CLUB_KEYS, DIRECTORY, clubByKey } from "./data/clubs";

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
/** A seeded club by its story key (slugs follow the real names, keys don't change). */
async function club(key: string) {
  return db.club.findUniqueOrThrow({ where: { slug: clubByKey(key).slug } });
}

/** Same rule as lib/authz/requirements (period = academic year containing now), for an officer seat. */
let cached: { periodStart: Date; reqs: Awaited<ReturnType<typeof db.roleRequirement.findMany>> } | null = null;
async function requirementState(userId: string, assignmentStartedAt: Date, clubApprovedAt: Date | null) {
  if (!cached) {
    const terms = await db.term.findMany({ orderBy: { startsOn: "asc" } });
    const t = terms.find((x) => x.startsOn <= NOW && NOW <= x.endsOn) ?? [...terms].reverse().find((x) => x.startsOn <= NOW)!;
    cached = { periodStart: terms.find((x) => x.academicYear === t.academicYear)!.startsOn, reqs: await db.roleRequirement.findMany({ where: { active: true, appliesTo: { has: "OFFICER" } } }) };
  }
  const { periodStart, reqs } = cached;
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


/** The real club list, the categories, today's officers against the list, and who reads as active. */
async function clubChecks() {
  const clubs = await db.club.findMany();
  const dirNames = new Set(DIRECTORY.map((e) => e.name));
  const approved = clubs.filter((c) => c.status === "APPROVED");
  const demoNames = new Set(DEMO_CLUB_KEYS.map((k) => clubByKey(k).name));
  const notReal = approved.filter((c) => c.type !== "COLLEGE_AMBASSADORS" && !dirNames.has(c.name));
  check(
    notReal.length === demoNames.size && notReal.every((c) => demoNames.has(c.name)),
    "Every approved club is a real club from wsu-directory.json, except the two ambassador orgs and the named fictional demo clubs",
    notReal.map((c) => c.name).join(", "),
  );
  const retired = clubs.filter((c) => c.status === "RETIRED");
  check(retired.length > 0 && retired.every((c) => dirNames.has(c.name)), "Every retired club is a real club too", retired.map((c) => c.name).join(", "));
  const real = clubs.filter((c) => dirNames.has(c.name));
  const realApproved = real.filter((c) => c.status === "APPROVED").length;
  check(
    real.length === DIRECTORY.length && new Set(real.map((c) => c.name)).size === DIRECTORY.length && real.every((c) => c.status === "APPROVED" || c.status === "RETIRED"),
    `All ${DIRECTORY.length} directory clubs are seeded, once each`,
    `${realApproved} approved + ${real.length - realApproved} retired (story clubs); ${approved.length} approved in all with the ambassador orgs`,
  );
  check(approved.filter((c) => c.type !== "COLLEGE_AMBASSADORS" && !demoNames.has(c.name)).length === DIRECTORY.length - retired.length, "Approved real clubs = directory clubs minus the retired ones");
  const lower = DIRECTORY.map((e) => e.name.toLowerCase());
  const fictional = clubs.filter((c) => !dirNames.has(c.name) && c.type !== "COLLEGE_AMBASSADORS");
  check(
    fictional.every((c) => (demoNames.has(c.name) || ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "REJECTED"].includes(c.status)) && !lower.some((n) => n.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(n))),
    "Fictional clubs are the demo clubs or founding-stage/rejected ones, and no name overlaps a real club",
    fictional.map((c) => `${c.name} (${c.status})`).join(", "),
  );
  check(clubs.every((c) => c.category !== null), "Every club has a category", Object.entries(clubs.reduce<Record<string, number>>((m, c) => ({ ...m, [String(c.category)]: (m[String(c.category)] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(", "));
  const byName = new Map(DIRECTORY.map((e) => [e.name, e]));
  const badEmail = real.filter((c) => (byName.get(c.name)!.email ?? null) !== c.contactEmail);
  check(badEmail.length === 0, "Real clubs carry their real contact email (and none is invented)", badEmail.map((c) => c.name).join(", "));
  const descr = real.filter((c) => byName.get(c.name)!.description.trim() && !(c.descriptionHtml ?? "").includes(byName.get(c.name)!.description.trim().split(/\s+/).slice(0, 4).join(" ").replace(/&/g, "&amp;")));
  check(descr.length === 0, "Real clubs' About is their own purpose statement", descr.map((c) => c.name).join(", "));
  check(clubs.every((c) => c.websiteUrl === null && Array.isArray(c.socialLinks) && (c.socialLinks as unknown[]).length === 0), "No website or social links were invented");
  check(clubs.filter((c) => c.type === "AFFILIATE").every((c) => c.category === "FSL" || c.scope === "SPORTS"), "Affiliate clubs are FSL or club sports only");
  const methods = clubs.reduce<Record<string, number>>((m, c) => ({ ...m, [c.successionMethod]: (m[c.successionMethod] ?? 0) + 1 }), {});
  check(
    (methods.ADVISOR_PRESIDENT ?? 0) > clubs.length * 0.8 && ["NEXT_IN_LINE", "SELF_SELECT", "MEMBER_VOTE"].every((m) => (methods[m] ?? 0) >= 3 && (methods[m] ?? 0) <= 8),
    "Most clubs' primary method is Advisor & President; a handful each use the other three",
    Object.entries(methods).map(([k, v]) => `${k} ${v}`).join(", "),
  );

  // Today's leadership.
  const current = await db.roleAssignment.groupBy({ by: ["clubId", "role"], where: { endedAt: null }, _count: true });
  const held = (clubId: string, role: string) => current.find((x) => x.clubId === clubId && x.role === role)?._count ?? 0;
  const bySlug = new Map(clubs.map((c) => [c.slug, c]));
  const story = CLUBS.filter((d) => d.story && d.status === "APPROVED");
  const storyMissing = story.filter((d) => !held(bySlug.get(d.slug)!.id, "PRESIDENT") || !held(bySlug.get(d.slug)!.id, "ADVISOR"));
  check(storyMissing.length === 0, "Every approved story club has a current president and advisor", storyMissing.map((d) => d.name).join(", "));
  const listed = CLUBS.filter((d) => !d.story && d.life !== "dormant");
  const offList = listed.filter((d) => {
    const id = bySlug.get(d.slug)!.id;
    const plan = d.seatPlan ?? {};
    const officers = Object.entries(plan).filter(([k]) => k !== "President" && k !== "Vice President").reduce((n, [, v]) => n + v, 0);
    return held(id, "PRESIDENT") !== (plan.President ?? 0) || held(id, "VP") !== (plan["Vice President"] ?? 0) || held(id, "OFFICER") !== officers || held(id, "ADVISOR") !== (d.advisors ?? 0);
  });
  check(offList.length === 0, `Directory clubs with members have the officers and advisors the list shows (${listed.length} clubs)`, offList.map((d) => d.name).join(", "));
  const members = await db.membership.groupBy({ by: ["clubId"], where: { status: "ACTIVE", user: { kind: "STUDENT" } }, _count: true });
  const memberCount = (clubId: string) => members.find((x) => x.clubId === clubId)?._count ?? 0;
  const offRoster = listed.filter((d) => Math.abs(memberCount(bySlug.get(d.slug)!.id) - d.size) > 2);
  check(offRoster.length === 0, "…and about as many members as their real roster (within 2)", offRoster.map((d) => `${d.name} ${memberCount(bySlug.get(d.slug)!.id)}/${d.size}`).join(", "));

  // Dormant clubs: nobody on the real roster.
  const dormant = CLUBS.filter((d) => d.life === "dormant").map((d) => bySlug.get(d.slug)!);
  const terms = await db.term.findMany({ orderBy: { startsOn: "asc" } });
  const counting = terms.filter((t) => t.countsForActivity);
  const cur = counting.find((t) => t.startsOn <= NOW && NOW <= t.endsOn) ?? [...counting].reverse().find((t) => t.startsOn <= NOW)!;
  const prev = [...counting].reverse().find((t) => t.startsOn < cur.startsOn)!;
  const ayStarts = [...new Set(terms.map((t) => t.academicYear))].map((ay) => terms.find((t) => t.academicYear === ay)!.startsOn);
  const lastYearStart = [...ayStarts].reverse().filter((d) => d <= NOW)[1];
  const dormantIds = dormant.map((c) => c.id);
  const lateEvents = await db.eventOccurrence.groupBy({ by: ["eventId"], where: { startsAt: { gte: lastYearStart }, event: { clubId: { in: dormantIds } } } });
  const dormantLeaders = current.filter((x) => dormantIds.includes(x.clubId)).length;
  const crowded = dormant.filter((c) => memberCount(c.id) > 2);
  check(lateEvents.length === 0 && dormantLeaders === 0 && crowded.length === 0, `Dormant clubs (${dormant.length}): at most 2 members, no officers or advisor, no events this year or last`, `${lateEvents.length} events, ${dormantLeaders} seats, ${crowded.length} with >2 members`);

  // Activity, by lib/metrics' own rule.
  const heldRows = await db.$queryRawUnsafe<{ clubId: string; startsAt: Date }[]>(
    `select x."clubId", o."startsAt" from "EventOccurrence" o join "Event" e on e.id = o."eventId"
     join lateral (select e."clubId" union select c."clubId" from "EventCohost" c where c."eventId" = e.id and c.status = 'APPROVED') x on true
     where o.status = 'SCHEDULED' and o."startsAt" <= $1 and x."clubId" is not null and exists (select 1 from "Attendance" a where a."occurrenceId" = o.id)`,
    NOW,
  );
  const heldIn = (clubId: string, t: { startsOn: Date; endsOn: Date }) => heldRows.filter((r) => r.clubId === clubId && r.startsAt >= t.startsOn && r.startsAt <= new Date(t.endsOn.getTime() + 86_399_999)).length;
  const activeOf = (c: (typeof clubs)[number]) =>
    evaluateClubActivity({
      status: c.status, createdAt: c.createdAt, heldEventsCurrentTerm: heldIn(c.id, cur), heldEventsPreviousTerm: heldIn(c.id, prev), registeredMembers: memberCount(c.id), activeMembers: 0,
      at: NOW, terms, rule: { minEvents: 2, minMembers: 8 },
    });
  const ev = new Map(approved.map((c) => [c.id, activeOf(c)]));
  const dormantInactive = dormant.filter((c) => !ev.get(c.id)!.active).length;
  check(dormantInactive >= dormant.length * 0.9, "Most dormant clubs read as inactive", `${dormantInactive} of ${dormant.length}`);
  const big = CLUBS.filter((d) => !d.story && d.life === "active").map((d) => bySlug.get(d.slug)!);
  const bigActive = big.filter((c) => ev.get(c.id)!.active).length;
  check(bigActive >= big.length * 0.8, "Most directory clubs with 8+ members read as active", `${bigActive} of ${big.length}`);
  const small = CLUBS.filter((d) => d.life === "small").map((d) => bySlug.get(d.slug)!);
  check(small.every((c) => !ev.get(c.id)!.active), "Directory clubs under 8 members read as inactive", `${small.length} clubs`);
  for (const key of ["datasci", "firstgen", "pickleball"]) check(ev.get(bySlug.get(clubByKey(key).slug)!.id)!.inPilot, `${clubByKey(key).name} is in its pilot period`);
  const inactiveStory = ["astro", "math", "modelun", "ceramics"].filter((k) => ev.get(bySlug.get(clubByKey(k).slug)!.id)!.active);
  check(inactiveStory.length === 0, "The four story clubs that stopped meeting read as inactive", inactiveStory.join(", "));
  const activeTotal = [...ev.values()].filter((x) => x.active).length;
  check(activeTotal < approved.length / 2, "Most approved clubs are inactive, as in reality", `${activeTotal} active of ${approved.length} approved`);
}

/** Member details: one invented row per active student (Sam aside) and most faculty and staff. */
async function detailChecks(samId: string, vanessaId: string, confirmedIds: string[]) {
  const terms = await db.term.findMany({ orderBy: { startsOn: "asc" } });
  const t = terms.find((x) => x.startsOn <= NOW && NOW <= x.endsOn) ?? [...terms].reverse().find((x) => x.startsOn <= NOW)!;
  const ayStart = terms.find((x) => x.academicYear === t.academicYear)!.startsOn;
  const students = await db.user.findMany({ where: { kind: "STUDENT", status: "ACTIVE" }, include: { details: true } });
  const missing = students.filter((u) => !u.details && u.id !== samId);
  check(missing.length === 0, "Every active student has member details (Sam's brand-new account aside)", `${missing.length} without`);
  const rows = students.map((u) => u.details).filter((d): d is NonNullable<typeof d> => Boolean(d));
  check(rows.every((d) => /^W0\d{7}$/.test(d.studentId ?? "") || d.studentId === null) && new Set(rows.map((d) => d.studentId).filter(Boolean)).size === rows.filter((d) => d.studentId).length, "Student IDs look like W0 + 7 digits and are unique");
  check(rows.every((d) => d.phone === null || /^801-555-01\d\d$/.test(d.phone)) && rows.every((d) => d.emergencyPhone === null || /^\d{3}-555-01\d\d$/.test(d.emergencyPhone)), "Phones are in the fictional 555-01xx range");
  check(rows.every((d) => (d.emergencyEmail === null || d.emergencyEmail.endsWith("@example.com")) && (d.contactEmail === null || d.contactEmail.endsWith("@example.com"))), "Personal and emergency emails are at example.com");
  const age = (b: Date) => {
    let a = NOW.getUTCFullYear() - b.getUTCFullYear();
    if (NOW.getUTCMonth() < b.getUTCMonth() || (NOW.getUTCMonth() === b.getUTCMonth() && NOW.getUTCDate() < b.getUTCDate())) a--;
    return a;
  };
  const ages = rows.filter((d) => d.birthDate).map((d) => age(d.birthDate!));
  check(ages.filter((a) => a < 18).length === 1 && ages.every((a) => a >= 17 && a <= 30), "Students are 18–30, with exactly one 17-year-old", `${ages.filter((a) => a <= 24).length} of ${ages.length} are 18–24`);
  const staff = await db.user.count({ where: { kind: "FACULTY_STAFF", status: "ACTIVE" } });
  const staffRows = await db.personalDetails.findMany({ where: { user: { kind: "FACULTY_STAFF" } } });
  check(staffRows.length >= staff * 0.7 && staffRows.every((d) => !d.studentId && !d.birthDate && !d.yearInSchool), "Most faculty and staff have details, without a student ID, birth date or year", `${staffRows.length} of ${staff}`);
  const confirmed = rows.filter((d) => d.confirmedAt && d.confirmedAt >= ayStart).length;
  const share = confirmed / rows.length;
  check(share > 0.62 && share < 0.78, "About 70% of active students confirmed their details this academic year", `${confirmed} of ${rows.length}`);
  const v = await db.personalDetails.findUnique({ where: { userId: vanessaId } });
  check(Boolean(v) && !v!.confirmedAt, "Vanessa's details are unconfirmed");
  const c = await db.personalDetails.findMany({ where: { userId: { in: confirmedIds } } });
  const complete = (d: (typeof c)[number]) => [d.studentId, d.birthDate, d.gender, d.phone, d.yearInSchool, d.addressLine, d.addressCity, d.addressState, d.addressZip, d.emergencyName, d.emergencyRelationship, d.emergencyPhone, d.emergencyEmail].every((x) => x !== null && x !== "");
  check(c.length === confirmedIds.length && c.every((d) => complete(d) && d.confirmedAt && d.confirmedAt >= ayStart), "Maya, Priya and Oscar are complete and confirmed");
}

/** The club search index (lib/search): complete, and only what anyone may see. */
async function searchChecks() {
  const [{ missing, stray, docs }] = await db.$queryRaw<{ missing: number; stray: number; docs: number }[]>`
    SELECT (SELECT count(*)::int FROM "Club" c LEFT JOIN "ClubSearchDoc" d ON d."clubId" = c.id WHERE c.status = 'APPROVED' AND d."clubId" IS NULL) AS missing,
           (SELECT count(*)::int FROM "ClubSearchDoc" d JOIN "Club" c ON c.id = d."clubId" WHERE c.status <> 'APPROVED') AS stray,
           (SELECT count(*)::int FROM "ClubSearchDoc") AS docs`;
  check(missing === 0 && stray === 0, "Every approved club has a search document, and only approved clubs do", `${docs} documents`);
  const [{ bad, flag }] = await db.$queryRaw<{ bad: number; flag: number }[]>`
    SELECT count(*) FILTER (WHERE e.id IS NULL OR e.status <> 'SCHEDULED' OR (e.visibility = 'MEMBERS' AND e."clubId" IS NOT NULL))::int AS bad,
           count(*) FILTER (WHERE e.id IS NOT NULL AND (p->>'campusOnly')::boolean <> (e.visibility <> 'PUBLIC'))::int AS flag
      FROM "ClubSearchDoc" d CROSS JOIN LATERAL jsonb_array_elements(d.passages) p
      LEFT JOIN "Event" e ON '/events/' || e.id = p->>'href' WHERE p->>'kind' = 'event'`;
  check(bad === 0 && flag === 0, "Search snippets hold only scheduled public or campus events, campus ones flagged", `${bad} not visible, ${flag} flagged wrong`);
  const [{ ann }] = await db.$queryRaw<{ ann: number }[]>`
    SELECT count(*)::int AS ann FROM "ClubSearchDoc" d CROSS JOIN LATERAL jsonb_array_elements(d.passages) p
     WHERE p->>'kind' = 'announcement' AND NOT EXISTS (SELECT 1 FROM "Announcement" a WHERE a."clubId" = d."clubId" AND a.audience = 'PUBLIC' AND a.title = p->>'title')`;
  check(ann === 0, "Search snippets hold only PUBLIC announcements", `${ann} others`);
  const [{ n, empty }] = await db.$queryRaw<{ n: number; empty: number }[]>`SELECT count(*)::int AS n, count(*) FILTER (WHERE results = 0)::int AS empty FROM "SearchQuery"`;
  check(n >= 50 && empty > 0, "Sample searches for the admin card, some that found nothing", `${n} searches, ${empty} with no results`);
}

/** College ambassador programs (domain/ambassadors): one WSUSA-appointed advisor each, placements only, one open request. */
async function ambassadorChecks() {
  const programs = await db.club.findMany({
    where: { type: "COLLEGE_AMBASSADORS", status: "APPROVED" },
    select: { name: true, roleAssignments: { where: { role: "ADVISOR", endedAt: null }, select: { id: true } } },
  });
  check(programs.length === 2 && programs.every((p) => p.roleAssignments.length === 1), "Each ambassador program has exactly one advisor", programs.map((p) => `${p.name}: ${p.roleAssignments.length}`).join(", "));
  const unplaced = await db.roleAssignment.count({ where: { role: "AMBASSADOR", endedAt: null, viaClubId: null, club: { type: { not: "COLLEGE_AMBASSADORS" } } } });
  check(unplaced === 0, "Regular clubs' ambassadors were all placed by their college's program", `${unplaced} not placed`);
  const open = await db.task.findMany({ where: { sourceType: "ambassadorRequest", status: "OPEN" }, select: { sourceId: true, clubId: true } });
  check(open.length === 1, "One club is waiting on its request for an ambassador", `${open.length} open`);
  const [robotics, swe] = await Promise.all([club("robotics"), club("swe")]);
  check(open[0]?.sourceId === robotics.id, "Priya's club is the one that asked (PERSONAS)");
  check((await db.roleAssignment.count({ where: { clubId: swe.id, role: "AMBASSADOR", endedAt: null } })) === 0, "SWE has no ambassador, so Vanessa can ask for one (PERSONAS)");
  if (open[0]?.sourceId && open[0].clubId) {
    const [asking, program, placed] = await Promise.all([
      db.club.findUnique({ where: { id: open[0].sourceId }, select: { collegeId: true } }),
      db.club.findUnique({ where: { id: open[0].clubId }, select: { collegeId: true, type: true } }),
      db.roleAssignment.count({ where: { clubId: open[0].sourceId, role: "AMBASSADOR", endedAt: null } }),
    ]);
    check(program?.type === "COLLEGE_AMBASSADORS" && asking?.collegeId === program.collegeId && placed === 0, "The request sits with its own college's program, from a club with no ambassador");
  }
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
  const anime = await club("anime");
  check((await db.calendarSubscription.count({ where: { userId: maya.id, clubId: anime.id } })) === 1 && !mayaClubs.some((m) => m.clubId === anime.id), `Maya follows ${anime.name}'s calendar without joining`);
  const psych = await club("psych");
  const election = await db.election.findFirst({ where: { clubId: psych.id, status: "VOTING" }, include: { candidates: true } });
  check(Boolean(election) && election!.candidates.length === 3 && election!.votingClosesAt > NOW, `${psych.name} has a VOTING President election with 3 candidates`);
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
  check(recent > 0 || lastTwo > 0, `Maya is an active ${psych.name} member`);
  const service = await club("service");
  const live = await db.eventOccurrence.findFirst({ where: { startsAt: { lte: NOW }, endsAt: { gte: NOW }, event: { clubId: service.id } }, include: { event: true } });
  check(Boolean(live) && live!.event.allowSelfCheckIn && live!.startsAt.getTime() >= NOW.getTime() - 25 * 60_000, `A ${service.name} event is live now with self check-in`, live ? `${live.event.title} (${live.checkinCode})` : "");
  check(live ? (await db.attendance.count({ where: { occurrenceId: live.id, userId: maya.id } })) === 0 : false, "Maya hasn't checked in to the live event");
  const endOfDay = new Date(NOW.getTime() + 8 * 3_600_000);
  check((await db.eventOccurrence.count({ where: { startsAt: { gt: NOW, lte: endOfDay }, event: { clubId: { in: mayaClubs.map((m) => m.clubId) } } } })) > 0, "Another of Maya's clubs has an event later today");

  const oscar = await user("oscar");
  const fic = await club("fic");
  const tre = await db.roleAssignment.findFirst({ where: { userId: oscar.id, clubId: fic.id, endedAt: null }, include: { position: true } });
  check(tre?.role === "OFFICER" && tre.position?.name === "Treasurer" && tre.permissions.includes("budget"), "Oscar is Treasurer (OFFICER, budget permission)");
  check(Boolean(tre) && Math.abs(NOW.getTime() - tre!.startedAt.getTime() - 20 * DAY) < 2 * DAY, "Oscar's role started ~20 days ago");
  const os = tre ? await requirementState(oscar.id, tre.startedAt, fic.approvedAt) : [];
  check(os.length === 2 && os.every((r) => !r.met && !r.overdue), "Oscar has met neither requirement and is inside grace", os.map((r) => `${r.name} due ${r.dueAt.toISOString().slice(0, 10)}`).join("; "));
  check((await db.task.count({ where: { assigneeId: oscar.id, kind: "REQUIREMENT", status: "OPEN" } })) === 2, "Oscar has 2 open REQUIREMENT tasks");
  // Next in line: FIC's VP stepped down and the officers were asked to move up.
  const nil = await db.election.findFirst({ where: { clubId: fic.id, method: "NEXT_IN_LINE", status: "VOTING", position: { role: "VP" } }, include: { candidates: true, position: true } });
  const nilVacant = nil ? (await db.roleAssignment.count({ where: { positionId: nil.positionId, endedAt: null } })) === 0 : false;
  check(Boolean(nil) && nil!.position.role === "VP" && nil!.votingClosesAt > NOW && nilVacant, `${fic.name} is filling its open Vice President seat from the next in line (answers due after now)`);
  const nilYes = nil?.candidates.filter((c) => c.acceptedAt) ?? [];
  const nilWaiting = nil?.candidates.filter((c) => !c.acceptedAt) ?? [];
  check(nilYes.length === 1 && nilWaiting.length === 1 && nilWaiting[0].userId === oscar.id && Boolean(nil?.candidates.every((c) => c.fromPipeline)), "…one officer said yes and Oscar hasn't answered (both from the org chart)");
  const inLine = [...(nil?.candidates ?? [])].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  check(inLine.length === 2 && inLine[0].userId === oscar.id && Boolean(inLine[1].acceptedAt), "…and Oscar is ahead of them in line, so his answer decides it");
  check(
    (await db.task.count({ where: { assigneeId: oscar.id, kind: "APPROVAL", status: "OPEN", sourceType: "electionAnswer", sourceId: nilWaiting[0]?.id ?? "" } })) === 1,
    "…with Oscar's open \"Move up to Vice President?\" task",
  );
  check((await db.fundingRequest.count({ where: { clubId: fic.id, status: "DRAFT" } })) >= 1 && (await db.fundingRequest.count({ where: { clubId: fic.id, status: "SUBMITTED", submittedById: oscar.id } })) === 1, "FIC has a DRAFT and Oscar's SUBMITTED funding request");

  const vanessa = await user("vanessa");
  const swe = await club("swe");
  check((await db.roleAssignment.count({ where: { userId: vanessa.id, clubId: swe.id, role: "VP", endedAt: null } })) === 1, `Vanessa is VP of ${swe.name}`);
  check((await db.eventCohost.count({ where: { clubId: swe.id, status: "PENDING" } })) >= 1, "SWE has a pending incoming co-host request");
  check((await db.task.count({ where: { clubId: swe.id, sourceType: "cohost", status: "OPEN", capability: "events" } })) >= 1, "…with an APPROVAL task for SWE's events holders");
  const sweElection = await db.election.findFirst({ where: { clubId: swe.id, status: "CLOSED", method: "SELF_SELECT" }, include: { position: true, candidates: { select: { id: true, userId: true } } } });
  check(Boolean(sweElection) && sweElection!.position.role === "PRESIDENT", "SWE has a CLOSED self-select President election awaiting apply (a VP can't apply it)");
  if (sweElection) {
    const [tally, voters, leaderRows, frozen] = await Promise.all([
      db.vote.groupBy({ by: ["candidateId"], where: { electionId: sweElection.id }, _count: { _all: true } }),
      db.vote.findMany({ where: { electionId: sweElection.id }, select: { voterId: true } }),
      db.roleAssignment.findMany({ where: { clubId: swe.id, endedAt: null, role: { in: ["PRESIDENT", "VP", "OFFICER", "AMBASSADOR"] }, user: { status: "ACTIVE", kind: "STUDENT" } }, select: { userId: true } }),
      db.activityLog.findFirst({ where: { action: "election.closed", entityId: sweElection.id }, select: { data: true } }),
    ]);
    const counts = new Map(tally.map((t) => [t.candidateId, t._count._all]));
    const choice = unanimousChoice({
      eligibleVoterIds: [...new Set(leaderRows.map((r) => r.userId))],
      voterIds: voters.map((v) => v.voterId),
      tally: sweElection.candidates.map((c) => ({ candidateId: c.id, userId: c.userId, votes: counts.get(c.id) ?? 0 })),
    });
    check(Boolean(choice) && (frozen?.data as { unanimous?: string } | null)?.unanimous === choice, "…and it was unanimous (every other leader chose the same candidate), frozen at close");
  }
  check(
    (await db.task.count({ where: { assigneeId: vanessa.id, required: true, status: "OPEN", title: "Fill out: Club Member Agreements" } })) === 1,
    "Vanessa owes WSUSA's Club Member Agreements form (a required task)",
  );
  check((await db.task.count({ where: { sourceType: "requirement", required: false } })) === 0, "Every requirement task is marked required");

  const priya = await user("priya");
  const robotics = await club("robotics");
  check((await db.roleAssignment.count({ where: { userId: priya.id, clubId: robotics.id, role: "PRESIDENT", endedAt: null } })) === 1, `Priya is President of ${robotics.name}`);
  const rActive = await db.membership.count({ where: { clubId: robotics.id, status: "ACTIVE" } });
  check(rActive >= 85 && rActive <= 100, `${robotics.name} has ~90 active members`, String(rActive));
  check(robotics.joinPolicy === "APPROVAL" && (await db.membership.count({ where: { clubId: robotics.id, status: "PENDING" } })) === 5, "…with an approval gate and 5 pending requests");
  check((await db.task.count({ where: { clubId: robotics.id, sourceType: "membership", status: "OPEN", capability: "roster" } })) === 5, "…each with an APPROVAL task (roster)");
  for (const [key, label] of [["acm", "CSWS"], ["swe", "SWE"]]) {
    const c = await club(key);
    check((await db.eventCohost.count({ where: { clubId: c.id, status: "APPROVED", event: { clubId: robotics.id } } })) >= 3, `${robotics.name} co-hosts with ${label}`);
  }
  check(
    (await db.task.count({ where: { assigneeId: priya.id, required: true, status: "OPEN", title: "Fill out: Annual Club Re-registration", clubId: robotics.id } })) === 1,
    `Priya owes WSUSA's Annual Club Re-registration for ${robotics.name} (a required task)`,
  );
  for (const k of ["priya", "vanessa"]) {
    const u = await user(k);
    const a = await db.roleAssignment.findFirst({ where: { userId: u.id, endedAt: null, role: { in: ["PRESIDENT", "VP"] } }, include: { club: true } });
    const st = a ? await requirementState(u.id, a.startedAt, a.club.approvedAt) : [];
    check(st.length === 2 && st.every((r) => r.met), `${u.name} has met both officer requirements`);
  }

  const amir = await user("amir");
  const gsbe = await club("gsbe-amb");
  for (const key of ["accounting", "marketing"]) {
    const c = await club(key);
    const a = await db.roleAssignment.findFirst({ where: { userId: amir.id, clubId: c.id, endedAt: null }, include: { position: true } });
    check(a?.role === "AMBASSADOR" && a.viaClubId === gsbe.id && a.position?.name === "College Ambassador", `Amir is placed in ${c.name} as College Ambassador via the Goddard org`);
  }

  const frank = await user("frank");
  const bee = await club("beekeeping");
  const bg = await club("boardgames");
  check(bee.status === "DRAFT" && bee.createdById === frank.id, `Frank's ${bee.name} is a DRAFT`);
  const nathan = await user("nathan");
  const inv = await db.advisorInvite.findFirst({ where: { clubId: bee.id, status: "PENDING", inviteeId: nathan.id } });
  check(Boolean(inv), "Pending advisor invite to Prof. Nathan Reed (inviteeId set)");
  check((await db.task.count({ where: { assigneeId: nathan.id, sourceType: "advisorInvite", sourceId: inv?.id, status: "OPEN" } })) === 1, "Nathan has the advisor-invite APPROVAL task");
  check(bg.status === "SUBMITTED" && (await db.advisorInvite.count({ where: { clubId: bg.id, status: "ACCEPTED" } })) === 1, `${bg.name} is SUBMITTED with an accepted advisor`);
  check((await db.clubDocument.count({ where: { clubId: bg.id, status: "ACTIVE" } })) === 2, "…and an adopted constitution and bylaws");
  check((await db.task.count({ where: { sourceType: "club", sourceId: bg.id, status: "OPEN", assigneeType: "ADMINS" } })) === 1, "…and an admin review task");

  const gwen = await user("gwen");
  const ailab = await club("ailab");
  const gp = await db.roleAssignment.findFirst({ where: { userId: gwen.id, clubId: ailab.id, role: "PRESIDENT" }, include: { projects: { include: { files: true } } } });
  check(gwen.status === "ALUMNI" && gwen.graduatedAt?.getUTCMonth() === 4, "Gwen is an alumna who graduated in May");
  check(gp?.endReason === "GRADUATED" && gp.startedAt.getUTCFullYear() === 2024 && gp.endedAt?.getUTCFullYear() === 2026, "Gwen was Applied AI Lab President 2024–2026 (GRADUATED)");
  check((gp?.projects.length ?? 0) >= 2 && gp!.projects.every((p) => p.files.length > 0), "Gwen's projects are tied to that role, with files");
  check((await db.election.count({ where: { clubId: ailab.id, status: "APPLIED" } })) >= 1, "Applied AI Lab has an APPLIED election in its history");

  const elena = await user("elena");
  for (const key of ["robotics", "premed"]) {
    const c = await club(key);
    check((await db.roleAssignment.count({ where: { userId: elena.id, clubId: c.id, role: "ADVISOR", endedAt: null } })) === 1, `Dr. Alvarez advises ${c.name}`);
  }
  // Advisor & President: the Wrecker Bots' VP stepped down; Priya proposed a successor for Dr. Alvarez to confirm.
  const proposal = await db.election.findFirst({ where: { clubId: robotics.id, method: "ADVISOR_PRESIDENT", status: "NOMINATING", position: { role: "VP" } }, include: { position: true, candidates: true } });
  const proposedRow = proposal?.candidates.find((c) => c.id === proposal.proposedCandidateId);
  const vpOpen = proposal ? (await db.roleAssignment.count({ where: { positionId: proposal.positionId, endedAt: null } })) === 0 : false;
  check(Boolean(proposal) && proposal!.position.role === "VP" && vpOpen && proposal!.proposedById === priya.id && Boolean(proposedRow?.fromPipeline) && !proposal!.confirmedAt, `${robotics.name}'s open VP seat: Priya proposed ${proposedRow ? "an officer from the org chart" : "nobody"}, not yet confirmed`);
  check((await db.task.count({ where: { assigneeId: elena.id, kind: "APPROVAL", status: "OPEN", sourceType: "electionProposal", sourceId: proposal?.id ?? "" } })) === 1, "…and Dr. Alvarez has the APPROVAL task to confirm it");
  check(robotics.successionMethod === "ADVISOR_PRESIDENT" && fic.successionMethod === "NEXT_IN_LINE" && swe.successionMethod === "SELF_SELECT" && psych.successionMethod === "MEMBER_VOTE", "The story clubs' primary methods: Wrecker Bots Advisor & President, FIC Next in line, SWE Self-select, Psi Chi Member vote");
  const alex = await user("alex");
  const sydney = await user("sydney");
  check(alex.platformRole === "ADMIN" && sydney.platformRole === "SYSADMIN", "Alex is ADMIN, Sydney is SYSADMIN");

  console.log("Clubs");
  await clubChecks();

  console.log("Member details");
  await detailChecks(sam.id, vanessa.id, [maya.id, priya.id, oscar.id]);

  console.log("Rules");
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
  const polisci = await club("discgolf");
  const bombs = await db.review.count({ where: { clubId: polisci.id, rating: 1, createdAt: { gte: new Date(NOW.getTime() - 36 * 3_600_000) } } });
  check(bombs === 4, `${polisci.name} got four 1★ reviews in the last 36 hours`);
  check((await db.task.count({ where: { sourceType: "reviewBombing", sourceId: polisci.id, status: "OPEN", assigneeType: "ADMINS" } })) === 1, "…and an open review-bombing admin task");
  const paintball = await club("paintball");
  check((await db.review.count({ where: { hiddenAt: { not: null }, clubId: paintball.id } })) === 1 && (await db.review.count({ where: { hiddenAt: { not: null } } })) === 1, `One hidden review, on ${paintball.name}`);
  const dirNames = DIRECTORY.map((e) => e.name);
  const realComplaints = await db.complaint.count({ where: { club: { name: { in: dirNames } } } });
  const realHidden = await db.review.count({ where: { hiddenAt: { not: null }, club: { name: { in: dirNames } } } });
  const realLow = await db.review.count({ where: { rating: { lte: 2 }, club: { name: { in: dirNames } } } });
  const realFlags = await db.reviewFlag.count({ where: { review: { club: { name: { in: dirNames } } } } });
  check(realComplaints + realHidden + realLow + realFlags === 0, "No report, hidden or flagged review, or rating under 3★ is on a real club", `${realComplaints} reports, ${realHidden} hidden, ${realFlags} flags, ${realLow} low ratings`);
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

  await searchChecks();
  await ambassadorChecks();

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  await db.$disconnect();
  if (failures) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
