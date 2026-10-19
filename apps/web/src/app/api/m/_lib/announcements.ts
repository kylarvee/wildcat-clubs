import "server-only";
import type { Actor } from "@/lib/auth/session";
import { announcementFeed } from "@/lib/domain/announcements";
import { pageOf } from "./paging";
import { toMAnnouncement } from "./serialize";
import type { MAnnouncementPage } from "../_types";

/** The most announcementFeed hands over (its own cap). The web dashboard's "Show older" lists 40. */
export const FEED_MAX = 50;

/**
 * One page of the dashboard feed, counted from the top: the same function
 * and audiences as the web (lib/domain/announcements announcementFeed), so
 * nobody sees a post here they couldn't see there. Paging ends at the feed's
 * cap of 50 posts.
 */
export async function announcementPage(actor: Actor | null, offset: number, limit: number): Promise<MAnnouncementPage> {
  if (offset >= FEED_MAX) return { items: [], nextCursor: null };
  const rows = await announcementFeed(actor?.id ?? null, Math.min(offset + limit + 1, FEED_MAX));
  const page = pageOf(rows, offset, limit);
  return { items: page.items.map(toMAnnouncement), nextCursor: page.nextCursor };
}
