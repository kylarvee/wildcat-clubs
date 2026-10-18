import Link from "next/link";
import { Compass, GraduationCap, Plus, Settings2, Users } from "lucide-react";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/dashboard/Panel";
import { meetingLabel } from "@/components/dashboard/format";
import type { DashClub } from "@/app/dashboard/data";

const STATUS_BADGE: Partial<Record<DashClub["status"], string>> = {
  DRAFT: "Draft",
  CHANGES_REQUESTED: "Changes requested",
  SUBMITTED: "In WSUSA review",
};

/**
 * "Your clubs": the switchboard to every club you're in. Clubs you lead or
 * advise come first, as tinted cards with a ringed logo, your role and a way
 * into the workspace; clubs you're a member of are plain rows. Each shows
 * only its next meeting — everything else lives on the club's own pages.
 */
export function YourClubs({ clubs, now, canCreate, alumni, faculty = false }: { clubs: DashClub[]; now: Date; canCreate: boolean; alumni: boolean; faculty?: boolean }) {
  const lead = clubs.filter((c) => c.leads);
  const member = clubs.filter((c) => !c.leads);
  const advisesOnly = lead.length > 0 && lead.every((c) => c.topRole === "ADVISOR");
  return (
    <Panel id="dash-clubs" title={faculty ? "Clubs you advise" : "Your clubs"} icon={faculty ? <GraduationCap /> : <Users />} bodyClassName="p-0 sm:p-0">
      {clubs.length ? (
        <nav aria-label={faculty ? "Clubs you advise" : "Your clubs"}>
          {lead.length ? (
            <div className="px-3 pb-1 pt-3.5">
              <p className="mx-1 mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-brand-600">{advisesOnly ? "You advise" : "You lead"}</p>
              <ul className="space-y-2.5">
                {lead.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3">
                    <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" className="h-9 w-9 shrink-0 ring-2 ring-brand ring-offset-2 ring-offset-brand-50" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/clubs/${c.slug}`} className="block font-semibold leading-snug text-ink hover:text-brand-600 hover:underline">
                        {c.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.roles.map((r) => (
                          <span key={r} className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">
                            {r}
                          </span>
                        ))}
                        {STATUS_BADGE[c.status] ? <Badge tone="info">{STATUS_BADGE[c.status]}</Badge> : null}
                      </div>
                      {c.status === "APPROVED" ? <NextMeeting at={c.nextMeeting} now={now} className="mt-1.5 text-ink-2" /> : null}
                      <Link
                        href={`/clubs/${c.slug}/manage`}
                        className="mt-0.5 inline-flex min-h-8 items-center gap-1.5 rounded text-sm font-semibold text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand"
                      >
                        <Settings2 className="h-3.5 w-3.5" aria-hidden /> Manage<span className="sr-only"> {c.name}</span>
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {member.length ? (
            <div className="px-3 pb-1 pt-3">
              <p className="mx-1 mb-1 text-[11px] font-bold uppercase tracking-[0.07em] text-ink-3">Member of</p>
              <ul>
                {member.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-1 py-2">
                    <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/clubs/${c.slug}`} className="block font-semibold leading-snug text-ink hover:text-brand-600 hover:underline">
                        {c.name}
                      </Link>
                      {c.pending ? (
                        <Badge tone="warning" className="mt-1">
                          Request pending
                        </Badge>
                      ) : (
                        <NextMeeting at={c.nextMeeting} now={now} className="mt-0.5 text-ink-3" />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </nav>
      ) : (
        <div className="px-4 py-6 text-center sm:px-5">
          <p className="text-sm font-medium text-ink">{alumni ? "Your memberships are alumni memberships now" : faculty ? "You don't advise a club yet" : "You haven't joined a club yet"}</p>
          <p className="mt-1 text-sm text-ink-3">
            {alumni
              ? "Your roles and history stay on your profile."
              : faculty
                ? "When students ask you to advise their club, the invitation shows up in your tasks. Accept it and the club appears here."
                : "Find one that fits — there are clubs for every major, hobby and cause at Weber State."}
          </p>
        </div>
      )}
      {!alumni ? (
        <div className="mt-2 flex flex-wrap gap-2 border-t border-line px-4 py-3 sm:px-5">
          {faculty ? (
            <ButtonLink href="/advisor" variant="outline" size="sm">
              <GraduationCap className="h-4 w-4" aria-hidden /> Advisor home
            </ButtonLink>
          ) : (
            <ButtonLink href="/clubs" variant={clubs.length ? "outline" : "primary"} size="sm">
              <Compass className="h-4 w-4" aria-hidden /> {clubs.length ? "Browse clubs" : "Find a club"}
            </ButtonLink>
          )}
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

function NextMeeting({ at, now, className }: { at: Date | null; now: Date; className?: string }) {
  return (
    <p className={`text-[13px] ${className ?? ""}`}>
      {at ? (
        <>
          Next meeting{" "}
          <time dateTime={at.toISOString()} className="font-semibold text-ink">
            {meetingLabel(at, now)}
          </time>
        </>
      ) : (
        "No meeting scheduled"
      )}
    </p>
  );
}
