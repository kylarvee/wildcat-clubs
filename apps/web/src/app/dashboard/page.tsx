import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can, isAdmin } from "@/lib/authz";
import { liveOccurrencesForUser } from "@/lib/domain/attendance";
import { INSTITUTION } from "@/lib/institution";
import { fmtGraduated, shortName } from "@/lib/profiles/format";
import { fmtDate, inCampusTime } from "@/lib/time";
import { Callout, Container, PageHeader } from "@/components/ui/layout";
import { LiveCheckinPrompt } from "@/components/attendance/LiveCheckinPrompt";
import { AdminQueue } from "@/components/dashboard/AdminQueue";
import { AppPromptCard } from "@/components/dashboard/AppPromptCard";
import { DashAnnouncements } from "@/components/dashboard/DashAnnouncements";
import { OfficerRequirements } from "@/components/dashboard/OfficerRequirements";
import { RequirementsOverview } from "@/components/dashboard/RequirementsOverview";
import { TaskWidget } from "@/components/dashboard/TaskWidget";
import { WeekAgenda } from "@/components/dashboard/WeekAgenda";
import { WelcomeCard } from "@/components/dashboard/WelcomeCard";
import { WsusaAnnouncements } from "@/components/dashboard/WsusaAnnouncements";
import { YourClubs } from "@/components/dashboard/YourClubs";
import { loadDashboard } from "@/app/dashboard/data";

export const metadata: Metadata = { title: "Dashboard" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function greeting(now: Date) {
  const h = inCampusTime(now).getHours();
  return h < 5 ? "Hi" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/**
 * Your home base, in three columns that stack on a phone:
 *   left    your switchboard — your clubs (leaders' clubs first, as cards),
 *           or for WSUSA staff the shared admin queue;
 *   middle  what only the dashboard shows — announcements from WSUSA and your
 *           clubs (staff: what WSUSA requires, and WSUSA's own posts);
 *   right   previews of tools with their own pages — tasks (required first),
 *           advisors' officer requirements, and this week's calendar.
 * Check-in prompts for a live event sit above everything.
 */
export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser("/dashboard");
  const sp = await searchParams;
  const [d, live] = await Promise.all([loadDashboard(user), user.status === "ACTIVE" ? liveOccurrencesForUser(user) : Promise.resolve([])]);
  const first = shortName(user.name);
  const alumni = user.status === "ALUMNI";
  const faculty = user.kind === "FACULTY_STAFF";
  const admin = isAdmin(user);
  // Students with no clubs get the welcome steps; faculty find their clubs through advising.
  const newHere = !alumni && !faculty && d.clubs.length === 0;
  const showApp = Boolean(!alumni && d.me && !d.me.hasMobileApp && !d.me.appPromptDismissedAt);

  return (
    <Container size="xl">
      <PageHeader
        title={`${greeting(d.now)}, ${first}`}
        description={[fmtDate(d.now, "EEEE, MMMM d"), d.term?.name, admin ? `${INSTITUTION.studentGovernment} administrator` : null].filter(Boolean).join(" · ")}
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

      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-[1_1_260px] space-y-6">
          {admin ? <AdminQueue rows={d.queue} /> : null}
          {!admin || d.clubs.length ? <YourClubs clubs={d.clubs} now={d.now} canCreate={can(user, "club.create")} alumni={alumni} faculty={faculty} /> : null}
        </div>

        <div className="min-w-0 flex-[999_1_520px] space-y-8">
          {newHere ? <WelcomeCard firstName={first} /> : null}
          {d.overview ? <RequirementsOverview rows={d.overview.rows} pausedLeaders={d.overview.pausedLeaders} now={d.now} /> : null}
          {admin && can(user, "admin.announce") ? <WsusaAnnouncements actor={user} /> : <DashAnnouncements userId={user.id} older={sp.announcements === "older"} />}
        </div>

        <div className="min-w-0 flex-[1_1_300px] space-y-6">
          <TaskWidget
            tasks={d.tasks}
            viewerId={user.id}
            now={d.now}
            title={admin ? "Your tasks" : "Tasks"}
            note={admin ? "Work shared by the admin team stays in the WSUSA queue." : undefined}
          />
          {d.officers.length ? <OfficerRequirements clubs={d.officers} /> : null}
          <WeekAgenda items={d.agenda} now={d.now} admin={admin} />
          {showApp ? <AppPromptCard /> : null}
        </div>
      </div>
    </Container>
  );
}
