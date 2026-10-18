import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { MembershipStatus } from "@prisma/client";
import { Activity, ExternalLink, History, KeyRound, ShieldCheck, Smartphone, Users } from "lucide-react";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { can, CAPABILITIES, isSysadmin, ROLE_LABEL, type Capability } from "@/lib/authz";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/kit";
import { userDetail } from "@/lib/domain/users";
import { detailsFor } from "@/lib/domain/details";
import { GENDER_LABEL, missingDetails, YEAR_LABEL } from "@/lib/details/rules";
import { EmergencyContactButton } from "@/components/details/EmergencyContactButton";
import { revealEmergencyContactAdminAction } from "@/app/admin/users/actions";
import { fmtAgo, fmtDate, fmtLongDate } from "@/lib/time";
import { END_REASON_LABEL } from "@/lib/roles/labels";
import { Avatar, ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KeyValue } from "@/components/ui/layout";
import { AccountActions } from "@/components/admin/users/AccountActions";
import {
  activityLabel,
  KIND_LABEL,
  MEMBERSHIP_SOURCE_LABEL,
  MEMBERSHIP_STATUS_LABEL,
  MEMBERSHIP_STATUS_TONE,
  PLATFORM_ROLE_LABEL,
  USER_STATUS_LABEL,
  USER_STATUS_TONE,
} from "@/components/admin/users/labels";

type Params = Promise<{ id: string }>;

