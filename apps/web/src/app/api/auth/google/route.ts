import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { googleAuthUrl, googleConfigured } from "@/lib/auth/google";

export async function GET(req: Request) {
  if (!googleConfigured()) return new Response("Google sign-in isn't configured.", { status: 503 });
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/dashboard";
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("wc_oauth", JSON.stringify({ state, next }), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: process.env.NODE_ENV === "production" });
  redirect(googleAuthUrl(url.origin, state));
}
