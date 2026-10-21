import type { Prisma } from "@prisma/client";
import type { Assignment, ClubM, Ctx } from "../ctx";
import { POLICIES } from "../data/policies";
import { AGREEMENT_QUESTIONS, AGREEMENTS_FORM_INTRO, FUNDING_QUESTIONS, OFFICER_QUESTIONS, OFFICER_TEST_INTRO, REVIEWER_COMMENTS, SAFETY_QUESTIONS, SAFETY_QUIZ_INTRO, type QuestionDef } from "../data/tests";
import { addDays, addMin, DAY, maxDate, minDate } from "../lib/dates";
import { addFolder, addPdf } from "./filehelp";
import { missingDetails, type DetailsLike } from "@/lib/details/rules";
import { fallStartDate } from "./reference";

/**
 * Policies, tests and officer requirements. Fulfillment is never stored: the
 * seed writes passing attempts and training check-ins, and the platform works
 * out who's met what. Personas: Priya and Vanessa met both requirements, Oscar
 * is inside his 30/45-day grace period, and one non-persona officer is past
 * grace so the "permissions paused" state can be seen.
 */

const LEAD = new Set(["OFFICER", "VP", "PRESIDENT"]);
const PERSONA_CLUBS = new Set(["robotics", "swe", "psych", "ailab", "fic", "premed", "climbing", "service", "polisci", "gsbe-amb", "east-amb", "accounting", "marketing"]);

/** Picks the officer whose requirement deadline has passed (runs before attendance, so they skip training). */
export function choosePastGrace(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const ay = ctx.academicYear(NOW);
  if (addDays(ay.start, 31) > NOW) return; // too early in the year for anyone to be overdue
  const cands = ctx.clubs
    .filter((c) => c.status === "APPROVED" && c.def.life === "active" && !PERSONA_CLUBS.has(c.def.key))
    .flatMap((c) => c.assignments.filter((a) => a.role === "OFFICER" && !a.endedAt && !a.pinned && a.startedAt < addDays(ay.start, -10)).map((a) => ({ c, a })))
    // Someone with exactly one leadership role, so "paused" is easy to see in one club.
    .filter(({ a }) => !ctx.person(a.userId).persona && ctx.clubs.flatMap((c) => c.assignments).filter((x) => x.userId === a.userId && !x.endedAt && LEAD.has(x.role)).length === 1);
  if (!cands.length) return;
  const pick = cands.find(({ c, a }) => c.def.key === "ultimate" && a.seatName === "Treasurer") ?? rng.pick(cands);
  ctx.refs.pastGraceUserId = pick.a.userId;
  ctx.refs.pastGraceClubId = pick.c.id;
}

function questionRows(ctx: Ctx, testId: string, defs: QuestionDef[]) {
  return defs.map((q, i) => {
    const row: Prisma.TestQuestionCreateManyInput = {
      id: ctx.id(),
      testId,
      order: i + 1,
      type: q.type,
      promptHtml: q.prompt,
      options: (q.options ?? []) as unknown as Prisma.InputJsonValue,
      correctOptionIds: q.correct ?? [],
      modelAnswer: q.modelAnswer ?? null,
      points: 1,
    };
    ctx.rows.questions.push(row);
    return { def: q, id: row.id as string };
  });
}

type Q = ReturnType<typeof questionRows>[number];

/** One attempt with answers. outcome decides pass/fail; "review" leaves open answers ungraded. */
function attempt(
  ctx: Ctx,
  opts: { testId: string; questions: Q[]; userId: string; cycleKey: string; submittedAt: Date; outcome: "pass" | "fail" | "review"; limitMinutes: number | null; passing: number; graderId: string | null },
) {
  const { rng, NOW } = ctx;
  const total = opts.questions.length;
  let answers: { q: Q; selected: string[]; text: string | null; points: number | null; comment: string | null }[] = [];
  let score = 0;
  for (let tries = 0; tries < 30; tries++) {
    const pc = opts.outcome === "fail" ? 0.5 : 0.93;
    answers = opts.questions.map((q) => {
      if (q.def.type === "SHORT_ANSWER" || q.def.type === "LONG_ANSWER") {
        const good = rng.chance(pc);
        const text = q.def.answers ? q.def.answers[good ? 0 : 1] : good ? "<p>Answer covers the main points.</p>" : "<p>Not sure.</p>";
        const points = opts.outcome === "review" ? null : good ? 1 : rng.chance(0.3) ? 0.5 : 0;
        return { q, selected: [], text, points, comment: opts.outcome === "review" || !rng.chance(0.4) ? null : rng.pick(REVIEWER_COMMENTS) };
      }
      const correct = q.def.correct ?? [];
      if (rng.chance(pc)) return { q, selected: [...correct], text: null, points: 1, comment: null };
      const ids = (q.def.options ?? []).map((o) => o.id);
      const wrong = q.def.type === "MULTI_CHOICE" ? rng.sample(ids, rng.int(1, Math.max(1, ids.length - 1))) : [rng.pick(ids.filter((x) => !correct.includes(x)))];
      const same = wrong.length === correct.length && wrong.every((x) => correct.includes(x));
      return { q, selected: same ? [ids.find((x) => !correct.includes(x)) ?? ids[0]] : wrong, text: null, points: 0, comment: null };
    });
    score = (answers.reduce((s, a) => s + (a.points ?? 0), 0) / total) * 100;
    if (opts.outcome === "pass" && score >= opts.passing) break;
    if (opts.outcome === "fail" && score < opts.passing) break;
    if (opts.outcome === "review") break;
  }
  const duration = rng.float(6, opts.limitMinutes ? opts.limitMinutes - 2 : 25);
  const startedAt = addMin(opts.submittedAt, -duration);
  const graded = opts.outcome !== "review";
  const gradedAt = graded ? minDate(addDays(opts.submittedAt, rng.float(0.2, 2.5)), addMin(NOW, -30)) : null;
  const id = ctx.id();
  ctx.rows.attempts.push({
    id,
    testId: opts.testId,
    userId: opts.userId,
    cycleKey: opts.cycleKey,
    startedAt,
    deadlineAt: opts.limitMinutes ? addMin(startedAt, opts.limitMinutes) : null,
    submittedAt: opts.submittedAt,
    autoSubmitted: false,
    status: graded ? "GRADED" : "NEEDS_REVIEW",
    scorePercent: graded ? Math.round(score * 10) / 10 : null,
    passed: graded ? score >= opts.passing : null,
    gradedById: graded && answers.some((a) => a.text) ? opts.graderId : null,
    gradedAt: graded && answers.some((a) => a.text) ? gradedAt : graded ? opts.submittedAt : null,
  });
  for (const a of answers) {
    ctx.rows.answers.push({
      id: ctx.id(),
      attemptId: id,
      questionId: a.q.id,
      selectedOptionIds: a.selected,
      text: a.text,
      pointsAwarded: a.points,
      reviewerComment: a.comment,
    });
  }
  return { id, score, passed: graded && score >= opts.passing, gradedAt: gradedAt ?? opts.submittedAt };
}

