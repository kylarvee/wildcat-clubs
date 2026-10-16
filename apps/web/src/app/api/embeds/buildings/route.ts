import { apiRoute } from "@/lib/domain/kit";
import { listBuildings } from "@/lib/rich/embed-data";

/** GET ?q= — campus buildings for map pins (public reference data). */
export async function GET(req: Request) {
  return apiRoute(async () => {
    const buildings = await listBuildings(new URL(req.url).searchParams.get("q"));
    return { buildings };
  });
}
