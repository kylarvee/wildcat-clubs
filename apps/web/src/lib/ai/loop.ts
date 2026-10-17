import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import type { Actor } from "@/lib/auth/session";
import { isSysadmin } from "@/lib/authz";
import { DomainError } from "@/lib/domain/kit";
import { AI_MODELS, routeAssistant, type AiModel } from "@/lib/integrations/anthropic";
import { SYSTEM_PROMPT } from "@/lib/ai/knowledge";
import { buildContextNote } from "@/lib/ai/context";
import { API_TOOLS, findTool, prepareWrite, runRead, toolErrorText, validateCall } from "@/lib/ai/tools";
import { ToolError } from "@/lib/ai/resolve";
import { apiMessages, claimAction, DEFAULT_TITLE, LIMIT_TEXT, overHourlyLimit, titleFrom, type ActionRecord, type ActionsContent, type ChipRecord, type Thread } from "@/lib/ai/conversations";
import { EMPTY_PLACEHOLDER, modelTag, REFUSAL_PLACEHOLDER } from "@/lib/ai/view";
import type { StreamEvent } from "@/lib/ai/types";

/**
 * One turn of "Ask Wildcat Clubs": stream Claude's answer, run lookups as
 * soon as they're asked for, and stop at the first action that needs the
 * person's Confirm. Everything the model sends and receives is appended to the
 * conversation as it happens, so a turn can be retried or continued later.
 *
 * Requests: tools and the system prompt never change (one cached prefix); the
 * per-person context note arrives after it as a mid-conversation system
 * message; history is append-only; thinking stays adaptive with its blocks
 * passed back untouched. A turn stays on the model it started with.
 */

export type Emit = (event: StreamEvent) => void;
export type TurnMode = { kind: "message"; text: string } | { kind: "retry" } | { kind: "continue" };

/** Model calls per turn before we stop and let the person steer. */
const MAX_STEPS = 8;
/** A ceiling, not a target: thinking counts toward it, and streaming keeps long answers safe. */
const MAX_TOKENS = 64_000;
/** Medium on both: enough to reliably look things up before answering, still quick in chat. */
const EFFORT = "medium" as const;
/** Re-sends after streamed tool input that couldn't be parsed at all. */
const JSON_RETRIES = 2;
/**
 * Thinking blocks are only valid while everything before them is unchanged.
 * When a deploy changes the guide or a tool, older conversations would be
 * rejected; with "drop_block" their old reasoning is dropped instead and the
 * conversation carries on.
 */
const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01";

export const REFUSAL_TEXT = "Claude couldn't help with that one. Try asking a different way — or, for anything Wildcat Clubs can't help with, reach out to the WSUSA clubs office.";

// ─── Locking: one turn at a time per conversation ───────────────────────────

const locks: Set<string> = ((globalThis as { __wcAssistantLocks?: Set<string> }).__wcAssistantLocks ??= new Set<string>());

/** Returns a release function, or null when a turn is already running for this conversation. */
export function tryLock(conversationId: string): (() => void) | null {
  if (locks.has(conversationId)) return null;
  locks.add(conversationId);
  return () => locks.delete(conversationId);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isAiModel(m: string | null): m is AiModel {
  return m === AI_MODELS.haiku || m === AI_MODELS.sonnet;
}

function hasUserText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const text = (content as Anthropic.ContentBlockParam[])
    .filter((b): b is Anthropic.TextBlockParam => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text || null;
}

/** Routing inputs from the stored history: earlier messages, and whether the last answer used tools. */
function routingStats(thread: Thread) {
  let turnsSoFar = 0;
  let lastTurnUsedTools = false;
  let lastText: string | null = null;
  for (const r of thread.rows) {
    if (r.role === "user") {
      const text = hasUserText(r.content);
      if (text) {
        turnsSoFar++;
        lastText = text;
        lastTurnUsedTools = false;
      }
    } else if (r.role === "assistant" && Array.isArray(r.content)) {
      if ((r.content as unknown as Anthropic.ContentBlock[]).some((b) => b.type === "tool_use")) lastTurnUsedTools = true;
    }
  }
  return { turnsSoFar, lastTurnUsedTools, lastText };
}

/** The model that already answered in the current turn, if any (a retry stays on it). */
function modelInCurrentTurn(thread: Thread): AiModel | null {
  for (let i = thread.rows.length - 1; i >= 0; i--) {
    const r = thread.rows[i];
    if (r.role === "user" && hasUserText(r.content)) return null;
    if (r.role === "assistant" && isAiModel(r.model)) return r.model;
  }
  return null;
}

/**
 * Tool calls in the last answer that never got a result (a failure between
 * storing the answer and storing its results). The API rejects a history like
 * that, so they're closed with an error result before anything else is sent.
 */
function danglingResults(thread: Thread): Anthropic.ToolResultBlockParam[] {
  const last = thread.lastApiRow();
  if (!last || last.role !== "assistant" || !Array.isArray(last.content)) return [];
  if (thread.pendingActions()) return [];
  // A round whose actions were all decided keeps its real results.
  const after = thread.rows.slice(thread.rows.indexOf(last) + 1);
  const round = after.reverse().find((r) => r.role === "actions");
  if (round) return orderedResults(round.content as unknown as ActionsContent);
  return (last.content as unknown as Anthropic.ContentBlock[])
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ type: "tool_result" as const, tool_use_id: b.id, is_error: true, content: "This step was interrupted before it finished, so nothing ran." }));
}

