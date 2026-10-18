import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canDirectMessage } from "@/lib/domain/messaging";
import { MessageButton } from "@/components/messages/MessageButton";
import { Briefcase, CalendarCheck, FolderKanban, GraduationCap, Link2, Lock, Pencil, Sparkles, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { INSTITUTION } from "@/lib/institution";
import { loadProfile, profileUser, type ProfileData } from "@/lib/profiles/queries";
import { fmtExperienceRange, fmtGraduated, fmtYearSpan, shortName } from "@/lib/profiles/format";
import { Avatar, ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/layout";
import { RichContent } from "@/components/rich/RichContent";
import { ActivityList } from "@/components/profile/ActivityList";
import { ProjectItem } from "@/components/profile/ProjectItem";
import { RoleGroup } from "@/components/profile/RoleGroup";
import { LogoMark } from "@/components/shell/Logo";

type Props = { params: Promise<{ handle: string }>; searchParams: Promise<{ activity?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // Names stay private to signed-in university accounts — even in the tab title.
  const viewer = await getCurrentUser();
  if (!viewer) return { title: "Student profile" };
  const user = await profileUser((await params).handle);
  return { title: user && user.status !== "DEACTIVATED" ? user.name : "Profile not found" };
}

/**
 * A person's profile, LinkedIn style: header, About, Experience (club roles
 * from the org chart plus their own experience), Education, Projects and
 * Activity. Visible only to signed-in Weber State accounts; alumni profiles
 * are retired (read-only) but stay fully visible.
 */
export default async function ProfilePage({ params, searchParams }: Props) {
  const { handle } = await params;
  const viewer = await getCurrentUser();
  if (!viewer) return <SignedOut handle={handle} />;

  const user = await profileUser(handle);
  if (!user || user.status === "DEACTIVATED") notFound();
  const showAllActivity = (await searchParams).activity === "all";
  const data = await loadProfile(user, viewer, { activityTake: showAllActivity ? 100 : 12 });
  const now = new Date();
  const first = shortName(user.name);

  return (
    <Container size="lg">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          <ProfileHeader data={data} />
          {!data.isSelf && (await canDirectMessage(viewer, user.id)) ? (
            <div className="-mt-3 flex justify-end">
              <MessageButton userId={user.id} name={user.name} />
            </div>
          ) : null}

          <ProfileSection title="About" icon={<Sparkles />}>
            {user.aboutHtml ? (
              <RichContent html={user.aboutHtml} />
            ) : (
              <Empty self={data.isSelf} href="/settings" action="Add an About section">
                {data.isSelf ? "Tell other Wildcats what you're into, what you're studying and what you want to build." : `${first} hasn't written an About section yet.`}
              </Empty>
            )}
          </ProfileSection>

          <ProfileSection title="Experience" icon={<Briefcase />} id="experience">
            {data.roleGroups.length || data.experiences.length ? (
              <div className="space-y-6">
                {data.roleGroups.length ? (
                  <div>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">At {INSTITUTION.shortName} clubs</h3>
                    <ul className="divide-y divide-line">
                      {data.roleGroups.map((g) => (
                        <RoleGroup key={g.club.id} group={g} now={now} />
                      ))}
                    </ul>
                  </div>
                ) : null}
                {data.experiences.length ? (
                  <div className={data.roleGroups.length ? "border-t border-line pt-5" : ""}>
                    {data.roleGroups.length ? <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Other experience</h3> : null}
                    <ul className="divide-y divide-line">
                      {data.experiences.map((e) => (
                        <li key={e.id} className="flex gap-3 py-4 first:pt-0 last:pb-0 sm:gap-4">
                          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-ink-3">
                            <Briefcase className="h-5 w-5" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <h4 className="font-semibold text-ink">{e.title}</h4>
                              {!e.endDate ? <Badge tone="success">Current</Badge> : null}
                            </div>
                            <p className="text-sm text-ink-2">
                              {e.organization}
                              {e.location ? <span className="text-ink-3"> · {e.location}</span> : null}
                            </p>
                            <p className="text-sm text-ink-3">{fmtExperienceRange(e.startDate, e.endDate, now)}</p>
                            {e.description ? <p className="mt-2 whitespace-pre-line text-sm text-ink-2">{e.description}</p> : null}
                            {e.source === "LINKEDIN_IMPORT" ? <p className="mt-1.5 text-xs text-ink-3">Imported from LinkedIn</p> : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <Empty self={data.isSelf} href="/settings/experience" action="Add experience">
                {data.isSelf
                  ? "Club roles show up here on their own when a club leader adds you to their org chart. Add jobs, internships and volunteering yourself — or import them from LinkedIn."
                  : `${first} hasn't held a club role or added experience yet.`}
              </Empty>
            )}
          </ProfileSection>

          <EducationSection data={data} />

          <ProfileSection title="Projects" icon={<FolderKanban />} id="projects">
            {data.projects.length ? (
              <div className="divide-y divide-line">
                {data.projects.map((p) => (
                  <ProjectItem key={p.id} project={p} showClub />
                ))}
              </div>
            ) : (
              <Empty self={data.isSelf} href="/settings/projects" action="Add a project">
                {data.isSelf ? "Show off things you built, ran or wrote — with links and files. Projects from a club role appear under that role in Experience." : `${first} hasn't added any projects outside their club roles.`}
              </Empty>
            )}
          </ProfileSection>

          <ProfileSection
            title="Activity"
            icon={<CalendarCheck />}
            id="activity"
            action={
              data.activityHasMore && !showAllActivity ? (
                <Link href={`/u/${user.handle}?activity=all#activity`} className="text-sm font-medium text-brand-600 hover:underline">
                  Show all
                </Link>
              ) : null
            }
          >
            {data.activity.length ? (
              <ActivityList items={data.activity} now={now} />
            ) : (
              <p className="text-sm text-ink-3">{data.isSelf ? "Joining clubs, taking on roles and reviewing clubs shows up here." : "Nothing to show yet."}</p>
            )}
          </ProfileSection>
        </div>

        <aside className="min-w-0 space-y-6">
          {user.status === "ALUMNI" ? (
            <Card className="p-5">
              <div className="flex items-center gap-2 font-semibold text-ink">
                <GraduationCap className="h-5 w-5 text-brand" aria-hidden /> Alumni profile
              </div>
              <p className="mt-2 text-sm text-ink-2">
                {data.isSelf ? "You" : first} graduated{user.graduatedAt ? ` in ${fmtGraduated(user.graduatedAt)}` : ""}. This profile is retired: it stays as a record of {data.isSelf ? "your" : "their"} time at {INSTITUTION.shortName}, including every club role and contribution.
              </p>
            </Card>
          ) : null}

          {data.isSelf ? (
            <Card className="p-5">
              <div className="flex items-center gap-2 font-semibold text-ink">
                <Lock className="h-4 w-4 text-ink-3" aria-hidden /> Your attendance
              </div>
              <p className="mt-2 text-sm text-ink-2">Your check-ins aren&apos;t on your profile. Only you, your clubs&apos; attendance leaders, advisors and WSUSA can see them.</p>
              <Link href="/me/attendance" className="mt-3 inline-flex text-sm font-medium text-brand-600 hover:underline">
                See my attendance
              </Link>
            </Card>
          ) : null}

          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-semibold text-ink">
              <Users className="h-4 w-4 text-ink-3" aria-hidden /> Clubs
            </h2>
            {data.clubs.length ? (
              <ul className="mt-3 space-y-3">
                {data.clubs.map((c) => (
                  <li key={c.id}>
                    <Link href={`/clubs/${c.slug}`} className="group flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-brand">
                      <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink group-hover:text-brand-600 group-hover:underline">{c.name}</span>
                        <span className="block text-xs text-ink-3">{c.roleLabel ?? "Member"}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-3">
                {user.status === "ALUMNI" ? "Club memberships became alumni memberships at graduation." : data.isSelf ? "You haven't joined a club yet." : `${first} isn't in any clubs right now.`}
              </p>
            )}
            {data.isSelf && user.status === "ACTIVE" ? (
              <Link href="/clubs" className="mt-4 inline-flex text-sm font-medium text-brand-600 hover:underline">
                Browse clubs
              </Link>
            ) : null}
          </Card>
        </aside>
      </div>
    </Container>
  );
}

function ProfileHeader({ data }: { data: ProfileData }) {
  const { user } = data;
  const student = user.kind === "STUDENT";
  // "Psychology major · Spanish minor", "Physics & Math majors"
  const study = [
    data.majors.length ? `${data.majors.join(" & ")} major${data.majors.length === 1 ? "" : "s"}` : null,
    data.minors.length ? `${data.minors.join(" & ")} minor${data.minors.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return (
    <Card className="overflow-hidden">
      {/* Weber State purple banner; the avatar overlaps it like a profile card. */}
      <div className="h-24 bg-[linear-gradient(120deg,var(--color-brand-700),var(--color-brand-600)_60%,var(--color-brand-200))] sm:h-28" aria-hidden />
      <div className="px-5 pb-5 sm:px-6">
        <div className="-mt-12 flex items-end justify-between gap-3">
          <Avatar name={user.name} src={user.avatarUrl} color={user.avatarColor} size="xl" className="ring-4" />
          {data.isSelf && user.status === "ACTIVE" ? (
            <ButtonLink href="/settings" variant="outline" size="sm" className="mb-1">
              <Pencil className="h-4 w-4" aria-hidden /> Edit profile
            </ButtonLink>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{user.name}</h1>
          {user.pronouns ? <span className="text-sm text-ink-3">({user.pronouns})</span> : null}
          {user.status === "ALUMNI" ? (
            <Badge tone="brand" className="uppercase tracking-wide">
              <GraduationCap className="h-3 w-3" aria-hidden /> Alumni
            </Badge>
          ) : null}
          {!student ? <Badge tone="info">Faculty &amp; staff</Badge> : null}
        </div>
        {user.headline ? <p className="mt-1 text-ink-2">{user.headline}</p> : null}
        <div className="mt-2 space-y-0.5 text-sm text-ink-3">
          {student && study.length ? <p>{study.join(" · ")}</p> : null}
          {!student && (user.jobTitle || user.department) ? <p>{[user.jobTitle, user.department?.name].filter(Boolean).join(" · ")}</p> : null}
          {user.status === "ALUMNI" && user.graduatedAt ? (
            <p className="font-medium text-brand">Graduated {fmtGraduated(user.graduatedAt)}</p>
          ) : student && user.classYear ? (
            <p>Class of {user.classYear}</p>
          ) : null}
        </div>
        {user.linkedinUrl ? (
          <a href={user.linkedinUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
            <Link2 className="h-4 w-4" aria-hidden /> LinkedIn profile<span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    </Card>
  );
}

function EducationSection({ data }: { data: ProfileData }) {
  const { user } = data;
  const student = user.kind === "STUDENT";
  // A typed-in Weber State row merges into the automatic one instead of repeating it.
  const wsuRow = student ? data.educations.find((e) => /weber\s*state/i.test(e.school)) : undefined;
  const others = data.educations.filter((e) => e !== wsuRow);
  const showWsu = student && (data.majors.length || data.minors.length || user.classYear || wsuRow || user.graduatedAt);
  if (!showWsu && !others.length) {
    return (
      <ProfileSection title="Education" icon={<GraduationCap />} id="education">
        <Empty self={data.isSelf} href={student ? "/settings" : "/settings/education"} action={student ? "Add your majors" : "Add education"}>
          {data.isSelf ? (student ? "Add your majors, minors and class year so people know what you study." : "Add the schools you've attended.") : "Nothing listed yet."}
        </Empty>
      </ProfileSection>
    );
  }
  const wsuYears = wsuRow ? fmtYearSpan(wsuRow.startYear, wsuRow.endYear) : user.graduatedAt ? `Graduated ${fmtGraduated(user.graduatedAt)}` : user.classYear ? `Class of ${user.classYear}` : "";
  return (
    <ProfileSection title="Education" icon={<GraduationCap />} id="education">
      <ul className="divide-y divide-line">
        {showWsu ? (
          <li className="flex gap-3 py-4 first:pt-0 last:pb-0 sm:gap-4">
            <span className="shrink-0">
              <LogoMark size={48} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-ink">{INSTITUTION.name}</h3>
              {wsuRow?.degree || wsuRow?.field ? <p className="text-sm text-ink-2">{[wsuRow.degree, wsuRow.field].filter(Boolean).join(", ")}</p> : null}
              {data.majors.length ? <p className="text-sm text-ink-2">{data.majors.length === 1 ? "Major" : "Majors"}: {data.majors.join(", ")}</p> : null}
              {data.minors.length ? <p className="text-sm text-ink-2">{data.minors.length === 1 ? "Minor" : "Minors"}: {data.minors.join(", ")}</p> : null}
              {wsuYears ? <p className="text-sm text-ink-3">{wsuYears}</p> : null}
              {wsuRow?.description ? <p className="mt-2 whitespace-pre-line text-sm text-ink-2">{wsuRow.description}</p> : null}
            </div>
          </li>
        ) : null}
        {others.map((e) => (
          <li key={e.id} className="flex gap-3 py-4 first:pt-0 last:pb-0 sm:gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-ink-3">
              <GraduationCap className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-ink">{e.school}</h3>
              {e.degree || e.field ? <p className="text-sm text-ink-2">{[e.degree, e.field].filter(Boolean).join(", ")}</p> : null}
              {fmtYearSpan(e.startYear, e.endYear) ? <p className="text-sm text-ink-3">{fmtYearSpan(e.startYear, e.endYear)}</p> : null}
              {e.description ? <p className="mt-2 whitespace-pre-line text-sm text-ink-2">{e.description}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </ProfileSection>
  );
}

function ProfileSection({ title, icon, id, action, children }: { title: string; icon: React.ReactNode; id?: string; action?: React.ReactNode; children: React.ReactNode }) {
  const headingId = `${id ?? title.toLowerCase()}-heading`;
  return (
    <Card className="scroll-mt-24 p-5 sm:p-6" id={id} aria-labelledby={headingId} role="region">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold text-ink [&>svg]:h-5 [&>svg]:w-5 [&>svg]:text-ink-3">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Empty({ self, href, action, children }: { self: boolean; href: string; action: string; children: React.ReactNode }) {
  return (
    <div className="text-sm text-ink-3">
      <p>{children}</p>
      {self ? (
        <Link href={href} className="mt-2 inline-flex font-medium text-brand-600 hover:underline">
          {action}
        </Link>
      ) : null}
    </div>
  );
}

function SignedOut({ handle }: { handle: string }) {
  const next = `/u/${encodeURIComponent(handle)}`;
  return (
    <Container size="md">
      <Card className="mx-auto max-w-lg p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand">
          <Lock className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-ink">Profiles are for {INSTITUTION.shortName} accounts</h1>
        <p className="mt-2 text-sm text-ink-2">
          To protect student information, profiles are only visible when you&apos;re signed in with a Weber State account — @{INSTITUTION.studentEmailDomain} for students or @{INSTITUTION.staffEmailDomain} for faculty and staff.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ButtonLink href={`/login?next=${encodeURIComponent(next)}`}>Sign in to see this profile</ButtonLink>
          <ButtonLink href="/clubs" variant="outline">
            Browse clubs
          </ButtonLink>
        </div>
      </Card>
    </Container>
  );
}
