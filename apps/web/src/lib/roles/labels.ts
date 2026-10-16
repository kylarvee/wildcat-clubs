import type { ClubRole, ElectionStatus, RoleEndReason, SuccessionMethod } from "@prisma/client";

/**
 * Plain-language labels for roles, end reasons and elections. Client-safe (no
 * server imports) so dialogs and tables can share them with server pages.
 * Role *names* still come from lib/authz ROLE_LABEL on the server; these are
 * the extra words around them.
 */

export const END_REASON_LABEL: Record<RoleEndReason, string> = {
  SUCCEEDED: "Handed off",
  RESIGNED: "Stepped down",
  GRADUATED: "Graduated",
  REMOVED: "Removed",
  TERM_ENDED: "Term ended",
  CLUB_RETIRED: "Club retired",
};

/** Reasons a leader can pick when ending someone's role by hand. */
export const MANUAL_END_REASONS: RoleEndReason[] = ["RESIGNED", "TERM_ENDED", "GRADUATED", "REMOVED"];

/** Org chart tiers, top to bottom. */
export const TIERS: { key: string; roles: ClubRole[]; label: string; plural: string }[] = [
  { key: "president", roles: ["PRESIDENT"], label: "President", plural: "Presidents" },
  { key: "vp", roles: ["VP"], label: "Vice President", plural: "Vice Presidents" },
  { key: "officers", roles: ["OFFICER"], label: "Officer", plural: "Officers" },
  { key: "ambassadors", roles: ["AMBASSADOR"], label: "Ambassador", plural: "Ambassadors" },
];

export const ELECTION_STATUS_LABEL: Record<ElectionStatus, string> = {
  NOMINATING: "Taking nominations",
  VOTING: "Voting open",
  CLOSED: "Voting closed",
  APPLIED: "Result applied",
  CANCELLED: "Cancelled",
};

export const ELECTION_STATUS_TONE: Record<ElectionStatus, "info" | "brand" | "warning" | "success" | "neutral"> = {
  NOMINATING: "info",
  VOTING: "brand",
  CLOSED: "warning",
  APPLIED: "success",
  CANCELLED: "neutral",
};

export const SUCCESSION_LABEL: Record<SuccessionMethod, string> = {
  SENIORITY: "Seniority — the President names their successor",
  MEMBER_VOTE: "Member vote — active members elect leaders",
  LEADERSHIP_VOTE: "Leadership vote — current leaders elect each other",
};
