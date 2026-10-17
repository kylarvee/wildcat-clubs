import "server-only";
import { getCurrentUser, type Actor } from "@/lib/auth/session";
import { apiRoute, invalid } from "@/lib/domain/kit";

/**
 * Plumbing shared by every /api/m route: the { ok, data } envelope (via
 * apiRoute), CORS so the Expo web preview can call the API from another
 * port, and bearer-only sign-in.
 *
 * CORS is "*" on purpose: this API never reads the web session cookie, so a
 * page on another site can't act as anyone — it would need the app's token.
 */

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

/** OPTIONS handler for every mobile route (browser preflight). */
export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Runs a handler and returns the JSON envelope, uncached, with CORS headers. */
export async function mobile<T>(fn: () => Promise<T>): Promise<Response> {
  const res = await apiRoute(fn);
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  res.headers.set("cache-control", "no-store");
  return res;
}

/** The raw bearer token on this request, if any. */
export function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth || !/^bearer\s/i.test(auth)) return null;
  return auth.slice(7).trim() || null;
}

/**
 * Who is calling. Bearer tokens only: a request without one is signed out
 * even if the browser happens to hold a web session cookie.
 */
export async function mobileActor(req: Request): Promise<Actor | null> {
  if (!bearerToken(req)) return null;
  return getCurrentUser();
}

/** The JSON body ({} when empty). Malformed JSON is a 400 with a plain message. */
export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw invalid("The app sent something the server couldn't read. Please try again.");
  }
}
