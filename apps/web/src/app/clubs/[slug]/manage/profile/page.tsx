import type { Metadata } from "next";
import { db } from "@/lib/db";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { workspaceTitle } from "@/components/founding/workspaceTitle";
import { fileUrl } from "@/lib/domain/files";
import { fmtLongDate } from "@/lib/time";
import { PageHeader } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { ProfileForm } from "@/components/founding/ProfileForm";
import { ClubDocumentsCard, type ProfileDocRow } from "@/components/founding/ClubDocumentsCard";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return workspaceTitle((await params).slug, "Profile");
}

export default async function ClubProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club, access, allowed } = await loadClubWorkspace(slug, "profile");
  if (!allowed) return <NoPermission what="the club profile" suspended={access.suspended} />;

  const [departments, colleges, majors, docs] = await Promise.all([
    db.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, college: { select: { shortName: true } } } }),
    db.college.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.major.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, college: { select: { shortName: true } } } }),
    db.clubDocument.findMany({
      where: { clubId: club.id, OR: [{ status: "ACTIVE" }, { status: "PENDING_APPROVAL" }] },
      orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
      select: { id: true, kind: true, title: true, status: true, source: true, version: true, fileId: true, createdAt: true, file: { select: { visibility: true } }, createdBy: { select: { name: true } } },
    }),
  ]);

  const founding = club.status === "DRAFT" || club.status === "CHANGES_REQUESTED";
  const rows: ProfileDocRow[] = docs.map((d) => ({
    id: d.id,
    kind: d.kind,
    title: d.kind === "OTHER" ? d.title : `${d.kind === "CONSTITUTION" ? "Constitution" : "Bylaws"}${d.version > 0 ? ` (v${d.version})` : " (custom)"}`,
    statusLabel: d.status === "PENDING_APPROVAL" ? "Waiting for WSUSA" : d.kind === "OTHER" ? (d.file?.visibility === "MEMBERS" ? "Members only" : "Public") : "In effect",
    statusTone: d.status === "PENDING_APPROVAL" ? "info" : d.kind === "OTHER" ? "neutral" : "success",
    fileUrl: d.fileId ? fileUrl(d.fileId) : null,
    meta: `${d.source === "BUILDER" ? "Constitution builder" : `Uploaded by ${d.createdBy.name}`} · ${fmtLongDate(d.createdAt)}`,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Club profile"
        description={founding ? "WSUSA reviews this profile, so make it clear and complete. It goes public when your club is approved." : "This is your club's public face on the clubs list, your club page and the network map."}
      />
      <ProfileForm
        club={{
          id: club.id,
          name: club.name,
          type: club.type,
          shortDescription: club.shortDescription,
          descriptionHtml: club.descriptionHtml,
          scope: club.scope,
          collegeId: club.collegeId,
          departmentId: club.departmentId,
          requestedDepartmentName: club.requestedDepartmentName,
          focusMajorId: club.focusMajorId,
          focusOther: club.focusOther,
          logoUrl: club.logoUrl,
          logoColor: club.logoColor,
          contactEmail: club.contactEmail,
        }}
        departments={departments.map((d) => ({ value: d.id, label: d.name, hint: d.college?.shortName ?? null }))}
        colleges={colleges}
        majors={majors.map((m) => ({ value: m.id, label: m.name, hint: m.college?.shortName ?? null }))}
        canChangeType={founding || access.viaPlatform !== null}
        settingsHref={`/clubs/${club.slug}/manage/settings`}
      />
      <ClubDocumentsCard clubId={club.id} docs={rows} constitutionHref={access.capabilities.has("constitution") ? `/clubs/${club.slug}/manage/constitution` : null} />
    </div>
  );
}
