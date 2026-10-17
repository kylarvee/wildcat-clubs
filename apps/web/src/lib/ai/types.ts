/**
 * Shapes shared by the assistant's server loop (lib/ai/loop.ts) and its UI
 * (components/assistant). Client-safe: no server imports.
 *
 * The UI never sees raw Anthropic content blocks. The server turns stored
 * messages into a ChatView (what to draw) and streams StreamEvents while a
 * turn is running; the final `done` event carries the fresh ChatView.
 */

/** Which Claude model wrote an answer, shown as a small tag. */
export type ModelTag = "haiku" | "sonnet";

export const MODEL_LABEL: Record<ModelTag, string> = { haiku: "Haiku", sonnet: "Sonnet" };

/** What a pending action will do, shown before the person confirms. */
export type ActionCard = {
  /** "Join Chess Club" */
  title: string;
  /** Each line is one concrete effect, in plain words. */
  details: string[];
  /** Text that will be posted or saved word for word (an announcement body), shown in a scrollable box. */
  preview?: { label: string; text: string };
  /** Button text, e.g. "Join club". */
  confirmLabel: string;
};

export type ActionStatus = "pending" | "approved" | "declined" | "failed";
export type ToolStatus = "running" | "done" | "error";

export type ChatPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; label: string; status: ToolStatus }
  | { kind: "action"; id: string; card: ActionCard; status: ActionStatus; outcome: string | null; href: string | null };

export type NoticeTone = "refusal" | "error" | "info";

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; models: ModelTag[]; parts: ChatPart[] }
  | { kind: "notice"; id: string; tone: NoticeTone; text: string; retryText: string | null };

export type ChatView = {
  id: string;
  title: string;
  items: ChatItem[];
  /** Actions still waiting for Confirm / Cancel. */
  pending: number;
  updatedAt: string;
};

export type ConversationSummary = { id: string; title: string; updatedAt: string };

/** A suggested first message, tailored to the person's role. */
export type StarterPrompt = { label: string; prompt: string };

/** Server-sent events from POST /api/assistant and /api/assistant/confirm. */
export type StreamEvent =
  | { type: "start"; conversationId: string; title: string }
  | { type: "model"; model: ModelTag }
  | { type: "text"; delta: string }
  /** Drop what was streamed since the last `model` event — text and chips (a refusal, or the request is being re-sent). */
  | { type: "reset" }
  | { type: "tool"; id: string; label: string; status: ToolStatus }
  | { type: "action"; id: string; card: ActionCard }
  | { type: "action_result"; id: string; status: ActionStatus; outcome: string | null; href: string | null }
  | { type: "notice"; tone: NoticeTone; text: string; retryText: string | null }
  | { type: "done"; view: ChatView }
  /** The turn couldn't run at all (feature off, busy, bad request). */
  | { type: "fatal"; message: string };

/** Longest message a person can send in one go. */
export const MAX_USER_MESSAGE = 4000;
