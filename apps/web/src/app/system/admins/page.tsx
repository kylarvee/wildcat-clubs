import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { History, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { fmtAgo, fmtLongDate } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { AdminRowActions, GrantAdminForm } from "@/components/system/AdminActions";

export const metadata: Metadata = { title: "Administrators" };

const ROLE_ACTIONS = ["system.admin_granted", "system.admin_revoked", "system.sysadmin_granted", "system.sysadmin_revoked"];
const CHANGE_LABEL: Record<string, string> = {
  "system.admin_granted": "made an administrator",
  "system.admin_revoked": "removed as an administrator",
  "system.sysadmin_granted": "made a system administrator",
  "system.sysadmin_revoked": "stepped back to administrator",
};

/**
 * Administrators (system.admins). WSUSA staff get ADMIN; people who run the
 * platform get SYSADMIN. Only sysadmins see this page, and nobody can change
 * their own role, so there is always at least one sysadmin.
 */
export default async function AdminsPage() {
  const user = await requireUser("/system/admins");
  if (!can(user, "system.admins")) notFound();

  const [admins, changes] = await Promise.all([
    db.user.findMany({
      where: { platformRole: { in: ["ADMIN", "SYSADMIN"] } },
      orderBy: [{ platformRole: "desc" }, { name: "asc" }],
      select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true, platformRole: true, status: true, jobTitle: true, lastSeenAt: true },
    }),
    db.activityLog.findMany({
      where: { action: { in: ROLE_ACTIONS } },
      orderBy: { at: "desc" },
      take: 15,
      select: { id: true, at: true, action: true, entityId: true, actor: { select: { name: true } } },
    }),
  ]);
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set(changes.map((c) => c.entityId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  // When each person got their current role, if the change was made on the platform.
  const since = new Map<string, Date>();
  for (const c of [...changes].reverse()) if (c.action.endsWith("_granted")) since.set(c.entityId, c.at);

  const sysadmins = admins.filter((a) => a.platformRole === "SYSADMIN");
  const regular = admins.filter((a) => a.platformRole === "ADMIN");

  const row = (a: (typeof admins)[number]) => (
    <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={a.name} src={a.avatarUrl} color={a.avatarColor} size="sm" />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5">
            <Link href={`/admin/users/${a.id}`} className="font-medium text-ink hover:underline">
              {a.name}
            </Link>
            {a.id === user.id ? <Badge tone="brand">You</Badge> : null}
            {a.status !== "ACTIVE" ? <Badge tone="danger">{a.status === "DEACTIVATED" ? "Deactivated" : "Alumni"}</Badge> : null}
          </p>
          <p className="break-all text-xs text-ink-3">{a.email}</p>
          <p className="text-xs text-ink-3">
            {a.jobTitle ? `${a.jobTitle} · ` : ""}
            {since.has(a.id) ? `since ${fmtLongDate(since.get(a.id)!)} · ` : ""}
            {a.lastSeenAt ? `last seen ${fmtAgo(a.lastSeenAt)}` : "hasn't signed in"}
          </p>
        </div>
      </div>
      {a.id === user.id ? (
        <p className="text-xs text-ink-3">Another system administrator can change your role.</p>
      ) : (
        <AdminRowActions person={{ id: a.id, name: a.name, role: a.platformRole as "ADMIN" | "SYSADMIN" }} />
      )}
    </li>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administrators"
        description="Administrators are WSUSA staff: they can do everything in every club and use the admin tools, but can't change platform rules or add administrators. System administrators can do everything, including this page."
      />

      <Card>
        <CardHeader title="Add an administrator" />
        <CardBody>
          <GrantAdminForm />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="System administrators" description={`${sysadmins.length} ${sysadmins.length === 1 ? "person" : "people"}. Nobody can remove their own role, so there's always at least one.`} />
        <ul className="divide-y divide-line">{sysadmins.map(row)}</ul>
      </Card>

      <Card>
        <CardHeader title="Administrators" description={regular.length ? `${regular.length} WSUSA ${regular.length === 1 ? "administrator" : "administrators"}.` : undefined} />
        {regular.length ? (
          <ul className="divide-y divide-line">{regular.map(row)}</ul>
        ) : (
          <CardBody>
            <EmptyState icon={<ShieldCheck />} title="No administrators yet" description="Add WSUSA staff above so they can review clubs, funding, reports and reviews." className="py-8" />
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <History className="h-4 w-4 text-ink-3" aria-hidden /> Recent changes
            </span>
          }
        />
        {changes.length ? (
          <ol className="divide-y divide-line text-sm">
            {changes.map((c) => (
              <li key={c.id.toString()} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-5 py-2.5">
                <span className="min-w-0 text-ink">
                  <span className="font-medium">{names.get(c.entityId) ?? "Someone"}</span> {CHANGE_LABEL[c.action]}
                  <span className="text-ink-3"> by {c.actor?.name ?? "the system"}</span>
                </span>
                <time dateTime={c.at.toISOString()} className="text-xs text-ink-3">
                  {fmtLongDate(c.at)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <CardBody>
            <p className="text-sm text-ink-3">No role changes made on the platform yet. Administrators who were set up before launch don&rsquo;t show here.</p>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
