import { listClubs } from "@/lib/clubs/queries";
import { parseClubListParams } from "@/components/clubs/list-params";
import { CLUB_TYPE_LABEL } from "@/components/clubs/labels";
import { mobile, mobileActor, preflight } from "../_lib/http";
import { toMetrics } from "../_lib/serialize";
import type { MClubList, MSearchMatch } from "../_types";
import type { SearchMatch } from "@/lib/search/types";

/**
 * GET /api/m/clubs?q=&sort= → MClubList. The same list as the web /clubs page
 * (lib/clubs/queries listClubs): approved clubs, searched inside their pages
 * by lib/search, best match first with a query and Recommended without one,
 * with the key numbers from lib/metrics. Signed-in callers also get their
 * member/subscribed state and personal reasons.
 */

function toMatch(m: SearchMatch): MSearchMatch {
  return { label: m.label, title: m.title, snippet: m.snippet, path: m.href };
}

export async function GET(req: Request) {
  return mobile(async (): Promise<MClubList> => {
    const actor = await mobileActor(req);
    const url = new URL(req.url);
    const parsed = parseClubListParams(new URLSearchParams({ q: url.searchParams.get("q") ?? "", ...(url.searchParams.get("sort") ? { sort: url.searchParams.get("sort")! } : {}) }));
    const { items, total, states, search } = await listClubs(parsed, actor);
    return {
      total,
      search: search ? { mode: search.mode, matches: search.matches } : null,
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
          foundIn: c.match ? toMatch(c.match) : null,
          reasons: c.reasons,
        };
      }),
    };
  });
}

export const OPTIONS = preflight;
