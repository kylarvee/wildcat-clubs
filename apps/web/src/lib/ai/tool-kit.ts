import "server-only";
import type { z } from "zod";
import type { Actor } from "@/lib/auth/session";
import type { ActionCard } from "@/lib/ai/types";

/**
 * The shape of an assistant tool. Read tools run as soon as the model calls
 * them. Write tools only *prepare*: they resolve names, check what they can
 * with lib/authz, and describe exactly what will happen; the person then
 * presses Confirm and the prepared `execute` calls the same domain function
 * the rest of the app uses (which checks permission again).
 */

export type ToolCtx = { actor: Actor; now: Date };

export type ReadResult = { data: unknown; label: string };

export type ReadTool<S extends z.ZodType = z.ZodType> = {
  kind: "read";
  name: string;
  description: string;
  schema: S;
  /** Chip text while it runs ("Searching clubs"). */
  running: string;
  run(ctx: ToolCtx, input: z.output<S>): Promise<ReadResult>;
};

export type Executed = {
  /** What the model reads back. */
  data: unknown;
  /** One line for the person ("You're now a member of Chess Club."). */
  outcome: string;
  /** Where to see the result. */
  href: string | null;
  /** Pages whose server render changed. */
  revalidate?: string[];
};

/**
 * `fingerprint` names what the action does when the card also carries numbers
 * that drift harmlessly (how many people an announcement reaches). Before
 * running, the action is prepared again and must match what the person saw:
 * the fingerprint when there is one, otherwise the whole card.
 */
export type Prepared = { card: ActionCard; fingerprint?: string; execute: () => Promise<Executed> };

export type WriteTool<S extends z.ZodType = z.ZodType> = {
  kind: "write";
  name: string;
  description: string;
  schema: S;
  running: string;
  prepare(ctx: ToolCtx, input: z.output<S>): Promise<Prepared>;
};

export type AnyTool = ReadTool | WriteTool;

export const readTool = <S extends z.ZodType>(t: Omit<ReadTool<S>, "kind">): ReadTool<S> => ({ kind: "read", ...t });
export const writeTool = <S extends z.ZodType>(t: Omit<WriteTool<S>, "kind">): WriteTool<S> => ({ kind: "write", ...t });

// ─── Formatting helpers shared by the tools ─────────────────────────────────

export function percent(rate: number | null | undefined): string | null {
  return rate == null ? null : `${Math.round(rate * 100)}%`;
}

export function quote(s: string, max = 60): string {
  const t = s.trim().replace(/\s+/g, " ");
  return `“${t.length > max ? `${t.slice(0, max - 1)}…` : t}”`;
}

/** Plain text → simple HTML paragraphs (escaped); the domain sanitizes again. */
export function textToHtml(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return t
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
