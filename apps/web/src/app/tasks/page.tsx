import type { Metadata } from "next";
import Link from "next/link";
import type { TaskKind } from "@prisma/client";
import { CheckCircle2, ClipboardList, Inbox, ListChecks, Send } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { CAPABILITIES } from "@/lib/authz";
import { clubsYouCanAssignIn, listAssignedByYou, listTasks } from "@/lib/domain/tasks";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Container, EmptyState, PageHeader } from "@/components/ui/layout";
import { AutoSubmitSelect } from "@/components/attendance/AutoSubmitSelect";
import { AddTaskForm } from "@/components/tasks/AddTaskForm";
import { AssignTaskDialog } from "@/components/tasks/AssignTaskDialog";
import { TaskList } from "@/components/tasks/TaskList";
import { toTaskItem, type TaskItem } from "@/components/tasks/items";
import { isKind, KIND_ORDER, KIND_PLURAL } from "@/components/tasks/labels";

export const metadata: Metadata = { title: "Tasks" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type View = "open" | "done" | "assigned";

const KIND_FILTER_NOUN: Record<TaskKind, string> = {
  APPROVAL: "approvals",
  REQUIREMENT: "requirements",
  INVOICE: "invoices",
  CLUB: "club tasks",
  PERSONAL: "personal tasks",
};

const OPEN_LIMIT = 300;
const DONE_LIMIT = 100;

/**
 * The Task Manager: everything waiting on you in one list — approvals,
 * officer requirements, invoices, club tasks and your own to-dos. Approvals,
 * requirements and invoices close on their own when the thing is done;
 * personal and club tasks you check off. Leaders can hand club tasks to
 * members and follow them under "Assigned by you".
 */
export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser("/tasks");
  const sp = await searchParams;
  const str = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const view: View = str("view") === "done" ? "done" : str("view") === "assigned" ? "assigned" : "open";
  const kindParam = str("kind");
  const kind: TaskKind | null = isKind(kindParam) ? kindParam : null;
  const clubParam = str("club") ?? null;
  const now = new Date();

  const [open, assignClubs, assignedOpen] = await Promise.all([listTasks(user, { status: "OPEN", take: OPEN_LIMIT }), clubsYouCanAssignIn(user), listAssignedByYou(user, { status: "OPEN" })]);
  const [done, assignedDone] =
    view === "done" ? [await listTasks(user, { status: "DONE", take: DONE_LIMIT }), []] : view === "assigned" ? [[], await listAssignedByYou(user, { status: "DONE", take: 30 })] : [[], []];

  const toItems = (rows: typeof open) => rows.map((t) => toTaskItem(t, user.id, now));
  const openItems = toItems(open);
  const source: TaskItem[] = view === "done" ? toItems(done) : openItems;

  // Counts and the club list come from the list itself, so they match what's shown.
  const kindCounts = new Map<TaskKind, number>();
  for (const t of source) kindCounts.set(t.kind, (kindCounts.get(t.kind) ?? 0) + 1);
  const clubs = new Map<string, { slug: string; name: string; count: number }>();
  for (const t of source)
    if (t.club) {
      const c = clubs.get(t.club.slug);
      if (c) c.count++;
      else clubs.set(t.club.slug, { slug: t.club.slug, name: t.club.name, count: 1 });
    }
  const clubList = [...clubs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const clubFilter = clubParam && (clubs.has(clubParam) || clubParam === "none") ? clubParam : null;
  const filtered = source.filter((t) => (!kind || t.kind === kind) && (!clubFilter || (clubFilter === "none" ? !t.club : t.club?.slug === clubFilter)));

  const overdue = openItems.filter((t) => t.due?.overdue).length;
  const showAssigned = assignClubs.length > 0 || assignedOpen.length > 0;
  const capabilityOptions = Object.entries(CAPABILITIES).map(([value, c]) => ({ value, label: c.label, description: c.description }));

  const href = (next: Partial<{ view: View; kind: TaskKind | null; club: string | null }>) => {
    const q = new URLSearchParams();
    const v = next.view ?? view;
    if (v !== "open") q.set("view", v);
    const k = "kind" in next ? next.kind : kind;
    const c = "club" in next ? next.club : clubFilter;
    if (v !== "assigned") {
      if (k) q.set("kind", k);
      if (c) q.set("club", c);
    }
    const s = q.toString();
    return s ? `/tasks?${s}` : "/tasks";
  };

  const tabs: { key: View; label: string; count?: number; icon: typeof Inbox }[] = [
    { key: "open", label: "Open", count: openItems.length, icon: Inbox },
    { key: "done", label: "Done", icon: CheckCircle2 },
    ...(showAssigned ? [{ key: "assigned" as const, label: "Assigned by you", count: assignedOpen.length, icon: Send }] : []),
  ];

  return (
    <Container>
      <PageHeader
        title="Tasks"
        description={
          openItems.length
            ? `${openItems.length} open${overdue ? ` · ${overdue} overdue` : ""}. Approvals, requirements and invoices close themselves when they're done; check off the rest.`
            : "Approvals, officer requirements, invoices, club tasks and your own to-dos — all in one list."
        }
        actions={assignClubs.length ? <AssignTaskDialog clubs={assignClubs.map((c) => ({ id: c.id, name: c.name, roleLabel: c.roleLabel }))} capabilities={capabilityOptions} /> : null}
      />

      <nav aria-label="Task lists" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => {
          const active = t.key === view;
          return (
            <Link
              key={t.key}
              href={href({ view: t.key, kind: null, club: null })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
                active ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              <t.icon className="h-4 w-4" aria-hidden />
              {t.label}
              {t.count ? <span className="rounded-full bg-brand-50 px-1.5 text-xs text-brand">{t.count}</span> : null}
            </Link>
          );
        })}
      </nav>

      {view === "assigned" ? (
        <AssignedView open={assignedOpen.map((t) => toTaskItem(t, user.id, now))} done={assignedDone.map((t) => toTaskItem(t, user.id, now))} canAssign={assignClubs.length > 0} />
      ) : (
        <div className="space-y-5">
          {view === "open" ? (
            <Card className="p-4 sm:p-5">
              <AddTaskForm />
            </Card>
          ) : null}

          {source.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <nav aria-label="Filter by kind" className="flex flex-wrap gap-1.5">
                <FilterChip href={href({ kind: null })} active={!kind} label="All" count={source.length} />
                {KIND_ORDER.map((k) => (
                  <FilterChip key={k} href={href({ kind: k })} active={kind === k} label={KIND_PLURAL[k]} count={kindCounts.get(k) ?? 0} />
                ))}
              </nav>
              {clubList.length ? (
                <form action="/tasks" method="get" className="flex items-center gap-2">
                  {view !== "open" ? <input type="hidden" name="view" value={view} /> : null}
                  {kind ? <input type="hidden" name="kind" value={kind} /> : null}
                  <label htmlFor="task-club" className="text-sm text-ink-2">
                    Club
                  </label>
                  <AutoSubmitSelect id="task-club" name="club" defaultValue={clubFilter ?? ""} className="h-9 w-56 max-w-[60vw]">
                    <option value="">All clubs</option>
                    {clubList.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name} ({c.count})
                      </option>
                    ))}
                    {source.some((t) => !t.club) ? <option value="none">Not about a club</option> : null}
                  </AutoSubmitSelect>
                  <noscript>
                    <button type="submit" className="text-sm font-medium text-brand-600">
                      Apply
                    </button>
                  </noscript>
                </form>
              ) : null}
            </div>
          ) : null}

          {filtered.length ? (
            <Card className="p-4 sm:p-5">
              <h2 className="sr-only">{view === "open" ? "Open tasks" : "Finished tasks"}</h2>
              <TaskList items={filtered} />
              {view === "done" && done.length >= DONE_LIMIT ? <p className="mt-4 border-t border-line pt-3 text-xs text-ink-3">Showing your {DONE_LIMIT} most recently finished tasks.</p> : null}
              {view === "open" && open.length >= OPEN_LIMIT ? <p className="mt-4 border-t border-line pt-3 text-xs text-ink-3">Showing the first {OPEN_LIMIT} open tasks, soonest due first.</p> : null}
            </Card>
          ) : source.length ? (
            <EmptyState
              icon={<ListChecks />}
              title={kind && !clubFilter ? `No ${KIND_FILTER_NOUN[kind]} ${view === "open" ? "open right now" : "finished yet"}` : "Nothing matches these filters"}
              description={kind && !clubFilter ? "Pick another kind above, or see everything." : "Try another kind or club."}
              action={
                <Link href={href({ kind: null, club: null })} className="text-sm font-medium text-brand-600 hover:underline">
                  Clear filters
                </Link>
              }
            />
          ) : view === "open" ? (
            <EmptyState
              icon={<CheckCircle2 />}
              title="You're all caught up"
              description="Nothing is waiting on you. Approvals, officer requirements and tasks from your clubs will show up here — and anything you add above."
            />
          ) : (
            <EmptyState icon={<ClipboardList />} title="Nothing finished yet" description="Tasks you check off, and approvals that get decided, are kept here." />
          )}
        </div>
      )}
    </Container>
  );
}

