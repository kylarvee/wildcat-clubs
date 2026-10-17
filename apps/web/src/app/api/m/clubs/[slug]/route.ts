import { mobile, mobileActor, preflight } from "../../_lib/http";
import { clubDetailView } from "../../_lib/views";

/**
 * GET /api/m/clubs/[slug] → MClubDetail: profile, numbers, your register /
 * subscribe state, upcoming events you may see, your attendance here, and any
 * check-in open right now that you could make (the "check in?" pop-up).
 * Founding clubs are visible only to their own leaders, as on the web.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return mobile(async () => clubDetailView(await mobileActor(req), slug));
}

export const OPTIONS = preflight;
