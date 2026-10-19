import type { FundingRequestItem } from "@prisma/client";
import { fmtMoney } from "@/lib/time";
import { earlierFundedCents, lineCents } from "@/lib/funding/math";
import { Badge } from "@/components/ui/badge";

function qty(n: number) {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

type Line = Pick<FundingRequestItem, "quantity" | "unitCostCents" | "occurrences" | "totalCents">;

/** "2 × $12.50", "1 × $25.00 = $25.00 × 12 meetings", plus "· the rest after $570.00 funded earlier" when the line asks for what's left. */
export function lineMathText(i: Line): string {
  const set = lineCents(i.quantity, i.unitCostCents);
  const earlier = earlierFundedCents(i);
  return `${qty(i.quantity)} × ${fmtMoney(i.unitCostCents)}${i.occurrences > 1 ? ` = ${fmtMoney(set)} × ${i.occurrences} meetings` : ""}${earlier ? ` · the rest after ${fmtMoney(earlier)} funded earlier` : ""}`;
}

/**
 * The lines a request asked for, as they were when it was submitted (the
 * snapshot), with the occurrence math spelled out: one set × meetings. A
 * line that was funded in part before asks only for the rest, and says so.
 * Once WSUSA approves, `showApproved` adds what each line got (WSUSA decides
 * line by line).
 */
export function RequestItemsTable({
  items,
  requestedCents,
  approvedCents,
  showApproved,
  caption,
}: {
  items: (Pick<FundingRequestItem, "id" | "description" | "eventTitle" | "approvedCents"> & Line)[];
  requestedCents: number;
  approvedCents?: number | null;
  /** Approved requests: each line's approved amount. */
  showApproved?: boolean;
  caption?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="hidden bg-muted/60 text-left text-xs uppercase tracking-wide text-ink-3 sm:table-header-group">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Item
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              How it adds up
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              {showApproved ? "Asked" : "Total"}
            </th>
            {showApproved ? (
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Approved
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((i) => {
            const set = lineCents(i.quantity, i.unitCostCents);
            const earlier = earlierFundedCents(i);
            // An approval recorded before line-by-line decisions funded every line in full.
            const got = i.approvedCents ?? i.totalCents;
            return (
              <tr key={i.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 sm:table-row sm:p-0">
                <td className="min-w-0 basis-full sm:px-4 sm:py-2.5">
                  <p className="font-medium text-ink">{i.description}</p>
                  {i.eventTitle ? <p className="text-xs text-ink-3">Event: {i.eventTitle}</p> : <p className="text-xs text-ink-3">General cost</p>}
                </td>
                <td className="flex-1 text-ink-2 sm:px-4 sm:py-2.5">
                  <span className="tabular-nums">
                    {qty(i.quantity)} × {fmtMoney(i.unitCostCents)}
                    {i.occurrences > 1 ? (
                      <>
                        {" "}
                        = {fmtMoney(set)} × {i.occurrences} meetings
                      </>
                    ) : null}
                  </span>
                  {earlier ? <span className="block text-xs text-ink-3">The rest of the line: {fmtMoney(earlier)} was funded earlier.</span> : null}
                </td>
                <td className="text-right font-semibold tabular-nums text-ink sm:px-4 sm:py-2.5">
                  {showApproved ? <span className="mr-1 text-xs font-normal text-ink-3 sm:hidden">Asked</span> : null}
                  {fmtMoney(i.totalCents)}
                </td>
                {showApproved ? (
                  <td className="basis-full text-right tabular-nums sm:basis-auto sm:px-4 sm:py-2.5">
                    {got === 0 ? (
                      <Badge tone="danger">Not funded</Badge>
                    ) : (
                      <>
                        <span className="mr-1 text-xs text-ink-3 sm:hidden">Approved</span>
                        <span className={got < i.totalCents ? "font-semibold text-warning" : "font-semibold text-ink"}>{fmtMoney(got)}</span>
                        {got < i.totalCents ? <span className="block text-xs text-ink-3">less than asked</span> : null}
                      </>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-line bg-muted/40">
          {showApproved ? (
            <tr className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1 px-4 py-2.5 sm:table-row sm:p-0">
              <th scope="row" colSpan={2} className="mr-auto text-left font-medium text-ink sm:px-4 sm:py-2.5">
                Total
              </th>
              <td className="text-right font-semibold tabular-nums text-ink sm:px-4 sm:py-2.5">
                <span className="mr-1 text-xs font-normal text-ink-3 sm:hidden">Asked</span>
                {fmtMoney(requestedCents)}
              </td>
              <td className="text-right text-base font-bold tabular-nums text-ink sm:px-4 sm:py-2.5">
                <span className="mr-1 text-xs font-normal text-ink-3 sm:hidden">Approved</span>
                {fmtMoney(approvedCents ?? requestedCents)}
              </td>
            </tr>
          ) : (
            <>
              <tr className="flex justify-between gap-3 px-4 py-2.5 sm:table-row sm:p-0">
                <th scope="row" colSpan={2} className="text-left font-medium text-ink sm:px-4 sm:py-2.5">
                  Requested
                </th>
                <td className="text-right font-semibold tabular-nums text-ink sm:px-4 sm:py-2.5">{fmtMoney(requestedCents)}</td>
              </tr>
              {approvedCents != null ? (
                <tr className="flex justify-between gap-3 px-4 pb-2.5 sm:table-row sm:p-0">
                  <th scope="row" colSpan={2} className="text-left font-medium text-ink sm:px-4 sm:pb-2.5">
                    Approved
                  </th>
                  <td className="text-right text-base font-bold tabular-nums text-ink sm:px-4 sm:pb-2.5">{fmtMoney(approvedCents)}</td>
                </tr>
              ) : null}
            </>
          )}
        </tfoot>
      </table>
    </div>
  );
}
