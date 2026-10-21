/**
 * Random but reproducible fixture worlds for the requirement equivalence
 * tests: clubs in every phase, students and staff (some not active),
 * overlapping roles with tied start dates, memberships, requirements of
 * every kind and renewal (forms, a hard gate, two sharing one test, one whose
 * test or training is gone, one turned off), passed, failed and waiting
 * attempts (on time and late), training check-ins, member details, and an
 * inbox that's out of step on purpose: stale due dates, titles, hrefs and
 * clubs, tasks nobody owes, excused and missing assignments, earlier notices.
 *
 * `{ offices: true }` adds what the old code never knew about, from its own
 * generator so the plain worlds stay exactly as they were: an office that
 * oversees some clubs, requirements it owns (for leaders and for members),
 * and single-permission requirements (Events, Budget) with attempts on
 * their tests. Only the new code runs those worlds.
 */
import type { Tables } from "./fake-db";
import { renewalCycle } from "@/lib/tests/cycles";

const DAY = 86_400_000;
const d = (iso: string) => new Date(iso);

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p: number) => next() < p,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(list: readonly T[]) => list[Math.floor(next() * list.length)],
    sample: <T,>(list: readonly T[], n: number) => [...list].sort(() => next() - 0.5).slice(0, n),
  };
}

const TERMS = [
  ["Fall 2025", "2025-2026", "2025-08-25T06:00:00Z", "2025-12-13T06:59:00Z"],
  ["Spring 2026", "2025-2026", "2026-01-05T07:00:00Z", "2026-04-25T05:59:00Z"],
  ["Summer 2026", "2025-2026", "2026-05-04T06:00:00Z", "2026-08-08T05:59:00Z"],
  ["Fall 2026", "2026-2027", "2026-08-31T06:00:00Z", "2026-12-19T06:59:00Z"],
  ["Spring 2027", "2026-2027", "2027-01-11T07:00:00Z", "2027-05-01T05:59:00Z"],
  ["Summer 2027", "2026-2027", "2027-05-10T06:00:00Z", "2027-08-14T05:59:00Z"],
] as const;

/** Mid-term, the first days of a term, between terms, a new semester, summer. */
const NOWS = ["2026-10-18T18:00:00Z", "2026-09-02T15:00:00Z", "2026-12-28T18:00:00Z", "2027-01-12T18:00:00Z", "2027-06-01T18:00:00Z"];

const LEADER = ["OFFICER", "VP", "PRESIDENT"];

export type World = { seed: number; now: Date; tables: Tables; userIds: string[]; clubIds: string[] };

