import type { ClubCategory, ClubScope, ClubStatus, ClubType, JoinPolicy } from "@prisma/client";

/**
 * The words for a club's fields, in one place. Pure and client-safe (type
 * imports only), so server pages, client filters, PDFs, the mobile API and
 * the assistant all say the same thing.
 *
 * A club has two separate facts that read alike, so they never share words:
 *   - Recognition (Club.status): where the club's approval stands, with WSUSA
 *     or the office that oversees it (lib/offices) — "Approved", "In review",
 *     "Retired"…
 *   - Standing (lib/metrics): whether an approved club is meeting WSUSA's
 *     activity standard — "Active", "Pilot period" or "Inactive".
 * An approved club can be inactive, so a screen that shows both shows them
 * as two labelled facts, and green belongs to "Active" alone.
 */

/** Badge tones (the same set as components/ui/badge's Tone). */
export type LabelTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

// ─── Type ────────────────────────────────────────────────────────────────────

export const CLUB_TYPES: ClubType[] = ["SPONSORED", "AFFILIATE", "REGISTERED", "COLLEGE_AMBASSADORS"];

export const CLUB_TYPE_LABEL: Record<ClubType, string> = {
  SPONSORED: "Sponsored",
  AFFILIATE: "Affiliate",
  REGISTERED: "Registered",
  COLLEGE_AMBASSADORS: "College Ambassadors",
};

/** One line on what each type means: badge tooltips, the founding choices, the assistant. */
export const CLUB_TYPE_HINT: Record<ClubType, string> = {
  SPONSORED: "Backed by an academic department",
  AFFILIATE: "Connected to a university office, program or national organization",
  REGISTERED: "Independent and student-run, registered with WSUSA",
  COLLEGE_AMBASSADORS: "A college's student ambassador program, started by WSUSA",
};

export const CLUB_TYPE_TONE: Record<ClubType, LabelTone> = {
  SPONSORED: "brand",
  AFFILIATE: "info",
  REGISTERED: "neutral",
  COLLEGE_AMBASSADORS: "success",
};

// ─── Scope (where a club sits) ───────────────────────────────────────────────

export const CLUB_SCOPES: ClubScope[] = ["COLLEGE", "UNIVERSITY", "INDEPENDENT", "SPORTS"];

export const CLUB_SCOPE_LABEL: Record<ClubScope, string> = {
  COLLEGE: "College",
  UNIVERSITY: "University-wide",
  INDEPENDENT: "Independent",
  SPORTS: "Sports",
};

export const CLUB_SCOPE_HINT: Record<ClubScope, string> = {
  COLLEGE: "Belongs to one of WSU's colleges",
  UNIVERSITY: "For students across every college",
  INDEPENDENT: "Not tied to a college",
  SPORTS: "Club sports and recreation",
};

// ─── Category (WSUSA's sub-categories; the type is separate) ─────────────────

export const CLUB_CATEGORY_LABEL: Record<ClubCategory, string> = {
  ACADEMIC: "Academic",
  CULTURAL: "Cultural",
  FSL: "Fraternity & Sorority Life",
  HONOR_SOCIETY: "Honor society",
  SERVICE_ADVOCACY: "Service & advocacy",
  STUDENT_LIFE: "Student life & special interest",
  RELIGIOUS: "Religious",
};

export const CLUB_CATEGORIES = Object.keys(CLUB_CATEGORY_LABEL) as ClubCategory[];

// ─── Join policy ─────────────────────────────────────────────────────────────

export const JOIN_POLICY_LABEL: Record<JoinPolicy, string> = {
  OPEN: "Open: anyone can join",
  APPROVAL: "Approval: leaders approve each request",
};

/** The policy's name alone, for "Joining: Open → Approval". */
export const JOIN_POLICY_SHORT: Record<JoinPolicy, string> = { OPEN: "Open", APPROVAL: "Approval" };

// ─── Recognition (Club.status) ───────────────────────────────────────────────

export const CLUB_STATUS_LABEL: Record<ClubStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "In review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  REJECTED: "Not approved",
  RETIRED: "Retired",
};

/** Approved is brand, not green: green means "Active" standing, which an approved club may not have. */
export const CLUB_STATUS_TONE = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  CHANGES_REQUESTED: "warning",
  APPROVED: "brand",
  REJECTED: "danger",
  RETIRED: "neutral",
} as const satisfies Record<ClubStatus, LabelTone>;

// ─── Standing (lib/metrics, approved clubs only) ─────────────────────────────

export type ClubStanding = "active" | "pilot" | "inactive";

export const CLUB_STANDINGS: ClubStanding[] = ["active", "pilot", "inactive"];

export const STANDING_LABEL: Record<ClubStanding, string> = {
  active: "Active",
  pilot: "Pilot period",
  inactive: "Inactive",
};

export const STANDING_TONE = {
  active: "success",
  pilot: "info",
  inactive: "warning",
} as const satisfies Record<ClubStanding, LabelTone>;

export const STANDING_HINT: Record<ClubStanding, string> = {
  active: "Meeting WSUSA's activity standard",
  pilot: "A new club, counted as active until its pilot period ends",
  inactive: "Below WSUSA's activity standard",
};

/**
 * Standing from lib/metrics' ClubActivity (or ClubListMetrics). A club in its
 * pilot period counts as active there, so the pilot check comes first.
 */
export function standingOf(a: { inPilot: boolean } & ({ active: boolean } | { isActive: boolean })): ClubStanding {
  if (a.inPilot) return "pilot";
  return ("active" in a ? a.active : a.isActive) ? "active" : "inactive";
}
