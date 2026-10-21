import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/authz";
import { INSTITUTION } from "@/lib/institution";
import { fmtLongDate } from "@/lib/time";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { workspaceTitle } from "@/components/founding/workspaceTitle";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KeyValue, PageHeader } from "@/components/ui/layout";
import { AdvisorPanel } from "@/components/founding/AdvisorPanel";
import { RetireClubDialog } from "@/components/founding/RetireClubDialog";
import { CohostToggle, ContactEmailForm, LeaveClubButton } from "@/components/founding/SettingsControls";
import { JOIN_LABEL, SUCCESSION_LABEL } from "@/components/founding/copy";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return workspaceTitle((await params).slug, "Settings");
}

export default async function ClubSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, club, access } = await loadClubWorkspace(slug);
  const base = `/clubs/${club.slug}/manage`;
  const caps = access.capabilities;
  const live = club.status !== "RETIRED" && club.status !== "REJECTED";

  const [advisorRoles, invites, membership, myRoles, memberCount, otherPresidents] = await Promise.all([
    db.roleAssignment.findMany({ where: { clubId: club.id, role: "ADVISOR", endedAt: null }, select: { user: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } } }, orderBy: { startedAt: "asc" } }),
    db.advisorInvite.findMany({ where: { clubId: club.id, status: "PENDING" }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, email: true, createdAt: true, inviteeId: true } }),
    db.membership.findUnique({ where: { userId_clubId: { userId: user.id, clubId: club.id } }, select: { status: true } }),
    db.roleAssignment.findMany({ where: { clubId: club.id, userId: user.id, endedAt: null }, select: { role: true, position: { select: { name: true } } } }),
    db.membership.count({ where: { clubId: club.id, status: "ACTIVE" } }),
    db.roleAssignment.count({ where: { clubId: club.id, role: "PRESIDENT", endedAt: null, userId: { not: user.id } } }),
  ]);
  const isMember = membership?.status === "ACTIVE" || membership?.status === "PENDING";
  const soloPresident = myRoles.some((r) => r.role === "PRESIDENT") && otherPresidents === 0;
  const founding = club.status === "DRAFT" || club.status === "CHANGES_REQUESTED" || club.status === "SUBMITTED";

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="How your club runs on Wildcat Clubs." />

      <Card>
        <CardHeader
          title="Membership & succession"
          description="Set by your constitution and bylaws, so the platform always follows your governing documents."
          action={
            caps.has("constitution") && live ? (
              <Link href={`${base}/constitution`} className="text-sm font-medium text-brand-600 hover:underline">
                Update in the builder
              </Link>
            ) : null
          }
        />
        <CardBody>
          <KeyValue
            items={[
              { label: "How students join (constitution)", value: JOIN_LABEL[club.joinPolicy] },
              { label: "Primary way leaders are chosen (bylaws)", value: SUCCESSION_LABEL[club.successionMethod] },
            ]}
          />
          <p className="mt-4 text-xs text-ink-3">
            Every seat is filled this way unless the President and advisor choose one of the other ways for a particular seat — see{" "}
            <Link href={`${base}/elections`} className="underline">
              Elections
            </Link>
            . To change either setting, update your constitution or bylaws in the builder and adopt the new version — or upload custom documents for WSUSA approval.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Advisors" description={`Faculty or staff members who guide the club. They have full access to every tool.`} />
        <CardBody>
          <AdvisorPanel
            clubId={club.id}
            canInvite={access.canInviteAdvisor && live}
            noInviteNote={club.type === "COLLEGE_AMBASSADORS" ? "WSUSA chooses this program's advisor. To change it, contact WSUSA." : undefined}
            staffDomain={INSTITUTION.staffEmailDomain}
            advisors={advisorRoles.map((r) => r.user)}
            invites={invites.map((i) => ({ id: i.id, name: i.name, email: i.email, sentLabel: fmtLongDate(i.createdAt), hasAccount: Boolean(i.inviteeId) }))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Co-hosted events" />
        <CardBody className="space-y-2">
          <CohostToggle clubId={club.id} on={club.autoApproveCohosts} disabled={!caps.has("events") || club.status !== "APPROVED"} />
          {club.status !== "APPROVED" ? (
            <p className="text-xs text-ink-3">Available once WSUSA approves your club.</p>
          ) : !caps.has("events") ? (
            <p className="text-xs text-ink-3">Only leaders with the Events permission can change this.</p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Club Google account"
          action={club.contactEmail ? <Badge tone={club.googleAccountVerifiedAt ? "success" : "warning"}>{club.googleAccountVerifiedAt ? "Verified by WSUSA" : "Waiting for WSUSA"}</Badge> : null}
        />
        <CardBody className="space-y-2">
          {caps.has("profile") ? (
            <ContactEmailForm clubId={club.id} email={club.contactEmail} />
          ) : (
            <p className="text-sm text-ink-2">{club.contactEmail ?? "Not set yet."} Only leaders with the Profile permission can change it.</p>
          )}
          {club.contactEmail ? (
            <p className="text-xs text-ink-3">
              {club.googleAccountVerifiedAt
                ? `WSUSA verified this account on ${fmtLongDate(club.googleAccountVerifiedAt)}. Changing it starts a new check, and the club's Drive folder, calendar and Chat space are made again in the new account.`
                : "WSUSA checks that this is your club's own account before Google sync runs as it. Until then, nothing is copied to Google."}
              {founding ? " Sync also waits until your club is approved." : ""}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {isMember && !access.viaPlatform ? (
        <Card>
          <CardHeader
            title="Your membership"
            description={myRoles.length ? `You're ${myRoles.map((r) => r.position?.name ?? ROLE_LABEL[r.role]).join(" and ")}.` : membership?.status === "PENDING" ? "Your join request is pending." : "You're a member."}
          />
          <CardBody>
            <LeaveClubButton
              clubId={club.id}
              clubName={club.name}
              blockedReason={soloPresident && live ? "You're the only President. Name the next President in the org chart before you leave." : null}
            />
            {soloPresident && live && caps.has("orgchart") ? (
              <Link href={`${base}/org-chart`} className="mt-2 inline-block text-sm font-medium text-brand-600 hover:underline">
                Open the org chart
              </Link>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {access.canRetire && club.status !== "RETIRED" ? (
        <Card className="border-red-200">
          <CardHeader title={<span className="text-danger">Danger zone</span>} description={founding ? "Not going ahead with this club? Closing the draft keeps its record." : "Retiring ends the club's activity but keeps its history."} />
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-2">
              {founding ? "Close the draft if your team has decided not to found this club." : "Retire the club if it's winding down. Only WSUSA can reinstate it later."}
            </p>
            <RetireClubDialog clubId={club.id} clubName={club.name} memberCount={memberCount} founding={club.status === "DRAFT" || club.status === "CHANGES_REQUESTED"} />
          </CardBody>
        </Card>
      ) : null}

      {club.status === "RETIRED" && access.viaPlatform ? (
        <Card>
          <CardHeader title="Reinstate" description={`Retired ${club.retiredAt ? fmtLongDate(club.retiredAt) : ""}.`} />
          <CardBody>
            <Link href={`/admin/clubs/${club.id}`} className="text-sm font-medium text-brand-600 hover:underline">
              Open this club in Club approvals to reinstate it
            </Link>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
