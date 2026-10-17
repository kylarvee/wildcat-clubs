import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getCurrentUser, type Actor } from "@/lib/auth/session";
import { getClaude } from "@/lib/integrations/anthropic";
import { jsonError } from "@/lib/ai/sse";

/**
 * Gatekeeping shared by the assistant's API routes: signed in, feature on
 * (sysadmin switch + API key), and JSON bodies only — a cross-site form can't
 * send application/json without a CORS preflight, and session cookies are
 * SameSite=Lax.
 */

export const ASSISTANT_OFF = "The assistant isn't turned on.";

export type Gate = { ok: true; actor: Actor; client: Anthropic } | { ok: false; response: Response };

export async function assistantGate(): Promise<Gate> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, response: jsonError(401, "Please sign in first.", "UNAUTHENTICATED") };
  const client = await getClaude("assistant");
  if (!client) return { ok: false, response: jsonError(404, ASSISTANT_OFF, "NOT_FOUND") };
  return { ok: true, actor, client };
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<{ ok: true; data: z.output<T> } | { ok: false; response: Response }> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return { ok: false, response: jsonError(415, "Send JSON.", "INVALID") };
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: jsonError(400, "That request wasn't valid JSON.", "INVALID") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, response: jsonError(400, parsed.error.issues[0]?.message ?? "That request wasn't valid.", "INVALID") };
  return { ok: true, data: parsed.data };
}
