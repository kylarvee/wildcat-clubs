import type { TestStatus } from "@prisma/client";
import { CheckCircle2, Clock, FileText, Hourglass, MinusCircle, PlayCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL } from "@/lib/tests/types";

/** Status pills for the Test Tool. Every one carries an icon and a word, never color alone. */

export function TestStatusBadge({ status }: { status: TestStatus }) {
  const tone = status === "PUBLISHED" ? "success" : status === "ARCHIVED" ? "warning" : "neutral";
  return <Badge tone={tone}>{STATUS_LABEL[status]}</Badge>;
}

/** Marks a form (a test with grading switched off) wherever tests and forms are listed together. */
export function FormBadge() {
  return (
    <Badge tone="info">
      <FileText className="h-3 w-3" aria-hidden /> Form
    </Badge>
  );
}

export type ResultStatus = "not-started" | "in-progress" | "needs-review" | "passed" | "failed" | "missed" | "excused" | "todo";

/** `form` words a result for a form: a pass is "Submitted", not starting is "Not yet". */
export function ResultBadge({ status, form = false }: { status: ResultStatus; form?: boolean }) {
  switch (status) {
    case "passed":
      return (
        <Badge tone="success">
          <CheckCircle2 className="h-3 w-3" aria-hidden /> {form ? "Submitted" : "Passed"}
        </Badge>
      );
    case "failed":
      return (
        <Badge tone="danger">
          <XCircle className="h-3 w-3" aria-hidden /> Not passed
        </Badge>
      );
    case "needs-review":
      return (
        <Badge tone="info">
          <Hourglass className="h-3 w-3" aria-hidden /> Waiting for review
        </Badge>
      );
    case "in-progress":
      return (
        <Badge tone="brand">
          <PlayCircle className="h-3 w-3" aria-hidden /> In progress
        </Badge>
      );
    case "missed":
      return (
        <Badge tone="warning">
          <Clock className="h-3 w-3" aria-hidden /> Missed deadline
        </Badge>
      );
    case "excused":
      return (
        <Badge>
          <MinusCircle className="h-3 w-3" aria-hidden /> Excused
        </Badge>
      );
    case "todo":
      return (
        <Badge tone="brand">
          <Clock className="h-3 w-3" aria-hidden /> To do
        </Badge>
      );
    default:
      return (
        <Badge>
          <MinusCircle className="h-3 w-3" aria-hidden /> {form ? "Not yet" : "Not started"}
        </Badge>
      );
  }
}
