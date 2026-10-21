import Link from "next/link";
import { CircleCheck, CircleDashed, Clock, FileText, Gavel, Palette, Sparkles, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import type { Club } from "@prisma/client";
import type { ClubAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { INSTITUTION } from "@/lib/institution";
import { officeForClub } from "@/lib/offices";
import { fmtLongDate } from "@/lib/time";
import { foundingChecklist, type DocState } from "@/lib/domain/clubs";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Callout, ProgressBar } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { AdvisorPanel } from "@/components/founding/AdvisorPanel";
import { SubmitForReview } from "@/components/founding/SubmitForReview";

function Step({ n, done, waiting, title, icon, summary, children }: { n: number; done: boolean; waiting?: boolean; title: string; icon: ReactNode; summary: ReactNode; children?: ReactNode }) {
  return (
    <Card>
      <CardBody className="flex gap-4">
        <div className="flex flex-col items-center">
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", done ? "bg-success-50 text-success" : waiting ? "bg-info-50 text-info" : "bg-muted text-ink-3")}>
            {done ? <CircleCheck className="h-5 w-5" aria-hidden /> : waiting ? <Clock className="h-5 w-5" aria-hidden /> : <CircleDashed className="h-5 w-5" aria-hidden />}
          </span>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-3 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
              {icon}
            </span>
            <h3 className="font-semibold text-ink">
              <span className="sr-only">Step {n}: </span>
              {title}
            </h3>
            <Badge tone={done ? "success" : waiting ? "info" : "neutral"}>{done ? "Done" : waiting ? "Waiting" : "To do"}</Badge>
          </div>
          <div className="text-sm text-ink-2">{summary}</div>
          {children}
        </div>
      </CardBody>
    </Card>
  );
}

function docLine(label: string, d: DocState, office: string) {
  if (!d) return { label, text: "Not adopted yet", tone: "neutral" as const };
  if (d.status === "ACTIVE") return { label, text: d.source === "BUILDER" ? `Adopted with the builder (v${d.version}) on ${fmtLongDate(d.createdAt)}` : `Custom document approved (v${d.version})`, tone: "success" as const };
  return { label, text: `Custom upload waiting for ${office}'s approval — counts toward your checklist`, tone: "info" as const };
}

/**
 * DRAFT and CHANGES_REQUESTED: the founding checklist with live status. The
 * club goes to the office that oversees it (lib/offices: club sports to
 * Campus Recreation, Greek chapters to Fraternity & Sorority Life, else WSUSA).
 */
export async function FoundingOverview({ club, access, justCreated }: { club: Club; access: ClubAccess; justCreated: boolean }) {
  const [check, invites, lastChanges, office] = await Promise.all([
    foundingChecklist(club.id),
    db.advisorInvite.findMany({ where: { clubId: club.id, status: "PENDING" }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, email: true, createdAt: true, inviteeId: true } }),
    club.status === "CHANGES_REQUESTED"
      ? db.clubDecision.findFirst({ where: { clubId: club.id, action: "CHANGES_REQUESTED" }, orderBy: { at: "desc" }, include: { by: { select: { name: true } } } })
      : null,
    officeForClub(club.id),
  ]);
  const doneCount = [check.profile.done, check.advisor.done, check.documents.done].filter(Boolean).length;
  const base = `/clubs/${club.slug}/manage`;
  const has = (c: Parameters<typeof access.capabilities.has>[0]) => access.capabilities.has(c);
  const docs = [docLine("Constitution", check.documents.constitution, office.name), docLine("Bylaws", check.documents.bylaws, office.name)];

  return (
    <div className="space-y-5">
      {justCreated ? (
        <Callout tone="success" icon={<Sparkles />} title={`${club.name} is saved as a draft`}>
          Three things to finish, then you can send it to {office.name} for review. Only your club&apos;s leaders and {office.name} can see it until it&apos;s approved.
        </Callout>
      ) : null}

      {lastChanges ? (
        <Callout tone="warning" title={`${office.name} asked for changes`}>
          <p className="whitespace-pre-line">{lastChanges.note}</p>
          <p className="mt-2 text-xs opacity-80">
            {lastChanges.by.name} · {fmtLongDate(lastChanges.at)}. Make the changes below, then resubmit.
          </p>
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Founding checklist</h2>
          <p className="text-sm text-ink-3">
            {doneCount} of 3 done{check.ready ? " — you're ready to submit." : "."}
          </p>
        </div>
        <ProgressBar value={doneCount} max={3} tone={check.ready ? "success" : "brand"} className="w-full sm:w-56" />
      </div>

      <Step
        n={1}
        done={check.profile.done}
        title="Complete your profile"
        icon={<Palette />}
        summary={
          check.profile.done ? (
            "Name, descriptions, and where your club sits are all set. You can keep polishing anytime."
          ) : (
            <>
              Still needed: <span className="font-medium text-ink">{check.profile.gaps.join(", ")}</span>.
            </>
          )
        }
      >
        {has("profile") ? (
          <ButtonLink href={`${base}/profile`} variant={check.profile.done ? "outline" : "primary"} size="sm">
            {check.profile.done ? "Edit profile" : "Finish profile"}
          </ButtonLink>
        ) : null}
      </Step>

      <Step
        n={2}
        done={check.advisor.done}
        waiting={!check.advisor.done && invites.length > 0}
        title="Get a faculty or staff advisor"
        icon={<UserPlus />}
        summary={
          check.advisor.done
            ? "Your advisor accepted. They have full access to help you set up."
            : invites.length
              ? "Your invitation is out. This step checks itself off when they accept."
              : `Every club needs a ${INSTITUTION.shortName} faculty or staff advisor. Invite them by name and @${INSTITUTION.staffEmailDomain} email.`
        }
      >
        <AdvisorPanel
          clubId={club.id}
          canInvite={access.canInviteAdvisor}
          staffDomain={INSTITUTION.staffEmailDomain}
          advisors={check.advisor.advisors}
          invites={invites.map((i) => ({ id: i.id, name: i.name, email: i.email, sentLabel: fmtLongDate(i.createdAt), hasAccount: Boolean(i.inviteeId) }))}
        />
      </Step>

      <Step
        n={3}
        done={check.documents.done}
        waiting={check.documents.done && [check.documents.constitution, check.documents.bylaws].some((d) => d?.status === "PENDING_APPROVAL")}
        title="Adopt your constitution & bylaws"
        icon={<Gavel />}
        summary="The builder starts you with a constitution and bylaws written for Weber State clubs. Adopting them also sets how members join and how leaders are chosen."
      >
        <ul className="space-y-1.5">
          {docs.map((d) => (
            <li key={d.label} className="flex flex-wrap items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-ink-3" aria-hidden />
              <span className="font-medium text-ink">{d.label}:</span>
              <span className={cn(d.tone === "success" ? "text-success" : d.tone === "info" ? "text-info" : "text-ink-3")}>{d.text}</span>
            </li>
          ))}
        </ul>
        {has("constitution") ? (
          <ButtonLink href={`${base}/constitution`} variant={check.documents.done ? "outline" : "primary"} size="sm">
            {check.documents.done ? "View documents" : "Open the constitution builder"}
          </ButtonLink>
        ) : null}
      </Step>

      <Card className={cn(check.ready && "border-brand-200 ring-1 ring-brand-100")}>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="font-semibold text-ink">{club.status === "CHANGES_REQUESTED" ? `Resubmit to ${office.name}` : `Submit to ${office.name}`}</h3>
            {check.ready ? (
              <p className="text-sm text-ink-2">
                Everything&apos;s in place. {office.name} usually decides within {office.reviewDays} days.
              </p>
            ) : (
              <div id="submit-blocked" className="text-sm text-ink-3">
                <p>Finish these first:</p>
                <ul className="mt-1 list-disc pl-5">
                  {check.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {has("profile") ? (
            <SubmitForReview clubId={club.id} clubName={club.name} ready={check.ready} resubmission={club.status === "CHANGES_REQUESTED"} reviewDays={office.reviewDays} office={office.name} />
          ) : (
            <p className="text-sm text-ink-3">Your President or advisor submits the club.</p>
          )}
        </CardBody>
      </Card>

      <p className="text-sm text-ink-3">
        While you work on this, you can also set up your{" "}
        <Link href={`${base}/org-chart`} className="font-medium text-brand-600 hover:underline">
          org chart
        </Link>{" "}
        and{" "}
        <Link href={`${base}/files`} className="font-medium text-brand-600 hover:underline">
          club files
        </Link>
        . Events, budgets and attendance unlock once {office.name} approves your club.
      </p>

      <PolicyNotices placement="CLUB_CREATION" title="Policies for new clubs" />
    </div>
  );
}
