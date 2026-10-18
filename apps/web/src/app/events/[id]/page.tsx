import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { CalendarClock, CalendarPlus, Download, FileText, Link2, MapPin, Pencil, QrCode, Repeat, Users, Video, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getClubAccess } from "@/lib/authz";
import { canManageEvent, canSeeEventCosts, canViewEvent, eventCostSummary } from "@/lib/domain/events";
import { canViewFile, fileUrl } from "@/lib/domain/files";
import { richToText } from "@/lib/rich/sanitize";
import { splitEventLinks, linkLabel } from "@/lib/events/links";
import { KIND_LABEL, locationText, roomLabel, VISIBILITY_LABEL } from "@/lib/events/labels";
import { describeRecurrence } from "@/lib/events/summary";
import { appUrl, campusMapQuery, googleCalendarTemplateUrl } from "@/lib/events/share";
import { codeClubsPhrase } from "@/lib/attendance/rules";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { fmtDate, fmtMoney, fmtRange, fmtTime } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ClubLogo } from "@/components/ui/avatar";
import { Callout, Container, PageHeader } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";
import { MapEmbed } from "@/components/embeds/MapEmbed";
import { RichContent } from "@/components/rich/RichContent";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ o?: string }> };

// Cached per request: generateMetadata and the page share one read.
const loadEvent = cache((id: string) =>
  db.event.findUnique({
    where: { id },
    include: {
      club: { select: { id: true, name: true, slug: true, logoColor: true, logoUrl: true, status: true } },
      building: { select: { name: true, code: true, lat: true, lng: true } },
      cohosts: { where: { status: "APPROVED" }, include: { club: { select: { id: true, name: true, slug: true, logoColor: true, logoUrl: true } } } },
      attachments: { include: { file: true } },
    },
  }),
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const event = await loadEvent(id);
  if (!event || !(await canViewEvent(await getCurrentUser(), event))) return { title: "Event" };
  return { title: event.title, description: richToText(splitEventLinks(event.descriptionHtml).body, 160) || `${event.club?.name ?? INSTITUTION.name} event` };
}

