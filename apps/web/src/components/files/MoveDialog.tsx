"use client";

import { useMemo, useState } from "react";
import { FolderInput, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { descendantsOf, FolderTree } from "@/components/files/FolderTree";
import type { FolderNode } from "@/lib/files/types";

/** "Move to…": choose a folder in the same space. Folders being moved (and what's inside them) can't be chosen. */
export function MoveDialog({
  open,
  onOpenChange,
  names,
  movingIds,
  currentParentId,
  tree,
  rootLabel,
  canUseRoot,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What's moving, for the title. */
  names: string[];
  movingIds: string[];
  currentParentId: string | null;
  tree: FolderNode[];
  rootLabel: string;
  canUseRoot: boolean;
  onMove: (targetId: string | null) => Promise<boolean>;
}) {
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const disabled = useMemo(() => {
    const blocked = descendantsOf(tree, movingIds);
    for (const n of tree) if (!n.canEdit) blocked.add(n.id);
    return blocked;
  }, [tree, movingIds]);

  const title = names.length === 1 ? `Move “${names[0]}”` : `Move ${names.length} items`;
  const same = target !== undefined && target === currentParentId;
  const chosenName = target === null ? rootLabel : target ? (tree.find((n) => n.id === target)?.name ?? "") : "";

  async function submit() {
    if (target === undefined || same) return;
    setBusy(true);
    const ok = await onMove(target);
    setBusy(false);
    if (ok) {
      setTarget(undefined);
      onOpenChange(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTarget(undefined);
        onOpenChange(o);
      }}
    >
      <DialogContent title={title} description="Choose a folder. Items set to “Same as folder” take on the new folder's sharing.">
        <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-line p-2">
          <FolderTree nodes={tree} rootLabel={rootLabel} activeId={target} onChoose={setTarget} disabled={disabled} rootDisabled={!canUseRoot} label="Destination folders" />
        </div>
        <p className="mt-3 min-h-5 text-sm text-ink-3" aria-live="polite">
          {target === undefined ? "Pick where these should go." : same ? "They're already in this folder." : `Moving to ${chosenName}.`}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || target === undefined || same}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FolderInput className="h-4 w-4" aria-hidden />}
            Move here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
