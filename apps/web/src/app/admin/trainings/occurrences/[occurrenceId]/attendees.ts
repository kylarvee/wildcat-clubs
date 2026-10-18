import "server-only";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/authz";

/** One university-event meeting with its check-ins and each attendee's current leadership roles. */
export async function loadAttendees(occurrenceId: string) {
  const occ = await db.eventOccurrence.findUnique({
    where: { id: occurrenceId },
    include: {
      event: { select: { id: true, title: true, clubId: true, allDay: true, status: true, kind: true } },
      attendances: {
        orderBy: { checkedInAt: "asc" },
        include: {
          user: { select: { id: true, name: true, email: true, handle: true, avatarUrl: true, avatarColor: true, kind: true } },
          recordedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!occ || occ.event.clubId !== null) return null;
  const userIds = occ.attendances.map((a) => a.userId);
  const roles = userIds.length
    ? await db.roleAssignment.findMany({
        where: { userId: { in: userIds }, endedAt: null, role: { not: "MEMBER" } },
        select: { userId: true, role: true, position: { select: { name: true } }, club: { select: { name: true } } },
      })
    : [];
  const rolesByUser = new Map<string, string[]>();
  for (const r of roles) rolesByUser.set(r.userId, [...(rolesByUser.get(r.userId) ?? []), `${r.position?.name ?? ROLE_LABEL[r.role]}, ${r.club.name}`]);
  return { occ, rolesByUser };
}

export const METHOD_LABEL = { QR: "QR scan", SELF: "Event code", MANUAL: "Added by staff" } as const;
