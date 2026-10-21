import { getCurrentUser } from "@/lib/auth/session";
import { adminClubWhere, can, CAPABILITIES, ROLE_LABEL, type Capability } from "@/lib/authz";
import { listRequirementsForAdmin, requirementCompliance } from "@/lib/domain/requirements";
import { toCsv } from "@/lib/attendance/matrix";
import { AWAITING_GRADE_LABEL } from "@/lib/authz/requirement-rules";
import { fmtDate } from "@/lib/time";
import { applyFilter, parseFilter } from "../filters";

/** GET /admin/requirements/export?club=&role=&req=&state=&q= — the compliance table as CSV (admins). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Please sign in first." }, { status: 401 });
  if (!can(user, "admin.tests") && !can(user, "admin.trainings")) return Response.json({ ok: false, error: "You don't have permission to do that." }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = parseFilter(sp);
  // An office's staff export their own office's requirements and clubs.
  const [reqs, rows] = await Promise.all([listRequirementsForAdmin(user), requirementCompliance(new Date(), { clubWhere: adminClubWhere(user) })]);
  const columns = reqs.filter((r) => r.active && (!f.req || r.id === f.req));
  const shown = applyFilter(rows, f);
  const label = (c: { state: string; dueAt: Date } | undefined) =>
    !c
      ? "Not required"
      : c.state === "met"
        ? "Met"
        : c.state === "review"
          ? AWAITING_GRADE_LABEL
          : c.state === "overdue"
            ? `Overdue (was due ${fmtDate(c.dueAt, "yyyy-MM-dd")})`
            : `Due by ${fmtDate(c.dueAt, "yyyy-MM-dd")}`;
  const csv = toCsv([
    ["Name", "Email", "Club", "Role", "Seat", "Role since", ...columns.map((c) => c.name), "Permissions"],
    ...shown.map((r) => [
      r.person.name,
      r.person.email,
      r.club.name,
      ROLE_LABEL[r.role],
      r.seat ?? "",
      fmtDate(r.startedAt, "yyyy-MM-dd"),
      ...columns.map((c) => label(r.cells[c.id])),
      r.paused ? "Paused" : r.pausedCapabilities?.length ? `${r.pausedCapabilities.map((c) => (c in CAPABILITIES ? CAPABILITIES[c as Capability].label : c)).join(", ")} paused` : "On",
    ]),
  ]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="wsusa-requirements-${fmtDate(new Date(), "yyyy-MM-dd")}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
