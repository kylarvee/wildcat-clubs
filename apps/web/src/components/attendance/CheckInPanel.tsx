"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { ActionResult } from "@/lib/domain/kit";
import type { CheckInResult } from "@/lib/domain/attendance";
import { Callout } from "@/components/ui/layout";
import { checkInAction } from "@/components/attendance/actions";
import { CheckInSuccess } from "@/components/attendance/CheckInSuccess";

/**
 * The one big "Check in" button. Nothing happens on page load (no side
 * effects on GET) — except right after login, when `autoSubmit` presses the
 * button for the person so the scan they started finishes in one go.
 */
export function CheckInPanel({ code, pass, autoSubmit, showGetApp, note }: { code: string; pass: string | null; autoSubmit?: boolean; showGetApp?: boolean; note?: string | null }) {
  const [state, run, pending] = useActionState<ActionResult<CheckInResult> | null, FormData>(
    () => checkInAction({ code, token: pass, via: "web" }),
    null,
  );
  const fired = useRef(false);

  useEffect(() => {
    if (!autoSubmit || fired.current) return;
    fired.current = true;
    // Drop ?go=1 so a reload doesn't press the button again.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("go");
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {}
    startTransition(() => run(new FormData()));
  }, [autoSubmit, run]);

  if (state?.ok) return <CheckInSuccess result={state.data} showGetApp={showGetApp} />;

  return (
    <form action={run} className="space-y-3">
      {state && !state.ok ? <Callout tone="danger">{state.error}</Callout> : null}
      <button
        type="submit"
        disabled={pending}
        className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-brand text-lg font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand active:scale-[0.99] active:bg-brand-700 disabled:opacity-80"
      >
        {pending ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <CheckCircle2 className="h-6 w-6" aria-hidden />}
        {pending ? "Checking you in…" : "Check in"}
      </button>
      {note ? <p className="text-center text-sm text-ink-3">{note}</p> : null}
    </form>
  );
}
