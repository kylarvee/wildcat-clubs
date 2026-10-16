import Link from "next/link";
import { ArrowRight, Vote } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { canSeeElections, syncClubElections } from "@/lib/domain/elections";
import { fmtWhen } from "@/components/elections/ElectionBits";
import { cn } from "@/components/ui/cn";

/**
 * CONTRACT (owner: roles builder). Server component for the club page: a
 * banner for the viewer's open elections (taking nominations or voting).
 * Renders nothing for non-members or when nothing is open.
 */
export async function OpenElectionsNotice({ clubId, className }: { clubId: string; className?: string }) {
  const viewer = await getCurrentUser();
  if (!viewer) return null;
  const access = await getClubAccess(viewer, clubId);
  if (!canSeeElections(access)) return null;
  await syncClubElections(clubId);
  const open = await db.election.findMany({
    where: { clubId, status: { in: ["NOMINATING", "VOTING"] } },
    orderBy: { votingClosesAt: "asc" },
    include: { club: { select: { slug: true } }, position: { select: { name: true } }, votes: { where: { voterId: viewer.id }, select: { id: true } } },
  });
  if (open.length === 0) return null;
  return (
    <aside aria-label="Open elections" className={cn("space-y-2", className)}>
      {open.map((e) => {
        const voting = e.status === "VOTING";
        const voted = e.votes.length > 0;
        return (
          <Link
            key={e.id}
            href={`/clubs/${e.club.slug}/elections/${e.id}`}
            className="group flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm hover:border-brand-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white">
              <Vote className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-brand-700">{voting ? (voted ? `You voted: ${e.title}` : `Vote now: ${e.title}`) : `Nominations open: ${e.title}`}</span>
              <span className="block text-ink-2">
                {voting ? `Voting for ${e.position.name} closes ${fmtWhen(e.votingClosesAt)}.` : `Run for ${e.position.name} before voting opens ${fmtWhen(e.votingOpensAt)}.`}
              </span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-brand transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        );
      })}
    </aside>
  );
}
