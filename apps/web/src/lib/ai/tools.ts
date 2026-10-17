import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { DomainError } from "@/lib/domain/kit";
import { READ_TOOLS } from "@/lib/ai/read-tools";
import { WRITE_TOOLS } from "@/lib/ai/write-tools";
import { ToolError } from "@/lib/ai/resolve";
import type { AnyTool, Prepared, ToolCtx } from "@/lib/ai/tool-kit";

/**
 * The assistant's tool registry: what the model is offered, and the one place
 * a tool call is validated and run.
 *
 * Read tools (search_clubs, get_club, my_tasks…) run as soon as the model
 * calls them. Write tools (join_club, create_event, assign_role…) only
 * prepare an action card; the loop stops and the person confirms or cancels
 * (lib/ai/loop.ts). Every input is checked against the tool's zod schema
 * before anything runs, because streamed tool input isn't validated by the API.
 */

export const TOOLS: AnyTool[] = [...READ_TOOLS, ...WRITE_TOOLS];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

/** Exact name first; then a case-insensitive match, since models occasionally change a tool name's case. */
export function findTool(name: string): AnyTool | null {
  const exact = byName.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  return TOOLS.find((t) => t.name.toLowerCase() === lower) ?? null;
}

export const isWriteToolName = (name: string) => findTool(name)?.kind === "write";

/** Zod → JSON Schema for the API, minus the noise it adds ($schema, safe-integer bounds). */
function inputSchema(schema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "$schema") continue;
      if ((k === "maximum" || k === "minimum") && typeof v === "number" && Math.abs(v) >= Number.MAX_SAFE_INTEGER) continue;
      out[k] = clean(v);
    }
    return out;
  };
  return clean(json) as Anthropic.Beta.BetaTool.InputSchema;
}

const WRITE_NOTE = " Nothing happens until the person presses Confirm on the card.";

/**
 * Tool definitions for the API. Built once, in a fixed order, so the cached
 * prefix (tools → system) stays byte-identical between requests. Streamed
 * input (eager_input_streaming) means we validate every input ourselves.
 */
export const API_TOOLS: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.kind === "write" && !t.description.includes("Needs confirmation") ? t.description + WRITE_NOTE : t.description,
  input_schema: inputSchema(t.schema),
  eager_input_streaming: true,
}));

/** A tool problem in words the model can act on. */
export function toolErrorText(e: unknown): string | null {
  if (e instanceof ToolError || e instanceof DomainError) return e.message;
  return null;
}

/** Readable zod issues, e.g. "date: Invalid string" — sent back so the model can fix its call. */
function issuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`)
    .join("; ");
}

export type Validated = { ok: true; tool: AnyTool; input: unknown } | { ok: false; error: string };

export function validateCall(name: string, input: unknown): Validated {
  const tool = findTool(name);
  if (!tool) return { ok: false, error: `There's no tool named "${name}". Available tools: ${TOOLS.map((t) => t.name).join(", ")}.` };
  const parsed = tool.schema.safeParse(input ?? {});
  if (!parsed.success) {
    let raw = "";
    try {
      raw = JSON.stringify(input).slice(0, 600);
    } catch {
      raw = "(unreadable)";
    }
    return { ok: false, error: `The input for ${tool.name} wasn't valid (${issuesText(parsed.error)}). Received: ${raw}. Fix the input and call it again.` };
  }
  return { ok: true, tool, input: parsed.data };
}

export type ReadOutcome = { ok: true; content: string; label: string } | { ok: false; error: string };

/** Runs a validated read tool. Unexpected failures are logged and reported generically. */
export async function runRead(ctx: ToolCtx, tool: AnyTool, input: unknown): Promise<ReadOutcome> {
  if (tool.kind !== "read") return { ok: false, error: `${tool.name} isn't a lookup tool.` };
  try {
    const r = await tool.run(ctx, input as never);
    return { ok: true, content: JSON.stringify(r.data), label: r.label };
  } catch (e) {
    const text = toolErrorText(e);
    if (text) return { ok: false, error: text };
    console.error(`[assistant] ${tool.name} failed`, e);
    return { ok: false, error: `${tool.name} failed unexpectedly. Tell the person this lookup didn't work and suggest the page where they can check instead.` };
  }
}

export type PrepareOutcome = { ok: true; prepared: Prepared } | { ok: false; error: string };

/** Prepares a validated write tool's action card (nothing is written). */
export async function prepareWrite(ctx: ToolCtx, tool: AnyTool, input: unknown): Promise<PrepareOutcome> {
  if (tool.kind !== "write") return { ok: false, error: `${tool.name} isn't an action tool.` };
  try {
    return { ok: true, prepared: await tool.prepare(ctx, input as never) };
  } catch (e) {
    const text = toolErrorText(e);
    if (text) return { ok: false, error: text };
    console.error(`[assistant] preparing ${tool.name} failed`, e);
    return { ok: false, error: `Preparing ${tool.name} failed unexpectedly. Nothing changed. Suggest the page where they can do it instead.` };
  }
}
