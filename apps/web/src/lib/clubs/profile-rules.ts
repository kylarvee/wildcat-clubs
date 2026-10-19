import type { Club } from "@prisma/client";

/**
 * What a club profile still needs. Pure (no database), so the founding
 * checklist (lib/domain/clubs), the yearly renewal checks (lib/renewals), the
 * seed and its checks all apply the same rule.
 */

export type ProfileShape = Pick<Club, "name" | "shortDescription" | "descriptionHtml" | "scope" | "collegeId" | "type" | "departmentId" | "requestedDepartmentName"> & Partial<Pick<Club, "category">>;

/** What's still missing from a club's profile, in plain words. Empty = complete. */
export function profileGaps(club: ProfileShape): string[] {
  const gaps: string[] = [];
  if (club.name.trim().length < 3) gaps.push("Club name");
  if (club.shortDescription.trim().length < 10) gaps.push("Short description");
  const longText = (club.descriptionHtml ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
  if (longText.length < 40) gaps.push("Full description (a few sentences about what you'll do)");
  if (club.scope === "COLLEGE" && !club.collegeId) gaps.push("College");
  if (club.type === "SPONSORED" && !club.departmentId && !club.requestedDepartmentName) gaps.push("Sponsoring department");
  // WSUSA's category; the College Ambassadors orgs admins create don't need one.
  if ("category" in club && !club.category && club.type !== "COLLEGE_AMBASSADORS") gaps.push("Category");
  return gaps;
}
