import Link from "next/link";
import { Megaphone } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { clubAnnouncementsFor } from "@/lib/domain/announcements";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import { Expandable } from "@/components/announcements/Expandable";

/**
 * CONTRACT (owner: messaging & announcements builder). Server component: a
 * club's announcements the viewer may see (PUBLIC to everyone, MEMBERS to
 * members, LEADERS to leaders), pinned first, then newest, rendered with
 * RichContent. Shows `limit` and tucks the rest behind "See all". Leaders who
 * can post get a link to the Announcements tool. Renders nothing when the
 * viewer can't see any.
 */
export async function ClubAnnouncements({ clubId, limit = 3 }: { clubId: string; limit?: number }) {
  const viewer = await getCurrentUser();
  // Enough for "See all" on a club page without rendering a club's whole history (each body can hold live embeds).
  const { items, total, canPost } = await clubAnnouncementsFor(viewer, clubId, { take: Math.max(limit, 1) + 12 });
  if (!items.length) return null;
  const shown = items.slice(0, Math.max(1, limit));
  const rest = items.slice(shown.length);
  const slug = items[0].club?.slug;

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {shown.map((a) => (
          <li key={a.id}>
            <AnnouncementCard a={a} />
          </li>
        ))}
      </ul>
      {rest.length ? (
        <Expandable moreLabel={`See all ${total} announcements`} lessLabel="Show fewer">
          <ul className="space-y-3">
            {rest.map((a) => (
              <li key={a.id}>
                <AnnouncementCard a={a} />
              </li>
            ))}
          </ul>
          {total > items.length ? <p className="mt-3 text-xs text-ink-3">Showing the latest {items.length} of {total}.</p> : null}
        </Expandable>
      ) : null}
      {canPost && slug ? (
        <Link href={`/clubs/${slug}/manage/announcements`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
          <Megaphone className="h-4 w-4" aria-hidden="true" /> Post or manage announcements
        </Link>
      ) : null}
    </div>
  );
}
