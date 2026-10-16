import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import type { ClubDecisionAction } from "@prisma/client";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { can, ROLE_LABEL } from "@/lib/authz";
import { db } from "@/lib/db";
import { fmtLongDate } from "@/lib/time";
import { fileUrl } from "@/lib/domain/files";
import { foundingChecklist } from "@/lib/domain/clubs";
import { statedSettings } from "@/lib/domain/constitution";
import { Avatar, ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, KeyValue } from "@/components/ui/layout";
import { RichContent } from "@/components/rich/RichContent";
import { ReviewActions } from "@/components/founding/admin/ReviewActions";
import { AddDepartmentForm } from "@/components/founding/admin/AddDepartmentForm";
import { DocumentDecision } from "@/components/founding/admin/DocumentDecision";
import { ReinstateForm } from "@/components/founding/admin/ReinstateForm";
import { RetireClubDialog } from "@/components/founding/RetireClubDialog";
import { JOIN_LABEL, SCOPE_LABEL, STATUS_LABEL, STATUS_TONE, SUCCESSION_LABEL, TYPE_LABEL } from "@/components/founding/copy";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  // Metadata resolves before the admin layout's redirect, so only admins get the club's name.
  if (!can(await getCurrentUser(), "admin.clubs")) return { title: "Club review" };
  const club = await db.club.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: club ? `Review · ${club.name}` : "Club review" };
}

const DECISION_LABEL: Record<ClubDecisionAction, string> = {
  SUBMITTED: "Submitted for review",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REJECTED: "Not approved",
  RETIRED: "Retired",
  REINSTATED: "Reinstated",
  DEPARTMENT_ADDED: "Department added",
  DOCUMENT_APPROVED: "Custom document approved",
  DOCUMENT_REJECTED: "Custom document returned",
};
const DECISION_TONE: Partial<Record<ClubDecisionAction, "success" | "warning" | "danger" | "info">> = {
  APPROVED: "success", REINSTATED: "success", DOCUMENT_APPROVED: "success", DEPARTMENT_ADDED: "info", SUBMITTED: "info", CHANGES_REQUESTED: "warning", REJECTED: "danger", DOCUMENT_REJECTED: "danger", RETIRED: "danger",
};

