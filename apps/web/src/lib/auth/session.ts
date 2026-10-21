import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import type { ClientKind, PlatformRole, Prisma, UserKind, UserStatus } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Sessions — the one authority on "who is making this request".
 * Web uses an httpOnly cookie; the mobile app sends the same kind of token as
 * `Authorization: Bearer <token>`. Both resolve through getCurrentUser().
 */

export const SESSION_COOKIE = "wc_session";
const WEB_SESSION_DAYS = 30;
const MOBILE_SESSION_DAYS = 180;

export type Actor = {
  id: string;
  email: string;
  name: string;
  handle: string;
  kind: UserKind;
  platformRole: PlatformRole;
  status: UserStatus;
  avatarColor: string;
  avatarUrl: string | null;
  /**
   * The offices (lib/offices) whose staff this person is, besides the
   * umbrella: its staff are the platform admins, so it's never listed.
   * Office staff run the admin console for their own office's clubs.
   */
  officeIds: string[];
  /** The ones among officeIds that decide their clubs' funding (lib/authz can "admin.funding"). */
  fundingOfficeIds: string[];
};

const actorSelect = {
  id: true,
  email: true,
  name: true,
  handle: true,
  kind: true,
  platformRole: true,
  status: true,
  avatarColor: true,
  avatarUrl: true,
  officeMemberships: { where: { office: { umbrella: false } }, select: { officeId: true, office: { select: { decidesFunding: true } } } },
} satisfies Prisma.UserSelect;

/** A user row read with actorSelect, as the Actor every permission check takes. */
function toActor(row: Prisma.UserGetPayload<{ select: typeof actorSelect }>): Actor {
  const { officeMemberships, ...user } = row;
  const offices = [...officeMemberships].sort((a, b) => a.officeId.localeCompare(b.officeId));
  return { ...user, officeIds: offices.map((m) => m.officeId), fundingOfficeIds: offices.filter((m) => m.office.decidesFunding).map((m) => m.officeId) };
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a session and returns the raw token (only ever held by the client). */
export async function createSession(userId: string, client: ClientKind): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const days = client === "MOBILE" ? MOBILE_SESSION_DAYS : WEB_SESSION_DAYS;
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  await db.session.create({ data: { tokenHash: hashToken(token), userId, client, expiresAt } });
  await db.user.update({ where: { id: userId }, data: { lastSeenAt: new Date(), ...(client === "MOBILE" ? { hasMobileApp: true } : {}) } });
  return { token, expiresAt };
}

/** Web sign-in: creates the session and sets the cookie. Call from a server action or route handler. */
export async function signInWeb(userId: string) {
  const { token, expiresAt } = await createSession(userId, "WEB");
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function signOutWeb() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function revokeToken(token: string) {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

async function actorFromToken(token: string | undefined | null): Promise<Actor | null> {
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, expiresAt: true, lastUsedAt: true, user: { select: actorSelect } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (session.user.status === "DEACTIVATED") return null;
  // Touch at most every 10 minutes to keep writes low.
  if (Date.now() - session.lastUsedAt.getTime() > 600_000) {
    await db.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    await db.user.update({ where: { id: session.user.id }, data: { lastSeenAt: new Date() } });
  }
  return toActor(session.user);
}

/** The signed-in user for this request (cookie or bearer token), or null. */
export const getCurrentUser = cache(async (): Promise<Actor | null> => {
  const h = await headers();
  const auth = h.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return actorFromToken(auth.slice(7).trim());
  }
  const jar = await cookies();
  return actorFromToken(jar.get(SESSION_COOKIE)?.value);
});

/** For pages: the signed-in user, or a redirect to sign-in that returns here afterwards. */
export async function requireUser(returnTo?: string): Promise<Actor> {
  const user = await getCurrentUser();
  if (!user) {
    const next = returnTo ?? (await headers()).get("x-pathname") ?? "/dashboard";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return user;
}

/** Re-read an actor by id (used by jobs and the AI assistant acting for a user). */
export async function loadActor(userId: string): Promise<Actor | null> {
  const row = await db.user.findUnique({ where: { id: userId }, select: actorSelect });
  return row ? toActor(row) : null;
}
