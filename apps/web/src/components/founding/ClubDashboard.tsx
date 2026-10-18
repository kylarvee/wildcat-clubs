import Link from "next/link";
import {
  ArrowRight, BadgeCheck, CalendarDays, ClipboardCheck, FolderOpen, Gavel, Inbox, Lock, Megaphone, Network, Palette, Settings, Users, Vote, Wallet,
} from "lucide-react";
import type { Club } from "@prisma/client";
import type { Capability, ClubAccess } from "@/lib/authz";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { clubActivity } from "@/lib/metrics";
import { STANDING_HINT, STANDING_LABEL, STANDING_TONE, standingOf } from "@/lib/labels/clubs";
import { DAY_MS, fmtLongDate, fmtRange } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";
import { ActivityFeed } from "@/components/founding/ActivityFeed";

const TOOLS: { key: string; label: string; desc: string; icon: typeof Users; cap: Capability | null }[] = [
  { key: "profile", label: "Club profile", desc: "Description, logo, documents", icon: Palette, cap: "profile" },
  { key: "members", label: "Members", desc: "Roster and join requests", icon: Users, cap: "roster" },
  { key: "org-chart", label: "Org chart", desc: "Seats, roles, hand-offs", icon: Network, cap: null },
  { key: "events", label: "Events", desc: "Plan meetings and co-host", icon: CalendarDays, cap: "events" },
  { key: "attendance", label: "Attendance", desc: "Check-in and records", icon: ClipboardCheck, cap: "attendance" },
  { key: "budget", label: "Budget & funding", desc: "Costs and funding requests", icon: Wallet, cap: "budget" },
  { key: "announcements", label: "Announcements", desc: "Post to members", icon: Megaphone, cap: "announcements" },
  { key: "elections", label: "Elections", desc: "Secret-ballot votes", icon: Vote, cap: "elections" },
  { key: "tests", label: "Club tests", desc: "Build and grade tests", icon: BadgeCheck, cap: "tests" },
  { key: "files", label: "Files", desc: "Shared club documents", icon: FolderOpen, cap: "files" },
  { key: "constitution", label: "Constitution", desc: "Constitution and bylaws", icon: Gavel, cap: "constitution" },
  { key: "settings", label: "Settings", desc: "Membership, co-hosting, retire", icon: Settings, cap: null },
];

