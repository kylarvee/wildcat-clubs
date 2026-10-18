import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { ROLE_LABEL } from "@/lib/authz";
import { clubActivity } from "@/lib/metrics";
import { CLUB_STATUS_LABEL, CLUB_STATUS_TONE, STANDING_HINT, STANDING_LABEL, STANDING_TONE, standingOf } from "@/lib/labels/clubs";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/layout";
import { WorkspaceNav, type WorkspaceLink } from "@/components/workspace/WorkspaceNav";
import { PausedBanner } from "@/components/roles/PausedBanner";

/**
 * The club workspace: every leadership tool for one club, gated per capability by lib/authz.
 * The header states two separate facts: WSUSA recognition (Club.status) and, once approved,
 * the activity standing from lib/metrics — an approved club can still be inactive.
 */
export default async function ManageLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, club, access } = await loadClubWorkspace(slug);
  const base = `/clubs/${club.slug}/manage`;
  const has = (c: Parameters<typeof access.capabilities.has>[0]) => access.capabilities.has(c);
  const approved = club.status === "APPROVED";
  const standing = approved ? standingOf(await clubActivity(club.id)) : null;

  const links: WorkspaceLink[] = [
    { key: "overview", label: "Overview", href: base },
    { key: "profile", label: "Club profile", href: `${base}/profile`, locked: !has("profile") },
    { key: "members", label: "Members", href: `${base}/members`, locked: !has("roster") },
    { key: "org-chart", label: "Org chart", href: `${base}/org-chart` },
    { key: "history", label: "Role history", href: `/clubs/${club.slug}/history` },
    ...(approved
      ? ([
          { key: "events", label: "Events", href: `${base}/events`, locked: !has("events") },
          { key: "attendance", label: "Attendance", href: `${base}/attendance`, locked: !has("attendance") },
          { key: "budget", label: "Budget & funding", href: `${base}/budget`, locked: !has("budget") },
          { key: "announcements", label: "Announcements", href: `${base}/announcements`, locked: !has("announcements") },
          { key: "elections", label: "Elections", href: `${base}/elections`, locked: !has("elections") },
          { key: "tests", label: "Club tests", href: `${base}/tests`, locked: !has("tests") },
        ] as WorkspaceLink[])
      : []),
    { key: "files", label: "Files", href: `${base}/files`, locked: !has("files") },
    { key: "constitution", label: "Constitution", href: `${base}/constitution`, locked: !has("constitution") },
    ...(club.type === "COLLEGE_AMBASSADORS" && approved ? ([{ key: "ambassadors", label: "Ambassador placements", href: `${base}/ambassadors`, locked: !has("roster") }] as WorkspaceLink[]) : []),
    { key: "settings", label: "Settings", href: `${base}/settings` },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="md" />
        <div className="min-w-[12rem] flex-1">
          <h1 className="text-xl font-bold tracking-tight text-balance">{club.name}</h1>
          <dl className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <div className="flex items-center gap-1.5">
              <dt className="text-ink-3">Recognition</dt>
              <dd>
                <Badge tone={CLUB_STATUS_TONE[club.status]}>{CLUB_STATUS_LABEL[club.status]}</Badge>
              </dd>
            </div>
            {standing ? (
              <div className="flex items-center gap-1.5">
                <dt className="text-ink-3">Standing</dt>
                <dd>
                  <Badge tone={STANDING_TONE[standing]} title={STANDING_HINT[standing]}>
                    {STANDING_LABEL[standing]}
                  </Badge>
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-1 text-sm text-ink-3">
            {access.viaPlatform ? `Viewing as ${access.viaPlatform === "SYSADMIN" ? "system administrator" : "administrator"}` : `You're ${access.role ? ROLE_LABEL[access.role] : "a leader"}`}
          </p>
        </div>
        {club.status === "APPROVED" || club.status === "RETIRED" ? (
          <Link href={`/clubs/${club.slug}`} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
            View club page <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
      {/* Names what's overdue for their role here and how to clear it. */}
      {access.suspended ? <PausedBanner actor={user} clubId={club.id} className="mb-6" /> : null}
      {club.status === "RETIRED" ? (
        <Callout tone="info" className="mb-6" title="This club is retired">
          Its history, roles and files are kept. Only an administrator can reinstate it.
        </Callout>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <WorkspaceNav links={links} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