function orderedResults(round: ActionsContent): Anthropic.ToolResultBlockParam[] {
  const out: Anthropic.ToolResultBlockParam[] = [];
  for (const id of round.order) {
    const r = round.results.find((x) => x.tool_use_id === id) ?? round.actions.find((a) => a.id === id)?.result;
    if (r) out.push(r);
  }
  return out;
}

function describeError(e: unknown, actor: Actor): { text: string; retry: boolean } {
  if (e instanceof Anthropic.RateLimitError) return { text: "Lots of people are asking right now. Wait a moment, then try again.", retry: true };
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    console.error("[assistant] Claude refused the API key", e.message);
    return {
      text: isSysadmin(actor)
        ? "Claude refused the platform's API key. Check ANTHROPIC_API_KEY on the server, then try again (System settings → Integrations)."
        : "The assistant can't reach Claude right now because of a setup problem. Let a system administrator know.",
      retry: false,
    };
  }
  if (e instanceof Anthropic.BadRequestError) {
    console.error("[assistant] request rejected", e.message);
    return { text: "Claude couldn't read this conversation. Start a new conversation and ask again.", retry: false };
  }
  if (e instanceof Anthropic.NotFoundError) {
    console.error("[assistant] model not found", e.message);
    return { text: "The assistant's Claude model isn't available right now. Try again later.", retry: true };
  }
  if (e instanceof Anthropic.APIConnectionError) return { text: "Couldn't reach Claude. Check your connection and try again.", retry: true };
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529 || (e.status ?? 0) >= 500) return { text: "Claude is overloaded right now. Try again in a moment.", retry: true };
    console.error("[assistant] API error", e.status, e.message);
    return { text: "Something went wrong talking to Claude. Try again.", retry: true };
  }
  console.error("[assistant] turn failed", e);
  return { text: "Something went wrong on our side. Try again in a moment.", retry: true };
}

// ─── One model call ─────────────────────────────────────────────────────────

async function callModel(client: Anthropic, model: AiModel, thread: Thread, actor: Actor, emit: Emit): Promise<Anthropic.Beta.BetaMessage> {
  for (let attempt = 0; ; attempt++) {
    emit({ type: "model", model: modelTag(model) });
    const stream = client.beta.messages.stream({
      model,
      max_tokens: MAX_TOKENS,
      betas: [THINKING_BINDING_BETA],
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: API_TOOLS,
      tool_choice: { type: "auto" },
      messages: apiMessages(thread.rows) as unknown as Anthropic.Beta.BetaMessageParam[],
      // Caches the conversation so far (the last cacheable block), on top of tools + system.
      cache_control: { type: "ephemeral" },
      output_config: { effort: EFFORT },
      metadata: { user_id: actor.id },
    });
    try {
      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          emit({ type: "tool", id: event.content_block.id, label: findTool(event.content_block.name)?.running ?? "Working", status: "running" });
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          emit({ type: "text", delta: event.delta.text });
        }
      }
      return await stream.finalMessage();
    } catch (e) {
      // API errors (rate limits, auth, overload…) go to the caller; only unreadable streamed tool input is re-sent.
      if (e instanceof Anthropic.APIError || attempt >= JSON_RETRIES) throw e;
      console.warn("[assistant] couldn't read streamed tool input; re-sending", e);
      emit({ type: "reset" });
    }
  }
}