export default async function EventPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { o } = await searchParams;
  const event = await loadEvent(id);
  if (!event) notFound();
  const viewer = await getCurrentUser();
  if (!(await canViewEvent(viewer, event))) notFound();

  const now = new Date();
  // A date in another (campus) year shows it, so a 2024 meeting doesn't read as upcoming.
  const dayLabel = (d: Date) => fmtDate(d, fmtDate(d, "yyyy") === fmtDate(now, "yyyy") ? "EEE, MMM d" : "EEE, MMM d, yyyy");
  const [upcoming, pastCount, requested, manage, seeCosts, hostAccess] = await Promise.all([
    db.eventOccurrence.findMany({ where: { eventId: id, endsAt: { gte: now } }, orderBy: { startsAt: "asc" }, take: 12 }),
    db.eventOccurrence.count({ where: { eventId: id, endsAt: { lt: now } } }),
    o ? db.eventOccurrence.findFirst({ where: { id: o, eventId: id } }) : Promise.resolve(null),
    canManageEvent(viewer, event),
    canSeeEventCosts(viewer, event),
    event.clubId && viewer ? getClubAccess(viewer, event.clubId) : Promise.resolve(null),
  ]);
  const lastPast = upcoming.length === 0 ? await db.eventOccurrence.findFirst({ where: { eventId: id }, orderBy: { startsAt: "desc" } }) : null;
  const occ = requested ?? upcoming.find((x) => x.status === "SCHEDULED") ?? upcoming[0] ?? lastPast;
  const cost = seeCosts ? await eventCostSummary(id) : null;
  const canCheckIn = event.clubId ? Boolean(hostAccess?.capabilities.has("attendance")) : can(viewer, "admin.trainings");
  // Who may check in without the QR code (rules.decideMethod): the host's and co-hosts' members.
  const codeClubs = codeClubsPhrase(event.club?.name ?? null, event.cohosts.map((c) => c.club.name));
  const howToCheckIn =
    event.locationType === "VIRTUAL"
      ? codeClubs
        ? `While it's on, members of ${codeClubs} can check in with one tap on ${PLATFORM.name}. Guests scan the QR code the hosts share on screen.`
        : "Check in by scanning the QR code the hosts share on screen."
      : codeClubs
        ? `Check in at the event by scanning the QR code on the screen. Members of ${codeClubs} can also type the code shown there.`
        : "Check in at the event by scanning the QR code on the screen.";

  const files = [];
  for (const a of event.attachments) if (await canViewFile(viewer, a.file)) files.push(a.file);
  const hiddenFiles = event.attachments.length - files.length;
  const { body, links } = splitEventLinks(event.descriptionHtml);

  const hostName = event.club?.name ?? INSTITUTION.name;
  const manageHref = event.club ? `/clubs/${event.club.slug}/manage/events/${event.id}` : `/admin/trainings/${event.id}`;
  const occCancelled = occ ? occ.status === "CANCELLED" || event.status === "CANCELLED" : false;
  const where = locationText({ ...event, roomOverride: occ?.roomOverride });
  const mapQuery = event.locationType === "CAMPUS" && event.building ? campusMapQuery(event.building.name) : event.locationType === "ADDRESS" ? event.address : null;
  const schedule = event.startsAt && event.recurrence !== "NONE" ? describeRecurrence({ startsAt: event.startsAt, recurrence: event.recurrence, interval: event.recurrenceInterval, weekdays: event.recurrenceWeekdays, until: event.recurrenceUntil, count: event.recurrenceCount }) : null;
  const gcal = occ
    ? googleCalendarTemplateUrl({
        title: `${event.title} (${hostName})`,
        start: occ.startsAt,
        end: occ.endsAt,
        allDay: event.allDay,
        details: [richToText(body, 800), `Details: ${appUrl(`/events/${event.id}?o=${occ.id}`)}`].filter(Boolean).join("\n\n"),
        location: event.locationType === "CAMPUS" && event.building ? `${where}, ${INSTITUTION.mapsSuffix}` : event.locationType === "VIRTUAL" ? event.virtualUrl : event.address,
      })
    : null;

  return (
    <Container size="lg">
      <PageHeader
        breadcrumbs={[{ href: "/calendar", label: "Calendar" }, ...(event.club ? [{ href: `/clubs/${event.club.slug}`, label: event.club.name }] : []), { label: event.title }]}
        title={<span className={cn(event.status === "CANCELLED" && "line-through decoration-2")}>{event.title}</span>}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge>{KIND_LABEL[event.kind]}</Badge>
            {event.visibility !== "PUBLIC" ? <Badge tone="brand">{VISIBILITY_LABEL[event.visibility]}</Badge> : null}
            {event.status === "CANCELLED" ? <Badge tone="danger">Cancelled</Badge> : null}
            <span className="text-sm text-ink-3">
              Hosted by{" "}
              {event.club ? (
                <Link href={`/clubs/${event.club.slug}`} className="font-medium text-brand-600 hover:underline">
                  {event.club.name}
                </Link>
              ) : (
                <span className="font-medium text-ink-2">{INSTITUTION.name}</span>
              )}
              {event.cohosts.length ? ` with ${event.cohosts.map((c) => c.club.name).join(", ")}` : ""}
            </span>
          </span>
        }
        actions={
          <>
            {manage ? (
              <ButtonLink variant="outline" href={manageHref}>
                <Pencil className="h-4 w-4" /> Manage event
              </ButtonLink>
            ) : null}
            {canCheckIn && occ && !occCancelled ? (
              <ButtonLink variant="outline" href={`/checkin/live/${occ.id}`}>
                <QrCode className="h-4 w-4" /> Open check-in
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardBody className="space-y-4">
              {occ ? (
                <div className="flex flex-wrap items-start gap-4">
                  <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl text-white shadow-sm" style={{ backgroundColor: event.club?.logoColor ?? "#492365" }} aria-hidden>
                    <span className="text-xs font-semibold uppercase">{fmtDate(occ.startsAt, "MMM")}</span>
                    <span className="text-2xl font-bold leading-none">{fmtDate(occ.startsAt, "d")}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{occ.endsAt < now ? "Last meeting" : requested ? "This meeting" : "Next meeting"}</p>
                    <p className={cn("text-lg font-semibold text-ink", occCancelled && "line-through")}>{fmtRange(occ.startsAt, occ.endsAt, event.allDay)}</p>
                    {schedule ? (
                      <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-2">
                        <Repeat className="h-3.5 w-3.5" aria-hidden /> {schedule}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-ink-2">
                  <CalendarClock className="h-4 w-4" aria-hidden /> No time set yet.
                </p>
              )}
              {occCancelled ? (
                <Callout tone="danger" title={event.status === "CANCELLED" ? "This event is cancelled" : "This meeting is cancelled"}>
                  {occ?.note ?? "Check back for the next one."}
                </Callout>
              ) : null}
              {occ && !occCancelled ? (
                <div className="flex flex-wrap gap-2">
                  {gcal ? (
                    <a href={gcal} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-2 bg-surface px-3 text-sm font-medium text-ink hover:bg-muted">
                      <CalendarPlus className="h-4 w-4" /> Add to Google Calendar
                    </a>
                  ) : null}
                  <a href={`/api/ics/occurrence/${occ.id}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-2 bg-surface px-3 text-sm font-medium text-ink hover:bg-muted" download>
                    <Download className="h-4 w-4" /> Download .ics
                  </a>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="About this event" />
            <CardBody>{body.trim() ? <RichContent html={body} /> : <p className="text-sm text-ink-3">The hosts haven&apos;t added details yet.</p>}</CardBody>
          </Card>

          {files.length || links.length || hiddenFiles ? (
            <Card>
              <CardHeader title="Files & links" />
              <CardBody>
                <ul className="divide-y divide-line">
                  {files.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 py-2">
                      <FileText className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                      <a href={fileUrl(f.id)} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:underline">
                        {f.name}
                      </a>
                      <a href={fileUrl(f.id, true)} className="text-xs font-medium text-brand-600 hover:underline" aria-label={`Download ${f.name}`}>
                        Download
                      </a>
                    </li>
                  ))}
                  {links.map((l, i) => (
                    <li key={i} className="flex items-center gap-3 py-2">
                      <Link2 className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:underline">
                        {linkLabel(l)}
                      </a>
                    </li>
                  ))}
                </ul>
                {hiddenFiles ? (
                  <p className="mt-2 text-xs text-ink-3">
                    {hiddenFiles} more {hiddenFiles === 1 ? "file is" : "files are"} only for {viewer ? "club members" : "signed-in members"}.
                    {!viewer ? (
                      <>
                        {" "}
                        <Link href={`/login?next=${encodeURIComponent(`/events/${event.id}`)}`} className="font-medium text-brand-600 hover:underline">
                          Sign in
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {event.recurrence !== "NONE" && upcoming.length ? (
            <Card>
              <CardHeader title="Upcoming meetings" description={pastCount ? `${pastCount} earlier ${pastCount === 1 ? "meeting" : "meetings"} already happened.` : undefined} />
              <CardBody className="p-0">
                <ul className="divide-y divide-line">
                  {upcoming.map((x) => {
                    const cancelled = x.status === "CANCELLED" || event.status === "CANCELLED";
                    const current = occ?.id === x.id;
                    return (
                      <li key={x.id}>
                        <Link
                          href={`/events/${event.id}?o=${x.id}`}
                          aria-current={current ? "true" : undefined}
                          className={cn("flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/60", current && "bg-brand-50")}
                        >
                          <span className={cn("min-w-0 flex-1", cancelled && "text-ink-3 line-through")}>
                            {dayLabel(x.startsAt)} · {event.allDay ? "All day" : fmtTime(x.startsAt)}
                          </span>
                          {x.roomOverride && !cancelled ? <Badge tone="info">{roomLabel(x.roomOverride)}</Badge> : null}
                          {cancelled ? <Badge tone="danger">Cancelled</Badge> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Where" />
            <CardBody className="space-y-3">
              <p className="flex gap-2 text-sm text-ink">
                {event.locationType === "VIRTUAL" ? <Video className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden /> : <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />}
                <span>
                  {where}
                  {event.locationType === "CAMPUS" && event.building ? <span className="block text-xs text-ink-3">{event.building.code} · {INSTITUTION.city}</span> : null}
                </span>
              </p>
              {mapQuery ? (
                event.locationType === "ADDRESS" && event.lat != null && event.lng != null ? (
                  <MapEmbed query={mapQuery} lat={event.lat} lng={event.lng} height={200} />
                ) : (
                  <MapEmbed query={mapQuery} height={200} />
                )
              ) : null}
              {event.locationType === "VIRTUAL" ? (
                event.virtualUrl ? (
                  <ButtonLink href={event.virtualUrl} target="_blank" rel="noopener noreferrer" className="w-full">
                    <Video className="h-4 w-4" /> Join online
                  </ButtonLink>
                ) : (
                  <p className="text-sm text-ink-3">The join link will be posted here before the event.</p>
                )
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={event.cohosts.length ? "Hosts" : "Host"} />
            <CardBody>
              <ul className="space-y-3">
                <li className="flex items-center gap-3">
                  {event.club ? <ClubLogo name={event.club.name} src={event.club.logoUrl} color={event.club.logoColor} size="sm" /> : <ClubLogo name={INSTITUTION.abbreviation} color="#492365" size="sm" />}
                  {event.club ? (
                    <Link href={`/clubs/${event.club.slug}`} className="text-sm font-medium text-ink hover:underline">
                      {event.club.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-ink">{INSTITUTION.name}</span>
                  )}
                </li>
                {event.cohosts.map((c) => (
                  <li key={c.id} className="flex items-center gap-3">
                    <ClubLogo name={c.club.name} src={c.club.logoUrl} color={c.club.logoColor} size="sm" />
                    <Link href={`/clubs/${c.club.slug}`} className="text-sm font-medium text-ink hover:underline">
                      {c.club.name}
                    </Link>
                    <Badge className="ml-auto">Co-host</Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {cost && event.club ? (
            <Card>
              <CardHeader title="Expected cost" description="Only club leaders see this." />
              <CardBody className="space-y-3 text-sm">
                {cost.items === 0 ? (
                  <p className="text-ink-3">No costs added yet.{manage ? " Add them in the event's Costs section." : ""}</p>
                ) : (
                  <>
                    <dl className="space-y-1.5">
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-2">Per meeting</dt>
                        <dd className="font-medium tabular-nums">{fmtMoney(cost.perOccurrenceCents)}</dd>
                      </div>
                      {cost.oneTimeCents ? (
                        <div className="flex justify-between gap-3">
                          <dt className="text-ink-2">One-time</dt>
                          <dd className="font-medium tabular-nums">{fmtMoney(cost.oneTimeCents)}</dd>
                        </div>
                      ) : null}
                      {cost.occurrencesByTerm.map((t) => (
                        <div key={t.termId ?? "none"} className="flex justify-between gap-3 text-ink-3">
                          <dt>
                            {t.termName} · {t.occurrences} {t.occurrences === 1 ? "meeting" : "meetings"}
                          </dt>
                          <dd className="tabular-nums">{fmtMoney(t.totalCents)}</dd>
                        </div>
                      ))}
                      <div className="flex justify-between gap-3 border-t border-line pt-1.5">
                        <dt className="font-medium text-ink">Total</dt>
                        <dd className="font-semibold tabular-nums text-ink">{fmtMoney(cost.totalCents)}</dd>
                      </div>
                    </dl>
                    <ButtonLink variant="secondary" size="sm" className="w-full" href={`/clubs/${event.club.slug}/manage/budget?event=${event.id}`}>
                      <Wallet className="h-4 w-4" /> Request funding
                    </ButtonLink>
                  </>
                )}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardBody className="flex gap-2 text-sm text-ink-2">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              <p>
                {howToCheckIn}
                {!viewer ? " You'll be asked to sign in with your Weber State account." : ""}
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </Container>
  );
}
