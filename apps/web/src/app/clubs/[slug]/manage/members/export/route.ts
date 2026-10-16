import { getCurrentUser } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { getClubBySlug } from "@/lib/clubs/context";
import { clubMemberAttendanceCounts } from "@/lib/metrics";
import { rosterData } from "@/lib/roles/queries";
import { fmtLongDate } from "@/lib/time";

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Member", PENDING: "Requested to join", ALUMNI: "Alumni", LEFT: "Left", REMOVED: "Removed", DECLINED: "Declined" };

/** Quote a CSV cell and defuse spreadsheet formulas (=, +, -, @ at the start). */
function cell(v: string | number | null | undefined) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** GET: the club roster as CSV, for people holding the `roster` capability. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to export the roster.", { status: 401 });
  const club = await getClubBySlug(slug);
  if (!club) return new Response("Club not found.", { status: 404 });
  const access = await getClubAccess(user, club.id);
  if (!access?.capabilities.has("roster")) return new Response("You don't have access to this club's roster.", { status: 403 });

  const [roster, attendance] = await Promise.all([rosterData(club.id), clubMemberAttendanceCounts(club.id)]);
  const header = ["Name", "Email", "Status", "Roles", "Internal title", "Joined", "Events attended", "Last attended", "Active"];
  const lines = roster
    .filter((r) => r.status !== "DECLINED")
    .map((r) => {
      const a = attendance.get(r.person.id);
      return [
        r.person.name,
        r.person.email,
        STATUS_LABEL[r.status] ?? r.status,
        r.roles.map((x) => x.label).join("; ") || "Member",
        r.internalTitle,
        r.joinedAt ? fmtLongDate(r.joinedAt) : "",
        a?.attended ?? 0,
        a?.lastAttendedAt ? fmtLongDate(a.lastAttendedAt) : "",
        r.status === "ACTIVE" ? (a?.active ? "Yes" : "No") : "",
      ]
        .map(cell)
        .join(",");
    });
  const csv = "﻿" + [header.map(cell).join(","), ...lines].join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${club.slug}-roster-${date}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
