"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowDown, ArrowLeft, Copy, ExternalLink, Loader2, Lock, MoreHorizontal, Pencil, Trash2, Users } from "lucide-react";
import type { ConversationDetail, MessageView, ThreadPage, ThreadPoll } from "@/lib/domain/messaging";
import { deleteMessageAction, editMessageAction, markReadAction, sendMessageAction } from "@/app/messages/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { toast } from "@/components/ui/misc";
import { Composer } from "@/components/messages/Composer";
import { ConversationAvatar } from "@/components/messages/ConversationAvatar";
import { MessageText } from "@/components/messages/MessageText";
import { useMessages } from "@/components/messages/context";
import { byTime, mergeMessages, splitAtUnread, type UiMessage } from "@/components/messages/thread";
import { ParticipantsSheet } from "@/components/messages/ParticipantsSheet";
import {
  MESSAGE_MAX_LENGTH,
  dayLabel,
  firstName,
  fullTimeLabel,
  groupMessages,
  messageBodyProblem,
  normalizeMessageBody,
  timeLabel,
} from "@/components/messages/format";

/**
 * One open conversation: header, messages grouped by day and sender, and the
 * composer. Sends show at once and settle when the server confirms; new
 * messages, edits and deletions arrive by polling every few seconds
 * (GET /api/messages/<id>?after=…), and the thread marks itself read while
 * you're looking at the latest messages.
 */

type Row = UiMessage & { authorId: string };

const POLL_MS = 3000;
const MAX_POLL_MS = 30_000;
/** "At the bottom" allows a little slack so a few pixels of scroll don't stop auto-scrolling. */
const BOTTOM_SLACK = 80;
const OFFLINE = "We couldn't reach the server. Check your connection and try again.";

