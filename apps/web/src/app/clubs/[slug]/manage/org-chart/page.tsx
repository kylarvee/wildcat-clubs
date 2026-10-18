import Link from "next/link";
import type { ClubRole } from "@prisma/client";
import { Archive, Network } from "lucide-react";
import { CAPABILITIES, ALL_CAPABILITIES, ROLE_LABEL } from "@/lib/authz";
import { db } from "@/lib/db";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { activeRequirements, activeStudentMembers, orgChartData, trainingStatusFor, type ChartSeat } from "@/lib/roles/queries";
import { selectionSetup } from "@/lib/roles/selection-setup";
import { fmtMonthRange } from "@/lib/roles/history";
import { inClubPipeline } from "@/lib/roles/pipeline";
import { TIERS } from "@/lib/roles/labels";
import { fmtLongDate } from "@/lib/time";
import { SeatCard } from "@/components/roles/SeatCard";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { RequestAmbassadorCard } from "@/components/ambassadors/RequestAmbassadorCard";
import { Badge } from "@/components/ui/badge";
import { Callout, EmptyState, Section } from "@/components/ui/layout";
import { CreateElectionDialog } from "../elections/_components/CreateElectionDialog";
import { ToolHeader } from "./_components/ToolHeader";
import { AssignDialog } from "./_components/AssignDialog";
import { HandOffDialog } from "./_components/HandOffDialog";
import { HolderMenu } from "./_components/HolderMenu";
import { PipelineSection, type PipelineRow } from "./_components/PipelineSection";
import { AddSeatButton, SeatMenu } from "./_components/SeatMenu";
import { RestoreDefaultsButton, RestoreSeatButton, StartDefaultsButton } from "./_components/ChartButtons";
import type { SeatInfo, ToolContext } from "./_components/types";

export const metadata = { title: "Org chart" };

const TIER_HINT: Record<string, string> = {
  president: "Leads the club. A President can name a co-President or their successor.",
  vp: "Can do everything the President can, except assign Presidents or Vice Presidents and retire the club.",
  officers: "Each officer gets the tool permissions chosen when they're assigned.",
  ambassadors: "Represent the program; they have no tool permissions unless you grant some.",
  collegeAmbassadors: "Placed by the college's ambassador program to connect the club with the college. The club doesn't fill these seats itself.",
};

