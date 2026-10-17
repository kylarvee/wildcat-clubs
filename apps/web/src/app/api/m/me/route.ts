import { mobile, mobileActor, preflight } from "../_lib/http";
import { meView } from "../_lib/views";

/**
 * GET /api/m/me → MMe: who is signed in, the badge counts (unread
 * notifications, open tasks) and their current roles. The app calls it on
 * launch and whenever it comes back to the foreground.
 */
export async function GET(req: Request) {
  return mobile(async () => meView(await mobileActor(req)));
}

export const OPTIONS = preflight;
