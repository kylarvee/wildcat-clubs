import type { ClubScope, ClubType, SuccessionMethod } from "@prisma/client";
import { SUCCESSION_LABEL as ROLE_SUCCESSION_LABEL } from "@/lib/roles/labels";
import { CLUB_SCOPE_HINT, CLUB_SCOPE_LABEL, CLUB_SCOPES, CLUB_STATUS_LABEL, CLUB_STATUS_TONE, CLUB_TYPE_HINT, CLUB_TYPE_LABEL, JOIN_POLICY_LABEL } from "@/lib/labels/clubs";

/**
 * Founding-flow wording and choices, shared by server pages and client forms.
 * Club field labels come from lib/labels/clubs; the names below are the ones
 * founding code has always imported.
 */

export type FoundingType = Exclude<ClubType, "COLLEGE_AMBASSADORS">;

const typeChoice = (value: FoundingType, points: string[], department: "required" | "optional" | "none") => ({
  value,
  label: CLUB_TYPE_LABEL[value],
  tagline: CLUB_TYPE_HINT[value],
  points,
  department,
});

/** The three types a club can be founded as (College Ambassadors programs are started by WSUSA). */
export const FOUNDING_TYPES: { value: FoundingType; label: string; tagline: string; points: string[]; department: "required" | "optional" | "none" }[] = [
  typeChoice("SPONSORED", ["Your club grows out of a WSU department or program", "You'll choose the sponsoring department (required)", "Funding requests default to the department"], "required"),
  typeChoice("AFFILIATE", ["A local chapter, or partnered with a department", "Department is optional — add one if you have it", "You can name your national organization in the constitution"], "optional"),
  typeChoice("REGISTERED", ["Students with a shared interest, no department needed", "Recognized and supported by WSUSA", "Funding requests default to WSUSA"], "none"),
];

export const TYPE_LABEL = CLUB_TYPE_LABEL;

export const SCOPES: { value: ClubScope; label: string; hint: string }[] = CLUB_SCOPES.map((value) => ({ value, label: CLUB_SCOPE_LABEL[value], hint: CLUB_SCOPE_HINT[value] }));

export const SCOPE_LABEL = CLUB_SCOPE_LABEL;

/** Recognition: where WSUSA's approval stands (not the activity standing). */
export const STATUS_LABEL = CLUB_STATUS_LABEL;

export const STATUS_TONE = CLUB_STATUS_TONE;

export const JOIN_LABEL = JOIN_POLICY_LABEL;
/** The four ways to fill a seat — one wording everywhere (lib/roles/labels). */
export const SUCCESSION_LABEL: Record<SuccessionMethod, string> = ROLE_SUCCESSION_LABEL;

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
