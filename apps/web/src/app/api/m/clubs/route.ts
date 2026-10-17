import { listClubs } from "@/lib/clubs/queries";
import { parseClubListParams } from "@/components/clubs/list-params";
import { CLUB_TYPE_LABEL } from "@/components/clubs/labels";
import { mobile, mobileActor, preflight } from "../_lib/http";
import { toMetrics } from "../_lib/serialize";
import type { MClubList } from "../_types";

/**
 * GET /api/m/clubs?q= → MClubList. The public clubs list (approved clubs,
 * A–Z), searched the same forgiving way as the web list, with the key numbers
 * from lib/metrics. Signed-in callers also get their member/subscribed state.
 */
export async function GET(req: Request) {
  return mobile(async (): Promise<MClubList> => {
    const actor = await mobileActor(req);
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const { items, total, states } = await listClubs(parseClubListParams(new URLSearchParams({ q })), actor);
    return {
      total,
      items: items.map((c) => {
        const s = states.get(c.id);
        return {
          id: c.id,
          name: c.name,
          slug: c.slug,
          logoUrl: c.logoUrl,
          logoColor: c.logoColor,
          shortDescription: c.shortDescription,
          typeLabel: CLUB_TYPE_LABEL[c.type],
          placement: c.placement,
          focus: c.focus,
          joinPolicy: c.joinPolicy,
          metrics: toMetrics(c.metrics, c.hasMetrics),
          viewer: actor ? { member: Boolean(s?.member), pending: Boolean(s?.pending), subscribed: Boolean(s?.subscribed), leader: Boolean(s?.leader) } : null,
        };
      }),
    };
  });
}

export const OPTIONS = preflight;
