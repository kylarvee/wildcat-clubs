import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { loadEditorData } from "@/lib/events/queries";
import { defaultFundingSource } from "@/lib/funding/defaults";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { EventEditor } from "@/components/events/EventEditor";

export const metadata: Metadata = { title: "Edit event" };

export default async function EditClubEventPage({ params }: { params: Promise<{ slug: string; eventId: string }> }) {
  const { slug, eventId } = await params;
  const { club, access, allowed } = await loadClubWorkspace(slug, "events");
  if (club.status !== "APPROVED") notFound();
  if (!allowed) return <NoPermission what="the Events Builder" suspended={access.suspended} />;
  const data = await loadEditorData(club.id, eventId);
  if (!data?.event) notFound();
  const base = `/clubs/${club.slug}/manage/events`;
  const e = data.event;

  return (
    <div className="space-y-6">
      <PageHeader
        title={e.status === "DRAFT" ? "Schedule an idea" : "Edit event"}
        description={e.title}
        breadcrumbs={[{ href: base, label: "Events" }, { label: e.title }]}
        actions={
          <>
            {e.status === "CANCELLED" ? <Badge tone="danger">Cancelled</Badge> : null}
            {e.status !== "DRAFT" ? (
              <ButtonLink variant="outline" href={`/events/${e.id}`}>
                <ExternalLink className="h-4 w-4" /> Event page
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <PolicyNotices placement="EVENTS" />
      <EventEditor
        mode="club"
        club={{ id: club.id, slug: club.slug, name: club.name }}
        basePath={base}
        event={e}
        buildings={data.buildings}
        clubs={data.clubs}
        terms={data.terms}
        googleLive={data.googleLive}
        defaultFundingSource={defaultFundingSource(club)}
      />
    </div>
  );
}
