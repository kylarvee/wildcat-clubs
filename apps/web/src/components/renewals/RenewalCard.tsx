import Link from "next/link";
import { BadgeCheck, CircleAlert, CircleCheck } from "lucide-react";
import type { RenewalCheckRow, RenewalView } from "@/lib/domain/renewals";
import { fmtLongDate } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardFooter } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { RenewButton } from "@/components/renewals/RenewButton";

/**
 * The workspace overview's renewal card (lib/domain/renewals renewalView):
 * the checks and "Renew for 2026–27" while renewal is due or late, then one
 * line once the club renewed. Nothing while it isn't open.
 */
export function RenewalCard({ view }: { view: RenewalView }) {
  const { window, status } = view;
  if (!view.showCard || !window) return null;

  if (status.kind === "renewed") {
    return (
      <Card id="renewal" className="scroll-mt-24">
        <CardBody className="flex items-center gap-3 text-sm">
          <BadgeCheck className="h-5 w-5 shrink-0 text-brand" aria-hidden />
          <p className="min-w-0 text-ink-2">
            <span className="font-semibold text-ink">Re-registered {window.year}</span>
            {view.renewal ? ` · by ${view.renewal.byName ?? "a former leader"} on ${fmtLongDate(view.renewal.at)}` : null}
          </p>
        </CardBody>
      </Card>
    );
  }

  const reason = view.whyNot ?? status.hint;
  return (
    <Card id="renewal" className={cn("scroll-mt-24", view.canRenew && "border-brand-200 ring-1 ring-brand-100")}>
      {/* Not CardHeader: on a phone the status wraps under the title instead of squeezing the description. */}
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
          <h2 className="min-w-0 text-base font-semibold text-ink">
            Renew {view.club.name} for {window.year}
          </h2>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p className="mt-1 text-sm text-ink-3">{view.office} re-registers its clubs once a year. Once the required checks are green, confirm the club will be active and you&apos;re done.</p>
      </div>
      <CardBody className="space-y-4">
        <CheckList title="Needed to renew" checks={view.checks.filter((c) => c.required)} />
        <CheckList title="Recommended" checks={view.checks.filter((c) => !c.required)} />
      </CardBody>
      <CardFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p id="renewal-reason" className="text-sm text-ink-3">
          {reason}
        </p>
        <RenewButton clubId={view.club.id} clubName={view.club.name} office={view.office} year={window.year} disabled={!view.canRenew} describedBy="renewal-reason" />
      </CardFooter>
    </Card>
  );
}

function CheckList({ title, checks }: { title: string; checks: RenewalCheckRow[] }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      <ul className="divide-y divide-line">
        {checks.map((c) => (
          <li key={c.key} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 text-sm">
            {c.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />}
            <div className="min-w-0 flex-1 basis-48">
              <p className="font-medium text-ink">
                {c.label}
                <span className="sr-only">{c.ok ? " (done)" : c.required ? " (needed to renew)" : " (recommended)"}</span>
              </p>
              <p className="text-ink-3">{c.detail}</p>
            </div>
            {!c.ok ? (
              <Link href={c.fix.href} className="ml-7 shrink-0 font-medium text-brand-600 hover:underline sm:ml-0">
                {c.fix.label}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