// ─── The turn ───────────────────────────────────────────────────────────────

/**
 * Runs one turn. `message` appends the person's text (closing any actions
 * they skipped), `retry` re-sends after an error, `continue` resumes after
 * the last action of a round was decided.
 */
export async function runTurn({ client, actor, thread, mode, emit }: { client: Anthropic; actor: Actor; thread: Thread; mode: TurnMode; emit: Emit }): Promise<void> {
  let model: AiModel;

  if (mode.kind === "message") {
    const content: Anthropic.ContentBlockParam[] = [...danglingResults(thread)];
    const round = thread.pendingActions();
    if (round) {
      // They moved on without deciding: those actions don't run, and the model is told so.
      for (const a of round.content.actions) {
        if (a.status === "running") {
          // Only left "running" when a server stopped mid-action: it may or may not have gone through.
          a.status = "failed";
          a.outcome = "Interrupted — check whether this went through before trying again.";
          a.result = { type: "tool_result", tool_use_id: a.id, is_error: true, content: "This action was interrupted while running; it may or may not have gone through. Suggest checking the page before trying again." };
        } else if (a.status === "pending") {
          a.status = "declined";
          a.outcome = "Not done — you sent a new message instead.";
          a.result = { type: "tool_result", tool_use_id: a.id, content: "The person sent a new message instead of confirming, so this did not run. Don't redo it unless they ask." };
        } else continue;
        emit({ type: "action_result", id: a.id, status: a.status, outcome: a.outcome, href: null });
      }
      await thread.updateRow(round.row.id, round.content);
      content.push(...orderedResults(round.content));
    }
    const stats = routingStats(thread);
    content.push({ type: "text", text: mode.text });
    await thread.append([{ role: "user", content }]);
    if (thread.title === DEFAULT_TITLE) await thread.setTitle(titleFrom(mode.text));
    emit({ type: "start", conversationId: thread.id, title: thread.title });

    const note = await buildContextNote(actor);
    if (note !== thread.lastAnsweredNote()) await thread.append([{ role: "system", content: note }]);
    model = routeAssistant({ message: mode.text, turnsSoFar: stats.turnsSoFar, lastTurnUsedTools: stats.lastTurnUsedTools });
  } else if (mode.kind === "retry") {
    const dangling = danglingResults(thread);
    if (dangling.length) await thread.append([{ role: "user", content: dangling }]);
    const last = thread.lastApiRow();
    if (!last || last.role === "assistant") {
      emit({ type: "fatal", message: "There's nothing to try again — ask your question again instead." });
      return;
    }
    emit({ type: "start", conversationId: thread.id, title: thread.title });
    const stats = routingStats(thread);
    model = modelInCurrentTurn(thread) ?? routeAssistant({ message: stats.lastText ?? "", turnsSoFar: Math.max(0, stats.turnsSoFar - 1), lastTurnUsedTools: false });
  } else {
    // Confirming an action is free, but Claude reading the result is a model call: past the
    // hourly limit, pause here. "Try again" resumes later through POST /api/assistant, which checks it too.
    if (await overHourlyLimit(actor.id)) {
      await thread.append([{ role: "notice", content: { tone: "info", text: LIMIT_TEXT, retry: true } }]);
      emit({ type: "notice", tone: "info", text: LIMIT_TEXT, retryText: "Try again" });
      return;
    }
    const last = thread.lastModel();
    model = isAiModel(last) ? last : AI_MODELS.sonnet;
  }

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const message = await callModel(client, model, thread, actor, emit);
      const usage = {
        model,
        inputTokens: message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0),
        outputTokens: message.usage.output_tokens,
      };

      // Declined: drop any partial output, keep the history valid with a placeholder answer.
      if (message.stop_reason === "refusal") {
        emit({ type: "reset" });
        await thread.append([
          { role: "assistant", content: [{ type: "text", text: REFUSAL_PLACEHOLDER }], ...usage },
          { role: "notice", content: { tone: "refusal", text: REFUSAL_TEXT, retry: false } },
        ]);
        emit({ type: "notice", tone: "refusal", text: REFUSAL_TEXT, retryText: null });
        return;
      }

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const hasText = message.content.some((b) => b.type === "text" && b.text.trim());
      // An answer with nothing visible (only thinking) still needs a text block to be a valid turn.
      const content: Anthropic.Beta.BetaContentBlock[] = toolUses.length || hasText ? message.content : [...message.content, { type: "text", text: EMPTY_PLACEHOLDER, citations: null }];
      await thread.append([{ role: "assistant", content, ...usage }]);

      if (message.stop_reason === "max_tokens") {
        if (toolUses.length) {
          // A cut-off call can still parse as valid input, so nothing in it runs.
          await thread.append([
            { role: "user", content: toolUses.map((t) => ({ type: "tool_result", tool_use_id: t.id, is_error: true, content: "Your answer hit the length limit before this call was complete, so it did not run." })) },
            { role: "tools", content: { items: toolUses.map((t) => ({ id: t.id, name: t.name, label: findTool(t.name)?.running ?? "Working", ok: false })) } },
          ]);
          for (const t of toolUses) emit({ type: "tool", id: t.id, label: findTool(t.name)?.running ?? "Working", status: "error" });
        }
        const text = "That answer got too long and was cut off. Ask for a shorter answer, or split the question into parts.";
        await thread.append([{ role: "notice", content: { tone: "info", text, retry: false } }]);
        emit({ type: "notice", tone: "info", text, retryText: null });
        return;
      }

      if (!toolUses.length) {
        if (!hasText) {
          const text = "The assistant didn't write an answer. Try asking again, maybe in different words.";
          await thread.append([{ role: "notice", content: { tone: "info", text, retry: false } }]);
          emit({ type: "notice", tone: "info", text, retryText: null });
        }
        return;
      }

      // ── A tool round: lookups run now; actions wait for Confirm. ──
      const ctx = { actor, now: new Date() };
      type Outcome =
        | { kind: "error"; call: Anthropic.Beta.BetaToolUseBlock; error: string }
        | { kind: "read"; call: Anthropic.Beta.BetaToolUseBlock; content: string; label: string }
        | { kind: "action"; call: Anthropic.Beta.BetaToolUseBlock; tool: string; input: unknown; card: ActionRecord["card"]; fingerprint: string | null };
      const outcomes = await Promise.all(
        toolUses.map(async (call): Promise<Outcome> => {
          const checked = validateCall(call.name, call.input);
          if (!checked.ok) return { kind: "error", call, error: checked.error };
          if (checked.tool.kind === "read") {
            const r = await runRead(ctx, checked.tool, checked.input);
            return r.ok ? { kind: "read", call, content: r.content, label: r.label } : { kind: "error", call, error: r.error };
          }
          const p = await prepareWrite(ctx, checked.tool, checked.input);
          return p.ok
            ? { kind: "action", call, tool: checked.tool.name, input: checked.input, card: p.prepared.card, fingerprint: p.prepared.fingerprint ?? null }
            : { kind: "error", call, error: p.error };
        }),
      );

      const chips: ChipRecord[] = [];
      const results: Anthropic.ToolResultBlockParam[] = [];
      const actions: ActionRecord[] = [];
      for (const o of outcomes) {
        const running = findTool(o.call.name)?.running ?? "Working";
        if (o.kind === "action") {
          actions.push({ id: o.call.id, name: o.tool, input: o.input, card: o.card, fingerprint: o.fingerprint, status: "pending", outcome: null, href: null, result: null });
          emit({ type: "action", id: o.call.id, card: o.card });
        } else if (o.kind === "error") {
          chips.push({ id: o.call.id, name: o.call.name, label: running, ok: false });
          results.push({ type: "tool_result", tool_use_id: o.call.id, is_error: true, content: o.error });
          emit({ type: "tool", id: o.call.id, label: running, status: "error" });
        } else {
          chips.push({ id: o.call.id, name: o.call.name, label: o.label, ok: true });
          results.push({ type: "tool_result", tool_use_id: o.call.id, content: o.content });
          emit({ type: "tool", id: o.call.id, label: o.label, status: "done" });
        }
      }

      if (actions.length) {
        const round: ActionsContent = { order: toolUses.map((t) => t.id), results, actions };
        await thread.append([...(chips.length ? [{ role: "tools" as const, content: { items: chips } }] : []), { role: "actions", content: round }]);
        return; // Waiting for Confirm / Cancel.
      }
      await thread.append([
        { role: "tools", content: { items: chips } },
        { role: "user", content: results },
      ]);
    }

    const text = "That took more steps than expected, so the assistant paused here. Try again to let it keep going, or ask a narrower question.";
    await thread.append([{ role: "notice", content: { tone: "info", text, retry: true, retryLabel: "Keep going" } }]);
    emit({ type: "notice", tone: "info", text, retryText: "Keep going" });
  } catch (e) {
    const { text, retry } = describeError(e, actor);
    emit({ type: "reset" });
    await thread.append([{ role: "notice", content: { tone: "error", text, retry } }]);
    emit({ type: "notice", tone: "error", text, retryText: retry ? "Try again" : null });
  }
}