function policies(ctx: Ctx) {
  const { NOW } = ctx;
  const alex = ctx.p("alex").id;
  const jordan = ctx.refs["admin:jordan"];
  const uni = { dir: "university" };
  const folder = addFolder(ctx, uni, "Policies", { createdById: alex, createdAt: addDays(NOW, -365), visibility: "PUBLIC" });
  ctx.refs.universityPolicyFolder = folder;
  for (const p of POLICIES) {
    const createdAt = addDays(NOW, -p.daysAgo);
    const author = p.daysAgo > 500 ? jordan : alex;
    let documentFileId: string | null = null;
    if (p.pdf) {
      documentFileId = addPdf(ctx, uni, p.pdf.name, { title: p.title, subtitle: "Weber State University · WSUSA Clubs & Organizations", blocks: p.pdf.blocks, footer: "Wildcat Clubs sample document" }, {
        parentId: folder, createdById: author, createdAt, visibility: "PUBLIC",
      });
    }
    const id = ctx.id();
    const updatedAt = p.version > 1 ? addDays(createdAt, 40 * (p.version - 1)) : createdAt;
    ctx.rows.policies.push({
      id, slug: p.slug, title: p.title, summary: p.summary, bodyHtml: p.bodyHtml, documentFileId, placements: p.placements, status: p.status,
      version: p.version, effectiveAt: p.status === "PUBLISHED" ? updatedAt : null, authorId: author, createdAt, updatedAt: minDate(updatedAt, NOW),
    });
    if (p.status === "PUBLISHED") {
      ctx.activity({ at: minDate(updatedAt, NOW), actorId: author, action: "policy.published", entityType: "policy", entityId: id, data: { slug: p.slug, title: p.title, version: p.version }, isPublic: true });
    }
  }
}

/** Officer-level users in an academic year, with the club and clock of their first role. */
function officersIn(ctx: Ctx, start: Date, end: Date) {
  const until = minDate(end, ctx.NOW);
  const out = new Map<string, { club: ClubM; a: Assignment; clock: Date }>();
  for (const club of ctx.clubs) {
    if (!club.approvedAt) continue;
    for (const a of club.assignments) {
      if (!LEAD.has(a.role) || a.startedAt >= until || (a.endedAt && a.endedAt <= start)) continue;
      if (ctx.person(a.userId).kind !== "STUDENT") continue;
      const clock = maxDate(a.startedAt, club.approvedAt, start);
      const cur = out.get(a.userId);
      if (!cur || clock < cur.clock) out.set(a.userId, { club, a, clock });
    }
  }
  return out;
}

