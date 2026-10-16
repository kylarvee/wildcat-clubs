import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_LABEL } from "@/lib/authz";
import { apiRoute, assertClubCap, notFound } from "@/lib/domain/kit";
import { getTerms } from "@/lib/terms";
import { fmtDate } from "@/lib/time";
import { activeMemberIdsFor } from "@/lib/metrics";
import { loadClubMatrix } from "@/lib/attendance/queries";
import { pct, sortRows, toCsv } from "@/lib/attendance/matrix";
import { METHOD_SHORT } from "@/lib/attendance/rules";
import { resolveRange } from "@/lib/attendance/ranges";

/**
 * GET /api/attendance/<clubId>/export?from=YYYY-MM-DD&to=YYYY-MM-DD (or ?range=term|lastTerm|year)
 * The tracker table as CSV: one row per person, one column per event.
 * Same permission as the tracker ("attendance" in the club).
 */
export async function GET(req: Request, { params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  try {
    const actor = await getCurrentUser();
    await assertClubCap(actor, clubId, "attendance");
    const club = await db.club.findUnique({ where: { id: clubId }, select: { slug: true } });
    if (!club) throw notFound("Club");

    const sp = new URL(req.url).searchParams;
    const from = sp.get("from");
    const to = sp.get("to");
    const now = new Date();
    const range = resolveRange({ range: from || to ? "custom" : sp.get("range"), from, to }, await getTerms(), now);
    const [data, activeIds] = await Promise.all([loadClubMatrix(clubId, range, now), activeMemberIdsFor(clubId, now)]);
    const active = new Set(activeIds);
    const { matrix, people } = data;
    const nameOf = (id: string) => people.get(id)?.name ?? "Former account";
    const cols = matrix.columns;

    const header = [
      "Name",
      "Email",
      "Status",
      "Role",
      "Internal title",
      "Active",
      "Events attended",
      "Attendance rate",
      ...cols.map((c) => `${fmtDate(c.occurrence.startsAt, "yyyy-MM-dd HH:mm")} ${c.occurrence.title}`),
    ];
    const rows = [...sortRows(matrix.members, "name", nameOf), ...sortRows(matrix.guests, "name", nameOf)].map((r) => {
      const p = people.get(r.userId);
      const role = data.roles.get(r.userId);
      return [
        nameOf(r.userId),
        p?.email ?? "",
        r.kind === "MEMBER" ? "Member" : r.kind === "FORMER" ? "Former member" : "Guest",
        role ? ROLE_LABEL[role] : "",
        data.internalTitles.get(r.userId) ?? "",
        r.kind === "MEMBER" ? (active.has(r.userId) ? "Yes" : "No") : "",
        r.attended,
        r.kind === "MEMBER" ? pct(r.rate, "") : "",
        ...cols.map((c) => {
          const cell = r.cells.get(c.occurrence.id);
          return cell ? METHOD_SHORT[cell.method] : "";
        }),
      ];
    });
    const pad = ["", "", "", "", "", "", ""];
    const footer = [
      ["Members who came", ...pad, ...cols.map((c) => (c.held ? c.memberAttendees : ""))],
      ["Guests", ...pad, ...cols.map((c) => (c.held ? c.guests : ""))],
      ["Members at the time", ...pad, ...cols.map((c) => c.membersAtTime)],
      ["Attendance rate", ...pad, ...cols.map((c) => pct(c.rate, ""))],
    ];

    // The BOM makes Excel read names with accents correctly.
    const csv = "﻿" + toCsv([header, ...rows, [], ...footer]);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${club.slug}-attendance-${range.fromInput}-to-${range.toInput}.csv"`,
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
