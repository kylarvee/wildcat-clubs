import { Megaphone } from "lucide-react";
import { INSTITUTION } from "@/lib/institution";
import { AnnouncementsFeed } from "@/components/announcements/AnnouncementsFeed";

const SHORT = 10;
const LONG = 40;

/**
 * Announcements on the dashboard — the one place to read WSUSA's posts and
 * your clubs' posts together, so they get the middle of the page. Source
 * chips filter it; "Show older" reloads with a longer list. Notifications
 * link here as /dashboard#announcements, so the section carries that anchor.
 */
export function DashAnnouncements({ userId, older = false }: { userId: string; older?: boolean }) {
  return (
    <section id="announcements" aria-labelledby="dash-announcements-title" className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="dash-announcements-title" className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-ink">
          <Megaphone className="h-5 w-5 text-brand" aria-hidden /> Announcements
        </h2>
        <p className="text-sm text-ink-3">From {INSTITUTION.studentGovernment} and your clubs, newest first</p>
      </div>
      <AnnouncementsFeed userId={userId} limit={older ? LONG : SHORT} filterable moreHref={older ? undefined : "/dashboard?announcements=older#announcements"} />
    </section>
  );
}
