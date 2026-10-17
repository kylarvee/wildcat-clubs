import Link from "next/link";
import { Archive, ExternalLink, FileText, History, Network } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { loadVisibleClub } from "@/lib/clubs/context";
import { canViewFile } from "@/lib/domain/files";
import { roleHistoryData, type HistorySeat } from "@/lib/roles/queries";
import { fmtMonthRange, fmtTenure } from "@/lib/roles/history";
import { END_REASON_LABEL } from "@/lib/roles/labels";
import { fmtLongDate } from "@/lib/time";
import { RoleTimeline } from "@/components/roles/RoleTimeline";
import { RichContent } from "@/components/rich/RichContent";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Callout, Container, EmptyState, PageHeader, Stat } from "@/components/ui/layout";
import { ContributionDialog, RemoveContributionButton } from "./_components/ContributionDialog";

export const metadata = { title: "Role history" };

/**
 * Everyone who has held a seat in the club, when, why it ended, and what they
 * contributed — with gaps where a seat sat empty. Signed-in university
 * accounts only (profiles are private to the university). Alumni and retired
 * clubs keep all of it.
 */
export default async function RoleHistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await requireUser(`/clubs/${slug}/history`);
  const { club, access } = await loadVisibleClub(slug);
  const seats = await roleHistoryData(club.id);
  const canCurate = Boolean(access?.capabilities.has("orgchart"));
  const now = new Date();
  const clubEnd = club.retiredAt ?? now;

  // Only list files this viewer may open.
  const visibleFiles = new Set<string>();
  for (const s of seats) for (const t of s.terms) for (const c of t.contributions) for (const f of c.files) if (await canViewFile(viewer, f)) visibleFiles.add(f.id);

  const studentTerms = seats.filter((s) => s.role !== "ADVISOR").flatMap((s) => s.terms);
  const people = new Set(studentTerms.map((t) => t.person.id)).size;
  const openSeats = club.status === "RETIRED" ? 0 : seats.filter((s) => s.current && !s.key.startsWith("role:") && !s.terms.some((t) => !t.endedAt)).length;
  const firstStart = seats.flatMap((s) => s.terms).reduce<Date | null>((min, t) => (!min || t.startedAt < min ? t.startedAt : min), null);
  const withHistory = seats.filter((s) => s.terms.length > 0);

  return (
    <Container>
      <PageHeader
        breadcrumbs={[{ href: "/clubs", label: "Clubs" }, { href: `/clubs/${club.slug}`, label: club.name }, { label: "Role history" }]}
        title="Role history"
        description={`Everyone who has held a seat in ${club.name}, when they held it, and what they built. Amber marks stretches when a seat sat empty.`}
        actions={
          access?.isLeader ? (
            <ButtonLink href={`/clubs/${club.slug}/manage/org-chart`} variant="outline">
              <Network className="h-4 w-4" aria-hidden /> Org chart
            </ButtonLink>
          ) : null
        }
      />

      {club.status === "RETIRED" ? (
        <Callout tone="info" className="mb-6" title={`${club.name} retired${club.retiredAt ? ` on ${fmtLongDate(club.retiredAt)}` : ""}`}>
          Its leadership history is kept here for good, so future students can see who ran it and what they did.
        </Callout>
      ) : null}

      {withHistory.length === 0 ? (
        <EmptyState icon={<History />} title="No role history yet" description="Once someone takes a seat in the org chart, their time in the role is recorded here — permanently." />
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Student leaders" value={people} hint="Everyone who has held a seat" />
            <Stat label="Seats tracked" value={withHistory.length} />
            <Stat label="Open seats now" value={openSeats} hint={openSeats ? "Shown as vacant below" : "Every seat is filled"} />
            <Stat label="Leading since" value={firstStart ? fmtMonthRange(firstStart, firstStart) : "—"} />
          </div>

          <nav aria-label="Jump to a seat" className="flex flex-wrap gap-2">
            {withHistory.map((s) => (
              <a key={s.key} href={`#seat-${anchor(s)}`} className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink-2 hover:border-brand-200 hover:text-brand">
                {s.name}
              </a>
            ))}
          </nav>

          {seats.map((s) => (
            <SeatHistory key={s.key} seat={s} slug={club.slug} clubId={club.id} viewerId={viewer.id} viewerActive={viewer.status === "ACTIVE"} canCurate={canCurate} visibleFiles={visibleFiles} now={now} clubEnd={clubEnd} clubRetired={club.status === "RETIRED"} />
          ))}
        </div>
      )}
    </Container>
  );
}

