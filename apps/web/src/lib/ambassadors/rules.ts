/**
 * College ambassador programs: shared names and pure rules (no database),
 * so pages, domain code and tests agree.
 */

/** Task source for a club asking its college's program for an ambassador. sourceId = the asking club's id. */
export const AMBASSADOR_REQUEST = "ambassadorRequest";

export const REQUEST_NOTE_MAX = 500;

/** Why a club's leaders can't ask for an ambassador right now, or null if they can. */
export function requestBlocker(input: {
  clubType: string;
  clubStatus: string;
  hasProgram: boolean;
  collegeName: string | null;
  hasOpenRequest: boolean;
  canManageOrgChart: boolean;
}): string | null {
  if (input.clubType === "COLLEGE_AMBASSADORS") return "Ambassador programs place ambassadors; they don't request them.";
  if (input.clubStatus !== "APPROVED") return "Clubs can ask for an ambassador once WSUSA approves them.";
  if (!input.hasProgram) return input.collegeName ? `${input.collegeName} doesn't have an ambassador program yet. WSUSA starts them, one per college.` : "Your club isn't linked to a college, so there's no ambassador program to ask.";
  if (input.hasOpenRequest) return "Your request is with the ambassador program.";
  if (!input.canManageOrgChart) return "Only leaders who manage the org chart can ask for an ambassador.";
  return null;
}
