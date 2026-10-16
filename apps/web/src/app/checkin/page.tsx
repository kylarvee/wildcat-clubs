import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { liveOccurrencesForUser } from "@/lib/domain/attendance";
import { CODE_LENGTH, normalizeCode } from "@/lib/attendance/rules";
import { Card } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { LiveCheckinPrompt } from "@/components/attendance/LiveCheckinPrompt";

export const metadata: Metadata = { title: "Check in with a code" };

/**
 * Type the 6-character code shown under the QR (for laptops, or when a camera
 * won't cooperate). A plain GET form, so it works before any JavaScript loads.
 */
export default async function CheckinCodeEntry({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const typed = Array.isArray(sp.code) ? sp.code[0] : sp.code;
  let error: string | null = null;
  if (typed !== undefined) {
    const norm = normalizeCode(typed);
    if (norm.ok) redirect(`/c/${norm.code}`);
    error = norm.error;
  }

  const actor = await getCurrentUser();
  const live = actor ? await liveOccurrencesForUser(actor) : [];

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
      {live.length ? <LiveCheckinPrompt occurrences={live} className="mb-6" /> : null}
      <Card className="p-6 sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand">
          <KeyRound className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Check in with a code</h1>
        <p className="mt-1.5 text-ink-2">Type the {CODE_LENGTH}-character code shown under the QR code at the event.</p>
        <form method="get" action="/checkin" className="mt-6 space-y-3" noValidate>
          <label htmlFor="checkin-code" className="sr-only">
            Check-in code
          </label>
          <input
            id="checkin-code"
            name="code"
            defaultValue={typed ?? ""}
            autoFocus
            required
            maxLength={16}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            placeholder="ABC234"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "checkin-code-error" : "checkin-code-hint"}
            className="h-16 w-full rounded-2xl border border-line-2 bg-surface text-center font-mono text-3xl font-semibold uppercase tracking-[0.35em] text-ink shadow-sm placeholder:text-line-2 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand-100 aria-[invalid=true]:border-danger"
          />
          {error ? (
            <p id="checkin-code-error" className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : (
            <p id="checkin-code-hint" className="text-sm text-ink-3">
              Letters and numbers — capitals or not, spaces don&apos;t matter.
            </p>
          )}
          <button type="submit" className={buttonClasses("primary", "lg", "h-14 w-full text-lg")}>
            Continue
          </button>
        </form>
      </Card>
      <p className="mt-5 text-center text-sm text-ink-3">Have a phone? Point its camera at the QR code instead — it&apos;s one tap.</p>
    </div>
  );
}
