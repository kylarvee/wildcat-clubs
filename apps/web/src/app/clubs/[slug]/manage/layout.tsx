import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { ROLE_LABEL } from "@/lib/authz";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/layout";
import { WorkspaceNav, type WorkspaceLink } from "@/components/workspace/WorkspaceNav";

const STATUS_TONE = { DRAFT: "neutral", SUBMITTED: "info", CHANGES_REQUESTED: "warning", APPROVED: "success", REJECTED: "danger", RETIRED: "neutral" } as const;
const STATUS_LABEL = { DRAFT: "Draft", SUBMITTED: "In WSUSA review", CHANGES_REQUESTED: "Changes requested", APPROVED: "Active", REJECTED: "Not approved", RETIRED: "Retired" } as const;

/** The club workspace: every leadership tool for one club, gated per capability by lib/authz. */
export default async function ManageLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club, access } = await loadClubWorkspace(slug);
  const base = `/clubs/${club.slug}/manage`;
  const has = (c: Parameters<typeof access.capabilities.has>[0]) => access.capabilities.has(c);
  const approved = club.status === "APPROVED";

  const links: WorkspaceLink[] = [
    { key: "overview", label: "Overview", href: base },
    { key: "profile", label: "Club profile", href: `${base}/profile`, locked: !has("profile") },
    { key: "members", label: "Members", href: `${base}/members`, locked: !has("roster") },
    { key: "org-chart", label: "Org chart", href: `${base}/org-chart` },
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
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-bold tracking-tight">{club.name}</h1>
            <Badge tone={STATUS_TONE[club.status]}>{STATUS_LABEL[club.status]}</Badge>
          </div>
          <p className="text-sm text-ink-3">
            {access.viaPlatform ? `Viewing as ${access.viaPlatform === "SYSADMIN" ? "system administrator" : "administrator"}` : `You're ${access.role ? ROLE_LABEL[access.role] : "a leader"}`}
          </p>
        </div>
        {club.status === "APPROVED" || club.status === "RETIRED" ? (
          <Link href={`/clubs/${club.slug}`} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
            View club page <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
      {access.suspended ? (
        <Callout tone="warning" className="mb-6" title="Your leadership permissions are paused">
          You have an overdue officer requirement. Finish it from <Link href="/tasks" className="underline">your tasks</Link> and your permissions come back right away.
        </Callout>
      ) : null}
      {club.status === "RETIRED" ? (
        <Callout tone="info" className="mb-6" title="This club is retired">
          Its history, roles and files are kept. Only an administrator can reinstate it.
        </Callout>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <WorkspaceNav links={links} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
