import { z } from "zod";
import { DomainError } from "@/lib/domain/kit";
import { assistantGate, readJson } from "@/lib/ai/access";
import { createThread, loadThread, modelCallsSince, type Thread } from "@/lib/ai/conversations";
import { runTurn, tryLock } from "@/lib/ai/loop";
import { jsonError, sseResponse } from "@/lib/ai/sse";
import { buildView } from "@/lib/ai/view";
import { MAX_USER_MESSAGE } from "@/lib/ai/types";

/**
 * POST /api/assistant — send a message to "Ask Wildcat Clubs" (or retry the
 * last one) and stream the answer as server-sent events (StreamEvent in
 * lib/ai/types). Body: { conversationId?, message } or { conversationId, retry: true }.
 * Leaving out conversationId starts a new conversation. 404 when the
 * assistant is off; 409 while the conversation is still answering.
 */

/** Model calls per person per hour — a cost guard well above normal use. */
const HOURLY_LIMIT = 150;

const Body = z.union([
  z.object({
    conversationId: z.string().min(1).max(64).optional(),
    message: z.string().trim().min(1, "Type a message first.").max(MAX_USER_MESSAGE, `Messages can be up to ${MAX_USER_MESSAGE.toLocaleString()} characters.`),
  }),
  z.object({ conversationId: z.string().min(1).max(64), retry: z.literal(true) }),
]);

export async function POST(req: Request) {
  const gate = await assistantGate();
  if (!gate.ok) return gate.response;
  const { actor, client } = gate;
  const body = await readJson(req, Body);
  if (!body.ok) return body.response;
  const input = body.data;

  if ((await modelCallsSince(actor.id, new Date(Date.now() - 3_600_000))) >= HOURLY_LIMIT) {
    return jsonError(429, "You've asked a lot in the last hour. Take a short break and try again a little later.", "LIMIT");
  }

  let thread: Thread;
  try {
    thread = input.conversationId ? await loadThread(actor, input.conversationId) : await createThread(actor);
  } catch (e) {
    if (e instanceof DomainError) return jsonError(404, "That conversation wasn't found. It may have been deleted.", e.code);
    throw e;
  }
  const release = tryLock(thread.id);
  if (!release) return jsonError(409, "Still working on your last message — give it a moment.", "CONFLICT");

  return sseResponse(async (emit) => {
    try {
      await runTurn({ client, actor, thread, mode: "retry" in input ? { kind: "retry" } : { kind: "message", text: input.message }, emit });
      emit({ type: "done", view: buildView(thread) });
    } finally {
      release();
    }
  });
}
