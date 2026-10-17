import { listNotifications, unreadNotificationCount } from "@/lib/domain/notifications";
import { mobile, mobileActor, preflight } from "../_lib/http";
import type { MNotifications } from "../_types";

/**
 * GET /api/m/notifications → MNotifications: your notifications, unread
 * first, newest first (lib/domain/notifications — the same list as the bell).
 */
export async function GET(req: Request) {
  return mobile(async (): Promise<MNotifications> => {
    const actor = await mobileActor(req);
    const [items, unread] = await Promise.all([listNotifications(actor, { take: 100 }), unreadNotificationCount(actor)]);
    return {
      unread,
      items: items.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, href: n.href, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null })),
    };
  });
}

export const OPTIONS = preflight;
