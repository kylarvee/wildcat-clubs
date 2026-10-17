import { assertSignedIn } from "@/lib/domain/kit";
import { mobile, mobileActor, preflight, readJson } from "../_lib/http";
import { registerPushToken, removePushToken } from "../_lib/devices";
import type { MPushTokenResponse } from "../_types";

/**
 * POST   /api/m/push-token { token, platform } — send this phone the person's notifications.
 * DELETE /api/m/push-token { token }           — stop (the app's notifications switch).
 * Tokens are Expo push tokens ("ExponentPushToken[…]"); lib/integrations/push delivers.
 */
export async function POST(req: Request) {
  return mobile(async (): Promise<MPushTokenResponse> => {
    const actor = await mobileActor(req);
    assertSignedIn(actor);
    return registerPushToken(actor, await readJson(req));
  });
}

export async function DELETE(req: Request) {
  return mobile(async (): Promise<MPushTokenResponse> => {
    const actor = await mobileActor(req);
    assertSignedIn(actor);
    return removePushToken(actor, await readJson(req));
  });
}

export const OPTIONS = preflight;
