import Link from "next/link";
import { Archive } from "lucide-react";
import type { Club } from "@prisma/client";
import { db } from "@/lib/db";
import { fmtLongDate } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/layout";
import { ActivityFeed } from "@/components/founding/ActivityFeed";
import { WsusaContacts } from "@/components/founding/WsusaContacts";

/** RETIRED: what the club left behind. Everything stays readable; only WSUSA can reinstate. */
export async function RetiredSummary({ club }: { club: Club }) {
  const [roles, people, alumni, held, files] = await Promise.all([
    db.roleAssignment.count({ where: { clubId: club.id, role: { not: "MEMBER" } } }),
    db.roleAssignment.findMany({ where: { clubId: club.id, role: { not: "MEMBER" } }, distinct: ["userId"], select: { userId: true } }),
    db.membership.count({ where: { clubId: club.id, status: { in: ["ALUMNI", "ACTIVE"] } } }),
    db.eventOccurrence.count({ where: { event: { clubId: club.id }, status: "SCHEDULED", startsAt: { lte: club.retiredAt ?? new Date() }, attendances: { some: {} } } }),
    db.fileItem.count({ where: { clubId: club.id, isFolder: false, trashedAt: null } }),
  ]);
  const since = club.approvedAt ?? club.createdAt;
  const base = `/clubs/${club.slug}/manage`;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Archive className="h-4 w-4 text-ink-3" aria-hidden /> Club archive</span>} description={`${fmtLongDate(since)} – ${club.retiredAt ? fmtLongDate(club.retiredAt) : "retired"}`} />
        <CardBody className="space-y-2 text-sm">
          {club.retiredReason ? (
            <p className="text-ink-2">
              <span className="font-medium text-ink">Why it retired:</span> {club.retiredReason}
            </p>
          ) : null}
          <p className="text-ink-3">Roles ended, members became alumni, and future events were cancelled. Every record below is kept for good.</p>
        </CardBody>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Members over time" value={alumni} />
        <Stat label="Leaders" value={people.length} hint={`${roles} roles held`} />
        <Stat label="Events held" value={held} />
        <Stat label="Files kept" value={files} />
      </div>
      <Card>
        <CardHeader title="Browse the record" />
        <CardBody className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href={`${base}/org-chart`} className="font-medium text-brand-600 hover:underline">Role history</Link>
          <Link href={`${base}/files`} className="font-medium text-brand-600 hover:underline">Club files</Link>
          <Link href={`${base}/constitution`} className="font-medium text-brand-600 hover:underline">Constitution & bylaws</Link>
          <Link href={`/clubs/${club.slug}`} className="font-medium text-brand-600 hover:underline">Public club page</Link>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Last activity" />
        <CardBody>
          <ActivityFeed clubId={club.id} take={8} />
        </CardBody>
      </Card>
      <WsusaContacts title="Want to bring the club back?" description="Only WSUSA can reinstate a retired club. Reach out to start that conversation." />
    </div>
  );
}
