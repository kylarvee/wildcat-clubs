import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck2, Compass, KeyRound, Star } from "lucide-react";
import type { CheckInMethod } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { getTerms } from "@/lib/terms";
import { fmtDate } from "@/lib/time";
import { INSTITUTION } from "@/lib/institution";
import { memberClubSummaries } from "@/lib/metrics";
import { liveOccurrencesForUser } from "@/lib/domain/attendance";
import { loadPersonAttendance, MY_HISTORY_LIMIT, type ClubRef, type MyAttendanceRow } from "@/lib/attendance/queries";
import { HistoryTable, type HistoryRow } from "./HistoryTable";
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

export const metadata: Metadata = { title: "My attendance" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const SHOW = 200;
const METHODS: CheckInMethod[] = CHECKIN_METHODS;

/**
 * Every event you've checked into across Weber State clubs: totals, a card
 * per club (rate, active status, review unlock), the full history, and the
 * other clubs you've visited. Only you see this page.
 */
export default async function MyAttendancePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser("/me/attendance");
  const sp = await searchParams;
  const str = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const now = new Date();
  const [{ rows, memberships, capped }, terms, live, summaries] = await Promise.all([
    loadPersonAttendance(user.id),
    getTerms(),
    liveOccurrencesForUser(user),
    memberClubSummaries(user.id),
  ]);

  // ── Totals ──
  const term = resolveRange({ range: "term" }, terms, now);
  const inTerm = rows.filter((r) => r.startsAt >= term.from && r.startsAt <= term.to).length;
  const crossClub = rows.filter((r) => r.otherClubs.length > 0);

  // ── Per-club cards (lib/metrics): clubs you belong to plus clubs you've been to. ──
  const cards = summaries;
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

  return (
    <Container>
      <PageHeader
        title="My attendance"
        description={`Every club event you've checked into at ${INSTITUTION.shortName}. Only you, your clubs' attendance leaders and advisors can see your attendance.`}
        actions={
          <ButtonLink href="/checkin" variant="outline">
            <KeyRound className="h-4 w-4" aria-hidden /> Check in with a code
          </ButtonLink>
        }
      />

      {/* Always mounted, so its "You're checked in!" card survives the refresh that empties `live`. */}
      <LiveCheckinPrompt occurrences={live} className="mb-8" />

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
        <div className="space-y-10">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Events attended" value={rows.length} hint={capped ? `showing your latest ${MY_HISTORY_LIMIT}` : "all time"} />
            <Stat label="This term" value={inTerm} hint={term.label} />
            <Stat label="Clubs" value={new Set(rows.flatMap((r) => r.clubs.map((c) => c.id))).size} hint="you've checked in with" />
            <Stat label="Cross-club events" value={crossClub.length} hint={visited.size ? `with ${visited.size} club${visited.size === 1 ? "" : "s"} you're not in` : "events with clubs you're not in"} />
          </div>

          <Section title="By club" description="Your rate counts events held since you joined. Reviews unlock after you've been to enough events.">
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map(({ club, membershipStatus: membership, summary }) => (
                <li key={club.id}>
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
                          {membership === "ACTIVE" ? summary.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Not active lately</Badge> : null}
                        </div>
                      </div>
                    </div>
                    <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-muted/60 px-2 py-2">
                        <dt className="text-[11px] uppercase tracking-wide text-ink-3">Attended</dt>
                        <dd className="text-lg font-semibold text-ink">{summary.attended}</dd>
                      </div>
                      <div className="rounded-lg bg-muted/60 px-2 py-2">
                        <dt className="text-[11px] uppercase tracking-wide text-ink-3">Rate</dt>
                        <dd className="text-lg font-semibold text-ink">{membership === "ACTIVE" ? pct(summary.rate) : "—"}</dd>
                      </div>
                      <div className="rounded-lg bg-muted/60 px-2 py-2">
                        <dt className="text-[11px] uppercase tracking-wide text-ink-3">Last</dt>
                        <dd className="text-lg font-semibold text-ink">{summary.lastAttendedAt ? fmtDate(summary.lastAttendedAt, "MMM d") : "—"}</dd>
                      </div>
                    </dl>
                    {/* Alumni and faculty/staff can't review, so they get no progress toward one. */}
                    {summary.canReview ? (
                      <div className="mt-auto pt-4">
                        {summary.reviewEligible ? (
                          <Link href={`/clubs/${club.slug}#reviews`} className="flex items-center gap-2 text-sm font-medium text-brand-600 hover:underline">
                            <Star className="h-4 w-4" aria-hidden /> You can review this club
                          </Link>
                        ) : (
                          <>
                            <p className="text-xs text-ink-3">
                              {summary.attended} of {summary.reviewThreshold} events toward leaving a review
                            </p>
                            <ProgressBar value={summary.attended} max={summary.reviewThreshold} className="mt-1.5" />
                          </>
                        )}
                      </div>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Cross-club activity" description="Events you went to that were hosted or co-hosted by clubs you're not in. This is what connects clubs on the network map.">
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
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-2 bg-surface px-4 py-4 text-sm text-ink-2">
                <Compass className="h-5 w-5 text-ink-3" aria-hidden />
                <span className="flex-1">You haven&apos;t been to an event with another club yet. Co-hosted events and open meetings are an easy way to meet more Wildcats.</span>
                <Link href="/calendar" className="font-medium text-brand-600 hover:underline">
                  See what&apos;s on
                </Link>
              </div>
            )}
          </Section>

          <Section title="History" description={`${filtered.length} check-in${filtered.length === 1 ? "" : "s"}${filtered.length !== rows.length ? ` of ${rows.length}` : ""}`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <RangeFilter basePath="/me/attendance" range={range} presets={[{ key: "all", label: "All time" }, ...RANGE_OPTIONS]} keep={keep} anchor="history" />
              <form method="get" action="/me/attendance#history" className="flex flex-wrap items-end gap-2">
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
                    <Link href="/me/attendance#history" className="text-sm font-medium text-brand-600 hover:underline">
                      Clear filters
                    </Link>
                  }
                />
              ) : (
                <HistoryTable rows={filtered.slice(0, SHOW).map(historyRow)} />
              )}
              {filtered.length > SHOW ? <p className="mt-2 text-xs text-ink-3">Showing the latest {SHOW}. Narrow the dates or pick a club to see older check-ins.</p> : null}
            </div>
          </Section>
        </div>
      )}
    </Container>
  );
}

/** The history table's row: plain data, rendered by the client component. */
function historyRow(r: MyAttendanceRow): HistoryRow {
  return { id: r.id, startsAt: r.startsAt, title: r.title, method: r.method, asGuest: r.asMember === false, club: r.club, cohosts: r.clubs.slice(1).map((c) => c.name) };
}
