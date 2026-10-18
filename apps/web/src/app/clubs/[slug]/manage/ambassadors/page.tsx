import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { AMBASSADOR_REQUEST } from "@/lib/ambassadors/rules";
import { isClubRepSeat } from "@/lib/roles/defaults";
import { fmtMonthRange } from "@/lib/roles/history";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardHeader } from "@/components/ui/card";
import { Callout, PageHeader, Section, Stat } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { Placements, type ClubRequest, type CollegeClub, type Rep } from "./_components/Placements";

export const metadata = { title: "Ambassador placements" };

/**
 * College Ambassadors orgs embed their Club Representative Ambassadors in the
 * college's clubs. Each placement is an AMBASSADOR role in the club's
 * "College Ambassador" seat, linked back to this org. Clubs ask for one from
 * their org chart; open requests come first here (domain/ambassadors).
 */
export default async function AmbassadorPlacementsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const showRequested = (await searchParams).requested === "1";
  const { club: org, access, allowed } = await loadClubWorkspace(slug, "roster");
  if (org.type !== "COLLEGE_AMBASSADORS") notFound();
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Ambassador placements" />
        <NoPermission what="ambassador placements" suspended={access.suspended} />
      </div>
    );
  }
  if (!org.collegeId || !org.college) {
    return (
      <div className="space-y-6">
        <PageHeader title="Ambassador placements" />
        <Callout tone="warning" title="This org isn't linked to a college yet">
          A WSUSA administrator needs to set {org.name}&apos;s college before you can place ambassadors in its clubs.
        </Callout>
      </div>
    );
  }

  const [clubs, placements, orgRoles, requestTasks] = await Promise.all([
    db.club.findMany({
      where: { collegeId: org.collegeId, status: "APPROVED", type: { not: "COLLEGE_AMBASSADORS" }, id: { not: org.id } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, logoUrl: true, logoColor: true, shortDescription: true, _count: { select: { memberships: { where: { status: "ACTIVE" } } } } },
    }),
    db.roleAssignment.findMany({
      where: { viaClubId: org.id, endedAt: null },
      orderBy: { startedAt: "asc" },
      include: { user: { select: { id: true, name: true, handle: true, avatarUrl: true, avatarColor: true } } },
    }),
    db.roleAssignment.findMany({
      where: { clubId: org.id, endedAt: null, role: "AMBASSADOR", user: { status: "ACTIVE", kind: "STUDENT" } },
      include: { position: { select: { role: true, name: true } }, user: { select: { id: true, name: true, handle: true, avatarUrl: true, avatarColor: true } } },
    }),
    db.task.findMany({
      where: { sourceType: AMBASSADOR_REQUEST, status: "OPEN", clubId: org.id },
      orderBy: { createdAt: "asc" },
      select: { sourceId: true, createdAt: true, description: true, createdBy: { select: { name: true } } },
    }),
  ]);
  const requests: Record<string, ClubRequest> = {};
  for (const t of requestTasks) {
    if (t.sourceId && !requests[t.sourceId]) requests[t.sourceId] = { at: t.createdAt.toISOString(), note: t.description ?? null, byName: t.createdBy?.name ?? null };
  }

  const collegeClubs: CollegeClub[] = clubs.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    logoUrl: c.logoUrl,
    logoColor: c.logoColor,
    shortDescription: c.shortDescription,
    members: c._count.memberships,
    placed: placements
      .filter((p) => p.clubId === c.id)
      .map((p) => ({ assignmentId: p.id, userId: p.user.id, name: p.user.name, handle: p.user.handle, avatarUrl: p.user.avatarUrl, avatarColor: p.user.avatarColor, sinceLabel: fmtMonthRange(p.startedAt, p.startedAt) })),
  }));

  const repMap = new Map<string, Rep>();
  for (const r of orgRoles) {
    if (!r.position || !isClubRepSeat(r.position) || repMap.has(r.user.id)) continue;
    repMap.set(r.user.id, { ...r.user, placements: placements.filter((p) => p.userId === r.user.id).length });
  }
  const reps = [...repMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const covered = collegeClubs.filter((c) => c.placed.length > 0).length;
  const clubName = new Map(clubs.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ambassador placements"
        description={`Embed ${org.name}'s club representatives in ${org.college.name} clubs. Each one shows on that club's org chart as its College Ambassador.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Clubs in the college" value={collegeClubs.length} />
        <Stat label="With an ambassador" value={covered} hint={collegeClubs.length ? `${Math.round((covered / collegeClubs.length) * 100)}% coverage` : undefined} />
        <Stat label="Need one" value={collegeClubs.length - covered} />
        <Stat label="Asked for one" value={Object.keys(requests).length} />
        <Stat label="Club reps" value={reps.length} />
      </div>

      {reps.length === 0 ? (
        <Callout tone="warning" title="No club representatives yet">
          Put people in the Club Representative Ambassador seat in{" "}
          <Link href={`/clubs/${org.slug}/manage/org-chart`} className="underline">
            your org chart
          </Link>{" "}
          first, then place them here.
        </Callout>
      ) : null}

      <Placements orgId={org.id} orgName={org.name} clubs={collegeClubs} reps={reps} requests={requests} initialFilter={showRequested && Object.keys(requests).length ? "requested" : "all"} />

      {reps.length ? (
        <Section title="Your club representatives" description="Who represents the college where.">
          <Card>
            <CardHeader title={`${reps.length} representative${reps.length === 1 ? "" : "s"}`} />
            <ul className="divide-y divide-line">
              {reps.map((r) => {
                const where = placements.filter((p) => p.userId === r.id).map((p) => clubName.get(p.clubId) ?? "a club");
                return (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar name={r.name} src={r.avatarUrl} color={r.avatarColor} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/u/${r.handle}`} className="text-sm font-medium text-ink hover:underline">
                        {r.name}
                      </Link>
                      <p className="truncate text-xs text-ink-3">{where.length ? where.join(" · ") : "Not placed yet"}</p>
                    </div>
                    <span className="text-sm tabular-nums text-ink-2">{where.length}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </Section>
      ) : null}
    </div>
  );
}