function FilterChip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        active ? "border-brand bg-brand text-white" : count ? "border-line-2 bg-surface text-ink-2 hover:bg-muted hover:text-ink" : "border-line bg-surface text-ink-3 hover:bg-muted",
      )}
    >
      {label}
      <span className={cn("tabular-nums", active ? "text-white/80" : "text-ink-3")}>{count}</span>
    </Link>
  );
}

function AssignedView({ open, done, canAssign }: { open: TaskItem[]; done: TaskItem[]; canAssign: boolean }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="assigned-open">
        <h2 id="assigned-open" className="mb-3 text-lg font-semibold text-ink">
          Still open
        </h2>
        {open.length ? (
          <Card className="p-4 sm:p-5">
            <TaskList items={open} mode="assigned" />
          </Card>
        ) : (
          <EmptyState
            icon={<Send />}
            title="No open tasks you've assigned"
            description={canAssign ? "Use “Assign a club task” to hand a to-do to a member of a club you lead. You'll get a notification when they finish it." : "You don't lead a club right now, so you can't assign new tasks."}
          />
        )}
      </section>
      {done.length ? (
        <section aria-labelledby="assigned-done">
          <h2 id="assigned-done" className="mb-3 text-lg font-semibold text-ink">
            Recently finished
          </h2>
          <Card className="p-4 sm:p-5">
            <TaskList items={done} mode="assigned" />
          </Card>
        </section>
      ) : null}
    </div>
  );
}
