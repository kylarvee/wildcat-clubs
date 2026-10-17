import { Megaphone } from "lucide-react";
import { announcementFeed } from "@/lib/domain/announcements";
import { INSTITUTION } from "@/lib/institution";
import { cn } from "@/components/ui/cn";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";

/**
 * Server component for the dashboard (and the landing page, signed out):
 * university-wide announcements for this person's audiences plus
 * announcements from their active clubs that they may see, newest first
 * (pinned university posts on top), each labelled with its club's logo or
 * WSUSA. Pass userId null for public university announcements only.
 * The host page supplies the heading and an id="announcements" anchor
 * (notifications link to /dashboard#announcements).
 */
export async function AnnouncementsFeed({
  userId,
  limit = 5,
  hideWhenEmpty = false,
  className,
}: {
  userId: string | null;
  limit?: number;
  /** Render nothing instead of the empty message (e.g. on the landing page). */
  hideWhenEmpty?: boolean;
  className?: string;
}) {
  const items = await announcementFeed(userId, limit);
  if (!items.length) {
    if (hideWhenEmpty) return null;
    return (
      <div className={cn("flex items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface px-5 py-6 text-sm text-ink-3", className)}>
        <Megaphone className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>No announcements right now. News from your clubs and from {INSTITUTION.studentGovernment} shows up here.</span>
      </div>
    );
  }
  return (
    <ul className={cn("space-y-3", className)}>
      {items.map((a) => (
        <li key={a.id}>
          <AnnouncementCard a={a} showSource collapseOver={320} />
        </li>
      ))}
    </ul>
  );
}
