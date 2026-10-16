import type { ClubType, FundingSource } from "@prisma/client";

/**
 * Where a cost line's money is expected to come from, before anyone changes it
 * (ARCHITECTURE.md §6): Registered clubs → WSUSA; Sponsored and Affiliate clubs →
 * their Department when they have one, else WSUSA; university events → University.
 * The Events Builder and the Budget tool both default through here.
 */
export function defaultFundingSource(club: { type: ClubType; departmentId: string | null } | null): FundingSource {
  if (!club) return "UNIVERSITY";
  if (club.type === "SPONSORED" || club.type === "AFFILIATE") return club.departmentId ? "DEPARTMENT" : "WSUSA";
  return "WSUSA";
}
