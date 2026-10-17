/**
 * Where to send someone after sign-in. Client-safe (no server imports), so any
 * page, action or route that takes a `next=` parameter can use it.
 */

const FALLBACK = "/dashboard";

/**
 * `next` if it is a path on this site, else /dashboard. Browsers read "//host"
 * and "/\host" as another site, and drop tabs and newlines (so "/\t/host" is
 * "//host"), so those are refused, along with any backslash or control
 * character. The original string is returned, never a normalized one: the URL
 * parser turns "/.//host" into the path "//host", which would become an
 * off-site redirect if we sent it back out. A repeated query parameter arrives
 * as an array despite the type, so anything but a string falls back too.
 */
export function safeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || !/^\/(?![/\\])/.test(next) || /[\\\x00-\x1f\x7f]/.test(next)) return FALLBACK;
  return next;
}
