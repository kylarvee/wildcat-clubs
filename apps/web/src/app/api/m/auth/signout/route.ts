import { revokeToken } from "@/lib/auth/session";
import { DomainError } from "@/lib/domain/kit";
import { bearerToken, mobile, mobileActor, preflight, readJson } from "../../_lib/http";
import { removePushToken } from "../../_lib/devices";
import type { MSignOutResponse } from "../../_types";

/**
 * POST /api/m/auth/signout { pushToken? } → { signedOut: true }. Ends this
 * phone's session; with pushToken, also stops pushes to the phone so the next
 * person to use it doesn't get your notifications. Safe to repeat.
 */
export async function POST(req: Request) {
  return mobile(async (): Promise<MSignOutResponse> => {
    const token = bearerToken(req);
    const body = (await readJson(req)) as { pushToken?: unknown };
    if (token) {
      const actor = await mobileActor(req);
      if (actor && typeof body.pushToken === "string" && body.pushToken) {
        try {
          await removePushToken(actor, { token: body.pushToken });
        } catch (e) {
          // A malformed push token must not keep someone signed in.
          if (!(e instanceof DomainError)) throw e;
        }
      }
      await revokeToken(token);
    }
    return { signedOut: true };
  });
}

export const OPTIONS = preflight;
