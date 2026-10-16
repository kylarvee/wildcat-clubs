import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { exchangeCode } from "@/lib/auth/google";
import { findOrCreateUserByEmail } from "@/lib/auth/accounts";
import { signInWeb } from "@/lib/auth/session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const saved = jar.get("wc_oauth")?.value;
  jar.delete("wc_oauth");
  const { state, next } = saved ? (JSON.parse(saved) as { state: string; next: string }) : { state: "", next: "/dashboard" };
  if (!state || url.searchParams.get("state") !== state) redirect("/login?error=Sign-in%20expired.%20Please%20try%20again.");
  const code = url.searchParams.get("code");
  if (!code) redirect("/login?error=Sign-in%20was%20cancelled.");
  let dest = "/dashboard";
  try {
    const identity = await exchangeCode(url.origin, code);
    const user = await findOrCreateUserByEmail({ email: identity.email, name: identity.name, avatarUrl: identity.picture });
    await signInWeb(user.id);
    if (next.startsWith("/") && !next.startsWith("//")) dest = next;
  } catch (e) {
    redirect(`/login?error=${encodeURIComponent(e instanceof Error ? e.message : "Sign-in failed")}`);
  }
  redirect(dest);
}
