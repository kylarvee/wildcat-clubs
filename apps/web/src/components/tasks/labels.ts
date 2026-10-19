import type { TaskKind } from "@prisma/client";
import type { Tone } from "@/components/ui/badge";

/**
 * Task Manager wording, shared by /tasks and the dashboard widget. Pure and
 * client-safe.
 */

export const KIND_ORDER: TaskKind[] = ["APPROVAL", "REQUIREMENT", "TEST", "INVOICE", "CLUB", "PERSONAL"];

export const KIND_LABEL: Record<TaskKind, string> = {
  APPROVAL: "Approval",
  REQUIREMENT: "Requirement",
  TEST: "Test",
  INVOICE: "Invoice",
  CLUB: "Club task",
  PERSONAL: "Personal",
};

/** A task's kind as its badge says it: a test a club assigned is a "Club test" (or "Club form"). */
export function taskKindLabel(t: { kind: TaskKind; title: string; club: unknown }): string {
  if (t.kind !== "TEST") return KIND_LABEL[t.kind];
  // tests.syncAssignments titles a form's task "Fill out: …" and a test's "Take: …".
  const noun = t.title.startsWith("Fill out: ") ? "form" : "test";
  return t.club ? `Club ${noun}` : noun === "form" ? "Form" : KIND_LABEL.TEST;
}

/** Filter chips read as plurals: "Approvals (3)". */
export const KIND_PLURAL: Record<TaskKind, string> = {
  APPROVAL: "Approvals",
  REQUIREMENT: "Requirements",
  TEST: "Tests",
  INVOICE: "Invoices",
  CLUB: "Club",
  PERSONAL: "Personal",
};

export const KIND_TONE: Record<TaskKind, Tone> = {
  APPROVAL: "warning",
  REQUIREMENT: "danger",
  TEST: "info",
  INVOICE: "info",
  CLUB: "brand",
  PERSONAL: "neutral",
};

/** Why there's no checkbox: these close when the underlying thing is done. */
export const SELF_CLOSING_NOTE: Partial<Record<TaskKind, string>> = {
  APPROVAL: "Closes on its own once a decision is made — open it to approve or decline.",
  REQUIREMENT: "Closes on its own once it's done: you pass the test, submit the form, check in at the training, confirm your details or renew your club.",
  TEST: "Closes on its own once you pass the test or submit the form.",
  INVOICE: "Closes on its own when the invoice is marked processed.",
};

/** The note on a test that's handed in on time and waiting for a grader. */
export const AWAITING_GRADE_NOTE = "You handed it in on time, so it isn't late while it waits. It closes once it's graded as passed.";

export const SELF_CLOSING: TaskKind[] = ["APPROVAL", "REQUIREMENT", "TEST", "INVOICE"];

/** The badge on tasks WSUSA requires (it replaces the kind badge). */
export const REQUIRED_LABEL = "Required by WSUSA";

export function isKind(v: string | undefined | null): v is TaskKind {
  return KIND_ORDER.includes(v as TaskKind);
}
