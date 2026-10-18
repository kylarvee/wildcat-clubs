import Link from "next/link";
import { Megaphone } from "lucide-react";
import { announcementFeed } from "@/lib/domain/announcements";
import { INSTITUTION } from "@/lib/institution";
import { cn } from "@/components/ui/cn";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import { FeedFilter, type FeedSource } from "@/components/announcements/FeedFilter";

/**
 * Server component for the dashboard (and the landing page, signed out):
 * university-wide announcements for this person's audiences plus
 * announcements from their active clubs that they may see, newest first
 * (pinned university posts on top), each labelled with its club's logo or
 * WSUSA and held to three lines until "Show more". Pass userId null for
 * public university announcements only. `filterable` adds source chips
 * (All · WSUSA · each club); `moreHref` links to a longer list when this
 * one is full. The host page supplies the heading and an id="announcements"
 * anchor (notifications link to /dashboard#announcements).
 */
export async function AnnouncementsFeed({
  userId,
  limit = 5,
  hideWhenEmpty = false,
  filterable = false,
  moreHref,
  className,
}: {
  userId: string | null;
  limit?: number;
  /** Render nothing instead of the empty message (e.g. on the landing page). */
  hideWhenEmpty?: boolean;
  filterable?: boolean;
  moreHref?: string;
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
  const sourceOf = (a: (typeof items)[number]) => a.club?.slug ?? "wsusa";
  const sources: FeedSource[] = [];
  for (const a of items) {
    const key = sourceOf(a);
    if (!sources.some((s) => s.key === key)) sources.push({ key, label: a.club?.name ?? INSTITUTION.studentGovernment });
  }
  // WSUSA first, then clubs in the order their newest post appears.
  sources.sort((a, b) => Number(b.key === "wsusa") - Number(a.key === "wsusa"));
  const cards = items.map((a) => ({ id: a.id, source: sourceOf(a), node: <AnnouncementCard a={a} showSource clampLines={3} /> }));
  return (
    <div className={className}>
      {filterable ? (
        <FeedFilter sources={sources} items={cards} />
      ) : (
        <ul className="space-y-3">
          {cards.map((c) => (
            <li key={c.id}>{c.node}</li>
          ))}
        </ul>
      )}
      {moreHref && items.length >= limit ? (
        <div className="mt-4 text-center">
          <Link href={moreHref} className="inline-flex h-10 items-center rounded-lg border border-line-2 bg-surface px-4 text-sm font-medium text-ink hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand">
            Show older announcements
          </Link>
        </div>
      ) : null}
    </div>
  );
}
