import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { DomainError, assertSignedIn, notFound } from "@/lib/domain/kit";
import { joinClub, leaveClub, subscribeCalendar, unsubscribeCalendar } from "@/lib/domain/memberships";
import { mobile, mobileActor, preflight } from "../../../_lib/http";
import { viewerState } from "../../../_lib/serialize";
import type { MClubActionResponse } from "../../../_types";

const ACTIONS = ["join", "leave", "subscribe", "unsubscribe"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * POST /api/m/clubs/[slug]/join | leave | subscribe | unsubscribe
 * → MClubActionResponse. The Register button and Subscribe toggle — the same
 * lib/domain/memberships calls as the web, so join gates apply identically
 * (an approval club files a join request; joining also subscribes).
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string; action: string }> }) {
  const { slug, action } = await params;
  return mobile(async (): Promise<MClubActionResponse> => {
    if (!(ACTIONS as readonly string[]).includes(action)) throw new DomainError("NOT_FOUND", "That isn't something the app can do with a club.");
    const actor = await mobileActor(req);
    assertSignedIn(actor);
    const club = await db.club.findUnique({ where: { slug: decodeURIComponent(slug) }, select: { id: true } });
    if (!club) throw notFound("Club");

    let joinStatus: MClubActionResponse["joinStatus"] = null;
    switch (action as Action) {
      case "join":
        joinStatus = (await joinClub(actor, club.id, "REGISTER")).status;
        break;
      case "leave":
        await leaveClub(actor, club.id);
        break;
      case "subscribe":
        await subscribeCalendar(actor, club.id);
        break;
      case "unsubscribe":
        await unsubscribeCalendar(actor, club.id);
        break;
    }
    // Keep the web pages that show this state in step (same paths the web actions refresh).
    revalidatePath("/clubs");
    revalidatePath("/clubs/[slug]", "page");
    revalidatePath("/dashboard");
    return { joinStatus, viewer: await viewerState(actor, club.id) };
  });
}

export const OPTIONS = preflight;
