"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { startAmbassadorProgramAction } from "@/app/admin/clubs/actions";

export function StartAmbassadorProgram({ collegeId, collegeName }: { collegeId: string; collegeName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Start program
        </Button>
      }
      title={`Start an ambassador program for ${collegeName}?`}
      description="This creates the college's ambassador org, already approved, with President, VP and ambassador seats (Marketing, Inter-club coordination, Events, Club representatives). Students request to join; you or its advisor then name a President in its org chart."
      confirmLabel="Start program"
      onConfirm={() =>
        start(async () => {
          const r = await startAmbassadorProgramAction(collegeId);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Ambassador program started");
          router.push(`/clubs/${r.data.slug}/manage`);
        })
      }
    />
  );
}
