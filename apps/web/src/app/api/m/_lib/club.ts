import "server-only";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { clubIsPublic, getClubBySlug } from "@/lib/clubs/context";
import { notFound } from "@/lib/domain/kit";

/**
 * A club by slug, as the club page would show it: approved and retired clubs
 * to everyone, founding clubs only to their own leaders (and admins). Anything
 * else looks exactly like a missing club.
 */
export async function loadClubForViewer(actor: Actor | null, slug: string) {
  const club = await getClubBySlug(decodeURIComponent(slug));
  if (!club) throw notFound("Club");
  const access = actor ? await getClubAccess(actor, club.id) : null;
  if (!clubIsPublic(club.status) && !access?.isLeader) throw notFound("Club");
  return { club, access };
}
