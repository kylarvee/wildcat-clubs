import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { announcementForEdit } from "@/lib/domain/announcements";
import { fmtDate } from "@/lib/time";
import { PageHeader } from "@/components/ui/layout";
import { AnnouncementComposer } from "@/components/announcements/AnnouncementComposer";
import { updateUniversityAnnouncementAction } from "../actions";

export const metadata: Metadata = { title: "Edit university announcement" };

/** Edit a university announcement. Saving doesn't notify again unless the audience widens. */
export default async function EditUniversityAnnouncementPage({ params }: { params: Promise<{ announcementId: string }> }) {
  const { announcementId } = await params;
  const user = await requireUser(`/admin/announcements/${announcementId}`);
  if (!can(user, "admin.announce")) notFound();
  const a = await announcementForEdit(user, announcementId, null);
  if (!a) notFound();

  return (
    <div>
      <PageHeader
        title="Edit announcement"
        breadcrumbs={[{ href: "/admin/announcements", label: "University announcements" }, { label: a.title }]}
        description={`Posted by ${a.author.name} on ${fmtDate(a.createdAt, "MMMM d, yyyy")}.`}
      />
      <AnnouncementComposer
        mode="edit"
        scope="university"
        clubId={null}
        initial={{ title: a.title, bodyHtml: a.bodyHtml, audience: a.audience, pinned: a.pinned }}
        author={a.author}
        save={updateUniversityAnnouncementAction.bind(null, a.id)}
        doneHref="/admin/announcements"
      />
    </div>
  );
}
