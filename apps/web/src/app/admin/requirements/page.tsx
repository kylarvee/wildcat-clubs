import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, Download, GraduationCap, Hourglass, Plus, ShieldCheck } from "lucide-react";
import { listRequirementsForAdmin, openRequirementCounts, requirementCompliance, type ComplianceCell, type ComplianceRow } from "@/lib/domain/requirements";
import { AWAITING_GRADE_LABEL } from "@/lib/authz/requirement-rules";
import { adminClubWhere, adminScope, CAPABILITIES, ROLE_LABEL, type Capability } from "@/lib/authz";
import { RENEWAL_LABEL } from "@/lib/tests/types";
import { fmtDate } from "@/lib/time";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, PageHeader, Section, Stat } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pager } from "@/components/admin/Filters";
import { ActiveToggle } from "./ActiveToggle";
import { applyFilter, filterQuery, parseFilter } from "./filters";
import { requireRequirementAdmin } from "./guard";

export const metadata: Metadata = { title: "Requirements" };

const SOON_DAYS = 14;
/** Leader rows per page; the stats, filters and CSV always cover everyone. */
const PAGE_SIZE = 50;

/** "Events" for a capability key; the key itself for anything unknown. */
const permissionLabel = (c: string) => (c in CAPABILITIES ? CAPABILITIES[c as Capability].label : c);

/**
 * Requirements: the tests, forms and trainings WSUSA (and each office, for
 * its own clubs) requires of club members and student leaders, and where
 * every current student leader stands. Leader status comes from the
 * requirement rule (passed attempts, submitted forms and training check-ins),
 * never stored, evaluated for every leader in one batch
 * (requirementCompliance); member-wide requirements show how many people
 * still owe them (their open required tasks). An office's staff see and
 * manage only their office's requirements and the leaders of its clubs;
 * WSUSA's admins see everything, each requirement labelled by its office.
 * The table shows PAGE_SIZE rows at a time.
 */
