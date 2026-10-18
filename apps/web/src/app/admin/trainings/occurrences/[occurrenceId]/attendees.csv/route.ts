import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { fmtDate, inCampusTime } from "@/lib/time";
import { format } from "date-fns";
import { toCsv } from "@/lib/attendance/matrix";
import { METHOD_LABEL } from "@/lib/attendance/rules";
import { loadAttendees } from "../attendees";

/** Attendee list for one university-event meeting, as CSV (admins). */
export async function GET(_req: Request, { params }: { params: Promise<{ occurrenceId: string }> }) {
  const actor = await getCurrentUser();
  if (!can(actor, "admin.trainings")) return new Response("Not found", { status: 404 });
  const data = await loadAttendees((await params).occurrenceId);
  if (!data) return new Response("Not found", { status: 404 });
  const { occ, rolesByUser } = data;
  const rows = [
    ["Name", "Email", "Leadership roles", "Check-in method", "Checked in (Mountain time)"],
    ...occ.attendances.map((a) => [a.user.name, a.user.email, (rolesByUser.get(a.userId) ?? []).join("; "), METHOD_LABEL[a.method], format(inCampusTime(a.checkedInAt), "yyyy-MM-dd HH:mm")]),
  ];
  // toCsv defuses formulas: names are user-chosen, so "=HYPERLINK(…)" must stay text.
  const csv = toCsv(rows);
  const name = `${occ.event.title}-${fmtDate(occ.startsAt, "yyyy-MM-dd")}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name || "attendees"}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
