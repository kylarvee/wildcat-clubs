import type { ComplaintStatus } from "@prisma/client";
import type { Tone } from "@/components/ui/badge";

/**
 * Wording for reports (complaints), shared by the report form, the status
 * lookup and the admin tool. Client-safe: no server imports.
 */

/** The categories a reporter picks from. Stored as the label text. */
export const COMPLAINT_CATEGORIES = [
  { value: "Hazing", hint: "Pressure, humiliation or risky “initiation” to join or stay in a club." },
  { value: "Discrimination or harassment", hint: "Treatment based on who someone is, or unwanted, repeated conduct." },
  { value: "Misuse of funds", hint: "Club or university money spent in ways it shouldn't be." },
  { value: "Safety", hint: "Unsafe events, spaces, travel or behavior." },
  { value: "Review bombing", hint: "People organizing to post unfair reviews of a club." },
  { value: "Other policy violation", hint: "Anything else that breaks WSU or WSUSA policy." },
] as const;

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number]["value"];

export const COMPLAINT_STATUS_LABEL: Record<ComplaintStatus, string> = {
  NEW: "New",
  IN_REVIEW: "In review",
  REFERRED: "Referred",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export const COMPLAINT_STATUS_TONE: Record<ComplaintStatus, Tone> = {
  NEW: "brand",
  IN_REVIEW: "info",
  REFERRED: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
};

/** What each status means, in words a reporter understands. */
export const COMPLAINT_STATUS_HELP: Record<ComplaintStatus, string> = {
  NEW: "We received it. A WSUSA administrator will pick it up soon.",
  IN_REVIEW: "A WSUSA administrator is looking into it.",
  REFERRED: "It was passed to the university office responsible for this kind of concern, as WSU policy requires.",
  RESOLVED: "Administrators looked into it and addressed the concern.",
  CLOSED: "It was closed without further action — for example, it was a duplicate or outside WSUSA's scope.",
};

/** Statuses an admin can move a report to. A report never goes back to New. */
export const COMPLAINT_STATUS_CHOICES: ComplaintStatus[] = ["IN_REVIEW", "REFERRED", "RESOLVED", "CLOSED"];

export const OPEN_COMPLAINT_STATUSES: ComplaintStatus[] = ["NEW", "IN_REVIEW", "REFERRED"];

/** The notice an admin acknowledges every time before an anonymous report opens. */
export const ANONYMITY_NOTICE =
  "This report is anonymous. Its contents may not be shared outside university administrators and the proper authorities under WSU policy. Do not try to identify the reporter.";

/** Case codes look like WC-7KQ2-48. Accepts lower case, spaces and missing dashes. */
export function normalizeCaseCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^WC[A-Z0-9]{4}\d{2}$/.test(raw)) return null;
  return `WC-${raw.slice(2, 6)}-${raw.slice(6)}`;
}
