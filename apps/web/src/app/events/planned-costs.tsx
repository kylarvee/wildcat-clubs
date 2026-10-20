import Link from "next/link";
import { Wallet } from "lucide-react";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { eventCostSummaries } from "@/lib/domain/events";
import { fmtDate, fmtMoney } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

/**
 * Leaders, under the Events page's month view: what their clubs' upcoming
 * events are expected to cost, with the way to ask for money. Read-only:
 * costs are entered in the Events Builder and requested in Budget.
 */
export async function PlannedCosts({ actor }: { actor: Actor }) {
  const roles = await db.roleAssignment.findMany({ where: { userId: actor.id, endedAt: null, role: { not: "MEMBER" } }, select: { clubId: true } });
  const clubIds: string[] = [];
  for (const id of [...new Set(roles.map((r) => r.clubId))]) {
    const access = await getClubAccess(actor, id);
    if (access && (access.capabilities.has("budget") || access.capabilities.has("events"))) clubIds.push(id);
  }
  if (clubIds.length === 0) return null;
  const now = new Date();
  const events = await db.event.findMany({
    where: { clubId: { in: clubIds }, status: "SCHEDULED", costItems: { some: {} }, occurrences: { some: { startsAt: { gte: now }, status: "SCHEDULED" } } },
    select: {
      id: true,
      title: true,
      club: { select: { id: true, name: true, slug: true } },
      occurrences: { where: { startsAt: { gte: now }, status: "SCHEDULED" }, orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true } },
    },
    take: 40,
  });
  const summaries = await eventCostSummaries(events.map((e) => e.id));
  const byClub = new Map<string, { name: string; slug: string; rows: { id: string; title: string; next: Date; total: number }[] }>();
  for (const e of events) {
    if (!e.club) continue;
    const g = byClub.get(e.club.id) ?? { name: e.club.name, slug: e.club.slug, rows: [] };
    g.rows.push({ id: e.id, title: e.title, next: e.occurrences[0].startsAt, total: summaries.get(e.id)?.totalCents ?? 0 });
    byClub.set(e.club.id, g);
  }
  return (
    <Card className="mt-6">
      <CardHeader title="Planned event costs" description="Only you and your club's leaders see these." />
      <CardBody className="space-y-4">
        {byClub.size === 0 ? (
          <p className="text-sm text-ink-3">None of your clubs&apos; upcoming events have costs yet. Add them in each event&apos;s Costs section.</p>
        ) : (
          [...byClub.values()].map((g) => (
            <div key={g.slug}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-ink">{g.name}</p>
                <Link href={`/clubs/${g.slug}/manage/budget`} className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                  <Wallet className="h-3.5 w-3.5" /> Request funding
                </Link>
              </div>
              <ul className="divide-y divide-line text-sm">
                {g.rows
                  .sort((a, b) => a.next.getTime() - b.next.getTime())
                  .slice(0, 6)
                  .map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
                      <Link href={`/events/${r.id}`} className="min-w-0 truncate text-ink-2 hover:underline">
                        {r.title} <span className="text-xs text-ink-3">· {fmtDate(r.next, "MMM d")}</span>
                      </Link>
                      <span className="shrink-0 font-medium tabular-nums">{fmtMoney(r.total)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}
