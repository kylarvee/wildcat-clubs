import Link from "next/link";
import { ArrowRight, Vote } from "lucide-react";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { syncClubElections } from "@/lib/domain/elections";
import { clubElections } from "@/lib/roles/election-queries";
import { selectionSetup } from "@/lib/roles/selection-setup";
import { SUCCESSION_METHODS } from "@/lib/roles/pipeline";
import { SUCCESSION_NAME, SUCCESSION_STEPS } from "@/lib/roles/labels";
import { ElectionStatusBadge, fmtWhen, MethodBadge } from "@/components/elections/ElectionBits";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Callout, EmptyState, PageHeader, Section } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { CreateElectionDialog } from "./_components/CreateElectionDialog";

export const metadata = { title: "Elections" };

type Row = Awaited<ReturnType<typeof clubElections>>[number];

/** One line on where a running selection stands, in its mode's terms. */
function progress(e: Row, extra: { saidYes: number; proposedName: string | null }) {
  if (e.method === "ADVISOR_PRESIDENT") return extra.proposedName ? `${extra.proposedName} is proposed, waiting to be confirmed` : `Waiting for a proposal · decide by ${fmtWhen(e.votingClosesAt)}`;
  if (e.method === "NEXT_IN_LINE") return e.status === "VOTING" ? `${extra.saidYes} said yes so far · answers due ${fmtWhen(e.votingClosesAt)}` : "Answers are in — ready to move someone up";
  if (e.status === "NOMINATING") return `Voting opens ${fmtWhen(e.votingOpensAt)}`;
  if (e.status === "VOTING") return `Voting closes ${fmtWhen(e.votingClosesAt)}`;
  return e.method === "SELF_SELECT" ? "Voting closed — see whether it was unanimous" : "Voting closed — ready to apply";
}

export default async function ManageElectionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club, access, allowed } = await loadClubWorkspace(slug, "elections");
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Elections" />
        <NoPermission what="elections" suspended={access.suspended} />
      </div>
    );
  }

  await syncClubElections(club.id);
  const [elections, setup, cfg] = await Promise.all([clubElections(club.id), selectionSetup(club.id), getConfig()]);
  const running = elections.filter((e) => e.status === "NOMINATING" || e.status === "VOTING" || e.status === "CLOSED");
  const past = elections.filter((e) => e.status === "APPLIED" || e.status === "CANCELLED");
  const [yesRows, proposedRows] = await Promise.all([
    db.electionCandidate.groupBy({ by: ["electionId"], where: { electionId: { in: running.map((e) => e.id) }, acceptedAt: { not: null } }, _count: { _all: true } }),
    db.electionCandidate.findMany({ where: { id: { in: running.map((e) => e.proposedCandidateId).filter((x): x is string => Boolean(x)) } }, select: { id: true, user: { select: { name: true } } } }),
  ]);
  const saidYes = new Map(yesRows.map((r) => [r.electionId, r._count._all]));
  const proposedName = new Map(proposedRows.map((r) => [r.id, r.user.name]));
  const primary = club.successionMethod;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Elections"
        description={`Fill ${club.name}'s leadership seats from its org chart. Your constitution's primary method is ${SUCCESSION_NAME[primary]}; you can use any of the four for a particular seat.`}
        actions={
          setup.seats.length ? (
            <CreateElectionDialog slug={club.slug} clubId={club.id} seats={setup.seats} primary={primary} defaults={setup.defaults} termLabel={setup.termLabel} />
          ) : null
        }
      />

      {setup.seats.length === 0 ? (
        <Callout tone="warning" title="No seats to fill">
          Set up your org chart first — every way of choosing leaders fills its seats. <Link href={`/clubs/${club.slug}/manage/org-chart`} className="underline">Open the org chart</Link>
        </Callout>
      ) : null}

      <section aria-labelledby="modes-heading" className="space-y-2">
        <h2 id="modes-heading" className="text-sm font-semibold text-ink">
          Four ways to fill a seat
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {SUCCESSION_METHODS.map((m) => (
            <li key={m} className={cn("rounded-xl border p-3 text-sm", m === primary ? "border-brand bg-brand-50/60" : "border-line bg-surface")}>
              <p className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                {SUCCESSION_NAME[m]}
                {m === primary ? <Badge tone="brand">Primary</Badge> : null}
              </p>
              <p className="mt-0.5 text-ink-3">
                {SUCCESSION_STEPS[m]}
                {m === "MEMBER_VOTE" ? ` Active means checked in within ${cfg["activity.studentWindowDays"]} days or at one of the last ${cfg["activity.studentRecentEvents"]} events.` : ""}
              </p>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-3">
          Whichever you use, the people on the org chart below the seat become candidates automatically, and whoever moves up leaves their old seat open for the next one. The primary method comes from{" "}
          <Link href={`/clubs/${club.slug}/manage/constitution`} className="underline">
            your constitution and bylaws
          </Link>
          .
        </p>
      </section>

      {elections.length === 0 ? (
        <EmptyState icon={<Vote />} title="Nothing in progress" description="Fill a seat here, or from an open seat in the org chart. The people it involves hear about it right away." />
      ) : null}

      {running.length ? (
        <Section title="In progress">
          <div className="grid gap-4 md:grid-cols-2">
            {running.map((e) => (
              <Link
                key={e.id}
                href={`/clubs/${club.slug}/manage/elections/${e.id}`}
                className="group flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] hover:border-brand-200 focus-visible:outline-2 focus-visible:outline-brand"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{e.title}</p>
                    <p className="text-sm text-ink-3">{e.position.name}</p>
                  </div>
                  <ElectionStatusBadge status={e.status} method={e.method} proposedCandidateId={e.proposedCandidateId} />
                </div>
                <p className="text-sm text-ink-2">{progress(e, { saidYes: saidYes.get(e.id) ?? 0, proposedName: e.proposedCandidateId ? (proposedName.get(e.proposedCandidateId) ?? null) : null })}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <MethodBadge method={e.method} />
                  <span>
                    {e._count.candidates} {e.method === "NEXT_IN_LINE" ? "in line" : `candidate${e._count.candidates === 1 ? "" : "s"}`}
                  </span>
                  {e.method === "MEMBER_VOTE" || e.method === "SELF_SELECT" ? (
                    e.status !== "NOMINATING" ? (
                      <span>
                        · {e._count.votes} ballot{e._count.votes === 1 ? "" : "s"}
                      </span>
                    ) : null
                  ) : null}
                  {e.status === "NOMINATING" && e._count.candidates === 0 ? <Badge tone="warning">No candidates yet</Badge> : null}
                  <ArrowRight className="ml-auto h-4 w-4 text-brand transition-transform group-hover:translate-x-0.5" aria-hidden />
                </div>
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      {past.length ? (
        <Section title="Past">
          <Card>
            <ul className="divide-y divide-line">
              {past.map((e) => (
                <li key={e.id}>
                  <Link href={`/clubs/${club.slug}/manage/elections/${e.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-brand">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{e.title}</span>
                      <span className="block text-xs text-ink-3">
                        {e.position.name} · {SUCCESSION_NAME[e.method]} · {e.status === "APPLIED" && e.appliedAt ? `filled ${fmtWhen(e.appliedAt)}` : `called off`}
                      </span>
                    </span>
                    <ElectionStatusBadge status={e.status} method={e.method} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      <PolicyNotices placement="OFFICER_ROLES" />
    </div>
  );
}
