"use client";

import Link from "next/link";
import { ArrowDown } from "lucide-react";
import type { CheckInMethod } from "@prisma/client";
import { memberAt, pct, type RowSort } from "@/lib/attendance/matrix";
import { METHOD_LABEL } from "@/lib/attendance/rules";
import { fmtDate, fmtTime } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { MethodMark } from "@/components/attendance/MethodMark";

/** One meeting (a column), with the per-event numbers from lib/metrics. */
export type GridColumn = {
  id: string;
  startsAt: Date;
  title: string;
  /** "Robotics Club" when another club hosted it (a co-hosted event). */
  hostedBy: string | null;
  held: boolean;
  memberAttendees: number;
  guests: number;
  membersAtTime: number;
  rate: number | null;
};

export type GridCell = { method: CheckInMethod; checkedInAt: Date; recordedBy: string | null };

/** One person (a row): plain data the server prepared, cells aligned with the columns. */
export type GridRow = {
  userId: string;
  kind: "MEMBER" | "FORMER" | "GUEST";
  name: string;
  avatarUrl: string | null;
  avatarColor: string;
  /** "Treasurer · Social chair", "Former member", "Member of Robotics Club +1", "Guest". */
  subtitle: string;
  active: boolean;
  attended: number;
  attendedAsMember: number;
  eligible: number;
  rate: number | null;
  membership: { status: string; joinedAt: Date | null; endedAt: Date | null } | null;
  cells: (GridCell | null)[];
};

const stickyCell = "sticky left-0 z-10 border-r border-line bg-surface";
const head = "sticky top-0 z-20 border-b border-line bg-muted text-left text-xs font-medium text-ink-3";

function SortTh({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} scroll={false} className={cn("inline-flex items-center gap-1 rounded hover:text-ink focus-visible:outline-2 focus-visible:outline-brand", active && "text-ink")} aria-label={`Sort by ${label.toLowerCase()}`}>
      {label}
      {active ? <ArrowDown className="h-3 w-3" aria-hidden /> : null}
    </Link>
  );
}

/**
 * The tracker's table body, rendered from plain rows. A client component on
 * purpose: a big club's table is thousands of cells, and sending them as data
 * (instead of a server component per mark) keeps the page fast.
 */
export function AttendanceMatrixGrid({
  base,
  sort,
  sortHrefs,
  columns,
  members,
  guests,
  guestsLabel,
  capped,
}: {
  base: string;
  sort: RowSort;
  sortHrefs: Record<RowSort, string>;
  columns: GridColumn[];
  members: GridRow[];
  guests: GridRow[];
  guestsLabel: string;
  capped: boolean;
}) {
  const sortTh = (s: RowSort, label: string) => <SortTh href={sortHrefs[s]} label={label} active={sort === s} />;

  const renderRow = (r: GridRow) => (
    <tr key={r.userId} className="group">
      <th scope="row" className={cn(stickyCell, "border-b px-3 py-2 text-left font-normal group-hover:bg-muted")}>
        <div className="flex min-w-[180px] max-w-[240px] items-center gap-2.5">
          <Avatar name={r.name} src={r.avatarUrl} color={r.avatarColor} size="xs" />
          <div className="min-w-0">
            <Link href={`${base}/members/${r.userId}`} className="block truncate font-medium text-ink hover:text-brand-600 hover:underline">
              {r.name}
            </Link>
            {r.subtitle ? <p className="truncate text-xs text-ink-3">{r.subtitle}</p> : null}
          </div>
          {r.kind === "MEMBER" && r.active ? (
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
      {columns.map((c, i) => {
        const cell = r.cells[i];
        const notYet = r.kind === "MEMBER" && !memberAt(r.membership, c.startsAt);
        const label = cell
          ? `${METHOD_LABEL[cell.method]} at ${fmtTime(cell.checkedInAt)}${cell.recordedBy ? ` by ${cell.recordedBy}` : ""}${notYet ? " (before joining)" : ""}`
          : notYet
            ? "Not a member yet"
            : c.held
              ? "Didn't check in"
              : "No check-ins recorded";
        return (
          <td
            key={c.id}
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

  const sectionRow = (label: string, hint?: string) => (
    <tr>
      <th scope="rowgroup" className={cn(stickyCell, "border-b bg-canvas px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-3")}>
        {label}
        {hint ? <span className="ml-1.5 font-normal normal-case tracking-normal">{hint}</span> : null}
      </th>
      <td colSpan={columns.length + 2} className="border-b border-line bg-canvas" />
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
                {sortTh("name", "Name")}
                <span className="mx-1.5 text-line-2">·</span>
                {sortTh("recent", "Recent")}
              </th>
              <th scope="col" className={cn(head, "px-3 py-2 text-right align-bottom")}>
                {sortTh("attended", "Came")}
              </th>
              <th scope="col" className={cn(head, "border-r px-3 py-2 text-right align-bottom")}>
                {sortTh("rate", "Rate")}
              </th>
              {columns.map((c) => (
                <th key={c.id} scope="col" className={cn(head, "w-[60px] min-w-[60px] px-1 py-2 text-center align-bottom font-normal", !c.held && "text-ink-3/70")}>
                  <Link
                    href={`${base}/${c.id}`}
                    className="block rounded px-0.5 hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand"
                    title={`${c.title} — ${fmtDate(c.startsAt)}, ${fmtTime(c.startsAt)}${c.hostedBy ? ` (hosted by ${c.hostedBy})` : ""}`}
                  >
                    <span className="block text-[11px] uppercase tracking-wide">{fmtDate(c.startsAt, "EEE")}</span>
                    <span className="block font-semibold text-ink">{fmtDate(c.startsAt, "MMM d")}</span>
                    <span className="block max-w-[56px] truncate text-[11px] normal-case">{c.title}</span>
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
                <td colSpan={columns.length + 3} className="border-b border-line px-3 py-6 text-center text-sm text-ink-3">
                  No active members yet.
                </td>
              </tr>
            )}
            {guests.length ? sectionRow(guestsLabel, "not in the club right now — guests are often other clubs' members") : null}
            {guests.map(renderRow)}
          </tbody>
          <tfoot>
            {footRow(
              "Members who came",
              columns.map((c) => (c.held ? c.memberAttendees : "–")),
            )}
            {footRow(
              "Guests",
              columns.map((c) => (c.held ? c.guests : "–")),
            )}
            {footRow(
              "Members at the time",
              columns.map((c) => c.membersAtTime),
            )}
            {footRow(
              "Attendance rate",
              columns.map((c) => pct(c.rate, "–")),
              true,
            )}
          </tfoot>
        </table>
      </div>
      {capped ? <p className="text-xs text-ink-3">Showing the first 400 events in this range. Pick a shorter range to see the rest.</p> : null}
    </div>
  );
}
