import { assertSignedIn } from "@/lib/domain/kit";
import { integrationLive } from "@/lib/config";
import { mobile, mobileActor, preflight, readJson } from "../_lib/http";
import { registerPushToken, removePushToken } from "@/lib/domain/devices";
import type { MPushTokenResponse } from "../_types";

/**
 * POST   /api/m/push-token { token, platform } — send this phone the person's notifications.
 * DELETE /api/m/push-token { token }           — stop (the app's notifications switch).
 * Tokens are Expo push tokens ("ExponentPushToken[…]"); lib/integrations/push delivers.
 *
 * `delivering` says whether pushes really go out: the phone is registered
 * and the server's Push switch is on (integrationLive("push"), the check
 * lib/integrations/push makes before sending). Until then they land in the
 * outbox, so the app's Me tab mustn't promise them.
 */
export async function POST(req: Request) {
  return mobile(async (): Promise<MPushTokenResponse> => {
    const actor = await mobileActor(req);
    assertSignedIn(actor);
    const { registered } = await registerPushToken(actor, await readJson(req));
    return { registered, delivering: registered && (await integrationLive("push")) };
  });
}

export async function DELETE(req: Request) {
  return mobile(async (): Promise<MPushTokenResponse> => {
    const actor = await mobileActor(req);
    assertSignedIn(actor);
    const { registered } = await removePushToken(actor, await readJson(req));
    return { registered, delivering: false };
  });
}

export const OPTIONS = preflight;
