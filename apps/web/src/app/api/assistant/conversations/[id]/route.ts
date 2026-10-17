import { apiRoute } from "@/lib/domain/kit";
import { assistantGate } from "@/lib/ai/access";
import { deleteConversation, loadThread } from "@/lib/ai/conversations";
import { tryLock } from "@/lib/ai/loop";
import { jsonError } from "@/lib/ai/sse";
import { buildView } from "@/lib/ai/view";

/**
 * GET /api/assistant/conversations/<id> — { ok, data: { view } } (ChatView).
 * DELETE — removes the conversation and its messages for good (409 while it's answering).
 * 404 for conversations that don't exist or aren't yours.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const gate = await assistantGate();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const res = await apiRoute(async () => ({ view: buildView(await loadThread(gate.actor, id)) }));
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function DELETE(_req: Request, { params }: Params) {
  const gate = await assistantGate();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const release = tryLock(id);
  if (!release) return jsonError(409, "Wait for the current answer to finish, then delete it.", "CONFLICT");
  try {
    return await apiRoute(async () => {
      await deleteConversation(gate.actor, id);
      return { deleted: true };
    });
  } finally {
    release();
  }
}
