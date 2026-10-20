import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Award, CalendarCheck2, Compass, Download, HandHeart, KeyRound, Star } from "lucide-react";
import type { CheckInMethod } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { getTerms } from "@/lib/terms";
import { fmtDate } from "@/lib/time";
import { INSTITUTION } from "@/lib/institution";
import { memberClubSummaries } from "@/lib/metrics";
import { fmtServiceHours, serviceEventsLabel, serviceHoursLabel } from "@/lib/metrics/service";
import { liveOccurrencesForUser } from "@/lib/domain/attendance";
import { MY_HISTORY_LIMIT, type ClubRef, type MyAttendanceRow } from "@/lib/attendance/queries";
import { loadInvolvementRecord, personAttendance } from "@/lib/documents/involvement";
import { seatDates } from "@/lib/documents/record";
import { HistoryTable, type HistoryRow } from "./HistoryTable";
import { ServiceTable } from "./ServiceTable";
import { pct } from "@/lib/attendance/matrix";
import { RANGE_OPTIONS, resolveRange } from "@/lib/attendance/ranges";
import { CHECKIN_METHODS, METHOD_LABEL } from "@/lib/attendance/rules";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container, EmptyState, PageHeader, ProgressBar, Section, Stat } from "@/components/ui/layout";
import { AutoSubmitSelect } from "@/components/attendance/AutoSubmitSelect";
import { LiveCheckinPrompt } from "@/components/attendance/LiveCheckinPrompt";
import { RangeFilter } from "@/components/attendance/RangeFilter";

