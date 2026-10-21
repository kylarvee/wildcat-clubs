import Link from "next/link";
import type { CSSProperties } from "react";
import { Network } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { orgChartData, trainingStatusFor, type ChartSeat } from "@/lib/roles/queries";
import { TIERS } from "@/lib/roles/labels";
import { SeatCard } from "@/components/roles/SeatCard";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";

/**
 * CONTRACT (owner: roles builder). Server component: the club's live org chart
 * (seats, holders, internal titles, responsibilities, vacancies), built from
 * Position + RoleAssignment. Embedded on the club page; the org chart tool
 * wraps it with editing.
 *
 * President(s) → Vice President(s) → Officers → Ambassadors, drawn as a tree
 * on large screens and stacked tiers on phones. Leaders also see who still
 * owes officer training; everyone else sees only the chart.
 */
export async function OrgChart({ clubId, className, showAdvisors = true }: { clubId: string; className?: string; showAdvisors?: boolean }) {
  const [data, viewer, club] = await Promise.all([
    orgChartData(clubId),
    getCurrentUser(),
    db.club.findUnique({ where: { id: clubId }, select: { approvedAt: true, status: true, officeId: true } }),
  ]);
  if (!club) return null;
  const access = viewer ? await getClubAccess(viewer, clubId) : null;
  const training = access?.isLeader && club.status === "APPROVED" ? await trainingStatusFor(data.seats.flatMap((s) => s.holders), club.approvedAt, club.officeId) : new Map();

  const tiers = TIERS.map((t) => ({ ...t, seats: data.seats.filter((s) => t.roles.includes(s.role)) })).filter((t) => t.seats.length > 0);

  if (tiers.length === 0) {
    return (
      <div className={cn("flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-line-2 bg-surface px-6 py-10 text-center", className)}>
        <Network className="mb-2 h-7 w-7 text-ink-3" aria-hidden />
        <p className="font-medium text-ink">No org chart yet</p>
        <p className="mt-1 max-w-sm text-sm text-ink-3">This club hasn&apos;t set up its leadership seats yet.</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-0", className)}>
      {tiers.map((tier, ti) => (
        <Tier key={tier.key} label={tier.seats.length > 1 ? tier.plural : tier.label} seats={tier.seats} first={ti === 0} training={training} />
      ))}

      {showAdvisors && data.advisors.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-xl border border-line bg-muted/50 px-4 py-3 text-sm">
          <span className="font-medium text-ink-2">{data.advisors.length > 1 ? "Faculty advisors" : "Faculty advisor"}</span>
          {data.advisors.map((a) => (
            <Link key={a.id} href={`/u/${a.handle}`} className="flex items-center gap-2 rounded-full py-0.5 pr-2 text-ink hover:text-brand-600 hover:underline">
              <Avatar name={a.name} src={a.avatarUrl} color={a.avatarColor} size="xs" />
              {a.name}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Balanced column count for a tier on large screens (e.g. 5 → 3 + 2, not 4 + 1). */
function colsFor(n: number) {
  if (n <= 4) return n;
  return n === 5 || n === 6 || n === 9 ? 3 : 4;
}

function Tier({ label, seats, first, training }: { label: string; seats: ChartSeat[]; first: boolean; training: Map<string, "pending" | "overdue"> }) {
  const cols = colsFor(seats.length);
  // Half a column (minus the 1rem gaps) — where the first and last connector stubs sit.
  const inset = `calc((100% - ${cols - 1}rem) / ${2 * cols})`;
  const style = { "--cols": cols, "--tier-max": `${cols * 19 + (cols - 1)}rem` } as CSSProperties;
  return (
    <section aria-label={label} className={cn(!first && "pt-6 lg:pt-0")}>
      {!first ? <div aria-hidden className="mx-auto hidden h-6 w-px bg-line-2 lg:block" /> : null}
      <div className="flex justify-center">
        <h3 className="rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</h3>
      </div>
      <div className="mx-auto lg:max-w-[var(--tier-max)]" style={style}>
        {/* Connector stubs: a bar across the first row with a drop to each card (large screens). */}
        <div aria-hidden className="relative hidden lg:block">
          {cols > 1 ? <div className="absolute top-0 h-px bg-line-2" style={{ left: inset, right: inset }} /> : null}
          <div className="grid gap-4 lg:grid-cols-[repeat(var(--cols),minmax(0,1fr))]">
            {Array.from({ length: cols }, (_, i) => (
              <div key={i} className="mx-auto h-4 w-px bg-line-2" />
            ))}
          </div>
        </div>
        <div className={cn("mt-3 grid gap-4 lg:mt-0 lg:grid-cols-[repeat(var(--cols),minmax(0,1fr))]", seats.length > 1 ? "sm:grid-cols-2" : "mx-auto max-w-sm lg:max-w-none")}>
          {seats.map((s) => (
            <SeatCard
              key={s.id}
              name={s.name}
              roleLabel={s.roleLabel}
              responsibilities={s.responsibilities}
              maxHolders={s.maxHolders}
              headingLevel={4}
              holders={s.holders.map((h) => ({
                assignmentId: h.assignmentId,
                person: h.person,
                internalTitle: h.internalTitle,
                viaClub: h.viaClub,
                training: training.get(h.assignmentId) ?? null,
              }))}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
