"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { createDraftAction, deleteDraftAction } from "@/app/constitution/actions";

/** Starts a draft (optionally for a club, or copied from the draft behind its current documents) and opens it. */
export function NewDraftButton({
  clubId,
  fromDraftId,
  children,
  variant = "primary",
  size = "md",
}: {
  clubId?: string | null;
  fromDraftId?: string | null;
  children: React.ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      size={size}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await createDraftAction({ clubId: clubId ?? null, fromDraftId: fromDraftId ?? null });
          if (!r.ok) return void toast.error(r.error);
          router.push(`/constitution/${r.data.id}${clubId ? `?club=${clubId}` : ""}`);
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
      {pending ? "Starting…" : children}
    </Button>
  );
}

export function DeleteDraftButton({ draftId, title, adopted }: { draftId: string; title: string; adopted: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" disabled={busy} aria-label={`Delete ${title}`}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      }
      title={`Delete “${title}”?`}
      description={adopted ? "Documents you already adopted from it stay in effect and keep their PDFs — you just won't be able to edit this draft again." : "This can't be undone."}
      confirmLabel="Delete draft"
      danger
      onConfirm={async () => {
        setBusy(true);
        const r = await deleteDraftAction(draftId);
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        toast.success("Draft deleted");
        router.refresh();
      }}
    />
  );
}