export function buildGovernance(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const alex = ctx.p("alex").id;
  const jordan = ctx.refs["admin:jordan"];
  policies(ctx);

  // ─── Club Officer Policy Test ──────────────────────────────────────────────
  const officerTestId = ctx.id();
  ctx.refs.officerTestId = officerTestId;
  const testCreated = addDays(fallStartDate(2024), -20);
  ctx.rows.tests.push({
    id: officerTestId, clubId: null, title: "Club Officer Policy Test", introHtml: OFFICER_TEST_INTRO, timeLimitMinutes: 30, passingPercent: 80, maxAttempts: null,
    status: "PUBLISHED", audience: "ROLE_REQUIREMENT", recurrence: "ACADEMIC_YEAR", dueDays: 30, closesAt: null,
    automations: [{ trigger: "MISSED_DEADLINE", action: "NOTIFY_ADVISOR" }, { trigger: "FAILED", action: "NOTIFY_TAKER" }],
    createdById: jordan, createdAt: testCreated, updatedAt: addDays(NOW, -50),
  });
  const officerQs = questionRows(ctx, officerTestId, OFFICER_QUESTIONS);

  const testReqId = ctx.id();
  const trainingReqId = ctx.id();
  ctx.refs.testRequirementId = testReqId;
  ctx.refs.trainingRequirementId = trainingReqId;
  ctx.rows.requirements.push(
    {
      id: testReqId, name: "Club Officer Policy Test", description: "Pass WSUSA's officer policy test (80% or higher) once each academic year.",
      appliesTo: ["OFFICER", "VP", "PRESIDENT"], kind: "TEST", testId: officerTestId, renewal: "ACADEMIC_YEAR", graceDays: 30, active: true, createdAt: testCreated,
    },
    {
      id: trainingReqId, name: "Club Officer Training", description: "Attend one Club Officer Training session each academic year and check in at the door.",
      appliesTo: ["OFFICER", "VP", "PRESIDENT"], kind: "TRAINING", trainingEventId: ctx.refs.trainingEventId, renewal: "ACADEMIC_YEAR", graceDays: 45, active: true, createdAt: testCreated,
    },
  );

  const training = ctx.universityEvents.find((e) => e.id === ctx.refs.trainingEventId)!;
  const trainingAt = (userId: string, from: Date) => {
    let best: Date | null = null;
    for (const o of training.occurrences) {
      const a = o.attendees.get(userId);
      if (a && a.at >= from && (!best || a.at < best)) best = a.at;
    }
    return best;
  };

  const currentAy = ctx.academicYear(NOW);
  const ays = [...new Set(ctx.terms.map((t) => t.academicYear))]
    .map((label) => {
      const ts = ctx.terms.filter((t) => t.academicYear === label);
      return { label, start: ts[0].startsOn, end: ts[ts.length - 1].endsOn };
    })
    .filter((ay) => ay.start >= addDays(fallStartDate(2024), -1) && ay.start <= NOW);

  const oscar = ctx.p("oscar").id;
  const pastGrace = ctx.refs.pastGraceUserId;
  // Priya and Vanessa have always passed this year's test (if the year is more than two days old).
  const alwaysPassed = new Set([ctx.p("priya").id, ctx.p("vanessa").id]);
  let needsReview = 0;
  let recentFails = 0;
  const recentOfficers: string[] = [];

  // Leaders right now (a current OFFICER/VP/PRESIDENT seat in an approved club, students only).
  const currentLeaders = new Set(
    ctx.clubs.flatMap((c) => (c.status === "APPROVED" ? c.assignments.filter((a) => LEAD.has(a.role) && (!a.endedAt || a.endedAt > NOW) && ctx.person(a.userId).kind === "STUDENT").map((a) => a.userId) : [])),
  );
  for (const ay of ays) {
    const isCurrent = ay.label === currentAy.label;
    const grader = isCurrent ? alex : rng.pick([jordan, alex]);
    for (const [userId, { club, clock }] of officersIn(ctx, ay.start, ay.end)) {
      const due = addDays(clock, 30);
      let status: "ASSIGNED" | "COMPLETED" | "MISSED" = "ASSIGNED";
      let resolvedAt: Date | null = null;
      let passedAt: Date | null = null;
      const recent = isCurrent && due > NOW && !(alwaysPassed.has(userId) && clock < addDays(NOW, -2));
      if (recent) recentOfficers.push(userId);

      if (!isCurrent) {
        if (rng.chance(0.9)) {
          let when = minDate(addDays(clock, rng.float(1, 26)), addDays(ay.end, -1));
          if (rng.chance(0.12)) {
            attempt(ctx, { testId: officerTestId, questions: officerQs, userId, cycleKey: ay.label, submittedAt: when, outcome: "fail", limitMinutes: 30, passing: 80, graderId: grader });
            when = addDays(when, rng.float(2, 6));
          }
          const r = attempt(ctx, { testId: officerTestId, questions: officerQs, userId, cycleKey: ay.label, submittedAt: when, outcome: "pass", limitMinutes: 30, passing: 80, graderId: grader });
          status = "COMPLETED";
          resolvedAt = r.gradedAt;
        } else {
          status = "MISSED";
          resolvedAt = due;
        }
      } else if (userId === oscar) {
        // Oscar: due in ~10 days, hasn't started.
      } else if (userId === pastGrace) {
        status = "MISSED";
        resolvedAt = due;
        if (rng.chance(0.5)) attempt(ctx, { testId: officerTestId, questions: officerQs, userId, cycleKey: ay.label, submittedAt: addDays(clock, 12), outcome: "fail", limitMinutes: 30, passing: 80, graderId: grader });
      } else if (recent) {
        if (needsReview < 5 && clock < addDays(NOW, -2)) {
          attempt(ctx, { testId: officerTestId, questions: officerQs, userId, cycleKey: ay.label, submittedAt: addDays(NOW, -rng.float(0.2, Math.min(3, (NOW.getTime() - clock.getTime()) / DAY - 0.1))), outcome: "review", limitMinutes: 30, passing: 80, graderId: null });
          needsReview++;
        } else if (recentFails < 2 && clock < addDays(NOW, -4)) {
          attempt(ctx, { testId: officerTestId, questions: officerQs, userId, cycleKey: ay.label, submittedAt: addDays(NOW, -rng.float(2, Math.min(8, (NOW.getTime() - clock.getTime()) / DAY - 0.5))), outcome: "fail", limitMinutes: 30, passing: 80, graderId: alex });
          recentFails++;
        }
      } else {
        let when = minDate(addDays(clock, rng.float(1, 26)), addDays(NOW, -1.2));
        if (rng.chance(0.12) && when > addDays(clock, 3)) {
          attempt(ctx, { testId: officerTestId, questions: officerQs, userId, cycleKey: ay.label, submittedAt: addDays(when, -rng.float(1, 3)), outcome: "fail", limitMinutes: 30, passing: 80, graderId: grader });
        }
        const r = attempt(ctx, { testId: officerTestId, questions: officerQs, userId, cycleKey: ay.label, submittedAt: when, outcome: "pass", limitMinutes: 30, passing: 80, graderId: grader });
        status = "COMPLETED";
        resolvedAt = r.gradedAt;
        passedAt = when;
      }

      ctx.rows.testAssignments.push({ id: ctx.id(), testId: officerTestId, userId, cycleKey: ay.label, dueAt: due, status, createdAt: clock, resolvedAt });

      if (!isCurrent) continue;
      // REQUIREMENT tasks for this academic year (open until met).
      const trainedAt = trainingAt(userId, ay.start);
      const tasks: [string, string, string, Date, Date | null, string][] = [
        [testReqId, "Pass: Club Officer Policy Test", "Pass WSUSA's officer policy test (80% or higher) once each academic year.", due, passedAt, `/tests/${officerTestId}`],
        [trainingReqId, "Attend: Club Officer Training", "Attend one Club Officer Training session each academic year and check in at the door.", addDays(clock, 45), trainedAt, `/events/${ctx.refs.trainingEventId}`],
      ];
      // Someone who no longer leads anywhere doesn't owe it: an unmet task is cancelled (as syncUserRequirements does).
      const stillLeads = currentLeaders.has(userId);
      for (const [reqId, title, description, dueAt, metAt, href] of tasks) {
        ctx.rows.tasks.push({
          id: ctx.id(), kind: "REQUIREMENT", title, description, assigneeType: "USER", assigneeId: userId, clubId: club.id, href, dueAt, required: true,
          status: metAt ? "DONE" : stillLeads ? "OPEN" : "CANCELLED", sourceType: "requirement", sourceId: `${reqId}:${userId}`, createdAt: clock,
          completedAt: metAt ?? (stillLeads ? null : NOW), completedById: metAt ? userId : null,
        });
      }
      if (recent || userId === oscar) {
        ctx.rows.notifications.push({
          id: ctx.id(), userId, kind: "requirement.assigned", title: "Your new role has WSUSA requirements",
          body: "Finish Club Officer Policy Test, Club Officer Training to keep your permissions on.", href: "/tasks",
          createdAt: addMin(clock, 2), readAt: userId === oscar ? addDays(clock, 1) : rng.chance(0.5) ? addDays(clock, 1) : null,
        });
      }
    }
  }
  ctx.refs.recentOfficers = recentOfficers.join(",");

  // Automations: failed attempts notify the taker; the missed deadline notifies the advisor.
  for (const a of ctx.rows.attempts.filter((x) => x.testId === officerTestId && x.passed === false && x.submittedAt && new Date(x.submittedAt as Date) > addDays(NOW, -30))) {
    ctx.rows.notifications.push({
      id: ctx.id(), userId: a.userId, kind: "test.failed", title: "You didn't pass the Club Officer Policy Test",
      body: `You scored ${Math.round(a.scorePercent ?? 0)}%. You need 80% — you can retake it before your deadline.`, href: `/tests/${officerTestId}`,
      createdAt: (a.gradedAt as Date) ?? NOW, readAt: rng.chance(0.5) ? NOW : null,
    });
  }
  if (pastGrace) {
    const club = ctx.clubById.get(ctx.refs.pastGraceClubId)!;
    const person = ctx.person(pastGrace);
    for (const adv of club.advisorIds.slice(0, 1)) {
      ctx.rows.notifications.push({
        id: ctx.id(), userId: adv, kind: "test.missed", title: `${person.name} missed the Club Officer Policy Test deadline`,
        body: `Their permissions in ${club.name} are paused until they pass the test and attend training.`, href: `/clubs/${club.slug}/manage/org-chart`,
        createdAt: addDays(currentAy.start, 30.4), readAt: null,
      });
    }
    ctx.rows.notifications.push({
      id: ctx.id(), userId: pastGrace, kind: "requirement.overdue", title: `Permissions paused in ${club.name}`,
      body: "Club Officer Policy Test and Club Officer Training are overdue. Your title stays, and your permissions come back as soon as they're done.", href: "/tasks",
      createdAt: addDays(currentAy.start, 30.5), readAt: null,
    });
  }

  // The yearly WSUSA form every member signs. (Clubs re-register through their renewal card, not a form: steps/renewals.)
  requiredForm(ctx, currentAy, {
    ref: "agreements", title: "Club Member Agreements", intro: AGREEMENTS_FORM_INTRO, questions: AGREEMENT_QUESTIONS, rate: 0.64,
    description: "Sign WSUSA's waiver and release, anti-hazing and non-discrimination agreements once each academic year. They cover every club you're in.",
    // Vanessa hasn't signed (her dashboard demo); Maya, Priya and Oscar have.
    unsigned: new Set([ctx.p("vanessa").id]), signed: new Set([ctx.p("maya").id, ctx.p("priya").id, ctx.p("oscar").id]),
  });
  memberDetailsRequirement(ctx, currentAy);

  // ─── Event Safety Quiz (RC Wrecker Bots Club, key "robotics") ──────────────
  const robotics = ctx.club("robotics");
  const quizId = ctx.id();
  const quizCreated = addDays(NOW, -25.3);
  const closesAt = addDays(NOW, 20);
  ctx.rows.tests.push({
    id: quizId, clubId: robotics.id, title: "Event Safety Quiz", introHtml: SAFETY_QUIZ_INTRO, timeLimitMinutes: 15, passingPercent: 80, maxAttempts: 3,
    status: "PUBLISHED", audience: "CLUB_MEMBERS", recurrence: "ONE_OFF", dueDays: 30, closesAt,
    automations: [{ trigger: "FAILED", action: "NOTIFY_TAKER" }], createdById: ctx.p("priya").id, createdAt: quizCreated, updatedAt: quizCreated,
  });
  const quizQs = questionRows(ctx, quizId, SAFETY_QUESTIONS);
  for (const m of robotics.members.filter((x) => x.status === "ACTIVE" && ctx.person(x.userId).kind === "STUDENT")) {
    const joined = maxDate(m.joinedAt!, quizCreated);
    let status: "ASSIGNED" | "COMPLETED" = "ASSIGNED";
    let resolvedAt: Date | null = null;
    if (m.userId !== ctx.p("priya").id && m.userId !== ctx.p("vanessa").id && rng.chance(0.5) && joined < addDays(NOW, -1)) {
      const when = new Date(joined.getTime() + rng.next() * (NOW.getTime() - joined.getTime() - DAY));
      const outcome = rng.chance(0.88) ? "pass" : "fail";
      const r = attempt(ctx, { testId: quizId, questions: quizQs, userId: m.userId, cycleKey: "once", submittedAt: when, outcome, limitMinutes: 15, passing: 80, graderId: null });
      if (r.passed) {
        status = "COMPLETED";
        resolvedAt = when;
      }
    }
    const assignmentId = ctx.id();
    ctx.rows.testAssignments.push({ id: assignmentId, testId: quizId, userId: m.userId, cycleKey: "once", dueAt: closesAt, status, createdAt: joined, resolvedAt });
    // The inbox task tests.syncAssignments opens with every assignment (closed once they pass).
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "TEST", title: "Take: Event Safety Quiz", description: `Assigned by ${robotics.name}.`, assigneeType: "USER", assigneeId: m.userId,
      clubId: robotics.id, href: `/tests/${quizId}`, dueAt: closesAt, status: status === "COMPLETED" ? "DONE" : "OPEN", sourceType: "testAssignment", sourceId: assignmentId,
      createdAt: joined, completedAt: resolvedAt, completedById: resolvedAt ? m.userId : null,
    });
  }

  // ─── Funding Rules Refresher (open to anyone) ──────────────────────────────
  const fundId = ctx.id();
  const fundCreated = addDays(NOW, -40.2);
  ctx.rows.tests.push({
    id: fundId, clubId: null, title: "Funding Rules Refresher",
    introHtml: "<p>A five-question refresher on WSUSA funding rules for treasurers and anyone planning a funding request. Take it as often as you like — it isn't required.</p>",
    timeLimitMinutes: null, passingPercent: 70, maxAttempts: null, status: "PUBLISHED", audience: "OPEN", recurrence: "ONE_OFF", dueDays: 30, closesAt: null,
    automations: [], createdById: ctx.refs["admin:rosa"], createdAt: fundCreated, updatedAt: fundCreated,
  });
  const fundQs = questionRows(ctx, fundId, FUNDING_QUESTIONS);
  const treasurers = ctx.clubs.flatMap((c) => c.assignments.filter((a) => a.seatName === "Treasurer" && !a.endedAt).map((a) => a.userId)).filter((u) => u !== oscar);
  for (const u of rng.sample(treasurers, 14)) {
    const when = addDays(fundCreated, rng.float(1, 38));
    attempt(ctx, { testId: fundId, questions: fundQs, userId: u, cycleKey: "once", submittedAt: when, outcome: rng.chance(0.85) ? "pass" : "fail", limitMinutes: null, passing: 70, graderId: null });
  }

  // Attempts with written answers waiting on a grader get the inbox task tests.finishAttempt opens.
  for (const a of ctx.rows.attempts.filter((x) => x.status === "NEEDS_REVIEW")) {
    const test = ctx.rows.tests.find((t) => t.id === a.testId)!;
    const club = test.clubId ? ctx.clubById.get(test.clubId)! : null;
    const pending = ctx.rows.answers.filter((x) => x.attemptId === a.id && x.text && x.pointsAwarded == null).length;
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "APPROVAL", title: `Grade: ${test.title} — ${ctx.person(a.userId).name}`, description: `${pending} written answer${pending === 1 ? "" : "s"} to review.`,
      assigneeType: club ? "CLUB" : "ADMINS", clubId: club?.id ?? null, capability: club ? "tests" : null,
      href: club ? `/clubs/${club.slug}/manage/tests/${test.id}/review/${a.id}` : `/admin/tests/${test.id}/review/${a.id}`,
      status: "OPEN", sourceType: "testAttempt", sourceId: a.id as string, createdAt: a.submittedAt as Date,
    });
  }

  officeAndPermissionRequirements(ctx, currentAy);
}

