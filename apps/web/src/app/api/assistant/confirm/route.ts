import { z } from "zod";
import { DomainError } from "@/lib/domain/kit";
import { assistantGate, readJson } from "@/lib/ai/access";
import { loadThread, type Thread } from "@/lib/ai/conversations";
import { decideAction, runTurn, tryLock } from "@/lib/ai/loop";
import { jsonError, sseResponse } from "@/lib/ai/sse";
import { buildView } from "@/lib/ai/view";

/**
 * POST /api/assistant/confirm — the person's answer to an action card.
 * Body: { conversationId, toolUseId, approve }. Approving runs the same domain
 * function the app's own buttons use, as the signed-in person. Once every
 * card of the round is decided, Claude continues with the results; the
 * response streams like POST /api/assistant.
 */

const Body = z.object({
  conversationId: z.string().min(1).max(64),
  toolUseId: z.string().min(1).max(128),
  approve: z.boolean(),
});

export async function POST(req: Request) {
  const gate = await assistantGate();
  if (!gate.ok) return gate.response;
  const { actor, client } = gate;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const { conversationId, toolUseId, approve } = body.data;

  let thread: Thread;
  try {
    thread = await loadThread(actor, conversationId);
  } catch (e) {
    if (e instanceof DomainError) return jsonError(404, "That conversation wasn't found. It may have been deleted.", e.code);
    throw e;
  }
  const release = tryLock(thread.id);
  if (!release) return jsonError(409, "Still working on the last step — give it a moment.", "CONFLICT");

  return sseResponse(async (emit) => {
    try {
      const roundDone = await decideAction({ actor, thread, toolUseId, approve, emit });
      if (roundDone) await runTurn({ client, actor, thread, mode: { kind: "continue" }, emit });
      emit({ type: "done", view: buildView(thread) });
    } finally {
      release();
    }
  });
}
