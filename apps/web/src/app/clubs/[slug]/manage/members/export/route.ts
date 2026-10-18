import { getCurrentUser } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { getClubBySlug } from "@/lib/clubs/context";
import { clubMemberAttendanceCounts } from "@/lib/metrics";
import { rosterData } from "@/lib/roles/queries";
import { toCsv } from "@/lib/attendance/matrix";
import { memberContacts } from "@/lib/domain/details";
import { YEAR_LABEL } from "@/lib/details/rules";
import { fmtDate, fmtLongDate } from "@/lib/time";

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Member", PENDING: "Requested to join", ALUMNI: "Alumni", LEFT: "Left", REMOVED: "Removed", DECLINED: "Declined" };

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
  // Contact basics from member details, under the same rule as the roster page (lib/authz/details).
  const contacts = await memberContacts(user, club.id, roster.map((r) => r.person.id));
  const header = ["Name", "Email", "Personal email", "Phone", "Year in school", "Status", "Roles", "Internal title", "Joined", "Events attended", "Last attended", "Active"];
  const lines = roster
    .filter((r) => r.status !== "DECLINED")
    .map((r) => {
      const a = attendance.get(r.person.id);
      const c = contacts.get(r.person.id);
      return [
        r.person.name,
        r.person.email,
        c?.contactEmail ?? "",
        c?.phone ?? "",
        c?.yearInSchool ? YEAR_LABEL[c.yearInSchool] : "",
        STATUS_LABEL[r.status] ?? r.status,
        r.roles.map((x) => x.label).join("; ") || "Member",
        r.internalTitle,
        r.joinedAt ? fmtLongDate(r.joinedAt) : "",
        a?.attended ?? 0,
        a?.lastAttendedAt ? fmtLongDate(a.lastAttendedAt) : "",
        r.status === "ACTIVE" ? (a?.active ? "Yes" : "No") : "",
      ];
    });
  // The BOM makes Excel read names with accents correctly.
  const csv = "﻿" + toCsv([header, ...lines]);
  // Campus date, so an evening export isn't stamped with tomorrow (UTC).
  const date = fmtDate(new Date(), "yyyy-MM-dd");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${club.slug}-roster-${date}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
