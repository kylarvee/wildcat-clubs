import "server-only";
import type { Prisma, Test, TestAttempt, TestAudience } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { loadActor, type Actor } from "@/lib/auth/session";
import { adminScope, can, getClubAccess } from "@/lib/authz";
import { clubAdvisors, clubCapabilityHolders } from "@/lib/authz/people";
import { officeStaffIds } from "@/lib/offices";
import { aiLive } from "@/lib/config";
import { logActivity } from "@/lib/lake/activity";
import { assertCan, assertClubCap, assertSignedIn, conflict, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { notify } from "@/lib/domain/notify";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { requirementSourceId } from "@/lib/domain/requirements";
import { decideMembership } from "@/lib/domain/memberships";
import { setRolePermissions } from "@/lib/domain/roles";
import { suggestGrade } from "@/lib/ai/grading";
import { sanitizeRichHtml } from "@/lib/rich/sanitize";
import { getTerms } from "@/lib/terms";
import { fmtDate, fmtLongDate } from "@/lib/time";
import { renewalCycle, testCycle, type Cycle } from "@/lib/tests/cycles";
import { acceptsAnswers, assignmentDueAt, attemptDeadline } from "@/lib/tests/deadlines";
import { LIMITS, isTempId, testProblems, type EditorTest } from "@/lib/tests/editor";
import { autoPoints, clampPoints, scoreAttempt, unansweredQuestionIds, type ScoringQuestion } from "@/lib/tests/scoring";
import {
  ASSIGNED_AUDIENCES,
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  REQUIREMENT_AUDIENCE_LABEL,
  automationAllowed,
  defaultAutomations,
  fmtPercent,
  isChoice,
  isClubAction,
  isOpen,
  parseAutomations,
  parseOptions,
  testNoun,
  testVerb,
  type Automation,
  type AutomationAction,
  type AutomationTrigger,
} from "@/lib/tests/types";

/**
 * The Test Tool — the one write path for tests, questions, assignments,
 * attempts, answers and grades. University tests (clubId null) are managed
 * with admin.tests by the office that owns them (Test.officeId: null is
 * WSUSA's, managed by the platform admins; an office's by its staff, who
 * grade them); club tests with the club's "tests" capability.
 *
 * Lifecycle: build (DRAFT) → publish (assigns the audience for the current
 * cycle) → people take it (attempts; choice questions score instantly) →
 * open answers wait for a reviewer (NEEDS_REVIEW; Claude may suggest points,
 * never decides) → GRADED → outcomes: passing completes the assignment and
 * meets officer requirements (using up every attempt without passing also
 * completes it — they took it); automations notify, open follow-up tasks
 * and, for club tests, approve join requests or pause / give back officer
 * permissions.
 * Scheduled jobs (lib/jobs) start recurring cycles, mark missed deadlines and
 * submit abandoned attempts.
 *
 * Forms (Test.isForm) are tests with grading switched off: one response per
 * round, no clock, every question answered (auto-submitted ones are taken
 * as-is). Submitting grades the attempt at once as passed with no score, so
 * the same outcomes run: the assignment and its task complete, requirements
 * that use the form are met, and PASSED ("Submitted") automations run.
 *
 * Task sources this module opens and closes:
 *   "testAssignment" (sourceId = TestAssignment.id) — a person owes a test (a TEST task)
 *   "testAttempt"    (sourceId = TestAttempt.id)    — open answers to grade
 *   "testFollowUp"   (sourceId = testId:userId:cycleKey:TRIGGER) — automation follow-ups
 * and resolves "requirement" tasks when an officer test is passed.
 */

const DAY = 86_400_000;

type TestRow = Test & { club: { id: string; name: string; slug: string; status: string } | null; office: { name: string; shortName: string } | null };

const testInclude = { club: { select: { id: true, name: true, slug: true, status: true } }, office: { select: { name: true, shortName: true } } } as const;

async function loadTest(testId: string): Promise<TestRow> {
  const t = await db.test.findUnique({ where: { id: testId }, include: testInclude });
  if (!t) throw notFound("Test");
  return t;
}

// A form is one response per round and never timed, whatever its stored columns say.
const maxAttemptsOf = (t: Pick<Test, "isForm" | "maxAttempts">) => (t.isForm ? 1 : t.maxAttempts);
const timeLimitOf = (t: Pick<Test, "isForm" | "timeLimitMinutes">) => (t.isForm ? null : t.timeLimitMinutes);

// ─── Permission ──────────────────────────────────────────────────────────────

/**
 * A university test's office may manage it: WSUSA's admins any of them, an
 * office's staff only their office's (Test.officeId; missing or null = WSUSA's).
 */
function ownsUniversityTest(actor: Actor | null, test: { officeId?: string | null }): boolean {
  const s = adminScope(actor);
  return s.all || (Boolean(test.officeId) && s.officeIds.includes(test.officeId!));
}

/** Who may build, publish and grade a test: the owning office's admins for university tests, the club's "tests" holders for club tests. */
export async function assertCanManageTest(actor: Actor | null, test: { clubId: string | null; officeId?: string | null }): Promise<Actor> {
  if (test.clubId === null) {
    assertCan(actor, "admin.tests");
    // Another office's test is "not found", so ids reveal nothing.
    if (!ownsUniversityTest(actor, test)) throw notFound("Test");
    return actor;
  }
  await assertClubCap(actor, test.clubId, "tests");
  return actor!;
}

export async function canManageTest(actor: Actor | null, test: { clubId: string | null; officeId?: string | null }): Promise<boolean> {
  if (!actor) return false;
  if (test.clubId === null) return can(actor, "admin.tests") && ownsUniversityTest(actor, test);
  const access = await getClubAccess(actor, test.clubId);
  return Boolean(access?.capabilities.has("tests"));
}

/** Where results and grading live for a test, by scope. */
export function manageHref(test: { id: string; clubId: string | null; club?: { slug: string } | null }, section: "" | "results" | `review/${string}` = "") {
  const base = test.clubId && test.club ? `/clubs/${test.club.slug}/manage/tests/${test.id}` : `/admin/tests/${test.id}`;
  return section ? `${base}/${section}` : base;
}

// ─── Selection (SELECTED_USERS audience) ─────────────────────────────────────
// The schema has no column for a chosen audience yet, so the selection is kept
// on the latest "test.selection_set" activity row (the same pattern the
// constitution builder uses for stated settings) and read back here.

export async function selectedUserIds(testId: string): Promise<string[]> {
  const row = await db.activityLog.findFirst({ where: { action: "test.selection_set", entityType: "test", entityId: testId }, orderBy: { id: "desc" }, select: { data: true } });
  const ids = (row?.data as { userIds?: unknown } | null)?.userIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

// ─── Cycles & audience ───────────────────────────────────────────────────────

/** The round a test is in now. Officer tests follow their requirement's renewal so assignments and attempts line up. */
export async function cycleForTest(test: Pick<Test, "id" | "audience" | "recurrence">, at: Date = new Date()): Promise<Cycle> {
  const terms = await getTerms();
  if (test.audience === "ROLE_REQUIREMENT") {
    const req = await db.roleRequirement.findFirst({ where: { testId: test.id, kind: "TEST", active: true }, orderBy: { createdAt: "asc" }, select: { renewal: true } });
    if (req) return renewalCycle(req.renewal, at, terms);
  }
  return testCycle(test.recurrence, at, terms);
}

/** Everyone who should have an assignment for a test with an assigned audience. */
async function audienceUserIds(test: TestRow): Promise<string[]> {
  switch (test.audience) {
    case "CLUB_MEMBERS": {
      if (!test.clubId) return [];
      const rows = await db.membership.findMany({ where: { clubId: test.clubId, status: "ACTIVE", user: { status: "ACTIVE", kind: "STUDENT" } }, select: { userId: true } });
      return rows.map((r) => r.userId);
    }
    case "ALL_STUDENTS": {
      const rows = await db.user.findMany({ where: { kind: "STUDENT", status: "ACTIVE" }, select: { id: true } });
      return rows.map((r) => r.id);
    }
    case "SELECTED_USERS": {
      const ids = await selectedUserIds(test.id);
      if (!ids.length) return [];
      const rows = await db.user.findMany({
        where: { id: { in: ids }, status: "ACTIVE", ...(test.clubId ? { memberships: { some: { clubId: test.clubId, status: "ACTIVE" } } } : {}) },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
    default:
      return [];
  }
}

/** True when a test can still be taken in its current cycle (published, club active, not past a one-off closing time). */
function isOpenForTaking(test: TestRow, now: Date) {
  if (test.status !== "PUBLISHED") return false;
  if (test.club && test.club.status !== "APPROVED") return false;
  if (test.recurrence === "ONE_OFF" && test.closesAt && test.closesAt <= now) return false;
  return true;
}

/**
 * Closes the "Take: …" / "Fill out: …" tasks of these assignments. MISSED assignments keep
 * their task open while the test can still be taken late, so every path that
 * ends someone's chance (released, archived, closed, out of attempts) closes
 * theirs too, without changing the MISSED record.
 */
async function cancelAssignmentTasks(assignmentIds: string[], now: Date) {
  if (!assignmentIds.length) return;
  await db.task.updateMany({ where: { sourceType: "testAssignment", sourceId: { in: assignmentIds }, status: "OPEN" }, data: { status: "CANCELLED", completedAt: now } });
}

/**
 * Makes the current cycle's assignments match the audience: creates missing
 * ones (with a task and a notification), re-opens excused people who are back,
 * and excuses people who left the audience. Requirement tests are handled by
 * lib/domain/requirements; OPEN tests assign nobody. Idempotent.
 */
export async function syncAssignments(testId: string, now: Date = new Date()): Promise<{ created: number; excused: number }> {
  const test = await loadTest(testId);
  if (test.status !== "PUBLISHED") return { created: 0, excused: 0 };
  const cycle = await cycleForTest(test, now);

  // Tasks left over from earlier rounds close once a new round starts.
  const stale = await db.testAssignment.findMany({ where: { testId, cycleKey: { not: cycle.key }, status: { in: ["ASSIGNED", "MISSED"] } }, select: { id: true } });
  await cancelAssignmentTasks(stale.map((s) => s.id), now);

  if (!ASSIGNED_AUDIENCES.includes(test.audience)) {
    // Switched to "anyone" or to an officer requirement: release the people the old audience assigned
    // (requirement-made assignments have no testAssignment task, so they're untouched). Missed ones stay missed.
    const open = await db.testAssignment.findMany({ where: { testId, status: { in: ["ASSIGNED", "MISSED"] } }, select: { id: true, status: true } });
    const tasks = open.length ? await db.task.findMany({ where: { sourceType: "testAssignment", status: "OPEN", sourceId: { in: open.map((a) => a.id) } }, select: { sourceId: true } }) : [];
    const withTask = new Set(tasks.map((t) => t.sourceId!).filter(Boolean));
    const ids = open.filter((a) => a.status === "ASSIGNED" && withTask.has(a.id)).map((a) => a.id);
    if (ids.length) await db.testAssignment.updateMany({ where: { id: { in: ids } }, data: { status: "EXCUSED", resolvedAt: now } });
    await cancelAssignmentTasks([...withTask], now);
    return { created: 0, excused: ids.length };
  }
  // A closed round's open assignments become MISSED (markMissedAssignments), not excused;
  // the late-take tasks of people who already missed it close now.
  if (!isOpenForTaking(test, now)) {
    const missed = await db.testAssignment.findMany({ where: { testId, cycleKey: cycle.key, status: "MISSED" }, select: { id: true } });
    await cancelAssignmentTasks(missed.map((a) => a.id), now);
    return { created: 0, excused: 0 };
  }

  const audience = new Set(await audienceUserIds(test));
  const existing = await db.testAssignment.findMany({ where: { testId, cycleKey: cycle.key }, select: { id: true, userId: true, status: true } });
  const byUser = new Map(existing.map((a) => [a.userId, a]));

  // People who left the audience (left the club, taken off the list): excuse what they still owe
  // (a missed assignment stays missed, but its late-take task closes).
  const gone = existing.filter((a) => (a.status === "ASSIGNED" || a.status === "MISSED") && !audience.has(a.userId));
  const extras = gone.filter((a) => a.status === "ASSIGNED");
  if (extras.length) await db.testAssignment.updateMany({ where: { id: { in: extras.map((a) => a.id) } }, data: { status: "EXCUSED", resolvedAt: now } });
  await cancelAssignmentTasks(gone.map((a) => a.id), now);
  if (!audience.size) return { created: 0, excused: extras.length };

  const dueAt = assignmentDueAt({ assignedAt: now, dueDays: test.dueDays, closesAt: test.closesAt, cycle, oneOff: test.recurrence === "ONE_OFF" });
  const missing = [...audience].filter((id) => !byUser.has(id));
  const returning = [...audience].filter((id) => byUser.get(id)?.status === "EXCUSED");

  if (missing.length) await db.testAssignment.createMany({ data: missing.map((userId) => ({ testId, userId, cycleKey: cycle.key, dueAt })), skipDuplicates: true });
  if (returning.length) await db.testAssignment.updateMany({ where: { testId, cycleKey: cycle.key, userId: { in: returning } }, data: { status: "ASSIGNED", dueAt, resolvedAt: null } });

  const fresh = [...missing, ...returning];
  if (fresh.length) {
    const rows = await db.testAssignment.findMany({ where: { testId, cycleKey: cycle.key, userId: { in: fresh }, status: "ASSIGNED" }, select: { id: true, userId: true, dueAt: true } });
    const noun = testNoun(test.isForm);
    await db.task.createMany({
      data: rows.map((a) => ({
        // Not a WSUSA requirement (those are lib/domain/requirements' REQUIREMENT tasks): a test someone assigned.
        kind: "TEST" as const,
        title: `${test.isForm ? "Fill out" : "Take"}: ${test.title}`,
        description: test.club ? `Assigned by ${test.club.name}.` : `Assigned by ${test.office?.name ?? "WSUSA"}.`,
        assigneeType: "USER" as const,
        assigneeId: a.userId,
        clubId: test.clubId,
        href: `/tests/${test.id}`,
        dueAt: a.dueAt,
        // Anything WSUSA (or another office) assigns is required; a club's own tests and forms aren't.
        required: test.clubId === null,
        // Who requires it, for the badge ("Required by Campus Rec"); null is WSUSA.
        officeId: test.clubId === null ? (test.officeId ?? null) : null,
        sourceType: "testAssignment",
        sourceId: a.id,
      })),
    });
    await notify({
      userIds: rows.map((r) => r.userId),
      kind: "test.assigned",
      title: `New ${noun}: ${test.title}`,
      body: `${test.club ? `${test.club.name} asked you` : `${test.office?.shortName ?? "WSUSA"} asked you`} to ${testVerb(test.isForm)} this ${noun} by ${fmtDate(dueAt, "EEE, MMM d")}.`,
      href: `/tests/${test.id}`,
      // Campus-wide tests reach hundreds of people: in-app and push only.
      email: rows.length <= 60,
    });
    await logActivity({ actorId: null, action: "test.assigned", entityType: "test", entityId: test.id, clubId: test.clubId, data: { cycleKey: cycle.key, people: rows.length } });
  }
  return { created: fresh.length, excused: extras.length };
}

// ─── Building ────────────────────────────────────────────────────────────────

const CreateInput = z.object({
  clubId: z.string().min(1).nullable(),
  title: z.string().trim().min(3, "Give it a title (at least 3 characters).").max(LIMITS.title, `Titles can be up to ${LIMITS.title} characters.`),
  isForm: z.boolean().optional().default(false),
  /** A university test's office, for staff of more than one; defaults to theirs (WSUSA's for platform admins). */
  officeId: z.string().min(1).max(64).nullish(),
});

/**
 * Start a new draft test or form. University ones start OPEN, owned by the
 * creator's office (WSUSA's for platform admins, else the office they staff),
 * so an office's requirements can use its own forms; club ones start assigned
 * to the club's members.
 */
export async function createTest(actor: Actor | null, input: unknown): Promise<{ id: string }> {
  const v = parse(CreateInput, input);
  const scope = adminScope(actor);
  const officeId = v.clubId ? null : v.officeId && scope.officeIds.includes(v.officeId) ? v.officeId : scope.all ? null : (scope.officeIds[0] ?? null);
  const a = await assertCanManageTest(actor, { clubId: v.clubId, officeId });
  const test = await db.test.create({
    data: {
      clubId: v.clubId,
      officeId,
      title: v.title,
      isForm: v.isForm,
      audience: v.clubId ? "CLUB_MEMBERS" : "OPEN",
      timeLimitMinutes: v.isForm ? null : 30,
      passingPercent: 80,
      maxAttempts: v.isForm ? 1 : null,
      automations: defaultAutomations(v.isForm) as unknown as Prisma.InputJsonValue,
      createdById: a.id,
    },
  });
  await logActivity({ actorId: a.id, action: "test.created", entityType: "test", entityId: test.id, clubId: v.clubId, data: { title: test.title, isForm: v.isForm } });
  return { id: test.id };
}

const OptionInput = z.object({ id: z.string().regex(/^[a-z0-9-]{1,24}$/i, "Invalid answer choice."), text: z.string().max(LIMITS.optionText, `Answer choices can be up to ${LIMITS.optionText} characters.`) });

const QuestionInput = z.object({
  id: z.string().min(1),
  type: z.enum(["SINGLE_CHOICE", "MULTI_CHOICE", "SHORT_ANSWER", "LONG_ANSWER"]),
  promptHtml: z.string().max(40_000, "That question is too long."),
  options: z.array(OptionInput).max(LIMITS.options, `Questions can have up to ${LIMITS.options} answer choices.`),
  correctOptionIds: z.array(z.string()).max(LIMITS.options),
  modelAnswer: z.string().max(LIMITS.modelAnswer, `Keep the description of a correct answer under ${LIMITS.modelAnswer} characters.`),
  points: z.number().int("Points must be whole numbers.").min(1, "Questions are worth at least 1 point.").max(LIMITS.points),
  answerCount: z.number().optional(),
});

const SaveInput = z.object({
  isForm: z.boolean(),
  title: z.string().trim().max(LIMITS.title, `Titles can be up to ${LIMITS.title} characters.`),
  introHtml: z.string().max(200_000, "The intro page is too long."),
  timeLimitMinutes: z.number().int().min(1).max(LIMITS.timeLimit).nullable(),
  passingPercent: z.number().int().min(1, "The passing score must be at least 1%.").max(100, "The passing score can't be over 100%."),
  maxAttempts: z.number().int().min(1).max(LIMITS.attempts).nullable(),
  audience: z.enum(["ROLE_REQUIREMENT", "CLUB_MEMBERS", "ALL_STUDENTS", "SELECTED_USERS", "OPEN"]),
  selectedUserIds: z.array(z.string()).max(5000),
  recurrence: z.enum(["ONE_OFF", "WEEKLY", "MONTHLY", "SEMESTER", "ACADEMIC_YEAR", "ANNUAL"]),
  dueDays: z.number().int().min(1, "People need at least 1 day.").max(LIMITS.dueDays),
  closesAt: z.string().datetime({ offset: true }).nullable(),
  automations: z.array(z.object({ trigger: z.enum(AUTOMATION_TRIGGERS), action: z.enum(AUTOMATION_ACTIONS) })).max(12),
  questions: z.array(QuestionInput).max(LIMITS.questions, `Tests can have up to ${LIMITS.questions} questions.`),
});

/**
 * Normalizes editor input into what we store (sanitized HTML, trimmed options, valid correct ids).
 * Forms keep nothing about grading: no time limit, one response, no correct or model answers, 1 point each.
 */
function normalize(v: z.infer<typeof SaveInput>): EditorTest {
  const form = v.isForm;
  return {
    ...v,
    title: v.title.trim(),
    introHtml: sanitizeRichHtml(v.introHtml),
    timeLimitMinutes: form ? null : v.timeLimitMinutes,
    maxAttempts: form ? 1 : v.maxAttempts,
    closesAt: v.recurrence === "ONE_OFF" ? v.closesAt : null,
    automations: parseAutomations(v.automations),
    selectedUserIds: [...new Set(v.selectedUserIds)],
    questions: v.questions.map((q) => {
      const choice = isChoice(q.type);
      const options = choice ? q.options.map((o) => ({ id: o.id, text: o.text.trim() })) : [];
      const ids = new Set(options.map((o) => o.id));
      if (ids.size !== options.length) throw invalid("Two answer choices share an id. Reload the page and try again.");
      let correct = choice && !form ? [...new Set(q.correctOptionIds)].filter((id) => ids.has(id)) : [];
      if (q.type === "SINGLE_CHOICE") correct = correct.slice(0, 1);
      return {
        id: q.id,
        type: q.type,
        promptHtml: sanitizeRichHtml(q.promptHtml),
        options,
        correctOptionIds: correct,
        modelAnswer: isOpen(q.type) && !form ? q.modelAnswer.trim() : "",
        points: form ? 1 : q.points,
        answerCount: 0,
      };
    }),
  };
}

function firstProblems(problems: { message: string }[], max = 3) {
  const shown = problems.slice(0, max).map((p) => p.message);
  const more = problems.length - shown.length;
  return shown.join(" ") + (more > 0 ? ` (and ${more} more)` : "");
}

/**
 * Saves the whole editor (settings, automations, questions in order). Drafts
 * may be incomplete; a published test must stay publishable. Questions that
 * already have answers can't be removed or switched between choice and open
 * types, so past results keep making sense. Switching between a test and a
 * form is only possible while it's a draft nobody has started.
 */
export async function saveTest(actor: Actor | null, testId: string, input: unknown): Promise<{ questionIds: Record<string, string> }> {
  const test = await loadTest(testId);
  const a = await assertCanManageTest(actor, test);
  const v = normalize(parse(SaveInput, input));
  const scope = test.clubId ? "club" : "university";
  const noun = testNoun(v.isForm);
  if (v.isForm !== test.isForm) {
    const started = test.status !== "DRAFT" || (await db.testAttempt.count({ where: { testId } })) > 0;
    if (started) throw invalid("Only a draft nobody has started can switch between a test and a form. Make a copy and switch the copy instead.");
  }
  if (test.status === "PUBLISHED") {
    const problems = testProblems(v, scope);
    if (problems.length) throw invalid(`This ${noun} is live, so it has to stay complete. ${firstProblems(problems)}`);
  } else if (v.title.length < 3) {
    throw invalid(`Give the ${noun} a title (at least 3 characters).`);
  }
  const closesAt = v.closesAt ? new Date(v.closesAt) : null;
  if (closesAt && test.closesAt?.getTime() !== closesAt.getTime() && closesAt <= new Date()) throw invalid("Choose a closing time in the future.");
  const allowed = scope === "club" ? ["CLUB_MEMBERS", "SELECTED_USERS", "OPEN"] : ["ROLE_REQUIREMENT", "ALL_STUDENTS", "SELECTED_USERS", "OPEN"];
  if (!allowed.includes(v.audience)) throw invalid(`That audience isn't available for this ${noun}.`);
  // Sending a test to every student is WSUSA's: an office's tests reach its requirements and the people it picks.
  if (!test.clubId && test.officeId && v.audience === "ALL_STUDENTS" && test.audience !== "ALL_STUDENTS")
    throw invalid(`Only WSUSA sends a ${noun} to every student. Use it in a requirement for your office's clubs, or choose the people it goes to.`);
  if (v.automations.some((x) => !automationAllowed(x, scope, v.isForm))) throw invalid("One of the automations can't run after that result. Pick a different step for it.");
  if (test.clubId) {
    // Club steps run in the creator's name, so adding one takes the permission to take that step by hand
    // (otherwise anyone with the Tests permission could approve members or pause officers through a test).
    const had = new Set(parseAutomations(test.automations).map((x) => `${x.trigger}:${x.action}`));
    const added = new Set(v.automations.filter((x) => isClubAction(x.action) && !had.has(`${x.trigger}:${x.action}`)).map((x) => x.action));
    if (added.size) {
      const access = await getClubAccess(a, test.clubId);
      if (added.has("APPROVE_JOIN_REQUEST") && !access?.capabilities.has("roster")) throw forbidden(`Only people who approve join requests can make a ${noun} approve them.`);
      if ((added.has("PAUSE_PERMISSIONS") || added.has("RESUME_PERMISSIONS")) && !access?.assignableRoles.includes("OFFICER")) {
        throw forbidden(`Only the President, a Vice President or an advisor can make a ${noun} change officer permissions.`);
      }
    }
  }
  if (test.audience === "ROLE_REQUIREMENT" && v.audience !== "ROLE_REQUIREMENT") {
    const req = await db.roleRequirement.findFirst({ where: { testId, active: true }, select: { name: true } });
    if (req) throw invalid(`“${req.name}” uses this ${noun}, so its audience has to stay “${REQUIREMENT_AUDIENCE_LABEL}”. Turn that requirement off first.`);
  }

  // Validate the selection: real, active people (club members for club tests).
  let selection = v.audience === "SELECTED_USERS" ? v.selectedUserIds : null;
  if (selection) {
    const ok = await db.user.findMany({
      where: { id: { in: selection }, status: "ACTIVE", ...(test.clubId ? { memberships: { some: { clubId: test.clubId, status: "ACTIVE" } } } : {}) },
      select: { id: true },
    });
    const valid = new Set(ok.map((u) => u.id));
    selection = selection.filter((id) => valid.has(id));
  }

  const existing = await db.testQuestion.findMany({ where: { testId }, select: { id: true, type: true, _count: { select: { answers: true } } } });
  const existingById = new Map(existing.map((q) => [q.id, q]));
  const keep = new Set(v.questions.filter((q) => !isTempId(q.id) && existingById.has(q.id)).map((q) => q.id));
  const removed = existing.filter((q) => !keep.has(q.id));
  const answered = removed.filter((q) => q._count.answers > 0);
  if (answered.length) throw invalid(`${answered.length === 1 ? "A question you removed has" : `${answered.length} questions you removed have`} answers from people who ${v.isForm ? "filled out this form" : "took this test"}, so ${answered.length === 1 ? "it" : "they"} can't be deleted. Edit the wording instead, or make a copy of the ${noun}.`);
  for (const q of v.questions) {
    const prev = existingById.get(q.id);
    if (prev && prev._count.answers > 0 && isChoice(prev.type) !== isChoice(q.type)) {
      throw invalid("People have answered one of these questions, so it can't switch between multiple choice and a written answer. Add a new question instead.");
    }
  }

  const idMap: Record<string, string> = {};
  const timingChanged = test.dueDays !== v.dueDays || (test.closesAt?.getTime() ?? null) !== (closesAt?.getTime() ?? null) || test.recurrence !== v.recurrence;
  await db.$transaction(async (tx) => {
    if (removed.length) await tx.testQuestion.deleteMany({ where: { id: { in: removed.map((q) => q.id) } } });
    for (const [i, q] of v.questions.entries()) {
      const data = {
        order: i + 1,
        type: q.type,
        promptHtml: q.promptHtml,
        options: q.options as unknown as Prisma.InputJsonValue,
        correctOptionIds: q.correctOptionIds,
        modelAnswer: q.modelAnswer || null,
        points: q.points,
      };
      if (keep.has(q.id)) {
        await tx.testQuestion.update({ where: { id: q.id }, data });
        idMap[q.id] = q.id;
      } else {
        const created = await tx.testQuestion.create({ data: { ...data, testId } });
        idMap[q.id] = created.id;
      }
    }
    await tx.test.update({
      where: { id: testId },
      data: {
        isForm: v.isForm,
        title: v.title,
        introHtml: v.introHtml,
        timeLimitMinutes: v.timeLimitMinutes,
        passingPercent: v.passingPercent,
        maxAttempts: v.maxAttempts,
        audience: v.audience as TestAudience,
        recurrence: v.audience === "ROLE_REQUIREMENT" ? test.recurrence : v.recurrence,
        dueDays: v.dueDays,
        closesAt,
        automations: v.automations as unknown as Prisma.InputJsonValue,
      },
    });
    await logActivity({ actorId: a.id, action: "test.updated", entityType: "test", entityId: testId, clubId: test.clubId, data: { questions: v.questions.length, audience: v.audience, isForm: v.isForm } }, tx);
  });

  if (selection) {
    const prev = await selectedUserIds(testId);
    const same = prev.length === selection.length && prev.every((id) => selection!.includes(id));
    if (!same) await logActivity({ actorId: a.id, action: "test.selection_set", entityType: "test", entityId: testId, clubId: test.clubId, data: { userIds: selection } });
  }

  if (test.status === "PUBLISHED") {
    if (timingChanged) await refreshDueDates(testId);
    await syncAssignments(testId);
  }
  return { questionIds: idMap };
}

/** After timing changes on a live test, move open due dates for the current round. */
async function refreshDueDates(testId: string) {
  const test = await loadTest(testId);
  if (test.audience === "ROLE_REQUIREMENT") return;
  const cycle = await cycleForTest(test);
  const open = await db.testAssignment.findMany({ where: { testId, cycleKey: cycle.key, status: "ASSIGNED" }, select: { id: true, createdAt: true, dueAt: true } });
  for (const a of open) {
    const dueAt = assignmentDueAt({ assignedAt: a.createdAt, dueDays: test.dueDays, closesAt: test.closesAt, cycle, oneOff: test.recurrence === "ONE_OFF" });
    if (dueAt.getTime() === a.dueAt.getTime()) continue;
    await db.testAssignment.update({ where: { id: a.id }, data: { dueAt } });
    await db.task.updateMany({ where: { sourceType: "testAssignment", sourceId: a.id, status: "OPEN" }, data: { dueAt } });
  }
}

/** Questions, settings and selection as the editor shows them. */
export async function editorPayload(testId: string): Promise<EditorTest> {
  const test = await db.test.findUnique({
    where: { id: testId },
    include: { questions: { orderBy: { order: "asc" }, include: { _count: { select: { answers: true } } } } },
  });
  if (!test) throw notFound("Test");
  return {
    isForm: test.isForm,
    title: test.title,
    introHtml: test.introHtml,
    timeLimitMinutes: test.timeLimitMinutes,
    passingPercent: test.passingPercent,
    maxAttempts: test.maxAttempts,
    audience: test.audience,
    selectedUserIds: await selectedUserIds(testId),
    recurrence: test.recurrence,
    dueDays: test.dueDays,
    closesAt: test.closesAt?.toISOString() ?? null,
    automations: parseAutomations(test.automations),
    questions: test.questions.map((q) => ({
      id: q.id,
      type: q.type,
      promptHtml: q.promptHtml,
      options: parseOptions(q.options),
      correctOptionIds: q.correctOptionIds,
      modelAnswer: q.modelAnswer ?? "",
      points: q.points,
      answerCount: q._count.answers,
    })),
  };
}

/** Publish (or re-open an archived test). Assigns the audience for the current round. */
export async function publishTest(actor: Actor | null, testId: string): Promise<{ assigned: number }> {
  const test = await loadTest(testId);
  const a = await assertCanManageTest(actor, test);
  if (test.status === "PUBLISHED") return { assigned: 0 };
  if (test.club && test.club.status !== "APPROVED") throw invalid(`Club ${testNoun(test.isForm)}s can be published once WSUSA approves the club.`);
  const payload = await editorPayload(testId);
  const problems = testProblems(payload, test.clubId ? "club" : "university");
  if (problems.length) throw invalid(`Almost there. ${firstProblems(problems)}`);
  if (test.recurrence === "ONE_OFF" && test.closesAt && test.closesAt <= new Date()) throw invalid("Its closing time has passed. Choose a new closing time first.");
  await db.test.update({ where: { id: testId }, data: { status: "PUBLISHED" } });
  await logActivity({ actorId: a.id, action: test.status === "ARCHIVED" ? "test.reopened" : "test.published", entityType: "test", entityId: testId, clubId: test.clubId, data: { title: test.title, audience: test.audience } });
  const r = await syncAssignments(testId);
  return { assigned: r.created };
}

/** Take a test out of use. Open assignments are excused; results and grading stay available. */
export async function archiveTest(actor: Actor | null, testId: string): Promise<void> {
  const test = await loadTest(testId);
  const a = await assertCanManageTest(actor, test);
  if (test.status === "ARCHIVED") return;
  const req = await db.roleRequirement.findFirst({ where: { testId, active: true }, select: { name: true } });
  if (req) throw invalid(`“${req.name}” requires this ${testNoun(test.isForm)}. Turn that requirement off in Admin → Requirements first.`);
  const now = new Date();
  await db.test.update({ where: { id: testId }, data: { status: "ARCHIVED" } });
  // Open assignments are excused; missed ones stay missed. Both lose their "Take: …" / "Fill out: …" task.
  const owing = await db.testAssignment.findMany({ where: { testId, status: { in: ["ASSIGNED", "MISSED"] } }, select: { id: true, status: true } });
  const open = owing.filter((o) => o.status === "ASSIGNED");
  if (open.length) await db.testAssignment.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: "EXCUSED", resolvedAt: now } });
  await cancelAssignmentTasks(owing.map((o) => o.id), now);
  await logActivity({ actorId: a.id, action: "test.archived", entityType: "test", entityId: testId, clubId: test.clubId, data: { title: test.title, excused: open.length } });
}

/** Copy a test (settings + questions) into a new draft — the way to change a test people already answered. */
export async function duplicateTest(actor: Actor | null, testId: string): Promise<{ id: string }> {
  const test = await db.test.findUnique({ where: { id: testId }, include: { questions: { orderBy: { order: "asc" } } } });
  if (!test) throw notFound("Test");
  const a = await assertCanManageTest(actor, test);
  const selection = await selectedUserIds(testId);
  const copy = await db.test.create({
    data: {
      clubId: test.clubId,
      title: `Copy of ${test.title}`.slice(0, LIMITS.title),
      isForm: test.isForm,
      introHtml: test.introHtml,
      timeLimitMinutes: test.timeLimitMinutes,
      passingPercent: test.passingPercent,
      maxAttempts: test.maxAttempts,
      audience: test.audience === "ROLE_REQUIREMENT" ? "ROLE_REQUIREMENT" : test.audience,
      recurrence: test.recurrence,
      dueDays: test.dueDays,
      closesAt: null,
      automations: test.automations as Prisma.InputJsonValue,
      createdById: a.id,
      questions: {
        create: test.questions.map((q) => ({
          order: q.order,
          type: q.type,
          promptHtml: q.promptHtml,
          options: q.options as Prisma.InputJsonValue,
          correctOptionIds: q.correctOptionIds,
          modelAnswer: q.modelAnswer,
          points: q.points,
        })),
      },
    },
  });
  if (selection.length) await logActivity({ actorId: a.id, action: "test.selection_set", entityType: "test", entityId: copy.id, clubId: test.clubId, data: { userIds: selection } });
  await logActivity({ actorId: a.id, action: "test.duplicated", entityType: "test", entityId: copy.id, clubId: test.clubId, data: { from: testId, title: copy.title } });
  return { id: copy.id };
}

/** Delete a draft nobody has taken. Anything with attempts is archived instead, so results survive. */
export async function deleteTest(actor: Actor | null, testId: string): Promise<void> {
  const test = await loadTest(testId);
  const a = await assertCanManageTest(actor, test);
  const noun = testNoun(test.isForm);
  if (test.status !== "DRAFT") throw invalid(`Only drafts can be deleted. Archive a published ${noun} instead — its ${test.isForm ? "responses" : "results"} stay.`);
  const attempts = await db.testAttempt.count({ where: { testId } });
  if (attempts) throw invalid(`Someone has already ${test.isForm ? "filled out this form" : "taken this test"}, so it can't be deleted. Archive it instead.`);
  if (await db.roleRequirement.count({ where: { testId } })) throw invalid(`A WSUSA requirement points at this ${noun}. Change the requirement first.`);
  await db.test.delete({ where: { id: testId } });
  await logActivity({ actorId: a.id, action: "test.deleted", entityType: "test", entityId: testId, clubId: test.clubId, data: { title: test.title } });
}

// ─── Taking ──────────────────────────────────────────────────────────────────

export type TakeBlock =
  | "signin"
  | "inactive"
  | "unpublished"
  | "closed"
  | "audience"
  | "attempts"
  | "passed"
  | "review";

export type TakerState = {
  test: TestRow;
  cycle: Cycle;
  canTake: boolean;
  block: { reason: TakeBlock; message: string } | null;
  attemptsUsed: number;
  attemptsLeft: number | null;
  inProgress: Pick<TestAttempt, "id" | "startedAt" | "deadlineAt"> | null;
  latest: Pick<TestAttempt, "id" | "status" | "scorePercent" | "passed" | "submittedAt"> | null;
  passed: Pick<TestAttempt, "id" | "scorePercent" | "submittedAt"> | null;
  assignment: { status: string; dueAt: Date } | null;
  /** When the attempt would have to be in if started now (null = no limit). */
  deadlineIfStarted: Date | null;
};

/** Is this person in the test's audience? (Assignments always count.) */
async function inAudience(actor: Actor, test: TestRow, hasAssignment: boolean): Promise<boolean> {
  if (hasAssignment) return true;
  switch (test.audience) {
    case "OPEN":
      return true;
    case "ALL_STUDENTS":
      return actor.kind === "STUDENT";
    case "CLUB_MEMBERS": {
      if (!test.clubId) return false;
      const access = await getClubAccess(actor, test.clubId);
      return Boolean(access?.isMember);
    }
    case "SELECTED_USERS":
      return (await selectedUserIds(test.id)).includes(actor.id);
    case "ROLE_REQUIREMENT": {
      const reqs = await db.roleRequirement.findMany({ where: { testId: test.id, active: true }, select: { appliesTo: true } });
      const roles = [...new Set(reqs.flatMap((r) => r.appliesTo))];
      if (!roles.length) return false;
      // Requirements can apply to members as well as officers.
      if (roles.includes("MEMBER") && (await db.membership.count({ where: { userId: actor.id, status: "ACTIVE", club: { status: "APPROVED" } } })) > 0) return true;
      return (await db.roleAssignment.count({ where: { userId: actor.id, endedAt: null, role: { in: roles }, club: { status: "APPROVED" } } })) > 0;
    }
  }
}

/** Everything the intro page needs to know about one person and one test. */
export async function takerState(actor: Actor | null, testId: string, now: Date = new Date()): Promise<TakerState> {
  const test = await loadTest(testId);
  const cycle = await cycleForTest(test, now);
  const maxAttempts = maxAttemptsOf(test);
  const noun = testNoun(test.isForm);
  const doIt = `${testVerb(test.isForm)} this ${noun}`;
  const base = { test, cycle, attemptsUsed: 0, attemptsLeft: maxAttempts, inProgress: null, latest: null, passed: null, assignment: null, deadlineIfStarted: attemptDeadline(now, timeLimitOf(test), test.recurrence === "ONE_OFF" ? test.closesAt : null) };
  if (!actor) return { ...base, canTake: false, block: { reason: "signin", message: `Sign in with your Weber State account to ${doIt}.` } };

  const [attempts, assignment] = await Promise.all([
    db.testAttempt.findMany({ where: { testId, userId: actor.id, cycleKey: cycle.key }, orderBy: { startedAt: "desc" }, select: { id: true, status: true, scorePercent: true, passed: true, submittedAt: true, startedAt: true, deadlineAt: true } }),
    db.testAssignment.findUnique({ where: { testId_userId_cycleKey: { testId, userId: actor.id, cycleKey: cycle.key } }, select: { status: true, dueAt: true } }),
  ]);
  const inProgress = attempts.find((x) => x.status === "IN_PROGRESS") ?? null;
  const latest = attempts.find((x) => x.status !== "IN_PROGRESS") ?? null;
  const passed = attempts.find((x) => x.passed) ?? null;
  const attemptsLeft = maxAttempts === null ? null : Math.max(0, maxAttempts - attempts.length);
  const state = { ...base, attemptsUsed: attempts.length, attemptsLeft, inProgress, latest, passed, assignment: assignment && assignment.status !== "EXCUSED" ? assignment : null };
  const round = cycle.key === "once" ? "" : ` for ${cycle.label}`;

  const block = (reason: TakeBlock, message: string) => ({ ...state, canTake: false, block: { reason, message } });
  if (inProgress) return { ...state, canTake: true, block: null }; // they can always go back to an attempt in progress
  if (actor.status !== "ACTIVE") return block("inactive", `Only active Weber State accounts can ${testVerb(test.isForm)} ${noun}s.`);
  if (test.status === "DRAFT") return block("unpublished", `This ${noun} isn't published yet.`);
  if (test.status === "ARCHIVED") return block("closed", `This ${noun} has been retired and can't be ${test.isForm ? "filled out" : "taken"} anymore.`);
  if (test.club && test.club.status !== "APPROVED") return block("closed", `This club's ${noun}s aren't available right now.`);
  if (test.recurrence === "ONE_OFF" && test.closesAt && test.closesAt <= now) return block("closed", `This ${noun} closed on ${fmtLongDate(test.closesAt)}.`);
  if (!(await inAudience(actor, test, Boolean(assignment)))) {
    const who =
      test.audience === "CLUB_MEMBERS"
        ? `members of ${test.club?.name ?? "the club"}`
        : test.audience === "ALL_STUDENTS"
          ? "Weber State students"
          : test.audience === "ROLE_REQUIREMENT"
            ? "the people a WSUSA requirement applies to"
            : "the people it was assigned to";
    return block("audience", `This ${noun} is for ${who}.`);
  }
  if (passed && test.isForm) return block("passed", `You submitted this form${round}${passed.submittedAt ? ` on ${fmtLongDate(passed.submittedAt)}` : ""}. Nothing more to do.`);
  if (passed) return block("passed", `You passed this test${round}. Nothing more to do.`);
  if (latest?.status === "NEEDS_REVIEW") return block("review", "Your last attempt is waiting for a reviewer. You'll get a notification when it's graded.");
  if (attemptsLeft === 0 && test.isForm) return block("attempts", `You already submitted this form${round}.`);
  if (attemptsLeft === 0) return block("attempts", `You've used all ${maxAttempts} attempt${maxAttempts === 1 ? "" : "s"}${round}.`);
  return { ...state, canTake: true, block: null };
}

/** Starts (or resumes) an attempt. The server sets the deadline; the clock starts now. */
export async function startAttempt(actor: Actor | null, testId: string): Promise<{ attemptId: string; resumed: boolean }> {
  assertSignedIn(actor);
  const now = new Date();
  const s = await takerState(actor, testId, now);
  if (s.inProgress) return { attemptId: s.inProgress.id, resumed: true };
  if (!s.canTake) throw forbidden(s.block?.message);
  const questionCount = await db.testQuestion.count({ where: { testId } });
  if (!questionCount) throw invalid(`This ${testNoun(s.test.isForm)} has no questions yet.`);
  const attempt = await db.testAttempt.create({
    data: { testId, userId: actor.id, cycleKey: s.cycle.key, startedAt: now, deadlineAt: s.deadlineIfStarted },
  });
  // Two clicks (or two tabs) at once: keep the first attempt, drop the duplicate before anyone answers in it.
  const open = await db.testAttempt.findMany({ where: { testId, userId: actor.id, cycleKey: s.cycle.key, status: "IN_PROGRESS" }, orderBy: [{ startedAt: "asc" }, { id: "asc" }], select: { id: true } });
  if (open.length > 1 && open[0].id !== attempt.id) {
    await db.testAttempt.deleteMany({ where: { id: attempt.id, status: "IN_PROGRESS" } });
    return { attemptId: open[0].id, resumed: true };
  }
  await logActivity({ actorId: actor.id, action: "test.attempt_started", entityType: "testAttempt", entityId: attempt.id, clubId: s.test.clubId, data: { testId, cycleKey: s.cycle.key } });
  return { attemptId: attempt.id, resumed: false };
}

async function ownAttempt(actor: Actor | null, attemptId: string) {
  assertSignedIn(actor);
  const attempt = await db.testAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.userId !== actor.id) throw notFound("Attempt");
  return { actor, attempt };
}

const AnswerInput = z.object({
  questionId: z.string().min(1),
  selectedOptionIds: z.array(z.string()).max(LIMITS.options).optional(),
  text: z.string().max(200_000, "That answer is too long to save.").nullable().optional(),
});

/**
 * Autosave one answer. Refused once time is up: the attempt is submitted with
 * what was saved before the deadline, and the caller is told to go to results.
 * (Autosaves aren't written to the activity log; the attempt's start and
 * submit are.)
 */
export async function saveAnswer(actor: Actor | null, attemptId: string, input: unknown): Promise<{ savedAt: Date }> {
  const { attempt } = await ownAttempt(actor, attemptId);
  const v = parse(AnswerInput, input);
  if (attempt.status !== "IN_PROGRESS") throw conflict("This attempt was already submitted.");
  const now = new Date();
  if (!acceptsAnswers(now, attempt.deadlineAt)) {
    await finishAttempt(attempt.id, { auto: true, actorId: attempt.userId, now });
    const form = (await db.test.findUnique({ where: { id: attempt.testId }, select: { isForm: true } }))?.isForm;
    throw conflict(form ? "This form has closed. It was submitted with the answers saved before it closed." : "Time's up. Your test was submitted with the answers saved before the clock ran out.");
  }
  const q = await db.testQuestion.findUnique({ where: { id: v.questionId } });
  if (!q || q.testId !== attempt.testId) throw notFound("Question");
  let selected: string[] = [];
  let text: string | null = null;
  if (isChoice(q.type)) {
    const ids = new Set(parseOptions(q.options).map((o) => o.id));
    selected = [...new Set(v.selectedOptionIds ?? [])].filter((id) => ids.has(id));
    if (q.type === "SINGLE_CHOICE" && selected.length > 1) throw invalid("Pick one answer for this question.");
  } else {
    text = sanitizeRichHtml(v.text ?? "");
    const max = q.type === "SHORT_ANSWER" ? 20_000 : 120_000;
    if (text.length > max) throw invalid(q.type === "SHORT_ANSWER" ? "Short answers should be a few sentences. Shorten yours a little." : "That answer is too long to save.");
  }
  await db.testAnswer.upsert({
    where: { attemptId_questionId: { attemptId, questionId: q.id } },
    create: { attemptId, questionId: q.id, selectedOptionIds: selected, text },
    update: { selectedOptionIds: selected, text },
  });
  return { savedAt: now };
}

/**
 * Submit an attempt (by the taker, or automatically when the clock runs out). Idempotent.
 * A form needs every question answered, unless it's handed in automatically (then it's taken as-is).
 */
export async function submitAttempt(actor: Actor | null, attemptId: string, opts: { auto?: boolean } = {}): Promise<{ status: TestAttempt["status"]; needsReview: boolean }> {
  const { attempt } = await ownAttempt(actor, attemptId);
  if (attempt.status !== "IN_PROGRESS") return { status: attempt.status, needsReview: attempt.status === "NEEDS_REVIEW" };
  const now = new Date();
  const late = !acceptsAnswers(now, attempt.deadlineAt);
  const auto = Boolean(opts.auto) || late;
  const test = await db.test.findUnique({ where: { id: attempt.testId }, select: { isForm: true } });
  // Once a form's closing time comes it's taken as-is; before that, the browser saying "auto" doesn't skip the check.
  const closing = attempt.deadlineAt !== null && now.getTime() >= attempt.deadlineAt.getTime() - 5_000;
  if (test?.isForm && !closing) {
    const [questions, answers] = await Promise.all([
      db.testQuestion.findMany({ where: { testId: attempt.testId }, orderBy: { order: "asc" }, select: { id: true, type: true } }),
      db.testAnswer.findMany({ where: { attemptId }, select: { questionId: true, selectedOptionIds: true, text: true } }),
    ]);
    const missing = unansweredQuestionIds(questions, answers);
    if (missing.length) {
      const n = questions.findIndex((q) => q.id === missing[0]) + 1;
      throw invalid(`Answer every question before you submit. Question ${n}${missing.length > 1 ? ` and ${missing.length - 1} more still need` : " still needs"} an answer.`);
    }
  }
  const r = await finishAttempt(attempt.id, { auto, actorId: attempt.userId, now });
  return { status: r.status, needsReview: r.needsReview };
}

/**
 * Closes an attempt: scores choice questions (all-or-nothing), then either
 * grades it or sends it to review. A form is graded on the spot as passed,
 * with no score. Used by submit, autosave-after-deadline and the
 * abandoned-attempt job. Only the first caller wins (status guard).
 */
export async function finishAttempt(attemptId: string, opts: { auto: boolean; actorId: string | null; now?: Date }): Promise<{ status: TestAttempt["status"]; needsReview: boolean; claimed: boolean }> {
  const now = opts.now ?? new Date();
  const attempt = await db.testAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) throw notFound("Attempt");
  const test = await loadTest(attempt.testId);
  // An abandoned attempt counts as handed in when its time ran out, not when the job noticed.
  const submittedAt = attempt.deadlineAt && now > attempt.deadlineAt ? attempt.deadlineAt : now;
  const claimed = await db.testAttempt.updateMany({
    where: { id: attemptId, status: "IN_PROGRESS" },
    data: test.isForm ? { status: "GRADED", submittedAt, autoSubmitted: opts.auto, scorePercent: null, passed: true, gradedAt: now } : { status: "NEEDS_REVIEW", submittedAt, autoSubmitted: opts.auto },
  });
  if (!claimed.count) {
    const cur = await db.testAttempt.findUnique({ where: { id: attemptId }, select: { status: true } });
    return { status: cur?.status ?? "GRADED", needsReview: cur?.status === "NEEDS_REVIEW", claimed: false };
  }

  if (test.isForm) {
    const answered = await db.testAnswer.count({ where: { attemptId } });
    await logActivity({ actorId: opts.actorId, action: "test.attempt_submitted", entityType: "testAttempt", entityId: attemptId, clubId: test.clubId, data: { testId: test.id, auto: opts.auto, answered, needsReview: false, isForm: true } });
    await applyOutcome({ ...attempt, scorePercent: null, passed: true }, test, { reviewed: false, actorId: opts.actorId });
    return { status: "GRADED", needsReview: false, claimed: true };
  }

  const [questions, answers] = await Promise.all([
    db.testQuestion.findMany({ where: { testId: attempt.testId }, orderBy: { order: "asc" } }),
    db.testAnswer.findMany({ where: { attemptId } }),
  ]);
  // Choice answers get their points recorded now; that's the instant score.
  for (const ans of answers) {
    const q = questions.find((x) => x.id === ans.questionId);
    if (q && isChoice(q.type)) await db.testAnswer.update({ where: { id: ans.id }, data: { pointsAwarded: autoPoints(toScoring(q), toScoringAnswer(ans)) ?? 0 } });
  }
  const score = scoreAttempt(questions.map(toScoring), answers.map(toScoringAnswer), test.passingPercent);
  // Blank written answers score 0 straight away so reviewers only see real answers.
  for (const q of questions) {
    if (!isOpen(q.type) || score.pendingQuestionIds.includes(q.id)) continue;
    const ans = answers.find((a) => a.questionId === q.id);
    if (ans) await db.testAnswer.update({ where: { id: ans.id }, data: { pointsAwarded: 0 } });
  }

  await logActivity({
    actorId: opts.actorId,
    action: "test.attempt_submitted",
    entityType: "testAttempt",
    entityId: attemptId,
    clubId: test.clubId,
    data: { testId: test.id, auto: opts.auto, answered: answers.length, needsReview: score.percent === null },
  });

  if (score.percent === null) {
    const taker = await db.user.findUnique({ where: { id: attempt.userId }, select: { name: true } });
    await createTask({
      kind: "APPROVAL",
      title: `Grade: ${test.title} — ${taker?.name ?? "a test taker"}`,
      description: `${score.pendingQuestionIds.length} written answer${score.pendingQuestionIds.length === 1 ? "" : "s"} to review.`,
      // A university test's answers go to its office's staff (WSUSA's for officeId null).
      assignee: test.clubId ? { type: "CLUB", clubId: test.clubId, capability: "tests" } : { type: "ADMINS", officeId: test.officeId ?? null },
      href: manageHref(test, `review/${attemptId}`),
      source: { type: "testAttempt", id: attemptId },
    });
    return { status: "NEEDS_REVIEW", needsReview: true, claimed: true };
  }

  await db.testAttempt.update({ where: { id: attemptId }, data: { status: "GRADED", scorePercent: score.percent, passed: score.passed, gradedAt: now } });
  await applyOutcome({ ...attempt, scorePercent: score.percent, passed: Boolean(score.passed) }, test, { reviewed: false, actorId: opts.actorId });
  return { status: "GRADED", needsReview: false, claimed: true };
}