export function ConversationView({ detail, initial, policy }: { detail: ConversationDetail; initial: ThreadPage; policy?: ReactNode }) {
  const { me, noteMessage, markSeen } = useMessages();
  const id = detail.id;

  const [messages, setMessages] = useState<UiMessage[]>(initial.messages);
  const [hasOlder, setHasOlder] = useState(initial.hasOlder);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sendState, setSendState] = useState({ canSend: detail.canSend, reason: detail.readOnlyReason });
  const [gone, setGone] = useState<"missing" | "signedOut" | null>(null);
  const [newBelow, setNewBelow] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<UiMessage | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);

  // The "New" line marks where unread started when you opened the chat, and stays put for this visit.
  const [firstUnreadId] = useState<string | null>(() => {
    if (!detail.readMarker) return null;
    return initial.messages.find((m) => m.author.id !== me.id && !m.deleted && m.createdAt > detail.readMarker!)?.id ?? null;
  });

  const cursor = useRef(initial.cursor);
  const knownIds = useRef(new Set(initial.messages.map((m) => m.id)));
  /** Last version seen of each message, so a poll that re-sends an unchanged message (the cursor overlaps) changes nothing. */
  const versions = useRef(new Map(initial.messages.map((m) => [m.id, `${m.editedAt}|${m.deleted}`])));
  const remember = useCallback((m: MessageView) => {
    knownIds.current.add(m.id);
    versions.current.set(m.id, `${m.editedAt}|${m.deleted}`);
  }, []);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const stick = useRef(true);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  const seq = useRef(0);

  // A server refresh (e.g. you were removed from the club) can change whether you may post.
  useEffect(() => setSendState({ canSend: detail.canSend, reason: detail.readOnlyReason }), [detail.canSend, detail.readOnlyReason]);

  // ─── Read state ────────────────────────────────────────────────────────────
  const markTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendRead = useCallback(() => {
    markSeen(id);
    markReadAction(id).catch(() => undefined);
  }, [id, markSeen]);
  const markRead = useCallback(() => {
    if (markTimer.current) return;
    markTimer.current = setTimeout(() => {
      markTimer.current = null;
      sendRead();
    }, 600);
  }, [sendRead]);

  useEffect(() => {
    sendRead();
    return () => {
      if (markTimer.current) clearTimeout(markTimer.current);
    };
  }, [sendRead]);

  // ─── Incoming messages ─────────────────────────────────────────────────────
  const applyIncoming = useCallback(
    (all: MessageView[]) => {
      const incoming = all.filter((m) => versions.current.get(m.id) !== `${m.editedAt}|${m.deleted}`);
      if (!incoming.length) return;
      for (const m of incoming) versions.current.set(m.id, `${m.editedAt}|${m.deleted}`);
      const fresh = incoming.filter((m) => !knownIds.current.has(m.id));
      for (const m of incoming) knownIds.current.add(m.id);
      stick.current = atBottom.current;
      setMessages((prev) => mergeMessages(prev, incoming, me.id));
      const newest = [...incoming].sort(byTime).at(-1);
      if (newest) noteMessage(id, newest);
      const fromOthers = fresh.filter((m) => m.author.id !== me.id).length;
      if (!fromOthers) return;
      if (atBottom.current && !document.hidden) markRead();
      else setNewBelow((n) => n + fromOthers);
    },
    [id, me.id, markRead, noteMessage],
  );

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let busy = false;

    async function tick() {
      if (stopped || busy) return;
      if (document.hidden) return schedule();
      busy = true;
      try {
        const res = await fetch(`/api/messages/${encodeURIComponent(id)}?after=${encodeURIComponent(cursor.current)}`, { cache: "no-store" });
        if (res.status === 404 || res.status === 401) {
          setGone(res.status === 401 ? "signedOut" : "missing");
          stopped = true;
          return;
        }
        const json = (await res.json()) as { ok: boolean; data?: ThreadPoll };
        if (!json.ok || !json.data) throw new Error("poll failed");
        if (stopped) return;
        failures = 0;
        cursor.current = json.data.cursor;
        applyIncoming(json.data.messages);
        setSendState((s) => (s.canSend === json.data!.canSend && s.reason === json.data!.readOnlyReason ? s : { canSend: json.data!.canSend, reason: json.data!.readOnlyReason }));
      } catch {
        failures++;
      } finally {
        busy = false;
      }
      schedule();
    }
    function schedule() {
      if (stopped) return;
      clearTimeout(timer);
      // Back off while the connection is down, then return to every 3 seconds.
      timer = setTimeout(tick, Math.min(POLL_MS * 2 ** failures, MAX_POLL_MS));
    }
    function onVisible() {
      if (document.hidden) return;
      clearTimeout(timer);
      void tick();
      if (atBottom.current) markRead();
    }
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, applyIncoming, markRead]);

  // ─── Scrolling ─────────────────────────────────────────────────────────────
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // First view: start at the "New" line when there's more unread than fits, otherwise at the latest message.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const divider = el.querySelector<HTMLElement>("[data-unread-divider]");
    if (divider) {
      const offset = divider.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      if (el.scrollHeight - offset > el.clientHeight) {
        el.scrollTop = Math.max(0, offset - 12);
        atBottom.current = false;
        stick.current = false;
        return;
      }
    }
    el.scrollTop = el.scrollHeight;
    // Mount-only: later updates are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prepend.current) {
      // Keep the message you were reading in place when older ones load above it.
      el.scrollTop = el.scrollHeight - prepend.current.height + prepend.current.top;
      prepend.current = null;
      return;
    }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
    atBottom.current = bottom;
    stick.current = bottom;
    if (bottom && newBelow) {
      setNewBelow(0);
      markRead();
    }
  }

  async function loadOlder() {
    const oldest = messages.find((m) => !m.pending);
    const el = scroller.current;
    if (!oldest || !el || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(id)}?before=${encodeURIComponent(oldest.createdAt)}`, { cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; data?: ThreadPage; error?: string };
      if (!json.ok || !json.data) {
        toast.error(json.error ?? "Earlier messages didn't load. Please try again.");
        return;
      }
      for (const m of json.data.messages) remember(m);
      prepend.current = { height: el.scrollHeight, top: el.scrollTop };
      stick.current = false;
      setMessages((prev) => mergeMessages(prev, json.data!.messages, me.id));
      setHasOlder(json.data.hasOlder);
    } catch {
      toast.error(OFFLINE);
    } finally {
      setLoadingOlder(false);
    }
  }

  // ─── Sending, editing, deleting ────────────────────────────────────────────
  const deliver = useCallback(
    async (local: UiMessage) => {
      let r: Awaited<ReturnType<typeof sendMessageAction>>;
      try {
        r = await sendMessageAction(id, local.body);
      } catch {
        r = { ok: false, error: OFFLINE, code: "ERROR" };
      }
      if (r.ok) {
        const sent = r.data;
        remember(sent);
        setMessages((prev) => mergeMessages(prev.filter((m) => m.id !== local.id), [sent], me.id));
        noteMessage(id, sent);
      } else {
        const error = r.error;
        setMessages((prev) => prev.map((m) => (m.id === local.id ? { ...m, pending: "failed", error } : m)));
        if (r.code === "FORBIDDEN") setSendState({ canSend: false, reason: error });
      }
    },
    [id, me.id, noteMessage, remember],
  );

  function send(body: string) {
    const local: UiMessage = {
      id: `local-${Date.now()}-${++seq.current}`,
      conversationId: id,
      author: me,
      body,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deleted: false,
      pending: "sending",
    };
    stick.current = true;
    setNewBelow(0);
    setMessages((prev) => [...prev, local]);
    void deliver(local);
  }

  function retry(m: UiMessage) {
    stick.current = atBottom.current;
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, pending: "sending", error: undefined } : x)));
    void deliver({ ...m, pending: "sending" });
  }

  function discard(m: UiMessage) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
  }

  function replace(m: MessageView) {
    remember(m);
    stick.current = false;
    setMessages((prev) => mergeMessages(prev, [m], me.id));
    noteMessage(id, m);
  }

  async function confirmDelete() {
    const m = deleting;
    if (!m) return;
    setDeleting(null);
    try {
      const r = await deleteMessageAction(m.id);
      if (r.ok) replace(r.data);
      else toast.error(r.error);
    } catch {
      toast.error(OFFLINE);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  const days = useMemo(() => splitAtUnread(groupMessages<Row>(messages.map((m) => ({ ...m, authorId: m.author.id }))), firstUnreadId), [messages, firstUnreadId]);

  const subtitle =
    detail.type === "CLUB"
      ? `Club chat · ${detail.participantCount} ${detail.participantCount === 1 ? "person" : "people"}`
      : detail.type === "DIRECT"
        ? (detail.other?.context ?? "Direct message")
        : `Leader group · ${detail.participantCount} ${detail.participantCount === 1 ? "person" : "people"}`;
  const placeholder = detail.type === "CLUB" ? `Message ${detail.name}` : detail.type === "DIRECT" ? `Message ${firstName(detail.name)}` : `Message “${detail.name}”`;
  const beginning =
    detail.type === "CLUB"
      ? `This is the beginning of the ${detail.name} chat. Everyone in the club can see it.`
      : detail.type === "DIRECT"
        ? `This is the beginning of your conversation with ${detail.name}.`
        : `This is the beginning of “${detail.name}”.`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-2 py-2.5 sm:px-4">
        <Link href="/messages" className="rounded-lg p-2 text-ink-2 hover:bg-muted hover:text-ink md:hidden" aria-label="Back to all conversations">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <ConversationAvatar type={detail.type} club={detail.club} person={detail.other} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-ink">
            {detail.type === "DIRECT" && detail.other ? (
              <Link href={`/u/${detail.other.handle}`} className="hover:underline">
                {detail.name}
              </Link>
            ) : (
              detail.name
            )}
          </h2>
          <p className="truncate text-xs text-ink-3">{subtitle}</p>
        </div>
        {detail.type === "CLUB" && detail.club ? (
          <ButtonLink href={`/clubs/${detail.club.slug}`} variant="ghost" size="sm" className="hidden sm:inline-flex">
            <ExternalLink className="h-4 w-4" aria-hidden="true" /> Club page
          </ButtonLink>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setPeopleOpen(true)} aria-label={`People in this conversation (${detail.participantCount})`}>
          <Users className="h-4 w-4" aria-hidden="true" />
          <span className="tabular-nums" aria-hidden="true">
            {detail.participantCount}
          </span>
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 sm:px-4" role="log" aria-label={`Messages in ${detail.name}`} aria-relevant="additions">
          {hasOlder ? (
            <div className="flex justify-center pb-1 pt-4">
              <Button variant="outline" size="sm" onClick={() => void loadOlder()} disabled={loadingOlder}>
                {loadingOlder ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {loadingOlder ? "Loading…" : "Load earlier messages"}
              </Button>
            </div>
          ) : (
            <p className="px-4 pb-1 pt-6 text-center text-xs text-ink-3">{beginning}</p>
          )}

          {messages.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <ConversationAvatar type={detail.type} club={detail.club} person={detail.other} />
              <p className="mt-3 font-medium text-ink">No messages yet</p>
              <p className="mt-1 max-w-sm text-sm text-ink-3">
                {sendState.canSend
                  ? detail.type === "DIRECT"
                    ? `Say hello to ${firstName(detail.name)}.`
                    : detail.type === "CLUB"
                      ? `Start the conversation with ${detail.name}.`
                      : "Kick things off with the group."
                  : "Nothing has been posted here."}
              </p>
            </div>
          ) : null}

          {days.map((day) => (
            <section key={day.day} aria-label={dayLabel(day.startedAt)}>
              <div className="sticky top-0 z-10 flex justify-center py-2">
                <span className="rounded-full border border-line bg-surface/95 px-3 py-0.5 text-xs font-medium text-ink-2 shadow-sm backdrop-blur" suppressHydrationWarning>
                  {dayLabel(day.startedAt)}
                </span>
              </div>
              {day.groups.map((g) => {
                const author = g.messages[0].author;
                const mine = author.id === me.id;
                return (
                  <div key={g.key}>
                    {g.messages[0].id === firstUnreadId ? (
                      <div data-unread-divider className="my-2 flex items-center gap-3" role="separator" aria-label="New messages">
                        <span className="h-px flex-1 bg-brand-200" />
                        <span className="text-xs font-semibold uppercase tracking-wide text-brand">New</span>
                        <span className="h-px flex-1 bg-brand-200" />
                      </div>
                    ) : null}
                    <div className="flex gap-3 px-1 py-1.5">
                      <Link href={`/u/${author.handle}`} tabIndex={-1} aria-hidden="true" className="mt-0.5 shrink-0">
                        <Avatar name={author.name} src={author.avatarUrl} color={author.avatarColor} size="sm" className="ring-0" />
                      </Link>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-x-2">
                          <Link href={`/u/${author.handle}`} className="text-sm font-semibold text-ink hover:underline">
                            {mine ? "You" : author.name}
                          </Link>
                          <time dateTime={g.startedAt} title={fullTimeLabel(g.startedAt)} className="text-xs text-ink-3">
                            {timeLabel(g.startedAt)}
                          </time>
                        </p>
                        <ul>
                          {g.messages.map((m) => (
                            <MessageRow
                              key={m.id}
                              m={m}
                              mine={mine}
                              canSend={sendState.canSend && !gone}
                              editing={editingId === m.id}
                              onEdit={() => setEditingId(m.id)}
                              onCancelEdit={() => setEditingId(null)}
                              onSaved={(saved) => {
                                setEditingId(null);
                                replace(saved);
                              }}
                              onDelete={() => setDeleting(m)}
                              onRetry={() => retry(m)}
                              onDiscard={() => discard(m)}
                            />
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        {newBelow > 0 ? (
          <button
            type="button"
            onClick={() => {
              setNewBelow(0);
              scrollToBottom(true);
              markRead();
            }}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-[var(--shadow-pop)] hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            {newBelow === 1 ? "1 new message" : `${newBelow} new messages`}
          </button>
        ) : null}
      </div>

      {gone ? (
        <div className="shrink-0 border-t border-line bg-muted/60 px-4 py-3 text-sm text-ink-2" role="status">
          {gone === "signedOut" ? (
            <>
              <span className="font-medium text-ink">You&apos;ve been signed out.</span>{" "}
              <a href={`/login?next=${encodeURIComponent(`/messages/${id}`)}`} className="font-medium text-brand-600 hover:underline">
                Sign in again
              </a>{" "}
              to keep chatting.
            </>
          ) : (
            <>
              <span className="font-medium text-ink">This conversation isn&apos;t available anymore.</span>{" "}
              <Link href="/messages" className="font-medium text-brand-600 hover:underline">
                Back to Messages
              </Link>
            </>
          )}
        </div>
      ) : sendState.canSend ? (
        <Composer conversationId={id} placeholder={placeholder} onSend={send} policy={policy} />
      ) : (
        <div className="flex shrink-0 items-start gap-2 border-t border-line bg-muted/60 px-4 py-3 text-sm text-ink-2" role="status">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
          <span>{sendState.reason ?? "You can read this conversation but not post in it."}</span>
        </div>
      )}

      <ParticipantsSheet detail={detail} open={peopleOpen} onOpenChange={setPeopleOpen} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete this message?"
        description="It's removed for everyone. The chat shows “Message deleted” in its place."
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function MessageRow({
  m,
  mine,
  canSend,
  editing,
  onEdit,
  onCancelEdit,
  onSaved,
  onDelete,
  onRetry,
  onDiscard,
}: {
  m: UiMessage;
  mine: boolean;
  canSend: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (m: MessageView) => void;
  onDelete: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const settled = !m.pending;
  const showMenu = settled && !m.deleted && !editing;

  async function copy() {
    try {
      await navigator.clipboard.writeText(m.body);
      toast.success("Copied.");
    } catch {
      toast.error("Your browser didn't allow copying.");
    }
  }

  return (
    <li className={cn("group/msg relative -mx-2 rounded-lg px-2 py-0.5", !editing && "hover:bg-muted/60 focus-within:bg-muted/60")} title={settled ? fullTimeLabel(m.createdAt) : undefined}>
      {editing ? (
        <EditBox message={m} onCancel={onCancelEdit} onSaved={onSaved} />
      ) : m.deleted ? (
        <p className="text-sm italic text-ink-3">Message deleted</p>
      ) : (
        <MessageText
          body={m.body}
          className={cn("pr-8", m.pending === "sending" && "text-ink-3")}
          suffix={
            m.editedAt ? (
              <span className="ml-1.5 text-xs text-ink-3" title={`Edited ${fullTimeLabel(m.editedAt)}`}>
                (edited)
              </span>
            ) : null
          }
        />
      )}
      {m.pending === "sending" ? (
        <p className="text-xs text-ink-3" role="status">
          Sending…
        </p>
      ) : null}
      {m.pending === "failed" ? (
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-danger" role="alert">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Not sent. {m.error}</span>
          <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2 hover:text-red-800">
            Try again
          </button>
          <button type="button" onClick={onDiscard} className="font-semibold underline underline-offset-2 hover:text-red-800">
            Remove
          </button>
        </p>
      ) : null}
      {showMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Message options"
              className="absolute right-1 top-0.5 rounded-md p-1 text-ink-3 opacity-0 hover:bg-surface hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-brand group-hover/msg:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => void copy()}>
              <Copy className="h-4 w-4 text-ink-3" aria-hidden="true" /> Copy text
            </DropdownMenuItem>
            {mine && canSend ? (
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil className="h-4 w-4 text-ink-3" aria-hidden="true" /> Edit
              </DropdownMenuItem>
            ) : null}
            {mine ? (
              <DropdownMenuItem danger onSelect={() => setTimeout(onDelete, 0)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

function EditBox({ message, onCancel, onSaved }: { message: UiMessage; onCancel: () => void; onSaved: (m: MessageView) => void }) {
  const [text, setText] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  async function save() {
    const body = normalizeMessageBody(text);
    const problem = messageBodyProblem(body);
    if (problem) {
      setError(body ? problem : "A message can't be empty. Delete it instead.");
      return;
    }
    if (body === message.body) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await editMessageAction(message.id, body);
      if (r.ok) onSaved(r.data);
      else setError(r.error);
    } catch {
      setError(OFFLINE);
    } finally {
      setSaving(false);
    }
  }

  const over = normalizeMessageBody(text).length > MESSAGE_MAX_LENGTH;
  return (
    <div className="py-1">
      <label htmlFor={`edit-${message.id}`} className="sr-only">
        Edit message
      </label>
      <textarea
        ref={ref}
        id={`edit-${message.id}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          }
        }}
        rows={1}
        aria-invalid={over || Boolean(error) || undefined}
        className="w-full resize-none rounded-lg border border-line-2 bg-surface px-3 py-2 text-sm leading-relaxed text-ink shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving || over}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <span className="text-xs text-ink-3">Enter to save · Esc to cancel</span>
      </div>
    </div>
  );
}
