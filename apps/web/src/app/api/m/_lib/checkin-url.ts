/**
 * Reads a check-in code (and QR token) out of whatever the camera saw:
 *   "<web>/c/<code>?t=<token>"         the QR on the leader's screen
 *   "wildcatclubs://c/<code>?t=<token>" the app's own deep link
 *   "HERE26"                            a typed or plain-text code
 * Pure (no server imports) so it can be unit-tested; the app keeps a copy in
 * apps/mobile/src/lib/checkin-link.ts for routing scans before calling the API.
 */
export type ParsedCheckin = { code: string; token: string | null };

const CODE = /^[A-Za-z0-9-]{4,16}$/;

export function parseCheckinInput(input: { url?: string | null; code?: string | null; token?: string | null }): ParsedCheckin | null {
  const typed = input.code?.trim();
  if (typed) return { code: typed, token: input.token?.trim() || null };
  const raw = input.url?.trim();
  if (!raw) return null;
  if (CODE.test(raw)) return { code: raw, token: input.token?.trim() || null };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // https://host/c/CODE → pathname "/c/CODE"; wildcatclubs://c/CODE → host "c", pathname "/CODE".
  const segments = [url.host, ...url.pathname.split("/")].filter(Boolean);
  const proto = url.protocol.toLowerCase();
  const parts = proto === "http:" || proto === "https:" ? url.pathname.split("/").filter(Boolean) : segments;
  const at = parts.lastIndexOf("c");
  const code = at >= 0 ? parts[at + 1] : undefined;
  if (!code || !CODE.test(decodeURIComponent(code))) return null;
  const token = url.searchParams.get("t")?.trim() || input.token?.trim() || null;
  return { code: decodeURIComponent(code), token };
}
