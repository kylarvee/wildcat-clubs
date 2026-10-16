"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { acceptAdvisorInviteAction, declineAdvisorInviteAction } from "@/app/advisor/invite/[token]/actions";

export function InviteResponse({ token, clubName }: { token: string; clubName: string }) {
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
            const r = await acceptAdvisorInviteAction(token);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`You're now ${clubName}'s advisor`);
            router.push(`/clubs/${r.data.slug}/manage`);
          })
        }
      >
        {accepting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
        {accepting ? "Accepting…" : "Accept and become advisor"}
      </Button>
      <ConfirmDialog
        trigger={
          <Button size="lg" variant="outline" disabled={busy}>
            {declining ? "Declining…" : "Decline"}
          </Button>
        }
        title={`Decline advising ${clubName}?`}
        description="We'll let the students know so they can ask someone else. Thanks for considering it."
        confirmLabel="Decline"
        onConfirm={() =>
          startDecline(async () => {
            const r = await declineAdvisorInviteAction(token);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Invitation declined");
            router.refresh();
          })
        }
      />
    </div>
  );
}
