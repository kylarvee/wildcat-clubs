import Link from "next/link";
import type { ReactNode } from "react";
import { Megaphone, Pin } from "lucide-react";
import { INSTITUTION } from "@/lib/institution";
import { fmtDate } from "@/lib/time";
import { Avatar, ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";

export type FrameAuthor = { name: string; handle?: string | null; avatarUrl: string | null; avatarColor: string };
export type FrameClub = { name: string; slug: string; logoUrl: string | null; logoColor: string };

/**
 * The look of one announcement: where it's from, title, badges, who posted it
 * and when, then the body. Hook-free and server-safe, so the published card
 * and the composer's live preview are the same component.
 */
export function AnnouncementFrame({
  title,
  author,
  createdAt,
  edited,
  pinned,
  badge,
  club,
  university,
  headingLevel = "h3",
  footer,
  className,
  children,
}: {
  title: string;
  author: FrameAuthor;
  /** Null in the composer preview ("Not posted yet"). */
  createdAt: Date | string | null;
  edited?: boolean;
  pinned?: boolean;
  /** Audience label, e.g. "Members only". */
  badge?: string | null;
  /** Show which club posted it (dashboard feed). */
  club?: FrameClub | null;
  /** Show it's from the student association (university-wide). */
  university?: boolean;
  headingLevel?: "h2" | "h3";
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const Heading = headingLevel;
  const when = createdAt ? new Date(createdAt) : null;
  return (
    <article className={cn("min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] sm:p-5", pinned && "border-brand-100", className)}>
      {club ? (
        <Link href={`/clubs/${club.slug}`} className="mb-3 flex w-fit max-w-full items-center gap-2 text-sm font-medium text-ink-2 hover:text-ink">
          <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="sm" className="h-6 w-6 rounded-md text-[10px]" />
          <span className="truncate">{club.name}</span>
        </Link>
      ) : university ? (
        <p className="mb-3 flex items-center gap-2 text-sm font-medium text-brand">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand text-white">
            <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          {INSTITUTION.studentGovernment} · {INSTITUTION.shortName}
        </p>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <Heading className="min-w-0 flex-1 text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{title || "Untitled announcement"}</Heading>
        {pinned || badge ? (
          <span className="flex shrink-0 flex-wrap gap-1.5">
            {pinned ? (
              <Badge tone="brand">
                <Pin className="h-3 w-3" aria-hidden="true" /> Pinned
              </Badge>
            ) : null}
            {badge ? <Badge>{badge}</Badge> : null}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-3">
        <Avatar name={author.name} src={author.avatarUrl} color={author.avatarColor} size="xs" className="ring-0" />
        {author.handle ? (
          <Link href={`/u/${author.handle}`} className="font-medium text-ink-2 hover:underline">
            {author.name}
          </Link>
        ) : (
          <span className="font-medium text-ink-2">{author.name}</span>
        )}
        <span aria-hidden="true">·</span>
        {when ? (
          <time dateTime={when.toISOString()}>{fmtDate(when, "MMM d, yyyy 'at' h:mm a")}</time>
        ) : (
          <span>Not posted yet</span>
        )}
        {edited ? <span>· edited</span> : null}
      </p>
      <div className="mt-3 min-w-0">{children}</div>
      {footer ? <div className="mt-4 border-t border-line pt-3">{footer}</div> : null}
    </article>
  );
}
