import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { googleConfigured, personasEnabled } from "@/lib/auth/google";
import { safeNext } from "@/lib/auth/redirect";
import { PERSONAS } from "@/lib/auth/personas";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { LogoMark } from "@/components/shell/Logo";
import { Callout } from "@/components/ui/layout";
import { buttonClasses } from "@/components/ui/button";
import { signInAsPersona, signInWithTestEmail } from "./actions";

export const metadata: Metadata = { title: "Log in" };

/** Sign-in failures arrive as codes (from the Google callback and test sign-in); unknown codes show nothing. */
const ERRORS: Record<string, string> = {
  expired: "Sign-in expired. Please try again.",
  cancelled: "Sign-in was cancelled.",
  domain: `Sign in with your ${INSTITUTION.shortName} account: @${INSTITUTION.studentEmailDomain} for students, @${INSTITUTION.staffEmailDomain} for faculty and staff.`,
  failed: "Sign-in didn't go through. Please try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; switch?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const error = sp.error && Object.hasOwn(ERRORS, sp.error) ? ERRORS[sp.error] : null;
  const user = await getCurrentUser();
  // Stay put while there's an error to read (e.g. a signed-in tester switching to a bad email).
  if (user && !sp.switch && !error) redirect(next);

  const google = googleConfigured();
  const personas = personasEnabled();
  const groups = ["Students", "Faculty & staff", "Administration"] as const;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-md text-center">
        <div className="mb-4 flex justify-center">
          <LogoMark size={48} />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Log in to {PLATFORM.name}</h1>
        <p className="mt-2 text-ink-2">
          Use your {INSTITUTION.shortName} Google account — <span className="font-medium">@{INSTITUTION.studentEmailDomain}</span> for students,{" "}
          <span className="font-medium">@{INSTITUTION.staffEmailDomain}</span> for faculty and staff.
        </p>
        {error ? (
          <Callout tone="danger" className="mt-4 text-left">
            {error}
          </Callout>
        ) : null}
        <div className="mt-6">
          {google ? (
            <a href={`/api/auth/google?next=${encodeURIComponent(next)}`} className={buttonClasses("primary", "lg", "w-full")}>
              <GoogleG /> Continue with Weber State Google
            </a>
          ) : (
            <Callout tone="info" className="text-left" title="Google sign-in isn't available yet">
              {personas ? "Until it is, use a test persona below." : "Please check back soon."}
            </Callout>
          )}
        </div>
      </div>

      {personas ? (
        <div className="mt-12">
          <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-line pb-2">
            <h2 className="text-lg font-semibold">Test personas</h2>
            <p className="text-sm text-ink-3">For user testing — each one is a seeded account with real history.</p>
          </div>
          <div className="space-y-8">
            {groups.map((g) => (
              <div key={g}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">{g}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {PERSONAS.filter((p) => p.group === g).map((p) => (
                    <form key={p.key} action={signInAsPersona}>
                      <input type="hidden" name="persona" value={p.key} />
                      <input type="hidden" name="next" value={next} />
                      <button
                        type="submit"
                        className="h-full w-full rounded-[var(--radius-card)] border border-line bg-surface p-4 text-left shadow-[var(--shadow-card)] transition hover:border-brand-200 hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:outline-brand"
                      >
                        <span className="block text-xs font-semibold uppercase tracking-wide text-brand">{p.label}</span>
                        <span className="mt-1 block font-semibold text-ink">{p.name}</span>
                        <span className="mt-1 block text-sm text-ink-3">{p.blurb}</span>
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <form action={signInWithTestEmail} className="mt-10 rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface p-4">
            <p className="text-sm font-semibold">Sign in as any university email</p>
            <p className="mb-3 text-sm text-ink-3">Creates the account on first use, the same way Google sign-in would.</p>
            <input type="hidden" name="next" value={next} />
            <div className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="test-name" className="sr-only">
                Full name
              </label>
              <input id="test-name" name="name" placeholder="Full name" className="h-10 flex-1 rounded-lg border border-line-2 px-3 text-sm" />
              <label htmlFor="test-email" className="sr-only">
                University email
              </label>
              <input id="test-email" name="email" type="email" required placeholder={`name@${INSTITUTION.studentEmailDomain}`} className="h-10 flex-1 rounded-lg border border-line-2 px-3 text-sm" />
              <button type="submit" className={buttonClasses("outline")}>
                Sign in
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
