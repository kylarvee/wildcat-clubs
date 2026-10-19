import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ClubStatus, Prisma } from "@prisma/client";
import { Search } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { DAY_MS, fmtLongDate } from "@/lib/time";
import { fileUrl } from "@/lib/domain/files";
import { statedSettings } from "@/lib/domain/constitution";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/components/ui/cn";
import { AddDepartmentForm } from "@/components/founding/admin/AddDepartmentForm";
import { DocumentDecision } from "@/components/founding/admin/DocumentDecision";
import { RetireClubDialog } from "@/components/founding/RetireClubDialog";
import { StartAmbassadorProgram } from "@/components/founding/admin/StartAmbassadorProgram";
import { ChooseAdvisorDialog } from "@/components/ambassadors/ChooseAdvisorDialog";
import { SUCCESSION_LABEL } from "@/components/founding/copy";
import { AdminRenewals } from "@/components/renewals/AdminRenewals";
import { CLUB_STATUS_LABEL as STATUS_LABEL, CLUB_STATUS_TONE as STATUS_TONE, CLUB_TYPE_LABEL as TYPE_LABEL, JOIN_POLICY_LABEL as JOIN_LABEL } from "@/lib/labels/clubs";

export const metadata: Metadata = { title: "Club approvals" };

const TABS = [
  { key: "submissions", label: "Submissions" },
  { key: "departments", label: "Department requests" },
  { key: "documents", label: "Custom documents" },
  { key: "renewals", label: "Renewals" },
  { key: "ambassadors", label: "Ambassador programs" },
  { key: "all", label: "All clubs" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const STATUSES: ClubStatus[] = ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED", "REJECTED", "RETIRED"];
const LIVE: Prisma.ClubWhereInput = { status: { notIn: ["RETIRED", "REJECTED"] } };

export default async function AdminClubsPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; q?: string; show?: string }> }) {
  const user = await requireUser("/admin/clubs");
  if (!can(user, "admin.clubs")) notFound();
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "submissions";

  const deptWhere: Prisma.ClubWhereInput = { ...LIVE, requestedDepartmentName: { not: null }, departmentId: null };
  const [subCount, deptCount, docCount] = await Promise.all([
    db.club.count({ where: { status: "SUBMITTED" } }),
    db.club.count({ where: deptWhere }),
    db.clubDocument.count({ where: { status: "PENDING_APPROVAL", club: LIVE } }),
  ]);
  const counts: Partial<Record<TabKey, number>> = { submissions: subCount, departments: deptCount, documents: docCount };

  return (
    <div>
      <PageHeader title="Club approvals" description="New clubs waiting for WSUSA recognition, department requests, custom constitutions, yearly renewals, and every club's status." />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Approval queues">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "submissions" ? "/admin/clubs" : `/admin/clubs?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", tab === t.key ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink")}
          >
            {t.label}
            {counts[t.key] ? <span className="rounded-full bg-brand-50 px-1.5 text-xs text-brand">{counts[t.key]}</span> : null}
          </Link>
        ))}
      </nav>
      {tab === "submissions" ? (
        <Submissions />
      ) : tab === "departments" ? (
        <DepartmentRequests where={deptWhere} />
      ) : tab === "documents" ? (
        <CustomDocuments />
      ) : tab === "renewals" ? (
        <AdminRenewals actor={user} show={sp.show} />
      ) : tab === "ambassadors" ? (
        <AmbassadorPrograms />
      ) : (
        <AllClubs status={sp.status} q={sp.q} />
      )}
    </div>
  );
}

