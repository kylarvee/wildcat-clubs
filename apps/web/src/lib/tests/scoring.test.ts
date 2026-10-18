import { describe, expect, it } from "vitest";
import { autoPoints, choiceCorrect, clampPoints, hasText, isAnswered, passes, scoreAttempt, unansweredQuestionIds, type ScoringQuestion } from "@/lib/tests/scoring";
import { actionsFor, attemptLabel, automationAllowed, defaultAutomations, fmtPercent, parseAutomations, parseOptions, triggerLabel, triggersFor } from "@/lib/tests/types";

const single: ScoringQuestion = { id: "q1", type: "SINGLE_CHOICE", points: 1, correctOptionIds: ["b"] };
const multi: ScoringQuestion = { id: "q2", type: "MULTI_CHOICE", points: 2, correctOptionIds: ["a", "b", "d"] };
const short: ScoringQuestion = { id: "q3", type: "SHORT_ANSWER", points: 1, correctOptionIds: [] };
const long: ScoringQuestion = { id: "q4", type: "LONG_ANSWER", points: 3, correctOptionIds: [] };

describe("choice questions", () => {
  it("are all-or-nothing", () => {
    expect(choiceCorrect(["a", "b", "d"], ["d", "a", "b"])).toBe(true);
    expect(choiceCorrect(["a", "b", "d"], ["a", "b"])).toBe(false); // missing one
    expect(choiceCorrect(["a", "b", "d"], ["a", "b", "c", "d"])).toBe(false); // an extra wrong pick
    expect(choiceCorrect(["a", "b", "d"], ["a", "b", "b"])).toBe(false); // duplicates don't pad the count
    expect(choiceCorrect([], [])).toBe(false); // a question with no correct answer can't be right
  });
  it("score full points or zero", () => {
    expect(autoPoints(multi, { questionId: "q2", selectedOptionIds: ["a", "b", "d"], text: null })).toBe(2);
    expect(autoPoints(multi, { questionId: "q2", selectedOptionIds: ["a", "b"], text: null })).toBe(0);
    expect(autoPoints(single, undefined)).toBe(0);
  });
});

describe("open questions", () => {
  it("need review only when something was written", () => {
    expect(autoPoints(short, { questionId: "q3", selectedOptionIds: [], text: "<p>Call WSUSA</p>" })).toBeNull();
    expect(autoPoints(short, { questionId: "q3", selectedOptionIds: [], text: "<p></p><p>&nbsp;</p>" })).toBe(0);
    expect(autoPoints(long, undefined)).toBe(0);
  });
  it("detects real text in editor HTML", () => {
    expect(hasText("<p><br></p>")).toBe(false);
    expect(hasText("<p>&amp;</p>")).toBe(true);
    expect(hasText('<div data-embed="video" data-src="https://youtu.be/x"></div>')).toBe(true);
    expect(isAnswered(short, { selectedOptionIds: [], text: "<p> </p>" })).toBe(false);
    expect(isAnswered(single, { selectedOptionIds: ["a"], text: null })).toBe(true);
  });
});

describe("scoreAttempt", () => {
  const questions = [single, multi, short, long];
  it("waits for review when open answers have text, but reports the choice score", () => {
    const s = scoreAttempt(
      questions,
      [
        { questionId: "q1", selectedOptionIds: ["b"], text: null },
        { questionId: "q2", selectedOptionIds: ["a", "b"], text: null },
        { questionId: "q3", selectedOptionIds: [], text: "<p>Make sure they're safe</p>" },
      ],
      80,
    );
    expect(s.percent).toBeNull();
    expect(s.passed).toBeNull();
    expect(s.pendingQuestionIds).toEqual(["q3"]);
    expect(s.choiceEarned).toBe(1);
    expect(s.choicePossible).toBe(3);
    expect(s.possible).toBe(7);
  });
  it("uses reviewer points once given and decides pass/fail", () => {
    const s = scoreAttempt(
      questions,
      [
        { questionId: "q1", selectedOptionIds: ["b"], text: null },
        { questionId: "q2", selectedOptionIds: ["a", "b", "d"], text: null },
        { questionId: "q3", selectedOptionIds: [], text: "<p>ok</p>", pointsAwarded: 1 },
        { questionId: "q4", selectedOptionIds: [], text: "<p>plan</p>", pointsAwarded: 1.5 },
      ],
      80,
    );
    expect(s.earned).toBe(5.5);
    expect(s.percent).toBe(78.6);
    expect(s.passed).toBe(false);
  });
  it("grades immediately when there is nothing to review", () => {
    const s = scoreAttempt([single, multi], [{ questionId: "q1", selectedOptionIds: ["b"], text: null }, { questionId: "q2", selectedOptionIds: ["a", "b", "d"], text: null }], 100);
    expect(s.percent).toBe(100);
    expect(s.passed).toBe(true);
  });
  it("counts exactly the passing score as a pass", () => {
    expect(passes(80, 80)).toBe(true);
    expect(passes(79.9, 80)).toBe(false);
    const fourOfFive = scoreAttempt(
      [1, 2, 3, 4, 5].map((i) => ({ id: `q${i}`, type: "SINGLE_CHOICE" as const, points: 1, correctOptionIds: ["a"] })),
      [1, 2, 3, 4].map((i) => ({ questionId: `q${i}`, selectedOptionIds: ["a"], text: null })),
      80,
    );
    expect(fourOfFive.passed).toBe(true);
  });
  it("clamps reviewer points to half steps within the question's max", () => {
    expect(clampPoints(2.3, 3)).toBe(2.5);
    expect(clampPoints(-1, 3)).toBe(0);
    expect(clampPoints(9, 3)).toBe(3);
    expect(clampPoints(Number.NaN, 3)).toBe(0);
  });
});

