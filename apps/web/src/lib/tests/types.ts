/**
 * Test Tool vocabulary — pure and client-safe. The schema stores choice
 * options and automations as JSON; these helpers are the one place that
 * reads them, so a malformed row can't break a page.
 */
import type { QuestionType, RenewalPeriod, TestAudience, TestRecurrence, TestStatus } from "@prisma/client";

export type QuestionOption = { id: string; text: string };

export const AUTOMATION_TRIGGERS = ["PASSED", "FAILED", "MISSED_DEADLINE"] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_ACTIONS = ["NOTIFY_TAKER", "NOTIFY_ADVISOR", "NOTIFY_ADMINS", "CREATE_ADMIN_TASK"] as const;
export type AutomationAction = (typeof AUTOMATION_ACTIONS)[number];

export type Automation = { trigger: AutomationTrigger; action: AutomationAction };

/** New tests start with the one automation nearly everyone wants: tell people who didn't pass how to retake. */
export const DEFAULT_AUTOMATIONS: Automation[] = [{ trigger: "FAILED", action: "NOTIFY_TAKER" }];

export function parseOptions(json: unknown): QuestionOption[] {
  if (!Array.isArray(json)) return [];
  const out: QuestionOption[] = [];
  for (const o of json) {
    if (o && typeof o === "object" && typeof (o as QuestionOption).id === "string" && typeof (o as QuestionOption).text === "string") {
      out.push({ id: (o as QuestionOption).id, text: (o as QuestionOption).text });
    }
  }
  return out;
}

export function parseAutomations(json: unknown): Automation[] {
  if (!Array.isArray(json)) return [];
  const seen = new Set<string>();
  const out: Automation[] = [];
  for (const a of json) {
    if (!a || typeof a !== "object") continue;
    const { trigger, action } = a as Record<string, unknown>;
    if (!AUTOMATION_TRIGGERS.includes(trigger as AutomationTrigger) || !AUTOMATION_ACTIONS.includes(action as AutomationAction)) continue;
    const key = `${trigger}:${action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ trigger: trigger as AutomationTrigger, action: action as AutomationAction });
  }
  return out;
}

export const isChoice = (t: QuestionType) => t === "SINGLE_CHOICE" || t === "MULTI_CHOICE";
export const isOpen = (t: QuestionType) => t === "SHORT_ANSWER" || t === "LONG_ANSWER";

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  SINGLE_CHOICE: "Multiple choice — one answer",
  MULTI_CHOICE: "Multiple choice — several answers",
  SHORT_ANSWER: "Short answer",
  LONG_ANSWER: "Long answer",
};

export const QUESTION_TYPE_SHORT: Record<QuestionType, string> = {
  SINGLE_CHOICE: "One answer",
  MULTI_CHOICE: "Several answers",
  SHORT_ANSWER: "Short answer",
  LONG_ANSWER: "Long answer",
};

export const STATUS_LABEL: Record<TestStatus, string> = { DRAFT: "Draft", PUBLISHED: "Published", ARCHIVED: "Archived" };
export const STATUS_TONE = { DRAFT: "neutral", PUBLISHED: "success", ARCHIVED: "neutral" } as const;

export const RECURRENCE_LABEL: Record<TestRecurrence, string> = {
  ONE_OFF: "One time",
  WEEKLY: "Every week",
  MONTHLY: "Every month",
  SEMESTER: "Every semester",
  ACADEMIC_YEAR: "Every academic year",
  ANNUAL: "Every calendar year",
};

/** How an officer requirement renews (and so how often its test comes back). */
export const RENEWAL_LABEL: Record<RenewalPeriod, string> = {
  NONE: "Once — never renews",
  SEMESTER: "Every semester",
  ACADEMIC_YEAR: "Every academic year",
  ANNUAL: "Every calendar year",
};

/** Audiences each kind of test may use. Clubs assign to their own people; WSUSA can assign campus-wide. */
export const UNIVERSITY_AUDIENCES: TestAudience[] = ["ROLE_REQUIREMENT", "ALL_STUDENTS", "SELECTED_USERS", "OPEN"];
export const CLUB_AUDIENCES: TestAudience[] = ["CLUB_MEMBERS", "SELECTED_USERS", "OPEN"];

export function audienceLabel(a: TestAudience, scope: "club" | "university"): string {
  switch (a) {
    case "ROLE_REQUIREMENT":
      return "Student leaders (officer requirement)";
    case "CLUB_MEMBERS":
      return "Everyone in the club";
    case "ALL_STUDENTS":
      return "Every Weber State student";
    case "SELECTED_USERS":
      return scope === "club" ? "Members I choose" : "People I choose";
    case "OPEN":
      return "Anyone who wants to take it";
  }
}

export function audienceDescription(a: TestAudience, scope: "club" | "university"): string {
  switch (a) {
    case "ROLE_REQUIREMENT":
      return "Officers, VPs and presidents take it when an officer requirement uses this test. Passing meets the requirement; missing the deadline pauses their leadership permissions.";
    case "CLUB_MEMBERS":
      return "Every active member gets it as a task, including people who join later.";
    case "ALL_STUDENTS":
      return "Every active student account gets it as a task.";
    case "SELECTED_USERS":
      return scope === "club" ? "Only the members you pick get it as a task." : "Only the people you pick get it as a task.";
    case "OPEN":
      return "Nobody is assigned. Anyone signed in with a Weber State account can take it from the link.";
  }
}

/** Assigned audiences create a task per person; OPEN and requirement tests don't. */
export const ASSIGNED_AUDIENCES: TestAudience[] = ["CLUB_MEMBERS", "ALL_STUDENTS", "SELECTED_USERS"];

export const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  PASSED: "When someone passes",
  FAILED: "When someone doesn't pass",
  MISSED_DEADLINE: "When someone misses the deadline",
};

export function actionLabel(a: AutomationAction, scope: "club" | "university"): string {
  switch (a) {
    case "NOTIFY_TAKER":
      return "Tell the person who took it";
    case "NOTIFY_ADVISOR":
      return scope === "club" ? "Tell the club's advisors" : "Tell the advisors of their clubs";
    case "NOTIFY_ADMINS":
      return scope === "club" ? "Tell leaders who manage club tests" : "Tell WSUSA administrators";
    case "CREATE_ADMIN_TASK":
      return scope === "club" ? "Add a follow-up task for club leaders" : "Add a follow-up task for WSUSA administrators";
  }
}

export type AttemptStatusLabel = "In progress" | "Waiting for review" | "Passed" | "Not passed";

export function attemptLabel(a: { status: "IN_PROGRESS" | "NEEDS_REVIEW" | "GRADED"; passed: boolean | null }): AttemptStatusLabel {
  if (a.status === "IN_PROGRESS") return "In progress";
  if (a.status === "NEEDS_REVIEW") return "Waiting for review";
  return a.passed ? "Passed" : "Not passed";
}

export function fmtPercent(p: number | null | undefined, digits = 0): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  return `${p.toFixed(digits)}%`;
}

export function fmtPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
