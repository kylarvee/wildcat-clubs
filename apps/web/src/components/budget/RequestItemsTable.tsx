import type { FundingRequestItem } from "@prisma/client";
import { fmtMoney } from "@/lib/time";
import { lineCents } from "@/lib/funding/math";

function qty(n: number) {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * The lines a request asked for, as they were when it was submitted (the
 * snapshot), with the occurrence math spelled out: one set × meetings.
 */
export function RequestItemsTable({
  items,
  requestedCents,
  approvedCents,
  caption,
}: {
  items: Pick<FundingRequestItem, "id" | "description" | "eventTitle" | "quantity" | "unitCostCents" | "occurrences" | "totalCents">[];
  requestedCents: number;
  approvedCents?: number | null;
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
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((i) => {
            const set = lineCents(i.quantity, i.unitCostCents);
            return (
              <tr key={i.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5 sm:table-row sm:p-0">
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
                </td>
                <td className="text-right font-semibold tabular-nums text-ink sm:px-4 sm:py-2.5">{fmtMoney(i.totalCents)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-line bg-muted/40">
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
        </tfoot>
      </table>
    </div>
  );
}
