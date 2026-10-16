import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, requireUser, type Actor } from "@/lib/auth/session";
import { getClubAccess, type Capability, type ClubAccess } from "@/lib/authz";

/** Basic club row by slug (cached per request). */
export const getClubBySlug = cache(async (slug: string) =>
  db.club.findUnique({
    where: { slug },
    include: {
      college: { select: { id: true, name: true, shortName: true, slug: true } },
      department: { select: { id: true, name: true } },
      focusMajor: { select: { id: true, name: true } },
    },
  }),
);

export type ClubRow = NonNullable<Awaited<ReturnType<typeof getClubBySlug>>>;

/** Founding/rejected clubs are private to their own leaders, advisors and admins. */
export function clubIsPublic(status: ClubRow["status"]) {
  return status === "APPROVED" || status === "RETIRED";
}

/** For public club routes: the club + viewer access, or 404 if the viewer may not see it. */
export async function loadVisibleClub(slug: string): Promise<{ club: ClubRow; user: Actor | null; access: ClubAccess | null }> {
  const club = await getClubBySlug(slug);
  if (!club) notFound();
  const user = await getCurrentUser();
  const access = user ? await getClubAccess(user, club.id) : null;
  if (!clubIsPublic(club.status) && !access?.isLeader) notFound();
  return { club, user, access };
}

/**
 * For club workspace routes (/clubs/[slug]/manage/*): requires sign-in and a
 * leadership role (or advisor/admin). Pass a capability to also require it.
 * Returns null access capability → caller should render <NoPermission/>.
 */
export async function loadClubWorkspace(slug: string, cap?: Capability) {
  const user = await requireUser(`/clubs/${slug}/manage`);
  const club = await getClubBySlug(slug);
  if (!club) notFound();
  const access = await getClubAccess(user, club.id);
  if (!access?.isLeader) notFound();
  const allowed = cap ? access.capabilities.has(cap) : true;
  return { user, club, access, allowed };
}