export default async function OrgChartToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, club, access } = await loadClubWorkspace(slug);
  const full = access.viaPlatform !== null || access.isAdvisor;
  const canEditSeats = access.capabilities.has("orgchart");
  const canAssignAny = access.assignableRoles.length > 0;

  const [data, people, requirements, setup] = await Promise.all([
    orgChartData(club.id),
    canAssignAny ? activeStudentMembers(club.id) : Promise.resolve([]),
    canAssignAny ? activeRequirements() : Promise.resolve([]),
    selectionSetup(club.id),
  ]);
  const holders = data.seats.flatMap((s) => s.holders);
  const training = club.status === "APPROVED" ? await trainingStatusFor(holders, club.approvedAt) : new Map<string, "pending" | "overdue">();

  const ctx: ToolContext = {
    slug: club.slug,
    clubId: club.id,
    clubName: club.name,
    capabilities: ALL_CAPABILITIES.map((k) => ({ key: k, label: CAPABILITIES[k].label, description: CAPABILITIES[k].description })),
    ambassadorSeats: club.type === "COLLEGE_AMBASSADORS",
  };
  const capLabel = (k: string) => (k in CAPABILITIES ? CAPABILITIES[k as keyof typeof CAPABILITIES].label : k);

  const presidents = data.seats.filter((s) => s.role === "PRESIDENT").flatMap((s) => s.holders);
  const actorIsPresident = presidents.some((h) => h.person.id === user.id);
  const canHandOff = access.assignableRoles.includes("PRESIDENT") && presidents.length > 0 && (actorIsPresident || full);
  const myLeaderRoles = holders.filter((h) => h.person.id === user.id).length + (access.isAdvisor ? 1 : 0);

  const toSeatInfo = (s: ChartSeat): SeatInfo => ({
    id: s.id,
    name: s.name,
    role: s.role,
    roleLabel: s.roleLabel,
    responsibilities: s.responsibilities,
    defaultPermissions: s.defaultPermissions,
    maxHolders: s.maxHolders,
    isCore: s.isCore,
    holders: s.holders.map((h) => ({ assignmentId: h.assignmentId, userId: h.person.id, name: h.person.name, role: h.role })),
  });

  const tiers = TIERS.map((t) => ({ ...t, seats: data.seats.filter((s) => t.roles.includes(s.role)) })).filter((t) => t.seats.length > 0);

  // The pipeline: seats the club fills itself get "Fill this seat" when they're open; selections already running are linked.
  const canElect = access.capabilities.has("elections") && club.status !== "RETIRED";
  // A regular club's leaders don't place ambassadors, but its President, VPs and advisors still manage the ones placed with it (lib/domain/roles).
  const managesPlaced = full || (!access.suspended && (access.role === "PRESIDENT" || access.role === "VP"));
  const canFill = (role: ClubRole) => canElect && access.assignableRoles.includes(role) && inClubPipeline(role, club.type);
  const fillSetup = { seats: setup.seats, defaults: setup.defaults, termLabel: setup.termLabel };
  const runningIds = [...setup.runningBySeat.values()];
  const running = new Map(
    (await db.election.findMany({ where: { id: { in: runningIds } }, select: { id: true, positionId: true, status: true, method: true, proposedCandidateId: true } })).map((e) => [e.positionId, e]),
  );
  const nextBySeat = new Map(setup.seats.map((s) => [s.id, s.nextInLine]));
  const pipelineRows: PipelineRow[] = data.seats
    .filter((s) => !s.virtual)
    .map((s) => {
      const r = running.get(s.id);
      return {
        id: s.id,
        name: s.name,
        role: s.role,
        sortOrder: setup.pipeline.seats.find((p) => p.id === s.id)?.sortOrder ?? 0,
        holders: s.holders.map((h) => h.person.name),
        nextInLine: nextBySeat.get(s.id) ?? [],
        running: r ? { id: r.id, status: r.status, method: r.method, proposedCandidateId: r.proposedCandidateId } : null,
      };
    });

  return (
    <div>
      <ToolHeader
        slug={club.slug}
        clubName={club.name}
        actions={
          canEditSeats && data.seats.length > 0 ? (
            <>
              <RestoreDefaultsButton slug={club.slug} clubId={club.id} />
              <AddSeatButton ctx={ctx} />
            </>
          ) : null
        }
      />

      <div className="space-y-6">
        <PolicyNotices placement="OFFICER_ROLES" title="Policies for officers and leaders" />

        {!canAssignAny && club.status !== "RETIRED" ? (
          <Callout tone="info" title="You can see the whole chart">
            Presidents, vice presidents, advisors and WSUSA administrators assign roles.{canEditSeats ? " You can edit seats and responsibilities." : ""}
          </Callout>
        ) : access.role === "VP" && !full ? (
          <Callout tone="info">As Vice President you can assign officers and ambassadors. Presidents and vice presidents are named by the President or the advisor.</Callout>
        ) : null}

        {data.seats.length === 0 ? (
          <EmptyState
            icon={<Network />}
            title="Set up your org chart"
            description={
              canEditSeats
                ? "Start with the standard Wildcat club structure — President, Vice President, Secretary, Treasurer and more — then rename or add seats to fit your club."
                : "This club doesn't have any seats yet. Ask your President or an officer with org chart access to set it up."
            }
            action={canEditSeats ? <StartDefaultsButton slug={club.slug} clubId={club.id} /> : null}
          />
        ) : null}

        {data.seats.length > 0 ? (
          <PipelineSection
            slug={club.slug}
            clubId={club.id}
            clubType={club.type}
            primary={club.successionMethod}
            rows={pipelineRows}
            fill={fillSetup}
            canFill={canFill}
            canManage={access.capabilities.has("elections")}
            footer={
              canHandOff ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <p className="min-w-0 flex-1 text-sm text-ink-2">
                    {actorIsPresident ? "Ready to pass the torch yourself?" : "Need to hand a President's seat straight to a successor?"} A hand-off moves the presidency in one step, so {club.name} is never without a President.
                  </p>
                  <HandOffDialog
                    ctx={ctx}
                    actorId={user.id}
                    presidents={presidents.map((h) => ({ assignmentId: h.assignmentId, userId: h.person.id, name: h.person.name, role: h.role }))}
                    people={people}
                  />
                </div>
              ) : null
            }
          />
        ) : null}

        {tiers.map((tier) => (
          <Section key={tier.key} title={tier.seats.length > 1 ? tier.plural : tier.label} description={TIER_HINT[tier.key === "ambassadors" && club.type !== "COLLEGE_AMBASSADORS" ? "collegeAmbassadors" : tier.key]}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {tier.seats.map((s, i) => {
                const info = toSeatInfo(s);
                const realSeats = tier.seats.filter((x) => !x.virtual);
                const ownSeat = inClubPipeline(s.role, club.type);
                const canAssignHere = !s.virtual && ownSeat && access.assignableRoles.includes(s.role);
                const fillHere = !s.virtual && s.holders.length === 0 && !running.has(s.id) && canFill(s.role);
                return (
                  <SeatCard
                    key={s.id}
                    name={s.name}
                    roleLabel={s.virtual ? `${s.roleLabel} · no seat` : s.roleLabel}
                    responsibilities={s.responsibilities}
                    maxHolders={s.maxHolders}
                    actions={canEditSeats && !s.virtual ? <SeatMenu ctx={ctx} seat={info} isFirst={realSeats[0]?.id === s.id} isLast={realSeats.at(-1)?.id === s.id} /> : null}
                    note={
                      s.virtual ? (
                        <p className="text-xs text-ink-3">These roles aren&apos;t linked to a seat on the chart. {canEditSeats ? "Restore defaults to add the missing seat." : ""}</p>
                      ) : !ownSeat ? (
                        <p className="text-xs text-ink-3">Filled by the college&apos;s ambassador program.</p>
                      ) : null
                    }
                    holders={s.holders.map((h) => {
                      const isSelf = h.person.id === user.id;
                      const custom = h.role === "OFFICER" || h.role === "AMBASSADOR";
                      const perms = custom ? (h.permissions.length ? h.permissions.map(capLabel).join(", ") : "No tool permissions") : null;
                      return {
                        assignmentId: h.assignmentId,
                        person: h.person,
                        internalTitle: h.internalTitle,
                        viaClub: h.viaClub,
                        training: training.get(h.assignmentId) ?? null,
                        meta: (
                          <>
                            {fmtMonthRange(h.startedAt, null).replace(/^since/, "Since")}
                            {perms ? <span className="block truncate" title={perms}>{perms}</span> : null}
                          </>
                        ),
                        actions: (
                          <HolderMenu
                            ctx={ctx}
                            seatName={s.virtual ? ROLE_LABEL[h.role] : s.name}
                            holder={{ assignmentId: h.assignmentId, name: h.person.name, permissions: h.permissions }}
                            canEditPermissions={custom && (access.assignableRoles.includes(h.role) || (h.role === "AMBASSADOR" && managesPlaced))}
                            canEnd={!isSelf && (full || access.assignableRoles.includes(h.role) || (h.role === "AMBASSADOR" && managesPlaced)) && club.status !== "RETIRED"}
                            isSelf={isSelf && club.status !== "RETIRED"}
                            mustHandOff={h.role === "PRESIDENT" && presidents.length <= 1 && !full}
                            selfLeavesWorkspace={!full && myLeaderRoles <= 1}
                          />
                        ),
                      };
                    })}
                    footer={
                      canAssignHere && club.status !== "RETIRED" ? (
                        <div className="grid gap-2">
                          {fillHere ? (
                            <CreateElectionDialog
                              slug={club.slug}
                              clubId={club.id}
                              seats={fillSetup.seats}
                              primary={club.successionMethod}
                              defaults={fillSetup.defaults}
                              termLabel={fillSetup.termLabel}
                              fixedSeatId={s.id}
                              triggerLabel="Fill this seat"
                              triggerSize="sm"
                              triggerClassName="w-full"
                            />
                          ) : null}
                          <AssignDialog ctx={ctx} seat={info} people={people} requirements={requirements.filter((r) => r.appliesTo.includes(s.role))} />
                        </div>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          </Section>
        ))}

        {/* A regular club's ambassador seat is filled by the college's program: ask it for one here, next to that seat. */}
        {club.type !== "COLLEGE_AMBASSADORS" && data.seats.length > 0 ? <RequestAmbassadorCard clubId={club.id} clubSlug={club.slug} /> : null}

        {data.archived.length > 0 ? (
          <details className="group rounded-[var(--radius-card)] border border-line bg-surface">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
              <Archive className="h-4 w-4" aria-hidden /> Archived seats ({data.archived.length})
            </summary>
            <ul className="divide-y divide-line border-t border-line">
              {data.archived.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-ink">{a.name}</span> <Badge>{ROLE_LABEL[a.role]}</Badge>
                    <span className="block text-xs text-ink-3">Archived {fmtLongDate(a.archivedAt)}</span>
                  </span>
                  <Link href={`/clubs/${club.slug}/history#seat-${a.id}`} className="text-sm text-brand-600 hover:underline">
                    History
                  </Link>
                  {canEditSeats ? <RestoreSeatButton slug={club.slug} seatId={a.id} name={a.name} /> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