export default async function AdminClubReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("/admin/clubs");
  if (!can(user, "admin.clubs")) notFound();
  const { id } = await params;
  const club = await db.club.findUnique({
    where: { id },
    include: {
      college: { select: { name: true } },
      department: { select: { name: true } },
      focusMajor: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });
  if (!club) notFound();

  const [check, documents, leaders, invites, decisions, colleges, members] = await Promise.all([
    foundingChecklist(club.id),
    db.clubDocument.findMany({ where: { clubId: club.id, status: { in: ["ACTIVE", "PENDING_APPROVAL"] } }, orderBy: [{ kind: "asc" }, { createdAt: "desc" }], include: { createdBy: { select: { name: true } } } }),
    db.roleAssignment.findMany({
      where: { clubId: club.id, endedAt: null, role: { not: "MEMBER" } },
      orderBy: [{ startedAt: "asc" }],
      select: { id: true, role: true, startedAt: true, position: { select: { name: true } }, user: { select: { name: true, email: true, avatarUrl: true, avatarColor: true } } },
    }),
    db.advisorInvite.findMany({ where: { clubId: club.id, status: "PENDING" }, select: { id: true, name: true, email: true, createdAt: true } }),
    db.clubDecision.findMany({ where: { clubId: club.id }, orderBy: { at: "desc" }, include: { by: { select: { name: true } } } }),
    db.college.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.membership.count({ where: { clubId: club.id, status: "ACTIVE" } }),
  ]);
  const pendingDocs = documents.filter((d) => d.status === "PENDING_APPROVAL" && d.kind !== "OTHER");
  const stated = await Promise.all(pendingDocs.map((d) => statedSettings(d.id)));
  const deptPending = Boolean(club.requestedDepartmentName && !club.departmentId);
  const rank = { ADVISOR: 0, PRESIDENT: 1, VP: 2, OFFICER: 3, AMBASSADOR: 4, MEMBER: 5 } as const;
  const sortedLeaders = [...leaders].sort((a, b) => rank[a.role] - rank[b.role]);

  const docBlocker = (kind: "CONSTITUTION" | "BYLAWS", label: string) =>
    documents.some((d) => d.kind === kind && d.status === "ACTIVE")
      ? null
      : pendingDocs.some((d) => d.kind === kind)
        ? `Approve or return the custom ${label} below — an approved club needs one in effect.`
        : `The club has no ${label} in effect. Request changes so the founders can adopt one.`;
  const approveBlockers = [
    deptPending ? `Add “${club.requestedDepartmentName}” to the department list (below).` : null,
    docBlocker("CONSTITUTION", "constitution"),
    docBlocker("BYLAWS", "bylaws"),
    !check.advisor.done ? "The club has no advisor. Request changes so the founders can invite one." : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <Link href="/admin/clubs" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Club reviews
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-ink">{club.name}</h1>
            <Badge tone={STATUS_TONE[club.status]}>{STATUS_LABEL[club.status]}</Badge>
          </div>
          <p className="text-sm text-ink-3">
            {TYPE_LABEL[club.type]} club · started by {club.createdBy.name} on {fmtLongDate(club.createdAt)}
            {club.submittedAt && club.status === "SUBMITTED" ? ` · submitted ${fmtLongDate(club.submittedAt)}` : ""}
          </p>
        </div>
        <Link href={`/clubs/${club.slug}/manage`} className={buttonClasses("outline", "sm")}>
          Open workspace <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      {club.status === "SUBMITTED" ? (
        <Card className="border-brand-200 ring-1 ring-brand-100">
          <CardHeader title="Your decision" description="The founders are notified right away, with your note." />
          <CardBody>
            <ReviewActions clubId={club.id} approveBlockers={approveBlockers} />
          </CardBody>
        </Card>
      ) : null}

      {deptPending ? (
        <Card>
          <CardHeader title="Department request" description={`The founders chose “Other” and typed “${club.requestedDepartmentName}”. Add it to the department list (or type an existing department's exact name to link it).`} />
          <CardBody>
            <AddDepartmentForm clubId={club.id} requested={club.requestedDepartmentName ?? ""} colleges={colleges} defaultCollegeId={club.collegeId} />
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Profile" description={check.profile.done ? "Complete" : `Missing: ${check.profile.gaps.join(", ")}`} action={<Badge tone={check.profile.done ? "success" : "warning"}>{check.profile.done ? "Complete" : "Incomplete"}</Badge>} />
            <CardBody className="space-y-4">
              <p className="text-ink">{club.shortDescription || <span className="text-ink-3">No short description.</span>}</p>
              <KeyValue
                items={[
                  { label: "Type", value: TYPE_LABEL[club.type] },
                  { label: "Where it sits", value: `${SCOPE_LABEL[club.scope]}${club.college ? ` · ${club.college.name}` : ""}` },
                  { label: "Department", value: club.department?.name ?? (club.requestedDepartmentName ? `Requested: ${club.requestedDepartmentName}` : "—") },
                  { label: "Focus", value: club.focusMajor?.name ?? club.focusOther ?? "—" },
                  { label: "Club Google account", value: club.contactEmail ?? "—" },
                  { label: "Members", value: members },
                  { label: "Joining", value: JOIN_LABEL[club.joinPolicy] },
                  { label: "Succession", value: SUCCESSION_LABEL[club.successionMethod] },
                ]}
              />
              {club.descriptionHtml ? (
                <div className="rounded-xl border border-line bg-canvas px-4 py-3">
                  <RichContent html={club.descriptionHtml} />
                </div>
              ) : (
                <p className="text-sm text-ink-3">No full description yet.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <div id="documents" className="scroll-mt-24" />
            <CardHeader title="Documents" description="Constitution and bylaws, plus anything else on the profile." />
            <CardBody className="space-y-4">
              {(["CONSTITUTION", "BYLAWS"] as const).map((kind) => {
                const active = documents.find((d) => d.kind === kind && d.status === "ACTIVE");
                const label = kind === "CONSTITUTION" ? "Constitution" : "Bylaws";
                return (
                  <div key={kind} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                    <FileText className="h-5 w-5 text-ink-3" aria-hidden />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block font-medium text-ink">{label}</span>
                      <span className="block text-ink-3">{active ? `v${active.version} · ${active.source === "BUILDER" ? "Constitution builder (pre-approved template)" : "Custom, approved"} · ${fmtLongDate(active.createdAt)}` : "None in effect"}</span>
                    </span>
                    {active ? <Badge tone="success">In effect</Badge> : <Badge tone="warning">Missing</Badge>}
                    {active?.fileId ? (
                      <a href={fileUrl(active.fileId)} target="_blank" rel="noopener noreferrer" className={buttonClasses("outline", "sm")}>
                        Open PDF
                      </a>
                    ) : null}
                  </div>
                );
              })}
              {pendingDocs.map((d, i) => {
                const label = d.kind === "CONSTITUTION" ? "constitution" : "bylaws";
                const s = stated[i];
                return (
                  <div key={d.id} className="space-y-3 rounded-xl border border-blue-200 bg-info-50/50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="info">Needs your approval</Badge>
                      <span className="text-sm font-medium text-ink">
                        Custom {label}: {d.title}
                      </span>
                      {d.fileId ? (
                        <a href={fileUrl(d.fileId)} target="_blank" rel="noopener noreferrer" className="ml-auto text-sm font-medium text-brand-600 hover:underline">
                          Open document
                        </a>
                      ) : null}
                    </div>
                    <p className="text-sm text-ink-2">
                      Uploaded by {d.createdBy.name} on {fmtLongDate(d.createdAt)}. On approval: leaders chosen by{" "}
                      <span className="font-medium">{s.successionMethod ? SUCCESSION_LABEL[s.successionMethod].split(" — ")[0].toLowerCase() : "(unchanged)"}</span>; joining is{" "}
                      <span className="font-medium">{s.joinPolicy ? JOIN_LABEL[s.joinPolicy].split(" — ")[0].toLowerCase() : "(unchanged)"}</span>.
                    </p>
                    {s.note ? <p className="whitespace-pre-line text-sm text-ink-2">“{s.note}”</p> : null}
                    <DocumentDecision docId={d.id} label={`Custom ${label}`} />
                  </div>
                );
              })}
              {documents.filter((d) => d.kind === "OTHER").length ? (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Other documents</p>
                  <ul className="space-y-1.5 text-sm">
                    {documents
                      .filter((d) => d.kind === "OTHER")
                      .map((d) => (
                        <li key={d.id}>
                          {d.fileId ? (
                            <a href={fileUrl(d.fileId)} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
                              {d.title}
                            </a>
                          ) : (
                            d.title
                          )}
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {club.status === "RETIRED" ? (
            <Card>
              <CardHeader title="Reinstate this club" description={club.retiredAt ? `Retired ${fmtLongDate(club.retiredAt)}${club.retiredReason ? ` — “${club.retiredReason}”` : ""}` : undefined} />
              <CardBody>
                <ReinstateForm clubId={club.id} approvedBefore={Boolean(club.approvedAt)} />
              </CardBody>
            </Card>
          ) : club.status !== "REJECTED" ? (
            <Card className="border-red-200">
              <CardHeader title={<span className="text-danger">Retire this club</span>} description="Ends every role, makes members alumni and cancels future events. History stays, and you can reinstate it later." />
              <CardBody>
                <RetireClubDialog clubId={club.id} clubName={club.name} memberCount={members} founding={club.status !== "APPROVED"} />
              </CardBody>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Advisor & founders" />
            <CardBody className="space-y-3">
              {sortedLeaders.length ? (
                <ul className="space-y-3">
                  {sortedLeaders.map((l) => (
                    <li key={l.id} className="flex items-center gap-3">
                      <Avatar name={l.user.name} src={l.user.avatarUrl} color={l.user.avatarColor} size="sm" />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block font-medium text-ink">{l.user.name}</span>
                        <a href={`mailto:${l.user.email}`} className="block truncate text-ink-3 hover:text-brand">
                          {l.user.email}
                        </a>
                      </span>
                      <Badge tone={l.role === "ADVISOR" ? "success" : "brand"}>{l.position?.name ?? ROLE_LABEL[l.role]}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-3">No one holds a role right now.</p>
              )}
              {invites.length ? (
                <div className="border-t border-line pt-3">
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-3">Advisor invitations pending</p>
                  <ul className="space-y-1 text-sm text-ink-2">
                    {invites.map((i) => (
                      <li key={i.id}>
                        {i.name} · {i.email} <span className="text-ink-3">({fmtLongDate(i.createdAt)})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {!check.advisor.done ? <Callout tone="warning">No advisor has accepted yet.</Callout> : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Decision trail" />
            <CardBody>
              {decisions.length ? (
                <ol className="relative space-y-4 border-l border-line pl-4">
                  {decisions.map((d) => (
                    <li key={d.id} className="text-sm">
                      <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-surface bg-line-2" aria-hidden />
                      <Badge tone={DECISION_TONE[d.action] ?? "neutral"}>{DECISION_LABEL[d.action]}</Badge>
                      <p className="mt-1 text-xs text-ink-3">
                        {d.by.name} · {fmtLongDate(d.at)}
                      </p>
                      {d.note ? <p className="mt-1 whitespace-pre-line text-ink-2">{d.note}</p> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-ink-3">No decisions yet — this club hasn&apos;t been submitted.</p>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
