"use client";

import { useState } from "react";
import { Archive, ArrowDown, ArrowUp, MoreVertical, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";

import { useRunAction } from "@/components/roles/useRunAction";
import { archiveSeat, moveSeat } from "../actions";
import { SeatDialog } from "./SeatDialog";
import type { SeatInfo, ToolContext } from "./types";

/** Seat-level actions for people with the `orgchart` capability. */
export function SeatMenu({ ctx, seat, isFirst, isLast }: { ctx: ToolContext; seat: SeatInfo; isFirst: boolean; isLast: boolean }) {
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const { pending, run } = useRunAction();
  const archiveBlock = seat.isCore ? "Core seats can't be archived" : seat.holders.length ? "End its holders' roles first" : null;

  const move = (d: "up" | "down") => run(() => moveSeat(ctx.slug, seat.id, d), { toastError: true });

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="-mr-2 -mt-1 h-8 w-8" aria-label={`Seat options for ${seat.name}`} disabled={pending}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden /> Edit seat
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isFirst} onSelect={() => void move("up")}>
            <ArrowUp className="h-4 w-4" aria-hidden /> Move earlier
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isLast} onSelect={() => void move("down")}>
            <ArrowDown className="h-4 w-4" aria-hidden /> Move later
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem danger disabled={Boolean(archiveBlock)} onSelect={() => setArchiving(true)}>
            <Archive className="h-4 w-4" aria-hidden /> {archiveBlock ?? "Archive seat"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing ? <SeatDialog ctx={ctx} seat={seat} open={editing} onOpenChange={setEditing} /> : null}
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive ${seat.name}?`}
        description="It comes off the org chart. Everyone who held it stays in the role history, and you can restore it later."
        confirmLabel="Archive seat"
        danger
        onConfirm={() => {
          void run(() => archiveSeat(ctx.slug, seat.id), { success: `${seat.name} archived.`, toastError: true });
        }}
      />
    </>
  );
}

/** "Add seat" button + dialog. */
export function AddSeatButton({ ctx }: { ctx: ToolContext }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> Add seat
      </Button>
      {open ? <SeatDialog ctx={ctx} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

