"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, MoreHorizontal, SlidersHorizontal, UserMinus } from "lucide-react";
import type { RoleEndReason } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { PermissionChecklist } from "@/components/roles/PermissionChecklist";
import { useRunAction } from "@/components/roles/useRunAction";
import { END_REASON_LABEL, MANUAL_END_REASONS } from "@/lib/roles/labels";
import { endRole, updatePermissions } from "../actions";
import type { ToolContext } from "./types";

export type HolderMenuProps = {
  ctx: ToolContext;
  seatName: string;
  holder: { assignmentId: string; name: string; permissions: string[] };
  canEditPermissions: boolean;
  canEnd: boolean;
  isSelf: boolean;
  /** The only sitting President can't step down without naming a successor. */
  mustHandOff: boolean;
  /** Ending your own leadership closes the workspace for you. */
  selfLeavesWorkspace: boolean;
};

/** Per-holder actions in the Org Chart tool: permissions, step down, end role. */
export function HolderMenu(p: HolderMenuProps) {
  const [dialog, setDialog] = useState<"permissions" | "end" | null>(null);
  if (!p.canEditPermissions && !p.canEnd && !p.isSelf) return null;
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="-mr-1 h-8 w-8" aria-label={`Options for ${p.holder.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>{p.holder.name}</DropdownMenuLabel>
          {p.canEditPermissions ? (
            <DropdownMenuItem onSelect={() => setDialog("permissions")}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden /> Edit permissions
            </DropdownMenuItem>
          ) : null}
          {(p.canEnd || p.isSelf) && p.canEditPermissions ? <DropdownMenuSeparator /> : null}
          {p.isSelf ? (
            <DropdownMenuItem danger disabled={p.mustHandOff} onSelect={() => setDialog("end")}>
              <LogOut className="h-4 w-4" aria-hidden /> {p.mustHandOff ? "Step down (hand off first)" : "Step down"}
            </DropdownMenuItem>
          ) : p.canEnd ? (
            <DropdownMenuItem danger disabled={p.mustHandOff} onSelect={() => setDialog("end")}>
              <UserMinus className="h-4 w-4" aria-hidden /> {p.mustHandOff ? "End role (use hand-off)" : "End role"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "permissions" ? <PermissionsDialog {...p} onClose={() => setDialog(null)} /> : null}
      {dialog === "end" ? <EndRoleDialog {...p} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function PermissionsDialog({ ctx, seatName, holder, onClose }: HolderMenuProps & { onClose: () => void }) {
  const [perms, setPerms] = useState(holder.permissions);
  const { pending, error, run } = useRunAction();
  async function save() {
    const r = await run(() => updatePermissions(ctx.slug, holder.assignmentId, perms), { success: `Saved ${holder.name}'s permissions.` });
    if (r.ok) onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${holder.name}'s permissions`} description={`What they can do as ${seatName}. Changes apply right away.`}>
        <PermissionChecklist options={ctx.capabilities} value={perms} onChange={setPerms} legend="Tool permissions" />
        {error ? (
          <Callout tone="danger" className="mt-4">
            {error}
          </Callout>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EndRoleDialog({ ctx, seatName, holder, isSelf, selfLeavesWorkspace, onClose }: HolderMenuProps & { onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState<RoleEndReason>(isSelf ? "RESIGNED" : "TERM_ENDED");
  const [note, setNote] = useState("");
  const { pending, error, run } = useRunAction();
  async function confirm() {
    const r = await run(() => endRole(ctx.slug, holder.assignmentId, reason, note), {
      success: isSelf ? `You've stepped down as ${seatName}.` : `${holder.name}'s role as ${seatName} ended.`,
    });
    if (r.ok) {
      onClose();
      if (isSelf && selfLeavesWorkspace) router.push(`/clubs/${ctx.slug}`);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={isSelf ? `Step down as ${seatName}?` : `End ${holder.name}'s role?`}
        description={isSelf ? "Your seat opens up for someone new. You stay a member of the club." : `${holder.name} stops being ${seatName} today and keeps their club membership.`}
      >
        <div className="space-y-4">
          {!isSelf ? (
            <Field label="Reason">
              {(id) => (
                <Select id={id} value={reason} onChange={(e) => setReason(e.target.value as RoleEndReason)}>
                  {MANUAL_END_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {END_REASON_LABEL[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Note (optional)" hint="Kept in the club's activity log. Not shown publicly.">
            {(id) => <Textarea id={id} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={isSelf ? "Anything the next person should know?" : "Why the role is ending"} />}
          </Field>
          <p className="text-sm text-ink-3">The role stays in the club&apos;s history with today&apos;s date.</p>
          {isSelf && selfLeavesWorkspace ? (
            <Callout tone="warning">This is your only leadership role here, so you&apos;ll lose access to the club workspace.</Callout>
          ) : null}
        </div>
        {error ? (
          <Callout tone="danger" className="mt-4">
            {error}
          </Callout>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {isSelf ? "Step down" : "End role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
