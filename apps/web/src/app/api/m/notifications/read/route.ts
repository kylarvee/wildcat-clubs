import { z } from "zod";
import { DomainError, assertSignedIn, parse } from "@/lib/domain/kit";
import { markAllRead, markRead, unreadNotificationCount } from "@/lib/domain/notifications";
import { mobile, mobileActor, preflight, readJson } from "../../_lib/http";
import type { MReadResponse } from "../../_types";

const Body = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(200) })]);

/**
 * POST /api/m/notifications/read { ids: [...] } | { all: true } → { unread }.
 * Marks notifications read through lib/domain/notifications. Ids that are
 * gone (or aren't yours) are skipped rather than failing the whole batch.
 */
export async function POST(req: Request) {
  return mobile(async (): Promise<MReadResponse> => {
    const actor = await mobileActor(req);
    assertSignedIn(actor);
    const body = parse(Body, await readJson(req));
    if ("all" in body) await markAllRead(actor);
    else {
      for (const id of new Set(body.ids)) {
        try {
          await markRead(actor, id);
        } catch (e) {
          if (!(e instanceof DomainError && e.code === "NOT_FOUND")) throw e;
        }
      }
    }
    return { unread: await unreadNotificationCount(actor) };
  });
}

export const OPTIONS = preflight;
