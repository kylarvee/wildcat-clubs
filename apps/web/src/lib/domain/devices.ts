import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { logActivity } from "@/lib/lake/activity";
import { assertSignedIn, parse } from "@/lib/domain/kit";

/**
 * Push devices — the phones that receive this person's notifications
 * (lib/integrations/push sends to every PushToken row of a user).
 *
 * The write path for PushToken (sign-in check → zod → write → activity log).
 */

const ExpoToken = z
  .string()
  .trim()
  .min(10)
  .max(200)
  .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, "That doesn't look like an Expo push token.");

const Register = z.object({ token: ExpoToken, platform: z.enum(["ios", "android", "web"]) });

/** Points this device's pushes at the signed-in person (a phone that changed hands moves over). */
export async function registerPushToken(actor: Actor | null, input: unknown) {
  assertSignedIn(actor);
  const { token, platform } = parse(Register, input);
  const existing = await db.pushToken.findUnique({ where: { token }, select: { userId: true, platform: true } });
  if (existing?.userId === actor.id && existing.platform === platform) return { registered: true };
  await db.pushToken.upsert({ where: { token }, create: { token, platform, userId: actor.id }, update: { userId: actor.id, platform } });
  await logActivity({ actorId: actor.id, action: existing ? "device.push_moved" : "device.push_added", entityType: "user", entityId: actor.id, data: { platform } });
  return { registered: true };
}

/** Stops pushes to one of your devices (notifications switched off, or signing out). */
export async function removePushToken(actor: Actor | null, input: unknown) {
  assertSignedIn(actor);
  const { token } = parse(z.object({ token: ExpoToken }), input);
  const r = await db.pushToken.deleteMany({ where: { token, userId: actor.id } });
  if (r.count) await logActivity({ actorId: actor.id, action: "device.push_removed", entityType: "user", entityId: actor.id });
  return { registered: false };
}