export function buildWorld(seed: number, opts: { offices?: boolean } = {}): World {
  const r = rng(seed);
  const now = d(r.pick(NOWS));
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const t: Tables = {};
  const terms = r.chance(0.1)
    ? []
    : TERMS.map(([name, academicYear, startsOn, endsOn], i) => ({ id: `term${i}`, name, academicYear, startsOn: d(startsOn), endsOn: d(endsOn), countsForActivity: true }));
  t.term = terms;

  t.club = [
    { id: "c1", name: "Robotics", slug: "robotics", status: "APPROVED", approvedAt: d("2024-01-10T17:00:00Z"), type: "REGISTERED" },
    { id: "c2", name: "Chess", slug: "chess", status: "APPROVED", approvedAt: ago(10), type: "REGISTERED" },
    { id: "c3", name: "Hiking", slug: "hiking", status: "APPROVED", approvedAt: null, type: "REGISTERED" },
    { id: "c4", name: "Beekeeping", slug: "bees", status: "SUBMITTED", approvedAt: null, type: "REGISTERED" },
    { id: "c5", name: "Old Club", slug: "old", status: "RETIRED", approvedAt: d("2023-05-01T17:00:00Z"), type: "REGISTERED" },
  ];
  const clubIds = t.club.map((c) => c.id as string);

  const userIds = Array.from({ length: 26 }, (_, i) => `u${String(i + 1).padStart(2, "0")}`);
  t.user = userIds.map((id, i) => ({
    id,
    email: `${id}@mail.weber.edu`,
    name: `Person ${id}`,
    handle: id,
    avatarUrl: null,
    avatarColor: "#4b2e83",
    kind: i >= 24 ? "FACULTY_STAFF" : "STUDENT",
    status: i === 20 ? "ALUMNI" : i === 21 ? "DEACTIVATED" : "ACTIVE",
    platformRole: "USER",
  }));

  const fields = { studentId: "W01234567", birthDate: d("2004-03-01T00:00:00Z"), gender: "FEMALE", phone: "801-555-0100", yearInSchool: "JUNIOR", addressLine: "1 Main", addressCity: "Ogden", addressState: "UT", addressZip: "84408", emergencyName: "Pat", emergencyRelationship: "PARENT_GUARDIAN", emergencyPhone: "801-555-0101", emergencyEmail: "pat@example.com" };
  t.personalDetails = userIds.filter(() => r.chance(0.75)).map((userId) => {
    const row: Record<string, unknown> = { userId, contactEmail: null, ...fields, confirmedAt: r.chance(0.2) ? null : ago(r.int(0, 420)), updatedAt: ago(1) };
    if (r.chance(0.25)) row[r.pick(Object.keys(fields))] = null;
    return row;
  });

  t.test = [
    { id: "tTest", title: "Officer Test", isForm: false, audience: "ROLE_REQUIREMENT", clubId: null, status: "PUBLISHED" },
    { id: "tForm1", title: "Agreements", isForm: true, audience: "ROLE_REQUIREMENT", clubId: null, status: "PUBLISHED" },
    { id: "tForm2", title: "Re-registration", isForm: true, audience: "ROLE_REQUIREMENT", clubId: null, status: "PUBLISHED" },
    { id: "tClub", title: "Club Quiz", isForm: false, audience: "CLUB_MEMBERS", clubId: "c1", status: "PUBLISHED" },
  ];
  t.event = [
    { id: "e1", title: "Officer Training", clubId: null },
    { id: "e2", title: "VP Retreat", clubId: null },
  ];
  t.eventOccurrence = [
    ["o1", "e1", "2025-10-01T18:00:00Z"],
    ["o2", "e1", "2026-09-10T18:00:00Z"],
    ["o3", "e1", "2027-01-20T18:00:00Z"],
    ["o4", "e2", "2026-02-01T18:00:00Z"],
    ["o5", "e2", "2026-10-01T18:00:00Z"],
  ].map(([id, eventId, at]) => ({ id, eventId, startsAt: d(at), endsAt: new Date(d(at).getTime() + 2 * 3_600_000) }));

  // Requirements (in the order the rule walks them: oldest first, then by name).
  const early = d("2024-08-06T14:00:00Z");
  const recent = ago(r.pick([2, 17, 60]));
  const palette = [
    { name: "Club Officer Policy Test", kind: "TEST", testId: "tTest", trainingEventId: null, appliesTo: LEADER, renewal: "ACADEMIC_YEAR", graceDays: 30, createdAt: early },
    { name: "Club Officer Training", kind: "TRAINING", testId: null, trainingEventId: "e1", appliesTo: LEADER, renewal: "ACADEMIC_YEAR", graceDays: 45, createdAt: early },
    { name: "Club Member Agreements", kind: "TEST", testId: "tForm1", trainingEventId: null, appliesTo: ["MEMBER"], renewal: "ACADEMIC_YEAR", graceDays: 30, createdAt: recent },
    { name: "Annual Club Re-registration", kind: "TEST", testId: "tForm2", trainingEventId: null, appliesTo: ["PRESIDENT"], renewal: "ACADEMIC_YEAR", graceDays: 0, createdAt: recent },
    { name: "Member details", kind: "PROFILE", testId: null, trainingEventId: null, appliesTo: ["MEMBER"], renewal: "ACADEMIC_YEAR", graceDays: 30, createdAt: recent },
    { name: "Ambassador Orientation", kind: "TRAINING", testId: null, trainingEventId: null, appliesTo: ["AMBASSADOR"], renewal: "NONE", graceDays: 14, createdAt: ago(200) },
    { name: "Semester Safety Check", kind: "TEST", testId: "tTest", trainingEventId: null, appliesTo: ["MEMBER", "OFFICER"], renewal: "SEMESTER", graceDays: 7, createdAt: ago(r.int(5, 300)) },
    { name: "VP Retreat", kind: "TRAINING", testId: null, trainingEventId: "e2", appliesTo: ["VP"], renewal: "ANNUAL", graceDays: 20, createdAt: ago(r.int(5, 300)) },
    { name: "Leader details", kind: "PROFILE", testId: null, trainingEventId: null, appliesTo: ["AMBASSADOR", "PRESIDENT"], renewal: "NONE", graceDays: 10, createdAt: ago(r.int(1, 300)) },
    { name: "Broken test", kind: "TEST", testId: null, trainingEventId: null, appliesTo: ["OFFICER"], renewal: "ACADEMIC_YEAR", graceDays: 5, createdAt: ago(r.int(1, 300)) },
    { name: "Old rule", kind: "TEST", testId: "tClub", trainingEventId: null, appliesTo: ["OFFICER", "MEMBER"], renewal: "ACADEMIC_YEAR", graceDays: 30, createdAt: ago(400), active: false },
  ];
  const chosen = palette.filter((p, i) => i < 2 || r.chance(0.6));
  t.roleRequirement = chosen
    .map((p) => ({ description: r.chance(0.7) ? `About ${p.name}.` : null, active: true, ...p }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.name.localeCompare(b.name))
    .map((p, i) => ({ id: `r${String(i + 1).padStart(2, "0")}`, ...p }));
  const reqs = t.roleRequirement as { id: string; name: string; kind: string; testId: string | null; renewal: "NONE" | "SEMESTER" | "ACADEMIC_YEAR" | "ANNUAL"; active: boolean }[];

  // Seats: several per person, tied start dates, ended ones, every club phase.
  const starts = [d("2024-03-01T16:00:00Z"), d("2025-09-15T16:00:00Z"), ago(40), ago(20), ago(3)];
  const assignments: Record<string, unknown>[] = [];
  for (const userId of userIds)
    for (let i = r.int(0, 3); i > 0; i--)
      assignments.push({
        clubId: r.pick(clubIds),
        userId,
        positionId: null,
        role: r.pick(["AMBASSADOR", "OFFICER", "OFFICER", "VP", "PRESIDENT", "ADVISOR"]),
        permissions: r.sample(["roster", "events", "budget", "files", "tests"], r.int(0, 3)),
        startedAt: r.chance(0.6) ? r.pick(starts) : ago(r.int(0, 700)),
        endedAt: r.chance(0.2) ? ago(r.int(0, 30)) : null,
        viaClubId: null,
      });
  t.roleAssignment = assignments
    .sort((a, b) => (a.startedAt as Date).getTime() - (b.startedAt as Date).getTime())
    .map((a, i) => ({ id: `ra${String(i + 1).padStart(3, "0")}`, ...a }));

  const memberships: Record<string, unknown>[] = [];
  for (const userId of userIds)
    for (const clubId of r.sample(clubIds, r.int(0, 4))) {
      const requestedAt = ago(r.int(5, 900));
      memberships.push({ userId, clubId, status: r.pick(["ACTIVE", "ACTIVE", "ACTIVE", "PENDING", "LEFT"]), source: "REGISTER", requestedAt, joinedAt: r.chance(0.1) ? null : r.chance(0.3) ? r.pick(starts) : new Date(requestedAt.getTime() + DAY), endedAt: null });
    }
  const memberStart = (m: Record<string, unknown>) => ((m.joinedAt ?? m.requestedAt) as Date).getTime();
  t.membership = memberships
    .sort((a, b) => memberStart(a) - memberStart(b) || String(a.clubId).localeCompare(String(b.clubId)))
    .map((m, i) => ({ id: `m${String(i + 1).padStart(3, "0")}`, ...m }));

  // Evidence.
  t.testAttempt = [];
  for (const userId of userIds)
    for (const testId of ["tTest", "tForm1", "tForm2", "tClub"])
      for (let i = r.int(0, 2); i > 0; i--) {
        const kind = r.pick(["pass", "pass", "fail", "review", "review", "draft", "odd"]);
        const submittedAt = kind === "draft" ? null : ago(r.int(0, 500) + r.next());
        t.testAttempt.push({
          id: `a${t.testAttempt.length + 1}`,
          testId,
          userId,
          cycleKey: "x",
          startedAt: ago(600),
          submittedAt,
          status: kind === "draft" ? "IN_PROGRESS" : kind === "review" || kind === "odd" ? "NEEDS_REVIEW" : "GRADED",
          passed: kind === "pass" || kind === "odd" ? true : kind === "fail" ? false : null,
        });
      }
  t.attendance = [];
  for (const userId of userIds)
    for (const eventId of ["e1", "e2"])
      if (r.chance(0.35)) {
        const occ = r.pick(t.eventOccurrence.filter((o) => o.eventId === eventId && (o.startsAt as Date) <= now));
        if (occ) t.attendance.push({ id: `at${t.attendance.length + 1}`, occurrenceId: occ.id, userId, clubId: null, method: "QR", checkedInAt: new Date((occ.startsAt as Date).getTime() + r.int(0, 90) * 60_000) });
      }

  // The inbox, out of step on purpose.
  t.task = [];
  const titleFor = (q: (typeof reqs)[number]) => (q.kind === "TRAINING" ? `Attend: ${q.name}` : q.kind === "PROFILE" ? `Confirm: ${q.name}` : `Pass: ${q.name}`);
  for (const userId of userIds)
    for (const q of reqs)
      if (r.chance(0.3)) {
        t.task.push({
          id: `k${t.task.length + 1}`,
          kind: "REQUIREMENT",
          title: r.chance(0.7) ? titleFor(q) : r.pick([`Fill out: ${q.name}`, `Take: ${q.name}`, `Fill in: ${q.name}`]),
          description: null,
          assigneeType: "USER",
          assigneeId: userId,
          clubId: r.chance(0.5) ? r.pick(clubIds) : null,
          capability: null,
          href: r.chance(0.7) ? (q.testId ? `/tests/${q.testId}` : "/tasks") : "/somewhere",
          dueAt: r.chance(0.1) ? null : ago(r.int(-60, 60)),
          required: r.chance(0.9),
          status: r.pick(["OPEN", "OPEN", "OPEN", "DONE", "CANCELLED"]),
          sourceType: "requirement",
          sourceId: `${q.id}:${userId}`,
          createdById: null,
          createdAt: ago(r.int(1, 400)),
          completedAt: null,
          completedById: null,
        });
      }
  // Keep at most one open copy per person and requirement (two only come from races, handled separately).
  const seen = new Set<string>();
  t.task = t.task.filter((k) => k.status !== "OPEN" || (!seen.has(k.sourceId as string) && Boolean(seen.add(k.sourceId as string))));
  t.task.push(
    { id: "k-orphan", kind: "REQUIREMENT", title: "Pass: Nothing", description: null, assigneeType: "USER", assigneeId: "u03", clubId: null, capability: null, href: "/tasks", dueAt: ago(3), required: true, status: "OPEN", sourceType: "requirement", sourceId: null, createdById: null, createdAt: ago(9), completedAt: null, completedById: null },
    { id: "k-gone", kind: "REQUIREMENT", title: "Pass: Gone", description: null, assigneeType: "USER", assigneeId: "u04", clubId: null, capability: null, href: "/tasks", dueAt: ago(3), required: true, status: "OPEN", sourceType: "requirement", sourceId: "r-deleted:u04", createdById: null, createdAt: ago(9), completedAt: null, completedById: null },
    { id: "k-club", kind: "CLUB", title: "Order pizza", description: null, assigneeType: "CLUB", assigneeId: null, clubId: "c1", capability: "events", href: "/tasks", dueAt: ago(-2), required: false, status: "OPEN", sourceType: null, sourceId: null, createdById: "u01", createdAt: ago(2), completedAt: null, completedById: null },
  );

  // This cycle's and earlier assignments, some excused, for requirement tests and a club test.
  t.testAssignment = [];
  const keys = new Set<string>();
  for (const userId of userIds)
    for (const q of reqs.filter((x) => x.testId))
      for (const cycleKey of [renewalCycle(q.renewal, now, terms).key, "2024-2025"])
        if (r.chance(0.3) && !keys.has(`${q.testId}|${userId}|${cycleKey}`)) {
          keys.add(`${q.testId}|${userId}|${cycleKey}`);
          const status = r.pick(["ASSIGNED", "ASSIGNED", "EXCUSED", "COMPLETED", "MISSED"]);
          t.testAssignment.push({ id: `ta${t.testAssignment.length + 1}`, testId: q.testId, userId, cycleKey, dueAt: ago(r.int(-40, 40)), status, createdAt: ago(100), resolvedAt: status === "ASSIGNED" ? null : ago(5) });
        }

  // Notices people already got.
  t.notification = [];
  for (const k of t.task.filter((x) => x.status === "OPEN" && x.assigneeId))
    if (r.chance(0.2)) t.notification.push({ id: `n${t.notification.length + 1}`, userId: k.assigneeId, kind: "requirement.overdue", title: "Earlier", body: null, href: r.chance(0.8) ? k.href : "/other", createdAt: ago(r.int(-1, 70)), readAt: null });

  t.reminderLog = [];
  if (opts.offices) addOffices(t, seed, now);
  return { seed, now, tables: t, userIds, clubIds };
}

/** Offices and single-permission requirements on top of a world (see the module comment). */
function addOffices(t: Tables, seed: number, now: Date) {
  const r = rng(seed * 7919 + 17);
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  t.office = [
    { id: "o-rec", key: "campus-rec", name: "Campus Recreation", shortName: "Campus Rec", umbrella: false },
    { id: "o-fsl", key: "fsl", name: "Fraternity & Sorority Life", shortName: "FSL", umbrella: false },
  ];
  // Two clubs belong to Campus Recreation (one approved long ago, one never approved), one to FSL.
  for (const c of t.club) c.officeId = c.id === "c1" || c.id === "c3" ? "o-rec" : c.id === "c2" && r.chance(0.5) ? "o-fsl" : null;
  t.test.push(
    { id: "tSafety", title: "Event Safety Training", isForm: false, audience: "ROLE_REQUIREMENT", clubId: null, status: "PUBLISHED", officeId: null },
    { id: "tRec", title: "Sport club safety forms", isForm: true, audience: "ROLE_REQUIREMENT", clubId: null, status: "PUBLISHED", officeId: "o-rec" },
    { id: "tMoney", title: "Treasurer Basics", isForm: false, audience: "ROLE_REQUIREMENT", clubId: null, status: "PUBLISHED", officeId: null },
  );
  const LEADERS = ["AMBASSADOR", "OFFICER", "VP", "PRESIDENT"];
  const extra = [
    { name: "Event Safety Training", kind: "TEST", testId: "tSafety", appliesTo: LEADERS, gatesCapability: "events", officeId: null, graceDays: r.pick([0, 10, 30]), createdAt: ago(r.int(20, 400)) },
    { name: "Treasurer Basics", kind: "TEST", testId: "tMoney", appliesTo: ["OFFICER", "VP"], gatesCapability: "budget", officeId: null, graceDays: 14, createdAt: ago(r.int(5, 300)) },
    { name: "Sport club safety forms", kind: "TEST", testId: "tRec", appliesTo: LEADERS, gatesCapability: null, officeId: "o-rec", graceDays: r.pick([7, 30]), createdAt: ago(r.int(5, 300)) },
    { name: "Campus Rec waiver", kind: "TEST", testId: "tRec", appliesTo: ["MEMBER"], gatesCapability: null, officeId: "o-rec", graceDays: 20, createdAt: ago(r.int(5, 120)) },
    { name: "Recreation event permit", kind: "TEST", testId: "tSafety", appliesTo: ["OFFICER", "PRESIDENT"], gatesCapability: "events", officeId: "o-rec", graceDays: 5, createdAt: ago(r.int(5, 200)) },
  ].filter((_, i) => i === 0 || r.chance(0.75));
  const base = t.roleRequirement.length;
  const rows: Record<string, unknown>[] = [
    ...t.roleRequirement.map((q) => ({ officeId: null, gatesCapability: null, ...q })),
    ...extra.map((p, i) => ({ id: `rx${String(base + i + 1).padStart(2, "0")}`, description: null, renewal: "ACADEMIC_YEAR", trainingEventId: null, active: true, ...p })),
  ];
  t.roleRequirement = rows.sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime() || String(a.name).localeCompare(String(b.name)));
  // Attempts on the new tests: passes, fails and waits, some long ago.
  for (const userId of t.user.map((u) => u.id as string))
    for (const testId of ["tSafety", "tRec", "tMoney"])
      if (r.chance(0.35)) {
        const kind = r.pick(["pass", "pass", "fail", "review"]);
        t.testAttempt.push({
          id: `ax${t.testAttempt.length + 1}`,
          testId,
          userId,
          cycleKey: "x",
          startedAt: ago(600),
          submittedAt: ago(r.int(0, 300) + r.next()),
          status: kind === "review" ? "NEEDS_REVIEW" : "GRADED",
          passed: kind === "pass" ? true : kind === "fail" ? false : null,
        });
      }
  // Give more seats Events (and Budget), so single-permission requirements reach plenty of people.
  for (const a of t.roleAssignment) if (r.chance(0.4)) a.permissions = [...new Set([...(a.permissions as string[]), r.pick(["events", "budget"])])];
}
