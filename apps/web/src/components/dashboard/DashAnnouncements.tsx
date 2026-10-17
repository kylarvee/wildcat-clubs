import { Megaphone } from "lucide-react";
import { AnnouncementsFeed } from "@/components/announcements/AnnouncementsFeed";

/**
 * Announcements on the dashboard: WSUSA's university-wide posts plus posts
 * from your clubs (the messaging slice's feed). Notifications link here as
 * /dashboard#announcements, so the section carries that anchor.
 */
export function DashAnnouncements({ userId }: { userId: string }) {
  return (
    <section id="announcements" aria-labelledby="dash-announcements-title" className="scroll-mt-24">
      <h2 id="dash-announcements-title" className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
        <Megaphone className="h-4.5 w-4.5 text-brand" aria-hidden /> Announcements
      </h2>
      <AnnouncementsFeed userId={userId} limit={5} />
    </section>
  );
}