function toScoring(q: { id: string; type: ScoringQuestion["type"]; points: number; correctOptionIds: string[] }): ScoringQuestion {
  return { id: q.id, type: q.type, points: q.points, correctOptionIds: q.correctOptionIds };
}

function toScoringAnswer(a: { questionId: string; selectedOptionIds: string[]; text: string | null; pointsAwarded: number | null }) {
  return { questionId: a.questionId, selectedOptionIds: a.selectedOptionIds, text: a.text, pointsAwarded: a.pointsAwarded };
}

// ─── Grading ─────────────────────────────────────────────────────────────────

const GradeInput = z.object({
  grades: z
    .array(
      z.object({
        questionId: z.string().min(1),
        points: z.number({ error: "Enter points for every answer." }),
        comment: z.string().trim().max(2000, "Keep comments under 2,000 characters.").optional(),
      }),
    )
    .max(LIMITS.questions),
});

/** The reviewer scores each written answer and finalizes. Only people can grade; Claude's suggestion is advice. */
export async function finalizeGrading(actor: Actor | null, attemptId: string, input: unknown): Promise<{ scorePercent: number; passed: boolean }> {
  const attempt = await db.testAttempt.findUnique({ where: { id: attemptId }, include: { gradedBy: { select: { name: true } } } });
  if (!attempt) throw notFound("Attempt");
  const test = await loadTest(attempt.testId);
  const a = await assertCanManageTest(actor, test);
  if (test.isForm) throw invalid("Forms aren't graded.");
  if (attempt.userId === a.id) throw forbidden("You can't grade your own attempt. Ask another leader or an administrator.");
  if (attempt.status === "GRADED") throw conflict(`${attempt.gradedBy?.name ?? "Someone"} already graded this attempt.`);
  if (attempt.status !== "NEEDS_REVIEW") throw conflict("This attempt hasn't been submitted yet.");
  const v = parse(GradeInput, input);

  const [questions, answers] = await Promise.all([
    db.testQuestion.findMany({ where: { testId: test.id }, orderBy: { order: "asc" } }),
    db.testAnswer.findMany({ where: { attemptId } }),
  ]);
  const pending = scoreAttempt(questions.map(toScoring), answers.map(toScoringAnswer), test.passingPercent).pendingQuestionIds;
  const byQ = new Map(v.grades.map((g) => [g.questionId, g]));
  const missing = pending.filter((id) => !byQ.has(id));
  if (missing.length) {
    const n = questions.findIndex((q) => q.id === missing[0]) + 1;
    throw invalid(`Give points for question ${n}${missing.length > 1 ? ` and ${missing.length - 1} more` : ""} before finishing.`);
  }

  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    for (const g of v.grades) {
      const q = questions.find((x) => x.id === g.questionId);
      const ans = answers.find((x) => x.questionId === g.questionId);
      if (!q || !ans || !isOpen(q.type)) continue;
      const pts = clampPoints(g.points, q.points);
      await tx.testAnswer.update({ where: { id: ans.id }, data: { pointsAwarded: pts, reviewerComment: g.comment || null } });
      ans.pointsAwarded = pts;
    }
    const score = scoreAttempt(questions.map(toScoring), answers.map(toScoringAnswer), test.passingPercent);
    if (score.percent === null) throw invalid("Some answers still need points.");
    const done = await tx.testAttempt.updateMany({
      where: { id: attemptId, status: "NEEDS_REVIEW" },
      data: { status: "GRADED", scorePercent: score.percent, passed: Boolean(score.passed), gradedById: a.id, gradedAt: now },
    });
    if (!done.count) throw conflict("Someone else just graded this attempt.");
    await logActivity({ actorId: a.id, action: "test.attempt_graded", entityType: "testAttempt", entityId: attemptId, clubId: test.clubId, data: { testId: test.id, scorePercent: score.percent, passed: score.passed } }, tx);
    return { scorePercent: score.percent, passed: Boolean(score.passed) };
  });
  await resolveTasks("testAttempt", attemptId, a.id);
  await applyOutcome({ ...attempt, ...result }, test, { reviewed: true, actorId: a.id });
  return result;
}

