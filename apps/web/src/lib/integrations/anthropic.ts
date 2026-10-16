import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { aiLive } from "@/lib/config";

/**
 * Claude for Wildcat Clubs — one client, one router.
 *
 * The spec allows Claude Haiku and Claude Sonnet only, routed dynamically:
 * Haiku for quick, short work; Sonnet for longer answers and anything that
 * takes several steps or acts on the platform. Both features (the assistant
 * and test-grading assist) are off until a sysadmin switches them on in
 * System settings AND ANTHROPIC_API_KEY is set — see aiLive().
 *
 * We deliberately don't enable server-side refusal fallbacks: they can route a
 * declined request to a model outside Haiku/Sonnet. A refusal is shown to the
 * user as "Claude couldn't help with that" instead.
 */
export const AI_MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
} as const;

export type AiModel = (typeof AI_MODELS)[keyof typeof AI_MODELS];

let client: Anthropic | null = null;

/** The shared client, or null when the feature is off or no key is configured. */
export async function getClaude(feature: "assistant" | "grading"): Promise<Anthropic | null> {
  if (!(await aiLive(feature))) return null;
  client ??= new Anthropic({ maxRetries: 2 });
  return client;
}

/** Test grading: short answers go to Haiku, long answers to Sonnet. */
export function routeGrading(questionType: "SHORT_ANSWER" | "LONG_ANSWER", answerText: string): AiModel {
  if (questionType === "LONG_ANSWER" || answerText.length > 1200) return AI_MODELS.sonnet;
  return AI_MODELS.haiku;
}

const ACTION_WORDS = /\b(create|make|set ?up|schedule|plan|add|invite|assign|promote|register|join|subscribe|submit|request|build|draft|update|change|move|cancel|approve|budget|fund|constitution|bylaws|election|org chart|recurring|every week)\b/i;

/**
 * Assistant routing. Sonnet when the request likely needs tools or several
 * steps (action verbs, long messages, an ongoing tool-using conversation);
 * Haiku for quick questions about how the platform works.
 */
export function routeAssistant(input: { message: string; turnsSoFar: number; lastTurnUsedTools: boolean }): AiModel {
  if (input.lastTurnUsedTools) return AI_MODELS.sonnet;
  if (input.message.length > 400) return AI_MODELS.sonnet;
  if (ACTION_WORDS.test(input.message)) return AI_MODELS.sonnet;
  if (input.turnsSoFar > 8) return AI_MODELS.sonnet;
  return AI_MODELS.haiku;
}
