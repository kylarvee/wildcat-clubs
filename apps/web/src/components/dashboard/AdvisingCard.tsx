import Link from "next/link";
import { GraduationCap, MailOpen } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/dashboard/Panel";
import { fmtAgo } from "@/lib/time";
import type { AdvisorInviteRow } from "@/app/dashboard/data";

/** Faculty and staff: invitations to advise a club, and the clubs they advise. */
export function AdvisingCard({ invites, advisedCount }: { invites: AdvisorInviteRow[]; advisedCount: number }) {
  return (
    <Panel
      id="dash-advising"
      title="Advising"
      icon={<GraduationCap />}
      description={advisedCount ? `You advise ${advisedCount} club${advisedCount === 1 ? "" : "s"}. They're listed under Your clubs.` : "Clubs you advise will show up under Your clubs."}
      link={{ href: "/advisor", label: "Advisor home" }}
    >
      {invites.length ? (
        <ul className="space-y-3">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/60 p-3">
              <MailOpen className="h-5 w-5 shrink-0 text-brand" aria-hidden />
              <p className="min-w-0 flex-1 text-sm text-ink-2">
                <span className="font-medium text-ink">{i.inviterName}</span> asked you to advise{" "}
                <Link href={`/clubs/${i.clubSlug}`} className="font-medium text-ink hover:text-brand-600 hover:underline">
                  {i.clubName}
                </Link>
                <span className="text-ink-3"> · {fmtAgo(i.createdAt)}</span>
              </p>
              <ButtonLink href={i.href} size="sm">
                Review invitation<span className="sr-only"> from {i.clubName}</span>
              </ButtonLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">No invitations waiting. When a student founder asks you to advise their club, you&apos;ll see it here and by email.</p>
      )}
    </Panel>
  );
}
