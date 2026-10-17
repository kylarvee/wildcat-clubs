import type { Metadata } from "next";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { audienceReach } from "@/lib/domain/announcements";
import { PageHeader } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { workspaceTitle } from "@/components/founding/workspaceTitle";
import { AnnouncementComposer } from "@/components/announcements/AnnouncementComposer";
import { createClubAnnouncementAction } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return workspaceTitle((await params).slug, "New announcement");
}

/** Write a club announcement, with a live preview and who it will notify. */
export default async function NewClubAnnouncementPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, club, access, allowed } = await loadClubWorkspace(slug, "announcements");
  if (!allowed) return <NoPermission what="announcements" suspended={access.suspended} />;
  const reach = await audienceReach(user, club.id);
  const base = `/clubs/${club.slug}/manage/announcements`;

  return (
    <div>
      <PageHeader
        title="New announcement"
        breadcrumbs={[{ href: base, label: "Announcements" }, { label: "New" }]}
        description="Embed an upcoming event, a file, a video or a document with Insert. Members get it in the app, by push and by email, following their settings."
      />
      <AnnouncementComposer
        mode="create"
        scope="club"
        clubId={club.id}
        clubName={club.name}
        reach={reach}
        author={{ name: user.name, handle: user.handle, avatarUrl: user.avatarUrl, avatarColor: user.avatarColor }}
        save={createClubAnnouncementAction.bind(null, club.id)}
        doneHref={base}
      />
    </div>
  );
}
