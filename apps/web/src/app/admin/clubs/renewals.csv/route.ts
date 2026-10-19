import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { toCsv } from "@/lib/attendance/matrix";
import { renewalsForAdmin } from "@/lib/domain/renewals";
import { joinNames, missingLabel } from "@/lib/renewals/rules";
import { fmtDate } from "@/lib/time";

/** GET /admin/clubs/renewals.csv?show=not-renewed|overdue|renewed — the Renewals tab as CSV (admins). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Please sign in first." }, { status: 401 });
  if (!can(user, "admin.clubs")) return Response.json({ ok: false, error: "You don't have permission to do that." }, { status: 403 });

  const { window, filter, rows } = await renewalsForAdmin(user, { filter: new URL(req.url).searchParams.get("show") });
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const csv = toCsv([
    ["Club", "Status", "Re-registered on", "Re-registered by", "Note", "President", "Advisor", "Needed to renew", "Recommended", "Workspace"],
    ...rows.map((r) => [
      r.club.name,
      r.status.label,
      r.renewal ? fmtDate(r.renewal.at, "yyyy-MM-dd") : "",
      r.renewal?.byName ?? "",
      r.renewal?.note ?? "",
      joinNames(r.presidents.map((p) => p.name)),
      joinNames(r.advisors.map((p) => p.name)),
      r.missing.filter((c) => c.required).map((c) => missingLabel(c.key)).join("; "),
      r.missing.filter((c) => !c.required).map((c) => missingLabel(c.key)).join("; "),
      `${appUrl}/clubs/${r.club.slug}/manage`,
    ]),
  ]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="wsusa-renewals-${window?.termYear ?? "none"}-${filter}-${fmtDate(new Date(), "yyyy-MM-dd")}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
