import "server-only";
import { getCurrentUser } from "@/lib/auth/session";
import type { AnnouncementView } from "@/lib/domain/announcements";
import { richToText } from "@/lib/rich/sanitize";
import { RichContent } from "@/components/rich/RichContent";
import { AnnouncementFrame } from "@/components/announcements/AnnouncementFrame";
import { Expandable } from "@/components/announcements/Expandable";
import { AUDIENCE_BADGE } from "@/components/announcements/labels";

/**
 * A published announcement: frame + rich body (live embeds, permission-checked).
 * Long ones start as a short excerpt with "Read more".
 */
export async function AnnouncementCard({
  a,
  showSource = false,
  collapseOver = 600,
  headingLevel,
  allBadges = false,
}: {
  a: AnnouncementView;
  /** Show the club (or WSUSA) it came from, for mixed feeds. */
  showSource?: boolean;
  /** Collapse bodies with more than this many characters of text (0 = never). */
  collapseOver?: number;
  headingLevel?: "h2" | "h3";
  /** Label every audience (manager views). Otherwise only restricted ones get a badge: members- or leaders-only club posts, leaders-only university posts. */
  allBadges?: boolean;
}) {
  const scope = a.clubId ? "club" : "university";
  const restricted = scope === "club" ? a.audience !== "PUBLIC" : a.audience === "LEADERS";
  const badge = allBadges || restricted ? AUDIENCE_BADGE[scope][a.audience] : null;
  const text = richToText(a.bodyHtml);
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
    >
      {collapseOver > 0 && text.length > collapseOver ? (
        <Expandable preview={<p className="text-sm leading-relaxed text-ink-2">{richToText(a.bodyHtml, 280).replace(/\s*\n+\s*/g, " ")}</p>}>{body}</Expandable>
      ) : (
        body
      )}
    </AnnouncementFrame>
  );
}
