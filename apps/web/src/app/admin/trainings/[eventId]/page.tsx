import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { loadEditorData } from "@/lib/events/queries";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { EventEditor } from "@/components/events/EventEditor";

export const metadata: Metadata = { title: "Edit university event" };

export default async function EditTrainingPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await requireUser(`/admin/trainings/${eventId}`);
  if (!can(user, "admin.trainings")) notFound();
  const data = await loadEditorData(null, eventId);
  if (!data?.event) notFound();
  const e = data.event;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit university event"
        description={e.title}
        breadcrumbs={[{ href: "/admin/trainings", label: "Trainings & events" }, { label: e.title }]}
        actions={
          <>
            {e.requirementName ? <Badge tone="warning">Required: {e.requirementName}</Badge> : null}
            {e.status === "CANCELLED" ? <Badge tone="danger">Cancelled</Badge> : null}
            <ButtonLink variant="outline" href={`/events/${e.id}`}>
              <ExternalLink className="h-4 w-4" /> Event page
            </ButtonLink>
          </>
        }
      />
      <EventEditor
        mode="university"
        club={null}
        basePath="/admin/trainings"
        event={e}
        buildings={data.buildings}
        clubs={[]}
        terms={data.terms}
        googleLive={data.googleLive}
        defaultFundingSource="UNIVERSITY"
      />
    </div>
  );
}
