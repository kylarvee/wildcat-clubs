import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, GraduationCap, UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { liveOccurrencesForUser } from "@/lib/domain/attendance";
import { fmtGraduated, shortName } from "@/lib/profiles/format";
import { fmtDate, inCampusTime } from "@/lib/time";
import { ButtonLink } from "@/components/ui/button";
import { Callout, Container, PageHeader } from "@/components/ui/layout";
import { CalendarView } from "@/components/calendar/CalendarView";
import { LiveCheckinPrompt } from "@/components/attendance/LiveCheckinPrompt";
import { AdminQueue } from "@/components/dashboard/AdminQueue";
import { AdvisingCard } from "@/components/dashboard/AdvisingCard";
import { AppPromptCard } from "@/components/dashboard/AppPromptCard";
import { AttendanceSnapshot } from "@/components/dashboard/AttendanceSnapshot";
import { DashAnnouncements } from "@/components/dashboard/DashAnnouncements";
import { NeedsAttention } from "@/components/dashboard/NeedsAttention";
import { Panel } from "@/components/dashboard/Panel";
import { TaskWidget } from "@/components/dashboard/TaskWidget";
import { WelcomeCard } from "@/components/dashboard/WelcomeCard";
import { YourClubs } from "@/components/dashboard/YourClubs";
import { loadDashboard } from "@/app/dashboard/data";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(now: Date) {
  const h = inCampusTime(now).getHours();
  return h < 5 ? "Hi" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/**
 * Your home base: check in if an event is live, your clubs, what's waiting
 * on you (tasks and, for leaders, approvals), your calendar, announcements,
 * and an attendance snapshot. Leaders, advisors and WSUSA staff each get
 * the panel for their role.
 */
export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const [d, live] = await Promise.all([loadDashboard(user), user.status === "ACTIVE" ? liveOccurrencesForUser(user) : Promise.resolve([])]);
  const first = shortName(user.name);
  const alumni = user.status === "ALUMNI";
  const isFaculty = user.kind === "FACULTY_STAFF";
  // Students with no clubs get the welcome steps; faculty find their clubs through advising.
  const newHere = !alumni && !isFaculty && d.clubs.length === 0;
  const showApp = Boolean(!alumni && d.me && !d.me.hasMobileApp && !d.me.appPromptDismissedAt);
  const showAttendance = d.summaries.length > 0 || d.attendance.termCheckins > 0;

  return (
    <Container size="xl">
      <PageHeader
        title={`${greeting(d.now)}, ${first}`}
        description={`${fmtDate(d.now, "EEEE, MMMM d")}${d.term ? ` · ${d.term.name}` : ""}`}
        actions={
          <>
            <ButtonLink href="/calendar" variant="outline" size="sm">
              <CalendarDays className="h-4 w-4" aria-hidden /> Calendar
            </ButtonLink>
            <ButtonLink href={`/u/${user.handle}`} variant="outline" size="sm">
              <UserRound className="h-4 w-4" aria-hidden /> My profile
            </ButtonLink>
          </>
        }
      />

      {live.length ? <LiveCheckinPrompt occurrences={live} className="mb-6" /> : null}

      {alumni ? (
        <Callout tone="brand" icon={<GraduationCap />} title={`Congratulations, graduate${d.me?.graduatedAt ? ` — ${fmtGraduated(d.me.graduatedAt)}` : ""}!`} className="mb-6">
          Your profile is retired: it keeps every club role, project and file from your time at Weber State.{" "}
          <Link href={`/u/${user.handle}`} className="font-medium underline underline-offset-2">
            See your alumni profile
          </Link>
          .
        </Callout>
      ) : null}

      {/* One column on phones (clubs, then what needs you, then the rest); on wide screens the
          main column runs down the left and the club nav + extras stack on the right. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <YourClubs clubs={d.clubs} canCreate={can(user, "club.create")} alumni={alumni} faculty={isFaculty} />
        </div>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {newHere ? <WelcomeCard firstName={first} /> : null}
          {can(user, "admin.access") ? <AdminQueue rows={d.queue} /> : null}
          {isFaculty ? <AdvisingCard invites={d.invites} advisedCount={d.advisedCount} /> : null}
          {d.led.length ? <NeedsAttention clubs={d.led} /> : null}
          <TaskWidget tasks={d.openTasks} viewerId={user.id} now={d.now} />
          <Panel id="dash-calendar" title="Your calendar" icon={<CalendarDays />} link={{ href: "/calendar", label: "Full calendar" }}>
            <CalendarView source={{ scope: "me" }} compact height={420} emptyMessage="Nothing on your calendar this month. Join or follow a club to fill it in." />
          </Panel>
          <DashAnnouncements userId={user.id} />
        </div>

        {showAttendance || showApp ? (
          <div className="min-w-0 space-y-6 lg:col-start-2 lg:row-start-2 lg:self-start">
            {showAttendance ? (
              <AttendanceSnapshot termLabel={d.attendance.termLabel} termCheckins={d.attendance.termCheckins} activeIn={d.attendance.activeIn} memberClubs={d.summaries.length} summaries={d.summaries} />
            ) : null}
            {showApp ? <AppPromptCard /> : null}
          </div>
        ) : null}
      </div>
    </Container>
  );
}