/** Ask Claude for a suggestion on one written answer (shown to the reviewer as "Suggestion — you decide"). */
export async function requestGradingSuggestion(actor: Actor | null, answerId: string): Promise<{ points: number; feedback: string; confidence: string; model: string }> {
  const ans = await db.testAnswer.findUnique({ where: { id: answerId }, include: { question: true, attempt: { select: { testId: true, status: true } } } });
  if (!ans) throw notFound("Answer");
  const test = await loadTest(ans.attempt.testId);
  const a = await assertCanManageTest(actor, test);
  if (test.isForm) throw invalid("Forms aren't graded.");
  if (!(await aiLive("grading"))) throw forbidden("Grading suggestions are turned off.");
  if (!isOpen(ans.question.type)) throw invalid("Claude only suggests points for written answers.");
  const r = await suggestGrade({
    questionType: ans.question.type as "SHORT_ANSWER" | "LONG_ANSWER",
    promptHtml: ans.question.promptHtml,
    modelAnswer: ans.question.modelAnswer,
    answerHtml: ans.text,
    maxPoints: ans.question.points,
  });
  if (!r.ok) throw invalid(r.message);
  await db.testAnswer.update({ where: { id: answerId }, data: { aiSuggestedPoints: r.suggestion.points, aiFeedback: r.suggestion.feedback, aiModel: `${r.suggestion.model} · ${r.suggestion.confidence}` } });
  await logActivity({ actorId: a.id, action: "test.ai_suggested", entityType: "testAnswer", entityId: answerId, clubId: test.clubId, data: { model: r.suggestion.model } });
  return r.suggestion;
}

