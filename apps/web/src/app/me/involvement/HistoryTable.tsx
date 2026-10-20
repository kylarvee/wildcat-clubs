"use client";

import Link from "next/link";
import type { CheckInMethod } from "@prisma/client";
import { fmtDate, fmtTime } from "@/lib/time";
import type { ClubRef } from "@/lib/attendance/queries";
import { ClubLogo } from "@/components/ui/avatar";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { LogoMark } from "@/components/shell/Logo";
import { MethodBadge } from "@/components/attendance/MethodMark";

/** One check-in, reduced to what the history table shows. */
export type HistoryRow = {
  id: string;
  startsAt: Date;
  title: string;
  method: CheckInMethod;
  /** Checked in without being a member of any club that put it on. */
  asGuest: boolean;
  /** Host club; null for university events. */
  club: ClubRef | null;
  /** Co-hosts' names, after the host. */
  cohosts: string[];
};

/** `wrap`: the phone layout, where the name wraps under the event instead of widening the table. */
function ClubCell({ r, wrap = false }: { r: HistoryRow; wrap?: boolean }) {
  return r.club ? (
    <Link href={`/clubs/${r.club.slug}`} className="flex min-w-0 items-center gap-2 hover:text-brand-600">
      <ClubLogo name={r.club.name} src={r.club.logoUrl} color={r.club.logoColor} size="sm" className="h-6 w-6 shrink-0 rounded-md text-[10px]" />
      <span className={wrap ? "min-w-0 [overflow-wrap:anywhere]" : "truncate"}>{r.club.name}</span>
      {r.cohosts.length ? (
        <span className="shrink-0 text-xs text-ink-3" title={`With ${r.cohosts.join(", ")}`}>
          +{r.cohosts.length}
        </span>
      ) : null}
    </Link>
  ) : (
    <span className="flex items-center gap-2 text-ink-2">
      <LogoMark size={24} /> University event
    </span>
  );
}

/**
 * My involvement's attendance history. A client component on purpose: the page sends
 * the rows as data and they render here, instead of hundreds of server
 * component instances per page (the cost that made this page slow).
 * On phones the club and method fold under the event so nothing scrolls sideways.
 */
export function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH scope="col">Date</TH>
          <TH scope="col">Event</TH>
          <TH scope="col" className="hidden md:table-cell">
            Club
          </TH>
          <TH scope="col" className="hidden sm:table-cell">
            How
          </TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD className="whitespace-nowrap align-top">
              <span className="block text-ink">{fmtDate(r.startsAt, "MMM d, yyyy")}</span>
              <span className="block text-xs text-ink-3">
                {fmtDate(r.startsAt, "EEE")} · {fmtTime(r.startsAt)}
              </span>
            </TD>
            <TD className="align-top">
              <span className="font-medium text-ink">{r.title}</span>
              {r.asGuest ? <span className="ml-2 align-middle text-xs text-ink-3">as a guest</span> : null}
              <div className="mt-1.5 text-sm md:hidden">
                <ClubCell r={r} wrap />
              </div>
              <div className="mt-1.5 sm:hidden">
                <MethodBadge method={r.method} />
              </div>
            </TD>
            <TD className="hidden max-w-[240px] md:table-cell">
              <ClubCell r={r} />
            </TD>
            <TD className="hidden sm:table-cell">
              <MethodBadge method={r.method} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
