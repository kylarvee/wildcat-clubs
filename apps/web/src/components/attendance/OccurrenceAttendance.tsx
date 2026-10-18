import Link from "next/link";
import type { CheckInMethod } from "@prisma/client";
import { Users } from "lucide-react";
import { loadOccurrenceAttendees, type OccurrenceSummary } from "@/lib/attendance/queries";
import { pct } from "@/lib/attendance/matrix";
import { CHECKIN_METHODS, METHOD_SHORT } from "@/lib/attendance/rules";
import { fmtDate, fmtTime } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Stat } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { MethodBadge } from "@/components/attendance/MethodMark";
import { ManualAdd } from "@/components/attendance/ManualAdd";
import { RemoveAttendanceButton } from "@/components/attendance/RemoveAttendanceButton";

/**
 * Who came to one occurrence: totals, the attendee list (with remove), and
 * manual add. Reusable for club events and university trainings — the
 * caller decides `canManage` via canManageOccurrence().
 *
 * `memberClubId` decides who counts as a member vs. a guest (the viewing
 * club; the host for university pages that pass null → everyone is listed
 * without member/guest labels).
 */
export async function OccurrenceAttendance({
  occurrence,
  memberClubId,
  canManage,
  personHref,
}: {
  occurrence: OccurrenceSummary;
  memberClubId: string | null;
  canManage: boolean;
  /** Base path for per-person links, e.g. "/clubs/x/manage/attendance/members". */
  personHref?: string;
}) {
  const { attendees, membersAtTime, memberAttendees, guests, rate } = await loadOccurrenceAttendees(occurrence.id, memberClubId, occurrence.startsAt);
  const counts = Object.fromEntries(CHECKIN_METHODS.map((m) => [m, 0])) as Record<CheckInMethod, number>;
  for (const a of attendees) counts[a.method]++;
  // "9 QR · 2 Code · 1 Leader": only the ways people actually used.
  const byMethod = CHECKIN_METHODS.filter((m) => counts[m] > 0)
    .map((m) => `${counts[m]} ${METHOD_SHORT[m]}`)
    .join(" · ");
  const canAdd = canManage && !occurrence.cancelled && occurrence.windowState !== "NOT_OPEN";
  const sameDay = (d: Date) => fmtDate(d, "yyyy-MM-dd") === fmtDate(occurrence.startsAt, "yyyy-MM-dd");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Checked in" value={attendees.length} hint={attendees.length ? byMethod : "Nobody yet"} />
        {memberClubId ? (
          <>
            <Stat label="Members" value={memberAttendees} hint={`of ${membersAtTime} members at the time`} />
            <Stat label="Guests" value={guests} hint="from outside the club" />
            <Stat label="Attendance rate" value={pct(rate)} hint="members who came" />
          </>
        ) : null}
      </div>

      <div className={canAdd ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" : ""}>
        <div className="min-w-0 space-y-3">
          <h2 className="text-lg font-semibold text-ink">
            Who came <span className="text-base font-normal text-ink-3">· {attendees.length}</span>
          </h2>
          {attendees.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title="No check-ins yet"
              description={
                occurrence.windowState === "NOT_OPEN"
                  ? "Check-in hasn't opened. People who check in will show up here."
                  : canAdd
                    ? "If people were there but didn't check in, add them by name."
                    : "People who check in show up here."
              }
            />
          ) : (
            <Table className="table-fixed">
              <THead>
                <tr>
                  <TH scope="col" className="w-auto">
                    Person
                  </TH>
                  <TH scope="col" className="w-[150px] px-2 sm:w-[170px]">
                    How
                  </TH>
                  <TH scope="col" className="hidden w-[96px] px-2 sm:table-cell">
                    When
                  </TH>
                  {canManage ? (
                    <TH scope="col" className="w-12 px-2">
                      <span className="sr-only">Remove</span>
                    </TH>
                  ) : null}
                </tr>
              </THead>
              <TBody>
                {attendees.map((a) => {
                  const when = sameDay(a.checkedInAt) ? fmtTime(a.checkedInAt) : `${fmtDate(a.checkedInAt, "MMM d")}, ${fmtTime(a.checkedInAt)}`;
                  return (
                    <TR key={a.attendanceId}>
                      <TD className="py-2 pr-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar name={a.user.name} src={a.user.avatarUrl} color={a.user.avatarColor} size="sm" className="hidden sm:inline-flex" />
                          <div className="min-w-0">
                            {personHref ? (
                              <Link href={`${personHref}/${a.user.id}`} className="block truncate font-medium text-ink hover:text-brand-600 hover:underline">
                                {a.user.name}
                              </Link>
                            ) : (
                              <p className="truncate font-medium text-ink">{a.user.name}</p>
                            )}
                            <div className="mt-0.5 flex min-w-0 items-center gap-2">
                              {memberClubId ? (
                                a.asMember ? (
                                  <Badge tone="brand">Member</Badge>
                                ) : (
                                  <Badge tone="neutral" title={a.memberNow ? "Joined at or after this event" : undefined}>
                                    {a.memberNow ? "Guest, now a member" : "Guest"}
                                  </Badge>
                                )
                              ) : null}
                              <span className={memberClubId ? "hidden truncate text-xs text-ink-3 sm:inline" : "truncate text-xs text-ink-3"}>{a.user.email}</span>
                            </div>
                          </div>
                        </div>
                      </TD>
                      <TD className="px-2 py-2">
                        <MethodBadge method={a.method} />
                        {a.recordedBy ? <p className="mt-0.5 truncate text-xs text-ink-3">by {a.recordedBy}</p> : null}
                        <p className="mt-0.5 text-xs tabular-nums text-ink-3 sm:hidden">{when}</p>
                      </TD>
                      <TD className="hidden whitespace-nowrap px-2 tabular-nums text-ink-2 sm:table-cell">{when}</TD>
                      {canManage ? (
                        <TD className="px-2 text-right">
                          <RemoveAttendanceButton attendanceId={a.attendanceId} name={a.user.name} eventTitle={occurrence.title} />
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </div>

        {canAdd ? (
          <Card className="h-fit lg:sticky lg:top-20">
            <CardHeader title="Add someone by hand" description="For people who were there but couldn't scan — no phone, dead battery, arrived late." />
            <CardBody>
              <ManualAdd occurrenceId={occurrence.id} />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
