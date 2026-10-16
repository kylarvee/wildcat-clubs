"use client";

import { Loader2, RotateCcw, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useRunAction } from "@/components/roles/useRunAction";
import { restoreDefaults, restoreSeat, startDefaults } from "../actions";

/** Empty chart: create the native seats for this kind of club. */
export function StartDefaultsButton({ slug, clubId }: { slug: string; clubId: string }) {
  const { pending, run } = useRunAction();
  return (
    <Button onClick={() => run(() => startDefaults(slug, clubId), { success: "Your org chart is ready. Now fill the seats.", toastError: true })} disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
      Start from the default setup
    </Button>
  );
}

/** Bring back missing default seats and reset their wording. */
export function RestoreDefaultsButton({ slug, clubId }: { slug: string; clubId: string }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
          Restore defaults
        </Button>
      }
      title="Restore the default seats?"
      description="Missing or archived default seats come back, and the default seats' names, responsibilities and default permissions reset to the platform template. Your custom seats and everyone's roles stay exactly as they are."
      confirmLabel="Restore defaults"
      onConfirm={() => {
        void run(() => restoreDefaults(slug, clubId), { toastError: true, success: "Default seats restored." });
      }}
    />
  );
}

export function RestoreSeatButton({ slug, seatId, name }: { slug: string; seatId: string; name: string }) {
  const { pending, run } = useRunAction();
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => restoreSeat(slug, seatId), { success: `${name} is back on the org chart.`, toastError: true })}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Undo2 className="h-4 w-4" aria-hidden />}
      Restore
    </Button>
  );
}