export const metadata: Metadata = { title: "My involvement" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const SHOW = 200;
const METHODS: CheckInMethod[] = CHECKIN_METHODS;
const PATH = "/me/involvement";
const RECORD_PDF = "/me/involvement/record.pdf";

/**
 * MY INVOLVEMENT: one record of someone's club life at Weber State, the same
 * one their PDF prints (lib/documents/record): leadership roles from the role
 * history, service hours from lib/metrics, and the attendance history (a card
 * per club, cross-club visits, every check-in). Only they see this page.
 */
export default async function MyInvolvementPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser(PATH);
  const sp = await searchParams;
  const str = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const now = new Date();
  const [record, { rows, memberships, capped }, terms, live, summaries] = await Promise.all([
    loadInvolvementRecord(user.id),
    personAttendance(user.id),
    getTerms(),
    liveOccurrencesForUser(user),
    memberClubSummaries(user.id),
  ]);
  if (!record) notFound();
  const { summary, service, leadership } = record;
  const currentSeats = leadership.filter((s) => !s.endedAt).length;

  // ── Attendance totals ──
  const term = resolveRange({ range: "term" }, terms, now);
  const inTerm = rows.filter((r) => r.startsAt >= term.from && r.startsAt <= term.to).length;
  const crossClub = rows.filter((r) => r.otherClubs.length > 0);

  // ── Per-club cards (lib/metrics): clubs you belong to plus clubs you've been to. ──
  const clubInfo = new Map<string, ClubRef>();
  for (const s of summaries) clubInfo.set(s.club.id, s.club);
  for (const m of memberships) if (m.status === "ACTIVE" || m.status === "PENDING") clubInfo.set(m.clubId, m.club);
  for (const r of rows) for (const c of r.clubs) if (!clubInfo.has(c.id)) clubInfo.set(c.id, c);

  // ── Cross-club activity, grouped by the other club. ──
  const visited = new Map<string, { club: ClubRef; count: number; last: Date }>();
  for (const r of crossClub) {
    for (const club of r.otherClubs) {
      const v = visited.get(club.id);
      if (v) v.count++;
      else visited.set(club.id, { club, count: 1, last: r.startsAt });
    }
  }

  // ── History filters ──
  const rangeKey = str("range") ?? "all";
  const range = rangeKey === "all" ? null : resolveRange({ range: rangeKey, from: str("from"), to: str("to") }, terms, now);
  const clubFilter = str("club");
  const methodFilter = METHODS.find((m) => m === str("method"));
  const filtered = rows.filter(
    (r) =>
      (!range || (r.startsAt >= range.from && r.startsAt <= range.to)) &&
      (!clubFilter || (clubFilter === "university" ? r.club === null : r.clubs.some((c) => c.id === clubFilter))) &&
      (!methodFilter || r.method === methodFilter),
  );
  const keep = { club: clubFilter, method: methodFilter };
  const rangeKeep: Record<string, string | undefined> = range ? (range.key === "custom" ? { range: "custom", from: range.fromInput, to: range.toInput } : { range: range.key }) : { range: "all" };
  const hasUniversity = rows.some((r) => r.club === null);
  const byClubMinutes = service.byClub.reduce((n, c) => n + c.minutes, 0);

  return (
    <Container>
      <PageHeader
        title="My involvement"
        description={`Your leadership roles, service hours and attendance at ${INSTITUTION.shortName} clubs, in one record. Only you, your clubs' attendance leaders, advisors and WSUSA can see your attendance.`}
        actions={
          <>
            {/* A plain link: the PDF is generated by a route, not a page. */}
            <a href={RECORD_PDF} download className={buttonClasses("primary")}>
              <Download className="h-4 w-4" aria-hidden /> Download involvement record
            </a>
            <ButtonLink href="/checkin" variant="outline">
              <KeyRound className="h-4 w-4" aria-hidden /> Check in with a code
            </ButtonLink>
          </>
        }
      />

      {/* Always mounted, so its "You're checked in!" card survives the refresh that empties `live`. */}
      <LiveCheckinPrompt occurrences={live} className="mb-8" />

      <div className="space-y-10">
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="sr-only">
            Summary
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Service hours" value={fmtServiceHours(summary.serviceMinutes)} hint={summary.serviceEvents ? `from ${serviceEventsLabel(summary.serviceEvents)}` : "none yet"} />
            <Stat label="Service events" value={summary.serviceEvents} hint="dates you checked in to serve" />
            <Stat label="Clubs" value={summary.clubs} hint="you've joined, led or visited" />
            <Stat label="Leadership roles" value={summary.leadershipRoles} hint={currentSeats ? `${currentSeats} current` : "seats on club org charts"} />
          </div>
          <p className="mt-3 text-sm text-ink-3">
            Your involvement record is a PDF of this page, made fresh whenever you download it. Its QR code lets anyone check it against your live record.
          </p>
        </section>

        <div id="leadership" className="scroll-mt-24">
          <Section title="Leadership roles" description="Seats you've held on club org charts, from each club's role history.">
            {leadership.length ? (
              <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
                {leadership.map((seat) => (
                  <li key={seat.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                        {seat.title}
                        {!seat.endedAt ? <Badge tone="success">Current</Badge> : null}
                      </p>
                      <p className="text-sm text-ink-2">
                        <Link href={`/clubs/${seat.club.slug}`} className="hover:text-brand-600 hover:underline">
                          {seat.club.name}
                        </Link>
                        {seat.via ? <span className="text-ink-3"> · placed by {seat.via}</span> : null}
                      </p>
                    </div>
                    <p className="text-sm text-ink-3">
                      {seatDates(seat)}
                      {seat.endReason ? ` · ${seat.endReason}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <Note icon={<Award />}>No leadership roles yet. When a club leader adds you to their org chart, your seat shows up here and on your record.</Note>
            )}
          </Section>
        </div>

        <div id="service" className="scroll-mt-24">
          <Section
            title="Service hours"
            description="Events that count toward service hours add them every time you check in. They're counted from your check-ins, so they're always up to date."
            action={service.events ? <span className="hidden text-sm font-medium text-ink-2 sm:block">{serviceHoursLabel(service.minutes)}</span> : null}
          >
            {service.events ? (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Breakdown title="By term" rows={service.byTerm.map((t) => ({ key: t.term ?? "-", label: t.term ?? "Before the academic calendar", minutes: t.minutes, events: t.events }))} />
                  <Breakdown
                    title="By club"
                    rows={service.byClub.map((c) => ({ key: c.club?.id ?? "-", label: c.club ? <Link href={`/clubs/${c.club.slug}`} className="hover:text-brand-600 hover:underline">{c.club.name}</Link> : "University events", minutes: c.minutes, events: c.events }))}
                    note={byClubMinutes > service.minutes ? "Co-hosted events count for each club that put them on, so these add up to more than your total." : undefined}
                  />
                </div>
                <ServiceTable entries={service.entries} total={service} />
              </div>
            ) : (
              <Note icon={<HandHeart />}>
                No service hours yet. Events that count toward service hours say so on their page. Check in at one and its hours show up here.
              </Note>
            )}
          </Section>
        </div>

        <div id="attendance" className="scroll-mt-24">
          <Section title="Attendance" description={`Every club event you've checked into at ${INSTITUTION.shortName}.`}>
            {rows.length === 0 ? (
              <EmptyState
                icon={<CalendarCheck2 />}
                title="No check-ins yet"
                description="When you go to a club meeting, scan the QR code on the screen to check in. Your record builds up here — and after a few events you can review the club."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <ButtonLink href="/clubs">Browse clubs</ButtonLink>
                    <ButtonLink href="/checkin" variant="outline">
                      Type a code
                    </ButtonLink>
                  </div>
                }
              />
            ) : (
              <div className="space-y-8">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Events attended" value={rows.length} hint={capped ? `showing your latest ${MY_HISTORY_LIMIT}` : "all time"} />
                  <Stat label="This term" value={inTerm} hint={term.label} />
                  <Stat label="Cross-club events" value={crossClub.length} hint={visited.size ? `with ${visited.size} club${visited.size === 1 ? "" : "s"} you're not in` : "events with clubs you're not in"} className="col-span-2 sm:col-span-1" />
                </div>

                <SubSection title="By club" description="Your rate counts events held since you joined. Reviews unlock after you've been to enough events.">
                  <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {summaries.map(({ club, membershipStatus: membership, summary: s }) => (
                      // min-w-0: a long club name truncates instead of widening the column past a phone's screen.
                      <li key={club.id} className="min-w-0">
                        <Card className="flex h-full flex-col p-4">
                          <div className="flex items-start gap-3">
                            <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="sm" />
                            <div className="min-w-0 flex-1">
                              <Link href={`/clubs/${club.slug}`} className="block truncate font-semibold text-ink hover:text-brand-600 hover:underline">
                                {club.name}
                              </Link>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {membership === "ACTIVE" ? (
                                  <Badge tone="brand">Member</Badge>
                                ) : membership === "PENDING" ? (
                                  <Badge tone="warning">Request pending</Badge>
                                ) : membership === "LEFT" || membership === "ALUMNI" || membership === "REMOVED" ? (
                                  <Badge tone="neutral">Former member</Badge>
                                ) : (
                                  <Badge tone="neutral">Guest</Badge>
                                )}
                                {membership === "ACTIVE" ? s.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Not active lately</Badge> : null}
                              </div>
                            </div>
                          </div>
                          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-lg bg-muted/60 px-2 py-2">
                              <dt className="text-[11px] uppercase tracking-wide text-ink-3">Attended</dt>
                              <dd className="text-lg font-semibold text-ink">{s.attended}</dd>
                            </div>
                            <div className="rounded-lg bg-muted/60 px-2 py-2">
                              <dt className="text-[11px] uppercase tracking-wide text-ink-3">Rate</dt>
                              <dd className="text-lg font-semibold text-ink">{membership === "ACTIVE" ? pct(s.rate) : "—"}</dd>
                            </div>
                            <div className="rounded-lg bg-muted/60 px-2 py-2">
                              <dt className="text-[11px] uppercase tracking-wide text-ink-3">Last</dt>
                              <dd className="text-lg font-semibold text-ink">{s.lastAttendedAt ? fmtDate(s.lastAttendedAt, "MMM d") : "—"}</dd>
                            </div>
                          </dl>
                          {/* Alumni and faculty/staff can't review, so they get no progress toward one. */}
                          {s.canReview ? (
                            <div className="mt-auto pt-4">
                              {s.reviewEligible ? (
                                <Link href={`/clubs/${club.slug}#reviews`} className="flex items-center gap-2 text-sm font-medium text-brand-600 hover:underline">
                                  <Star className="h-4 w-4" aria-hidden /> You can review this club
                                </Link>
                              ) : (
                                <>
                                  <p className="text-xs text-ink-3">
                                    {s.attended} of {s.reviewThreshold} events toward leaving a review
                                  </p>
                                  <ProgressBar value={s.attended} max={s.reviewThreshold} className="mt-1.5" />
                                </>
                              )}
                            </div>
                          ) : null}
                        </Card>
                      </li>
                    ))}
                  </ul>
                </SubSection>

                <SubSection title="Cross-club activity" description="Events you went to that were hosted or co-hosted by clubs you're not in. This is what connects clubs on the network map.">
                  {visited.size ? (
                    <ul className="flex flex-wrap gap-2">
                      {[...visited.values()]
                        .sort((a, b) => b.count - a.count)
                        .map((v) => (
                          <li key={v.club.id}>
                            <Link href={`/clubs/${v.club.slug}`} className="flex items-center gap-2.5 rounded-xl border border-line bg-surface py-2 pl-2 pr-3 shadow-[var(--shadow-card)] hover:border-brand-200 focus-visible:outline-2 focus-visible:outline-brand">
                              <ClubLogo name={v.club.name} src={v.club.logoUrl} color={v.club.logoColor} size="sm" />
                              <span>
                                <span className="block text-sm font-medium text-ink">{v.club.name}</span>
                                <span className="block text-xs text-ink-3">
                                  {v.count} event{v.count === 1 ? "" : "s"} · last {fmtDate(v.last, "MMM d")}
                                </span>
                              </span>
                            </Link>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <Note icon={<Compass />}>
                      You haven&apos;t been to an event with another club yet. Co-hosted events and open meetings are an easy way to meet more Wildcats.{" "}
                      <Link href="/calendar" className="font-medium text-brand-600 hover:underline">
                        See what&apos;s on
                      </Link>
                    </Note>
                  )}
                </SubSection>

                <SubSection title="History" description={`${filtered.length} check-in${filtered.length === 1 ? "" : "s"}${filtered.length !== rows.length ? ` of ${rows.length}` : ""}`}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <RangeFilter basePath={PATH} range={range} presets={[{ key: "all", label: "All time" }, ...RANGE_OPTIONS]} keep={keep} anchor="history" />
                    <form method="get" action={`${PATH}#history`} className="flex flex-wrap items-end gap-2">
                      {Object.entries(rangeKeep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
                      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
                        Club
                        <AutoSubmitSelect name="club" defaultValue={clubFilter ?? ""} className="h-9 w-48">
                          <option value="">All clubs</option>
                          {[...clubInfo.values()]
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          {hasUniversity ? <option value="university">University events</option> : null}
                        </AutoSubmitSelect>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
                        How
                        <AutoSubmitSelect name="method" defaultValue={methodFilter ?? ""} className="h-9 w-40">
                          <option value="">Any way</option>
                          {METHODS.map((m) => (
                            <option key={m} value={m}>
                              {METHOD_LABEL[m]}
                            </option>
                          ))}
                        </AutoSubmitSelect>
                      </label>
                      <noscript>
                        <button type="submit" className={buttonClasses("outline", "sm", "h-9")}>
                          Apply
                        </button>
                      </noscript>
                    </form>
                  </div>
                  <div id="history" className="scroll-mt-24">
                    {filtered.length === 0 ? (
                      <EmptyState
                        icon={<CalendarCheck2 />}
                        title="Nothing matches these filters"
                        action={
                          <Link href={`${PATH}#history`} className="text-sm font-medium text-brand-600 hover:underline">
                            Clear filters
                          </Link>
                        }
                      />
                    ) : (
                      <HistoryTable rows={filtered.slice(0, SHOW).map(historyRow)} />
                    )}
                    {filtered.length > SHOW ? <p className="mt-2 text-xs text-ink-3">Showing the latest {SHOW}. Narrow the dates or pick a club to see older check-ins.</p> : null}
                  </div>
                </SubSection>
              </div>
            )}
          </Section>
        </div>
      </div>
    </Container>
  );
}

/** A heading inside a page section (h3, under the section's h2). */
function SubSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold text-ink">{title}</h3>
        {description ? <p className="text-sm text-ink-3">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A dashed note for an empty section, with an icon. */
function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed border-line-2 bg-surface px-4 py-4 text-sm text-ink-2">
      <span className="mt-0.5 shrink-0 text-ink-3 [&>svg]:h-5 [&>svg]:w-5" aria-hidden>
        {icon}
      </span>
      <p className="flex-1">{children}</p>
    </div>
  );
}

/** Service hours by term or by club: a short list, hours on the right. */
function Breakdown({ title, rows, note }: { title: string; rows: { key: string; label: ReactNode; minutes: number; events: number }[]; note?: string }) {
  return (
    <Card className="p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      <dl className="mt-2 divide-y divide-line">
        {rows.map((r) => (
          <div key={r.key} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
            <dt className="min-w-0 text-ink-2">{r.label}</dt>
            <dd className="shrink-0 text-right">
              <span className="font-semibold tabular-nums text-ink">{fmtServiceHours(r.minutes)}</span>
              <span className="text-ink-3"> {r.minutes === 60 ? "hour" : "hours"}</span>
              <span className="sr-only">, {serviceEventsLabel(r.events)}</span>
            </dd>
          </div>
        ))}
      </dl>
      {note ? <p className="mt-2 text-xs text-ink-3">{note}</p> : null}
    </Card>
  );
}

/** The history table's row: plain data, rendered by the client component. */
function historyRow(r: MyAttendanceRow): HistoryRow {
  return { id: r.id, startsAt: r.startsAt, title: r.title, method: r.method, asGuest: r.asMember === false, club: r.club, cohosts: r.clubs.slice(1).map((c) => c.name) };
}
