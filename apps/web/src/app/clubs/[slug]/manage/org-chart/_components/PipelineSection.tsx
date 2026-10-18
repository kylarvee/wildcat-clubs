import Link from "next/link";
import type { ReactNode } from "react";
import type { ClubRole, ClubType, ElectionStatus, SuccessionMethod } from "@prisma/client";
import { ArrowRight, Workflow } from "lucide-react";
import { ROLE_LABEL } from "@/lib/authz";
import { inClubPipeline, pipelineOrder } from "@/lib/roles/pipeline";
import { selectionStatus, SUCCESSION_NAME } from "@/lib/roles/labels";
import { ElectionStatusBadge } from "@/components/elections/ElectionBits";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { CreateElectionDialog, type ElectableSeat, type SelectionDefaults } from "../../elections/_components/CreateElectionDialog";

export type PipelineRow = {
  id: string;
  name: string;
  role: ClubRole;
  sortOrder: number;
  holders: string[];
  nextInLine: string[];
  running: { id: string; status: ElectionStatus; method: SuccessionMethod; proposedCandidateId: string | null } | null;
};

/**
 * The org chart as the leadership pipeline: every seat in order with who
 * holds it and who's next in line, any selection already filling it, and a
 * "Fill this seat" action on open seats (the club's primary mode, with the
 * option to switch). In regular clubs the ambassador seats belong to the
 * college's program, so they get no action here (the org chart asks the
 * program for one, next to the ambassador seat).
 */
export function PipelineSection({
  slug,
  clubId,
  clubType,
  primary,
  rows,
  fill,
  canFill,
  canManage,
  footer,
}: {
  slug: string;
  clubId: string;
  clubType: ClubType;
  primary: SuccessionMethod;
  rows: PipelineRow[];
  fill: { seats: ElectableSeat[]; defaults: SelectionDefaults; termLabel: string | null };
  /** Whether the viewer may start filling a seat of this role (elections capability + the rank rule). */
  canFill: (role: ClubRole) => boolean;
  /** Opens the manage view of a running selection (elections capability); otherwise the member view. */
  canManage: boolean;
  footer?: ReactNode;
}) {
  const ordered = pipelineOrder(rows);
  const own = ordered.filter((r) => inClubPipeline(r.role, clubType));
  const college = ordered.filter((r) => !inClubPipeline(r.role, clubType));
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Workflow className="h-4 w-4 text-brand" aria-hidden /> Leadership pipeline
          </span>
        }
        description={`Seats in order, top to bottom. When a seat opens, the people below it are the first candidates and whoever moves up leaves their seat open for the next. Primary method: ${SUCCESSION_NAME[primary]}.`}
        action={
          <Link href={`/clubs/${slug}/manage/elections`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
            Elections <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      />
      <ol className="divide-y divide-line border-t border-line" aria-label="Seats in pipeline order">
        {own.map((r, i) => {
          const vacant = r.holders.length === 0;
          const href = r.running ? `/clubs/${slug}/${canManage ? "manage/" : ""}elections/${r.running.id}` : null;
          return (
            <li key={r.id} className={cn("flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center", vacant && !r.running && "bg-warning-50/40")}>
              <span aria-hidden className="hidden w-5 shrink-0 text-right text-xs tabular-nums text-ink-3 sm:block">
                {i + 1}.
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium text-ink">{r.name}</span>
                  {r.name !== ROLE_LABEL[r.role] ? <span className="text-xs text-ink-3">{ROLE_LABEL[r.role]}</span> : null}
                  {vacant ? <Badge tone="warning">Open</Badge> : null}
                </p>
                <p className="text-sm text-ink-2">{vacant ? "Nobody holds this seat right now." : r.holders.join(", ")}</p>
                <p className="text-xs text-ink-3">{r.nextInLine.length ? `Next in line: ${r.nextInLine.join(", ")}` : "Nobody below it on the chart; members sit below."}</p>
              </div>
              <div className="shrink-0">
                {r.running && href ? (
                  <Link
                    href={href}
                    aria-label={`${r.name} is being filled (${SUCCESSION_NAME[r.running.method]}): ${selectionStatus(r.running).label.toLowerCase()}. Open it.`}
                    className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:border-brand-200 hover:bg-brand-50/50 focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <ElectionStatusBadge status={r.running.status} method={r.running.method} proposedCandidateId={r.running.proposedCandidateId} />
                    <span>{SUCCESSION_NAME[r.running.method]}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-brand" aria-hidden />
                  </Link>
                ) : vacant && canFill(r.role) ? (
                  <CreateElectionDialog
                    slug={slug}
                    clubId={clubId}
                    seats={fill.seats}
                    primary={primary}
                    defaults={fill.defaults}
                    termLabel={fill.termLabel}
                    fixedSeatId={r.id}
                    triggerLabel="Fill this seat"
                    triggerSize="sm"
                  />
                ) : null}
              </div>
            </li>
          );
        })}
        {college.map((r) => (
          <li key={r.id} className="flex flex-col gap-1 px-5 py-3 sm:pl-12">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-medium text-ink">{r.name}</span>
              {r.name !== ROLE_LABEL[r.role] ? <span className="text-xs text-ink-3">{ROLE_LABEL[r.role]}</span> : null}
              {r.holders.length === 0 ? <Badge tone="neutral">Open</Badge> : null}
            </p>
            <p className="text-sm text-ink-2">{r.holders.length ? r.holders.join(", ") : "Nobody placed right now."}</p>
            <p className="text-xs text-ink-3">Filled by the college&apos;s ambassador program, not the club&apos;s pipeline. See College Ambassador below.</p>
          </li>
        ))}
      </ol>
      {footer ? <CardBody className="border-t border-line">{footer}</CardBody> : null}
    </Card>
  );
}
