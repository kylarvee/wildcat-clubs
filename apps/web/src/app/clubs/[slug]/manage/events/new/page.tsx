import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { pausedNote } from "@/lib/authz";
import { loadEditorData } from "@/lib/events/queries";
import { defaultFundingSource } from "@/lib/funding/defaults";
import { PageHeader } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { EventEditor } from "@/components/events/EventEditor";

export const metadata: Metadata = { title: "New event" };

export default async function NewClubEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ start?: string; end?: string; allDay?: string; title?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { club, access, allowed } = await loadClubWorkspace(slug, "events");
  if (club.status !== "APPROVED") notFound();
  if (!allowed) return <NoPermission what="the Events Builder" suspended={access.suspended} note={pausedNote(access, "events")} />;
  const data = await loadEditorData(club.id, null);
  if (!data) notFound();
  const base = `/clubs/${club.slug}/manage/events`;

  return (
    <div className="space-y-6">
      <PageHeader title="New event" breadcrumbs={[{ href: base, label: "Events" }, { label: "New event" }]} />
      <PolicyNotices placement="EVENTS" />
      <EventEditor
        mode="club"
        club={{ id: club.id, slug: club.slug, name: club.name }}
        basePath={base}
        event={null}
        initial={{ start: sp.start, end: sp.end, allDay: sp.allDay === "1", title: sp.title?.slice(0, 140) }}
        buildings={data.buildings}
        clubs={data.clubs}
        terms={data.terms}
        googleLive={data.googleLive}
        defaultFundingSource={defaultFundingSource(club)}
        coverFolderId={data.coverFolderId}
        review={data.review}
      />
    </div>
  );
}