/**
 * Background: fill in Claude suggestions for an attempt's written answers
 * right after it's submitted (no permission check — it only runs for attempts
 * just handed in, and only when grading assist is on). Never throws.
 */
export async function prefillGradingSuggestions(attemptId: string): Promise<number> {
  try {
    if (!(await aiLive("grading"))) return 0;
    const answers = await db.testAnswer.findMany({ where: { attemptId, aiSuggestedPoints: null, pointsAwarded: null, attempt: { status: "NEEDS_REVIEW" } }, include: { question: true } });
    let n = 0;
    for (const ans of answers) {
      if (!isOpen(ans.question.type)) continue;
      const r = await suggestGrade({ questionType: ans.question.type as "SHORT_ANSWER" | "LONG_ANSWER", promptHtml: ans.question.promptHtml, modelAnswer: ans.question.modelAnswer, answerHtml: ans.text, maxPoints: ans.question.points });
      if (!r.ok) continue;
      await db.testAnswer.update({ where: { id: ans.id }, data: { aiSuggestedPoints: r.suggestion.points, aiFeedback: r.suggestion.feedback, aiModel: `${r.suggestion.model} · ${r.suggestion.confidence}` } });
      n++;
    }
    return n;
  } catch (e) {
    console.error("prefillGradingSuggestions", e);
    return 0;
  }
}

