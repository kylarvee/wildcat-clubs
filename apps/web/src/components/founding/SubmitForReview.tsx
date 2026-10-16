"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { submitForReviewAction } from "@/components/founding/actions";

/** The last step of founding. Disabled (with the reasons) until the checklist is done. */
export function SubmitForReview({ clubId, clubName, ready, resubmission, reviewDays }: { clubId: string; clubName: string; ready: boolean; resubmission: boolean; reviewDays: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const label = resubmission ? "Resubmit to WSUSA" : "Submit to WSUSA";

  if (!ready) {
    return (
      <Button disabled aria-describedby="submit-blocked">
        <Send className="h-4 w-4" aria-hidden /> {label}
      </Button>
    );
  }
  return (
    <ConfirmDialog
      trigger={
        <Button disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          {pending ? "Submitting…" : label}
        </Button>
      }
      title={`Send ${clubName} to WSUSA?`}
      description={`A WSUSA reviewer will read your profile, advisor and documents, usually within ${reviewDays} days. You can keep editing your profile while you wait, and you'll get a notification and email when they decide.`}
      confirmLabel={label}
      onConfirm={() =>
        start(async () => {
          const r = await submitForReviewAction(clubId);
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success("Submitted! WSUSA has your club.");
          router.refresh();
        })
      }
    />
  );
}