async function Submissions() {
  const clubs = await db.club.findMany({
    where: { status: "SUBMITTED" },
    orderBy: { submittedAt: "asc" },
    select: {
      id: true, name: true, type: true, logoUrl: true, logoColor: true, submittedAt: true, requestedDepartmentName: true, departmentId: true,
      roleAssignments: { where: { endedAt: null, role: { in: ["PRESIDENT", "ADVISOR"] } }, select: { role: true, user: { select: { name: true } } } },
      documents: { where: { status: "PENDING_APPROVAL" }, select: { id: true } },
      decisions: { where: { action: "CHANGES_REQUESTED" }, select: { id: true } },
    },
  });
  if (!clubs.length) return <EmptyState title="No clubs in WSUSA review" description="New submissions show up here, oldest first." />;
  return (
    <Table>
      <THead>
        <tr>
          <TH>Club</TH>
          <TH>Founders</TH>
          <TH>Advisor</TH>
          <TH>Waiting</TH>
          <TH>
            <span className="sr-only">Review</span>
          </TH>
        </tr>
      </THead>
      <TBody>
        {clubs.map((c) => {
          const days = c.submittedAt ? Math.floor((Date.now() - c.submittedAt.getTime()) / DAY_MS) : 0;
          return (
            <TR key={c.id}>
              <TD>
                <div className="flex items-center gap-3">
                  <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" />
                  <div className="min-w-0">
                    <p className="font-medium">{c.name}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <Badge>{TYPE_LABEL[c.type]}</Badge>
                      {c.decisions.length ? <Badge tone="warning">Resubmission</Badge> : null}
                      {c.requestedDepartmentName && !c.departmentId ? <Badge tone="info">New department</Badge> : null}
                      {c.documents.length ? <Badge tone="info">Custom documents</Badge> : null}
                    </div>
                  </div>
                </div>
              </TD>
              <TD className="text-ink-2">{c.roleAssignments.filter((r) => r.role === "PRESIDENT").map((r) => r.user.name).join(", ") || "—"}</TD>
              <TD className="text-ink-2">{c.roleAssignments.filter((r) => r.role === "ADVISOR").map((r) => r.user.name).join(", ") || <span className="text-danger">None</span>}</TD>
              <TD className="whitespace-nowrap">
                <span className={cn(days >= 10 ? "font-medium text-warning" : "text-ink-2")}>{days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}</span>
                {c.submittedAt ? <span className="block text-xs text-ink-3">{fmtLongDate(c.submittedAt)}</span> : null}
              </TD>
              <TD className="text-right">
                <Link href={`/admin/clubs/${c.id}`} className={buttonClasses("primary", "sm")}>
                  Review
                </Link>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

async function DepartmentRequests({ where }: { where: Prisma.ClubWhereInput }) {
  const [clubs, colleges] = await Promise.all([
    db.club.findMany({ where, orderBy: { createdAt: "asc" }, select: { id: true, name: true, status: true, collegeId: true, requestedDepartmentName: true, logoUrl: true, logoColor: true } }),
    db.college.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!clubs.length) return <EmptyState title="No department requests" description="When a founder picks “Other” for their department, it shows up here so you can add it to the list." />;
  return (
    <ul className="space-y-3">
      {clubs.map((c) => (
        <li key={c.id}>
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" />
              <div className="min-w-0 flex-1">
                <Link href={`/admin/clubs/${c.id}`} className="font-medium text-ink hover:underline">
                  {c.name}
                </Link>
                <p className="text-sm text-ink-3">
                  Asked for “<span className="font-medium text-ink-2">{c.requestedDepartmentName}</span>”
                </p>
              </div>
              <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
            </div>
            <AddDepartmentForm clubId={c.id} requested={c.requestedDepartmentName ?? ""} colleges={colleges} defaultCollegeId={c.collegeId} compact />
          </Card>
        </li>
      ))}
    </ul>
  );
}

async function CustomDocuments() {
  const docs = await db.clubDocument.findMany({
    where: { status: "PENDING_APPROVAL", club: LIVE },
    orderBy: { createdAt: "asc" },
    include: { club: { select: { id: true, name: true, status: true, logoUrl: true, logoColor: true, joinPolicy: true, successionMethod: true } }, createdBy: { select: { name: true } } },
  });
  if (!docs.length) return <EmptyState title="No custom documents waiting" description="Clubs that upload their own constitution or bylaws land here for approval." />;
  const stated = await Promise.all(docs.map((d) => statedSettings(d.id)));
  return (
    <ul className="space-y-3">
      {docs.map((d, i) => {
        const label = d.kind === "CONSTITUTION" ? "Constitution" : "Bylaws";
        const s = stated[i];
        return (
          <li key={d.id}>
            <Card className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <ClubLogo name={d.club.name} src={d.club.logoUrl} color={d.club.logoColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    <Link href={`/admin/clubs/${d.club.id}#documents`} className="hover:underline">
                      {d.club.name}
                    </Link>{" "}
                    · custom {label.toLowerCase()}
                  </p>
                  <p className="text-sm text-ink-3">
                    {d.title} · uploaded by {d.createdBy.name} on {fmtLongDate(d.createdAt)}
                  </p>
                </div>
                {d.fileId ? (
                  <a href={fileUrl(d.fileId)} target="_blank" rel="noopener noreferrer" className={buttonClasses("outline", "sm")}>
                    Open document
                  </a>
                ) : null}
              </div>
              <dl className="grid gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm sm:grid-cols-2">
                {/* Each kind of document states only what it governs: bylaws the succession method, a constitution the join policy. */}
                {s.governs === "successionMethod" ? (
                  <div>
                    <dt className="text-xs text-ink-3">Primary way leaders are chosen</dt>
                    <dd className="text-ink">{s.successionMethod ? SUCCESSION_LABEL[s.successionMethod] : "Not stated"}{s.successionMethod && s.successionMethod !== d.club.successionMethod ? " (a change)" : ""}</dd>
                  </div>
                ) : (
                  <div>
                    <dt className="text-xs text-ink-3">Students join by</dt>
                    <dd className="text-ink">{s.joinPolicy ? JOIN_LABEL[s.joinPolicy] : "Not stated"}{s.joinPolicy && s.joinPolicy !== d.club.joinPolicy ? " (a change)" : ""}</dd>
                  </div>
                )}
                {s.note ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-ink-3">Note from the club</dt>
                    <dd className="whitespace-pre-line text-ink">{s.note}</dd>
                  </div>
                ) : null}
              </dl>
              <DocumentDecision docId={d.id} label={`${d.club.name}'s ${label.toLowerCase()}`} />
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

async function AllClubs({ status, q }: { status?: string; q?: string }) {
  const filter = STATUSES.includes(status as ClubStatus) ? (status as ClubStatus) : null;
  const query = q?.trim().slice(0, 100) ?? "";
  const clubs = await db.club.findMany({
    where: { ...(filter ? { status: filter } : {}), ...(query ? { name: { contains: query, mode: "insensitive" } } : {}) },
    orderBy: { name: "asc" },
    take: 300,
    select: {
      id: true, name: true, slug: true, type: true, status: true, logoUrl: true, logoColor: true, createdAt: true, approvedAt: true, retiredAt: true,
      _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
    },
  });
  const href = (s: string | null) => `/admin/clubs?tab=all${s ? `&status=${s}` : ""}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" aria-label="Filter by status">
          {[null, ...STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={href(s)}
              aria-current={filter === s ? "true" : undefined}
              className={cn("rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset", filter === s ? "bg-brand text-white ring-brand" : "bg-surface text-ink-2 ring-line-2 hover:bg-muted")}
            >
              {s ? STATUS_LABEL[s] : "All"}
            </Link>
          ))}
        </div>
        <form action="/admin/clubs" className="relative w-full sm:w-64" role="search">
          <input type="hidden" name="tab" value="all" />
          {filter ? <input type="hidden" name="status" value={filter} /> : null}
          <label htmlFor="club-search" className="sr-only">
            Search clubs
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input id="club-search" name="q" defaultValue={query} placeholder="Search clubs…" className="h-9 w-full rounded-lg border border-line-2 bg-surface pl-9 pr-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100" />
        </form>
      </div>
      {clubs.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Club</TH>
              <TH>Status</TH>
              <TH className="hidden md:table-cell">Members</TH>
              <TH className="hidden md:table-cell">Since</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {clubs.map((c) => (
              <TR key={c.id}>
                <TD>
                  <div className="flex items-center gap-3">
                    <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" />
                    <div className="min-w-0">
                      <Link href={`/admin/clubs/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-ink-3">{TYPE_LABEL[c.type]}</p>
                    </div>
                  </div>
                </TD>
                <TD>
                  <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                </TD>
                <TD className="hidden tabular-nums md:table-cell">{c._count.memberships}</TD>
                <TD className="hidden whitespace-nowrap text-ink-2 md:table-cell">{fmtLongDate(c.retiredAt ?? c.approvedAt ?? c.createdAt)}</TD>
                <TD>
                  <div className="flex justify-end gap-2">
                    {c.status !== "RETIRED" && c.status !== "REJECTED" ? <RetireClubDialog clubId={c.id} clubName={c.name} memberCount={c._count.memberships} founding={c.status !== "APPROVED"} size="sm" /> : null}
                    <Link href={`/admin/clubs/${c.id}`} className={buttonClasses("outline", "sm")}>
                      {c.status === "RETIRED" ? "Reinstate…" : "Open"}
                    </Link>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState title="No clubs match" description={query ? `Nothing matches “${query}”${filter ? ` in ${STATUS_LABEL[filter]}` : ""}.` : "No clubs with this status."} />
      )}
    </div>
  );
}

/** One College Ambassadors org per college (ARCHITECTURE §6): start them and choose their advisors here, run them in their workspace. */
async function AmbassadorPrograms() {
  const [colleges, staff] = await Promise.all([
    db.college.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        shortName: true,
        clubs: {
          where: { type: "COLLEGE_AMBASSADORS", status: { not: "RETIRED" } },
          select: {
            id: true,
            slug: true,
            name: true,
            logoUrl: true,
            logoColor: true,
            roleAssignments: { where: { endedAt: null, role: { in: ["PRESIDENT", "ADVISOR"] } }, orderBy: { startedAt: "asc" }, select: { role: true, user: { select: { name: true } } } },
            ambassadorPlacements: { where: { endedAt: null }, select: { id: true } },
            _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
          },
        },
      },
    }),
    db.user.findMany({
      where: { kind: "FACULTY_STAFF", status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, handle: true, avatarUrl: true, avatarColor: true, jobTitle: true, department: { select: { name: true, collegeId: true } } },
    }),
  ]);
  /** Faculty and staff for one college's picker: its own people first, each with their title and department. */
  const peopleFor = (collegeId: string) =>
    [...staff]
      .sort((a, b) => Number(b.department?.collegeId === collegeId) - Number(a.department?.collegeId === collegeId))
      .map((s) => ({
        id: s.id,
        name: s.name,
        handle: s.handle,
        avatarUrl: s.avatarUrl,
        avatarColor: s.avatarColor,
        note: [s.jobTitle, s.department?.name].filter(Boolean).join(" · ") || undefined,
      }));
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-ink-2">
        A college ambassador program is an optional, student-led org for one college. It handles marketing and college-wide events, and places a Club
        Representative Ambassador in each of the college&apos;s clubs to carry news and needs both ways.
      </p>
      <Table>
        <THead>
          <tr>
            <TH>College</TH>
            <TH>Program</TH>
            <TH>Advisor</TH>
            <TH>President</TH>
            <TH>Members</TH>
            <TH>Clubs with an ambassador</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {colleges.map((c) => {
            const org = c.clubs[0];
            const president = org?.roleAssignments.find((r) => r.role === "PRESIDENT")?.user.name;
            const advisor = org?.roleAssignments.find((r) => r.role === "ADVISOR")?.user.name ?? null;
            return (
              <TR key={c.id}>
                <TD className="font-medium">{c.name}</TD>
                <TD>
                  {org ? (
                    <div className="flex items-center gap-2">
                      <ClubLogo name={org.name} src={org.logoUrl} color={org.logoColor} size="sm" />
                      <span>{org.name}</span>
                    </div>
                  ) : (
                    <span className="text-ink-3">No program yet</span>
                  )}
                </TD>
                <TD>
                  {org ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {advisor ?? <Badge tone="warning">None yet</Badge>}
                      <ChooseAdvisorDialog orgId={org.id} orgName={org.name} collegeName={c.name} currentName={advisor} people={peopleFor(c.id)} />
                    </div>
                  ) : (
                    "—"
                  )}
                </TD>
                <TD>{org ? (president ?? <Badge tone="warning">Vacant</Badge>) : "—"}</TD>
                <TD className="tabular-nums">{org ? org._count.memberships : "—"}</TD>
                <TD className="tabular-nums">{org ? org.ambassadorPlacements.length : "—"}</TD>
                <TD className="text-right">
                  {org ? (
                    <Link href={`/clubs/${org.slug}/manage`} className={buttonClasses("outline", "sm")}>
                      Open workspace
                    </Link>
                  ) : (
                    <StartAmbassadorProgram collegeId={c.id} collegeName={c.shortName} />
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