export default async function RequirementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRequirementAdmin("/admin/requirements");
  const sp = await searchParams;
  const f = parseFilter(sp);
  const now = new Date();
  const umbrella = adminScope(user).all;
  const [reqs, rows, open] = await Promise.all([listRequirementsForAdmin(user), requirementCompliance(now, { clubWhere: adminClubWhere(user) }), openRequirementCounts(now)]);
  const ownerOf = (r: (typeof reqs)[number]) => r.office?.name ?? "WSUSA";
  // The leader table covers requirements that reach a leader role; member-wide ones are counted on their cards.
  const active = reqs.filter((r) => r.active && r.appliesTo.some((role) => role !== "MEMBER"));
  const shown = applyFilter(rows, f);
  const columns = f.req ? active.filter((r) => r.id === f.req) : active;
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(String([sp.page].flat()[0] ?? "1"), 10) || 1));
  const from = (page - 1) * PAGE_SIZE;
  const pageRows = shown.slice(from, from + PAGE_SIZE);

  const people = new Set(rows.map((r) => r.person.id)).size;
  // Paused all the way, or just a permission or two.
  const pausedPeople = new Set(rows.filter((r) => r.paused || r.pausedCapabilities?.length).map((r) => r.person.id)).size;
  const soon = now.getTime() + SOON_DAYS * 86_400_000;
  const dueSoon = new Set(rows.filter((r) => !r.paused && Object.values(r.cells).some((c) => c.state === "due" && c.dueAt.getTime() <= soon)).map((r) => r.person.id)).size;
  const allMet = new Set(rows.filter((r) => Object.values(r.cells).every((c) => c.state === "met")).map((r) => r.person.id)).size;
  const clubs = [...new Map(rows.map((r) => [r.club.id, r.club])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const counts = (reqId: string) => {
    const c = { met: 0, review: 0, due: 0, overdue: 0 };
    for (const r of rows) {
      const cell = r.cells[reqId];
      if (cell) c[cell.state]++;
    }
    return c;
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Requirements"
        description={
          umbrella
            ? "Tests, forms and trainings WSUSA (or an office, for its own clubs) requires of club members and student leaders. They show as required in everyone's tasks. Each has a grace period; past it, a leader keeps their title but their permissions pause until it's done, or just the one permission it's about."
            : "Tests and forms your office requires of its clubs' members and student leaders. They show as required in everyone's tasks. Each has a grace period; past it, a leader keeps their title but their permissions pause until it's done, or just the one permission it's about."
        }
        actions={
          <ButtonLink href="/admin/requirements/new">
            <Plus className="h-4 w-4" aria-hidden /> New requirement
          </ButtonLink>
        }
      />

      <Section title="Requirements">
        {reqs.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck />}
            title="No requirements yet"
            description="Require a published test or form (audience: WSUSA requirement) or a university training of every club member, chosen leader roles, or both."
            action={<ButtonLink href="/admin/requirements/new">New requirement</ButtonLink>}
          />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {reqs.map((r) => {
              const c = counts(r.id);
              const members = r.appliesTo.includes("MEMBER");
              const o = open.get(r.id) ?? { open: 0, overdue: 0, waiting: 0 };
              return (
                <li key={r.id}>
                  <Card className="h-full p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="mt-0.5 text-brand" aria-hidden>
                        {r.kind === "TEST" ? <ClipboardCheck className="h-5 w-5" /> : <GraduationCap className="h-5 w-5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link href={`/admin/requirements/${r.id}`} className="font-semibold text-ink hover:text-brand-600 hover:underline">
                          {r.name}
                        </Link>
                        <p className="text-sm text-ink-3">
                          {r.kind === "PROFILE" ? "Confirm their member details" : r.kind === "TRAINING" ? "Attend " : r.test?.isForm ? "Fill out " : "Pass "}
                          {r.kind === "PROFILE" ? null : r.test ? (
                            <Link href={`/admin/tests/${r.test.id}`} className="text-brand-600 hover:underline">
                              {r.test.title}
                            </Link>
                          ) : r.trainingEvent ? (
                            <Link href={`/admin/trainings/${r.trainingEvent.id}`} className="text-brand-600 hover:underline">
                              {r.trainingEvent.title}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </p>
                      </div>
                      <ActiveToggle id={r.id} name={r.name} active={r.active} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {umbrella ? <Badge tone={r.office ? "info" : "brand"}>{ownerOf(r)}</Badge> : null}
                      {r.appliesTo.map((role) => (
                        <Badge key={role} tone={role === "MEMBER" ? "brand" : "neutral"}>
                          {role === "MEMBER" ? (r.office ? `Every ${r.office.name} club member` : "Every club member") : ROLE_LABEL[role]}
                        </Badge>
                      ))}
                      {r.gatesCapability ? <Badge tone="warning">Only people with {permissionLabel(r.gatesCapability)}</Badge> : null}
                      <Badge tone="info">{RENEWAL_LABEL[r.renewal]}</Badge>
                      <Badge tone={r.graceDays === 0 ? "warning" : "neutral"}>{r.graceDays === 0 ? "Must be done first" : `${r.graceDays}-day grace period`}</Badge>
                    </div>
                    {r.active && members ? (
                      <p className="mt-3 text-sm text-ink-2">
                        {o.open ? `${o.open} ${o.open === 1 ? "person still owes" : "people still owe"} it` : "Everyone it applies to is done"} ·{" "}
                        {o.waiting ? <span className="text-info">{o.waiting} waiting for grading · </span> : null}
                        <span className={o.overdue ? "font-medium text-danger" : ""}>{o.overdue} overdue</span>
                      </p>
                    ) : r.active ? (
                      <p className="mt-3 text-sm text-ink-2">
                        <span className="text-success">{c.met} met</span> · {c.due} due · {c.review ? <span className="text-info">{c.review} waiting for grading · </span> : null}
                        <span className={c.overdue ? "font-medium text-danger" : ""}>{c.overdue} overdue</span>
                      </p>
                    ) : (
                      <p className="mt-3 text-sm text-ink-3">Off — nobody is asked to complete it.</p>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        title="Where student leaders stand"
        description={umbrella ? "Every current officer, VP, president and ambassador of an approved club, per club." : "Every current officer, VP, president and ambassador of your office's approved clubs. Permissions count every requirement, WSUSA's included."}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Student leaders" value={people} hint={`${rows.length} club roles`} />
          <Stat label="All done" value={allMet} hint="every requirement met" />
          <Stat label={`Due in ${SOON_DAYS} days`} value={dueSoon} hint="still inside the grace period" />
          <Stat label="Permissions paused" value={pausedPeople} hint={pausedPeople ? "overdue in at least one club" : "Nobody is overdue"} />
        </div>

        <form method="get" action="/admin/requirements" className="grid gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,10rem))_auto]">
          <div>
            <label htmlFor="f-q" className="sr-only">
              Search by name or email
            </label>
            <Input id="f-q" name="q" type="search" defaultValue={f.q} placeholder="Search by name or email" />
          </div>
          <div>
            <label htmlFor="f-club" className="sr-only">
              Club
            </label>
            <Select id="f-club" name="club" defaultValue={f.club}>
              <option value="">All clubs</option>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="f-role" className="sr-only">
              Role
            </label>
            <Select id="f-role" name="role" defaultValue={f.role}>
              <option value="">All roles</option>
              {(["PRESIDENT", "VP", "OFFICER", "AMBASSADOR"] as const).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="f-req" className="sr-only">
              Requirement
            </label>
            <Select id="f-req" name="req" defaultValue={f.req}>
              <option value="">All requirements</option>
              {active.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {umbrella && r.office ? ` (${r.office.name})` : ""}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="f-state" className="sr-only">
              Status
            </label>
            <Select id="f-state" name="state" defaultValue={f.state}>
              <option value="">Any status</option>
              <option value="overdue">Overdue</option>
              <option value="due">Due</option>
              <option value="review">Waiting for grading</option>
              <option value="met">All met</option>
              <option value="paused">Permissions paused</option>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="outline">
              Filter
            </Button>
            {filterQuery(f) ? (
              <Link href="/admin/requirements" className={buttonClasses("ghost")}>
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-3" aria-live="polite">
            {shown.length > pageRows.length ? `Showing ${from + 1}–${from + pageRows.length} of ${shown.length}` : `Showing ${shown.length}`}
            {shown.length !== rows.length ? ` (${rows.length} in all)` : ""}
          </p>
          {shown.length ? (
            <a href={`/admin/requirements/export${filterQuery(f)}`} className={buttonClasses("outline", "sm")} download>
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
          ) : null}
        </div>

        {active.length === 0 ? (
          <p className="text-sm text-ink-3">Turn on a requirement to see where leaders stand.</p>
        ) : shown.length === 0 ? (
          <EmptyState icon={<CheckCircle2 />} title="Nobody matches" description={rows.length ? "Try a different filter." : "There are no current student leaders in approved clubs yet."} />
        ) : (
          <>
            <ComplianceTable rows={pageRows} columns={columns.map((c) => ({ id: c.id, name: c.name, owner: umbrella && c.office ? c.office.name : null }))} now={now} />
            {pages > 1 ? <Pager page={page} pages={pages} total={shown.length} noun="club role" /> : null}
          </>
        )}
      </Section>
    </div>
  );
}

function ComplianceTable({ rows, columns, now }: { rows: ComplianceRow[]; columns: { id: string; name: string; owner: string | null }[]; now: Date }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Leader</TH>
          <TH>Club & role</TH>
          {columns.map((c) => (
            <TH key={c.id} className="normal-case tracking-normal">
              {c.name}
              {c.owner ? <span className="block text-xs font-normal text-ink-3">{c.owner}</span> : null}
            </TH>
          ))}
          <TH>Permissions</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.key}>
            <TD>
              <div className="flex items-center gap-2">
                <Avatar name={r.person.name} src={r.person.avatarUrl} color={r.person.avatarColor} size="xs" />
                <div className="min-w-0">
                  <Link href={`/u/${r.person.handle}`} className="block max-w-[11rem] truncate font-medium hover:underline">
                    {r.person.name}
                  </Link>
                  <p className="max-w-[11rem] truncate text-xs text-ink-3">{r.person.email}</p>
                </div>
              </div>
            </TD>
            <TD>
              <Link href={`/clubs/${r.club.slug}/manage/org-chart`} className="block max-w-[12rem] truncate hover:underline">
                {r.club.name}
              </Link>
              <p className="text-xs text-ink-3">
                {r.seat ?? ROLE_LABEL[r.role]} · since {fmtDate(r.startedAt, "MMM d, yyyy")}
              </p>
            </TD>
            {columns.map((c) => (
              <TD key={c.id}>
                <Cell cell={r.cells[c.id]} now={now} />
              </TD>
            ))}
            <TD>
              {r.paused ? (
                <Badge tone="danger">
                  <AlertTriangle className="h-3 w-3" aria-hidden /> Paused
                </Badge>
              ) : r.pausedCapabilities?.length ? (
                <Badge tone="warning">
                  <AlertTriangle className="h-3 w-3" aria-hidden /> {r.pausedCapabilities.map(permissionLabel).join(", ")} paused
                </Badge>
              ) : (
                <Badge tone="success">On</Badge>
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function Cell({ cell, now }: { cell: ComplianceCell | undefined; now: Date }) {
  if (!cell) return <span className="text-xs text-ink-3">Not required</span>;
  if (cell.state === "met")
    return (
      <span className="inline-flex items-center gap-1 text-sm text-success">
        <CheckCircle2 className="h-4 w-4" aria-hidden /> Met
      </span>
    );
  if (cell.state === "overdue")
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-danger">
        <AlertTriangle className="h-4 w-4" aria-hidden /> Overdue since {fmtDate(cell.dueAt, "MMM d")}
      </span>
    );
  // Handed in by the deadline: nothing is late while a grader reviews it.
  if (cell.state === "review")
    return (
      <span className="inline-flex min-w-[11rem] max-w-[12rem] items-start gap-1 text-sm text-info">
        <Hourglass className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {AWAITING_GRADE_LABEL}
      </span>
    );
  const days = Math.ceil((cell.dueAt.getTime() - now.getTime()) / 86_400_000);
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-sm ${days <= SOON_DAYS ? "text-warning" : "text-ink-2"}`}>
      <Clock className="h-4 w-4" aria-hidden /> Due by {fmtDate(cell.dueAt, "MMM d")}
    </span>
  );
}