describe("stored JSON", () => {
  it("ignores malformed options and automations", () => {
    expect(parseOptions([{ id: "a", text: "Yes" }, { id: 3 }, null])).toEqual([{ id: "a", text: "Yes" }]);
    expect(parseOptions("nope")).toEqual([]);
    expect(
      parseAutomations([
        { trigger: "FAILED", action: "NOTIFY_TAKER" },
        { trigger: "FAILED", action: "NOTIFY_TAKER" },
        { trigger: "LATE", action: "NOTIFY_TAKER" },
        { trigger: "MISSED_DEADLINE", action: "CREATE_ADMIN_TASK" },
      ]),
    ).toEqual([
      { trigger: "FAILED", action: "NOTIFY_TAKER" },
      { trigger: "MISSED_DEADLINE", action: "CREATE_ADMIN_TASK" },
    ]);
  });
});

describe("automation choices", () => {
  it("offers club-changing steps only for club tests, after the results they fit", () => {
    expect(actionsFor("PASSED", "club")).toEqual(["NOTIFY_TAKER", "NOTIFY_ADVISOR", "NOTIFY_ADMINS", "CREATE_ADMIN_TASK", "APPROVE_JOIN_REQUEST", "RESUME_PERMISSIONS"]);
    expect(actionsFor("FAILED", "club")).toEqual(["NOTIFY_TAKER", "NOTIFY_ADVISOR", "NOTIFY_ADMINS", "CREATE_ADMIN_TASK", "PAUSE_PERMISSIONS"]);
    expect(actionsFor("MISSED_DEADLINE", "club")).toContain("PAUSE_PERMISSIONS");
    for (const t of ["PASSED", "FAILED", "MISSED_DEADLINE"] as const) {
      expect(actionsFor(t, "university")).toEqual(["NOTIFY_TAKER", "NOTIFY_ADVISOR", "NOTIFY_ADMINS", "CREATE_ADMIN_TASK"]);
    }
  });

  it("rejects automations that don't fit their trigger or scope", () => {
    expect(automationAllowed({ trigger: "PASSED", action: "APPROVE_JOIN_REQUEST" }, "club")).toBe(true);
    expect(automationAllowed({ trigger: "FAILED", action: "APPROVE_JOIN_REQUEST" }, "club")).toBe(false);
    expect(automationAllowed({ trigger: "PASSED", action: "PAUSE_PERMISSIONS" }, "club")).toBe(false);
    expect(automationAllowed({ trigger: "PASSED", action: "RESUME_PERMISSIONS" }, "university")).toBe(false);
    expect(automationAllowed({ trigger: "MISSED_DEADLINE", action: "NOTIFY_ADMINS" }, "university")).toBe(true);
  });
});

describe("forms", () => {
  it("list the questions still without an answer, in order", () => {
    const answers = [
      { questionId: "q1", selectedOptionIds: ["b"], text: null },
      { questionId: "q3", selectedOptionIds: [], text: "<p></p>" },
    ];
    expect(unansweredQuestionIds([single, multi, short, long], answers)).toEqual(["q2", "q3", "q4"]);
    expect(unansweredQuestionIds([single], answers)).toEqual([]);
  });

  it("can't be failed: no FAILED automations, and PASSED reads as submitting", () => {
    expect(triggersFor(true)).toEqual(["PASSED", "MISSED_DEADLINE"]);
    expect(automationAllowed({ trigger: "FAILED", action: "NOTIFY_TAKER" }, "university", true)).toBe(false);
    expect(automationAllowed({ trigger: "FAILED", action: "NOTIFY_TAKER" }, "university")).toBe(true);
    expect(automationAllowed({ trigger: "PASSED", action: "APPROVE_JOIN_REQUEST" }, "club", true)).toBe(true);
    expect(automationAllowed({ trigger: "MISSED_DEADLINE", action: "PAUSE_PERMISSIONS" }, "club", true)).toBe(true);
    expect(triggerLabel("PASSED", true)).toBe("When someone submits it");
    expect(triggerLabel("PASSED", false)).toBe("When someone passes");
    expect(defaultAutomations(true)).toEqual([]);
  });

  it("show as submitted, with no score", () => {
    expect(attemptLabel({ status: "GRADED", passed: true }, true)).toBe("Submitted");
    expect(attemptLabel({ status: "GRADED", passed: true })).toBe("Passed");
    expect(fmtPercent(null)).toBe("—");
  });
});