/** APPROVED: the club's home base — key numbers, what needs attention, tools, recent activity. */
export async function ClubDashboard({ club, access }: { club: Club; access: ClubAccess }) {
  const now = new Date();
  const base = `/clubs/${club.slug}/manage`;
  const [activity, cfg, pendingJoins, pendingCohosts, upcoming, tasks, taskCount] = await Promise.all([
    // Same call as the workspace header's standing, so the two always agree (and share one computation).
    clubActivity(club.id),
    getConfig(),
    db.membership.count({ where: { clubId: club.id, status: "PENDING" } }),
    db.eventCohost.count({ where: { clubId: club.id, status: "PENDING" } }),
    db.eventOccurrence.findMany({
      where: {
        status: "SCHEDULED",
        startsAt: { gte: now, lte: new Date(now.getTime() + 30 * DAY_MS) },
        event: { status: "SCHEDULED", OR: [{ clubId: club.id }, { cohosts: { some: { clubId: club.id, status: "APPROVED" } } }] },
      },
      orderBy: { startsAt: "asc" },
      take: 100,
      select: { id: true, startsAt: true, endsAt: true, event: { select: { title: true, allDay: true } } },
    }),
    db.task.findMany({ where: { clubId: club.id, status: "OPEN", assigneeType: "CLUB" }, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 6 }),
    db.task.count({ where: { clubId: club.id, status: "OPEN", assigneeType: "CLUB" } }),
  ]);

  // Registered members come from lib/metrics (students only), so this matches the club page.
  const members = activity.registeredMembers;
  const standing = standingOf(activity);
  const standingHint = standing === "pilot" && activity.pilotEndsAt ? `Counts as active through ${fmtLongDate(activity.pilotEndsAt)}` : STANDING_HINT[standing];
  const next = upcoming[0];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Members" value={members} hint={pendingJoins ? `${pendingJoins} waiting to join` : "Registered members"} />
        <Stat label="Attending members" value={activity.activeMembers} hint={`Checked in within ${cfg["activity.studentWindowDays"]} days or at one of the last ${cfg["activity.studentRecentEvents"]} events`} />
        <Stat label="Coming up" value={upcoming.length} hint={next ? `In the next 30 days. Next: ${next.event.title}` : "Nothing in the next 30 days"} />
        <Stat label="Open to-dos" value={taskCount} hint={taskCount ? "Waiting on your leaders" : "All caught up"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Activity standing" action={<Badge tone={STANDING_TONE[standing]}>{STANDING_LABEL[standing]}</Badge>} description={standingHint} />
            <CardBody className="space-y-2 text-sm">
              <p className="text-ink-2">
                {activity.heldEventsCurrentTerm} event{activity.heldEventsCurrentTerm === 1 ? "" : "s"} held this term · {activity.heldEventsPreviousTerm} last term · {members} registered members
              </p>
              {activity.reasons.length ? (
                <ul className="list-disc space-y-1 pl-5 text-ink-3">
                  {activity.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Needs attention" description="Requests and to-dos waiting on your club's leaders." />
            <CardBody className="space-y-3">
              {pendingJoins || pendingCohosts ? (
                <div className="flex flex-wrap gap-2">
                  {pendingJoins ? (
                    <Link href={`${base}/members`} className="inline-flex items-center gap-1.5 rounded-full bg-warning-50 px-3 py-1 text-sm font-medium text-warning ring-1 ring-amber-200 hover:underline">
                      {pendingJoins} join request{pendingJoins === 1 ? "" : "s"}
                    </Link>
                  ) : null}
                  {pendingCohosts ? (
                    <Link href={`${base}/events`} className="inline-flex items-center gap-1.5 rounded-full bg-warning-50 px-3 py-1 text-sm font-medium text-warning ring-1 ring-amber-200 hover:underline">
                      {pendingCohosts} co-host request{pendingCohosts === 1 ? "" : "s"}
                    </Link>
                  ) : null}
                </div>
              ) : null}
              {tasks.length ? (
                <ul className="divide-y divide-line">
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <Link href={t.href ?? "/tasks"} className="flex items-center gap-3 py-2.5 text-sm hover:text-brand">
                        <Inbox className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        {t.dueAt ? <span className="shrink-0 text-xs text-ink-3">Due {fmtLongDate(t.dueAt)}</span> : null}
                        <ArrowRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : !pendingJoins && !pendingCohosts ? (
                <p className="text-sm text-ink-3">Nothing waiting on your leaders right now.</p>
              ) : null}
              {taskCount > tasks.length ? (
                <Link href="/tasks" className="text-sm font-medium text-brand-600 hover:underline">
                  See all {taskCount} in your tasks
                </Link>
              ) : null}
            </CardBody>
          </Card>

          <section aria-labelledby="tools-heading" className="space-y-3">
            <h2 id="tools-heading" className="text-lg font-semibold text-ink">
              Club tools
            </h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {TOOLS.map((t) => {
                const locked = t.cap !== null && !access.capabilities.has(t.cap);
                return (
                  <li key={t.key}>
                    <Link
                      href={`${base}/${t.key}`}
                      className={cn("flex h-full items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-[var(--shadow-card)] transition-colors hover:border-brand-200 hover:bg-brand-50/40", locked && "opacity-60")}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand">
                        <t.icon className="h-4.5 w-4.5" aria-hidden />
                      </span>
                      <span className="min-w-0 text-sm">
                        <span className="flex items-center gap-1.5 font-medium text-ink">
                          {t.label}
                          {locked ? <Lock className="h-3.5 w-3.5 text-ink-3" aria-label="You don't have this permission" /> : null}
                        </span>
                        <span className="block text-ink-3">{t.desc}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Coming up" />
            <CardBody>
              {upcoming.length ? (
                <ul className="space-y-3">
                  {upcoming.slice(0, 4).map((o) => (
                    <li key={o.id} className="text-sm">
                      <span className="block font-medium text-ink">{o.event.title}</span>
                      <span className="block text-ink-3">{fmtRange(o.startsAt, o.endsAt, o.event.allDay)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-3">
                  No events in the next 30 days.{" "}
                  {access.capabilities.has("events") ? (
                    <Link href={`${base}/events`} className="font-medium text-brand-600 hover:underline">
                      Plan one
                    </Link>
                  ) : null}
                </p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent activity" />
            <CardBody>
              <ActivityFeed clubId={club.id} />
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
