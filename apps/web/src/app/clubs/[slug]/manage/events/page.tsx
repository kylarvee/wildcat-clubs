import type { Metadata } from "next";
import { RefreshCw } from "lucide-react";
import { loadClubWorkspace } from "@/lib/clubs/context";
import { loadBuilderData } from "@/lib/events/queries";

import { Badge } from "@/components/ui/badge";
import { Callout, PageHeader } from "@/components/ui/layout";
import { NoPermission } from "@/components/workspace/NoPermission";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { EventsBuilder } from "@/components/events/EventsBuilder";

export const metadata: Metadata = { title: "Events Builder" };

export default async function ClubEventsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ date?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { club, access, allowed } = await loadClubWorkspace(slug, "events");
  const base = `/clubs/${club.slug}/manage/events`;

  if (club.status !== "APPROVED") {
    return (
      <>
        <PageHeader title="Events" />
        <Callout tone="info" title="Events open once WSUSA approves the club">
          While the club is being founded you can work on the profile, org chart, constitution and files. The Events Builder unlocks as soon as it&apos;s approved.
        </Callout>
      </>
    );
  }
  if (!allowed) return <NoPermission what="the Events Builder" suspended={access.suspended} />;

  const data = await loadBuilderData(club.id);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        description="Plan meetings and events, and co-host with other clubs. Everything here shows on your club page, member calendars and the Budget tool."
        actions={
          data.googleLive ? (
            <Badge tone="success">
              <RefreshCw className="h-3 w-3" /> Syncing to Google Calendar
            </Badge>
          ) : null
        }
      />
      <PolicyNotices placement="EVENTS" />
      <EventsBuilder
        mode="club"
        club={{ id: club.id, slug: club.slug, name: club.name }}
        basePath={base}
        incoming={data.incoming}
        outgoing={data.outgoing}
        buildings={data.buildings}
        terms={data.terms}
        googleLive={data.googleLive}
        initialDate={date}
      />
    </div>
  );
}
