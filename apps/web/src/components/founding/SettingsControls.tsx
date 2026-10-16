"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { useFormSubmit } from "@/components/founding/useFormSubmit";
import { Switch, toast } from "@/components/ui/misc";
import { leaveClubAction, setAutoApproveCohostsAction, setContactEmailAction } from "@/app/clubs/[slug]/manage/settings/actions";

export function CohostToggle({ clubId, on, disabled }: { clubId: string; on: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(on);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor="auto-cohost" className="text-sm">
        <span className="block font-medium text-ink">Automatically accept co-host requests</span>
        <span className="block text-ink-3">When another club tags yours on an event, it goes straight onto your calendar. Off by default — a leader with the Events permission approves each one.</span>
      </label>
      <Switch
        id="auto-cohost"
        checked={value}
        disabled={disabled || pending}
        onCheckedChange={(next) => {
          setValue(next);
          start(async () => {
            const r = await setAutoApproveCohostsAction(clubId, next);
            if (!r.ok) {
              setValue(!next);
              toast.error(r.error);
            } else {
              toast.success(next ? "Co-host requests will be accepted automatically" : "Leaders will approve co-host requests");
              router.refresh();
            }
          });
        }}
      />
    </div>
  );
}

export function ContactEmailForm({ clubId, email }: { clubId: string; email: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(email ?? "");
  const [error, setError] = useState<string | null>(null);
  const { pending, onSubmit } = useFormSubmit(async () => {
    setError(null);
    const r = await setContactEmailAction(clubId, value);
    if (!r.ok) return setError(r.error);
    setValue(r.data.contactEmail ?? "");
    toast.success(r.data.contactEmail ? "Club Google account saved" : "Club Google account removed");
    router.refresh();
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate aria-busy={pending}>
      <Field label="Club Google account" className="flex-1" error={error} hint={!error ? "The shared account your club uses. When WSU turns on Google sync, Drive, Calendar and Chat run as this account." : undefined}>
        {(id) => <Input id={id} type="email" inputMode="email" value={value} onChange={(e) => setValue(e.target.value)} placeholder="yourclub@weber.edu" autoComplete="off" aria-invalid={Boolean(error) || undefined} />}
      </Field>
      <Button type="submit" variant="outline" disabled={pending} className="sm:mb-6">
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function LeaveClubButton({ clubId, clubName, blockedReason }: { clubId: string; clubName: string; blockedReason: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (blockedReason) {
    return (
      <div className="space-y-2">
        <Button variant="outline" disabled>
          <LogOut className="h-4 w-4" aria-hidden /> Leave club
        </Button>
        <p className="text-sm text-ink-3">{blockedReason}</p>
      </div>
    );
  }
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={pending}>
          <LogOut className="h-4 w-4" aria-hidden /> {pending ? "Leaving…" : "Leave club"}
        </Button>
      }
      title={`Leave ${clubName}?`}
      description="Any roles you hold end now (your role history stays), and the club's calendar comes off yours. You can register again later."
      confirmLabel="Leave club"
      danger
      onConfirm={() =>
        start(async () => {
          const r = await leaveClubAction(clubId);
          if (!r.ok) return void toast.error(r.error);
          toast.success(`You left ${clubName}`);
          router.push("/dashboard");
        })
      }
    />
  );
}