// ─── Confirm / Cancel ───────────────────────────────────────────────────────

const DECLINED_RESULT = "The person pressed Cancel, so nothing happened. Acknowledge it briefly and don't try again unless they ask.";

/**
 * Decides one waiting action. Approving prepares it again (so permission and
 * details are checked as of now) and runs it only if the card is unchanged.
 * Returns true when that was the round's last open action, so the turn
 * should continue with the results.
 */
export async function decideAction({ actor, thread, toolUseId, approve, emit }: { actor: Actor; thread: Thread; toolUseId: string; approve: boolean; emit: Emit }): Promise<boolean> {
  const claimed = await claimAction(thread, toolUseId);
  if (!claimed) {
    emit({ type: "fatal", message: "That action was already handled." });
    return false;
  }
  const { row, content } = claimed;
  const action = content.actions.find((a) => a.id === toolUseId)!;

  const finish = (status: ActionRecord["status"], outcome: string, result: Anthropic.ToolResultBlockParam, href: string | null = null) => {
    action.status = status;
    action.outcome = outcome;
    action.href = href;
    action.result = result;
  };

  if (!approve) {
    finish("declined", "Cancelled — nothing changed.", { type: "tool_result", tool_use_id: action.id, content: DECLINED_RESULT });
  } else {
    const checked = validateCall(action.name, action.input);
    const prepared = checked.ok ? await prepareWrite({ actor, now: new Date() }, checked.tool, checked.input) : null;
    if (!checked.ok || !prepared || !prepared.ok) {
      const why = !checked.ok ? checked.error : prepared && !prepared.ok ? prepared.error : "It couldn't be prepared again.";
      finish("failed", "Nothing changed — this can't be done right now. The assistant explains below.", {
        type: "tool_result",
        tool_use_id: action.id,
        is_error: true,
        content: `Nothing ran. When they confirmed, the action no longer worked: ${why}`,
      });
    } else if ((prepared.prepared.fingerprint ?? JSON.stringify(prepared.prepared.card)) !== (action.fingerprint ?? JSON.stringify(action.card))) {
      const fresh = prepared.prepared.card;
      finish("failed", "Nothing changed — the details were different by the time you confirmed.", {
        type: "tool_result",
        tool_use_id: action.id,
        is_error: true,
        content: `Nothing ran: things changed after the card was shown. It would now say: ${fresh.title}. ${fresh.details.join(" ")} If they still want it, call the tool again so they can confirm the new version.`,
      });
    } else {
      try {
        const done = await prepared.prepared.execute();
        finish("approved", done.outcome, { type: "tool_result", tool_use_id: action.id, content: JSON.stringify({ ...((done.data as object) ?? {}), done: true }) }, done.href);
        for (const path of done.revalidate ?? []) {
          try {
            revalidatePath(path.split("#")[0].split("?")[0]);
          } catch {
            // Pages here render per request anyway; the client refreshes too.
          }
        }
      } catch (e) {
        const text = e instanceof DomainError || e instanceof ToolError ? e.message : toolErrorText(e);
        if (!text) console.error(`[assistant] ${action.name} failed`, e);
        finish("failed", text ? `Couldn't finish: ${text}` : "Something went wrong, so nothing changed.", {
          type: "tool_result",
          tool_use_id: action.id,
          is_error: true,
          content: text ? `It failed: ${text}` : "It failed unexpectedly and nothing changed. Suggest doing it on the page instead.",
        });
      }
    }
  }

  await thread.updateRow(row.id, content);
  emit({ type: "action_result", id: action.id, status: action.status === "running" ? "pending" : action.status, outcome: action.outcome, href: action.href });

  if (content.actions.some((a) => a.status === "pending" || a.status === "running")) return false;
  await thread.append([{ role: "user", content: orderedResults(content) }]);
  return true;
}
