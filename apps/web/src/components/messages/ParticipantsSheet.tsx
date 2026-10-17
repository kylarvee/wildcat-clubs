"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, LogOut, MessageSquare, Search } from "lucide-react";
import type { ConversationDetail, Participant } from "@/lib/domain/messaging";
import { addGroupMembersAction, leaveGroupAction, renameGroupAction, startDirectAction } from "@/app/messages/actions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { toast } from "@/components/ui/misc";
import { LeaderPicker, type PickedLeader } from "@/components/messages/LeaderPicker";
import { useMessages } from "@/components/messages/context";
import { GROUP_MAX_MEMBERS, GROUP_TITLE_MAX_LENGTH } from "@/components/messages/format";

const OFFLINE = "We couldn't reach the server. Check your connection and try again.";

/** Who's in a conversation. Club chats link to the club; leader groups can be renamed, grown and left here. */
export function ParticipantsSheet({ detail, open, onOpenChange }: { detail: ConversationDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const title = detail.type === "CLUB" ? "Club chat" : detail.type === "DIRECT" ? "Conversation" : detail.name;
  const description =
    detail.type === "CLUB"
      ? `Everyone who's an active member or leader of ${detail.name} is in this chat. It follows the club's roster automatically.`
      : detail.type === "DIRECT"
        ? `Your direct messages with ${detail.name}.`
        : `A leader group with ${detail.participantCount} ${detail.participantCount === 1 ? "person" : "people"}.`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        {open ? <SheetBody detail={detail} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SheetBody({ detail, onClose }: { detail: ConversationDetail; onClose: () => void }) {
  const router = useRouter();
  const { refreshList } = useMessages();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return detail.participants;
    return detail.participants.filter((p) => p.name.toLowerCase().includes(t) || (p.label ?? "").toLowerCase().includes(t) || p.handle.toLowerCase().includes(t));
  }, [detail.participants, q]);

  // In club chats everyone shares the club, and leader-group members are all leaders, so a DM is allowed while you can post here.
  const canMessage = detail.type !== "DIRECT" && detail.canSend;

  async function messagePerson(p: Participant) {
    setBusy(p.id);
    try {
      const r = await startDirectAction(p.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onClose();
      router.push(`/messages/${r.data.id}`);
    } catch {
      toast.error(OFFLINE);
    } finally {
      setBusy(null);
    }
  }

  async function leave() {
    setLeaving(true);
    try {
      const r = await leaveGroupAction(detail.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`You left “${detail.name}”.`);
      onClose();
      refreshList();
      router.push("/messages");
    } catch {
      toast.error(OFFLINE);
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {detail.type === "CLUB" && detail.club ? (
        <ButtonLink href={`/clubs/${detail.club.slug}`} variant="outline" size="sm" onClick={onClose}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" /> Go to the {detail.club.name} page
        </ButtonLink>
      ) : null}

      {detail.type === "LEADERS_GROUP" && detail.canManageGroup ? <GroupSettings detail={detail} /> : null}

      <section aria-labelledby="participants-heading" className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="participants-heading" className="text-sm font-semibold text-ink">
            People <span className="font-normal text-ink-3">({detail.participantCount})</span>
          </h3>
        </div>
        {detail.participants.length > 8 ? (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find someone" aria-label="Find someone in this chat" className="h-9 pl-9" autoComplete="off" />
          </div>
        ) : null}
        {shown.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-3">No one here matches “{q.trim()}”.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {shown.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                <Avatar name={p.name} src={p.avatarUrl} color={p.avatarColor} size="sm" className="ring-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <Link href={`/u/${p.handle}`} onClick={onClose} className="truncate text-sm font-medium text-ink hover:underline">
                      {p.name}
                    </Link>
                    {p.isMe ? <Badge>You</Badge> : null}
                  </span>
                  {p.label ? <span className="block truncate text-xs text-ink-3">{p.label}</span> : null}
                </span>
                {canMessage && !p.isMe ? (
                  <Button variant="ghost" size="icon" onClick={() => void messagePerson(p)} disabled={busy !== null} aria-label={`Message ${p.name}`} title={`Message ${p.name}`}>
                    {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageSquare className="h-4 w-4" aria-hidden="true" />}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.type === "LEADERS_GROUP" ? (
        <div className="border-t border-line pt-4">
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm" className="text-danger" disabled={leaving}>
                {leaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />} Leave group
              </Button>
            }
            title={`Leave “${detail.name}”?`}
            description="The group disappears from your Messages and you stop getting its messages. Your past messages stay for everyone else. Someone in the group can add you back."
            confirmLabel="Leave group"
            danger
            onConfirm={leave}
          />
        </div>
      ) : null}
    </div>
  );
}

function GroupSettings({ detail }: { detail: ConversationDetail }) {
  const [title, setTitle] = useState(detail.name);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedLeader[]>([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const room = GROUP_MAX_MEMBERS - detail.participantCount;

  async function rename(e: FormEvent) {
    e.preventDefault();
    const next = title.trim();
    if (!next) {
      setNameError("The group needs a name.");
      return;
    }
    if (next === detail.name) return;
    setSavingName(true);
    setNameError(null);
    try {
      const r = await renameGroupAction(detail.id, next);
      if (r.ok) toast.success("Group renamed.");
      else setNameError(r.error);
    } catch {
      setNameError(OFFLINE);
    } finally {
      setSavingName(false);
    }
  }

  async function add() {
    if (!picked.length) return;
    setAdding(true);
    setAddError(null);
    try {
      const r = await addGroupMembersAction(
        detail.id,
        picked.map((p) => p.id),
      );
      if (!r.ok) {
        setAddError(r.error);
        return;
      }
      toast.success(r.data.added === 1 ? `Added ${picked[0].name}.` : `Added ${r.data.added} leaders.`);
      setPicked([]);
    } catch {
      setAddError(OFFLINE);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={rename} className="space-y-1.5" noValidate>
        <label htmlFor="group-name" className="block text-sm font-medium text-ink">
          Group name
        </label>
        <div className="flex gap-2">
          <Input
            id="group-name"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setNameError(null);
            }}
            maxLength={GROUP_TITLE_MAX_LENGTH}
            aria-invalid={nameError ? true : undefined}
          />
          <Button type="submit" variant="outline" disabled={savingName || title.trim() === detail.name}>
            {savingName ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Save
          </Button>
        </div>
        {nameError ? <p className="text-xs text-danger">{nameError}</p> : null}
      </form>

      {room > 0 ? (
        <div className="space-y-2">
          <LeaderPicker value={picked} onChange={setPicked} conversationId={detail.id} label="Add leaders" max={room} />
          {addError ? <p className="text-xs text-danger">{addError}</p> : null}
          {picked.length ? (
            <Button size="sm" onClick={() => void add()} disabled={adding}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Add {picked.length === 1 ? picked[0].name : `${picked.length} leaders`}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-ink-3">This group is full ({GROUP_MAX_MEMBERS} people).</p>
      )}
    </div>
  );
}
