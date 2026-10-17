import { z } from "zod";
import { db } from "@/lib/db";
import { authMode, verifyIdToken } from "@/lib/auth/google";
import { findOrCreateUserByEmail } from "@/lib/auth/accounts";
import { createSession } from "@/lib/auth/session";
import { forbidden, invalid, parse } from "@/lib/domain/kit";
import { mobile, preflight, readJson } from "../../_lib/http";
import { toMUser } from "../../_lib/serialize";
import type { MSession } from "../../_types";

/**
 * POST /api/m/auth/google { idToken } → MSession. The app signs in with
 * Google itself and sends the ID token; we verify it (audience = our web, iOS
 * or Android client id, verified @mail.weber.edu / @weber.edu email), then
 * find or create the account — first sign-in creates it, exactly like the web.
 */
export async function POST(req: Request) {
  return mobile(async (): Promise<MSession> => {
    if (authMode() === "mock") throw forbidden("Google sign-in is turned off on this test server. Use a test persona.");
    const { idToken } = parse(z.object({ idToken: z.string().trim().min(20, "Google didn't send a sign-in token. Please try again.").max(8192) }), await readJson(req));
    let identity;
    try {
      identity = await verifyIdToken(idToken);
    } catch (e) {
      // Wrong domain, unverified email, expired or foreign token: say what Google told us.
      throw invalid(e instanceof Error && e.message ? e.message : "Google sign-in didn't go through. Please try again.");
    }
    const existing = await db.user.findUnique({ where: { email: identity.email.toLowerCase() }, select: { id: true } });
    let user;
    try {
      user = await findOrCreateUserByEmail({ email: identity.email, name: identity.name, avatarUrl: identity.picture });
    } catch (e) {
      throw invalid(e instanceof Error ? e.message : "Only Weber State email addresses can sign in.");
    }
    if (user.status === "DEACTIVATED") throw forbidden("This account is deactivated. Contact WSUSA if you think that's a mistake.");
    const { token, expiresAt } = await createSession(user.id, "MOBILE");
    return { token, expiresAt: expiresAt.toISOString(), user: toMUser(user), created: !existing };
  });
}

export const OPTIONS = preflight;
