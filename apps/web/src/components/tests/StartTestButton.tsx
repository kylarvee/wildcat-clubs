"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { startAttemptAction } from "@/app/tests/actions";
import { minutesLabel } from "@/lib/tests/deadlines";

/**
 * "Take the test" → "Are you sure?" with exactly how much time there is and
 * how to hand in. The server starts the clock when they confirm. A form has
 * no clock to warn about, so "Fill out the form" opens it straight away.
 */
export function StartTestButton({
  testId,
  timeLimitMinutes,
  closesSoonAt,
  label = "Take the test",
  isForm = false,
}: {
  testId: string;
  timeLimitMinutes: number | null;
  closesSoonAt: string | null;
  label?: string;
  isForm?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const time = timeLimitMinutes
    ? `You'll have ${minutesLabel(timeLimitMinutes)}. The timer starts now and keeps running even if you leave this page.`
    : "There's no time limit, but the clock starts now and keeps running even if you leave this page.";
  const closing = closesSoonAt ? ` The test closes at ${closesSoonAt}, so that's your deadline.` : "";

  const begin = () => {
    setError(null);
    start(async () => {
      const r = await startAttemptAction(testId).catch(() => null);
      if (!r) return setError(`We couldn't reach the server, so the ${isForm ? "form" : "test"} didn't open. Check your connection and try again.`);
      if (!r.ok) return setError(r.error);
      router.push(`/tests/${testId}/attempt/${r.data.attemptId}`);
    });
  };

  return (
    <div className="space-y-2">
      <Button size="lg" onClick={() => (isForm ? begin() : setOpen(true))} disabled={pending}>
        {pending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <PlayCircle className="h-5 w-5" aria-hidden />} {pending ? (isForm ? "Opening…" : "Starting…") : label}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Are you sure?"
        description={`${time}${closing} Answer every question, then press Submit test at the bottom.`}
        confirmLabel="Start the test"
        cancelLabel="Not yet"
        onConfirm={() => {
          setOpen(false);
          begin();
        }}
      />
    </div>
  );
}
