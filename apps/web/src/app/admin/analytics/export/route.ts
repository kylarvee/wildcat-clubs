import { getCurrentUser } from "@/lib/auth/session";
import { apiRoute, assertCan } from "@/lib/domain/kit";
import { toCsv } from "@/lib/attendance/matrix";
import { fmtDate } from "@/lib/time";
import { appUrl } from "@/lib/events/share";
import { clubAnalyticsRows } from "@/lib/analytics/clubs";
import { csvRows, filterRows, parseTableFilters, sortRows } from "@/lib/analytics/club-table";

/**
 * GET /admin/analytics/export?q=&college=&type=&status=&missing=&sort=&dir=
 * The club analytics table as CSV, with the same filters and order as the
 * page (lib/analytics/club-table), so the download matches the screen.
 * Admins only (admin.analytics). Aggregates only — no people.
 */
export async function GET(req: Request) {
  try {
    const actor = await getCurrentUser();
    assertCan(actor, "admin.analytics");
    const filters = parseTableFilters(new URL(req.url).searchParams);
    const now = new Date();
    const { rows, termName } = await clubAnalyticsRows(now);
    const shown = sortRows(filterRows(rows, filters), filters.sort, filters.dir);
    // The BOM makes Excel read names with accents correctly.
    const csv = "﻿" + toCsv(csvRows(shown, termName, appUrl));
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="wildcat-clubs-analytics-${fmtDate(now, "yyyy-MM-dd")}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    // Same error shape as every other API route.
    return apiRoute(async () => {
      throw e;
    });
  }
}
