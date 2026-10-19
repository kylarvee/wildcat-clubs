import Link from "next/link";
import { CalendarX2 } from "lucide-react";
import type { ClubMatrix } from "@/lib/attendance/queries";
import { sortRows, type MxRow, type RowSort } from "@/lib/attendance/matrix";
import { ROLE_LABEL } from "@/lib/authz";
import { EmptyState } from "@/components/ui/layout";
import { AttendanceMatrixGrid, type GridColumn, type GridRow } from "@/components/attendance/AttendanceMatrixGrid";

/**
 * THE attendance table: one row per member, one column per meeting, a mark
 * wherever someone checked in. Guests (non-members, often from other clubs)
 * get their own section. Scrolls both ways with the names and dates pinned.
 * This server half sorts the rows and turns them into plain data; the grid
 * (a client component) draws them.
 */
export function AttendanceMatrixTable({
  data,
  slug,
  sort,
  query,
  activeIds,
}: {
  data: ClubMatrix;
  slug: string;
  sort: RowSort;
  /** Current search params, so sort links keep the range. */
  query: Record<string, string>;
  activeIds: Set<string>;
}) {
  const { matrix, people } = data;
  const base = `/clubs/${slug}/manage/attendance`;
  const cols = matrix.columns;

  if (cols.length === 0) {
    return (
      <EmptyState
        icon={<CalendarX2 />}
        title="No events in this range yet"
        description="Once a meeting starts, it shows up here as a column. Pick another range, or plan your next event in the Events tool."
        action={
          <Link href={`/clubs/${slug}/manage/events`} className="text-sm font-medium text-brand-600 underline-offset-2 hover:underline">
            Go to Events
          </Link>
        }
      />
    );
  }

  const nameOf = (id: string) => people.get(id)?.name ?? "Former account";
  const members = sortRows(matrix.members, sort, nameOf);
  const guests = sortRows(matrix.guests, sort === "rate" ? "attended" : sort, nameOf);
  const sortHref = (s: RowSort) => `${base}?${new URLSearchParams({ ...query, sort: s }).toString()}#table`;

  // Plain rows for the client grid: names, subtitles and recorder names are settled here, so
  // the page sends data (no emails or other fields the table doesn't show) instead of a
  // server component per cell.
  const toRow = (r: MxRow): GridRow => {
    const p = people.get(r.userId);
    const title = data.internalTitles.get(r.userId);
    const role = data.roles.get(r.userId);
    const others = data.guestClubs.get(r.userId) ?? [];
    const subtitle =
      r.kind === "MEMBER"
        ? [role && role !== "MEMBER" ? ROLE_LABEL[role] : null, title].filter(Boolean).join(" · ")
        : r.kind === "FORMER"
          ? "Former member"
          : others.length
            ? `Member of ${others[0].name}${others.length > 1 ? ` +${others.length - 1}` : ""}`
            : "Guest";
    return {
      userId: r.userId,
      kind: r.kind,
      name: p?.name ?? "Former account",
      avatarUrl: p?.avatarUrl ?? null,
      avatarColor: p?.avatarColor ?? "#492365",
      subtitle,
      active: r.kind === "MEMBER" && activeIds.has(r.userId),
      attended: r.attended,
      attendedAsMember: r.attendedAsMember,
      eligible: r.eligible,
      rate: r.rate,
      membership: data.memberships.get(r.userId) ?? null,
      cells: cols.map((c) => {
        const cell = r.cells.get(c.occurrence.id);
        return cell ? { method: cell.method, checkedInAt: cell.checkedInAt, recordedBy: (cell.recordedById && data.recorders.get(cell.recordedById)) || null } : null;
      }),
    };
  };
  const columns: GridColumn[] = cols.map((c) => ({
    id: c.occurrence.id,
    startsAt: c.occurrence.startsAt,
    title: c.occurrence.title,
    hostedBy: c.occurrence.hostName && c.occurrence.hostClubId !== null && c.occurrence.hostClubId !== data.clubId ? c.occurrence.hostName : null,
    held: c.held,
    memberAttendees: c.memberAttendees,
    guests: c.guests,
    membersAtTime: c.membersAtTime,
    rate: c.rate,
  }));

  return (
    <AttendanceMatrixGrid
      base={base}
      sort={sort}
      sortHrefs={{ name: sortHref("name"), recent: sortHref("recent"), attended: sortHref("attended"), rate: sortHref("rate") }}
      columns={columns}
      members={members.map(toRow)}
      guests={guests.map(toRow)}
      guestsLabel={guests.some((g) => g.kind === "FORMER") ? `Guests & former members · ${guests.length}` : `Guests · ${guests.length}`}
      capped={data.capped}
    />
  );
}
