import type { TaskKind } from "@prisma/client";
import type { Tone } from "@/components/ui/badge";

/**
 * Task Manager wording, shared by /tasks and the dashboard widget. Pure and
 * client-safe.
 */

export const KIND_ORDER: TaskKind[] = ["APPROVAL", "REQUIREMENT", "INVOICE", "CLUB", "PERSONAL"];

export const KIND_LABEL: Record<TaskKind, string> = {
  APPROVAL: "Approval",
  REQUIREMENT: "Requirement",
  INVOICE: "Invoice",
  CLUB: "Club task",
  PERSONAL: "Personal",
};

/** Filter chips read as plurals: "Approvals (3)". */
export const KIND_PLURAL: Record<TaskKind, string> = {
  APPROVAL: "Approvals",
  REQUIREMENT: "Requirements",
  INVOICE: "Invoices",
  CLUB: "Club",
  PERSONAL: "Personal",
};

export const KIND_TONE: Record<TaskKind, Tone> = {
  APPROVAL: "warning",
  REQUIREMENT: "danger",
  INVOICE: "info",
  CLUB: "brand",
  PERSONAL: "neutral",
};

/** Why there's no checkbox: these close when the underlying thing is done. */
export const SELF_CLOSING_NOTE: Partial<Record<TaskKind, string>> = {
  APPROVAL: "Closes on its own once a decision is made — open it to approve or decline.",
  REQUIREMENT: "Closes on its own when you pass the test or check in at the training.",
  INVOICE: "Closes on its own when the invoice is marked processed.",
};

export const SELF_CLOSING: TaskKind[] = ["APPROVAL", "REQUIREMENT", "INVOICE"];

export function isKind(v: string | undefined | null): v is TaskKind {
  return KIND_ORDER.includes(v as TaskKind);
}
