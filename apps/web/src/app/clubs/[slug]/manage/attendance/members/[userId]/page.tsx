import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarCheck2 } from "lucide-react";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/authz";
import { campusDate, fmtDate, fmtLongDate, fmtTime } from "@/lib/time";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { memberClubSummary, memberRetention } from "@/lib/metrics";
import { loadMemberHistory, type MemberHistoryItem } from "@/lib/attendance/queries";
import { memberAt, pct } from "@/lib/attendance/matrix";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/components/ui/cn";
import { NoPermission } from "@/components/workspace/NoPermission";
import { MethodBadge } from "@/components/attendance/MethodMark";

export const metadata: Metadata = { title: "Member attendance" };

const SHOW = 100;

type MonthCell = { key: string; label: string; attended: boolean; member: boolean };

/** Last 12 campus months: did they come, and were they a member then? */
function monthStrip(items: MemberHistoryItem[], membership: { joinedAt: Date | null; endedAt: Date | null } | null, now: Date): MonthCell[] {
  const attendedMonths = new Set(items.filter((i) => i.attendance).map((i) => fmtDate(i.startsAt, "yyyy-MM")));
  const y = Number(fmtDate(now, "yyyy"));
  const m = Number(fmtDate(now, "M"));
  const cells: MonthCell[] = [];
  for (let i = 11; i >= 0; i--) {
    // campusDate rolls negative months back into earlier years.
    const mid = campusDate(y, m - i, 15, 12);
    const end = new Date(Math.min(campusDate(y, m - i + 1, 1).getTime() - 1, now.getTime()));
    const key = fmtDate(mid, "yyyy-MM");
    cells.push({ key, label: fmtDate(mid, "MMM"), attended: attendedMonths.has(key), member: memberAt(membership, end) });
  }
  return cells;
}

