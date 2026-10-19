import Link from "next/link";
import { ArrowRight, ArrowUpCircle, Vote } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { canSeeElections, currentLeaderIds, syncClubElections, voterRoll, voterStatusIn } from "@/lib/domain/elections";
import { readSelectionRules } from "@/lib/roles/pipeline";
import { fmtWhen } from "@/components/elections/ElectionBits";
import { cn } from "@/components/ui/cn";

/**
 * CONTRACT (owner: roles builder). Server component for the club page: a
 * banner for each selection the viewer can act on now — running in or voting
 * on a member vote, voting as a leader in a self-select, or answering "move
 * up?" when they're next in line. Advisor & President selections have no
 * member step, so they don't show here. Renders nothing for non-members or
 * when nothing needs them.
 */
export async function OpenElectionsNotice({ clubId, className }: { clubId: string; className?: string }) {
  const viewer = await getCurrentUser();
  if (!viewer) return null;
  const access = await getClubAccess(viewer, clubId);
  if (!canSeeElections(access)) return null;
  await syncClubElections(clubId);
  const open = await db.election.findMany({
    where: { clubId, status: { in: ["NOMINATING", "VOTING"] }, method: { not: "ADVISOR_PRESIDENT" } },
    orderBy: { votingClosesAt: "asc" },
    include: {
      club: { select: { slug: true } },
      position: { select: { name: true } },
      votes: { where: { voterId: viewer.id }, select: { id: true } },
      candidates: { where: { userId: viewer.id }, select: { id: true, acceptedAt: true } },
    },
  });
  if (open.length === 0) return null;
  const leader = open.some((e) => e.method === "SELF_SELECT") ? (await currentLeaderIds(clubId)).includes(viewer.id) : false;
  // A member vote under the bylaws' attendance rule: members who can't vote hear why instead of "Vote now".
  const cannotVote = new Map<string, string>();
  for (const e of open) {
    if (e.method !== "MEMBER_VOTE" || e.status !== "VOTING" || e.votes.length || !readSelectionRules(e.rules).minEvents) continue;
    const s = voterStatusIn(await voterRoll(e), viewer.id);
    if (!s.eligible) cannotVote.set(e.id, s.reason ?? "You can't vote in this one.");
  }

  const items = open.flatMap((e) => {
    const voted = e.votes.length > 0;
    const asked = e.candidates[0];
    if (e.method === "NEXT_IN_LINE") {
      if (!asked) return [];
      return [{ e, icon: ArrowUpCircle, title: asked.acceptedAt ? `You said yes: ${e.position.name}` : `Move up to ${e.position.name}?`, body: asked.acceptedAt ? `The first in line who said yes moves up when answers close ${fmtWhen(e.votingClosesAt)}.` : `You're next in line. Answer by ${fmtWhen(e.votingClosesAt)}.` }];
    }
    if (e.method === "SELF_SELECT") {
      if (!leader && !asked) return [];
      if (e.status === "VOTING" && leader) return [{ e, icon: Vote, title: voted ? `You voted: ${e.title}` : `Leaders' vote: ${e.title}`, body: `Choose the next ${e.position.name} together by ${fmtWhen(e.votingClosesAt)}. It has to be unanimous.` }];
      return [{ e, icon: Vote, title: asked ? `You're a candidate: ${e.title}` : `Coming up: ${e.title}`, body: `The leaders vote from ${fmtWhen(e.votingOpensAt)}.` }];
    }
    const voting = e.status === "VOTING";
    const why = cannotVote.get(e.id);
    if (why) return [{ e, icon: Vote, title: `Voting is open: ${e.title}`, body: why }];
    return [{ e, icon: Vote, title: voting ? (voted ? `You voted: ${e.title}` : `Vote now: ${e.title}`) : `Nominations open: ${e.title}`, body: voting ? `Voting for ${e.position.name} closes ${fmtWhen(e.votingClosesAt)}.` : `Run for ${e.position.name} before voting opens ${fmtWhen(e.votingOpensAt)}.` }];
  });
  if (items.length === 0) return null;

  return (
    <aside aria-label="Leadership elections" className={cn("space-y-2", className)}>
      {items.map(({ e, icon: Icon, title, body }) => (
        <Link
          key={e.id}
          href={`/clubs/${e.club.slug}/elections/${e.id}`}
          className="group flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm hover:border-brand-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-brand-700">{title}</span>
            <span className="block text-ink-2">{body}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-brand transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      ))}
    </aside>
  );
}
