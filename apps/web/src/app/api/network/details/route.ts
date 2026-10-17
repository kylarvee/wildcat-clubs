import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { apiRoute, forbidden, invalid } from "@/lib/domain/kit";
import { networkLinkDetails, networkNodeDetails } from "@/lib/analytics/network";
import { networkParams, noStore } from "../params";

/**
 * GET /api/network/details?window=…&group=…&node=<key>       → NetworkNodeDetails
 * GET /api/network/details?window=…&group=…&a=<key>&b=<key>  → NetworkLinkDetails
 * The side panel's numbers for one club/group or one line. Keys are the
 * node keys from GET /api/network for the same window and grouping. Only
 * aggregate counts — never who attended.
 */
export async function GET(req: NextRequest) {
  return noStore(
    await apiRoute(async () => {
      const q = req.nextUrl.searchParams;
      const params = networkParams(q);
      const actor = await getCurrentUser();
      if (!can(actor, "network.view")) throw forbidden("This account can't view the club network.");
      const node = q.get("node");
      const a = q.get("a");
      const b = q.get("b");
      if (node) return networkNodeDetails({ ...params, key: node });
      if (a && b) return networkLinkDetails({ ...params, a, b });
      throw invalid("Pass node=<key> for a club or group, or a=<key>&b=<key> for a line.");
    }),
  );
}
