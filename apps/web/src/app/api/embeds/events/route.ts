import { getCurrentUser } from "@/lib/auth/session";
import { apiRoute } from "@/lib/domain/kit";
import { searchEmbeddableEvents } from "@/lib/rich/embed-data";

/**
 * GET ?clubId=&q=&limit= — events the viewer may embed in rich text (the
 * editor's Insert → Event search). Only events the viewer can see come back.
 */
export async function GET(req: Request) {
  return apiRoute(async () => {
    const actor = await getCurrentUser();
    const params = new URL(req.url).searchParams;
    const events = await searchEmbeddableEvents(actor, {
      clubId: params.get("clubId") || null,
      q: params.get("q"),
      limit: Number(params.get("limit")) || 20,
    });
    return { events };
  });
}
