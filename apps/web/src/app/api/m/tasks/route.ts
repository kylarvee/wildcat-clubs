import { mobile, mobileActor, preflight } from "../_lib/http";
import { tasksView } from "../_lib/tasks";

/**
 * GET /api/m/tasks → MTasks: everything waiting on you, the web Tasks page's
 * list (lib/domain/tasks listTasks): required first with the "Required by
 * WSUSA" badge, then soonest due. Join requests and co-host invitations
 * carry a `decision` for the app's Approve / Decline buttons.
 */
export async function GET(req: Request) {
  return mobile(async () => tasksView(await mobileActor(req)));
}

export const OPTIONS = preflight;