// ─── Outcomes & automations ──────────────────────────────────────────────────

type OutcomeAttempt = Pick<TestAttempt, "id" | "testId" | "userId" | "cycleKey"> & { scorePercent: number | null; passed: boolean | null };

/**
 * What happens once an attempt has a final grade. Passing (or submitting a
 * form) completes the person's open assignment(s), meets any WSUSA
 * requirement that uses the test or form (its REQUIREMENT task closes; the
 * permission gate reads attempts directly), closes earlier follow-ups, and
 * runs PASSED automations. Not passing runs FAILED automations. When a
 * reviewer graded it, the taker always hears the result.
 */
async function applyOutcome(attempt: OutcomeAttempt, test: TestRow, opts: { reviewed: boolean; actorId: string | null }) {
  const now = new Date();
  const automations = parseAutomations(test.automations);
  const taker = await db.user.findUnique({ where: { id: attempt.userId }, select: { id: true, name: true, handle: true } });
  if (!taker) return;
  const ctx: AutomationContext = { test, taker, cycleKey: attempt.cycleKey, scorePercent: attempt.scorePercent, attemptId: attempt.id };
  const maxAttempts = maxAttemptsOf(test);

  if (attempt.passed) {
    const open = await db.testAssignment.findMany({
      where: { testId: test.id, userId: taker.id, OR: [{ status: "ASSIGNED" }, { status: "MISSED", cycleKey: attempt.cycleKey }] },
      select: { id: true },
    });
    if (open.length) {
      await db.testAssignment.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: "COMPLETED", resolvedAt: now } });
      for (const o of open) await resolveTasks("testAssignment", o.id, taker.id);
    }
    const reqs = await db.roleRequirement.findMany({ where: { testId: test.id, kind: "TEST" }, select: { id: true } });
    for (const r of reqs) await resolveTasks("requirement", requirementSourceId(r.id, taker.id), taker.id);
    for (const trig of ["FAILED", "MISSED_DEADLINE"] as const) await resolveTasks("testFollowUp", followUpId(test.id, taker.id, attempt.cycleKey, trig), opts.actorId);
    await logActivity({
      actorId: taker.id,
      action: test.isForm ? "test.form_submitted" : "test.passed",
      entityType: "test",
      entityId: test.id,
      clubId: test.clubId,
      data: { attemptId: attempt.id, scorePercent: attempt.scorePercent },
      isPublic: false,
    });
  } else if (maxAttempts !== null) {
    // Out of attempts for this round: they finished taking it (without passing), so it's no longer
    // on their to-do list and the deadline job won't call it "missed". A late taker's assignment
    // stays MISSED, but its task closes too. Follow-ups are the automations' job.
    const used = await db.testAttempt.count({ where: { testId: test.id, userId: taker.id, cycleKey: attempt.cycleKey } });
    if (used >= maxAttempts) {
      const open = await db.testAssignment.findMany({ where: { testId: test.id, userId: taker.id, cycleKey: attempt.cycleKey, status: { in: ["ASSIGNED", "MISSED"] } }, select: { id: true, status: true } });
      const assigned = open.filter((o) => o.status === "ASSIGNED");
      if (assigned.length) await db.testAssignment.updateMany({ where: { id: { in: assigned.map((o) => o.id) } }, data: { status: "COMPLETED", resolvedAt: now } });
      for (const o of open) await resolveTasks("testAssignment", o.id, null);
    }
  }
  await runAutomations(attempt.passed ? "PASSED" : "FAILED", automations, ctx, { forceTaker: opts.reviewed });
}

