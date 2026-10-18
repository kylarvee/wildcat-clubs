import "server-only";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import type { AnnouncementView } from "@/lib/domain/announcements";
import { RichContent } from "@/components/rich/RichContent";
import { AnnouncementFrame } from "@/components/announcements/AnnouncementFrame";
import { ClampedBody } from "@/components/announcements/ClampedBody";
import { AUDIENCE_BADGE } from "@/components/announcements/labels";

/**
 * A published announcement: frame + rich body (live embeds, permission-checked).
 * Long ones are held to a few lines with "Show more" to open them in place.
 */
export async function AnnouncementCard({
  a,
  showSource = false,
  clampLines = 6,
  headingLevel,
  allBadges = false,
  footer,
}: {
  a: AnnouncementView;
  /** Show the club (or WSUSA) it came from, for mixed feeds. */
  showSource?: boolean;
  /** Hold the body to this many lines until "Show more" (0 = never). */
  clampLines?: number;
  headingLevel?: "h2" | "h3";
  /** Label every audience (manager views). Otherwise only restricted ones get a badge: members- or leaders-only club posts, leaders-only university posts. */
  allBadges?: boolean;
  /** Under the body, e.g. an Edit link for managers. */
  footer?: ReactNode;
}) {
  const scope = a.clubId ? "club" : "university";
  const restricted = scope === "club" ? a.audience !== "PUBLIC" : a.audience === "LEADERS";
  const badge = allBadges || restricted ? AUDIENCE_BADGE[scope][a.audience] : null;
  // Profiles are for signed-in Weber State accounts, so visitors see the author's name without a profile link.
  const viewer = await getCurrentUser();
  const author = viewer ? a.author : { ...a.author, handle: null };
  const body = <RichContent html={a.bodyHtml} />;
  return (
    <AnnouncementFrame
      title={a.title}
      author={author}
      createdAt={a.createdAt}
      edited={a.edited}
      pinned={a.pinned}
      badge={badge}
      club={showSource ? a.club : null}
      university={showSource && !a.clubId}
      headingLevel={headingLevel}
      footer={footer}
    >
      {clampLines > 0 ? <ClampedBody lines={clampLines}>{body}</ClampedBody> : body}
    </AnnouncementFrame>
  );
}
