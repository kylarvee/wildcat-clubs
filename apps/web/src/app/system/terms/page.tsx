import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarRange, TriangleAlert } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { campusDate, DAY_MS, fmtDate, fmtLongDate } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState, PageHeader } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DeleteTermButton, EditTermButton, TERM_KIND_LABEL, TermDialog, type TermRow } from "@/components/system/TermDialog";
import { TermTimeline, type TimelineTick, type TimelineYear } from "@/components/system/TermTimeline";

export const metadata: Metadata = { title: "Academic calendar" };

/** Warn when the calendar runs out this soon: pilot periods and semester rules need the next terms. */
const RUNWAY_DAYS = 240;

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** July 1 (campus time) of an academic year's first calendar year — the anchor every row is measured from. */
const anchorOf = (label: string) => campusDate(Number(label.slice(0, 4)), 7, 1);

/**
 * Academic calendar (system.config). Activity, pilot periods, retention,
 * budgets and semester-long recurring events are all measured against these
 * terms, so they're managed by sysadmins only.
 */
export default async function TermsPage() {
  const user = await requireUser("/system/terms");
  if (!can(user, "system.config")) notFound();

  const rows = await db.term.findMany({ orderBy: { startsOn: "asc" }, include: { _count: { select: { budgetItems: true, fundingRequests: true } } } });
  const now = new Date();
  const terms: TermRow[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    academicYear: t.academicYear,
    startsOn: fmtDate(t.startsOn, "yyyy-MM-dd"),
    endsOn: fmtDate(t.endsOn, "yyyy-MM-dd"),
    countsForActivity: t.countsForActivity,
  }));
  const current = rows.find((t) => t.startsOn <= now && now <= t.endsOn) ?? null;
  const next = rows.find((t) => t.startsOn > now) ?? null;
  const last = rows.at(-1) ?? null;
  const runwayDays = last ? Math.floor((last.endsOn.getTime() - now.getTime()) / DAY_MS) : null;

  // Timeline rows, oldest first, one per academic year. Every row shares one axis, measured from
  // its July 1: it starts by Aug 1 (or earlier if a term does) and ends with the latest term
  // end, because Weber's summer belongs to the year it follows but runs into August.
  const yearLabels = [...new Set(rows.map((t) => t.academicYear))].sort();
  const offsets = rows.map((t) => {
    const a = anchorOf(t.academicYear).getTime();
    return { start: t.startsOn.getTime() - a, end: t.endsOn.getTime() - a };
  });
  const ref = anchorOf(yearLabels.at(-1) ?? `${now.getFullYear()}-${now.getFullYear() + 1}`);
  const refYear = Number(fmtDate(ref, "yyyy"));
  const firstStart = Math.min(campusDate(refYear, 8, 1).getTime() - ref.getTime(), ...offsets.map((o) => o.start));
  // Round the axis start down to the first of its month so month lines sit on real boundaries.
  const firstDay = new Date(ref.getTime() + firstStart);
  const axisStart = campusDate(Number(fmtDate(firstDay, "yyyy")), Number(fmtDate(firstDay, "M")), 1).getTime() - ref.getTime();
  const axisEnd = Math.max(campusDate(refYear + 1, 7, 1).getTime() - ref.getTime(), ...offsets.map((o) => o.end));
  const axisSpan = axisEnd - axisStart;

  const years: TimelineYear[] = yearLabels.map((label) => {
    const rowStart = anchorOf(label).getTime() + axisStart;
    const pct = (d: Date) => ((d.getTime() - rowStart) / axisSpan) * 100;
    return {
      label: `${label.slice(0, 4)}–${label.slice(7)}`,
      todayPct: now.getTime() >= rowStart && now.getTime() < rowStart + axisSpan ? clamp(pct(now)) : null,
      terms: rows
        .filter((t) => t.academicYear === label)
        .map((t) => {
          const left = clamp(pct(t.startsOn));
          return {
            id: t.id,
            left,
            width: Math.max(0.5, clamp(pct(t.endsOn)) - left),
            range: `${fmtDate(t.startsOn, "MMM d")} – ${fmtLongDate(t.endsOn)}`,
            weeks: Math.round((t.endsOn.getTime() - t.startsOn.getTime()) / (7 * DAY_MS)),
            current: t.id === current?.id,
          };
        }),
    };
  });
  // Month boundaries along the shared axis, measured on the latest year's row.
  const ticks: TimelineTick[] = [];
  const refRowStart = ref.getTime() + axisStart;
  for (let d = new Date(refRowStart); d.getTime() < refRowStart + axisSpan; ) {
    const y = Number(fmtDate(d, "yyyy"));
    const m = Number(fmtDate(d, "M"));
    const next = campusDate(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1);
    const pct = ((d.getTime() - refRowStart) / axisSpan) * 100;
    const nextPct = Math.min(100, ((next.getTime() - refRowStart) / axisSpan) * 100);
    // A sliver of a month at the end gets a line but no label.
    ticks.push({ label: fmtDate(d, "MMM"), pct, mid: (pct + nextPct) / 2, labelled: nextPct - pct > 5 });
    d = next;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic calendar"
        description="Weber State's terms. Club activity, pilot periods, retention, budgets and semester-long recurring events are all measured against them. Terms can't overlap."
        actions={<TermDialog term={null} others={terms} />}
      />

      {runwayDays !== null && runwayDays < RUNWAY_DAYS ? (
        <Callout tone="warning" icon={<TriangleAlert />} title={runwayDays < 0 ? "The calendar has run out" : `The calendar ends ${fmtLongDate(last!.endsOn)}`}>
          Add the next academic year&rsquo;s terms so new clubs&rsquo; pilot periods, activity checks and recurring events keep working.
        </Callout>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<CalendarRange />}
          title="No terms yet"
          description="Add Fall, Spring and Summer terms with the button above. Until there are terms, clubs stay in their pilot period and semester-long events can't repeat."
        />
      ) : (
        <>
          <Card>
            <CardHeader
              title="Timeline"
              description={
                current
                  ? `${current.name} is in session (week ${Math.min(Math.floor((now.getTime() - current.startsOn.getTime()) / (7 * DAY_MS)) + 1, Math.round((current.endsOn.getTime() - current.startsOn.getTime()) / (7 * DAY_MS)))}).${next ? ` Next up: ${next.name}, starting ${fmtLongDate(next.startsOn)}.` : ""}`
                  : next
                    ? `Between terms. ${next.name} starts ${fmtLongDate(next.startsOn)}.`
                    : "No term is in session and none is scheduled."
              }
            />
            <CardBody>
              <TermTimeline years={years} ticks={ticks} terms={terms} />
            </CardBody>
          </Card>

          <Table>
            <caption className="sr-only">Every term, newest first</caption>
            <THead>
              <tr>
                <TH>Term</TH>
                <TH>Dates</TH>
                <TH className="hidden md:table-cell">Length</TH>
                <TH className="hidden sm:table-cell">Activity</TH>
                <TH className="hidden lg:table-cell">Used by</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {[...rows].reverse().map((t) => {
                const row = terms.find((x) => x.id === t.id)!;
                const used = [t._count.budgetItems ? plural(t._count.budgetItems, "budget item") : null, t._count.fundingRequests ? plural(t._count.fundingRequests, "funding request") : null].filter(Boolean).join(" and ");
                return (
                  <TR key={t.id} className={t.id === current?.id ? "bg-brand-50/50" : undefined}>
                    <TD>
                      <p className="flex flex-wrap items-center gap-1.5 font-medium">
                        {t.name}
                        {t.id === current?.id ? <Badge tone="brand">Now</Badge> : t.id === next?.id ? <Badge tone="info">Next</Badge> : null}
                      </p>
                      <p className="text-xs text-ink-3">
                        {TERM_KIND_LABEL[t.kind]} · {t.academicYear}
                      </p>
                    </TD>
                    <TD className="text-ink-2">
                      <span className="whitespace-nowrap">{fmtDate(t.startsOn, "MMM d, yyyy")}</span> – <span className="whitespace-nowrap">{fmtDate(t.endsOn, "MMM d, yyyy")}</span>
                      <p className="text-xs text-ink-3 sm:hidden">{t.countsForActivity ? "Counts for activity" : "Doesn't count for activity"}</p>
                    </TD>
                    <TD className="hidden tabular-nums text-ink-2 md:table-cell">{plural(Math.round((t.endsOn.getTime() - t.startsOn.getTime()) / (7 * DAY_MS)), "week")}</TD>
                    <TD className="hidden sm:table-cell">{t.countsForActivity ? <Badge tone="success">Counts</Badge> : <Badge>Doesn&rsquo;t count</Badge>}</TD>
                    <TD className="hidden text-sm text-ink-2 lg:table-cell">{used || <span className="text-ink-3">Nothing yet</span>}</TD>
                    <TD className="whitespace-nowrap text-right">
                      <EditTermButton term={row} others={terms.filter((x) => x.id !== t.id)} />
                      <DeleteTermButton id={t.id} name={t.name} inUse={used || null} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </>
      )}
    </div>
  );
}
