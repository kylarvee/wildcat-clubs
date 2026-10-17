import { assistantGate } from "@/lib/ai/access";
import { listConversations } from "@/lib/ai/conversations";
import { starterPrompts } from "@/lib/ai/starters";

/** GET /api/assistant/conversations — { ok, data: { conversations, starters } } for the chat panel. */
export async function GET() {
  const gate = await assistantGate();
  if (!gate.ok) return gate.response;
  const [conversations, starters] = await Promise.all([listConversations(gate.actor), starterPrompts(gate.actor)]);
  return Response.json({ ok: true, data: { conversations, starters } }, { headers: { "cache-control": "no-store" } });
}
