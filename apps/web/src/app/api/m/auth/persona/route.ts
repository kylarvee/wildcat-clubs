import { z } from "zod";
import { db } from "@/lib/db";
import { personasEnabled } from "@/lib/auth/google";
import { PERSONAS } from "@/lib/auth/personas";
import { findOrCreateUserByEmail } from "@/lib/auth/accounts";
import { createSession } from "@/lib/auth/session";
import { DomainError, forbidden, parse } from "@/lib/domain/kit";
import { mobile, preflight, readJson } from "../../_lib/http";
import { toMUser } from "../../_lib/serialize";
import type { MSession } from "../../_types";

/**
 * POST /api/m/auth/persona { key } → MSession. Test sign-in as one of the
 * seeded personas — only while AUTH_MODE allows personas (never in a
 * Google-only deployment). Same path as the web's persona sign-in.
 */
export async function POST(req: Request) {
  return mobile(async (): Promise<MSession> => {
    if (!personasEnabled()) throw forbidden("Test personas are turned off on this server. Sign in with your Weber State Google account.");
    const { key } = parse(z.object({ key: z.string().trim().min(1, "Pick a persona.").max(40) }), await readJson(req));
    const persona = PERSONAS.find((p) => p.key === key);
    if (!persona) throw new DomainError("NOT_FOUND", "That test persona doesn't exist. Pull to refresh the list.");
    const existing = await db.user.findUnique({ where: { email: persona.email } });
    const user = existing ?? (await findOrCreateUserByEmail({ email: persona.email, name: persona.name }));
    if (user.status === "DEACTIVATED") throw forbidden("This account is deactivated.");
    const { token, expiresAt } = await createSession(user.id, "MOBILE");
    return { token, expiresAt: expiresAt.toISOString(), user: toMUser(user), created: !existing };
  });
}

export const OPTIONS = preflight;