type AutomationContext = {
  test: TestRow;
  taker: { id: string; name: string; handle: string };
  cycleKey: string;
  scorePercent?: number | null;
  attemptId?: string;
  dueAt?: Date;
};

function followUpId(testId: string, userId: string, cycleKey: string, trigger: AutomationTrigger) {
  return `${testId}:${userId}:${cycleKey}:${trigger}`;
}

async function takerMessage(trigger: AutomationTrigger, ctx: AutomationContext): Promise<{ kind: string; title: string; body: string; href: string }> {
  const { test } = ctx;
  const href = ctx.attemptId ? `/tests/${test.id}/results/${ctx.attemptId}` : `/tests/${test.id}`;
  if (trigger === "PASSED" && test.isForm) {
    return { kind: "test.completed", title: `We got your form: ${test.title}`, body: "Thanks for filling it out. You can look back at your answers anytime.", href };
  }
  if (trigger === "PASSED") {
    return { kind: "test.completed", title: `You passed ${test.title}`, body: `Score: ${fmtPercent(ctx.scorePercent)} (${test.passingPercent}% needed).`, href };
  }
  if (trigger === "MISSED_DEADLINE") {
    const open = isOpenForTaking(test, new Date());
    return {
      kind: "test.missed",
      title: `You missed the deadline for ${test.title}`,
      body: open ? `It's still open — ${test.isForm ? "fill it out" : "take it"} as soon as you can.` : `It's closed now. Contact ${test.club ? `${test.club.name}'s leaders` : "WSUSA"} if you need another chance.`,
      href: `/tests/${test.id}`,
    };
  }
  // Didn't pass: say exactly what's next.
  const used = await db.testAttempt.count({ where: { testId: test.id, userId: ctx.taker.id, cycleKey: ctx.cycleKey } });
  const max = maxAttemptsOf(test);
  const left = max === null ? null : Math.max(0, max - used);
  const canRetake = isOpenForTaking(test, new Date()) && left !== 0;
  const retake = !canRetake
    ? `You don't have any attempts left. Contact ${test.club ? `${test.club.name}'s leaders` : "WSUSA"} about next steps.`
    : left === null
      ? "You can take it again whenever you're ready."
      : `You have ${left} attempt${left === 1 ? "" : "s"} left.`;
  return { kind: "test.failed", title: `You didn't pass ${test.title} this time`, body: `Score: ${fmtPercent(ctx.scorePercent)} (${test.passingPercent}% needed). ${retake}`, href };
}