/** One person's attendance in this club — for leaders with the Attendance permission. */
export default async function MemberAttendancePage({ params }: { params: Promise<{ slug: string; userId: string }> }) {
  const { slug, userId } = await params;
  const { club, access, allowed } = await loadClubWorkspace(slug, "attendance");
  if (!allowed) return <NoPermission what="attendance" suspended={access.suspended} />;

  const person = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true, status: true } });
  if (!person) notFound();
  const now = new Date();
  const { membership, items } = await loadMemberHistory(person.id, club.id, now);
  // Only people connected to this club (members, past members, or guests who came).
  if (!membership && items.length === 0) notFound();

  const [summary, monthly, quarterly, roles] = await Promise.all([
    memberClubSummary(person.id, club.id),
    memberRetention(person.id, club.id, "month"),
    memberRetention(person.id, club.id, "quarter"),
    db.roleAssignment.findMany({ where: { clubId: club.id, userId: person.id, endedAt: null }, select: { role: true, position: { select: { name: true } } } }),
  ]);

  const lastAttended = summary.lastAttendedAt;
  const isMember = membership?.status === "ACTIVE";
  const strip = monthStrip(items, membership, now);
  const base = `/clubs/${club.slug}/manage/attendance`;

  const statusBadge = isMember ? (
    <Badge tone="brand">Member{membership?.joinedAt ? ` since ${fmtDate(membership.joinedAt, "MMM yyyy")}` : ""}</Badge>
  ) : membership?.status === "PENDING" ? (
    <Badge tone="warning">Join request pending</Badge>
  ) : membership?.joinedAt ? (
    <Badge tone="neutral">Former member</Badge>
  ) : (
    <Badge tone="neutral">Guest</Badge>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ href: base, label: "Attendance" }, { label: person.name }]}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={person.name} src={person.avatarUrl} color={person.avatarColor} size="lg" />
            <span className="min-w-0">
              <span className="block truncate">{person.name}</span>
              <span className="block truncate text-sm font-normal text-ink-3">{person.email}</span>
            </span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2 pt-1">
            {statusBadge}
            {isMember ? summary.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Not active lately</Badge> : null}
            {roles.map((r, i) => (
              <Badge key={i} tone="info">
                {r.position?.name ?? ROLE_LABEL[r.role]}
              </Badge>
            ))}
            {membership?.internalTitle ? <Badge tone="neutral">{membership.internalTitle}</Badge> : null}
            {person.status === "ALUMNI" ? <Badge tone="neutral">Alumni</Badge> : null}
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Events attended" value={summary.attended} hint={lastAttended ? `last on ${fmtDate(lastAttended, "MMM d")}` : "Hasn't checked in yet"} />
        <Stat label="Attendance rate" value={pct(summary.rate)} hint={summary.heldSinceJoined ? `${summary.attended} of ${summary.heldSinceJoined} since getting involved` : "Counts events since they joined or first came"} />
        <Stat label="Monthly retention" value={pct(monthly.rate)} hint={monthly.periods ? `came in ${monthly.attendedPeriods} of ${monthly.periods} months` : "Since joining"} />
        <Stat label="Quarterly retention" value={pct(quarterly.rate)} hint={quarterly.periods ? `came in ${quarterly.attendedPeriods} of ${quarterly.periods} quarters` : "Since joining"} />
        <Stat label="Last attended" value={lastAttended ? fmtDate(lastAttended, "MMM d") : "—"} hint={lastAttended ? fmtLongDate(lastAttended) : "No check-ins"} className="col-span-2 lg:col-span-1" />
      </div>

      <Card>
        <CardHeader title="Month by month" description="The last 12 months. A filled square is a month they checked in at least once." />
        <CardBody>
          <ol className="grid grid-cols-6 gap-2 sm:grid-cols-12" aria-label="Check-ins by month">
            {strip.map((m) => (
              <li key={m.key} className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    "h-8 w-full max-w-10 rounded-md ring-1 ring-inset",
                    m.attended ? "bg-[#6b3fa0] ring-[#6b3fa0]" : m.member ? "bg-brand-50 ring-brand-100" : "bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_3px,transparent_3px_6px)] ring-line",
                  )}
                  aria-hidden
                />
                <span className="text-[11px] text-ink-3" aria-hidden>
                  {m.label}
                </span>
                <span className="sr-only">
                  {m.label} {m.key.slice(0, 4)}: {m.attended ? "checked in" : m.member ? "no check-ins" : "not a member"}
                </span>
              </li>
            ))}
          </ol>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3" aria-hidden>
            <li className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-[#6b3fa0]" /> Checked in
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-brand-50 ring-1 ring-inset ring-brand-100" /> Member, didn&apos;t come
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_2px,transparent_2px_4px)] ring-1 ring-inset ring-line" /> Not a member
            </li>
          </ul>
        </CardBody>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">History</h2>
        {items.length === 0 ? (
          <EmptyState icon={<CalendarCheck2 />} title="No events yet" description={`Once ${club.name} holds events after ${person.name.split(" ")[0]} joined, they'll be listed here — attended or missed.`} />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH scope="col">Date</TH>
                  <TH scope="col">Event</TH>
                  <TH scope="col">Attendance</TH>
                </tr>
              </THead>
              <TBody>
                {items.slice(0, SHOW).map((i) => (
                  <TR key={i.occurrenceId}>
                    <TD className="whitespace-nowrap text-ink-2">{fmtDate(i.startsAt, "EEE, MMM d, yyyy")}</TD>
                    <TD>
                      <Link href={`${base}/${i.occurrenceId}`} className="font-medium text-ink hover:text-brand-600 hover:underline">
                        {i.title}
                      </Link>
                      {i.hostName ? <p className="text-xs text-ink-3">Hosted by {i.hostName}</p> : null}
                    </TD>
                    <TD>
                      {i.attendance ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <MethodBadge method={i.attendance.method} />
                          <span className="text-xs tabular-nums text-ink-3">{fmtTime(i.attendance.checkedInAt)}</span>
                          {!i.asMember ? <span className="text-xs text-ink-3">as a guest</span> : null}
                        </span>
                      ) : (
                        <span className="text-sm text-ink-3">{i.endsAt > now ? "Not checked in yet" : "Didn't check in"}</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {items.length > SHOW ? <p className="text-xs text-ink-3">Showing the latest {SHOW} of {items.length} events.</p> : null}
          </>
        )}
      </section>
    </div>
  );
}
