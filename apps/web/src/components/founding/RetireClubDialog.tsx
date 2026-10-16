"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox, Field, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { buttonClasses } from "@/components/ui/button";
import { retireClubAction } from "@/app/clubs/[slug]/manage/settings/actions";

/** Retire a club, with the consequences spelled out and a typed reason (stored on the decision trail). */
export function RetireClubDialog({ clubId, clubName, memberCount, founding, size = "md" }: { clubId: string; clubName: string; memberCount: number; founding: boolean; size?: "sm" | "md" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function retire() {
    setError(null);
    if (reason.trim().length < 5) return setError("Tell us briefly why the club is retiring.");
    start(async () => {
      const r = await retireClubAction(clubId, reason);
      if (!r.ok) return setError(r.error);
      toast.success(`${clubName} is retired`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setError(null);
          setUnderstood(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="danger" size={size}>
          <Archive className="h-4 w-4" aria-hidden /> {founding ? "Close this club draft" : "Retire club"}
        </Button>
      </DialogTrigger>
      <DialogContent title={`Retire ${clubName}?`} description="This can only be undone by WSUSA.">
        <div className="space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            <li>Every leadership role ends (recorded as “club retired”).</li>
            <li>{memberCount ? `All ${memberCount} member${memberCount === 1 ? "" : "s"} become alumni` : "Members become alumni"} and are notified.</li>
            <li>Future events are cancelled and open requests close.</li>
            <li>History, role history and files are kept, and the club page shows it as retired.</li>
          </ul>
          <Field label="Why is the club retiring?" required hint="Shared with WSUSA and kept on the club's record.">
            {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} placeholder="e.g. Our founding members graduated and no one is ready to lead next year." />}
          </Field>
          <Checkbox label="I understand what retiring does" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          {error ? <Callout tone="danger">{error}</Callout> : null}
        </div>
        <DialogFooter>
          <DialogClose className={buttonClasses("outline")}>Keep the club</DialogClose>
          <Button variant="danger" onClick={retire} disabled={!understood || pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {pending ? "Retiring…" : "Retire club"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