/** Advisors to tell: the club's advisors, or for university tests, the advisors of every club the person leads. */
async function advisorIdsFor(ctx: AutomationContext): Promise<string[]> {
  if (ctx.test.clubId) return clubAdvisors(ctx.test.clubId);
  const clubs = await db.roleAssignment.findMany({ where: { userId: ctx.taker.id, endedAt: null, role: { not: "ADVISOR" }, club: { status: "APPROVED" } }, select: { clubId: true } });
  const ids = await Promise.all([...new Set(clubs.map((c) => c.clubId))].map((id) => clubAdvisors(id)));
  return [...new Set(ids.flat())];
}

/**
 * Runs a test's automations for one trigger. "Admins" means whoever manages
 * the test: WSUSA admins for university tests, club leaders with the tests
 * permission for club tests. For forms, PASSED means "submitted".
 */
export async function runAutomations(trigger: AutomationTrigger, automations: Automation[], ctx: AutomationContext, opts: { forceTaker?: boolean } = {}) {
  const scope = ctx.test.clubId ? "club" : "university";
  const actions = new Set(automations.filter((a) => a.trigger === trigger && automationAllowed(a, scope, ctx.test.isForm)).map((a) => a.action));
  const { test, taker } = ctx;
  const verb = trigger === "PASSED" ? (test.isForm ? "submitted" : "passed") : trigger === "FAILED" ? "didn't pass" : "missed the deadline for";
  const scoreNote = ctx.scorePercent !== null && ctx.scorePercent !== undefined ? ` (${fmtPercent(ctx.scorePercent)})` : "";
  const resultsHref = manageHref(test, "results");

  if (actions.has("NOTIFY_TAKER") || opts.forceTaker) {
    const m = await takerMessage(trigger, ctx);
    await notify({ userIds: [taker.id], ...m });
  }
  if (actions.has("NOTIFY_ADVISOR")) {
    const ids = await advisorIdsFor(ctx);
    await notify({
      userIds: ids,
      kind: `test.${trigger === "PASSED" ? "completed" : trigger === "FAILED" ? "failed" : "missed"}`,
      title: `${taker.name} ${verb} ${test.title}${scoreNote}`,
      body: test.clubId ? undefined : "You're getting this as an advisor of a club they help lead.",
      href: test.clubId ? resultsHref : `/u/${taker.handle}`,
      exceptUserId: taker.id,
    });
  }
  if (actions.has("NOTIFY_ADMINS")) {
    const ids = test.clubId ? await clubCapabilityHolders(test.clubId, "tests") : await officeStaffIds(test.officeId ?? null);
    await notify({ userIds: ids, kind: "test.automation", title: `${taker.name} ${verb} ${test.title}${scoreNote}`, href: resultsHref, exceptUserId: taker.id });
  }
  if (actions.has("CREATE_ADMIN_TASK") && trigger !== "PASSED") {
    const sourceId = followUpId(test.id, taker.id, ctx.cycleKey, trigger);
    const exists = await db.task.count({ where: { sourceType: "testFollowUp", sourceId, status: "OPEN" } });
    if (!exists) {
      await createTask({
        kind: "CLUB",
        title: `Follow up: ${taker.name} ${verb} ${test.title}`,
        description: trigger === "FAILED" ? `Score${scoreNote || ": —"}. Check in with them about a retake.` : "Check in with them about finishing it.",
        assignee: test.clubId ? { type: "CLUB", clubId: test.clubId, capability: "tests" } : { type: "ADMINS", officeId: test.officeId ?? null },
        href: resultsHref,
        dueAt: new Date(Date.now() + 7 * DAY),
        source: { type: "testFollowUp", id: sourceId },
      });
    }
  } else if (actions.has("CREATE_ADMIN_TASK")) {
    const sourceId = followUpId(test.id, taker.id, ctx.cycleKey, "PASSED");
    if (!(await db.task.count({ where: { sourceType: "testFollowUp", sourceId } }))) {
      await createTask({
        kind: "CLUB",
        title: `${taker.name} ${verb} ${test.title}${scoreNote}`,
        description: "Take whatever step comes next for them (for example, approving a role or access).",
        assignee: test.clubId ? { type: "CLUB", clubId: test.clubId, capability: "tests" } : { type: "ADMINS", officeId: test.officeId ?? null },
        href: resultsHref,
        source: { type: "testFollowUp", id: sourceId },
      });
    }
  }
  await runClubActions(actions, automations, ctx, verb);
}

const PERMISSIONS_PAUSED = "test.permissions_paused";
const PERMISSIONS_RESUMED = "test.permissions_resumed";

/**
 * The automations that change something in the club: approving the taker's
 * join request, and pausing or giving back their officer permissions. They go
 * through the same write paths a leader uses by hand
 * (memberships.decideMembership, roles.setRolePermissions), in the name of the
 * person who built the test, and only while that person could still take the
 * step themselves; otherwise it's skipped (a join request stays in the roster
 * holders' inbox). Never throws: the result is already recorded by now.
 */
