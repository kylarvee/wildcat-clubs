import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Ban, CalendarClock, Clock, Handshake, MapPin, QrCode } from "lucide-react";
import { getConfig } from "@/lib/config";
import { fmtRange } from "@/lib/time";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { canManageOccurrence } from "@/lib/domain/attendance";
import { occurrenceById, participatingClubIds, toOccurrenceSummary } from "@/lib/attendance/queries";
import { whenLabel } from "@/lib/attendance/rules";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Callout, PageHeader } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { OccurrenceAttendance } from "@/components/attendance/OccurrenceAttendance";

export const metadata: Metadata = { title: "Event attendance" };

/** One meeting's attendance: who came and how, manual add, remove. */
export default async function OccurrenceAttendancePage({ params }: { params: Promise<{ slug: string; occurrenceId: string }> }) {
  const { slug, occurrenceId } = await params;
  const { user, club, access, allowed } = await loadClubWorkspace(slug, "attendance");
  if (!allowed) return <NoPermission what="attendance" suspended={access.suspended} />;

  const occ = await occurrenceById(occurrenceId);
  // Only this club's events (hosted or co-hosted) appear in its workspace.
  if (!occ || !participatingClubIds(occ).includes(club.id)) notFound();

  const cfg = await getConfig();
  const now = new Date();
  const occurrence = toOccurrenceSummary(occ, cfg, now);
  const hosted = occ.event.clubId === club.id;
  const canManage = hosted && (await canManageOccurrence(user, occ));
  const base = `/clubs/${club.slug}/manage/attendance`;
  const state = occurrence.windowState;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ href: base, label: "Attendance" }, { label: occurrence.title }]}
        title={occurrence.title}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              {fmtRange(occurrence.startsAt, occurrence.endsAt, occurrence.allDay)}
            </span>
            {occurrence.place ? (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                {occurrence.place}
              </span>
            ) : null}
            {occurrence.cancelled ? (
              <Badge tone="danger">Cancelled</Badge>
            ) : state === "OPEN" ? (
              <Badge tone="success">Check-in open</Badge>
            ) : state === "NOT_OPEN" ? (
              <Badge tone="neutral">Check-in opens {whenLabel(occurrence.opensAt, now)}</Badge>
            ) : (
              <Badge tone="neutral">Check-in closed</Badge>
            )}
          </span>
        }
        actions={
          canManage && !occurrence.cancelled && state !== "CLOSED" ? (
            <ButtonLink href={`/checkin/live/${occurrence.id}`} variant={state === "OPEN" ? "primary" : "outline"}>
              <QrCode className="h-4 w-4" aria-hidden /> Open check-in screen
            </ButtonLink>
          ) : null
        }
      />

      {!hosted ? (
        <Callout tone="info" icon={<Handshake />} title={`Co-hosted with ${occurrence.club?.name ?? "another club"}`}>
          {occurrence.club?.name ?? "The host club"} runs check-in for this event, so only their leaders can change this list. Members and guests below are counted for {club.name}.
        </Callout>
      ) : null}
      {occurrence.cancelled ? (
        <Callout tone="warning" icon={<Ban />} title="This event was cancelled">
          Nobody can check in. Anyone already on the list stays on it until you remove them.
        </Callout>
      ) : state === "NOT_OPEN" && canManage ? (
        <Callout tone="info" icon={<Clock />}>
          Check-in opens {whenLabel(occurrence.opensAt, now)} and closes {whenLabel(occurrence.closesAt, now)}. You can open the QR screen early to set up, and add people by hand once it opens.
        </Callout>
      ) : null}

      <OccurrenceAttendance occurrence={occurrence} memberClubId={club.id} canManage={canManage} personHref={`${base}/members`} />
    </div>
  );
}