// ─── An office's requirement, and one about a single permission ─────────────

const SAFETY_TRAINING_INTRO =
  "<p>A short refresher for anyone who plans club events: what to check in the Events Builder before you post, who reviews events that need a second look, and what to do if something goes wrong. Pass it once each academic year.</p><ul><li>About 10 minutes, 5 questions.</li><li>You need 80% to pass. You can retake it.</li></ul>";

const SAFETY_TRAINING_QUESTIONS: QuestionDef[] = [
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>Your social will probably draw more than 100 people. What do you do in the Events Builder?</p>",
    options: [{ id: "a", text: "Nothing; big events are fine" }, { id: "b", text: "Check “More than 100 people” so your club's office can review the plan first" }, { id: "c", text: "Make it members only" }],
    correct: ["b"],
  },
  {
    type: "MULTI_CHOICE",
    prompt: "<p>Which of these send an event to your club's office for review before it's posted? Select all that apply.</p>",
    options: [{ id: "a", text: "Travel or an overnight stay" }, { id: "b", text: "People under 18" }, { id: "c", text: "Your weekly meeting in the usual room" }, { id: "d", text: "Collecting money" }],
    correct: ["a", "b", "d"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>Who may drive members to an off-campus event?</p>",
    options: [{ id: "a", text: "Anyone with a car" }, { id: "b", text: "The drivers listed with the trip in the Events Builder" }, { id: "c", text: "Whoever gets there first" }],
    correct: ["b"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>Someone is hurt at your event. After calling 911 if it's needed, who do you tell?</p>",
    options: [{ id: "a", text: "Nobody" }, { id: "b", text: "Your advisor and your club's office, the same day" }, { id: "c", text: "Your club's group chat" }],
    correct: ["b"],
  },
  {
    type: "SINGLE_CHOICE",
    prompt: "<p>Where do you find a building's emergency exits?</p>",
    options: [{ id: "a", text: "On the evacuation map by each stairwell and elevator" }, { id: "b", text: "Nowhere; ask security" }, { id: "c", text: "On the club page" }],
    correct: ["a"],
  },
];

const SPORT_FORMS_INTRO =
  "<p>Campus Recreation asks the officers of every sport club to sign these once each academic year, so the club's travel, injury and facility rules are understood before the season. It takes about two minutes.</p>";

const SPORT_FORMS_QUESTIONS: QuestionDef[] = [
  { type: "SINGLE_CHOICE", prompt: "<p><strong>Sport Club Handbook.</strong> I've read Campus Recreation's Sport Club Handbook, including its travel, injury-reporting and facility rules, and I'll follow them.</p>", options: [{ id: "agree", text: "I agree" }] },
  { type: "SINGLE_CHOICE", prompt: "<p><strong>Rosters and waivers.</strong> Our club keeps its roster and emergency contacts current, and every member who takes part has a participation waiver on file.</p>", options: [{ id: "agree", text: "I agree" }] },
  { type: "SINGLE_CHOICE", prompt: "<p><strong>Trips.</strong> Before any trip, we add the destination, dates and drivers to the event in the Events Builder, so Campus Recreation can review it.</p>", options: [{ id: "agree", text: "I agree" }] },
  { type: "SHORT_ANSWER", prompt: "<p>Type your full name to sign.</p>" },
];

/** Questions for a seeded test, numbered in order (no generator draws). */
function plainQuestions(ctx: Ctx, testId: string, defs: QuestionDef[]) {
  return defs.map((q, i) => {
    const id = ctx.id();
    ctx.rows.questions.push({
      id, testId, order: i + 1, type: q.type, promptHtml: q.prompt, options: (q.options ?? []) as unknown as Prisma.InputJsonValue, correctOptionIds: q.correct ?? [], modelAnswer: q.modelAnswer ?? null, points: 1,
    });
    return { def: q, id };
  });
}

/** A graded, passing attempt with every answer right (a signed form when there's nothing to score). */
function passingAttempt(ctx: Ctx, opts: { testId: string; questions: ReturnType<typeof plainQuestions>; userId: string; cycleKey: string; submittedAt: Date; scored: boolean }) {
  const id = ctx.id();
  ctx.rows.attempts.push({
    id, testId: opts.testId, userId: opts.userId, cycleKey: opts.cycleKey, startedAt: addMin(opts.submittedAt, -6), deadlineAt: null, submittedAt: opts.submittedAt, autoSubmitted: false,
    status: "GRADED", scorePercent: opts.scored ? 100 : null, passed: true, gradedById: null, gradedAt: opts.submittedAt,
  });
  for (const q of opts.questions) {
    ctx.rows.answers.push({
      id: ctx.id(), attemptId: id, questionId: q.id, selectedOptionIds: q.def.correct ?? (q.def.options ? [q.def.options[0].id] : []), text: q.def.options ? null : ctx.person(opts.userId).name,
      pointsAwarded: opts.scored && q.def.options ? 1 : null, reviewerComment: null,
    });
  }
}

/**
 * The newer kinds of requirement (lib/authz/requirement-rules
 * requirementReaches), built without the seed's generator, so the rest of
 * the seed stays exactly where it was:
 *  - Event Safety Training: WSUSA's short test for anyone with the Events
 *    permission (gatesCapability "events"; presidents and VPs hold every
 *    permission), seeded off so WSUSA can turn it on. Overdue, it pauses only
 *    Events. Priya already passed it this year; Vanessa hasn't, so turning it
 *    on pauses only her Events in SWE (it was added three weeks ago with a
 *    14-day grace), and Oscar, a Treasurer without Events, never owes it.
 *  - Sport club safety forms: Campus Recreation's form (Test.officeId),
 *    required of its sport clubs' officers only (RoleRequirement.officeId),
 *    on, added 12 days ago with 30 days' grace, so nobody's late yet. Each
 *    officer gets the task and assignment the sweep would make; two in three
 *    have signed.
 */
function officeAndPermissionRequirements(ctx: Ctx, ay: { label: string; start: Date }) {
  const { NOW } = ctx;
  const alex = ctx.p("alex").id;
  const campusRec = ctx.offices.get("campus-rec")!;

  // Event Safety Training (off).
  const safetyId = ctx.id();
  const safetyCreated = addDays(NOW, -21.3);
  ctx.refs.safetyTrainingTestId = safetyId;
  ctx.rows.tests.push({
    id: safetyId, clubId: null, officeId: null, title: "Event Safety Training", introHtml: SAFETY_TRAINING_INTRO, timeLimitMinutes: 15, passingPercent: 80, maxAttempts: null,
    status: "PUBLISHED", audience: "ROLE_REQUIREMENT", recurrence: "ACADEMIC_YEAR", dueDays: 14, closesAt: null, automations: [], createdById: alex, createdAt: safetyCreated, updatedAt: safetyCreated,
  });
  const safetyQs = plainQuestions(ctx, safetyId, SAFETY_TRAINING_QUESTIONS);
  ctx.refs.safetyRequirementId = ctx.id();
  ctx.rows.requirements.push({
    id: ctx.refs.safetyRequirementId, name: "Event Safety Training", description: "Pass WSUSA's short event safety training once each academic year. It's for anyone with the Events permission; until it's done, only Events pauses.",
    appliesTo: ["OFFICER", "VP", "PRESIDENT"], kind: "TEST", testId: safetyId, renewal: "ACADEMIC_YEAR", graceDays: 14, active: false, gatesCapability: "events", officeId: null, createdAt: safetyCreated,
  });
  passingAttempt(ctx, { testId: safetyId, questions: safetyQs, userId: ctx.p("priya").id, cycleKey: ay.label, submittedAt: addDays(NOW, -9.2), scored: true });

  // Campus Recreation's sport club safety forms (on).
  const formId = ctx.id();
  const formCreated = addDays(NOW, -12.3);
  const rowan = ctx.p("rowan").id;
  ctx.refs.sportFormsTestId = formId;
  ctx.rows.tests.push({
    id: formId, clubId: null, officeId: campusRec.id, title: "Sport club safety forms", isForm: true, introHtml: SPORT_FORMS_INTRO, timeLimitMinutes: null, passingPercent: 0, maxAttempts: 1,
    status: "PUBLISHED", audience: "ROLE_REQUIREMENT", recurrence: "ACADEMIC_YEAR", dueDays: 30, closesAt: null, automations: [], createdById: rowan, createdAt: formCreated, updatedAt: formCreated,
  });
  const formQs = plainQuestions(ctx, formId, SPORT_FORMS_QUESTIONS);
  const reqId = ctx.id();
  ctx.refs.sportFormsRequirementId = reqId;
  const description = "Campus Recreation asks the officers of every sport club to sign its safety forms once each academic year.";
  ctx.rows.requirements.push({
    id: reqId, name: "Sport club safety forms", description, appliesTo: ["OFFICER", "VP", "PRESIDENT"], kind: "TEST", testId: formId, renewal: "ACADEMIC_YEAR", graceDays: 30, active: true,
    gatesCapability: null, officeId: campusRec.id, createdAt: formCreated,
  });

  // Who it reaches, as the sweep reads it: current officer, VP and President seats in Campus Rec's approved clubs, active people only.
  const seats = ctx.clubs
    .filter((c) => c.status === "APPROVED" && c.officeId === campusRec.id)
    .flatMap((c) => c.assignments.filter((a) => !a.endedAt && a.startedAt <= NOW && LEAD.has(a.role) && ctx.person(a.userId).status === "ACTIVE").map((a) => ({ c, a })))
    .sort((x, y) => x.a.startedAt.getTime() - y.a.startedAt.getTime() || x.a.id.localeCompare(y.a.id));
  const owed = new Map<string, { dueAt: Date; clubId: string }>();
  for (const { c, a } of seats) {
    const dueAt = addDays(maxDate(maxDate(a.startedAt, c.approvedAt ?? a.startedAt), maxDate(ay.start, formCreated)), 30);
    const cur = owed.get(a.userId);
    if (!cur || dueAt < cur.dueAt) owed.set(a.userId, { dueAt, clubId: c.id });
  }
  let i = 0;
  for (const [userId, { dueAt, clubId }] of owed) {
    const clock = addDays(dueAt, -30);
    const signed = i++ % 3 !== 2 && clock < addDays(NOW, -1);
    const submittedAt = signed ? minDate(addDays(clock, 1 + (i % 7) * 0.9), addMin(NOW, -90)) : null;
    if (signed) passingAttempt(ctx, { testId: formId, questions: formQs, userId, cycleKey: ay.label, submittedAt: submittedAt!, scored: false });
    ctx.rows.testAssignments.push({ id: ctx.id(), testId: formId, userId, cycleKey: ay.label, dueAt, status: signed ? "COMPLETED" : "ASSIGNED", createdAt: clock, resolvedAt: submittedAt });
    // A leader's requirement task names the club whose permissions it gates (requirements.syncUserRequirements).
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "REQUIREMENT", title: "Fill out: Sport club safety forms", description, assigneeType: "USER", assigneeId: userId, clubId, href: `/tests/${formId}`, dueAt, required: true, officeId: campusRec.id,
      status: signed ? "DONE" : "OPEN", sourceType: "requirement", sourceId: `${reqId}:${userId}`, createdAt: clock, completedAt: submittedAt, completedById: signed ? userId : null,
    });
    if (!signed) {
      ctx.rows.notifications.push({
        id: ctx.id(), userId, kind: "requirement.assigned", title: "A Campus Recreation requirement to finish",
        body: `Finish Sport club safety forms by ${dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Denver" })} to keep your permissions on.`,
        href: "/tasks", createdAt: addMin(clock, 4), readAt: null,
      });
    }
  }
}

