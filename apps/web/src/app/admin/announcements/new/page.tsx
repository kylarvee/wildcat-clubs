import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { audienceReach } from "@/lib/domain/announcements";
import { PageHeader } from "@/components/ui/layout";
import { AnnouncementComposer } from "@/components/announcements/AnnouncementComposer";
import { createUniversityAnnouncementAction } from "../actions";

export const metadata: Metadata = { title: "New university announcement" };

/** Write a university-wide announcement with a live preview and its reach. */
export default async function NewUniversityAnnouncementPage() {
  const user = await requireUser("/admin/announcements/new");
  if (!can(user, "admin.announce")) notFound();
  const reach = await audienceReach(user, null);

  return (
    <div>
      <PageHeader
        title="New university announcement"
        breadcrumbs={[{ href: "/admin/announcements", label: "University announcements" }, { label: "New" }]}
        description="Embed events, files, videos or documents with Insert. Everyone sees it in their notifications right away; for large audiences, emails and phone alerts go out in batches over the next hour or so."
      />
      <AnnouncementComposer
        mode="create"
        scope="university"
        clubId={null}
        reach={reach}
        author={{ name: user.name, handle: user.handle, avatarUrl: user.avatarUrl, avatarColor: user.avatarColor }}
        save={createUniversityAnnouncementAction}
        doneHref="/admin/announcements"
      />
    </div>
  );
}
