import Link from "next/link";
import { Sprout } from "lucide-react";
import type { FormingClub } from "@/lib/clubs/founding";
import { foundersLine } from "@/lib/founding/rules";
import { ClubLogo } from "@/components/ui/avatar";
import { FollowFormingButton } from "@/components/clubs/FollowFormingButton";

/**
 * The clubs list's Forming section (signed-in accounts only): clubs students
 * are starting, listed by their founders. Not search results (forming clubs
 * stay out of search, the network map and analytics), so it shows on the
 * plain list without a search or filters.
 */
export function FormingClubs({ clubs }: { clubs: FormingClub[] }) {
  if (!clubs.length) return null;
  return (
    <section id="forming" aria-labelledby="forming-heading" className="mb-8 scroll-mt-24 rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface/60 p-4 sm:p-5">
      <div className="mb-4">
        <h2 id="forming-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
          <Sprout className="h-5 w-5 text-brand" aria-hidden /> Forming
        </h2>
        <p className="text-sm text-ink-3">Students are starting these clubs. Follow one and you&apos;ll hear when it&apos;s approved.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Forming clubs">
        {clubs.map((c) => (
          <li key={c.id} className="flex min-w-0">
            <article className="flex w-full min-w-0 flex-col rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start gap-3">
                <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold leading-snug text-ink">
                    <Link href={`/clubs/${c.slug}`} className="hover:text-brand hover:underline">
                      {c.name}
                    </Link>
                  </h3>
                  <p className="mt-0.5 text-xs text-ink-3">Not yet recognized by {c.office}</p>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 flex-1 text-sm text-ink-2">{c.shortDescription || <span className="text-ink-3">The founders are still writing their description.</span>}</p>
              {c.founders.length ? <p className="mt-2 text-xs text-ink-3">Started by {foundersLine(c.founders)}</p> : null}
              <div className="mt-3">
                <FollowFormingButton clubId={c.id} clubName={c.name} following={c.following} />
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
