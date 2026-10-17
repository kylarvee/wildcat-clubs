import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { emailKind } from "@/lib/institution";
import { logActivity } from "@/lib/lake/activity";
import { openAdvisorInviteTasks } from "@/lib/domain/advisors";

/**
 * The single path by which accounts come into existence. Google sign-in (web
 * and mobile) and test personas all land here, so every new account gets the
 * same treatment: kind from email domain, a unique handle, and any pending
 * advisor invites linked to it.
 */
export async function findOrCreateUserByEmail(input: { email: string; name: string; avatarUrl?: string | null }) {
  const email = input.email.trim().toLowerCase();
  const kind = emailKind(email);
  if (!kind) throw new Error("Only Weber State email addresses can sign in.");

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (input.avatarUrl && !existing.avatarUrl) {
      await db.user.update({ where: { id: existing.id }, data: { avatarUrl: input.avatarUrl } });
    }
    await linkPendingInvites(existing.id, email);
    return existing;
  }

  const user = await db.user.create({
    data: {
      email,
      name: input.name.trim() || email.split("@")[0],
      handle: await uniqueHandle(email.split("@")[0]),
      kind,
      avatarUrl: input.avatarUrl ?? null,
      avatarColor: colorFor(email),
      calendarToken: newCalendarToken(),
    },
  });
  await logActivity({ actorId: user.id, action: "user.created", entityType: "user", entityId: user.id });
  await linkPendingInvites(user.id, email);
  return user;
}

/**
 * The only secret on a person's private calendar feed: 256 random bits. Not the
 * schema's cuid() default, which is mostly timestamp and counter (~41 random bits).
 */
export function newCalendarToken() {
  return randomBytes(32).toString("base64url");
}

/** Links advisor invites sent before this person had an account, and puts them in their task inbox. */
async function linkPendingInvites(userId: string, email: string) {
  await db.advisorInvite.updateMany({
    where: { email: { equals: email, mode: "insensitive" }, status: "PENDING", inviteeId: null },
    data: { inviteeId: userId },
  });
  await openAdvisorInviteTasks(userId);
}

async function uniqueHandle(base: string): Promise<string> {
  const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, "") || "wildcat";
  let handle = clean;
  for (let i = 2; await db.user.findUnique({ where: { handle }, select: { id: true } }); i++) handle = `${clean}${i}`;
  return handle;
}

const AVATAR_COLORS = ["#4b2e83", "#6d28d9", "#0f766e", "#b45309", "#be123c", "#1d4ed8", "#4d7c0f", "#a21caf", "#0e7490", "#9a3412"];
export function colorFor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
