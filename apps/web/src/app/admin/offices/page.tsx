import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Building2, Info } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { adminIds } from "@/lib/authz/people";
import { listOffices } from "@/lib/offices";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, KeyValue, PageHeader } from "@/components/ui/layout";
import { OfficeContact } from "@/components/offices/OfficeContact";
import { OfficeDetailsDialog, OfficeStaff } from "@/components/offices/OfficeEditor";

export const metadata: Metadata = { title: "Offices" };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * Admin → Offices (WSUSA's admins, admin.offices): the campus offices that
 * oversee clubs (lib/offices). Each office's details (students see its name
 * and contacts on its clubs' pages), whether it decides its clubs' funding,
 * its staff, and how many clubs it oversees, linking to them. Details nobody
 * has confirmed yet carry a prompt to check them with the office.
 */
export default async function AdminOfficesPage() {
  const user = await requireUser("/admin/offices");
  if (!can(user, "admin.offices")) notFound();
  const offices = await listOffices();
  const [members, clubs, confirmed, admins] = await Promise.all([
    db.officeMember.findMany({
      where: { office: { umbrella: false } },
      orderBy: { addedAt: "asc" },
      select: { officeId: true, addedAt: true, user: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true, status: true } } },
    }),
    db.club.groupBy({ by: ["officeId"], _count: { _all: true } }),
    db.activityLog.findMany({ where: { action: "office.updated", entityType: "office" }, select: { entityId: true }, distinct: ["entityId"] }),
    adminIds(),
  ]);
  // A null officeId is the umbrella's (lib/offices/rules).
  const clubCount = (id: string | null) => clubs.find((c) => c.officeId === id)?._count._all ?? 0;
  const checked = new Set(confirmed.map((c) => c.entityId));
  const unconfirmed = offices.filter((o) => !checked.has(o.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Offices"
        description="The campus offices that oversee clubs. WSUSA oversees every club no other office does: Campus Recreation runs club sports, and Fraternity & Sorority Life runs fraternities and sororities. Each office's staff see only their own clubs and queue in the admin console."
      />

      {unconfirmed.length ? (
        <Callout tone="warning" icon={<Info />} title={`Confirm ${unconfirmed.length === 1 ? `${unconfirmed[0].name}'s details` : "these offices' details"} with ${unconfirmed.length === 1 ? "the office" : "each office"}`}>
          {unconfirmed.map((o) => o.name).join(", ")} {unconfirmed.length === 1 ? "still has" : "still have"} the contacts the platform started with, taken from public weber.edu pages. Students see them on club pages and
          when they submit a club. Check them with the office, then open <span className="font-medium">Edit details</span> and save, even if nothing changed.
        </Callout>
      ) : null}

      <ul className="space-y-6">
        {offices.map((o) => {
          const staff = members.filter((m) => m.officeId === o.id && m.user.status === "ACTIVE");
          const count = clubCount(o.umbrella ? null : o.id);
          return (
            <li key={o.id}>
              <Card>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <Building2 className="h-5 w-5 text-ink-3" aria-hidden /> {o.name}
                      {o.shortName !== o.name ? <Badge tone="neutral">{o.shortName}</Badge> : null}
                      {o.umbrella ? <Badge tone="brand">Oversees every other club</Badge> : null}
                    </span>
                  }
                  description={o.umbrella ? "Clubs go here unless another office oversees them. Reports, review moderation, the directory and university-wide work are always its." : `Its staff run the admin console for its clubs only.`}
                  action={<OfficeDetailsDialog office={o} />}
                />
                <CardBody className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                  <div className="space-y-4">
                    <KeyValue
                      items={[
                        {
                          label: "Clubs",
                          value: (
                            <Link href={`/admin/clubs?tab=all&office=${encodeURIComponent(o.key)}`} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
                              {plural(count, "club")} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                            </Link>
                          ),
                        },
                        { label: "Review time", value: plural(o.reviewDays, "day") },
                        { label: "Funding", value: o.umbrella ? "Decides every request no other office decides" : o.decidesFunding ? "Decides its clubs' funding" : "Its clubs' funding goes to WSUSA" },
                      ]}
                    />
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Contacts</p>
                      {o.location || o.hours || o.email || o.phone ? <OfficeContact office={o} /> : <p className="text-sm text-ink-3">None yet. Add them so students know who to ask.</p>}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Staff</p>
                    {o.umbrella ? (
                      <p className="text-sm text-ink-2">
                        {o.name}&apos;s staff are the platform&apos;s administrators ({plural(admins.length, "person", "people")}), who see every office&apos;s clubs.{" "}
                        {can(user, "system.admins") ? (
                          <Link href="/system/admins" className="font-medium text-brand-600 hover:underline">
                            Manage administrators
                          </Link>
                        ) : (
                          "A system administrator adds them."
                        )}
                      </p>
                    ) : (
                      <OfficeStaff
                        officeId={o.id}
                        officeName={o.name}
                        staff={staff.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, avatarUrl: m.user.avatarUrl, avatarColor: m.user.avatarColor, addedAt: m.addedAt.toISOString() }))}
                      />
                    )}
                  </div>
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
