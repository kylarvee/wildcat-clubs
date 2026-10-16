import Link from "next/link";
import { ArrowDown, CalendarX2 } from "lucide-react";
import type { ClubMatrix } from "@/lib/attendance/queries";
import { memberAt, pct, sortRows, type MxRow, type RowSort } from "@/lib/attendance/matrix";
import { METHOD_LABEL } from "@/lib/attendance/rules";
import { ROLE_LABEL } from "@/lib/authz";
import { fmtDate, fmtTime } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";
import { MethodMark } from "@/components/attendance/MethodMark";

/**
 * THE attendance table: one row per member, one column per meeting, a mark
 * wherever someone checked in. Guests (non-members, often from other clubs)
 * get their own section. Scrolls both ways with the names and dates pinned.
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

  const SortTh = ({ s, label, className }: { s: RowSort; label: string; className?: string }) => (
    <Link href={sortHref(s)} scroll={false} className={cn("inline-flex items-center gap-1 rounded hover:text-ink focus-visible:outline-2 focus-visible:outline-brand", sort === s && "text-ink", className)} aria-label={`Sort by ${label.toLowerCase()}`}>
      {label}
      {sort === s ? <ArrowDown className="h-3 w-3" aria-hidden /> : null}
    </Link>
  );

  const stickyCell = "sticky left-0 z-10 border-r border-line bg-surface";
  const head = "sticky top-0 z-20 border-b border-line bg-muted text-left text-xs font-medium text-ink-3";

  const renderRow = (r: MxRow) => {
    const p = people.get(r.userId);
    const m = data.memberships.get(r.userId);
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
    return (
      <tr key={r.userId} className="group">
        <th scope="row" className={cn(stickyCell, "border-b px-3 py-2 text-left font-normal group-hover:bg-muted")}>
          <div className="flex min-w-[180px] max-w-[240px] items-center gap-2.5">
            <Avatar name={p?.name ?? "?"} src={p?.avatarUrl} color={p?.avatarColor} size="xs" />
            <div className="min-w-0">
              <Link href={`${base}/members/${r.userId}`} className="block truncate font-medium text-ink hover:text-brand-600 hover:underline">
                {p?.name ?? "Former account"}
              </Link>
              {subtitle ? <p className="truncate text-xs text-ink-3">{subtitle}</p> : null}
            </div>
            {r.kind === "MEMBER" && activeIds.has(r.userId) ? (
              <Badge tone="success" className="ml-auto shrink-0">
                Active
              </Badge>
            ) : null}
          </div>
        </th>
        <td className="border-b border-line px-3 py-2 text-right tabular-nums group-hover:bg-muted/60">{r.attended}</td>
        <td
          className="border-b border-r border-line px-3 py-2 text-right tabular-nums text-ink-2 group-hover:bg-muted/60"
          title={r.kind === "MEMBER" ? `${r.attendedAsMember} of ${r.eligible} events with check-ins while a member` : "Rates are for members"}
        >
          {r.kind === "MEMBER" ? pct(r.rate) : <span className="text-ink-3">—</span>}
        </td>
        {cols.map((c) => {
          const cell = r.cells.get(c.occurrence.id);
          const wasMember = memberAt(m, c.occurrence.startsAt);
          const notYet = r.kind === "MEMBER" && !wasMember;
          const label = cell
            ? `${METHOD_LABEL[cell.method]} at ${fmtTime(cell.checkedInAt)}${cell.recordedById && data.recorders.get(cell.recordedById) ? ` by ${data.recorders.get(cell.recordedById)}` : ""}${notYet ? " (before joining)" : ""}`
            : notYet
              ? "Not a member yet"
              : c.held
                ? "Didn't check in"
                : "No check-ins recorded";
          return (
            <td
              key={c.occurrence.id}
              title={label}
              className={cn(
                "border-b border-line p-0 text-center group-hover:bg-muted/60",
                !cell && notYet && "bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_3px,transparent_3px_6px)]",
                !cell && !notYet && !c.held && "bg-muted/70",
              )}
            >
              <span className="flex h-11 items-center justify-center">
                {cell ? <MethodMark method={cell.method} muted={notYet} /> : null}
                <span className="sr-only">{label}</span>
              </span>
            </td>
          );
        })}
      </tr>
    );
  };

  const sectionRow = (label: string, hint?: string) => (
    <tr>
      <th scope="rowgroup" className={cn(stickyCell, "border-b bg-canvas px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-3")}>
        {label}
        {hint ? <span className="ml-1.5 font-normal normal-case tracking-normal">{hint}</span> : null}
      </th>
      <td colSpan={cols.length + 2} className="border-b border-line bg-canvas" />
    </tr>
  );

  const footRow = (label: string, values: (string | number)[], strong?: boolean) => (
    <tr>
      <th scope="row" className={cn(stickyCell, "border-t border-line bg-muted px-3 py-2 text-left text-xs font-medium text-ink-2")}>
        {label}
      </th>
      <td className="border-t border-line bg-muted" />
      <td className="border-r border-t border-line bg-muted" />
      {values.map((v, i) => (
        <td key={i} className={cn("border-t border-line bg-muted px-1 py-2 text-center text-xs tabular-nums", strong ? "font-semibold text-ink" : "text-ink-2")}>
          {v}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="space-y-2">
      <div
        id="table"
        className="max-h-[75vh] overflow-auto rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)] focus-visible:outline-2 focus-visible:outline-brand"
        role="region"
        aria-label="Attendance by member and event"
        tabIndex={0}
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">
            Check-ins by member (rows) and event (columns). Totals per person follow each name; totals per event are at the bottom.
          </caption>
          <thead>
            <tr>
              <th scope="col" className={cn(head, "left-0 z-30 border-r px-3 py-2 align-bottom")}>
                <SortTh s="name" label="Name" />
                <span className="mx-1.5 text-line-2">·</span>
                <SortTh s="recent" label="Recent" />
              </th>
              <th scope="col" className={cn(head, "px-3 py-2 text-right align-bottom")}>
                <SortTh s="attended" label="Came" />
              </th>
              <th scope="col" className={cn(head, "border-r px-3 py-2 text-right align-bottom")}>
                <SortTh s="rate" label="Rate" />
              </th>
              {cols.map((c) => (
                <th key={c.occurrence.id} scope="col" className={cn(head, "w-[60px] min-w-[60px] px-1 py-2 text-center align-bottom font-normal", !c.held && "text-ink-3/70")}>
                  <Link
                    href={`${base}/${c.occurrence.id}`}
                    className="block rounded px-0.5 hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand"
                    title={`${c.occurrence.title} — ${fmtDate(c.occurrence.startsAt)}, ${fmtTime(c.occurrence.startsAt)}${c.occurrence.hostName && c.occurrence.hostClubId !== null && c.occurrence.hostClubId !== data.clubId ? ` (hosted by ${c.occurrence.hostName})` : ""}`}
                  >
                    <span className="block text-[11px] uppercase tracking-wide">{fmtDate(c.occurrence.startsAt, "EEE")}</span>
                    <span className="block font-semibold text-ink">{fmtDate(c.occurrence.startsAt, "MMM d")}</span>
                    <span className="block max-w-[56px] truncate text-[11px] normal-case">{c.occurrence.title}</span>
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sectionRow(`Members · ${members.length}`)}
            {members.length ? (
              members.map(renderRow)
            ) : (
              <tr>
                <td colSpan={cols.length + 3} className="border-b border-line px-3 py-6 text-center text-sm text-ink-3">
                  No active members yet.
                </td>
              </tr>
            )}
            {guests.length
              ? sectionRow(
                  guests.some((g) => g.kind === "FORMER") ? `Guests & former members · ${guests.length}` : `Guests · ${guests.length}`,
                  "not in the club right now — guests are often other clubs' members",
                )
              : null}
            {guests.map(renderRow)}
          </tbody>
          <tfoot>
            {footRow(
              "Members who came",
              cols.map((c) => (c.held ? c.memberAttendees : "–")),
            )}
            {footRow(
              "Guests",
              cols.map((c) => (c.held ? c.guests : "–")),
            )}
            {footRow(
              "Members at the time",
              cols.map((c) => c.membersAtTime),
            )}
            {footRow(
              "Attendance rate",
              cols.map((c) => pct(c.rate, "–")),
              true,
            )}
          </tfoot>
        </table>
      </div>
      {data.capped ? <p className="text-xs text-ink-3">Showing the first 400 events in this range. Pick a shorter range to see the rest.</p> : null}
    </div>
  );
}
