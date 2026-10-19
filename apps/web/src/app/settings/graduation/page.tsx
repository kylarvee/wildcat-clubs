import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Award, GraduationCap, History, Lock, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getConfigValue } from "@/lib/config";
import { db } from "@/lib/db";
import { lastLeaderSeats } from "@/lib/domain/staffing";
import { INSTITUTION } from "@/lib/institution";
import { fmtGraduated, toDateInput } from "@/lib/profiles/format";
import { myRoleOptions } from "@/lib/profiles/queries";
import { ClubLogo } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Callout } from "@/components/ui/layout";
import { GraduationForm } from "@/components/profile/settings/GraduationForm";

export const metadata: Metadata = { title: "Settings · Graduation" };

/**
 * Graduating: the student marks themself graduated. Their roles end
 * (Graduated) through the org chart's own path, memberships become alumni,
 * and the profile is retired — fully visible, read-only, history intact.
 * The last President of a club is shown that club first, with a link to
 * pass the torch; they can still graduate, and WSUSA then gets a staffing
 * task for the empty seat (lib/domain/staffing).
 */
export default async function GraduationSettingsPage() {
  const actor = await requireUser("/settings/graduation");
  const supportEmail = await getConfigValue("platform.supportEmail");
  if (actor.kind !== "STUDENT") {
    return (
      <Callout tone="info" icon={<GraduationCap />} title="Graduation is for student accounts">
        Faculty and staff accounts stay as they are. If you&apos;re leaving {INSTITUTION.shortName}, ask the clubs you advise to invite a new advisor, or email {INSTITUTION.studentGovernment} at{" "}
        <a href={`mailto:${supportEmail}`} className="font-medium underline underline-offset-2">
          {supportEmail}
        </a>
        .
      </Callout>
    );
  }

  const me = await db.user.findUnique({ where: { id: actor.id }, select: { status: true, graduatedAt: true, handle: true } });
  if (!me) notFound();

  if (me.status === "ALUMNI") {
    return (
      <Card className="p-6 text-center sm:p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand">
          <GraduationCap className="h-7 w-7" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-semibold text-ink">You graduated{me.graduatedAt ? ` in ${fmtGraduated(me.graduatedAt)}` : ""} — congratulations, Wildcat!</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-ink-2">
          Your profile is retired. It stays as the record of your time in {INSTITUTION.shortName} clubs — every role, project and file — and anyone signed in with a Weber State account can still see it.
        </p>
        <Link href={`/u/${me.handle}`} className="mt-4 inline-flex text-sm font-medium text-brand-600 hover:underline">
          See your alumni profile
        </Link>
      </Card>
    );
  }

  const [roles, memberships] = await Promise.all([
    myRoleOptions(actor.id),
    db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE" }, select: { club: { select: { id: true, name: true, slug: true, logoUrl: true, logoColor: true } } }, orderBy: { club: { name: "asc" } } }),
  ]);
  const current = roles.filter((r) => r.current);
  // Clubs they're the last President of: graduating leaves the seat empty, so they pass the torch first if they can.
  const lastPresidencies = (await lastLeaderSeats(actor.id)).filter((s) => s.role === "PRESIDENT").map((s) => ({ name: s.clubName, slug: s.clubSlug }));

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <GraduationCap className="h-5 w-5 text-brand" aria-hidden /> Graduating from {INSTITUTION.shortName}
        </h2>
        <p className="mt-2 text-sm text-ink-2">When you graduate, your profile becomes an alumni profile. Here&apos;s what happens:</p>
        <ul className="mt-4 space-y-3 text-sm">
          <li className="flex gap-3">
            <Award className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            <span className="text-ink-2">
              <span className="font-medium text-ink">Your club roles end.</span> Each club&apos;s role history records them as “Graduated”, and the club&apos;s leaders hear the seat is open.
            </span>
          </li>
          <li className="flex gap-3">
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            <span className="text-ink-2">
              <span className="font-medium text-ink">Your memberships become alumni memberships.</span> Pending join requests are withdrawn, and the WSUSA requirements, tests and club tasks you owe are closed.
            </span>
          </li>
          <li className="flex gap-3">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            <span className="text-ink-2">
              <span className="font-medium text-ink">Your profile is retired.</span> It shows an Alumni badge and your graduation date, and it can&apos;t be edited from the moment you confirm.
            </span>
          </li>
          <li className="flex gap-3">
            <History className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            <span className="text-ink-2">
              <span className="font-medium text-ink">Your history stays.</span> Roles, projects, files and activity remain on your profile and in every club, for good.
            </span>
          </li>
        </ul>
        <p className="mt-4 text-sm text-ink-3">
          Want to polish your profile first?{" "}
          <Link href="/settings" className="font-medium text-brand-600 hover:underline">
            Update it now
          </Link>{" "}
          — your About, experience and projects are frozen as soon as you confirm.
        </p>
      </Card>

      {lastPresidencies.length ? (
        <Callout tone="warning" icon={<AlertTriangle />} title="Pass the torch first">
          <p>
            You&apos;re the last President of {lastPresidencies.length === 1 ? "this club" : "these clubs"}. Hand off the presidency before you graduate, so{" "}
            {lastPresidencies.length === 1 ? "it always has" : "each one always has"} a President. If you graduate first, the seat stays empty and WSUSA is asked to help fill it.
          </p>
          <ul className="mt-2 space-y-1">
            {lastPresidencies.map((c) => (
              <li key={c.slug}>
                <span className="font-medium">{c.name}</span> ·{" "}
                <Link href={`/clubs/${c.slug}/manage/org-chart#pass-the-torch`} className="font-medium underline underline-offset-2">
                  Passing the torch
                </Link>
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {current.length || memberships.length ? (
        <Card className="p-5 sm:p-6">
          <h2 className="text-base font-semibold text-ink">What changes for you</h2>
          {current.length ? (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-3">Roles that end</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {current.map((r) => (
                  <li key={r.id} className="text-ink-2">
                    <span className="font-medium text-ink">{r.label}</span> · {r.clubName}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {memberships.length ? (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-3">Clubs where you become alumni</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {memberships.map(({ club }) => (
                  <li key={club.id} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-sm text-ink">
                    <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="sm" className="h-5 w-5 rounded text-[9px]" />
                    {club.name}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-semibold text-ink">Ready?</h2>
        <p className="mt-1 text-sm text-ink-3">Only mark this once you&apos;ve actually graduated.</p>
        <div className="mt-4">
          <GraduationForm
            handle={me.handle}
            today={toDateInput(new Date())}
            roleCount={current.length}
            clubCount={memberships.length}
            lastPresidencies={lastPresidencies}
            supportEmail={supportEmail}
          />
        </div>
      </Card>
    </div>
  );
}
