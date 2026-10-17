import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { exchangeCode, NotUniversityAccount } from "@/lib/auth/google";
import { findOrCreateUserByEmail } from "@/lib/auth/accounts";
import { safeNext } from "@/lib/auth/redirect";
import { signInWeb } from "@/lib/auth/session";

/** Error codes the login page turns into fixed copy (raw exception text never reaches the page). */
type LoginError = "expired" | "cancelled" | "domain" | "failed";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  let saved: { state?: unknown; next?: unknown } = {};
  try {
    saved = JSON.parse(jar.get("wc_oauth")?.value ?? "{}");
  } catch {
    // A mangled cookie is the same as none: the state check below fails.
  }
  jar.delete("wc_oauth");
  const state = typeof saved.state === "string" ? saved.state : "";
  // Checked again here (not just when the cookie was set) so the redirect never leaves the site.
  const next = safeNext(typeof saved.next === "string" ? saved.next : null);
  function fail(error: LoginError): never {
    redirect(`/login?error=${error}&next=${encodeURIComponent(next)}`);
  }
  if (!state || url.searchParams.get("state") !== state) fail("expired");
  const code = url.searchParams.get("code");
  if (!code) fail("cancelled");
  try {
    const identity = await exchangeCode(url.origin, code);
    const user = await findOrCreateUserByEmail({ email: identity.email, name: identity.name, avatarUrl: identity.picture });
    await signInWeb(user.id);
  } catch (e) {
    if (e instanceof NotUniversityAccount) fail("domain");
    console.error("Google sign-in failed", e);
    fail("failed");
  }
  redirect(next);
}
