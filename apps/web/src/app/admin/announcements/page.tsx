import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { managedAnnouncements } from "@/lib/domain/announcements";
import { INSTITUTION } from "@/lib/institution";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { ManagedAnnouncementList } from "@/components/announcements/ManagedAnnouncementList";
import { deleteUniversityAnnouncementAction, setUniversityAnnouncementPinnedAction } from "./actions";

export const metadata: Metadata = { title: "University announcements" };

/** University-wide announcements from WSUSA (admin.announce): to everyone, every signed-in account, or every club leader. */
export default async function AdminAnnouncementsPage() {
  const user = await requireUser("/admin/announcements");
  if (!can(user, "admin.announce")) notFound();
  const items = await managedAnnouncements(user, null);

  return (
    <div>
      <PageHeader
        title="University announcements"
        description={`News from ${INSTITUTION.studentGovernment} for everyone at ${INSTITUTION.shortName}, every signed-in student and staff member, or every club leader. Announcements show on dashboards (public ones on the landing page too) and notify their audience.`}
        actions={
          items.length ? (
            <ButtonLink href="/admin/announcements/new">
              <Plus className="h-4 w-4" aria-hidden="true" /> New announcement
            </ButtonLink>
          ) : null
        }
      />
      <ManagedAnnouncementList
        items={items}
        scope="university"
        base="/admin/announcements"
        pinAction={setUniversityAnnouncementPinnedAction}
        deleteAction={deleteUniversityAnnouncementAction}
      />
    </div>
  );
}
