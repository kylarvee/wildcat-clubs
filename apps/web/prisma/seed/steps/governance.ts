import type { Prisma } from "@prisma/client";
import type { Assignment, ClubM, Ctx } from "../ctx";
import { POLICIES } from "../data/policies";
import { FUNDING_QUESTIONS, OFFICER_QUESTIONS, OFFICER_TEST_INTRO, REVIEWER_COMMENTS, SAFETY_QUESTIONS, SAFETY_QUIZ_INTRO, type QuestionDef } from "../data/tests";
import { addDays, addMin, DAY, maxDate, minDate } from "../lib/dates";
import { addFolder, addPdf } from "./filehelp";
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
      for (const [reqId, title, description, dueAt, metAt, href] of tasks) {
        ctx.rows.tasks.push({
          id: ctx.id(), kind: "REQUIREMENT", title, description, assigneeType: "USER", assigneeId: userId, clubId: club.id, href, dueAt,
          status: metAt ? "DONE" : "OPEN", sourceType: "requirement", sourceId: `${reqId}:${userId}`, createdAt: clock,
          completedAt: metAt, completedById: metAt ? userId : null,
        });
      }
      if (recent || userId === oscar) {
        ctx.rows.notifications.push({
          id: ctx.id(), userId, kind: "requirement.assigned", title: "Your new role has required training",
          body: "Finish Club Officer Policy Test, Club Officer Training to keep your leadership permissions active.", href: "/tasks",
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
        body: `Their officer permissions in ${club.name} are paused until they pass the test and attend training.`, href: `/clubs/${club.slug}/manage/org-chart`,
        createdAt: addDays(currentAy.start, 30.4), readAt: null,
      });
    }
    ctx.rows.notifications.push({
      id: ctx.id(), userId: pastGrace, kind: "requirement.overdue", title: "Your officer permissions are paused",
      body: `Your Club Officer Policy Test and training were due. Finish them and your ${club.name} permissions come back right away.`, href: "/tasks",
      createdAt: addDays(currentAy.start, 30.5), readAt: null,
    });
  }

  // ─── Event Safety Quiz (Wildcat Robotics) ──────────────────────────────────
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
    ctx.rows.testAssignments.push({ id: ctx.id(), testId: quizId, userId: m.userId, cycleKey: "once", dueAt: closesAt, status, createdAt: joined, resolvedAt });
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
}

/** Officers who can still meet requirements (clock + grace in the future), for other steps. */
export function isRecentOfficer(ctx: Ctx, userId: string) {
  return (ctx.refs.recentOfficers ?? "").split(",").includes(userId);
}
