import Link from "next/link";
import { Compass, Plus, Settings2, Users } from "lucide-react";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/dashboard/Panel";
import type { DashClub } from "@/app/dashboard/data";

const STATUS_BADGE: Partial<Record<DashClub["status"], string>> = {
  DRAFT: "Draft",
  CHANGES_REQUESTED: "Changes requested",
  SUBMITTED: "In WSUSA review",
};

/**
 * "Your clubs": every club you're in, with your role, a link to the club
 * page, Manage for leaders, and pending join requests. Browse and Start a
 * club sit at the bottom.
 */
export function YourClubs({ clubs, canCreate, alumni, faculty = false }: { clubs: DashClub[]; canCreate: boolean; alumni: boolean; faculty?: boolean }) {
  return (
    <Panel id="dash-clubs" title="Your clubs" icon={<Users />} bodyClassName="p-0 sm:p-0">
      {clubs.length ? (
        <nav aria-label="Your clubs">
          <ul className="divide-y divide-line">
            {clubs.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link href={`/clubs/${c.slug}`} className="block truncate text-sm font-semibold text-ink hover:text-brand-600 hover:underline">
                    {c.name}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {c.pending ? (
                      <Badge tone="warning">Request pending</Badge>
                    ) : (
                      c.roles.map((r) => (
                        <Badge key={r} tone={r === "Member" ? "neutral" : "brand"}>
                          {r}
                        </Badge>
                      ))
                    )}
                    {STATUS_BADGE[c.status] ? <Badge tone="info">{STATUS_BADGE[c.status]}</Badge> : null}
                  </div>
                </div>
                {c.leads ? (
                  <Link
                    href={`/clubs/${c.slug}/manage`}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-ink-2 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <Settings2 className="h-3.5 w-3.5" aria-hidden /> Manage<span className="sr-only"> {c.name}</span>
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <div className="px-4 py-6 text-center sm:px-5">
          <p className="text-sm font-medium text-ink">{alumni ? "Your memberships are alumni memberships now" : faculty ? "You don't advise a club yet" : "You haven't joined a club yet"}</p>
          <p className="mt-1 text-sm text-ink-3">
            {alumni
              ? "Your roles and history stay on your profile."
              : faculty
                ? "When students ask you to advise their club and you accept, it shows up here with a link to its workspace."
                : "Find one that fits — there are clubs for every major, hobby and cause at Weber State."}
          </p>
        </div>
      )}
      {!alumni ? (
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3 sm:px-5">
          <ButtonLink href="/clubs" variant={clubs.length ? "outline" : "primary"} size="sm">
            <Compass className="h-4 w-4" aria-hidden /> {clubs.length ? "Browse more clubs" : "Browse clubs"}
          </ButtonLink>
          {canCreate ? (
            <ButtonLink href="/clubs/new" variant="ghost" size="sm">
              <Plus className="h-4 w-4" aria-hidden /> Start a club
            </ButtonLink>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
