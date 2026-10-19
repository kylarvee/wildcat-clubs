import { mobile, mobileActor, preflight } from "../_lib/http";
import { announcementPage } from "../_lib/announcements";
import { parseCursor, parseLimit } from "../_lib/paging";

/**
 * GET /api/m/announcements?cursor=&limit= → MAnnouncementPage: "See more" on
 * Home. The web dashboard's feed (lib/domain/announcements announcementFeed,
 * same audiences: your clubs' posts and WSUSA's), newest first after the
 * pinned WSUSA posts, a page at a time. Start from MHome.announcementsCursor.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  return mobile(async () => announcementPage(await mobileActor(req), parseCursor(sp.get("cursor")), parseLimit(sp.get("limit"), 10, 20)));
}

export const OPTIONS = preflight;
