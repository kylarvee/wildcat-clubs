import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, QrCode, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { fmtDate, fmtRange, fmtTime } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, Stat } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { loadAttendees, METHOD_LABEL } from "./attendees";

export const metadata: Metadata = { title: "Attendees" };

export default async function TrainingAttendeesPage({ params }: { params: Promise<{ occurrenceId: string }> }) {
  const { occurrenceId } = await params;
  const user = await requireUser(`/admin/trainings/occurrences/${occurrenceId}`);
  if (!can(user, "admin.trainings")) notFound();
  const data = await loadAttendees(occurrenceId);
  if (!data) notFound();
  const { occ, rolesByUser } = data;
  const leaders = occ.attendances.filter((a) => rolesByUser.has(a.userId)).length;
  const cancelled = occ.status === "CANCELLED" || occ.event.status === "CANCELLED";
  const open = !cancelled;

  return (
    <div className="space-y-6">
      <PageHeader
        title={occ.event.title}
        description={fmtRange(occ.startsAt, occ.endsAt, occ.event.allDay)}
        breadcrumbs={[{ href: "/admin/trainings", label: "Trainings & events" }, { href: `/admin/trainings/${occ.event.id}`, label: occ.event.title }, { label: fmtDate(occ.startsAt, "MMM d") }]}
        actions={
          <>
            {cancelled ? <Badge tone="danger">Cancelled</Badge> : null}
            {open ? (
              <ButtonLink href={`/checkin/live/${occ.id}`}>
                <QrCode className="h-4 w-4" /> Open check-in
              </ButtonLink>
            ) : null}
            {occ.attendances.length ? (
              <ButtonLink variant="outline" href={`/admin/trainings/occurrences/${occ.id}/attendees.csv`}>
                <Download className="h-4 w-4" /> Download CSV
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Stat label="Checked in" value={occ.attendances.length} />
        <Stat label="Student leaders" value={leaders} hint="Hold an officer role or higher" />
      </div>
      {occ.attendances.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No one has checked in yet"
          description={open ? "Open check-in to show the QR code. People can also be added by hand from the check-in screen." : "Nobody checked in to this meeting."}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Leadership roles</TH>
              <TH>How</TH>
              <TH>Checked in</TH>
            </tr>
          </THead>
          <TBody>
            {occ.attendances.map((a) => (
              <TR key={a.id}>
                <TD>
                  <div className="flex items-center gap-3">
                    <Avatar name={a.user.name} src={a.user.avatarUrl} color={a.user.avatarColor} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{a.user.name}</p>
                      <p className="truncate text-xs text-ink-3">{a.user.email}</p>
                    </div>
                  </div>
                </TD>
                <TD className="text-sm text-ink-2">{rolesByUser.get(a.userId)?.join(" · ") ?? <span className="text-ink-3">—</span>}</TD>
                <TD>
                  <Badge>{METHOD_LABEL[a.method]}</Badge>
                  {a.method === "MANUAL" && a.recordedBy ? <span className="block text-xs text-ink-3">by {a.recordedBy.name}</span> : null}
                </TD>
                <TD className="whitespace-nowrap text-sm">{fmtTime(a.checkedInAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
