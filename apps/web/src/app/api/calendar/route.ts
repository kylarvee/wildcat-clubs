import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { feedOccurrences, toCalendarJson, viewerContext, type FeedScope } from "@/lib/events/feed";
import { eventFilter } from "@/lib/events/browse";
import { parseEventParams } from "@/lib/events/browse-params";

/**
 * GET /api/calendar?scope=club&clubId=… | scope=me | scope=all | scope=university | scope=trainings
 *   &start=ISO&end=ISO  [&q=&type=&category=&food=1&stuff=1&service=1&online=1&following=1]
 * FullCalendar events for occurrences in range that the viewer may see, with
 * the Events page's filters when given (its Month view). `start`/`end` in the
 * response are campus wall clock (no offset); the real instants are in
 * extendedProps.startsAt/endsAt. See lib/events/feed.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const scopeName = q.get("scope") ?? "university";
  const now = Date.now();
  const start = q.get("start") ? new Date(q.get("start")!) : new Date(now - 31 * 86_400_000);
  const end = q.get("end") ? new Date(q.get("end")!) : new Date(now + 62 * 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return Response.json({ error: "Invalid date range." }, { status: 400 });
  if (end.getTime() - start.getTime() > 400 * 86_400_000) return Response.json({ error: "Ask for at most about a year at a time." }, { status: 400 });

  const actor = await getCurrentUser();
  let scope: FeedScope;
  switch (scopeName) {
    case "club": {
      const clubId = q.get("clubId");
      if (!clubId) return Response.json({ error: "Missing clubId." }, { status: 400 });
      const club = await db.club.findUnique({ where: { id: clubId }, select: { status: true } });
      const visible = club && (club.status === "APPROVED" || club.status === "RETIRED" || (await getClubAccess(actor, clubId))?.isLeader);
      if (!visible) return Response.json({ error: "Club not found." }, { status: 404 });
      scope = { scope: "club", clubId };
      break;
    }
    case "me":
      if (!actor) return Response.json({ error: "Sign in to see your calendar." }, { status: 401 });
      scope = { scope: "me" };
      break;
    case "all":
      scope = { scope: "all" };
      break;
    case "university":
      scope = { scope: "university" };
      break;
    case "trainings":
      scope = { scope: "trainings" };
      break;
    default:
      return Response.json({ error: "Unknown calendar." }, { status: 400 });
  }

  const ctx = await viewerContext(actor);
  const filter = await eventFilter(ctx, parseEventParams(q));
  // A search that matched nothing.
  if (!filter) return Response.json([], { headers: { "cache-control": "private, no-store" } });
  const rows = await feedOccurrences(ctx, scope, { start, end }, { filter });
  const events = await toCalendarJson(ctx, scope, rows);
  return Response.json(events, { headers: { "cache-control": "private, no-store" } });
}
