/**
 * Read-only checks that the mock database still matches the persona guide and
 * the platform's rules. Run after seeding:  npx tsx prisma/seed/verify.ts
 */
import { PrismaClient, type ClubRole, type Prisma } from "@prisma/client";
import { PERSONAS } from "@/lib/auth/personas";
import { normalizeDraftData } from "@/lib/constitution/templates";
import { rulesFromAnswers } from "@/lib/constitution/rules";
import { quorumOf, readSelectionRules } from "@/lib/roles/pipeline";
import { awaitingGrade, requirementState as ruleState } from "@/lib/authz/requirement-rules";
import { eventVisibilityWhere } from "@/lib/authz/event-visibility";
import { readTravel, UNDER_REVIEW } from "@/lib/events/review";
import { evaluateClubActivity } from "@/lib/metrics/pure";
import { serviceLine, summarizeService } from "@/lib/metrics/service";
import { unanimousChoice } from "@/lib/roles/pipeline";
import { loadRenewalStates } from "@/lib/renewals/facts";
import {
  isEmptyPlan,
  isRequiredCheck,
  readSnapshot,
  RENEWAL_SOURCE,
  renewalSourceClub,
  renewalSourceId,
  renewalTaskPlan,
  renewalTaskTitle,
  renewalTerm,
  renewalWindow,
  tookOfficeDuringWindow,
} from "@/lib/renewals/rules";
import { loadOfficersRecord } from "@/lib/documents/officers";
import { fmtLongDate } from "@/lib/time";
import { COST_CATEGORIES } from "@/lib/events/labels";
import { listWindow, shortcutRange } from "@/lib/events/browse-params";
import { eventFilterWhere } from "@/lib/events/browse-where";
import { coverFileId } from "@/lib/events/rules";
import { resolveVisibility } from "@/lib/files/visibility";
import { holdsLock, lineStanding } from "@/lib/funding/locks";
import { lineCents } from "@/lib/funding/math";
import { followUpKeys, INVOICE_DUE_DAYS, pastReviewTime } from "@/lib/funding/review";
import { ORPHAN_REQUEST_DAYS, ORPHAN_REQUESTS_SOURCE, parseStaffingSourceId, seatApproves, STAFFING_SOURCE } from "@/lib/staffing/rules";
import { OFFICE_KEYS, officeKeyForClub, routeAdminTask, storedOfficeId } from "@/lib/offices/rules";
import { CLUB_REVIVAL, COFOUNDER_INVITE, COFOUNDER_PENDING_CAP, isFounding } from "@/lib/founding/rules";
import { emailKind } from "@/lib/institution";
import { CLUBS, DEMO_CLUB_KEYS, DIRECTORY, clubByKey } from "./data/clubs";
import { DIGEST_KINDS, digestOn, NOTIFICATION_KINDS, readPrefs, resolveDelivery } from "@/components/notifications/catalog";
import { fmtDate } from "@/lib/time";
import { QUEUED_ANNOUNCEMENT_TITLE } from "./steps/inbox";

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

/**
 * Same rule as lib/authz/requirements (period = academic year containing now), for an officer seat, as of `at`:
 * WSUSA's officer requirements for every club. An office's requirements and single-permission ones reach only
 * some officers, so they're checked on their own (requirementChecks).
 */
let cached: { periodStart: Date; reqs: Awaited<ReturnType<typeof db.roleRequirement.findMany>> } | null = null;
async function requirementState(userId: string, assignmentStartedAt: Date, clubApprovedAt: Date | null, at: Date = NOW) {
  if (!cached) {
    const terms = await db.term.findMany({ orderBy: { startsOn: "asc" } });
    const t = terms.find((x) => x.startsOn <= NOW && NOW <= x.endsOn) ?? [...terms].reverse().find((x) => x.startsOn <= NOW)!;
    cached = {
      periodStart: terms.find((x) => x.academicYear === t.academicYear)!.startsOn,
      reqs: await db.roleRequirement.findMany({ where: { active: true, appliesTo: { has: "OFFICER" }, officeId: null, gatesCapability: null } }),
    };
  }
  const { periodStart, reqs } = cached;
  const out: { name: string; met: boolean; waiting: boolean; dueAt: Date; overdue: boolean }[] = [];
  for (const r of reqs) {
    const clock = Math.max(assignmentStartedAt.getTime(), clubApprovedAt?.getTime() ?? 0, periodStart.getTime(), r.createdAt.getTime());
    const dueAt = new Date(clock + r.graceDays * DAY);
    let met: boolean;
    let waiting = false;
    if (r.kind === "TEST") {
      const attempts = await db.testAttempt.findMany({
        where: { testId: r.testId!, userId, submittedAt: { gte: periodStart }, OR: [{ passed: true }, { status: "NEEDS_REVIEW" }] },
        select: { status: true, passed: true, submittedAt: true },
      });
      met = attempts.some((a) => a.passed);
      waiting = !met && awaitingGrade(attempts, dueAt);
    } else {
      met = (await db.attendance.count({ where: { userId, checkedInAt: { gte: periodStart }, occurrence: { eventId: r.trainingEventId! } } })) > 0;
    }
    out.push({ name: r.name, met, waiting, dueAt, overdue: ruleState({ met, awaitingGrade: waiting, dueAt, at }) === "overdue" });
  }
  return out;
}

/**
 * Task kinds and the grading rule: REQUIREMENT is only what WSUSA requires
 * (always required); a club's quiz is a TEST task; and an officer test handed
 * in on time that waits for grading never pauses anyone, even past its deadline.
 */
