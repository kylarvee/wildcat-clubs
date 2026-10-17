import { getCurrentUser } from "@/lib/auth/session";
import { apiRoute } from "@/lib/domain/kit";
import { listConversations } from "@/lib/domain/messaging";

/**
 * GET /api/messages — your conversation list ({ conversations, unreadConversations }),
 * most recent first. The Messages page polls this to keep the list fresh.
 */
export async function GET() {
  const res = await apiRoute(async () => {
    const conversations = await listConversations(await getCurrentUser());
    return { conversations, unreadConversations: conversations.filter((c) => c.unread > 0).length };
  });
  res.headers.set("cache-control", "no-store");
  return res;
}
