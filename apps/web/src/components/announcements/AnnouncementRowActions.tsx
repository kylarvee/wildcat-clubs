"use client";

import { useState } from "react";
import { Loader2, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type { ActionResult } from "@/lib/domain/kit";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { toast } from "@/components/ui/misc";

const OFFLINE = "We couldn't reach the server. Check your connection and try again.";

/** Edit, pin/unpin and delete for one announcement in a manager's list. The actions revalidate the list. */
export function AnnouncementRowActions({
  id,
  title,
  pinned,
  editHref,
  pinAction,
  deleteAction,
  pinHint,
}: {
  id: string;
  title: string;
  pinned: boolean;
  editHref: string;
  pinAction: (id: string, pinned: boolean) => Promise<ActionResult<{ pinned: boolean }>>;
  deleteAction: (id: string) => Promise<ActionResult<unknown>>;
  /** Where pinning shows it first, e.g. "on the club page". */
  pinHint: string;
}) {
  const [busy, setBusy] = useState<"pin" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function togglePin() {
    setBusy("pin");
    try {
      const r = await pinAction(id, !pinned);
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(r.data.pinned ? `Pinned. It shows first ${pinHint}.` : "Unpinned.");
      }
    } catch {
      toast.error(OFFLINE);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      const r = await deleteAction(id);
      if (!r.ok) toast.error(r.error);
      else {
        toast.success("Announcement deleted.");
      }
    } catch {
      toast.error(OFFLINE);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <ButtonLink href={editHref} variant="outline" size="sm">
        <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
      </ButtonLink>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More actions for “${title}”`} disabled={busy !== null}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => void togglePin()}>
            {pinned ? <PinOff className="h-4 w-4 text-ink-3" aria-hidden="true" /> : <Pin className="h-4 w-4 text-ink-3" aria-hidden="true" />}
            {pinned ? "Unpin" : "Pin to the top"}
          </DropdownMenuItem>
          <DropdownMenuItem danger onSelect={() => setTimeout(() => setConfirming(true), 0)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this announcement?"
        description={`“${title}” will be removed everywhere it shows. This can't be undone. Notifications already sent stay in people's inboxes.`}
        confirmLabel="Delete announcement"
        danger
        onConfirm={remove}
      />
    </div>
  );
}
