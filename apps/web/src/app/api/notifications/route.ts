import { getCurrentUser } from "@/lib/auth/session";
import { apiRoute } from "@/lib/domain/kit";
import { listNotifications, NOTIFICATIONS_PAGE, unreadNotificationCount } from "@/lib/domain/notifications";

/**
 * GET /api/notifications?unread=1&take=50 — the signed-in person's
 * notifications (cookie or Bearer token, so the mobile app uses it too):
 * { unread: number, items: [{ id, kind, title, body, href, createdAt, readAt }] },
 * unread first, newest first within each.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const take = Math.min(NOTIFICATIONS_PAGE, Math.max(1, Number(url.searchParams.get("take")) || 50));
  const unreadOnly = url.searchParams.get("unread") === "1";
  const res = await apiRoute(async () => {
    const actor = await getCurrentUser();
    const [items, unread] = await Promise.all([listNotifications(actor, { take, unreadOnly }), unreadNotificationCount(actor)]);
    return { unread, items: items.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, href: n.href, createdAt: n.createdAt, readAt: n.readAt })) };
  });
  res.headers.set("cache-control", "no-store");
  return res;
}
