/**
 * Reads a check-in code (and QR token) from what the camera saw:
 *   "<web>/c/<code>?t=<token>", "wildcatclubs://c/<code>?t=…", or a bare code.
 * Copy of apps/web/src/app/api/m/_lib/checkin-url.ts (the server parses the
 * same way); the app uses it to route a scan before calling the API.
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
  const proto = url.protocol.toLowerCase();
  // https://host/c/CODE → pathname "/c/CODE"; wildcatclubs://c/CODE → host "c", pathname "/CODE".
  const parts = proto === 'http:' || proto === 'https:' ? url.pathname.split('/').filter(Boolean) : [url.host, ...url.pathname.split('/')].filter(Boolean);
  const at = parts.lastIndexOf('c');
  const code = at >= 0 ? parts[at + 1] : undefined;
  if (!code || !CODE.test(decodeURIComponent(code))) return null;
  const token = url.searchParams.get('t')?.trim() || input.token?.trim() || null;
  return { code: decodeURIComponent(code), token };
}

/** "abc-234 " → "ABC234" — what the server does to typed codes, so the screen shows the same thing. */
export function tidyCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
