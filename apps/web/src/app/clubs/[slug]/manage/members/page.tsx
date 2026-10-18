import { Download } from "lucide-react";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { getConfig } from "@/lib/config";
import { activeMemberIdsFor, clubMemberAttendanceCounts, registeredMemberCount } from "@/lib/metrics";
import { rosterData } from "@/lib/roles/queries";
import { memberContacts } from "@/lib/domain/details";
import { YEAR_LABEL } from "@/lib/details/rules";
import { fmtAgo, fmtLongDate } from "@/lib/time";
import { buttonClasses } from "@/components/ui/button";
import { Callout, PageHeader, Stat } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { MembersTable } from "./_components/MembersTable";
import { PendingRequests } from "./_components/PendingRequests";
import type { MemberRow, PendingRow } from "./_components/types";

export const metadata = { title: "Members" };

export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, club, access, allowed } = await loadClubWorkspace(slug, "roster");
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Members" />
        <NoPermission what="the member roster" suspended={access.suspended} />
      </div>
    );
  }

  // Counts and "active" come from lib/metrics so the roster agrees with every other screen.
  const [roster, attendance, registered, activeIds, cfg] = await Promise.all([
    rosterData(club.id),
    clubMemberAttendanceCounts(club.id),
    registeredMemberCount(club.id),
    activeMemberIdsFor(club.id),
    getConfig(),
  ]);
  const activeRule = { windowDays: cfg["activity.studentWindowDays"], recentEvents: cfg["activity.studentRecentEvents"] };
  // Contact basics from member details (lib/authz/details: this page needs the roster capability, which is enough).
  const contacts = await memberContacts(user, club.id, roster.map((r) => r.person.id));
  const full = access.viaPlatform !== null || access.isAdvisor;

  const rows: MemberRow[] = roster
    .filter((r) => r.status !== "PENDING" && r.status !== "DECLINED")
    .map((r) => {
      const a = attendance.get(r.person.id);
      // Mirrors memberships.removeMember so the menu never offers what the server will refuse.
      const advisorRow = r.roles.some((x) => x.role === "ADVISOR");
      const removeBlocked = advisorRow && !access.viaPlatform ? "Only an admin can remove an advisor" : !full && r.topRank >= access.rank ? "Can't remove someone at your rank or above" : undefined;
      return {
        membershipId: r.membershipId,
        userId: r.person.id,
        name: r.person.name,
        handle: r.person.handle,
        email: r.person.email,
        avatarUrl: r.person.avatarUrl,
        avatarColor: r.person.avatarColor,
        status: r.status,
        internalTitle: r.internalTitle,
        joinedAt: r.joinedAt?.getTime() ?? null,
        joinedLabel: r.joinedAt ? fmtLongDate(r.joinedAt) : "—",
        roles: r.roles.map((x) => ({ label: x.label, role: x.role, viaClub: x.viaClub })),
        attended: a?.attended ?? 0,
        lastAttendedAt: a?.lastAttendedAt?.getTime() ?? null,
        lastAttendedLabel: a?.lastAttendedAt ? fmtLongDate(a.lastAttendedAt) : "Never",
        active: Boolean(a?.active),
        canRemove: !removeBlocked && club.status !== "RETIRED",
        removeBlocked,
        isSelf: r.person.id === user.id,
        yearLabel: contacts.get(r.person.id)?.yearInSchool ? YEAR_LABEL[contacts.get(r.person.id)!.yearInSchool!] : null,
        phone: contacts.get(r.person.id)?.phone ?? null,
        contactEmail: contacts.get(r.person.id)?.contactEmail ?? null,
        hasEmergency: Boolean(contacts.get(r.person.id)?.hasEmergency),
      };
    });

  const pending: PendingRow[] = roster
    .filter((r) => r.status === "PENDING")
    .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime())
    .map((r) => ({
      membershipId: r.membershipId,
      name: r.person.name,
      handle: r.person.handle,
      email: r.person.email,
      avatarUrl: r.person.avatarUrl,
      avatarColor: r.person.avatarColor,
      requestedLabel: fmtAgo(r.requestedAt),
      attended: attendance.get(r.person.id)?.attended ?? 0,
    }));

  const current = rows.filter((r) => r.status === "ACTIVE");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description={
          club.joinPolicy === "APPROVAL"
            ? `Everyone in ${club.name}. New members need a leader's approval before they join.`
            : `Everyone in ${club.name}. Students who register or check in join right away.`
        }
        actions={
          rows.length ? (
            <a href={`/clubs/${club.slug}/manage/members/export`} download className={buttonClasses("outline")}>
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
          ) : null
        }
      />

      {club.status === "RETIRED" ? <Callout tone="info">This club is retired, so the roster is read-only.</Callout> : null}

      {pending.length ? <PendingRequests slug={club.slug} rows={pending} /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Registered students and the active ones among them, as on the club page; the table below also lists advisors. */}
        <Stat label="Members" value={registered} hint="Registered students" />
        <Stat label="Attending members" value={activeIds.length} hint={`Checked in within ${activeRule.windowDays} days or at one of the last ${activeRule.recentEvents} events`} />
        <Stat label="Leaders" value={current.filter((r) => r.roles.length > 0).length} />
        <Stat label="Alumni" value={rows.filter((r) => r.status === "ALUMNI").length} />
      </div>

      <MembersTable slug={club.slug} clubId={club.id} clubName={club.name} rows={rows} canEditTitles={club.status !== "RETIRED"} activeRule={activeRule} />

      <PolicyNotices placement="MEMBERSHIP" />
    </div>
  );
}
