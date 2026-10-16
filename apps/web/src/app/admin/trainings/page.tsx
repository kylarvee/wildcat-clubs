import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GraduationCap, QrCode, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { loadBuilderData } from "@/lib/events/queries";
import { KIND_LABEL, VISIBILITY_LABEL, locationText } from "@/lib/events/labels";
import { describeSchedule } from "@/lib/events/summary";
import { fmtDate, fmtTime } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState, PageHeader, Section } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/components/ui/cn";
import { EventsBuilder } from "@/components/events/EventsBuilder";

export const metadata: Metadata = { title: "Trainings & university events" };

type Occ = { id: string; startsAt: Date; endsAt: Date; status: "SCHEDULED" | "CANCELLED"; _count: { attendances: number } };

function OccurrenceRows({ rows, allDay, eventCancelled, now }: { rows: Occ[]; allDay: boolean; eventCancelled: boolean; now: Date }) {
  return (
    <>
      {rows.map((o) => {
        const cancelled = o.status === "CANCELLED" || eventCancelled;
        const held = o.endsAt < now;
        return (
          <TR key={o.id}>
            <TD className={cn("whitespace-nowrap", cancelled && "text-ink-3 line-through")}>
              {fmtDate(o.startsAt, "EEE, MMM d, yyyy")} · {allDay ? "All day" : fmtTime(o.startsAt)}
            </TD>
            <TD>{cancelled ? <Badge tone="danger">Cancelled</Badge> : held ? <Badge>Held</Badge> : <Badge tone="info">Upcoming</Badge>}</TD>
            <TD className="tabular-nums">{o._count.attendances}</TD>
            <TD>
              <div className="flex flex-wrap justify-end gap-2">
                {!cancelled ? (
                  <ButtonLink size="sm" variant={held ? "ghost" : "outline"} href={`/checkin/live/${o.id}`}>
                    <QrCode className="h-4 w-4" /> {held ? "Check-in" : "Open check-in"}
                  </ButtonLink>
                ) : null}
                <ButtonLink size="sm" variant="ghost" href={`/admin/trainings/occurrences/${o.id}`}>
                  <Users className="h-4 w-4" /> Attendees
                </ButtonLink>
              </div>
            </TD>
          </TR>
        );
      })}
    </>
  );
}

export default async function AdminTrainingsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser("/admin/trainings");
  if (!can(user, "admin.trainings")) notFound();
  const sp = await searchParams;
  const now = new Date();

  const [data, events] = await Promise.all([
    loadBuilderData(null),
    db.event.findMany({
      where: { clubId: null, status: { in: ["SCHEDULED", "CANCELLED"] } },
      orderBy: { startsAt: "desc" },
      include: {
        building: { select: { name: true } },
        requirements: { where: { active: true }, select: { id: true, name: true } },
        occurrences: { orderBy: { startsAt: "asc" }, select: { id: true, startsAt: true, endsAt: true, status: true, _count: { select: { attendances: true } } } },
      },
    }),
  ]);

  // Events with something coming up first, then the most recent history.
  const sorted = [...events].sort((a, b) => {
    const na = a.occurrences.find((o) => o.endsAt >= now)?.startsAt.getTime() ?? Infinity;
    const nb = b.occurrences.find((o) => o.endsAt >= now)?.startsAt.getTime() ?? Infinity;
    if (na !== nb) return na - nb;
    return (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0);
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Trainings & university events"
        description="Plan officer trainings and campus-wide events with the same Events Builder clubs use. Run check-in from any meeting and see who attended."
      />
      <Callout tone="brand" icon={<GraduationCap />} title="Making a training required for officers?">
        Create the training here, then attach it to roles under{" "}
        <Link href="/admin/requirements" className="font-medium underline">
          Admin → Officer requirements
        </Link>
        . Check-ins at the training count toward the requirement automatically.
      </Callout>

      <EventsBuilder
        mode="university"
        club={null}
        basePath="/admin/trainings"
        ideas={data.ideas}
        incoming={[]}
        outgoing={[]}
        buildings={data.buildings}
        terms={data.terms}
        googleLive={data.googleLive}
        initialDate={sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : undefined}
      />

      <Section title="University events" description="Every training and campus-wide event, with attendance for each meeting.">
        {sorted.length === 0 ? (
          <EmptyState icon={<GraduationCap />} title="No university events yet" description="Create an officer training or a campus-wide event to see it here with its check-ins." />
        ) : (
          <div className="space-y-4">
            {sorted.map((e) => {
              const upcoming = e.occurrences.filter((o) => o.endsAt >= now);
              const past = e.occurrences.filter((o) => o.endsAt < now).reverse();
              const total = e.occurrences.reduce((s, o) => s + o._count.attendances, 0);
              return (
                <Card key={e.id}>
                  <CardHeader
                    title={
                      <Link href={`/admin/trainings/${e.id}`} className={cn("hover:underline", e.status === "CANCELLED" && "line-through")}>
                        {e.title}
                      </Link>
                    }
                    description={
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={e.kind === "TRAINING" ? "brand" : "neutral"}>{KIND_LABEL[e.kind]}</Badge>
                        <Badge>{VISIBILITY_LABEL[e.visibility]}</Badge>
                        {e.status === "CANCELLED" ? <Badge tone="danger">Cancelled</Badge> : null}
                        {e.requirements.map((r) => (
                          <Badge key={r.id} tone="warning">
                            Required: {r.name}
                          </Badge>
                        ))}
                        {e.startsAt ? <span className="text-xs text-ink-3">{describeSchedule({ startsAt: e.startsAt, recurrence: e.recurrence, interval: e.recurrenceInterval, weekdays: e.recurrenceWeekdays, until: e.recurrenceUntil, count: e.recurrenceCount, allDay: e.allDay })}</span> : null}
                        <span className="text-xs text-ink-3">· {locationText(e)}</span>
                      </span>
                    }
                    action={
                      <div className="text-right">
                        <p className="text-lg font-semibold tabular-nums text-ink">{total}</p>
                        <p className="text-xs text-ink-3">check-ins</p>
                      </div>
                    }
                  />
                  <CardBody className="p-0">
                    {e.occurrences.length === 0 ? (
                      <p className="px-5 py-4 text-sm text-ink-3">No meetings scheduled.</p>
                    ) : (
                      <Table className="rounded-none border-0">
                        <THead>
                          <tr>
                            <TH>Meeting</TH>
                            <TH>Status</TH>
                            <TH>Attendees</TH>
                            <TH className="text-right">
                              <span className="sr-only">Actions</span>
                            </TH>
                          </tr>
                        </THead>
                        <TBody>
                          <OccurrenceRows rows={upcoming.slice(0, 5)} allDay={e.allDay} eventCancelled={e.status === "CANCELLED"} now={now} />
                          <OccurrenceRows rows={past.slice(0, upcoming.length ? 3 : 6)} allDay={e.allDay} eventCancelled={e.status === "CANCELLED"} now={now} />
                        </TBody>
                      </Table>
                    )}
                    {upcoming.length > 5 || past.length > (upcoming.length ? 3 : 6) ? (
                      <details className="border-t border-line">
                        <summary className="cursor-pointer px-5 py-2.5 text-sm font-medium text-brand-600 hover:underline">
                          Show all {e.occurrences.length} meetings
                        </summary>
                        <Table className="rounded-none border-0">
                          <TBody>
                            <OccurrenceRows rows={[...upcoming, ...past]} allDay={e.allDay} eventCancelled={e.status === "CANCELLED"} now={now} />
                          </TBody>
                        </Table>
                      </details>
                    ) : null}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