async function taskChecks() {
  check((await db.task.count({ where: { kind: "REQUIREMENT", required: false } })) === 0, "Every REQUIREMENT task is required (tests that aren't WSUSA requirements are TEST tasks)");
  const quiz = await db.task.groupBy({ by: ["kind"], where: { title: "Take: Event Safety Quiz" }, _count: { _all: true } });
  const quizTests = quiz.find((g) => g.kind === "TEST")?._count._all ?? 0;
  check(quizTests >= 30 && quiz.every((g) => g.kind === "TEST"), "The Event Safety Quiz tasks are TEST tasks (a club test, not a requirement)", quiz.map((g) => `${g.kind} ${g._count._all}`).join(", "));

  const officerTest = await db.test.findFirst({ where: { title: "Club Officer Policy Test" }, select: { id: true } });
  const waiting = officerTest ? await db.testAttempt.findMany({ where: { testId: officerTest.id, status: "NEEDS_REVIEW" }, select: { userId: true, submittedAt: true, user: { select: { name: true } } } }) : [];
  const safe: string[] = [];
  for (const w of waiting) {
    const task = await db.task.findFirst({ where: { assigneeId: w.userId, sourceType: "requirement", status: "OPEN", kind: "REQUIREMENT", required: true, href: `/tests/${officerTest!.id}` }, select: { dueAt: true } });
    const seat = await db.roleAssignment.findFirst({ where: { userId: w.userId, endedAt: null, role: { in: ["OFFICER", "VP", "PRESIDENT"] }, club: { status: "APPROVED" } }, include: { club: true } });
    if (!task?.dueAt || !seat || !w.submittedAt || w.submittedAt > task.dueAt) continue;
    // Now, and two days after the deadline: waiting for grading, not overdue.
    const now = (await requirementState(w.userId, seat.startedAt, seat.club.approvedAt)).find((r) => r.name === "Club Officer Policy Test");
    const later = (await requirementState(w.userId, seat.startedAt, seat.club.approvedAt, new Date(task.dueAt.getTime() + 2 * DAY))).find((r) => r.name === "Club Officer Policy Test");
    if (now?.waiting && !now.overdue && later?.waiting && !later.overdue) safe.push(`${w.user.name} (due ${task.dueAt.toISOString().slice(5, 10)})`);
  }
  check(waiting.length >= 4 && safe.length === waiting.length, "Officer-test attempts waiting for grading were handed in on time: “Submitted — waiting for grading”, never overdue", safe.join(", "));
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
  // The staffing stories' clubs (steps/inbox for WSUSA, steps/offices for Campus Recreation) lost their President a few days ago, so each holds one fewer than the list shows.
  const staffingTasks = await db.task.findMany({ where: { sourceType: STAFFING_SOURCE, status: "OPEN" }, select: { sourceId: true } });
  const lostPresident = new Set(staffingTasks.map((t) => parseStaffingSourceId(t.sourceId)?.clubId).filter((id): id is string => Boolean(id)));
  const story = CLUBS.filter((d) => d.story && d.status === "APPROVED");
  const storyMissing = story.filter((d) => {
    const id = bySlug.get(d.slug)!.id;
    return (!held(id, "PRESIDENT") && !lostPresident.has(id)) || !held(id, "ADVISOR");
  });
  check(storyMissing.length === 0, "Every approved story club has a current president and advisor (but the staffing story's)", storyMissing.map((d) => d.name).join(", "));
  const listed = CLUBS.filter((d) => !d.story && d.life !== "dormant");
  const offList = listed.filter((d) => {
    const id = bySlug.get(d.slug)!.id;
    const plan = d.seatPlan ?? {};
    const officers = Object.entries(plan).filter(([k]) => k !== "President" && k !== "Vice President").reduce((n, [, v]) => n + v, 0);
    const presidents = (plan.President ?? 0) - (lostPresident.has(id) ? 1 : 0);
    return held(id, "PRESIDENT") !== presidents || held(id, "VP") !== (plan["Vice President"] ?? 0) || held(id, "OFFICER") !== officers || held(id, "ADVISOR") !== (d.advisors ?? 0);
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

/**
 * The staffing queue (lib/domain/staffing; steps/inbox staffingStory and
 * steps/offices buildOfficeStories): two clubs that just lost their President,
 * one WSUSA's and one Campus Recreation's, each task in its own office's
 * queue; one gated club whose join request nobody can approve; nothing
 * backfilled; and the queues' counts matching each admin tool's own list
 * (lib/analytics/admin officeQueue counts the open tasks).
 */
async function staffingChecks() {
  const open = await db.task.findMany({ where: { sourceType: { in: [STAFFING_SOURCE, ORPHAN_REQUESTS_SOURCE] }, status: "OPEN" }, include: { club: true } });
  const staffing = open.filter((t) => t.sourceType === STAFFING_SOURCE);
  const rec = await db.office.findUnique({ where: { key: OFFICE_KEYS.campusRec }, select: { id: true } });
  const shaped = staffing.filter((t) => parseStaffingSourceId(t.sourceId)?.gap === "president" && t.assigneeType === "ADMINS" && t.kind === "APPROVAL");
  check(
    staffing.length === 2 && shaped.length === 2 && staffing.filter((t) => t.officeId === null).length === 1 && staffing.filter((t) => rec && t.officeId === rec.id).length === 1,
    "Two open staffing tasks, each for a club with no President: one in WSUSA's queue, one in Campus Recreation's (clubs that were already leaderless get none)",
    staffing.map((t) => `${t.title} (${t.officeId ? "Campus Rec" : "WSUSA"})`).join(", "),
  );
  for (const task of staffing) {
    const sc = task.club;
    if (!sc || !parseStaffingSourceId(task.sourceId)) continue;
    const [presidents, advisors, last] = await Promise.all([
      db.roleAssignment.count({ where: { clubId: sc.id, role: "PRESIDENT", endedAt: null } }),
      db.roleAssignment.count({ where: { clubId: sc.id, role: "ADVISOR", endedAt: null } }),
      db.roleAssignment.findFirst({ where: { clubId: sc.id, role: "PRESIDENT", endedAt: { not: null } }, orderBy: { endedAt: "desc" } }),
    ]);
    const ago = last?.endedAt ? (NOW.getTime() - last.endedAt.getTime()) / DAY : null;
    check(sc.status === "APPROVED" && presidents === 0 && advisors >= 1 && task.title === `${sc.name} has no President`, `${sc.name} has no President now but still has an advisor, and the task says so`);
    check(last?.endReason === "RESIGNED" && ago !== null && ago > 2 && ago < 5, "…its President stepped down a few days ago", ago === null ? "" : `${ago.toFixed(1)} days ago`);
    const told = await db.notification.count({ where: { kind: "staffing.gap", href: `/clubs/${sc.slug}/manage/org-chart` } });
    check(told >= 1, "…and its remaining leaders got the in-app notice", `${told} told`);
  }

  const cutoff = new Date(NOW.getTime() - ORPHAN_REQUEST_DAYS * DAY);
  const approverIn = async (clubId: string) =>
    (await db.roleAssignment.findMany({ where: { clubId, endedAt: null, user: { status: "ACTIVE" } }, select: { role: true, permissions: true } })).some(seatApproves);
  const orphans = open.filter((t) => t.sourceType === ORPHAN_REQUESTS_SOURCE);
  const oc = orphans[0]?.club;
  check(orphans.length === 1 && Boolean(oc) && orphans[0].title === `Join requests waiting at ${oc!.name}`, 'One open "Join requests waiting at …" task', orphans.map((t) => t.title).join(", "));
  if (oc) {
    const old = await db.membership.count({ where: { clubId: oc.id, status: "PENDING", requestedAt: { lt: cutoff } } });
    check(oc.status === "APPROVED" && oc.joinPolicy === "APPROVAL" && old >= 1 && !(await approverIn(oc.id)), `${oc.name} approves each join request, nobody there can, and a request has waited over a week`);
  }
  // The scheduled job would flag the same clubs: no other week-old request is waiting where nobody can approve it.
  const waiting = await db.membership.groupBy({ by: ["clubId"], where: { status: "PENDING", requestedAt: { lt: cutoff }, club: { status: "APPROVED" } } });
  const stuck: string[] = [];
  for (const g of waiting) if (!(await approverIn(g.clubId))) stuck.push(g.clubId);
  check(stuck.length === 1 && stuck[0] === oc?.id, "No other club has a week-old join request nobody can approve", `${stuck.length} club(s)`);

  // One WSUSA queue: the dashboard, the Overview and the side nav count open ADMINS tasks, which match each tool's own list.
  const tasks = (sourceType: string) => db.task.count({ where: { assigneeType: "ADMINS", status: "OPEN", sourceType } });
  const live: Prisma.ClubWhereInput = { status: { notIn: ["RETIRED", "REJECTED"] } };
  const pairs: [string, number, number][] = [
    ["Club submissions", await db.club.count({ where: { status: "SUBMITTED" } }), await tasks("club")],
    ["Department requests", await db.club.count({ where: { ...live, requestedDepartmentName: { not: null }, departmentId: null } }), await tasks("departmentRequest")],
    ["Custom constitutions & bylaws", await db.clubDocument.count({ where: { status: "PENDING_APPROVAL", club: live } }), await tasks("clubDocument")],
    ["Funding requests", await db.fundingRequest.count({ where: { status: "SUBMITTED" } }), await tasks("funding")],
    ["Invoices to process", await db.invoice.count({ where: { status: "OPEN" } }), await tasks("invoice")],
    ["Test answers to grade", await db.testAttempt.count({ where: { status: "NEEDS_REVIEW", test: { clubId: null } } }), await tasks("testAttempt")],
    ["New reports", await db.complaint.count({ where: { status: "NEW" } }), await tasks("complaint")],
  ];
  const off = pairs.filter(([, listedThere, open]) => listedThere !== open);
  check(off.length === 0, "WSUSA's queue matches each admin tool's own list", off.map(([l, a, b]) => `${l}: ${a} listed, ${b} open tasks`).join("; "));
}

/**
 * Offices (lib/offices; steps/offices): WSUSA is the one umbrella, and nothing
 * points at it by id (null means WSUSA); every club's office follows the
 * founding rule (Sports scope → Campus Recreation, FSL category → Fraternity
 * & Sorority Life, else WSUSA); every open admin task about a club sits with
 * the office the routing rule picks; Rowan staffs Campus Recreation, whose
 * queue holds the sport-club work (a club with no President, the Hiking and
 * Outdoors Club's funding request) and nothing from another office; and
 * Alex's default WSUSA queue (WSUSA plus offices nobody staffs) holds none of
 * it, while "All offices" does.
 */
async function officeChecks() {
  const offices = await db.office.findMany({ include: { members: { include: { user: { select: { email: true, kind: true, platformRole: true, status: true } } } } } });
  const byKey = new Map(offices.map((o) => [o.key, o]));
  const umbrella = offices.filter((o) => o.umbrella);
  const wsusa = byKey.get(OFFICE_KEYS.umbrella);
  const rec = byKey.get(OFFICE_KEYS.campusRec);
  const fsl = byKey.get(OFFICE_KEYS.fsl);
  check(offices.length === 3 && umbrella.length === 1 && umbrella[0].key === OFFICE_KEYS.umbrella, "Three offices, and WSUSA is the one umbrella", offices.map((o) => o.key).join(", "));
  check(Boolean(wsusa?.decidesFunding && rec?.decidesFunding && fsl && !fsl.decidesFunding), "WSUSA and Campus Recreation decide funding; Fraternity & Sorority Life's clubs' funding goes to WSUSA");
  check(Boolean(rec?.email === "campusrecreation@weber.edu" && rec.phone && fsl && fsl.email === null && fsl.hours === null), "Office contacts are only what weber.edu publishes (FSL has no office email or hours there)");
  if (!wsusa || !rec || !fsl) return;

  const [clubsAtUmbrella, tasksAtUmbrella, testsAtUmbrella, reqsAtUmbrella] = await Promise.all([
    db.club.count({ where: { officeId: wsusa.id } }),
    db.task.count({ where: { officeId: wsusa.id } }),
    db.test.count({ where: { officeId: wsusa.id } }),
    db.roleRequirement.count({ where: { officeId: wsusa.id } }),
  ]);
  check(clubsAtUmbrella + tasksAtUmbrella + testsAtUmbrella + reqsAtUmbrella === 0 && wsusa.members.length === 0, "Nothing points at the umbrella by id (WSUSA is null everywhere), and it has no OfficeMember rows", `${clubsAtUmbrella} clubs, ${tasksAtUmbrella} tasks, ${testsAtUmbrella} tests, ${reqsAtUmbrella} requirements, ${wsusa.members.length} staff`);

  const clubs = await db.club.findMany({ select: { id: true, name: true, scope: true, category: true, officeId: true } });
  const wrongOffice = clubs.filter((c) => c.officeId !== storedOfficeId(byKey.get(officeKeyForClub(c))));
  check(wrongOffice.length === 0, "Every club's office follows the rule: Sports → Campus Recreation, FSL → Fraternity & Sorority Life, the rest WSUSA", wrongOffice.slice(0, 5).map((c) => c.name).join(", "));
  const recClubs = clubs.filter((c) => c.officeId === rec.id);
  const fslClubs = clubs.filter((c) => c.officeId === fsl.id);
  check(recClubs.length >= 5 && recClubs.every((c) => c.scope === "SPORTS") && fslClubs.length >= 1 && fslClubs.every((c) => c.category === "FSL"), `Campus Recreation oversees the ${recClubs.length} sport clubs and Fraternity & Sorority Life the ${fslClubs.length} chapters`);

  // Routing: every open admin task about a club is with the office lib/offices/rules routeAdminTask picks.
  const open = await db.task.findMany({ where: { assigneeType: "ADMINS", status: "OPEN" }, select: { id: true, title: true, sourceType: true, sourceId: true, officeId: true, clubId: true } });
  const officeOfClub = new Map(clubs.map((c) => [c.id, c.officeId]));
  const funds = new Map(offices.map((o) => [o.id, o.decidesFunding]));
  const misrouted = open.filter((t) => {
    if (!t.clubId || t.sourceType === "testAttempt") return false;
    const officeId = officeOfClub.get(t.clubId) ?? null;
    return t.officeId !== routeAdminTask(t.sourceType, officeId ? { officeId, decidesFunding: funds.get(officeId) ?? false } : null);
  });
  check(misrouted.length === 0, "Every open admin task about a club is in the queue the routing rule picks (platform-wide work stays WSUSA's; funding goes where it's decided)", misrouted.slice(0, 5).map((t) => t.title).join("; "));

  // Office staff: faculty or staff accounts that aren't platform admins. Rowan staffs Campus Recreation alone.
  const staff = offices.flatMap((o) => o.members);
  const rowan = await user("rowan");
  check(staff.every((m) => m.user.kind === "FACULTY_STAFF" && m.user.email.endsWith("@weber.edu") && m.user.platformRole === "USER" && m.user.status === "ACTIVE"), "Office staff are active faculty and staff, not platform admins");
  check(rec.members.some((m) => m.userId === rowan.id) && staff.filter((m) => m.userId === rowan.id).length === 1 && fsl.members.length === 0, "Rowan Ashby is on Campus Recreation's staff (only); Fraternity & Sorority Life has no staff yet");

  // Rowan's queue: Campus Recreation's tasks, all about its own clubs, with the sport-club stories in it.
  const recTasks = open.filter((t) => t.officeId === rec.id);
  const recClubIds = new Set(recClubs.map((c) => c.id));
  const recGap = recTasks.find((t) => t.sourceType === STAFFING_SOURCE);
  const avalanche = await db.fundingRequest.findFirst({ where: { title: "Avalanche awareness course" }, select: { id: true } });
  const recFunding = recTasks.find((t) => t.sourceType === "funding" && t.sourceId === avalanche?.id);
  check(recTasks.every((t) => t.clubId && recClubIds.has(t.clubId)), "Everything in Campus Recreation's queue is about its own clubs", `${recTasks.length} tasks`);
  check(Boolean(recGap && recFunding), "Rowan's queue holds a sport club's staffing gap and the Hiking and Outdoors Club's funding request", recTasks.map((t) => t.title).join("; "));

  // Alex's default queue is WSUSA's plus any office nobody staffs (lib/analytics/admin queueScopeFor); "All offices" is every open task.
  const unstaffed = offices.filter((o) => !o.umbrella && !o.members.some((m) => m.user.status === "ACTIVE")).map((o) => o.id);
  const alexDefault = open.filter((t) => t.officeId === null || unstaffed.includes(t.officeId));
  check(Boolean(recGap && recFunding) && !alexDefault.some((t) => t.id === recGap!.id || t.id === recFunding!.id), "Alex's default WSUSA queue holds none of Campus Recreation's work…");
  check(Boolean(recGap && recFunding) && open.some((t) => t.id === recGap!.id) && open.some((t) => t.id === recFunding!.id), "…and All offices holds it");
  const fslTasks = open.filter((t) => t.officeId === fsl.id);
  check(fslTasks.every((t) => alexDefault.some((x) => x.id === t.id)), `Fraternity & Sorority Life has no staff, so its work falls back to Alex's default queue (${fslTasks.length} ${fslTasks.length === 1 ? "task" : "tasks"})`, fslTasks.map((t) => t.title).join("; "));
  const reviewBombing = open.find((t) => t.sourceType === "reviewBombing");
  check(Boolean(reviewBombing && reviewBombing.officeId === null), "Review moderation stays WSUSA's, even for a sport club", reviewBombing?.title ?? "none");
}

/**
 * This academic year's club renewals (lib/renewals, steps/renewals): the old
 * re-registration form is gone, about 60% of the active clubs renewed inside
 * the window, each by a President, VP or advisor with every required check
 * passing, the tasks are exactly what the "Club renewals" job keeps, and the
 * story clubs: Wrecker Bots not renewed with one amber recommended check, SWE
 * renewed by Vanessa, and a club with no advisor blocked.
 */
async function renewalChecks() {
  const old = (await db.test.count({ where: { title: "Annual Club Re-registration" } })) + (await db.roleRequirement.count({ where: { name: "Annual Club Re-registration" } })) + (await db.task.count({ where: { title: { contains: "Re-registration" } } }));
  check(old === 0, "The old Annual Club Re-registration form, its requirement and its tasks are gone");
  const terms = await db.term.findMany({ orderBy: { startsOn: "asc" } });
  // renewal.dueDays at its default: the seed clears SystemConfig.
  const window = renewalWindow(terms, NOW, 30);
  if (!window) return check(false, "There's a renewal window this academic year");
  const states = await loadRenewalStates(db, { window, term: renewalTerm(terms, NOW), now: NOW });
  const asked = states.filter((s) => !s.exemption);
  const lifeOf = new Map(CLUBS.map((d) => [d.slug, d.life]));
  const active = asked.filter((s) => ["active", "pilot"].includes(lifeOf.get(s.club.slug) ?? ""));
  const renewedActive = active.filter((s) => s.renewal).length;
  check(renewedActive >= active.length * 0.5 && renewedActive <= active.length * 0.7, `About 60% of the active clubs re-registered for ${window.year}`, `${renewedActive} of ${active.length}`);

  const rows = await db.clubRenewal.findMany({ include: { club: { select: { name: true } } } });
  const outside = rows.filter((r) => r.academicYear !== window.year || r.submittedAt < window.opensAt || r.submittedAt > window.dueAt || r.submittedAt > NOW);
  check(rows.length > 0 && outside.length === 0, `Every renewal is for ${window.year} and inside its window`, outside.slice(0, 5).map((r) => r.club.name).join(", "));
  const seats = await db.roleAssignment.findMany({ where: { clubId: { in: rows.map((r) => r.clubId) }, role: { in: ["PRESIDENT", "VP", "ADVISOR"] } }, select: { clubId: true, userId: true, startedAt: true, endedAt: true } });
  const byOutsider = rows.filter((r) => !seats.some((a) => a.clubId === r.clubId && a.userId === r.submittedById && a.startedAt <= r.submittedAt && (!a.endedAt || a.endedAt > r.submittedAt)));
  check(byOutsider.length === 0, "Each club was renewed by its President, a VP or an advisor at the time", byOutsider.slice(0, 5).map((r) => r.club.name).join(", "));
  const badSnapshot = rows.filter((r) => {
    const snap = readSnapshot(r.checks);
    return snap.length !== 6 || snap.some((c) => isRequiredCheck(c.key) && !c.ok);
  });
  check(badSnapshot.length === 0, "Every renewal's snapshot has all six checks, every required one passing", badSnapshot.slice(0, 5).map((r) => r.club.name).join(", "));
  const logs = await db.activityLog.findMany({ where: { action: "club.renewed" }, select: { clubId: true, actorId: true, isPublic: true } });
  check(
    logs.length === rows.length && logs.every((l) => l.isPublic) && rows.every((r) => logs.some((l) => l.clubId === r.clubId && l.actorId === r.submittedById)),
    "One public club.renewed activity row per renewal",
    `${logs.length} rows for ${rows.length} renewals`,
  );

  // The tasks are what the renewal sync keeps (lib/domain/renewals syncClubRenewal, run by the job and every role change).
  const tasks = await db.task.findMany({ where: { sourceType: RENEWAL_SOURCE }, include: { club: { select: { name: true, officeId: true } } } });
  const offShape = tasks.filter(
    (t) =>
      t.kind !== "REQUIREMENT" ||
      !t.required ||
      t.dueAt?.getTime() !== window.dueAt.getTime() ||
      t.sourceId !== renewalSourceId(t.clubId ?? "", window.year) ||
      t.title !== renewalTaskTitle(t.club?.name ?? "", window.year) ||
      (t.officeId ?? null) !== (t.club?.officeId ?? null),
  );
  check(
    tasks.length > 0 && offShape.length === 0,
    `Every renewal task is a required REQUIREMENT, "Renew <club> for ${window.year}", due ${fmtLongDate(window.dueAt)}, marked as required by the club's office`,
    `${offShape.length} of ${tasks.length} off`,
  );
  const openOf = (clubId: string) => tasks.filter((t) => t.status === "OPEN" && renewalSourceClub(t.sourceId) === clubId);
  const outOfLine = states.filter((s) => !isEmptyPlan(renewalTaskPlan(s, openOf(s.club.id), window, NOW))).map((s) => s.club.name);
  const offList = tasks.filter((t) => t.status === "OPEN" && !states.some((s) => s.club.id === renewalSourceClub(t.sourceId)));
  check(
    outOfLine.length === 0 && offList.length === 0,
    "Every club's open renewal tasks are exactly what the sync keeps: one per current President and advisor until the club renews (the next run changes nothing)",
    [...outOfLine, ...offList.map((t) => t.club?.name ?? "?")].slice(0, 5).join(", "),
  );
  // History: a task closed as done when the club renewed, or was cancelled the moment its holder left the seat before that.
  const ended = await db.roleAssignment.findMany({
    where: { clubId: { in: [...new Set(tasks.map((t) => t.clubId ?? ""))] }, role: { in: ["PRESIDENT", "ADVISOR"] }, endedAt: { not: null } },
    select: { clubId: true, userId: true, endedAt: true },
  });
  const badHistory = tasks.filter((t) => {
    const s = states.find((x) => x.club.id === t.clubId);
    if (t.status === "DONE") return !s?.renewal || t.completedAt?.getTime() !== s.renewal.submittedAt.getTime();
    if (t.status === "CANCELLED") return !ended.some((a) => a.clubId === t.clubId && a.userId === t.assigneeId && a.endedAt!.getTime() === t.completedAt?.getTime()) || (s?.renewal ? t.completedAt! >= s.renewal.submittedAt : false);
    return t.status !== "OPEN";
  });
  check(badHistory.length === 0, "Closed renewal tasks closed as done at the club's renewal, or were cancelled the moment their holder left the seat before it", `${badHistory.length} of ${tasks.length}`);
  const unstaffed = asked.filter((s) => !s.renewal && !s.presidents.length && !s.advisors.length);
  check(
    unstaffed.length >= 150 && unstaffed.every((s) => !openOf(s.club.id).length),
    "Approved clubs with nobody in the President's or advisor's seat have no open task, and show as not renewed",
    `${unstaffed.length} clubs`,
  );
  const exempt = states.filter((s) => s.exemption);
  check(exempt.every((s) => !s.renewal && !tasks.some((t) => t.clubId === s.club.id)), "Clubs approved this academic year aren't asked to renew until next year", exempt.map((s) => s.club.name).join(", "));

  // Story clubs.
  const of = (key: string) => states.find((s) => s.club.slug === clubByKey(key).slug);
  const robotics = of("robotics");
  const amber = robotics?.checks.filter((c) => !c.ok) ?? [];
  check(
    Boolean(robotics) && !robotics!.renewal && robotics!.blocking.length === 0 && amber.length === 1 && amber[0].key === "vicePresident",
    `${robotics?.club.name ?? "RC Wrecker Bots Club"} hasn't renewed: every required check passes and one recommended check (a Vice President) is amber`,
    amber.map((c) => c.key).join(", "),
  );
  const [priya, elena, vanessa] = await Promise.all([user("priya"), user("elena"), user("vanessa")]);
  const roboticsOpen = tasks.filter((t) => t.clubId === robotics?.club.id && t.status === "OPEN").map((t) => t.assigneeId);
  check(roboticsOpen.includes(priya.id) && roboticsOpen.includes(elena.id), "…and Priya and Dr. Alvarez both have its open renewal task");
  const swe = of("swe");
  check(swe?.renewal?.submittedBy?.id === vanessa.id, `${swe?.club.name ?? "SWE"} re-registered for ${window.year}, by Vanessa as VP`);
  const micro = states.find((s) => s.club.name.startsWith("American Society of Microbiology"));
  check(
    Boolean(micro) && !micro!.renewal && micro!.presidents.length > 0 && micro!.blocking.map((c) => c.key).join() === "advisor",
    `${micro?.club.name ?? "Microbiology Club"} can't renew: it has a President but no advisor (the blocking check)`,
  );
  // A President who took office mid-window holds the club's task; the outgoing President's was cancelled when they left (steps/renewals names the club).
  const handover = states.find((s) => {
    if (s.renewal || s.exemption) return false;
    const fresh = s.presidents.find((p) => tookOfficeDuringWindow(p, window) && openOf(s.club.id).some((t) => t.assigneeId === p.id));
    return Boolean(fresh && tasks.some((t) => t.clubId === s.club.id && t.status === "CANCELLED" && t.assigneeId !== fresh.id && !s.presidents.some((p) => p.id === t.assigneeId)));
  });
  const newPres = handover?.presidents.find((p) => tookOfficeDuringWindow(p, window));
  check(
    Boolean(handover && newPres),
    `${handover?.club.name ?? "A club"}'s President changed after renewal opened: ${newPres?.name ?? "the new President"} (since ${newPres ? fmtLongDate(newPres.since) : "?"}) holds its open renewal task, and the outgoing President's was cancelled when they left`,
  );
  const handoverTask = handover && newPres ? openOf(handover.club.id).find((t) => t.assigneeId === newPres.id) : undefined;
  check(Boolean(handoverTask?.description?.startsWith("You took office after renewal opened")), "…and their task says it's theirs to finish because they took office after renewal opened");
}

/**
 * The officers of record letter (lib/documents/officers, lib/domain/officers):
 * Priya can download RC Wrecker Bots Club's, it lists her as President with
 * Dr. Alvarez as advisor and WSUSA's public contacts, it carries no student's
 * contact details, a member (Maya, in Psi Chi) can't download one, and a
 * Campus Rec club's letter names Campus Recreation.
 */
async function officersChecks() {
  const terms = await db.term.findMany({ orderBy: { startsOn: "asc" } });
  const window = renewalWindow(terms, NOW, 30);
  const [priya, elena, maya] = await Promise.all([user("priya"), user("elena"), user("maya")]);
  const robotics = await club("robotics");
  // Who may download: whoever opens the club's workspace (lib/authz isLeader: Ambassador and up, advisors, admins and office staff).
  const leads = (userId: string, clubId: string) => db.roleAssignment.count({ where: { userId, clubId, endedAt: null, role: { not: "MEMBER" } } });
  check(robotics.status === "APPROVED" && (await leads(priya.id, robotics.id)) > 0, `Priya leads ${robotics.name}, so she can download its officers of record (Org chart → Download officers of record)`);
  const letter = await loadOfficersRecord(db, robotics.id, { window, now: NOW });
  check(
    letter?.officers[0]?.role === "PRESIDENT" && letter.officers[0].name === priya.name && letter.advisors.some((a) => a.name === elena.name),
    `…and it lists ${priya.name} first, as ${letter?.officers[0]?.title ?? "President"} since ${letter?.officers[0] ? fmtLongDate(letter.officers[0].since) : "?"}, with ${elena.name} as advisor`,
    `${letter?.officers.length ?? 0} officers, ${letter?.advisors.length ?? 0} ${letter?.advisors.length === 1 ? "advisor" : "advisors"}`,
  );
  check(letter?.office.name === "WSUSA" && Boolean(letter.office.email) && letter.renewal.kind === "overdue", "…overseen by WSUSA with its public contacts, and not yet re-registered for this year");
  const students = await db.user.findMany({ where: { kind: "STUDENT", OR: [{ roleAssignments: { some: { clubId: robotics.id, endedAt: null } } }] }, select: { email: true, details: { select: { phone: true } } } });
  const text = JSON.stringify(letter);
  const leaked = students.filter((s) => text.includes(s.email) || (s.details?.phone && text.includes(s.details.phone)));
  check(students.length > 0 && leaked.length === 0 && !/@mail\.weber\.edu/.test(text), "…with no student's email or phone anywhere on it", `${leaked.length} leaked`);
  const psych = await club("psych");
  const mayaSeats = await leads(maya.id, psych.id);
  const mayaMember = await db.membership.count({ where: { userId: maya.id, clubId: psych.id, status: "ACTIVE" } });
  check(mayaMember === 1 && mayaSeats === 0 && maya.platformRole === "USER", `Maya is a member of ${psych.name} with no leader seat, so she can't download its officers of record`);
  const rec = await db.office.findUnique({ where: { key: OFFICE_KEYS.campusRec } });
  const climbing = await club("climbing");
  const recLetter = await loadOfficersRecord(db, climbing.id, { window, now: NOW });
  check(Boolean(rec) && climbing.officeId === rec!.id && recLetter?.office.name === rec!.name && recLetter.office.email === rec!.email, `${climbing.name}'s letter says it's overseen by ${rec?.name ?? "Campus Recreation"}, with that office's contacts`);
}

/**
 * Bells and reminders (components/notifications/catalog, lib/events/notices,
 * lib/jobs/reminders): no notification kind exists only in the seed, the
 * persona bells use the kinds the app sends now, Maya's event-changed notice
 * is about a date that really changed, and nothing has been reminded or pushed
 * yet (no phone is registered, and the Reminders job runs after seeding).
 */
/** ActivityLog.subjectUserId: the person a row is about (lib/lake/subject), which profile feeds read through an index. */
async function activityChecks() {
  const [{ total, about, wrong }] = await db.$queryRaw<{ total: number; about: number; wrong: number }[]>`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE "subjectUserId" IS NOT NULL)::int AS about,
           count(*) FILTER (WHERE "subjectUserId" IS DISTINCT FROM COALESCE(NULLIF(data->>'userId', ''), NULLIF(data->>'winnerId', '')))::int AS wrong
      FROM "ActivityLog"`;
  check(wrong === 0 && about > 0, "Every activity row names the person it's about (data.userId, or an election's winner)", `${about} of ${total} rows are about someone; ${wrong} disagree`);
  const priya = await user("priya");
  const [roles, feedRoles] = await Promise.all([
    db.activityLog.count({ where: { action: "role.assigned", isPublic: true, data: { path: ["userId"], equals: priya.id } } }),
    db.activityLog.count({ where: { action: "role.assigned", isPublic: true, subjectUserId: priya.id } }),
  ]);
  check(roles > 0 && feedRoles === roles, "Priya's profile feed finds her roles by subject, the same rows the JSON filter did", `${feedRoles} of ${roles}`);
  const won = await db.activityLog.findFirst({ where: { action: "election.applied" }, select: { subjectUserId: true, data: true } });
  check(Boolean(won?.subjectUserId) && won?.subjectUserId === (won?.data as { winnerId?: string } | null)?.winnerId, "An applied election's row is about its winner");
}

async function notificationChecks() {
  const sendable = new Set<string>(NOTIFICATION_KINDS);
  const seeded = await db.notification.groupBy({ by: ["kind"], _count: { _all: true }, orderBy: { kind: "asc" } });
  const seedOnly = seeded.filter((k) => !sendable.has(k.kind));
  check(
    seedOnly.length === 0,
    `Every seeded notification is a kind the code can send (${seeded.length} of the ${NOTIFICATION_KINDS.length} in components/notifications/catalog)`,
    seedOnly.length ? `seed only: ${seedOnly.map((k) => `${k.kind} ×${k._count._all}`).join(", ")}` : seeded.map((k) => k.kind).join(", "),
  );

  const maya = await user("maya");
  const bell = await db.notification.findMany({ where: { userId: maya.id }, select: { kind: true, title: true, href: true } });
  for (const kind of ["event.changed", "event.starting_soon", "review.unlocked"]) check(bell.some((n) => n.kind === kind), `Maya's bell has a notice of kind ${kind}`);
  const changed = bell.find((n) => n.kind === "event.changed");
  const occurrenceId = changed?.href ? new URL(changed.href, "http://seed.test").searchParams.get("o") : null;
  const occ = occurrenceId ? await db.eventOccurrence.findUnique({ where: { id: occurrenceId }, include: { event: { select: { clubId: true, room: true } } } }) : null;
  const follows = occ?.event.clubId ? await db.calendarSubscription.count({ where: { userId: maya.id, clubId: occ.event.clubId } }) : 0;
  check(
    Boolean(occ?.roomOverride && occ.roomOverride !== occ.event.room && occ.status === "SCHEDULED" && occ.startsAt > NOW && occ.startsAt <= new Date(NOW.getTime() + 14 * DAY) && follows),
    "…about a date in the next two weeks, on a calendar she follows, that really has a new room",
    changed?.title ?? "",
  );

  check((await db.pushToken.count()) === 0, "No phone is registered for push, so Settings → Notifications says how to get push notifications");
  // The scheduled jobs may already have run since seeding (System → Run now), so only the key shapes are checked.
  const reminderKeys = await db.reminderLog.findMany({ select: { key: true } });
  const knownPrefixes = ["event:", "due:", "review:", "job:", "digest:", "funding:"];
  check(reminderKeys.every((r) => knownPrefixes.some((p) => r.key.startsWith(p))), "Every sent reminder has a known key (event, due, review, job, digest, funding)", `${reminderKeys.length} keys`);
  check((await db.user.count({ where: { eventReminders: false } })) === 0, "Everyone starts with “Remind me before events” on");
}

/**
 * Email and push against the notification registry
 * (components/notifications/catalog, lib/domain/notify): people's stored
 * choices read back cleanly, the outbox only holds kinds the app sends that
 * way, the RC Wrecker Bots announcement's emails were queued for exactly the
 * people the registry would email, WSUSA's routine notices go into the digest
 * (one by one only for an admin who turned it off), and staffing gaps, which
 * always send, were emailed to everyone told. These hold before and after a
 * "Send queued messages" run.
 */
async function deliveryChecks() {
  const kinds = new Set<string>(NOTIFICATION_KINDS);
  const chosen = await db.user.findMany({ where: { NOT: { notificationPrefs: { equals: {} } } }, select: { email: true, notificationPrefs: true } });
  const odd = chosen.filter((u) => JSON.stringify(readPrefs(u.notificationPrefs)) !== JSON.stringify(u.notificationPrefs));
  check(odd.length === 0, "Every stored notification choice is a known category with on/off values", odd.map((u) => u.email).join(", "));
  const prefsOf = async (key: string) => readPrefs((await user(key)).notificationPrefs);
  const [priya, elena, sydney, maya] = await Promise.all(["priya", "elena", "sydney", "maya"].map(prefsOf));
  check(
    priya.events?.email === false && elena.announcements?.email === false && !digestOn(sydney) && Object.keys(maya).length === 0 && chosen.length === 3,
    "Priya turned Events & reminders email off, Dr. Alvarez Announcements email, and Sydney the WSUSA digest; Maya and everyone else keep the defaults",
  );

  const [unsent, early, odder] = await Promise.all([
    db.outboxMessage.count({ where: { status: { not: "QUEUED" }, sentAt: null } }),
    db.outboxMessage.count({ where: { status: "QUEUED", sentAt: { not: null } } }),
    db.outboxMessage.groupBy({ by: ["kind"], where: { kind: { not: null } }, _count: { _all: true } }),
  ]);
  check(unsent === 0 && early === 0, "Every message that went out has a sent time, and none waiting to send has one", `${unsent} sent without a time, ${early} waiting with one`);
  const unknown = odder.filter((k) => !kinds.has(k.kind!));
  check(unknown.length === 0, "Every outbox message with a kind uses a notification kind the app sends", unknown.map((k) => k.kind).join(", "));

  // The big send: every bell has it, and exactly the people the registry emails were queued (QUEUED until a run sends them).
  const robotics = await club("robotics");
  const theNotice = { kind: "announcement.new", title: `New announcement in ${robotics.name}`, body: { startsWith: QUEUED_ANNOUNCEMENT_TITLE } };
  const bells = await db.notification.findMany({ where: theNotice, select: { user: { select: { email: true, emailNotifications: true, notificationPrefs: true, platformRole: true } } } });
  const emails = await db.outboxMessage.findMany({ where: { channel: "EMAIL", kind: theNotice.kind, subject: theNotice.title, body: theNotice.body }, select: { to: true, status: true } });
  const owed = bells
    .filter(({ user: u }) => resolveDelivery("announcement.new", { emailOn: u.emailNotifications, admin: u.platformRole !== "USER", prefs: readPrefs(u.notificationPrefs) }).email === "now")
    .map(({ user: u }) => u.email)
    .sort();
  const sent = emails.map((m) => m.to).sort();
  const waiting = emails.filter((m) => m.status === "QUEUED").length;
  check(
    bells.length > 50 && JSON.stringify(owed) === JSON.stringify(sent),
    `Priya's RC Wrecker Bots announcement is on ${bells.length} bells, and its ${sent.length} emails were queued for exactly the people the registry emails`,
    `${waiting} still waiting to send`,
  );
  const elenaEmail = (await user("elena")).email;
  check(bells.some((b) => b.user.email === elenaEmail) && !sent.includes(elenaEmail), "…Dr. Alvarez has the bell but no email (Announcements email off)");

  // WSUSA's routine notices: in the digest, not one by one, except for an admin who turned the digest off.
  const admins = await db.user.findMany({ where: { platformRole: { in: ["ADMIN", "SYSADMIN"] } }, select: { email: true, notificationPrefs: true } });
  const digested = admins.filter((a) => digestOn(readPrefs(a.notificationPrefs))).map((a) => a.email);
  const oneByOne = await db.outboxMessage.findMany({ where: { kind: { in: DIGEST_KINDS }, to: { in: admins.map((a) => a.email) } }, select: { to: true } });
  check(
    oneByOne.length > 0 && oneByOne.every((m) => !digested.includes(m.to)),
    "No admin with the digest on was emailed a routine WSUSA notice one by one; Sydney (digest off) was",
    `${oneByOne.length} one-by-one`,
  );
  // Today's digest (once a day, from the first "Send queued messages" run after 7 AM): at most one each, only for admins who keep it on.
  const today = await db.outboxMessage.findMany({ where: { OR: [{ subject: { startsWith: "Waiting on WSUSA:" } }, { subject: { startsWith: "WSUSA digest" } }], subject: { endsWith: ` · ${fmtDate(NOW, "EEE, MMM d")}` } }, select: { to: true } });
  const twice = today.filter((m, i) => today.findIndex((x) => x.to === m.to) !== i);
  check(
    twice.length === 0 && today.every((m) => digested.includes(m.to)),
    "Today's WSUSA digest went at most once to each admin who keeps it on, and not to Sydney (digest off)",
    today.length ? `sent to ${today.length}` : "not sent yet",
  );

  // Staffing gaps always send: everyone told was emailed too.
  const gaps = await db.notification.findMany({ where: { kind: "staffing.gap" }, select: { user: { select: { email: true } } } });
  const mailed = new Set((await db.outboxMessage.findMany({ where: { kind: "staffing.gap", channel: "EMAIL" }, select: { to: true } })).map((m) => m.to));
  check(gaps.length > 0 && gaps.every((g) => mailed.has(g.user.email)), "Everyone told about a club losing its President (leaders and WSUSA) was emailed too, since staffing gaps always send", `${gaps.length} told`);
}

/**
 * Funding (lib/domain/funding, steps/money): cost categories come from the
 * pickers' list; WSUSA decides line by line (an approval's amount is the sum
 * of its lines); every approval recorded the source that funded it and made
 * its invoice and INVOICE task in the same step; lines funded for less let go
 * (lib/funding/locks), so Oscar asked another source for the booth's banner;
 * and the request past review time and the invoice past due are urgent in the
 * WSUSA queue, each reminded at most once (lib/jobs/funding).
 */
async function fundingChecks() {
  const cats = new Set<string>(COST_CATEGORIES);
  const used = await db.budgetItem.groupBy({ by: ["category"], _count: { _all: true } });
  const off = used.filter((c) => !cats.has(c.category));
  check(off.length === 0, "Every cost line's category is one the cost pickers offer", off.map((c) => `${c.category} ×${c._count._all}`).join(", "));

  const requests = await db.fundingRequest.findMany({ where: { status: { not: "DRAFT" } }, include: { items: true, invoices: true, club: { select: { name: true } } } });
  const approvals = requests.filter((r) => r.status === "APPROVED" || r.status === "PARTIALLY_APPROVED");
  const lineSum = (r: (typeof requests)[number]) => r.items.reduce((s, i) => s + (i.approvedCents ?? 0), 0);
  const badLines = requests.filter(
    (r) =>
      (r.status === "APPROVED" && !r.items.every((i) => i.approvedCents === i.totalCents)) ||
      (r.status === "PARTIALLY_APPROVED" && !r.items.some((i) => i.approvedCents !== null && i.approvedCents < i.totalCents)) ||
      (r.status === "DENIED" && !r.items.every((i) => i.approvedCents === 0)) ||
      ((r.status === "SUBMITTED" || r.status === "WITHDRAWN") && !r.items.every((i) => i.approvedCents === null)) ||
      (r.status !== "DENIED" && r.amountApprovedCents !== null && r.amountApprovedCents !== lineSum(r)),
  );
  check(badLines.length === 0, "WSUSA's decisions are line by line: an approval's amount is the sum of its lines, and a partial approval has a line that got less", badLines.map((r) => r.title).join(", "));
  const badSources = requests.filter((r) => (r.fundedSource !== null) !== (r.status === "APPROVED" || r.status === "PARTIALLY_APPROVED"));
  check(badSources.length === 0 && approvals.some((r) => r.fundedSource !== r.fundingSource), "Every approval records the source that funded it (some differ from what the club expected)", badSources.map((r) => r.title).join(", "));

  const invoiceTasks = await db.task.findMany({ where: { sourceType: "invoice" }, select: { sourceId: true, dueAt: true, status: true, createdAt: true } });
  const taskOf = new Map(invoiceTasks.map((t) => [t.sourceId, t]));
  const badInvoices = approvals.filter((r) => {
    const inv = r.invoices[0];
    const task = inv ? taskOf.get(inv.id) : undefined;
    return (
      r.invoices.length !== 1 ||
      inv.createdAt.getTime() !== r.decidedAt?.getTime() ||
      inv.createdById !== r.decidedById ||
      inv.amountCents !== r.amountApprovedCents ||
      !task?.dueAt ||
      task.dueAt.getTime() !== inv.createdAt.getTime() + INVOICE_DUE_DAYS * DAY ||
      (task.status === "OPEN") !== (inv.status === "OPEN")
    );
  });
  check(badInvoices.length === 0, `Every approval made its invoice in the same step, with an INVOICE task due ${INVOICE_DUE_DAYS} days later`, badInvoices.map((r) => r.title).join(", "));
  check(requests.every((r) => r.status === "APPROVED" || r.status === "PARTIALLY_APPROVED" || r.invoices.length === 0), "Only approvals have invoices");

  // Oscar's story: the booth's banner wasn't funded, so it's free, and he asked the college for it.
  const booth = requests.find((r) => r.title === "Involvement Fair booth");
  const bannerLine = booth?.items.find((i) => i.approvedCents === 0);
  const bannerRequests = bannerLine?.budgetItemId ? requests.filter((r) => r.items.some((i) => i.budgetItemId === bannerLine.budgetItemId)) : [];
  const askAgain = bannerRequests.find((r) => r.title === "Club banner");
  check(
    Boolean(booth && bannerLine && booth.items.filter((i) => i.approvedCents === i.totalCents).length === booth.items.length - 1 && !holdsLock({ status: booth.status, totalCents: bannerLine.totalCents, approvedCents: bannerLine.approvedCents })),
    "Involvement Fair booth: partly approved with one line (the banner) not funded, and that line no longer locks its cost line",
    booth ? `${booth.amountApprovedCents} of ${booth.amountRequestedCents} cents, funded by ${booth.fundedSource}` : "missing",
  );
  check(
    askAgain?.status === "SUBMITTED" && askAgain.fundingSource === "COLLEGE" && askAgain.submittedById === (await user("oscar")).id && askAgain.items.length === 1 && askAgain.items[0].budgetItemId === bannerLine?.budgetItemId,
    "…and Oscar asked the college for the banner in “Club banner” (in WSUSA review)",
  );
  const mcat = requests.find((r) => r.title === "MCAT prep books for the lending library");
  const mcatLine = mcat?.items[0];
  const mcatStanding = mcatLine ? lineStanding(lineCents(mcatLine.quantity, mcatLine.unitCostCents) * mcatLine.occurrences, [{ status: mcat!.status, totalCents: mcatLine.totalCents, approvedCents: mcatLine.approvedCents }]) : null;
  check(Boolean(mcatStanding && !mcatStanding.lockedBy && mcatStanding.fundedCents > 0 && mcatStanding.openCents > 0), "Pre-Med's MCAT books line was funded in part: unlocked, with the rest open to ask another source for", mcatStanding ? `${mcatStanding.fundedCents} funded, ${mcatStanding.openCents} open` : "");

  // Late work: urgent rows in the deciding office's queue, by lib/funding/review's rule, with each office's own review time (Office.reviewDays).
  const offices = await db.office.findMany({ select: { id: true, key: true, umbrella: true, reviewDays: true } });
  const daysFor = (officeId: string | null) => offices.find((o) => (officeId ? o.id === officeId : o.umbrella))?.reviewDays ?? 10;
  const lateTasks = await db.task.findMany({ where: { sourceType: "funding", status: "OPEN", assigneeType: "ADMINS" }, select: { sourceId: true, createdAt: true, officeId: true } });
  const deciding = new Map(lateTasks.map((t) => [t.sourceId, t.officeId]));
  const late = requests.filter((r) => r.status === "SUBMITTED" && r.submittedAt && pastReviewTime(r.submittedAt, NOW, daysFor(deciding.get(r.id) ?? null)));
  const lateByTask = lateTasks.filter((t) => pastReviewTime(t.createdAt, NOW, daysFor(t.officeId))).map((t) => t.sourceId);
  const avalanche = late.find((r) => r.title === "Avalanche awareness course");
  const recOffice = offices.find((o) => o.key === OFFICE_KEYS.campusRec);
  check(
    Boolean(avalanche) && Boolean(recOffice) && deciding.get(avalanche!.id) === recOffice!.id && late.length === lateByTask.length && late.every((r) => lateByTask.includes(r.id)),
    `The Hiking and Outdoors Club's request is past Campus Recreation's review time (${daysFor(recOffice?.id ?? null)} business days): an urgent row in its queue, which decides its clubs' funding`,
    late.map((r) => `${r.club.name}: ${r.title}`).join("; "),
  );
  const lateInvoices = await db.invoice.findMany({ where: { status: "OPEN" }, select: { id: true, number: true, request: { select: { title: true } } } });
  const pastDue = lateInvoices.filter((i) => (taskOf.get(i.id)?.dueAt ?? NOW) < NOW);
  check(pastDue.some((i) => i.request.title === "Unity Week catering"), "BSU's Unity Week invoice is past due: an urgent row in the WSUSA queue", pastDue.map((i) => i.number).join(", "));

  // Reminded at most once each (ReminderLog keys; one in-app notice per admin), before and after the job runs.
  const keys = await db.reminderLog.findMany({ where: { key: { startsWith: "funding:" } }, select: { key: true } });
  const knownKeys = new Set([...requests.map((r) => followUpKeys.review(r.id)), ...lateInvoices.map((i) => followUpKeys.invoice(i.id)), ...(await db.invoice.findMany({ select: { id: true } })).map((i) => followUpKeys.invoice(i.id))]);
  const notices = await db.notification.groupBy({ by: ["userId", "kind", "href"], where: { kind: { in: ["funding.overdue", "invoice.overdue"] } }, _count: { _all: true } });
  check(keys.every((k) => knownKeys.has(k.key)) && notices.every((n) => n._count._all === 1), "Funding follow-ups remind each admin at most once per late request or invoice", `${keys.length} sent so far`);
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
  check(Boolean(live) && live!.startsAt.getTime() >= NOW.getTime() - 25 * 60_000, `A ${service.name} event is live now for check-in`, live ? `${live.event.title} (${live.checkinCode})` : "");
  check(live ? (await db.attendance.count({ where: { occurrenceId: live.id, userId: maya.id } })) === 0 : false, "Maya hasn't checked in to the live event");
  // The one-tap prompt is only for online events (rules.allowsTapCheckIn), so one of Maya's clubs has one on now.
  const premed = await club("premed");
  const online = await db.eventOccurrence.findFirst({
    where: { startsAt: { lte: NOW }, endsAt: { gte: NOW }, status: "SCHEDULED", event: { clubId: premed.id, locationType: "VIRTUAL", status: "SCHEDULED" } },
    include: { event: true },
  });
  check(Boolean(online) && mayaClubs.some((m) => m.clubId === premed.id), `An online ${premed.name} event is live now, in one of Maya's clubs (her one-tap check-in prompt)`, online ? `${online.event.title} (${online.checkinCode})` : "");
  check(online ? (await db.attendance.count({ where: { occurrenceId: online.id, userId: maya.id } })) === 0 : false, "…Maya hasn't checked in to it");
  check(online ? (await db.attendance.count({ where: { occurrenceId: online.id, method: "TAP" } })) > 0 : false, "…and a few members already checked in with one tap (TAP)");
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
  const ficRequests = await db.fundingRequest.findMany({ where: { clubId: fic.id }, select: { title: true, status: true, submittedById: true } });
  check(
    ficRequests.some((r) => r.status === "DRAFT") &&
      ficRequests.some((r) => r.title === "Fall speaker series" && r.status === "SUBMITTED" && r.submittedById === oscar.id) &&
      ficRequests.some((r) => r.title === "Involvement Fair booth" && r.status === "PARTIALLY_APPROVED" && r.submittedById === oscar.id),
    "FIC has a DRAFT, Oscar's Fall speaker series in WSUSA review, and his Involvement Fair booth partly approved (more under Funding)",
  );

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
    (await db.task.count({ where: { assigneeId: priya.id, required: true, kind: "REQUIREMENT", status: "OPEN", sourceType: RENEWAL_SOURCE, clubId: robotics.id } })) === 1,
    `Priya has the required task to renew ${robotics.name} for this academic year (its renewal card is checked under Renewals)`,
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
  // How people check in (lib/attendance/rules decideMethod): one tap only online, codes and taps only for the hosts' members.
  const methods = await db.attendance.groupBy({ by: ["method"], _count: { _all: true } });
  const tapRows = methods.find((m) => m.method === "TAP")?._count._all ?? 0;
  const tapInPerson = await db.attendance.count({ where: { method: "TAP", occurrence: { event: { locationType: { not: "VIRTUAL" } } } } });
  check(tapRows > 0 && tapInPerson === 0, "One-tap check-ins (TAP) exist, and only at online events", methods.map((m) => `${m.method} ${m._count._all}`).join(", "));
  const universityCodes = await db.attendance.count({ where: { method: { in: ["SELF", "TAP"] }, occurrence: { event: { clubId: null } } } });
  check(universityCodes === 0, "No typed-code or one-tap check-ins at university events (they have no host club)", `${universityCodes} found`);
  const outsiders = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*) n from "Attendance" a join "EventOccurrence" o on o.id = a."occurrenceId" join "Event" e on e.id = o."eventId"
      where a.method in ('SELF', 'TAP') and not exists (
        select 1 from (select e."clubId" as id union select c."clubId" from "EventCohost" c where c."eventId" = e.id and c.status = 'APPROVED') x
         where exists (select 1 from "Membership" m where m."userId" = a."userId" and m."clubId" = x.id and m."joinedAt" <= a."checkedInAt" and (m."endedAt" is null or m."endedAt" > a."checkedInAt") and m.status not in ('PENDING', 'DECLINED'))
            or exists (select 1 from "RoleAssignment" r where r."userId" = a."userId" and r."clubId" = x.id and r."startedAt" <= a."checkedInAt" and (r."endedAt" is null or r."endedAt" > a."checkedInAt")))`,
  );
  check(Number(outsiders[0].n) === 0, "Typed-code and one-tap check-ins are all by members of the host or a co-host club", `${outsiders[0].n} exceptions`);
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

  console.log("Funding");
  await fundingChecks();

  console.log("Tasks");
  await taskChecks();

  await searchChecks();
  await ambassadorChecks();

  console.log("Staffing");
  await staffingChecks();

  console.log("Offices");
  await officeChecks();

  console.log("Renewals");
  await renewalChecks();

  console.log("Officers of record");
  await officersChecks();

  console.log("Notifications");
  await notificationChecks();
  await deliveryChecks();

  console.log("Activity log");
  await activityChecks();

  console.log("Constitutions and bylaw rules");
  await constitutionChecks();

  console.log("Events page");
  await eventsPageChecks();

  console.log("Service hours");
  await serviceChecks();

  console.log("Office and single-permission requirements");
  await requirementChecks();

  console.log("Event reviews");
  await eventReviewChecks();

  console.log("Founding: co-founders, the forming list, revival requests");
  await foundingChecks();

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  await db.$disconnect();
  if (failures) process.exit(1);
}

/**
 * Service hours (lib/metrics/service). Seeded events count where they should
 * (every Service project, and a few university service events), each for
 * 60–180 minutes in quarter hours and never more than the event lasts.
 * Totals are derived: the rule's sums over the check-ins match SQL over the
 * same rows, for Maya and for everyone. Maya has hours already, including
 * the latest Day of Service and the pantry restock, and the live Care Kit
 * Assembly she hasn't checked in to is worth 2 more.
 */
async function serviceChecks() {
  const counted = await db.event.findMany({ where: { serviceMinutes: { not: null } }, select: { title: true, kind: true, clubId: true, durationMinutes: true, serviceMinutes: true } });
  const off = counted.filter((e) => e.serviceMinutes! < 60 || e.serviceMinutes! > 180 || e.serviceMinutes! % 15 !== 0 || e.serviceMinutes! > e.durationMinutes);
  check(counted.length > 0 && off.length === 0, "Events that count give 60–180 minutes in quarter hours, never more than they last", off.length ? off.slice(0, 3).map((e) => `${e.title}: ${e.serviceMinutes} of ${e.durationMinutes} min`).join(", ") : `${counted.length} events`);
  const services = await db.event.count({ where: { kind: "SERVICE" } });
  const servicesCounted = counted.filter((e) => e.kind === "SERVICE").length;
  check(services > 0 && servicesCounted === services, "Every Service project counts toward service hours", `${servicesCounted} of ${services}`);
  const university = [...new Set(counted.filter((e) => e.clubId === null).map((e) => e.title))];
  check(counted.filter((e) => e.clubId === null).length >= 3, "A few university service events count too", university.join(", "));

  // Every check-in at an event that counts, as the rule reads it.
  const [terms, rows] = await Promise.all([
    db.term.findMany({ orderBy: { startsOn: "asc" } }),
    db.attendance.findMany({
      where: { occurrence: { event: { serviceMinutes: { gt: 0 } } } },
      select: {
        id: true,
        userId: true,
        occurrence: {
          select: {
            id: true,
            startsAt: true,
            event: { select: { id: true, title: true, serviceMinutes: true, club: { select: { id: true, name: true, slug: true } }, cohosts: { where: { status: "APPROVED" }, select: { club: { select: { id: true, name: true, slug: true } } } } } },
          },
        },
      },
    }),
  ]);
  const byUser = new Map<string, Parameters<typeof summarizeService>[0][number][]>();
  for (const r of rows) {
    const e = r.occurrence.event;
    const list = byUser.get(r.userId) ?? [];
    list.push({ attendanceId: r.id, occurrenceId: r.occurrence.id, eventId: e.id, title: e.title, startsAt: r.occurrence.startsAt, serviceMinutes: e.serviceMinutes, club: e.club, cohosts: e.cohosts.map((c) => c.club) });
    byUser.set(r.userId, list);
  }
  const sql = await db.$queryRaw<{ user_id: string; minutes: number; n: number }[]>`
    SELECT a."userId" AS user_id, sum(e."serviceMinutes")::int AS minutes, count(*)::int AS n
      FROM "Attendance" a JOIN "EventOccurrence" o ON o.id = a."occurrenceId" JOIN "Event" e ON e.id = o."eventId"
     WHERE e."serviceMinutes" > 0
     GROUP BY a."userId"`;
  const disagree = sql.filter((x) => {
    const s = summarizeService(byUser.get(x.user_id) ?? [], terms);
    return s.minutes !== x.minutes || s.events !== x.n || s.byTerm.reduce((m, t) => m + t.minutes, 0) !== s.minutes;
  });
  check(sql.length > 0 && byUser.size === sql.length && disagree.length === 0, "Everyone's service hours are their check-ins summed, and add up by term", `${sql.length} people, ${disagree.length} disagree`);

  const maya = await user("maya");
  const mine = summarizeService(byUser.get(maya.id) ?? [], terms);
  check(mine.minutes > 0, `Maya has service hours already: ${serviceLine(mine)}`);
  check(mine.entries.some((e) => e.title === "WSUSA Day of Service") && mine.entries.some((e) => e.title === "Weber Cares Pantry Restock Night"), "…including the latest WSUSA Day of Service and the pantry restock");
  const careKit = await db.event.findFirst({ where: { title: "Care Kit Assembly for the Weber Cares Pantry" }, select: { serviceMinutes: true } });
  check(careKit?.serviceMinutes === 120, "The live Care Kit Assembly is worth 2 service hours (Maya's check-in adds them)");
}

/**
 * Constitutions and the bylaw rules Wildcat Clubs enforces (lib/constitution/
 * rules): every adopted builder document keeps its answers; Psi Chi's bylaws
 * ask for 2 club events this semester to vote and a 25% quorum, its running
 * President vote froze them, opened after the notice, and holds only
 * eligible members' ballots, short of quorum so far; Maya can vote and some
 * members can't; Maya's bell has the change notice; and pending custom
 * documents state only the setting they govern.
 */
async function constitutionChecks() {
  const builderActive = await db.clubDocument.findMany({ where: { status: "ACTIVE", source: "BUILDER" }, select: { builderAnswers: true } });
  const bare = builderActive.filter((d) => d.builderAnswers === null).length;
  check(builderActive.length > 500 && bare === 0, "Every builder document in effect keeps the answers it was made from (so any leader can start from the current version)", `${bare} of ${builderActive.length} without`);

  const psych = await club("psych");
  const maya = await user("maya");
  const docs = await db.clubDocument.findMany({ where: { clubId: psych.id, status: "ACTIVE", kind: { in: ["CONSTITUTION", "BYLAWS"] } }, select: { kind: true, source: true, version: true, builderAnswers: true } });
  const answers = (kind: "CONSTITUTION" | "BYLAWS") => {
    const d = docs.find((x) => x.kind === kind);
    return d?.source === "BUILDER" && d.builderAnswers ? normalizeDraftData(d.builderAnswers) : null;
  };
  const rules = rulesFromAnswers({ constitution: answers("CONSTITUTION"), bylaws: answers("BYLAWS") });
  check(rules.voteMinEvents === 2 && rules.quorumPercent === 25 && psych.successionMethod === "MEMBER_VOTE", `${psych.name}'s bylaws in effect: member votes, 2 club events this semester to vote, a 25% quorum`, JSON.stringify(rules));
  check(docs.length === 2 && docs.every((d) => d.version >= 2), "…adopted as new versions (the ones before named Advisor & President)", docs.map((d) => `${d.kind} v${d.version}`).join(", "));

  const election = await db.election.findFirst({ where: { clubId: psych.id, status: "VOTING", method: "MEMBER_VOTE" } });
  const frozen = readSelectionRules(election?.rules);
  check(Boolean(election) && frozen.minEvents === 2 && frozen.quorumPercent === 25 && frozen.noticeDays === 7, "…and its President vote froze those rules when it started", JSON.stringify(election?.rules ?? null));
  if (election) {
    check(election.votingOpensAt.getTime() - election.createdAt.getTime() >= 7 * DAY, "…voting opened at least 7 days after the vote was announced (its notice)");
    // Who can vote: registered members who'd been to 2 of the club's events (hosted or co-hosted) this semester when voting opened, as lib/metrics counts them.
    const terms = await db.term.findMany({ orderBy: { startsOn: "asc" } });
    const term = terms.find((t) => t.startsOn <= election.votingOpensAt && election.votingOpensAt <= t.endsOn) ?? [...terms].reverse().find((t) => t.startsOn <= election.votingOpensAt)!;
    const occurrences = await db.eventOccurrence.findMany({
      where: { status: "SCHEDULED", startsAt: { gte: term.startsOn, lte: election.votingOpensAt }, event: { OR: [{ clubId: psych.id }, { cohosts: { some: { clubId: psych.id, status: "APPROVED" } } }] } },
      select: { id: true },
    });
    const grouped = await db.attendance.groupBy({ by: ["userId"], where: { occurrenceId: { in: occurrences.map((o) => o.id) } }, _count: { _all: true } });
    const attended = new Map(grouped.map((g) => [g.userId, g._count._all]));
    const members = await db.membership.findMany({ where: { clubId: psych.id, status: "ACTIVE", user: { status: "ACTIVE", kind: "STUDENT" } }, select: { userId: true } });
    const eligible = new Set(members.filter((m) => (attended.get(m.userId) ?? 0) >= 2).map((m) => m.userId));
    const ballots = await db.vote.findMany({ where: { electionId: election.id }, select: { voterId: true } });
    check(ballots.length > 0 && ballots.every((b) => eligible.has(b.voterId)), "…every ballot so far is from a member who can vote", `${ballots.length} ballots`);
    check(eligible.has(maya.id), "…Maya can vote: she'd been to enough club events this semester", `${attended.get(maya.id) ?? 0} events`);
    check(members.length > eligible.size, "…and some members can't (fewer than 2 events), so the roll shows who and why", `${eligible.size} of ${members.length} can vote`);
    const q = quorumOf({ quorumPercent: 25, eligibleVoters: eligible.size, votes: ballots.length });
    check(Boolean(q && !q.met), "…turnout is short of the quorum so far", q ? `${ballots.length} voted, ${q.needed} needed` : "");
  }
  const notice = await db.notification.findFirst({ where: { userId: maya.id, kind: "constitution.settings_changed" } });
  check(notice?.title === `${psych.name} now uses Member vote to fill seats`, "Maya's bell has the change notice: Psi Chi now uses Member vote to fill seats", notice?.title ?? "none");

  const pending = await db.clubDocument.findMany({ where: { status: "PENDING_APPROVAL", kind: { in: ["CONSTITUTION", "BYLAWS"] } }, select: { kind: true, statedJoinPolicy: true, statedSuccessionMethod: true } });
  const stray = pending.filter((d) => (d.kind === "BYLAWS" ? d.statedJoinPolicy !== null || !d.statedSuccessionMethod : d.statedSuccessionMethod !== null || !d.statedJoinPolicy));
  check(pending.length > 0 && stray.length === 0, "Pending custom documents state only what they govern (bylaws: succession; a constitution: joining), so a pending bylaws upload never changes who can join");

  const running = await db.election.findMany({ where: { status: { in: ["NOMINATING", "VOTING", "CLOSED"] } }, select: { title: true, rules: true } });
  const loose = running.filter((e) => !e.rules || typeof e.rules !== "object" || Object.keys(e.rules).length === 0);
  check(loose.length === 0, "Every selection under way froze its club's bylaw rules", loose.map((e) => e.title).join(", "));
}

/**
 * The Events page (lib/events/browse): covers are their host club's public
 * image files, as the Events Builder allows; about 30% of socials, some
 * meeting series and some events offer free food or free stuff; a few
 * workshops are hybrid and their check-ins happen in the room; and Maya's
 * "Free food · This weekend" under Mine finds the trailhead cookout, through
 * the page's own filter (lib/events/browse-where) and dates.
 */
async function eventsPageChecks() {
  const covered = await db.event.findMany({ where: { coverUrl: { not: null } }, select: { title: true, clubId: true, coverUrl: true } });
  const fileIds = covered.map((e) => coverFileId(e.coverUrl!)).filter((x): x is string => Boolean(x));
  const covers = await db.fileItem.findMany({ where: { id: { in: fileIds } }, select: { id: true, clubId: true, mimeType: true, isFolder: true, trashedAt: true } });
  const folders = await db.fileItem.findMany({ where: { clubId: { in: [...new Set(covers.map((f) => f.clubId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, parentId: true, visibility: true } });
  const tree = new Map(folders.map((f) => [f.id, f]));
  const byId = new Map(covers.map((f) => [f.id, f]));
  const wrong = covered.filter((e) => {
    const f = byId.get(coverFileId(e.coverUrl!) ?? "");
    return !f || f.isFolder || f.trashedAt || f.clubId !== e.clubId || !f.mimeType?.startsWith("image/") || resolveVisibility(f.id, (id) => tree.get(id)) !== "PUBLIC";
  });
  check(covered.length >= 50 && wrong.length === 0, "Every event cover is one of its host club's public image files", `${covered.length} covers, ${wrong.length} not: ${wrong.slice(0, 3).map((e) => e.title).join(", ")}`);

  const socials = await db.event.findMany({ where: { kind: "SOCIAL", clubId: { not: null } }, select: { perks: true } });
  const fed = socials.filter((s) => s.perks.includes("FREE_FOOD")).length;
  check(socials.length > 0 && fed / socials.length >= 0.2 && fed / socials.length <= 0.4, "About 30% of socials offer free food", `${fed} of ${socials.length} (${Math.round((100 * fed) / Math.max(1, socials.length))}%)`);
  const meetings = await db.event.count({ where: { kind: "MEETING", recurrence: { not: "NONE" }, perks: { has: "FREE_FOOD" } } });
  const stuff = await db.event.count({ where: { perks: { has: "FREE_STUFF" } } });
  check(meetings > 0 && stuff > 0, "Some meeting series offer free food, and some events free stuff", `${meetings} meeting series, ${stuff} with free stuff`);

  const hybrid = await db.event.findMany({
    where: { locationType: { in: ["CAMPUS", "ADDRESS"] }, virtualUrl: { not: null } },
    select: { kind: true, occurrences: { select: { startsAt: true, attendances: { select: { method: true } } } } },
  });
  const checkins = hybrid.flatMap((h) => h.occurrences.flatMap((o) => o.attendances));
  check(hybrid.filter((h) => h.kind === "WORKSHOP").length >= 3 && hybrid.some((h) => h.occurrences.some((o) => o.startsAt > NOW)), "A few workshops are hybrid (in person with an online link), some still to come", `${hybrid.length} hybrid events`);
  check(checkins.length > 0 && checkins.every((a) => a.method !== "TAP"), "Hybrid check-ins happen in the room (QR, typed code or a leader), never one-tap", `${checkins.length} check-ins`);
  const placeless = await db.event.count({ where: { locationType: "TBD", virtualUrl: { not: null } } });
  check(placeless === 0, "No event without a place keeps an online link");

  // Maya, Events → Mine → Free food · This weekend (the page's filter and dates, as lib/events/feed scope "me" uses them).
  const maya = await user("maya");
  const follows = (await db.calendarSubscription.findMany({ where: { userId: maya.id }, select: { clubId: true } })).map((s) => s.clubId);
  const window = listWindow(shortcutRange("weekend", NOW), NOW);
  const found = await db.eventOccurrence.findMany({
    where: {
      startsAt: { lt: window.end },
      endsAt: { gt: window.start },
      event: {
        AND: [
          { status: { in: ["SCHEDULED", "CANCELLED"] } },
          { OR: [{ clubId: { in: follows } }, { cohosts: { some: { status: "APPROVED", clubId: { in: follows } } } }, ...(maya.subscribeUniversity ? [{ clubId: null }] : [])] },
          eventFilterWhere({ type: null, category: null, food: true, stuff: false, service: false, online: false, following: false }, { followedClubIds: follows }),
        ],
      },
    },
    select: { startsAt: true, event: { select: { title: true, club: { select: { name: true } } } } },
  });
  const cookout = found.find((o) => o.event.title === "Trailhead Cookout & Easy Hike");
  check(Boolean(cookout), "Maya's Free food · This weekend (Mine) finds the Trailhead Cookout & Easy Hike, Hiking and Outdoors Club", found.map((o) => `${o.event.title} (${o.event.club?.name ?? "Weber State"}, ${fmtDate(o.startsAt, "EEE h:mm a")})`).join("; ") || "nothing");
}

/**
 * Office and single-permission requirements (lib/authz/requirement-rules
 * requirementReaches): WSUSA's Event Safety Training is about the Events
 * permission only and is off until WSUSA turns it on (Priya already passed
 * it). Campus Recreation's sport club safety forms are on, use its own form,
 * and reach exactly the current officers of its clubs: one task each, in one
 * of its clubs, and nobody past the grace period yet.
 */
async function requirementChecks() {
  const safety = await db.roleRequirement.findFirst({ where: { name: "Event Safety Training" }, include: { test: { select: { status: true, audience: true, officeId: true } } } });
  check(
    Boolean(safety) && !safety!.active && safety!.gatesCapability === "events" && safety!.officeId === null && !safety!.appliesTo.includes("MEMBER"),
    "Event Safety Training is WSUSA's, about the Events permission only, for leader roles, and off until WSUSA turns it on",
    safety ? `${safety.appliesTo.join("/")}, ${safety.graceDays}-day grace` : "missing",
  );
  check(safety?.test?.status === "PUBLISHED" && safety.test.audience === "ROLE_REQUIREMENT" && safety.test.officeId === null, "…on a published WSUSA test");
  const priya = await user("priya");
  check((await db.testAttempt.count({ where: { testId: safety?.testId ?? "", userId: priya.id, passed: true } })) === 1, "…that Priya already passed this year, so turning it on leaves her Events alone");
  check((await db.task.count({ where: { sourceType: "requirement", sourceId: { startsWith: `${safety?.id}:` } } })) === 0, "…and nobody has a task for it while it's off");

  const rec = await db.office.findUnique({ where: { key: OFFICE_KEYS.campusRec }, select: { id: true } });
  const forms = await db.roleRequirement.findFirst({ where: { name: "Sport club safety forms" }, include: { test: { select: { officeId: true, isForm: true, status: true } } } });
  check(
    Boolean(rec && forms) && forms!.active && forms!.officeId === rec!.id && forms!.gatesCapability === null && forms!.test?.officeId === rec!.id && forms!.test?.isForm === true,
    "Campus Recreation's sport club safety forms: its own form, required of its clubs' officers, on",
  );
  // Who it reaches, as the sweep reads it: current officer, VP and President seats in Campus Recreation's approved clubs, active people.
  const seats = await db.roleAssignment.findMany({
    where: { endedAt: null, role: { in: ["OFFICER", "VP", "PRESIDENT"] }, club: { status: "APPROVED", officeId: rec?.id ?? "none" }, user: { status: "ACTIVE" } },
    select: { userId: true },
  });
  const reached = new Set(seats.map((s) => s.userId));
  const tasks = await db.task.findMany({
    where: { sourceType: "requirement", sourceId: { startsWith: `${forms?.id}:` }, status: { in: ["OPEN", "DONE"] } },
    select: { assigneeId: true, status: true, dueAt: true, required: true, club: { select: { officeId: true } } },
  });
  const outside = tasks.filter((t) => (t.status === "OPEN" && !reached.has(t.assigneeId!)) || t.club?.officeId !== rec?.id || !t.required);
  const missing = [...reached].filter((u) => !tasks.some((t) => t.assigneeId === u));
  check(
    reached.size > 0 && outside.length === 0 && missing.length === 0,
    "…it reaches only sport-club officers: every current one has its required task in a Campus Recreation club, and nobody else has an open one",
    `${reached.size} officers, ${tasks.length} tasks, ${outside.length} outside, ${missing.length} missing`,
  );
  const wsusaOfficers = await db.task.count({ where: { sourceType: "requirement", sourceId: { startsWith: `${forms?.id}:` }, club: { officeId: null } } });
  check(wsusaOfficers === 0, "…so no WSUSA club's officer owes it");
  check(tasks.filter((t) => t.status === "OPEN").every((t) => t.dueAt && t.dueAt > NOW), "…and nobody's past its 30-day grace yet", `${tasks.filter((t) => t.status === "OPEN").length} still to sign`);
}

/**
 * Risk-based review (lib/events/review): two events wait for their offices
 * (Priya's school visit for WSUSA, a sport club's overnight trip for Campus
 * Recreation), each with exactly one open review task in that office's
 * queue; neither, nor the one sent back, shows in the public feed or to Maya
 * (a member of the trip's club), by the very filter the feeds use; trips
 * carry their details; an approved event is posted as usual; and nothing
 * under review has attendance.
 */
async function eventReviewChecks() {
  const rec = await db.office.findUnique({ where: { key: OFFICE_KEYS.campusRec }, select: { id: true } });
  const waiting = await db.event.findMany({
    where: { reviewStatus: { in: [...UNDER_REVIEW] } },
    select: { id: true, title: true, reviewStatus: true, reviewNote: true, riskFlags: true, club: { select: { name: true, officeId: true } } },
  });
  const pending = waiting.filter((e) => e.reviewStatus === "PENDING");
  check(
    pending.length === 2 && pending.every((e) => e.riskFlags.length > 0) && pending.some((e) => e.club?.officeId === null) && pending.some((e) => e.club?.officeId === rec?.id),
    "Two events wait for review, one in WSUSA's queue and one in Campus Recreation's",
    pending.map((e) => `${e.title} (${e.club?.name}: ${e.riskFlags.join(", ")})`).join("; "),
  );
  const ids = waiting.map((e) => e.id);
  const maya = await user("maya");
  const [memberships, roles] = await Promise.all([
    db.membership.findMany({ where: { userId: maya.id, status: "ACTIVE" }, select: { clubId: true } }),
    db.roleAssignment.findMany({ where: { userId: maya.id, endedAt: null }, select: { clubId: true } }),
  ]);
  const mayaClubs = [...new Set([...memberships, ...roles].map((m) => m.clubId))];
  const trip = await db.event.findFirst({ where: { id: { in: ids }, riskFlags: { has: "TRAVEL" }, club: { officeId: rec?.id ?? "none" } }, select: { clubId: true, visibility: true } });
  const publicFeed = await db.event.count({ where: { AND: [eventVisibilityWhere({ signedIn: false, admin: false, memberClubIds: [] }), { id: { in: ids } }] } });
  const mayaFeed = await db.event.count({ where: { AND: [eventVisibilityWhere({ signedIn: true, admin: false, memberClubIds: mayaClubs }), { id: { in: ids } }] } });
  check(
    publicFeed === 0 && mayaFeed === 0 && Boolean(trip && mayaClubs.includes(trip.clubId!) && trip.visibility === "MEMBERS"),
    "Events under review stay off the public feed and Maya's, though the members-only trip is her club's",
    `${publicFeed} public, ${mayaFeed} for Maya`,
  );
  const tasks = await db.task.findMany({ where: { sourceType: "eventReview", status: "OPEN" }, select: { sourceId: true, officeId: true, kind: true, assigneeType: true } });
  const off = pending.filter((e) => {
    const mine = tasks.filter((t) => t.sourceId === e.id);
    return mine.length !== 1 || mine[0].kind !== "APPROVAL" || mine[0].assigneeType !== "ADMINS" || (mine[0].officeId ?? null) !== (e.club?.officeId ?? null);
  });
  check(off.length === 0 && tasks.length === pending.length, "…each with exactly one open review task, in its club's office's queue", off.map((e) => e.title).join(", "));
  const back = waiting.filter((e) => e.reviewStatus === "CHANGES_REQUESTED");
  check(back.length === 1 && Boolean(back[0].reviewNote) && !tasks.some((t) => t.sourceId === back[0].id), "One event was sent back with a note, waiting on its club", back.map((e) => `${e.title} (${e.club?.name})`).join(", "));
  const trips = await db.event.findMany({ where: { riskFlags: { has: "TRAVEL" } }, select: { title: true, travel: true } });
  const noTrip = trips.filter((t) => !readTravel(t.travel));
  check(trips.length >= 2 && noTrip.length === 0, "Every event with Travel carries its trip (destination, dates, drivers)", noTrip.map((t) => t.title).join(", ") || `${trips.length} trips`);
  const approved = await db.event.findFirst({ where: { title: "Girls in STEM Robot Day" }, select: { id: true, reviewStatus: true, riskFlags: true, reviewedById: true } });
  const posted = approved ? await db.event.count({ where: { AND: [eventVisibilityWhere({ signedIn: false, admin: false, memberClubIds: [] }), { id: approved.id }] } }) : 0;
  check(approved?.reviewStatus === "APPROVED" && approved.riskFlags.includes("MINORS") && Boolean(approved.reviewedById) && posted === 1, "Girls in STEM Robot Day was approved (people under 18) and is posted as usual");
  const history = await db.event.count({ where: { reviewStatus: "APPROVED", riskFlags: { isEmpty: false }, startsAt: { lt: NOW } } });
  check(history >= 3, "A few past events carry flags, reviewed before they happened", `${history} events`);
  check((await db.attendance.count({ where: { occurrence: { event: { reviewStatus: { in: [...UNDER_REVIEW] } } } } })) === 0, "Nothing under review has attendance");
}

/**
 * Founding (lib/domain/cofounders, clubs; steps/founding): Frank's draft has
 * a co-founder who accepted his invitation and sits in the Vice President
 * seat, and an invitation waiting for Sam (a task and a bell). It and his
 * club in review are listed as forming, with followers who aren't members
 * (Maya isn't one yet), nothing decided is listed, and forming clubs stay out
 * of search. WSUSA has one request to bring a retired club back, from an
 * invented student.
 */
async function foundingChecks() {
  const [frank, sam, maya, bee, puzzle, photo] = await Promise.all([user("frank"), user("sam"), user("maya"), club("beekeeping"), club("boardgames"), club("photo")]);

  const accepted = await db.cofounderInvite.findMany({ where: { clubId: bee.id, status: "ACCEPTED" } });
  const cofounderId = accepted[0]?.inviteeId ?? "";
  const [membership, vp] = await Promise.all([
    db.membership.findUnique({ where: { userId_clubId: { userId: cofounderId, clubId: bee.id } } }),
    db.roleAssignment.findFirst({ where: { clubId: bee.id, userId: cofounderId, endedAt: null, role: "VP" } }),
  ]);
  check(
    accepted.length === 1 && accepted[0].invitedById === frank.id && membership?.status === "ACTIVE" && membership.source === "FOUNDER" && Boolean(vp),
    `${bee.name}: one co-founder accepted Frank's invitation and sits in the Vice President seat (a FOUNDER member)`,
  );
  const samInvite = await db.cofounderInvite.findFirst({ where: { clubId: bee.id, status: "PENDING", inviteeId: sam.id, invitedById: frank.id } });
  const samTask = samInvite ? await db.task.count({ where: { assigneeId: sam.id, sourceType: COFOUNDER_INVITE, sourceId: samInvite.id, status: "OPEN", href: `/cofounder/${samInvite.token}` } }) : 0;
  const samBell = await db.notification.count({ where: { userId: sam.id, kind: "cofounder.invited", readAt: null } });
  check(Boolean(samInvite) && samTask === 1 && samBell === 1, "Sam has Frank's co-founder invitation waiting: an open task linking to it and an unread bell");
  const pending = await db.cofounderInvite.findMany({ where: { status: "PENDING" }, select: { clubId: true, email: true, club: { select: { status: true } } } });
  const perClub = new Map<string, number>();
  for (const p of pending) perClub.set(p.clubId, (perClub.get(p.clubId) ?? 0) + 1);
  check(
    pending.every((p) => emailKind(p.email) === "STUDENT" && isFounding(p.club.status)) && Math.max(0, ...perClub.values()) <= COFOUNDER_PENDING_CAP,
    `Waiting co-founder invitations are for students, at clubs still being founded, at most ${COFOUNDER_PENDING_CAP} per club`,
    `${pending.length} waiting`,
  );

  const forming = await db.club.findMany({ where: { listedAsForming: true }, select: { id: true, name: true, status: true } });
  check(
    forming.length === 2 && forming.every((c) => isFounding(c.status)) && forming.some((c) => c.id === bee.id && c.status === "DRAFT") && forming.some((c) => c.id === puzzle.id && c.status === "SUBMITTED"),
    "Two clubs are listed as forming, both still being founded: Frank's draft and his club in review",
    forming.map((c) => `${c.name} (${c.status})`).join(", "),
  );
  const [beeFollowers, beeMembers] = await Promise.all([
    db.calendarSubscription.findMany({ where: { clubId: bee.id }, select: { userId: true } }),
    db.membership.findMany({ where: { clubId: bee.id, status: "ACTIVE" }, select: { userId: true } }),
  ]);
  const followerIds = beeFollowers.map((f) => f.userId).filter((id) => !beeMembers.some((m) => m.userId === id));
  check(followerIds.length >= 5, `${bee.name} has about six followers who aren't members`, `${followerIds.length}`);
  const puzzleFollowers = await db.calendarSubscription.count({ where: { clubId: puzzle.id } });
  const mayaFollows = await db.calendarSubscription.count({ where: { clubId: puzzle.id, userId: maya.id } });
  check(puzzleFollowers >= 3 && mayaFollows === 0, `${puzzle.name} has followers, and Maya isn't one yet (she follows it in the walkthrough)`, `${puzzleFollowers} followers`);
  check((await db.clubSearchDoc.count({ where: { clubId: { in: forming.map((c) => c.id) } } })) === 0, "Forming clubs stay out of search");

  const revivals = await db.task.findMany({
    where: { sourceType: CLUB_REVIVAL, status: "OPEN" },
    select: { sourceId: true, clubId: true, assigneeType: true, officeId: true, kind: true, club: { select: { status: true } }, createdBy: { select: { email: true, kind: true, status: true } } },
  });
  const personaEmails = new Set(PERSONAS.map((p) => p.email));
  const r = revivals[0];
  check(
    revivals.length === 1 && r.sourceId === photo.id && r.clubId === photo.id && r.club?.status === "RETIRED" && r.kind === "APPROVAL" && r.assigneeType === "ADMINS" && r.officeId === null && r.createdBy?.kind === "STUDENT" && r.createdBy.status === "ACTIVE" && !personaEmails.has(r.createdBy.email),
    `${photo.name} has one open revival request, in WSUSA's queue, from an invented student`,
  );
  check((await db.notification.count({ where: { kind: "club.revival_requested", user: { email: "alex.morgan@weber.edu" } } })) === 1, "…and Alex has the bell for it");
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
