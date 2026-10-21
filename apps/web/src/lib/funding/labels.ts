import type { FundingSource, FundingStatus, InvoiceStatus } from "@prisma/client";
import { FUNDING_LABEL, FUNDING_SOURCES } from "@/lib/events/labels";

/** Words people see for funding enums. Client-safe. */

/** The order sources appear in, everywhere (ARCHITECTURE.md §6: one list): University, WSUSA, College, Department. */
export const SOURCE_ORDER: FundingSource[] = FUNDING_SOURCES;

export const FUNDING_STATUS_LABEL: Record<FundingStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "In review",
  APPROVED: "Approved",
  PARTIALLY_APPROVED: "Partly approved",
  DENIED: "Not approved",
  WITHDRAWN: "Withdrawn",
};

export const FUNDING_STATUS_TONE = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  PARTIALLY_APPROVED: "warning",
  DENIED: "danger",
  WITHDRAWN: "neutral",
} as const satisfies Record<FundingStatus, "neutral" | "info" | "success" | "warning" | "danger" | "brand">;

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = { OPEN: "Open", PROCESSED: "Processed" };

export type SourceContext = { department?: { name: string } | null; college?: { name: string } | null };

/** "WSUSA", "Department · Mechanical Engineering", "College · Engineering, Applied Science & Technology". */
export function sourceName(source: FundingSource, club?: SourceContext | null): string {
  if (source === "DEPARTMENT" && club?.department?.name) return `Department · ${club.department.name}`;
  if (source === "COLLEGE" && club?.college?.name) return `College · ${club.college.name}`;
  if (source === "UNIVERSITY") return "Weber State University";
  return FUNDING_LABEL[source];
}

/** Short form for tight spots (badges, table cells). */
export function sourceShort(source: FundingSource): string {
  return FUNDING_LABEL[source];
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Display names for every source, for one club ("Department · Nursing"). */
export function sourceNames(club?: SourceContext | null): Record<FundingSource, string> {
  return { UNIVERSITY: sourceName("UNIVERSITY", club), WSUSA: sourceName("WSUSA", club), COLLEGE: sourceName("COLLEGE", club), DEPARTMENT: sourceName("DEPARTMENT", club) };
}
