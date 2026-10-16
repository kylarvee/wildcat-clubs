import "server-only";
import { getCurrentUser } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { getClubBySlug } from "@/lib/clubs/context";

/**
 * Page titles for workspace routes. Metadata resolves before the layout's
 * sign-in redirect, so the club's name is only used for people who can open
 * the workspace — founding clubs stay private.
 */
export async function workspaceTitle(slug: string, section: string) {
  const [club, user] = await Promise.all([getClubBySlug(slug), getCurrentUser()]);
  const access = club && user ? await getClubAccess(user, club.id) : null;
  return { title: club && access?.isLeader ? `${club.name} · ${section}` : section };
}
