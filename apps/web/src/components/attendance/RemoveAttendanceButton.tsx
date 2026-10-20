"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { removeAttendanceAction } from "@/components/attendance/actions";

/** Takes a check-in off the list (a mistaken scan, the wrong person added). */
export function RemoveAttendanceButton({ attendanceId, name, eventTitle }: { attendanceId: string; name: string; eventTitle: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon" disabled={pending} aria-label={`Remove ${name}'s check-in`} title="Remove check-in">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
        </Button>
      }
      title={`Remove ${name}'s check-in?`}
      description={`They'll no longer count as attending ${eventTitle}. This also affects their attendance rate, review eligibility and any service hours it earned. You can add them back any time.`}
      confirmLabel="Remove check-in"
      danger
      onConfirm={() =>
        startTransition(async () => {
          const res = await removeAttendanceAction(attendanceId);
          if (res.ok) {
            toast.success(`Removed ${res.data.name}'s check-in`);
            router.refresh();
          } else toast.error(res.error);
        })
      }
    />
  );
}
