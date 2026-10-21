"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { acceptCofounderInviteAction, declineCofounderInviteAction } from "@/app/cofounder/[token]/actions";

/** Accept or decline a co-founder invitation (/cofounder/[token]). */
export function CofounderInviteResponse({ token, clubName }: { token: string; clubName: string }) {
  const router = useRouter();
  const [accepting, startAccept] = useTransition();
  const [declining, startDecline] = useTransition();
  const busy = accepting || declining;
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="lg"
        disabled={busy}
        onClick={() =>
          startAccept(async () => {
            const r = await acceptCofounderInviteAction(token);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`You're on ${clubName}'s founding team`, { description: "A founder can give you a seat on the org chart now." });
            router.push(`/clubs/${r.data.slug}`);
          })
        }
      >
        {accepting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
        {accepting ? "Joining…" : "Accept and join the founding team"}
      </Button>
      <ConfirmDialog
        trigger={
          <Button size="lg" variant="outline" disabled={busy}>
            {declining ? "Declining…" : "Decline"}
          </Button>
        }
        title={`Decline helping start ${clubName}?`}
        description="We'll let the founders know. Thanks for considering it."
        confirmLabel="Decline"
        onConfirm={() =>
          startDecline(async () => {
            const r = await declineCofounderInviteAction(token);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Invitation declined");
            router.refresh();
          })
        }
      />
    </div>
  );
}
