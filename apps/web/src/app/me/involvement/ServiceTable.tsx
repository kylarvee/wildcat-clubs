import Link from "next/link";
import type { ServiceEntry, ServiceTotal } from "@/lib/metrics/types";
import { fmtServiceHours, serviceEventsLabel } from "@/lib/metrics/service";
import { fmtDate } from "@/lib/time";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { LogoMark } from "@/components/shell/Logo";

function Hosts({ e }: { e: ServiceEntry }) {
  if (!e.club) {
    return (
      <span className="flex items-center gap-2 text-ink-2">
        <LogoMark size={20} /> University event
      </span>
    );
  }
  return (
    <span className="min-w-0">
      <Link href={`/clubs/${e.club.slug}`} className="hover:text-brand-600 hover:underline">
        {e.club.name}
      </Link>
      {e.cohosts.length ? <span className="text-ink-3"> with {e.cohosts.map((c) => c.name).join(", ")}</span> : null}
    </span>
  );
}

/**
 * Every date that earned service hours, newest first, with the total. A few
 * dozen rows at most, so it renders on the server. On phones the club folds
 * under the event so nothing scrolls sideways.
 */
export function ServiceTable({ entries, total }: { entries: ServiceEntry[]; total: ServiceTotal }) {
  return (
    <Table>
      <caption className="sr-only">Service hours by date: {entries.length} dates, {fmtServiceHours(total.minutes)} hours in all.</caption>
      <THead>
        <tr>
          <TH scope="col">Date</TH>
          <TH scope="col">Event</TH>
          <TH scope="col" className="hidden md:table-cell">
            Club
          </TH>
          <TH scope="col" className="text-right">
            Hours
          </TH>
        </tr>
      </THead>
      <TBody>
        {entries.map((e) => (
          <TR key={e.attendanceId}>
            <TD className="whitespace-nowrap align-top">
              <span className="block text-ink">{fmtDate(e.startsAt, "MMM d, yyyy")}</span>
              {e.term ? <span className="block text-xs text-ink-3">{e.term}</span> : null}
            </TD>
            <TD className="align-top">
              <span className="font-medium text-ink">{e.title}</span>
              <div className="mt-1 text-sm md:hidden">
                <Hosts e={e} />
              </div>
            </TD>
            <TD className="hidden align-top text-sm md:table-cell">
              <Hosts e={e} />
            </TD>
            <TD className="whitespace-nowrap text-right align-top font-semibold tabular-nums">{fmtServiceHours(e.minutes)}</TD>
          </TR>
        ))}
      </TBody>
      <tfoot className="border-t border-line bg-muted/60">
        <tr>
          <th scope="row" colSpan={2} className="px-4 py-2.5 text-left text-sm font-semibold text-ink md:hidden">
            Total · {serviceEventsLabel(total.events)}
          </th>
          <th scope="row" colSpan={3} className="hidden px-4 py-2.5 text-left text-sm font-semibold text-ink md:table-cell">
            Total · {serviceEventsLabel(total.events)}
          </th>
          <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{fmtServiceHours(total.minutes)}</td>
        </tr>
      </tfoot>
    </Table>
  );
}
