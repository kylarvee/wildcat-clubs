import { getCurrentUser } from "@/lib/auth/session";
import { apiRoute, assertSignedIn } from "@/lib/domain/kit";
import { countUnreadConversations } from "@/lib/domain/messaging";

/** GET /api/messages/unread — { count }: conversations with unread messages (the header badge). */
export async function GET() {
  const res = await apiRoute(async () => {
    const actor = await getCurrentUser();
    assertSignedIn(actor);
    return { count: await countUnreadConversations(actor.id) };
  });
  res.headers.set("cache-control", "no-store");
  return res;
}
