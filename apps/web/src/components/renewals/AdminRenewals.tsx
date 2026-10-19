import Link from "next/link";
import { CircleAlert, Download } from "lucide-react";
import type { Actor } from "@/lib/auth/session";
import { RENEWAL_FILTERS, renewalsForAdmin, type AdminRenewalRow, type RenewalFilter } from "@/lib/domain/renewals";
import { missingLabel } from "@/lib/renewals/rules";
import { fmtLongDate } from "@/lib/time";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const EMPTY: Record<RenewalFilter, { title: string; description: string }> = {
  "not-renewed": { title: "Every club has re-registered", description: "Each approved club renewed for this academic year." },
  overdue: { title: "No club is overdue", description: "Clubs that miss the due date show up here." },
  renewed: { title: "No club has renewed yet", description: "Renewals show up here as clubs re-register." },
};

/**
 * Admin → Club approvals → Renewals: approved clubs that haven't
 * re-registered for this academic year, with what's missing so WSUSA can
 * help, and the ones that have. Nothing here is automatic: clubs that don't
 * renew keep everything until WSUSA decides.
 */
export async function AdminRenewals({ actor, show }: { actor: Actor; show?: string }) {
  const { window, filter, rows, counts } = await renewalsForAdmin(actor, { filter: show });
  if (!window) {
    return (
      <EmptyState
        title="Renewal isn't open"
        description="Renewal opens on the first day of the academic year's first term. A system administrator adds terms in System settings → Academic calendar."
      />
    );
  }
  const count: Record<RenewalFilter, number> = { "not-renewed": counts.notRenewed, overdue: counts.overdue, renewed: counts.renewed };
  const href = (f: RenewalFilter) => `/admin/clubs?tab=renewals${f === "not-renewed" ? "" : `&show=${f}`}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Renewals for {window.year}</h2>
          <p className="text-sm text-ink-3">
            Opened {fmtLongDate(window.opensAt)} · due {fmtLongDate(window.dueAt)} · {counts.renewed} of {counts.expected} clubs re-registered
            {counts.blocked ? ` · ${counts.blocked} can't renew until something's fixed` : ""}
          </p>
        </div>
        <a href={`/admin/clubs/renewals.csv${filter === "not-renewed" ? "" : `?show=${filter}`}`} className={buttonClasses("outline", "sm")}>
          <Download className="h-4 w-4" aria-hidden /> Download CSV
        </a>
      </div>

      <div className="flex flex-wrap gap-1.5" aria-label="Show">
        {RENEWAL_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={href(f.key)}
            aria-current={filter === f.key ? "true" : undefined}
            className={cn("rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset", filter === f.key ? "bg-brand text-white ring-brand" : "bg-surface text-ink-2 ring-line-2 hover:bg-muted")}
          >
            {f.label} <span className="tabular-nums opacity-80">{count[f.key]}</span>
          </Link>
        ))}
      </div>

      {!rows.length ? (
        <EmptyState title={EMPTY[filter].title} description={EMPTY[filter].description} />
      ) : filter === "renewed" ? (
        <RenewedTable rows={rows} />
      ) : (
        <NotRenewedTable rows={rows} />
      )}

      <p className="text-xs text-ink-3">
        Clubs with a President or advisor to contact are listed first. Clubs that haven&apos;t renewed keep everything: nothing pauses or retires on its own.
        {counts.startingNextYear ? ` ${counts.startingNextYear} ${counts.startingNextYear === 1 ? "club" : "clubs"} approved since renewal opened ${counts.startingNextYear === 1 ? "renews" : "renew"} starting next year.` : ""}{" "}
        College ambassador programs don&apos;t renew.
      </p>
    </div>
  );
}

/** The club, and who WSUSA would contact about it (its Presidents and advisors). */
function ClubCell({ row, withLeaders = false }: { row: AdminRenewalRow; withLeaders?: boolean }) {
  const leaders = [...row.presidents.map((p) => `${p.name}, President`), ...row.advisors.map((a) => `${a.name}, advisor`)];
  return (
    <div className="flex items-center gap-3">
      <ClubLogo name={row.club.name} src={row.club.logoUrl} color={row.club.logoColor} size="sm" />
      <div className="min-w-0">
        <Link href={`/admin/clubs/${row.club.id}`} className="font-medium hover:underline">
          {row.club.name}
        </Link>
        {withLeaders ? <p className="text-xs text-ink-3">{leaders.length ? leaders.join(" · ") : "Nobody in the President's or advisor's seat"}</p> : null}
      </div>
    </div>
  );
}

function NotRenewedTable({ rows }: { rows: AdminRenewalRow[] }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Club</TH>
          <TH>Status</TH>
          <TH>What&apos;s missing</TH>
          <TH>
            <span className="sr-only">Actions</span>
          </TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.club.id}>
            <TD>
              <ClubCell row={r} withLeaders />
            </TD>
            <TD>
              <Badge tone={r.status.tone}>{r.status.label}</Badge>
            </TD>
            <TD>
              {r.missing.length ? (
                <ul className="space-y-0.5 text-sm">
                  {r.missing.map((c) => (
                    <li key={c.key} title={c.detail} className={cn("flex items-center gap-1.5 whitespace-nowrap", c.required ? "font-medium text-warning" : "text-ink-3")}>
                      {c.required ? <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                      {missingLabel(c.key)}
                      {c.required ? <span className="sr-only"> (needed to renew)</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-sm text-ink-3">Nothing: ready to renew</span>
              )}
            </TD>
            <TD className="text-right">
              <Link href={`/clubs/${r.club.slug}/manage#renewal`} className={buttonClasses("outline", "sm")}>
                Open renewal
              </Link>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function RenewedTable({ rows }: { rows: AdminRenewalRow[] }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Club</TH>
          <TH>Re-registered</TH>
          <TH className="hidden md:table-cell">By</TH>
          <TH className="hidden md:table-cell">Note</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.club.id}>
            <TD>
              <ClubCell row={r} />
            </TD>
            <TD className="whitespace-nowrap text-ink-2">{r.renewal ? fmtLongDate(r.renewal.at) : "—"}</TD>
            <TD className="hidden text-ink-2 md:table-cell">{r.renewal?.byName ?? <span className="text-ink-3">A former leader</span>}</TD>
            <TD className="hidden max-w-md text-ink-2 md:table-cell">{r.renewal?.note ? <span className="line-clamp-2 whitespace-pre-line">{r.renewal.note}</span> : <span className="text-ink-3">—</span>}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
