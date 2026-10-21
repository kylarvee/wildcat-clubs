import Link from "next/link";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ProjectItem } from "@/components/profile/ProjectItem";
import { END_REASON_LABEL } from "@/lib/roles/labels";
import { fmtDuration, fmtExperienceRange } from "@/lib/profiles/format";
import type { ProfileRole, ProfileRoleGroup } from "@/lib/profiles/queries";

const STATUS_NOTE: Partial<Record<string, string>> = { RETIRED: "Retired club", DRAFT: "Founding", SUBMITTED: "In review", CHANGES_REQUESTED: "Founding", REJECTED: "Not approved" };

function RoleMeta({ role, now }: { role: ProfileRole; now: Date }) {
  return (
    <>
      <p className="text-sm text-ink-3">{fmtExperienceRange(role.startedAt, role.endedAt, now)}</p>
      {role.viaClub || (role.endedAt && role.endReason) ? (
        <p className="mt-0.5 text-xs text-ink-3">
          {role.viaClub ? (
            <>
              Placed by{" "}
              <Link href={`/clubs/${role.viaClub.slug}`} className="hover:text-brand-600 hover:underline">
                {role.viaClub.name}
              </Link>
            </>
          ) : null}
          {role.viaClub && role.endedAt && role.endReason ? " · " : null}
          {role.endedAt && role.endReason ? END_REASON_LABEL[role.endReason] : null}
        </p>
      ) : null}
    </>
  );
}

function Contributions({ role }: { role: ProfileRole }) {
  if (!role.projects.length) return null;
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line bg-muted/40 p-3 sm:p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Contributions</p>
      <div className="divide-y divide-line">
        {role.projects.map((p) => (
          <ProjectItem key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}

/**
 * A club on the Experience list, LinkedIn style: one role reads as a single
 * entry; several roles in the same club stack under the club with a
 * timeline, each with the contributions tied to it.
 */
export function RoleGroup({ group, now }: { group: ProfileRoleGroup; now: Date }) {
  const { club } = group;
  const note = STATUS_NOTE[club.status];
  const clubLink = (
    <Link href={`/clubs/${club.slug}`} className="font-medium text-ink hover:text-brand-600 hover:underline">
      {club.name}
    </Link>
  );

  if (group.roles.length === 1) {
    const role = group.roles[0];
    return (
      <li className="flex gap-3 py-5 first:pt-0 last:pb-0 sm:gap-4">
        <Link href={`/clubs/${club.slug}`} className="shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-brand" tabIndex={-1} aria-hidden>
          <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="md" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-semibold text-ink">{role.title}</h3>
            {!role.endedAt ? <Badge tone="success">Current</Badge> : null}
          </div>
          <p className="text-sm text-ink-2">
            {clubLink}
            {note ? <span className="text-ink-3"> · {note}</span> : null}
          </p>
          <RoleMeta role={role} now={now} />
          <Contributions role={role} />
        </div>
      </li>
    );
  }

  return (
    <li className="flex gap-3 py-5 first:pt-0 last:pb-0 sm:gap-4">
      <Link href={`/clubs/${club.slug}`} className="shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-brand" tabIndex={-1} aria-hidden>
        <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="md" />
      </Link>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-ink">
          <Link href={`/clubs/${club.slug}`} className="hover:text-brand-600 hover:underline">
            {club.name}
          </Link>
        </h3>
        <p className="text-sm text-ink-3">
          {group.roles.length} roles · {fmtDuration(group.start, group.end, now)}
          {note ? ` · ${note}` : null}
        </p>
        <ol className="mt-3 space-y-0">
          {group.roles.map((role, i) => (
            <li key={role.id} className="relative pb-5 pl-6 last:pb-0">
              {/* Timeline: a dot per role joined by a line, newest on top. */}
              <span aria-hidden className={`absolute left-[5px] top-2 h-2.5 w-2.5 rounded-full ${role.endedAt ? "bg-line-2" : "bg-brand"}`} />
              {i < group.roles.length - 1 ? <span aria-hidden className="absolute bottom-0 left-[9px] top-5 w-px bg-line-2" /> : null}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h4 className="font-medium text-ink">{role.title}</h4>
                {!role.endedAt ? <Badge tone="success">Current</Badge> : null}
              </div>
              <RoleMeta role={role} now={now} />
              <Contributions role={role} />
            </li>
          ))}
        </ol>
      </div>
    </li>
  );
}