type RequiredFormDef = {
  ref: string;
  title: string;
  intro: string;
  questions: QuestionDef[];
  description: string;
  /** Never signed / always signed (persona demos). */
  unsigned: Set<string>;
  signed: Set<string>;
  rate: number;
};

/**
 * A WSUSA form every student in an approved club signs once a year, required
 * through a MEMBER requirement: the test row (isForm), the requirement, and
 * per member a TestAssignment and a required REQUIREMENT task (DONE with a
 * graded, passed attempt for those who signed). It was added this fall, so
 * each member's clock is the latest of joining, the club's approval, the
 * year's start and the day the form was added (requirementStatus's rule).
 */
function requiredForm(ctx: Ctx, ay: { label: string; start: Date }, def: RequiredFormDef) {
  const { rng, NOW } = ctx;
  const formId = ctx.id();
  ctx.refs[`${def.ref}FormId`] = formId;
  const created = addDays(NOW, -17.2);
  ctx.rows.tests.push({
    id: formId, clubId: null, title: def.title, isForm: true, introHtml: def.intro, timeLimitMinutes: null, passingPercent: 0, maxAttempts: 1,
    status: "PUBLISHED", audience: "ROLE_REQUIREMENT", recurrence: "ACADEMIC_YEAR", dueDays: 30, closesAt: null,
    automations: [], createdById: ctx.p("alex").id, createdAt: created, updatedAt: created,
  });
  const qs = questionRows(ctx, formId, def.questions);
  const reqId = ctx.id();
  ctx.refs[`${def.ref}RequirementId`] = reqId;
  ctx.rows.requirements.push({
    id: reqId, name: def.title, description: def.description, appliesTo: ["MEMBER"], kind: "TEST", testId: formId, renewal: "ACADEMIC_YEAR", graceDays: 30, active: true, createdAt: created,
  });

  // Every member it reaches, with their earliest clock.
  const firsts = new Map<string, Date>();
  const consider = (userId: string, since: Date, club: ClubM) => {
    const person = ctx.person(userId);
    if (person.kind !== "STUDENT" || person.status !== "ACTIVE") return;
    const clock = maxDate(maxDate(since, club.approvedAt!), maxDate(ay.start, created));
    const cur = firsts.get(userId);
    if (!cur || clock < cur) firsts.set(userId, clock);
  };
  for (const club of ctx.clubs) {
    if (club.status !== "APPROVED" || !club.approvedAt) continue;
    for (const m of club.members) if (m.status === "ACTIVE" && m.joinedAt) consider(m.userId, m.joinedAt, club);
  }
  const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Denver" });
  for (const [userId, clock] of firsts) {
    const dueAt = addDays(clock, 30);
    const signed = !def.unsigned.has(userId) && clock < addDays(NOW, -1) && (def.signed.has(userId) || rng.chance(def.rate));
    let submittedAt: Date | null = null;
    if (signed) {
      submittedAt = new Date(clock.getTime() + rng.next() * (NOW.getTime() - clock.getTime() - DAY / 2));
      const attemptId = ctx.id();
      ctx.rows.attempts.push({
        id: attemptId, testId: formId, userId, cycleKey: ay.label, startedAt: addMin(submittedAt, -rng.float(1, 4)), deadlineAt: null, submittedAt, autoSubmitted: false,
        status: "GRADED", scorePercent: null, passed: true, gradedById: null, gradedAt: submittedAt,
      });
      for (const q of qs) {
        ctx.rows.answers.push({
          id: ctx.id(), attemptId, questionId: q.id, selectedOptionIds: q.def.options ? [q.def.options[0].id] : [], text: q.def.options ? null : ctx.person(userId).name, pointsAwarded: null, reviewerComment: null,
        });
      }
    }
    ctx.rows.testAssignments.push({ id: ctx.id(), testId: formId, userId, cycleKey: ay.label, dueAt, status: signed ? "COMPLETED" : "ASSIGNED", createdAt: clock, resolvedAt: submittedAt });
    // Member-wide requirements are WSUSA's, so their task isn't about one club (requirements.syncUserRequirements).
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "REQUIREMENT", title: `Fill out: ${def.title}`, description: def.description, assigneeType: "USER", assigneeId: userId, clubId: null, href: `/tests/${formId}`, dueAt, required: true,
      status: signed ? "DONE" : "OPEN", sourceType: "requirement", sourceId: `${reqId}:${userId}`, createdAt: clock, completedAt: submittedAt, completedById: signed ? userId : null,
    });
    if (!signed && (def.unsigned.has(userId) || rng.chance(0.3))) {
      ctx.rows.notifications.push({
        id: ctx.id(), userId, kind: "requirement.assigned", title: "Required by WSUSA",
        body: `WSUSA asks every club member to finish ${def.title} by ${shortDate(dueAt)}.`,
        href: "/tasks", createdAt: addMin(clock, 3), readAt: def.unsigned.has(userId) ? null : rng.chance(0.5) ? addDays(clock, 1) : null,
      });
    }
  }
}

