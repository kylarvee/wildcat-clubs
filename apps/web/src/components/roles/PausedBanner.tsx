import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Actor } from "@/lib/auth/session";
import { CAPABILITIES } from "@/lib/authz";
import { pauseReasons, type PauseReason } from "@/lib/domain/requirements";
import { fmtDate } from "@/lib/time";
import { Callout } from "@/components/ui/layout";

/** How each kind of requirement is cleared, and the link that does it. */
const CLEAR: Record<PauseReason["kind"], { when: string; action: string }> = {
  TEST: { when: "you pass it", action: "Take the test" },
  FORM: { when: "you submit it", action: "Fill out the form" },
  TRAINING: { when: "you check in at a session", action: "See training sessions" },
  PROFILE: { when: "you confirm your member details", action: "Update your member details" },
};

function Step({ r }: { r: PauseReason }) {
  if (r.gradingPending) return <>You handed it in after the deadline, so {r.capability ? CAPABILITIES[r.capability].label : "your permissions"} come{r.capability ? "s" : ""} back once it&apos;s graded as passed.</>;
  return (
    <Link href={r.href} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
      {CLEAR[r.kind].action} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

/**
 * The club workspace's "Permissions paused" banner: which requirement for
 * the viewer's role here is overdue, and how to clear it (pauseReasons, the
 * same rule getClubAccess pauses by). A single-permission requirement (like
 * Event Safety Training for Events) pauses only its permission, and the
 * banner says just that. Render it when access.suspended or
 * access.pausedCapabilities has something.
 */
export async function PausedBanner({ actor, clubId, className }: { actor: Actor; clubId: string; className?: string }) {
  const reasons = await pauseReasons(actor, clubId);
  const everything = reasons.some((r) => r.capability === null);
  if (reasons.length && !everything) return <PermissionPaused reasons={reasons} className={className} />;
  const [only] = reasons;
  return (
    <Callout tone="warning" className={className} title="Permissions paused">
      {reasons.length === 1 ? (
        <p>
          <span className="font-semibold">{only.name}</span> was due {fmtDate(only.dueAt, "MMM d")}, so your permissions in this club are paused. Your title stays
          {only.gradingPending ? ". " : <>, and your permissions come back as soon as {CLEAR[only.kind].when}. </>}
          <Step r={only} />
        </p>
      ) : reasons.length > 1 ? (
        <>
          <p>These requirements for your role are overdue, so your permissions in this club are paused. Your title stays, and your permissions come back as soon as they&apos;re all done.</p>
          <ul className="mt-2 space-y-1.5">
            {reasons.map((r) => (
              <li key={r.id}>
                <span className="font-semibold">{r.name}</span> · was due {fmtDate(r.dueAt, "MMM d")} · <Step r={r} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          A requirement for your role is overdue. Finish it from{" "}
          <Link href="/tasks" className="underline">
            your tasks
          </Link>{" "}
          and your permissions come back right away.
        </p>
      )}
    </Callout>
  );
}

/** Only some permissions are paused: "Events is paused until you finish Event Safety Training." */
function PermissionPaused({ reasons, className }: { reasons: PauseReason[]; className?: string }) {
  const labels = [...new Set(reasons.map((r) => CAPABILITIES[r.capability!].label))];
  const title = `${labels.join(" and ")} paused`;
  return (
    <Callout tone="warning" className={className} title={title}>
      <ul className="space-y-1.5">
        {reasons.map((r) => {
          const what = CAPABILITIES[r.capability!].label;
          return (
            <li key={r.id}>
              {what} is paused until you finish <span className="font-semibold">{r.name}</span> (it was due {fmtDate(r.dueAt, "MMM d")}).{" "}
              {r.gradingPending ? null : <>It comes back as soon as {CLEAR[r.kind].when}. </>}
              <Step r={r} />
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-sm">Your title and your other permissions keep working.</p>
    </Callout>
  );
}