function anchor(s: HistorySeat) {
  return s.key.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function SeatHistory({
  seat,
  slug,
  clubId,
  viewerId,
  viewerActive,
  canCurate,
  visibleFiles,
  now,
  clubEnd,
  clubRetired,
}: {
  seat: HistorySeat;
  slug: string;
  clubId: string;
  viewerId: string;
  viewerActive: boolean;
  canCurate: boolean;
  visibleFiles: Set<string>;
  now: Date;
  clubEnd: Date;
  clubRetired: boolean;
}) {
  const live = seat.terms.filter((t) => !t.endedAt);
  const vacantNow = seat.current && !clubRetired && live.length === 0;
  // Measure vacancies from when the seat opened, so an empty stretch before its first holder shows too.
  const firstStart = seat.terms[0]?.startedAt ?? null;
  const from = seat.openedAt && (!firstStart || seat.openedAt < firstStart) ? seat.openedAt : firstStart;
  const to = seat.archivedAt && seat.archivedAt < clubEnd ? seat.archivedAt : clubEnd;
  const open = !seat.archivedAt && !clubRetired;

  return (
    <section id={`seat-${anchor(seat)}`} aria-labelledby={`h-${anchor(seat)}`} className="scroll-mt-24">
      <Card>
        <header className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{seat.roleLabel}</p>
            <h2 id={`h-${anchor(seat)}`} className="text-lg font-semibold text-ink">
              {seat.name}
            </h2>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {seat.archivedAt ? (
              <Badge>
                <Archive className="h-3 w-3" aria-hidden /> Archived {fmtLongDate(seat.archivedAt)}
              </Badge>
            ) : null}
            {vacantNow ? <Badge tone="warning">Vacant now</Badge> : null}
            {live.length ? <Badge tone="success">{live.length > 1 ? `${live.length} current holders` : "Filled"}</Badge> : null}
          </div>
        </header>

        <div className="space-y-6 px-5 py-5">
          {from ? (
            <RoleTimeline
              seatName={seat.name}
              terms={seat.terms.map((t) => ({ id: t.assignmentId, name: t.person.name, color: t.person.avatarColor, start: t.startedAt, end: t.endedAt }))}
              from={from}
              to={to}
              now={now}
              open={open}
            />
          ) : (
            <p className="text-sm text-ink-3">No one has held this seat yet.</p>
          )}

          {seat.terms.length ? (
            <ol className="relative space-y-5 border-l border-line pl-5">
              {seat.terms.map((t) => {
                const isSelf = t.person.id === viewerId;
                // Mirrors roles.canCurateRole: alumni profiles are frozen, so only active holders curate their own.
                const curator = (isSelf && viewerActive) || canCurate;
                const current = !t.endedAt;
                return (
                  <li key={t.assignmentId} className="relative">
                    <span aria-hidden className="absolute -left-[1.6rem] top-3 h-2.5 w-2.5 rounded-full ring-4 ring-surface" style={{ backgroundColor: t.person.avatarColor }} />
                    <div className="flex flex-wrap items-start gap-3">
                      <Avatar name={t.person.name} src={t.person.avatarUrl} color={t.person.avatarColor} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/u/${t.person.handle}`} className="font-medium text-ink hover:underline">
                            {t.person.name}
                          </Link>
                          {t.person.alumni ? <Badge tone="info">Alumni</Badge> : null}
                          {current ? <Badge tone="success">Current</Badge> : null}
                        </div>
                        <p className="text-sm text-ink-2">
                          {fmtMonthRange(t.startedAt, t.endedAt).replace(/^since/, "Since")} · {fmtTenure(t.startedAt, t.endedAt, now)}
                        </p>
                        <p className="text-xs text-ink-3">
                          {[
                            t.endReason ? END_REASON_LABEL[t.endReason] : null,
                            t.viaClub ? `Placed by ${t.viaClub.name}` : t.assignedBy && t.assignedBy !== t.person.name ? `Named by ${t.assignedBy}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {curator && seat.role !== "ADVISOR" ? (
                        <ContributionDialog slug={slug} clubId={clubId} assignmentId={t.assignmentId} seatName={seat.name} holderName={t.person.name} isSelf={isSelf} />
                      ) : null}
                    </div>

                    {t.contributions.length ? (
                      <ul className="mt-3 grid gap-3 sm:grid-cols-2" aria-label={`${t.person.name}'s contributions`}>
                        {t.contributions.map((c) => {
                          const files = c.files.filter((f) => visibleFiles.has(f.id));
                          return (
                            <li key={c.id} className="rounded-xl border border-line bg-canvas p-3">
                              <div className="flex items-start gap-2">
                                <h3 className="min-w-0 flex-1 text-sm font-semibold text-ink">
                                  {c.url ? (
                                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-brand-600 hover:underline">
                                      {c.title} <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                      <span className="sr-only">(opens in a new tab)</span>
                                    </a>
                                  ) : (
                                    c.title
                                  )}
                                </h3>
                                {curator ? <RemoveContributionButton slug={slug} projectId={c.id} title={c.title} holderName={isSelf ? undefined : t.person.name} /> : null}
                              </div>
                              {c.descriptionHtml ? <RichContent html={c.descriptionHtml} className="mt-1 text-sm text-ink-2" /> : null}
                              {files.length ? (
                                <ul className="mt-2 space-y-1">
                                  {files.map((f) => (
                                    <li key={f.id}>
                                      <a href={`/api/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-sm text-brand-600 hover:underline">
                                        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                        <span className="truncate">{f.name}</span>
                                      </a>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
