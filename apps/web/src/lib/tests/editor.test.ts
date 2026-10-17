import { describe, expect, it } from "vitest";
import { blankQuestion, changeQuestionType, nextOptionId, testProblems, totalPoints, type EditorTest } from "@/lib/tests/editor";

const base = (over: Partial<EditorTest> = {}): EditorTest => ({
  title: "Event Safety Quiz",
  introHtml: "",
  timeLimitMinutes: 15,
  passingPercent: 80,
  maxAttempts: 3,
  audience: "CLUB_MEMBERS",
  selectedUserIds: [],
  recurrence: "ONE_OFF",
  dueDays: 30,
  closesAt: null,
  automations: [],
  questions: [
    {
      id: "q1",
      type: "SINGLE_CHOICE",
      promptHtml: "<p>Who approves alcohol at events?</p>",
      options: [
        { id: "a", text: "Nobody — it isn't allowed" },
        { id: "b", text: "The club president" },
      ],
      correctOptionIds: ["a"],
      modelAnswer: "",
      points: 1,
      answerCount: 0,
    },
  ],
  ...over,
});

describe("publish checks", () => {
  it("passes a complete test", () => {
    expect(testProblems(base(), "club")).toEqual([]);
  });

  it("keeps clubs to club audiences and WSUSA to university ones", () => {
    expect(testProblems(base({ audience: "ALL_STUDENTS" }), "club").map((p) => p.field)).toContain("audience");
    expect(testProblems(base({ audience: "CLUB_MEMBERS" }), "university").map((p) => p.field)).toContain("audience");
    expect(testProblems(base({ audience: "ROLE_REQUIREMENT" }), "university")).toEqual([]);
  });

  it("needs people for a chosen-people audience", () => {
    expect(testProblems(base({ audience: "SELECTED_USERS" }), "club").map((p) => p.field)).toContain("audience");
    expect(testProblems(base({ audience: "SELECTED_USERS", selectedUserIds: ["u1"] }), "club")).toEqual([]);
  });

  it("checks timing and scoring bounds", () => {
    const fields = testProblems(base({ timeLimitMinutes: 0, passingPercent: 0, maxAttempts: 0, recurrence: "WEEKLY", dueDays: 0 }), "club").map((p) => p.field);
    expect(fields).toEqual(expect.arrayContaining(["timeLimit", "passing", "attempts", "due"]));
  });

  it("requires exactly one correct answer for single choice, and a wrong option for multi choice", () => {
    const q = base().questions[0];
    expect(testProblems(base({ questions: [{ ...q, correctOptionIds: [] }] }), "club").map((p) => p.field)).toContain("correct");
    const multi = { ...q, type: "MULTI_CHOICE" as const, correctOptionIds: ["a", "b"] };
    expect(testProblems(base({ questions: [multi] }), "club").map((p) => p.field)).toContain("correct");
    expect(testProblems(base({ questions: [{ ...multi, correctOptionIds: ["a"] }] }), "club")).toEqual([]);
  });

  it("needs a model answer for written questions and a prompt for every question", () => {
    const open = { ...blankQuestion("SHORT_ANSWER", "new-1"), promptHtml: "<p>Who do you call for an emergency on campus?</p>" };
    expect(testProblems(base({ questions: [open] }), "club").map((p) => p.field)).toContain("model");
    expect(testProblems(base({ questions: [{ ...open, modelAnswer: "WSU Police" }] }), "club")).toEqual([]);
    expect(testProblems(base({ questions: [{ ...open, promptHtml: "<p></p>", modelAnswer: "x" }] }), "club").map((p) => p.field)).toContain("prompt");
  });

  it("flags blank answer choices", () => {
    const q = base().questions[0];
    const problems = testProblems(base({ questions: [{ ...q, options: [...q.options, { id: "c", text: "  " }] }] }), "club");
    expect(problems.map((p) => p.field)).toContain("options");
  });

  it("totals points", () => {
    expect(totalPoints(base({ questions: [{ ...base().questions[0], points: 3 }, { ...base().questions[0], id: "q2", points: 2 }] }))).toBe(5);
  });
});

describe("editing questions", () => {
  it("keeps choices when switching between choice types, trimming to one correct answer", () => {
    const multi = { ...blankQuestion("MULTI_CHOICE", "q"), correctOptionIds: ["a", "b"] };
    const single = changeQuestionType(multi, "SINGLE_CHOICE");
    expect(single.options).toHaveLength(2);
    expect(single.correctOptionIds).toEqual(["a"]);
  });

  it("drops choices when switching to a written answer", () => {
    const open = changeQuestionType(blankQuestion("SINGLE_CHOICE", "q"), "LONG_ANSWER");
    expect(open.options).toEqual([]);
    expect(open.correctOptionIds).toEqual([]);
  });

  it("hands out the next free option id", () => {
    expect(nextOptionId(["a", "b"])).toBe("c");
    expect(nextOptionId(["a", "c"])).toBe("b");
    expect(nextOptionId("abcdefghijklmnopqrstuvwxyz".split(""))).toBe("o27");
  });
});
