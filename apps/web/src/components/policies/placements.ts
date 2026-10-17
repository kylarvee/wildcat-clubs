/**
 * Where a policy can appear, in plain words — shared by the admin editor and
 * the public library. Pure and client-safe. Placement order here is the
 * order the library groups policies in.
 */
import type { PolicyPlacement, PolicyStatus } from "@prisma/client";

export type PlacementInfo = { value: PolicyPlacement; label: string; where: string };

export const PLACEMENTS: PlacementInfo[] = [
  { value: "CLUB_CREATION", label: "Starting a club", where: "The Start a club wizard and a founding club's checklist." },
  { value: "MEMBERSHIP", label: "Joining a club", where: "Club pages before someone registers, and the members tool." },
  { value: "OFFICER_ROLES", label: "Officers & roles", where: "The org chart, promotions and elections." },
  { value: "EVENTS", label: "Events", where: "The Events Builder and the attendance tool." },
  { value: "FUNDING", label: "Funding & budgets", where: "Budget & funding and funding requests." },
  { value: "FILES", label: "Club files", where: "Club files." },
  { value: "MESSAGING", label: "Messages", where: "Messages." },
  { value: "REVIEWS", label: "Club reviews", where: "The review form on club pages and review moderation." },
  { value: "COMPLAINTS", label: "Reporting a concern", where: "The Report a concern form." },
  { value: "GENERAL", label: "General", where: "Only the policy library." },
];

export const PLACEMENT_LABEL = Object.fromEntries(PLACEMENTS.map((p) => [p.value, p.label])) as Record<PolicyPlacement, string>;

export const POLICY_STATUS_LABEL: Record<PolicyStatus, string> = { DRAFT: "Draft", PUBLISHED: "Published", ARCHIVED: "Archived" };
export const POLICY_STATUS_TONE = { DRAFT: "neutral", PUBLISHED: "success", ARCHIVED: "warning" } as const;

/** The group a policy is listed under in the library: its first placement in PLACEMENTS order (General last). */
export function primaryPlacement(placements: PolicyPlacement[]): PolicyPlacement {
  return PLACEMENTS.find((p) => placements.includes(p.value))?.value ?? "GENERAL";
}

/** "Event Safety & You!" → "event-safety-you". */
export function policySlug(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Policy documents admins may upload: PDF previews inline; Word shows as a download card. */
export const POLICY_DOC_ACCEPT = ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function isPolicyDocument(name: string, mimeType: string | null | undefined): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime === "application/pdf" || mime === "application/msword" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true;
  return /\.(pdf|docx?)$/i.test(name);
}
