import type { BuilderLine } from "@/components/budget/RequestBuilder";
import type { ClubTermBudget } from "@/lib/domain/funding";

/** The builder's lines, in the order the budget page shows them (events by date, then other costs). */
export function builderLines(budget: ClubTermBudget): BuilderLine[] {
  return [...budget.eventGroups.flatMap((g) => g.lines), ...budget.general].map((l) => ({
    id: l.id,
    eventId: l.eventId,
    eventTitle: l.eventTitle,
    description: l.description,
    category: l.category,
    fundingSource: l.fundingSource,
    perOccurrence: l.perOccurrence,
    quantity: l.quantity,
    unitCostCents: l.unitCostCents,
    setCents: l.setCents,
    occurrences: l.occurrences,
    totalCents: l.totalCents,
    lockedBy: l.lockedBy ? { title: l.lockedBy.title, status: l.lockedBy.status } : null,
  }));
}