/** Only admins see a person's name in the tab title. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const viewer = await getCurrentUser();
  if (!can(viewer, "admin.users")) return { title: "People" };
  const { id } = await params;
  const u = await db.user.findUnique({ where: { id }, select: { name: true } });
  return { title: u ? `${u.name} · People` : "People" };
}

// Current members first, then requests, then everything that ended.
const MEMBERSHIP_ORDER: Record<MembershipStatus, number> = { ACTIVE: 0, PENDING: 1, ALUMNI: 2, LEFT: 3, REMOVED: 4, DECLINED: 5 };

export default async function PersonPage({ params }: { params: Params }) {
  const { id } = await params;
  const viewer = await requireUser(`/admin/users/${id}`);
  if (!can(viewer, "admin.users")) notFound();

  let data: Awaited<ReturnType<typeof userDetail>>;
  try {
    data = await userDetail(viewer, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { user: person, roles, pastRoles, pastRoleCount, checkins, activity } = data;
  const det = await detailsFor(viewer, person.id);
  const detMissing = missingDetails(det, person.kind);
  const none = <span className="text-ink-3">Not given</span>;
  const memberships = [...data.memberships].sort((a, b) => MEMBERSHIP_ORDER[a.status] - MEMBERSHIP_ORDER[b.status]);
  const leadRoles = roles.filter((r) => r.role !== "MEMBER");
  const activeClubs = memberships.filter((m) => m.status === "ACTIVE").length;

  // Mirrors the rule in lib/domain/users (loadTarget), so the buttons never offer what the server refuses.
  const blockedReason =
    person.id === viewer.id
      ? "This is your own account. Another administrator can change its status."
      : person.platformRole !== "USER" && !isSysadmin(viewer)
        ? "Only a system administrator can change another administrator's account."
        : null;

  const majors = person.majors.filter((m) => !m.isMinor).map((m) => m.major.name);
  const minors = person.majors.filter((m) => m.isMinor).map((m) => m.major.name);

  return (
    <div className="space-y-6">

      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={person.name} src={person.avatarUrl} color={person.avatarColor} size="lg" />
          <div className="min-w-0 flex-1">
            <nav className="mb-1 text-sm text-ink-3" aria-label="Breadcrumb">
              <Link href="/admin/users" className="hover:text-ink">
                People
              </Link>
            </nav>
            <h1 className="text-2xl font-bold tracking-tight text-ink [overflow-wrap:anywhere]">{person.name}</h1>
            <p className="mt-0.5 break-all text-sm text-ink-2">
              {person.email}
              {person.pronouns ? <span className="text-ink-3"> · {person.pronouns}</span> : null}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone={USER_STATUS_TONE[person.status]}>{USER_STATUS_LABEL[person.status]}</Badge>
              <Badge>{KIND_LABEL[person.kind]}</Badge>
              {person.platformRole !== "USER" ? (
                <Badge tone="brand">
                  <ShieldCheck className="h-3 w-3" aria-hidden /> {PLATFORM_ROLE_LABEL[person.platformRole]}
                </Badge>
              ) : null}
              {person.hasMobileApp ? (
                <Badge tone="neutral">
                  <Smartphone className="h-3 w-3" aria-hidden /> Uses the app
                </Badge>
              ) : null}
            </div>
            {person.headline || person.jobTitle ? <p className="mt-2 text-sm text-ink-2">{person.jobTitle ?? person.headline}</p> : null}
          </div>
          {person.status !== "DEACTIVATED" ? (
            <Link href={`/u/${person.handle}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
              Public profile <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Current roles" description={leadRoles.length ? undefined : "Not leading or advising any club right now."} />
            {leadRoles.length ? (
              <ul className="divide-y divide-line">
                {leadRoles.map((r) => {
                  const caps = (r.role === "OFFICER" || r.role === "AMBASSADOR") && r.permissions.length ? r.permissions.filter((p): p is Capability => p in CAPABILITIES).map((p) => CAPABILITIES[p].label) : [];
                  return (
                    <li key={r.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="min-w-0 font-medium text-ink">
                          {r.position?.name ?? ROLE_LABEL[r.role]}{" "}
                          <span className="font-normal text-ink-3">
                            ·{" "}
                            <Link href={`/clubs/${r.club.slug}`} className="text-brand-600 hover:underline">
                              {r.club.name}
                            </Link>
                          </span>
                        </p>
                        <span className="text-xs text-ink-3">since {fmtLongDate(r.startedAt)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-3">
                        {ROLE_LABEL[r.role]}
                        {r.viaClub ? ` · placed by ${r.viaClub.name}` : ""}
                        {caps.length ? ` · can manage ${caps.join(", ").toLowerCase()}` : r.role === "OFFICER" || r.role === "AMBASSADOR" ? " · no tool permissions" : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {pastRoleCount ? (
              <details className={`group px-5 py-3 ${leadRoles.length ? "border-t border-line" : ""}`}>
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink-2 hover:text-ink">
                  <History className="h-4 w-4 text-ink-3" aria-hidden /> Past roles ({pastRoleCount})
                </summary>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {pastRoles.map((r) => (
                    <li key={r.id} className="flex flex-wrap justify-between gap-x-3">
                      <span className="min-w-0">
                        {r.position?.name ?? ROLE_LABEL[r.role]} <span className="text-ink-3">· {r.club.name}</span>
                      </span>
                      <span className="text-xs text-ink-3">
                        {fmtDate(r.startedAt, "MMM yyyy")} – {r.endedAt ? fmtDate(r.endedAt, "MMM yyyy") : "now"}
                        {r.endReason ? ` · ${END_REASON_LABEL[r.endReason].toLowerCase()}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                {pastRoleCount > pastRoles.length ? (
                  <p className="mt-2 text-xs text-ink-3">
                    Showing the latest {pastRoles.length}. Their{" "}
                    <Link href={`/u/${person.handle}`} className="text-brand-600 hover:underline">
                      profile
                    </Link>{" "}
                    has the full history.
                  </p>
                ) : null}
              </details>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Clubs"
              description={memberships.length ? `${activeClubs} current membership${activeClubs === 1 ? "" : "s"} · ${checkins.toLocaleString()} check-in${checkins === 1 ? "" : "s"} in all` : "Hasn't registered for any club yet."}
            />
            {memberships.length ? (
              <ul className="divide-y divide-line">
                {memberships.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <ClubLogo name={m.club.name} src={m.club.logoUrl} color={m.club.logoColor} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/clubs/${m.club.slug}`} className="font-medium text-ink hover:underline">
                        {m.club.name}
                      </Link>
                      {m.club.status === "RETIRED" ? <Badge className="ml-2 align-middle">Retired club</Badge> : null}
                      <p className="text-xs text-ink-3">
                        {MEMBERSHIP_SOURCE_LABEL[m.source]}
                        {m.joinedAt ? ` · joined ${fmtLongDate(m.joinedAt)}` : ` · asked ${fmtLongDate(m.requestedAt)}`}
                        {m.endedAt ? ` · ended ${fmtLongDate(m.endedAt)}` : ""}
                        {m.internalTitle ? ` · “${m.internalTitle}”` : ""}
                      </p>
                    </div>
                    <Badge tone={MEMBERSHIP_STATUS_TONE[m.status]}>{MEMBERSHIP_STATUS_LABEL[m.status]}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody>
                <p className="flex items-center gap-2 text-sm text-ink-3">
                  <Users className="h-4 w-4" aria-hidden /> No memberships or join requests.
                </p>
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent activity" description="The last 25 things they did on the platform." />
            {activity.length ? (
              <ol className="divide-y divide-line">
                {activity.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-5 py-2.5 text-sm">
                    <span className="min-w-0 text-ink">
                      {activityLabel(a.action)}
                      {a.club ? (
                        <span className="text-ink-3">
                          {" "}
                          ·{" "}
                          <Link href={`/clubs/${a.club.slug}`} className="hover:underline">
                            {a.club.name}
                          </Link>
                        </span>
                      ) : null}
                    </span>
                    <time dateTime={a.at.toISOString()} title={fmtLongDate(a.at)} className="shrink-0 text-xs text-ink-3">
                      {fmtAgo(a.at)}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <CardBody>
                <p className="flex items-center gap-2 text-sm text-ink-3">
                  <Activity className="h-4 w-4" aria-hidden /> Nothing yet.
                </p>
              </CardBody>
            )}
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Account status" />
            <CardBody className="space-y-3">
              <p className="text-sm text-ink-2">
                {person.status === "ACTIVE"
                  ? "Active — they can sign in and use everything their roles allow."
                  : person.status === "ALUMNI"
                    ? `Alumni${person.graduatedAt ? ` since ${fmtLongDate(person.graduatedAt)}` : ""}. They can sign in and keep their history, but no longer hold student roles.`
                    : "Deactivated — they can't sign in on the web or the app. Their history stays in their clubs."}
              </p>
              <AccountActions
                person={{ id: person.id, name: person.name, kind: person.kind, status: person.status, roleCount: leadRoles.length }}
                today={fmtDate(new Date(), "yyyy-MM-dd")}
                blockedReason={blockedReason}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <KeyValue
                className="sm:grid-cols-1"
                items={[
                  { label: "Handle", value: `@${person.handle}` },
                  ...(person.kind === "STUDENT"
                    ? [
                        { label: "Majors", value: majors.length ? majors.join(", ") : <span className="text-ink-3">Not listed</span> },
                        ...(minors.length ? [{ label: "Minors", value: minors.join(", ") }] : []),
                        { label: "Expected graduation", value: person.classYear ?? <span className="text-ink-3">Not listed</span> },
                      ]
                    : [{ label: "Department", value: person.department?.name ?? <span className="text-ink-3">Not listed</span> }]),
                  { label: "First signed in", value: fmtLongDate(person.createdAt) },
                  { label: "Last seen", value: person.lastSeenAt ? `${fmtAgo(person.lastSeenAt)} (${fmtLongDate(person.lastSeenAt)})` : "Never" },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Member details"
              description={
                det?.confirmedAt && !detMissing.length
                  ? `Confirmed ${fmtLongDate(det.confirmedAt)}.`
                  : detMissing.length
                    ? `Missing: ${detMissing.join(", ")}.`
                    : "Complete, but not confirmed yet."
              }
            />
            <CardBody className="space-y-3">
              <KeyValue
                className="sm:grid-cols-1"
                items={[
                  ...(person.kind === "STUDENT" ? [{ label: "Student ID", value: det?.studentId ?? none }] : []),
                  { label: "Date of birth", value: det?.birthDate ? fmtDate(det.birthDate, "MMM d, yyyy") : none },
                  { label: "Gender", value: det?.gender ? GENDER_LABEL[det.gender] : none },
                  ...(person.kind === "STUDENT" ? [{ label: "Year in school", value: det?.yearInSchool ? YEAR_LABEL[det.yearInSchool] : none }] : []),
                  { label: "Phone", value: det?.phone ?? none },
                  ...(det?.contactEmail ? [{ label: "Personal email", value: det.contactEmail }] : []),
                  {
                    label: "Address",
                    value: det?.addressLine ? `${det.addressLine}, ${det.addressCity ?? ""}, ${det.addressState ?? ""} ${det.addressZip ?? ""}`.replace(/\s+,/g, ",") : none,
                  },
                ]}
              />
              {det?.emergencyName ? <EmergencyContactButton userId={person.id} name={person.name} reveal={revealEmergencyContactAdminAction} /> : <p className="text-sm text-ink-3">No emergency contact yet.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Platform role" />
            <CardBody className="space-y-2 text-sm">
              <p className="flex items-center gap-2 font-medium text-ink">
                <KeyRound className="h-4 w-4 text-ink-3" aria-hidden /> {PLATFORM_ROLE_LABEL[person.platformRole]}
              </p>
              <p className="text-ink-3">
                Only system administrators grant or remove administrator access
                {isSysadmin(viewer) ? (
                  <>
                    , in{" "}
                    <Link href="/system/admins" className="text-brand-600 hover:underline">
                      System → Administrators
                    </Link>
                    .
                  </>
                ) : (
                  "."
                )}
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
