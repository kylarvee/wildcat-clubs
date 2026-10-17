import Link from "next/link";
import { Megaphone, Pin, Plus } from "lucide-react";
import type { AnnouncementView } from "@/lib/domain/announcements";
import type { ActionResult } from "@/lib/domain/kit";
import { fmtDate } from "@/lib/time";
import { RichContentText } from "@/components/rich/RichContent";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";
import { AnnouncementRowActions } from "@/components/announcements/AnnouncementRowActions";
import { AUDIENCE_BADGE, type AnnouncementScope } from "@/components/announcements/labels";

/**
 * A manager's list of announcements (club tool or admin), pinned first, with
 * edit / pin / delete. Server component; the actions are the route's own
 * server actions, passed through.
 */
export function ManagedAnnouncementList({
  items,
  scope,
  base,
  pinAction,
  deleteAction,
  viewHref,
}: {
  items: AnnouncementView[];
  scope: AnnouncementScope;
  /** e.g. /clubs/chess-club/manage/announcements — "/new" and "/<id>" hang off it. */
  base: string;
  pinAction: (id: string, pinned: boolean) => Promise<ActionResult<{ pinned: boolean }>>;
  deleteAction: (id: string) => Promise<ActionResult<unknown>>;
  /** Where readers see them (club page or dashboard), for the empty state. */
  viewHref?: string;
}) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<Megaphone />}
        title="No announcements yet"
        description={
          scope === "club"
            ? "Share meeting changes, event news and wins with your members. Each announcement notifies the people it's for."
            : "Post news for everyone at Weber State, every signed-in account, or every club leader. Each announcement notifies its audience."
        }
        action={
          <ButtonLink href={`${base}/new`}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Write the first one
          </ButtonLink>
        }
      />
    );
  }

  const pinHint = scope === "club" ? "on the club page" : "on everyone's dashboard";
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
        {items.map((a) => (
          <li key={a.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:px-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {a.pinned ? (
                  <Badge tone="brand">
                    <Pin className="h-3 w-3" aria-hidden="true" /> Pinned
                  </Badge>
                ) : null}
                <Badge tone={a.audience === "LEADERS" ? "warning" : a.audience === "PUBLIC" ? "info" : "neutral"}>{AUDIENCE_BADGE[scope][a.audience]}</Badge>
              </div>
              <h3 className="mt-1.5 font-semibold text-ink [overflow-wrap:anywhere]">
                <Link href={`${base}/${a.id}`} className="hover:underline">
                  {a.title}
                </Link>
              </h3>
              <p className="mt-1 line-clamp-2 text-sm text-ink-2">
                <RichContentText html={a.bodyHtml} max={220} />
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-3">
                <Avatar name={a.author.name} src={a.author.avatarUrl} color={a.author.avatarColor} size="xs" className="ring-0" />
                <span className="font-medium text-ink-2">{a.author.name}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={a.createdAt.toISOString()}>{fmtDate(a.createdAt, "MMM d, yyyy 'at' h:mm a")}</time>
                {a.edited ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>edited {fmtDate(a.updatedAt, "MMM d")}</span>
                  </>
                ) : null}
              </p>
            </div>
            <AnnouncementRowActions id={a.id} title={a.title} pinned={a.pinned} editHref={`${base}/${a.id}`} pinAction={pinAction} deleteAction={deleteAction} pinHint={pinHint} />
          </li>
        ))}
      </ul>
      {viewHref ? (
        <p className="text-sm text-ink-3">
          Readers see these {scope === "club" ? "on the club page" : "on their dashboard"}.{" "}
          <Link href={viewHref} className="font-medium text-brand-600 hover:underline">
            See it as a reader
          </Link>
        </p>
      ) : null}
    </div>
  );
}