/**
 * "Member details": every student in an approved club confirms their details
 * (Settings → Member details) once a year — a PROFILE requirement. Met exactly
 * as requirementStatus decides: the people step's PersonalDetails row is
 * complete and confirmed since the year started. Added this fall, like the forms.
 */
function memberDetailsRequirement(ctx: Ctx, ay: { label: string; start: Date }) {
  const { NOW } = ctx;
  const created = addDays(NOW, -17.2);
  const reqId = ctx.id();
  ctx.refs.detailsRequirementId = reqId;
  const description = "Confirm your student ID, contact details, address and emergency contact once each academic year. Every club uses them.";
  ctx.rows.requirements.push({ id: reqId, name: "Member details", description, appliesTo: ["MEMBER"], kind: "PROFILE", renewal: "ACADEMIC_YEAR", graceDays: 30, active: true, createdAt: created });
  const details = new Map(ctx.rows.personalDetails.map((d) => [d.userId as string, d]));
  const firsts = new Map<string, Date>();
  for (const club of ctx.clubs) {
    if (club.status !== "APPROVED" || !club.approvedAt) continue;
    for (const m of club.members) {
      if (m.status !== "ACTIVE" || !m.joinedAt) continue;
      const person = ctx.person(m.userId);
      if (person.kind !== "STUDENT" || person.status !== "ACTIVE") continue;
      const clock = maxDate(maxDate(m.joinedAt, club.approvedAt), maxDate(ay.start, created));
      const cur = firsts.get(m.userId);
      if (!cur || clock < cur) firsts.set(m.userId, clock);
    }
  }
  for (const [userId, clock] of firsts) {
    const d = details.get(userId);
    const confirmedAt = d?.confirmedAt ? new Date(d.confirmedAt as Date) : null;
    const met = Boolean(d && confirmedAt && confirmedAt >= ay.start && missingDetails(d as DetailsLike, "STUDENT").length === 0);
    const completedAt = met ? maxDate(confirmedAt!, clock) : null;
    // Like requirements.syncUserRequirements: details still missing a field are filled in, complete ones confirmed.
    const verb = !d || missingDetails(d as DetailsLike, "STUDENT").length ? "Fill in" : "Confirm";
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "REQUIREMENT", title: `${verb}: Member details`, description, assigneeType: "USER", assigneeId: userId, clubId: null, href: "/settings/details",
      dueAt: addDays(clock, 30), required: true, status: met ? "DONE" : "OPEN", sourceType: "requirement", sourceId: `${reqId}:${userId}`, createdAt: clock, completedAt, completedById: met ? userId : null,
    });
  }
}

/** Officers who can still meet requirements (clock + grace in the future), for other steps. */
export function isRecentOfficer(ctx: Ctx, userId: string) {
  return (ctx.refs.recentOfficers ?? "").split(",").includes(userId);
}
