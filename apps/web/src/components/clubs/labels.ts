import type { ClubScope, ClubType, EventKind, JoinPolicy } from "@prisma/client";
import type { Tone } from "@/components/ui/badge";

/**
 * Plain-language labels for club fields. Shared by server pages and client
 * filters, so this module must stay free of server-only imports.
 */

export const CLUB_TYPES: ClubType[] = ["SPONSORED", "AFFILIATE", "REGISTERED", "COLLEGE_AMBASSADORS"];
export const CLUB_SCOPES: ClubScope[] = ["COLLEGE", "UNIVERSITY", "INDEPENDENT", "SPORTS"];

export const CLUB_TYPE_LABEL: Record<ClubType, string> = {
  SPONSORED: "Sponsored",
  AFFILIATE: "Affiliate",
  REGISTERED: "Registered",
  COLLEGE_AMBASSADORS: "College Ambassadors",
};

export const CLUB_TYPE_HINT: Record<ClubType, string> = {
  SPONSORED: "Backed by an academic department",
  AFFILIATE: "Tied to a university office or program",
  REGISTERED: "Student-run and registered with WSUSA",
  COLLEGE_AMBASSADORS: "A college's student ambassador team",
};

export const CLUB_TYPE_TONE: Record<ClubType, Tone> = {
  SPONSORED: "brand",
  AFFILIATE: "info",
  REGISTERED: "neutral",
  COLLEGE_AMBASSADORS: "success",
};

export const CLUB_SCOPE_LABEL: Record<ClubScope, string> = {
  COLLEGE: "College",
  UNIVERSITY: "University-wide",
  INDEPENDENT: "Independent",
  SPORTS: "Sports",
};

export const JOIN_POLICY_LABEL: Record<JoinPolicy, string> = {
  OPEN: "Open — anyone can register",
  APPROVAL: "Leaders approve new members",
};

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  MEETING: "Meeting",
  SOCIAL: "Social",
  WORKSHOP: "Workshop",
  SERVICE: "Service",
  COMPETITION: "Competition",
  FUNDRAISER: "Fundraiser",
  TRAINING: "Training",
  OTHER: "Event",
};

/** Club colors come from the database; only trust a plain 6-digit hex in inline styles. */
export function safeHex(color: string | null | undefined, fallback = "#492365") {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

export function pct(rate: number | null | undefined) {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
