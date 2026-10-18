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

/** The four ways to fill a seat (lib/roles/pipeline), by short name… */
export const SUCCESSION_NAME: Record<SuccessionMethod, string> = {
  ADVISOR_PRESIDENT: "Advisor & President",
  NEXT_IN_LINE: "Next in line",
  SELF_SELECT: "Self-select",
  MEMBER_VOTE: "Member vote",
};

/** …what each one means, in a phrase… */
export const SUCCESSION_HOW: Record<SuccessionMethod, string> = {
  ADVISOR_PRESIDENT: "the President and the advisor choose together",
  NEXT_IN_LINE: "the people in the seats just below may move up",
  SELF_SELECT: "the club's leaders choose together, unanimously",
  MEMBER_VOTE: "active members elect leaders",
};

/** …and both, as "Name — what it means" (split on " — " for the name alone). */
export const SUCCESSION_LABEL: Record<SuccessionMethod, string> = {
  ADVISOR_PRESIDENT: `${SUCCESSION_NAME.ADVISOR_PRESIDENT} — ${SUCCESSION_HOW.ADVISOR_PRESIDENT}`,
  NEXT_IN_LINE: `${SUCCESSION_NAME.NEXT_IN_LINE} — ${SUCCESSION_HOW.NEXT_IN_LINE}`,
  SELF_SELECT: `${SUCCESSION_NAME.SELF_SELECT} — ${SUCCESSION_HOW.SELF_SELECT}`,
  MEMBER_VOTE: `${SUCCESSION_NAME.MEMBER_VOTE} — ${SUCCESSION_HOW.MEMBER_VOTE}`,
};

/** What a selection in each mode involves, for the people taking part. */
export const SUCCESSION_STEPS: Record<SuccessionMethod, string> = {
  ADVISOR_PRESIDENT: "The President or an advisor proposes one candidate and the other confirms. No ballots.",
  NEXT_IN_LINE: "The people in the seats just below are asked whether they'll move up. The first in line who says yes does. No ballots.",
  SELF_SELECT: "The club's current leaders vote by secret ballot. It counts only if it's unanimous, and no one votes for themselves.",
  MEMBER_VOTE: "Active members vote by secret ballot. The most votes wins.",
};

/** A selection's status in its own mode's words (the stored statuses are shared by all four). */
export function selectionStatus(e: { status: ElectionStatus; method: SuccessionMethod; proposedCandidateId?: string | null }): { label: string; tone: (typeof ELECTION_STATUS_TONE)[ElectionStatus] } {
  if (e.status === "APPLIED") return { label: "Seat filled", tone: "success" };
  if (e.status === "CANCELLED") return { label: "Cancelled", tone: "neutral" };
  if (e.method === "ADVISOR_PRESIDENT") return e.proposedCandidateId ? { label: "Waiting to confirm", tone: "brand" } : { label: "Waiting for a proposal", tone: "info" };
  if (e.method === "NEXT_IN_LINE") return e.status === "CLOSED" ? { label: "Answers are in", tone: "warning" } : { label: "Waiting for answers", tone: "brand" };
  if (e.method === "SELF_SELECT" && e.status === "NOMINATING") return { label: "Gathering candidates", tone: "info" };
  return { label: ELECTION_STATUS_LABEL[e.status], tone: ELECTION_STATUS_TONE[e.status] };
}
