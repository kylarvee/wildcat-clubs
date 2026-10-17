"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { useRunAction } from "@/components/roles/useRunAction";
import { markGraduatedAction } from "@/app/settings/actions";
import { INSTITUTION, PLATFORM } from "@/lib/institution";

/**
 * "I've graduated": pick the date, confirm what happens, done. Roles end as
 * Graduated in every club's history, memberships become alumni and the
 * profile is retired (read-only) — the history stays.
 */
export function GraduationForm({ handle, today, roleCount, clubCount }: { handle: string; today: string; roleCount: number; clubCount: number }) {
  const [date, setDate] = useState(today);
  const [confirming, setConfirming] = useState(false);
  const { pending, error, setError, run } = useRunAction();
  const router = useRouter();

  const ending = [
    roleCount ? `${roleCount} club role${roleCount === 1 ? "" : "s"} end${roleCount === 1 ? "s" : ""}, marked “Graduated” in each club's role history` : null,
    clubCount ? `your ${clubCount} club membership${clubCount === 1 ? " becomes an alumni membership" : "s become alumni memberships"}` : null,
    "your profile is retired: it stays visible to Weber State accounts, but can't be edited",
  ].filter(Boolean) as string[];

  async function graduate() {
    setConfirming(false);
    const r = await run(() => markGraduatedAction(date));
    if (r.ok) {
      toast.success("Congratulations, graduate! Your profile is now an alumni profile.");
      router.push(`/u/${handle}`);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!date) return setError("Pick the date you graduated.");
        if (date > today) return setError("Pick a date that isn't in the future — come back once you've graduated.");
        setError(null);
        setConfirming(true);
      }}
    >
      <Field label="Graduation date" required hint="Commencement day, or the day your degree was conferred.">
        {(id) => <Input id={id} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required className="max-w-[12rem]" />}
      </Field>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <GraduationCap className="h-4 w-4" aria-hidden />}
        I&apos;ve graduated
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Mark yourself as graduated?"
        description={`You can't undo this yourself. If you mark it by mistake, email ${INSTITUTION.studentGovernment} at ${PLATFORM.supportEmail}.`}
        confirmLabel="Yes, I've graduated"
        onConfirm={() => void graduate()}
      >
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
          {ending.map((t) => (
            <li key={t}>{t[0].toUpperCase() + t.slice(1)}.</li>
          ))}
          <li>Everything you did — roles, projects, files and activity — stays on your profile and in your clubs.</li>
        </ul>
      </ConfirmDialog>
    </form>
  );
}
