import { NextResponse, type NextRequest } from "next/server";

/**
 * Passes the requested path to server components (x-pathname) so sign-in
 * redirects can send people back where they were. No auth decisions happen
 * here — lib/authz is the only permission authority.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
