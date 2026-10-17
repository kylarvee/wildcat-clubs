import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { managedAnnouncements } from "@/lib/domain/announcements";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { workspaceTitle } from "@/components/founding/workspaceTitle";
import { ManagedAnnouncementList } from "@/components/announcements/ManagedAnnouncementList";
import { deleteClubAnnouncementAction, setClubAnnouncementPinnedAction } from "./actions";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return workspaceTitle((await params).slug, "Announcements");
}

/** The club's Announcements tool: everything the club has posted, pinned first. Requires the "announcements" capability. */
export default async function ClubAnnouncementsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, club, access, allowed } = await loadClubWorkspace(slug, "announcements");
  if (!allowed) return <NoPermission what="announcements" suspended={access.suspended} />;
  const items = await managedAnnouncements(user, club.id);
  const base = `/clubs/${club.slug}/manage/announcements`;

  return (
    <div>
      <PageHeader
        title="Announcements"
        description={`Post news to ${club.name}'s members, its leaders, or everyone. Each announcement notifies the people it's for in the app, by push and by email (following their settings).`}
        actions={
          items.length ? (
            <ButtonLink href={`${base}/new`}>
              <Plus className="h-4 w-4" aria-hidden="true" /> New announcement
            </ButtonLink>
          ) : null
        }
      />
      <ManagedAnnouncementList
        items={items}
        scope="club"
        base={base}
        pinAction={setClubAnnouncementPinnedAction}
        deleteAction={deleteClubAnnouncementAction}
        viewHref={`/clubs/${club.slug}#announcements`}
      />
    </div>
  );
}
