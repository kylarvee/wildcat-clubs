import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { apiRoute, invalid, parse } from "@/lib/domain/kit";
import { markAllRead, markRead, markUnread, unreadNotificationCount } from "@/lib/domain/notifications";

const Body = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ id: z.string().min(1).max(64), unread: z.boolean().optional() }),
]);

/**
 * POST /api/notifications/read — mark notifications read for the signed-in
 * person (web or mobile app). Body: { id } to mark one read, { id, unread: true }
 * to mark it unread again, or { all: true }. Returns { unread } (the new count).
 */
export async function POST(req: Request) {
  return apiRoute(async () => {
    const actor = await getCurrentUser();
    const raw = await req.json().catch(() => null);
    if (!raw) throw invalid("Send a JSON body like { \"id\": \"…\" } or { \"all\": true }.");
    const body = parse(Body, raw);
    if ("all" in body) await markAllRead(actor);
    else if (body.unread) await markUnread(actor, body.id);
    else await markRead(actor, body.id);
    return { unread: await unreadNotificationCount(actor) };
  });
}
