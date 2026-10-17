import { getCurrentUser } from "@/lib/auth/session";
import { apiRoute } from "@/lib/domain/kit";
import { loadThread, pollThread } from "@/lib/domain/messaging";

/**
 * GET /api/messages/<conversationId>
 *   ?after=<iso>   what changed since then (new, edited, deleted), oldest first:
 *                  { messages, cursor, canSend, readOnlyReason } — pass cursor as the next ?after.
 *   ?before=<iso>  the page of older messages before then: { messages, hasOlder }.
 *   (neither)      the latest page: { messages, hasOlder }.
 * 404 when the conversation doesn't exist or isn't yours to read.
 */
export async function GET(req: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const sp = new URL(req.url).searchParams;
  const after = sp.get("after");
  const before = sp.get("before");
  const res = await apiRoute(async () => {
    const actor = await getCurrentUser();
    if (after) return pollThread(actor, conversationId, after);
    return loadThread(actor, conversationId, { before });
  });
  res.headers.set("cache-control", "no-store");
  return res;
}
