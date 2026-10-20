import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { loadEditorData } from "@/lib/events/queries";
import { PageHeader } from "@/components/ui/layout";
import { EventEditor } from "@/components/events/EventEditor";

export const metadata: Metadata = { title: "New university event" };

export default async function NewTrainingPage({ searchParams }: { searchParams: Promise<{ start?: string; end?: string; allDay?: string; title?: string }> }) {
  const user = await requireUser("/admin/trainings/new");
  if (!can(user, "admin.trainings")) notFound();
  const sp = await searchParams;
  const data = await loadEditorData(null, null);
  if (!data) notFound();
  return (
    <div className="space-y-6">
      <PageHeader title="New university event" description="Officer trainings and campus-wide events." breadcrumbs={[{ href: "/admin/trainings", label: "Trainings & events" }, { label: "New" }]} />
      <EventEditor
        mode="university"
        club={null}
        basePath="/admin/trainings"
        event={null}
        initial={{ start: sp.start, end: sp.end, allDay: sp.allDay === "1", title: sp.title?.slice(0, 140) }}
        buildings={data.buildings}
        clubs={[]}
        terms={data.terms}
        googleLive={data.googleLive}
        defaultFundingSource="UNIVERSITY"
        coverFolderId={data.coverFolderId}
      />
    </div>
  );
}
