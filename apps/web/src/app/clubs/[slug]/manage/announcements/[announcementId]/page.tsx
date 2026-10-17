import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { announcementForEdit } from "@/lib/domain/announcements";
import { fmtDate } from "@/lib/time";
import { PageHeader } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { workspaceTitle } from "@/components/founding/workspaceTitle";
import { AnnouncementComposer } from "@/components/announcements/AnnouncementComposer";
import { updateClubAnnouncementAction } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return workspaceTitle((await params).slug, "Edit announcement");
}

/** Edit one club announcement. Saving doesn't notify again unless the audience widens. */
export default async function EditClubAnnouncementPage({ params }: { params: Promise<{ slug: string; announcementId: string }> }) {
  const { slug, announcementId } = await params;
  const { user, club, access, allowed } = await loadClubWorkspace(slug, "announcements");
  if (!allowed) return <NoPermission what="announcements" suspended={access.suspended} />;
  const a = await announcementForEdit(user, announcementId, club.id);
  if (!a) notFound();
  const base = `/clubs/${club.slug}/manage/announcements`;

  return (
    <div>
      <PageHeader
        title="Edit announcement"
        breadcrumbs={[{ href: base, label: "Announcements" }, { label: a.title }]}
        description={`Posted by ${a.author.name} on ${fmtDate(a.createdAt, "MMMM d, yyyy")}.`}
      />
      <AnnouncementComposer
        mode="edit"
        scope="club"
        clubId={club.id}
        clubName={club.name}
        initial={{ title: a.title, bodyHtml: a.bodyHtml, audience: a.audience, pinned: a.pinned }}
        author={a.author}
        save={updateClubAnnouncementAction.bind(null, a.id)}
        doneHref={base}
      />
    </div>
  );
}
