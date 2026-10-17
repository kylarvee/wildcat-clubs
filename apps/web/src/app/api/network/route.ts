import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { apiRoute, forbidden } from "@/lib/domain/kit";
import { loadNetwork } from "@/lib/analytics/network";
import { networkParams, noStore } from "./params";

/**
 * GET /api/network?window=term|year|12m|all&group=club|college|department|major
 * The inter-club network canvas (public — signed-out visitors see it too):
 * { ok, data: NetworkPayload } (lib/analytics/network-model). Node size =
 * check-ins at the club's events in the window; line weight = cross-club
 * attendance (lib/metrics networkData). `viewer` lists the signed-in
 * person's clubs for highlighting.
 */
export async function GET(req: NextRequest) {
  return noStore(
    await apiRoute(async () => {
      const params = networkParams(req.nextUrl.searchParams);
      const actor = await getCurrentUser();
      if (!can(actor, "network.view")) throw forbidden("This account can't view the club network.");
      return loadNetwork({ ...params, actor });
    }),
  );
}
