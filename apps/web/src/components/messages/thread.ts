import type { MessageView } from "@/lib/domain/messaging";
import type { DayGroup, GroupableMessage } from "@/components/messages/format";

/** Pure thread-state helpers for the open conversation (client-safe, unit-tested). */

/** A message in the open thread; `pending` ones are optimistic sends not confirmed yet. */
export type UiMessage = MessageView & { pending?: "sending" | "failed"; error?: string };

export const byTime = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Folds server messages into the thread (by id, oldest first) and keeps
 * unconfirmed sends at the end. A poll can bring back my own message before
 * the send call returns, so one matching "sending" copy is dropped then.
 */
export function mergeMessages(prev: UiMessage[], incoming: MessageView[], meId: string): UiMessage[] {
  if (!incoming.length) return prev;
  const confirmed = new Map<string, UiMessage>();
  const locals: UiMessage[] = [];
  for (const m of prev) {
    if (m.pending) locals.push(m);
    else confirmed.set(m.id, m);
  }
  const freshMine = incoming.filter((m) => m.author.id === meId && !confirmed.has(m.id)).map((m) => m.body);
  for (const m of incoming) confirmed.set(m.id, m);
  const keptLocals = locals.filter((l) => {
    if (l.pending !== "sending") return true;
    const i = freshMine.indexOf(l.body);
    if (i < 0) return true;
    freshMine.splice(i, 1);
    return false;
  });
  return [...[...confirmed.values()].sort(byTime), ...keptLocals];
}

/** Starts a new sender group at the first unread message, so the "New" line sits between groups. */
export function splitAtUnread<M extends GroupableMessage>(days: DayGroup<M>[], firstUnreadId: string | null): DayGroup<M>[] {
  if (!firstUnreadId) return days;
  return days.map((d) => ({
    ...d,
    groups: d.groups.flatMap((g) => {
      const i = g.messages.findIndex((m) => m.id === firstUnreadId);
      if (i <= 0) return [g];
      return [
        { ...g, messages: g.messages.slice(0, i) },
        { key: firstUnreadId, authorId: g.authorId, startedAt: g.messages[i].createdAt, messages: g.messages.slice(i) },
      ];
    }),
  }));
}
