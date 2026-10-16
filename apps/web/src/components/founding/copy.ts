import type { ClubScope, ClubStatus, ClubType, JoinPolicy, SuccessionMethod } from "@prisma/client";

/** Founding-flow wording and choices, shared by server pages and client forms. */

export type FoundingType = Exclude<ClubType, "COLLEGE_AMBASSADORS">;

export const CLUB_TYPES: { value: FoundingType; label: string; tagline: string; points: string[]; department: "required" | "optional" | "none" }[] = [
  {
    value: "SPONSORED",
    label: "Sponsored",
    tagline: "Tied to an academic department",
    points: ["Your club grows out of a WSU department or program", "You'll choose the sponsoring department (required)", "Funding requests default to the department"],
    department: "required",
  },
  {
    value: "AFFILIATE",
    label: "Affiliate",
    tagline: "Connected to a department or national organization",
    points: ["A local chapter, or partnered with a department", "Department is optional — add one if you have it", "You can name your national organization in the constitution"],
    department: "optional",
  },
  {
    value: "REGISTERED",
    label: "Registered",
    tagline: "An independent student club recognized by WSUSA",
    points: ["Students with a shared interest, no department needed", "Recognized and supported by WSUSA", "Funding requests default to WSUSA"],
    department: "none",
  },
];

export const TYPE_LABEL: Record<ClubType, string> = { SPONSORED: "Sponsored", AFFILIATE: "Affiliate", REGISTERED: "Registered", COLLEGE_AMBASSADORS: "College Ambassadors" };

export const SCOPES: { value: ClubScope; label: string; hint: string }[] = [
  { value: "COLLEGE", label: "College", hint: "Belongs to one of WSU's colleges" },
  { value: "UNIVERSITY", label: "University-wide", hint: "For students across every college" },
  { value: "INDEPENDENT", label: "Independent", hint: "Not tied to a college" },
  { value: "SPORTS", label: "Sports", hint: "Club sports and recreation" },
];

export const SCOPE_LABEL: Record<ClubScope, string> = { COLLEGE: "College", UNIVERSITY: "University-wide", INDEPENDENT: "Independent", SPORTS: "Sports" };

export const STATUS_LABEL: Record<ClubStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "In WSUSA review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Active",
  REJECTED: "Not approved",
  RETIRED: "Retired",
};

export const STATUS_TONE = { DRAFT: "neutral", SUBMITTED: "info", CHANGES_REQUESTED: "warning", APPROVED: "success", REJECTED: "danger", RETIRED: "neutral" } as const;

export const JOIN_LABEL: Record<JoinPolicy, string> = { OPEN: "Open — anyone who registers is a member", APPROVAL: "Leader approval — leaders review each request" };
export const SUCCESSION_LABEL: Record<SuccessionMethod, string> = { SENIORITY: "Seniority — the President names their successor", MEMBER_VOTE: "Member vote — active members elect leaders", LEADERSHIP_VOTE: "Leadership vote — leaders vote for each other, never themselves" };

/** Curated club colors: Weber purple first, then tones that hold white text at AA contrast. */
export const LOGO_PALETTE: { value: string; name: string }[] = [
  { value: "#492365", name: "Weber purple" },
  { value: "#6d28d9", name: "Violet" },
  { value: "#1d4ed8", name: "Royal blue" },
  { value: "#0e7490", name: "Teal" },
  { value: "#0f766e", name: "Pine" },
  { value: "#4d7c0f", name: "Olive" },
  { value: "#b45309", name: "Amber" },
  { value: "#c2410c", name: "Burnt orange" },
  { value: "#be123c", name: "Crimson" },
  { value: "#a21caf", name: "Magenta" },
  { value: "#334155", name: "Slate" },
  { value: "#17131c", name: "Night" },
];
