"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { useFormSubmit } from "@/components/founding/useFormSubmit";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { reinstateClubAction } from "@/app/admin/clubs/actions";

export function ReinstateForm({ clubId, approvedBefore }: { clubId: string; approvedBefore: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { pending, onSubmit } = useFormSubmit(async (fd) => {
    setError(null);
    const r = await reinstateClubAction({ clubId, note: String(fd.get("note") ?? "") });
    if (!r.ok) return setError(r.error);
    toast.success(r.data.status === "APPROVED" ? "Club reinstated" : "Club returned to draft");
    router.refresh();
  });
  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate aria-busy={pending}>
      <p className="text-sm text-ink-2">
        {approvedBefore
          ? "The club returns as approved. Leaders and members who were active when it retired get their seats and memberships back (graduates stay alumni)."
          : "This club was never approved, so it returns to draft for its founders to finish and submit."}
      </p>
      <Field label="Note to the club (optional)">{(id) => <Textarea id={id} name="note" rows={2} maxLength={2000} />}</Field>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
        {pending ? "Reinstating…" : "Reinstate club"}
      </Button>
    </form>
  );
}
