import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import type { Actor } from "@/lib/auth/session";
import { managedAnnouncements } from "@/lib/domain/announcements";
import { INSTITUTION } from "@/lib/institution";
import { ButtonLink } from "@/components/ui/button";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";

const SHOWN = 3;

/**
 * WSUSA staff: the university-wide announcements they publish (pinned first,
 * every audience labelled), with a quick way to post or edit. The full list
 * is Admin → Announcements, the one input tool for them.
 */
export async function WsusaAnnouncements({ actor }: { actor: Actor }) {
  const items = (await managedAnnouncements(actor, null)).slice(0, SHOWN);
  return (
    <section id="announcements" aria-labelledby="dash-wsusa-title" className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="dash-wsusa-title" className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-ink">
          <Megaphone className="h-5 w-5 text-brand" aria-hidden /> {INSTITUTION.studentGovernment} announcements
        </h2>
        <ButtonLink href="/admin/announcements/new" size="sm">
          <Plus className="h-4 w-4" aria-hidden /> New announcement
        </ButtonLink>
      </div>
      {items.length ? (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id}>
              <AnnouncementCard
                a={a}
                allBadges
                clampLines={3}
                footer={
                  <Link href={`/admin/announcements/${a.id}`} className="text-sm font-medium text-brand-600 hover:underline">
                    Edit<span className="sr-only"> {a.title}</span>
                  </Link>
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface px-5 py-6 text-sm text-ink-3">
          {INSTITUTION.studentGovernment} hasn&apos;t posted anything yet. Announcements you post reach every student&apos;s dashboard and app.
        </p>
      )}
      <div className="mt-3 text-right">
        <Link href="/admin/announcements" className="text-sm font-medium text-brand-600 hover:underline">
          All announcements
        </Link>
      </div>
    </section>
  );
}
