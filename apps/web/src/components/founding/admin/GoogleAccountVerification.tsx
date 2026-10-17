"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { verifyGoogleAccountAction } from "@/app/admin/clubs/actions";

/** Verify (or withdraw verification of) the club's Google account, the address Google sync runs as. */
export function GoogleAccountVerification({ clubId, email, verified }: { clubId: string; email: string; verified: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (next: boolean) =>
    start(async () => {
      const r = await verifyGoogleAccountAction({ clubId, email, verified: next });
      if (!r.ok) return void toast.error(r.error);
      toast.success(next ? "Google account verified" : "Verification removed");
      router.refresh();
    });
  const icon = pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />;
  if (verified) {
    return (
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="outline" disabled={pending}>
            {icon} Remove verification
          </Button>
        }
        title="Remove verification?"
        description="Google Drive, Calendar and Chat sync stop running as this account until it's verified again. Copies already in Google stay there."
        confirmLabel="Remove verification"
        danger
        onConfirm={() => run(false)}
      />
    );
  }
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="secondary" disabled={pending}>
          {icon} Verify account
        </Button>
      }
      title={`Verify ${email}?`}
      description="Only verify an account WSU IT set up for this club. Once Google sync is on, the platform creates and shares the club's Drive files, calendar and Chat space as this account."
      confirmLabel="Verify account"
      onConfirm={() => run(true)}
    />
  );
}