async function runClubActions(actions: Set<AutomationAction>, automations: Automation[], ctx: AutomationContext, verb: string) {
  const { test, taker } = ctx;
  const clubId = test.clubId;
  if (!clubId || !test.club || ![...actions].some(isClubAction)) return;
  try {
    const creator = await loadActor(test.createdById);
    if (!creator || creator.status === "DEACTIVATED") return;
    const access = await getClubAccess(creator, clubId);
    if (!access) return;

    if (actions.has("APPROVE_JOIN_REQUEST") && access.capabilities.has("roster")) {
      const m = await db.membership.findUnique({ where: { userId_clubId: { userId: taker.id, clubId } }, select: { id: true, status: true } });
      if (m?.status === "PENDING") await decideMembership(creator, m.id, true);
    }

    const pause = actions.has("PAUSE_PERMISSIONS");
    if (!pause && !actions.has("RESUME_PERMISSIONS")) return;
    const roles = access.assignableRoles.filter((r) => r === "OFFICER" || r === "AMBASSADOR");
    const seats = roles.length ? await db.roleAssignment.findMany({ where: { clubId, userId: taker.id, endedAt: null, role: { in: roles } }, select: { id: true, permissions: true } }) : [];
    let changed = 0;
    for (const seat of seats) {
      // Pausing empties the seat's permissions and remembers them; giving back restores exactly
      // that, unless a leader has set the seat's permissions again since.
      let next: string[] = [];
      if (pause) {
        if (!seat.permissions.length) continue;
      } else {
        if (seat.permissions.length) continue;
        next = await pausedPermissions(seat.id);
        if (!next.length) continue;
      }
      await setRolePermissions(creator, seat.id, next);
      await logActivity({ actorId: null, action: pause ? PERMISSIONS_PAUSED : PERMISSIONS_RESUMED, entityType: "roleAssignment", entityId: seat.id, clubId, data: { testId: test.id, userId: taker.id, permissions: pause ? seat.permissions : next } });
      changed++;
    }
    if (!changed) return;
    const comesBack = automations.some((a) => a.trigger === "PASSED" && a.action === "RESUME_PERMISSIONS");
    await notify({
      userIds: [taker.id],
      kind: pause ? "test.permissions_paused" : "test.permissions_resumed",
      title: pause ? `Your officer permissions in ${test.club.name} are paused` : `Your officer permissions in ${test.club.name} are back`,
      body: pause
        ? `You ${verb} ${test.title}. ${comesBack ? `They come back when you ${test.isForm ? "submit" : "pass"} it.` : "Ask the President or a Vice President about getting them back."}`
        : `You ${test.isForm ? "submitted" : "passed"} ${test.title}.`,
      href: pause ? `/tests/${test.id}` : `/clubs/${test.club.slug}/manage`,
    });
  } catch (e) {
    console.error("test club automation", e);
  }
}

/**
 * What a test automation took away from a seat, if that pause is still the
 * latest word on it. The pause's own "role.permissions_set" row comes just
 * before it, so any later one means a leader has set the permissions since.
 */
async function pausedPermissions(assignmentId: string): Promise<string[]> {
  const last = await db.activityLog.findFirst({
    where: { entityType: "roleAssignment", entityId: assignmentId, action: { in: [PERMISSIONS_PAUSED, PERMISSIONS_RESUMED, "role.permissions_set"] } },
    orderBy: { id: "desc" },
    select: { action: true, data: true },
  });
  if (last?.action !== PERMISSIONS_PAUSED) return [];
  const saved = (last.data as { permissions?: unknown } | null)?.permissions;
  return Array.isArray(saved) ? saved.filter((p): p is string => typeof p === "string") : [];
}

// ─── Scheduled work (lib/jobs) ───────────────────────────────────────────────

/** Job: start new rounds of recurring tests and catch late joiners up on the current one. */
export async function runTestCycles(now: Date = new Date()): Promise<{ tests: number; assigned: number }> {
  const tests = await db.test.findMany({ where: { status: "PUBLISHED", audience: { in: ASSIGNED_AUDIENCES } }, select: { id: true } });
  let assigned = 0;
  for (const t of tests) assigned += (await syncAssignments(t.id, now)).created;
  return { tests: tests.length, assigned };
}

/** Job: assignments past due become MISSED and run MISSED_DEADLINE automations. Idempotent. */
export async function markMissedAssignments(now: Date = new Date()): Promise<{ missed: number }> {
  const due = await db.testAssignment.findMany({ where: { status: "ASSIGNED", dueAt: { lt: now } }, select: { id: true, testId: true, userId: true, cycleKey: true, dueAt: true } });
  let missed = 0;
  for (const a of due) {
    // Handed in on time and waiting for a reviewer, or a timed attempt still running (the
    // abandoned-attempt job hands it in): not missed (yet).
    const busy = await db.testAttempt.count({
      where: { testId: a.testId, userId: a.userId, cycleKey: a.cycleKey, OR: [{ status: "IN_PROGRESS", deadlineAt: { not: null } }, { status: "NEEDS_REVIEW", submittedAt: { lte: a.dueAt } }] },
    });
    if (busy) continue;
    const claimed = await db.testAssignment.updateMany({ where: { id: a.id, status: "ASSIGNED" }, data: { status: "MISSED", resolvedAt: now } });
    if (!claimed.count) continue;
    missed++;
    const test = await loadTest(a.testId);
    const cycle = await cycleForTest(test, now);
    // Still takeable this round? Keep the task open (late is better than never); otherwise close it.
    if (!isOpenForTaking(test, now) || cycle.key !== a.cycleKey) {
      await resolveTasks("testAssignment", a.id, null, db, "CANCELLED");
    }
    const taker = await db.user.findUnique({ where: { id: a.userId }, select: { id: true, name: true, handle: true, status: true } });
    if (!taker || taker.status !== "ACTIVE") continue;
    await runAutomations("MISSED_DEADLINE", parseAutomations(test.automations), { test, taker, cycleKey: a.cycleKey, dueAt: a.dueAt });
    await logActivity({ actorId: null, action: "test.assignment_missed", entityType: "testAssignment", entityId: a.id, clubId: test.clubId, data: { testId: test.id, userId: taker.id, cycleKey: a.cycleKey } });
  }
  return { missed };
}

/** Job: submit attempts whose clock ran out while nobody was on the page; open grading tasks that are missing. */
export async function submitAbandonedAttempts(now: Date = new Date()): Promise<{ submitted: number; reviewTasks: number }> {
  const stuck = await db.testAttempt.findMany({ where: { status: "IN_PROGRESS", deadlineAt: { lt: new Date(now.getTime() - 15_000) } }, select: { id: true, userId: true } });
  let submitted = 0;
  for (const a of stuck) {
    const r = await finishAttempt(a.id, { auto: true, actorId: null, now });
    if (r.claimed) submitted++;
  }
  // Attempts waiting on a reviewer always have a task (covers attempts from before tasks existed).
  const waiting = await db.testAttempt.findMany({
    where: { status: "NEEDS_REVIEW" },
    select: { id: true, testId: true, user: { select: { name: true } }, test: { select: { title: true, clubId: true, officeId: true, club: { select: { slug: true } } } } },
  });
  let reviewTasks = 0;
  if (waiting.length) {
    const have = new Set(
      (await db.task.findMany({ where: { sourceType: "testAttempt", sourceId: { in: waiting.map((w) => w.id) } }, select: { sourceId: true } })).map((t) => t.sourceId),
    );
    for (const w of waiting) {
      if (have.has(w.id)) continue;
      await createTask({
        kind: "APPROVAL",
        title: `Grade: ${w.test.title} — ${w.user.name}`,
        description: "Written answers to review.",
        assignee: w.test.clubId ? { type: "CLUB", clubId: w.test.clubId, capability: "tests" } : { type: "ADMINS", officeId: w.test.officeId },
        href: manageHref({ id: w.testId, clubId: w.test.clubId, club: w.test.club }, `review/${w.id}`),
        source: { type: "testAttempt", id: w.id },
      });
      reviewTasks++;
    }
  }
  return { submitted, reviewTasks };
}

// ─── Choosing people (SELECTED_USERS) ────────────────────────────────────────

export type TestPersonOption = { id: string; name: string; handle: string; email: string; avatarUrl: string | null; avatarColor: string; detail: string | null };

/**
 * People a builder can pick for "People I choose": a club's active members for
 * club tests, any active Weber State account for university tests. Searches by
 * name, email or handle; returns at most 20.
 */
export async function searchTestPeople(actor: Actor | null, input: { clubId: string | null; q: string }): Promise<TestPersonOption[]> {
  // University tests pick from every account, for any office's test builder.
  if (input.clubId === null) assertCan(actor, "admin.tests");
  else await assertCanManageTest(actor, { clubId: input.clubId });
  const q = String(input.q ?? "").trim().slice(0, 80);
  if (q.length < 2) return [];
  const text = { contains: q, mode: "insensitive" as const };
  const rows = await db.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ name: text }, { email: text }, { handle: text }],
      ...(input.clubId ? { memberships: { some: { clubId: input.clubId, status: "ACTIVE" } } } : {}),
    },
    orderBy: { name: "asc" },
    take: 20,
    select: { id: true, name: true, handle: true, email: true, avatarUrl: true, avatarColor: true, kind: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, handle: r.handle, email: r.email, avatarUrl: r.avatarUrl, avatarColor: r.avatarColor, detail: r.kind === "STUDENT" ? "Student" : "Faculty & staff" }));
}

/** The chosen people, for showing the selection in the editor. */
export async function testPeopleByIds(ids: string[]): Promise<TestPersonOption[]> {
  if (!ids.length) return [];
  const rows = await db.user.findMany({
    where: { id: { in: ids } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, handle: true, email: true, avatarUrl: true, avatarColor: true, kind: true, status: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    handle: r.handle,
    email: r.email,
    avatarUrl: r.avatarUrl,
    avatarColor: r.avatarColor,
    detail: r.status !== "ACTIVE" ? "Account not active" : r.kind === "STUDENT" ? "Student" : "Faculty & staff",
  }));
}

/**
 * Job: make sure attempts waiting for review have Claude's suggestions when
 * grading assist is on (covers auto-submitted attempts and any suggestion
 * that failed right after submit). Bounded per run; never throws.
 */
export async function prefillPendingSuggestions(limit = 15): Promise<{ attempts: number; suggestions: number }> {
  if (!(await aiLive("grading"))) return { attempts: 0, suggestions: 0 };
  const waiting = await db.testAttempt.findMany({
    where: { status: "NEEDS_REVIEW", answers: { some: { aiSuggestedPoints: null, pointsAwarded: null, question: { type: { in: ["SHORT_ANSWER", "LONG_ANSWER"] } } } } },
    orderBy: { submittedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let suggestions = 0;
  for (const w of waiting) suggestions += await prefillGradingSuggestions(w.id);
  return { attempts: waiting.length, suggestions };
}
