import type { ElectionStatus, SuccessionMethod } from "@prisma/client";
import { Check, Trophy } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { format } from "date-fns";
import { selectionStatus, SUCCESSION_NAME } from "@/lib/roles/labels";
import type { Quorum } from "@/lib/roles/pipeline";
import { fmtRange, inCampusTime } from "@/lib/time";

/** A selection's status in its mode's own words ("Voting open", "Waiting for answers", "Waiting to confirm"…). A tied vote that went to a runoff says so. */
export function ElectionStatusBadge({ status, method, proposedCandidateId, wentToRunoff }: { status: ElectionStatus; method: SuccessionMethod; proposedCandidateId?: string | null; wentToRunoff?: boolean }) {
  if (wentToRunoff && status === "CANCELLED") return <Badge tone="neutral">Went to a runoff</Badge>;
  const s = selectionStatus({ status, method, proposedCandidateId });
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Which of the four ways this seat is being filled. */
export function MethodBadge({ method, primary }: { method: SuccessionMethod; primary?: boolean }) {
  return (
    <Badge tone="neutral" title={primary ? "The club's primary method" : undefined}>
      {SUCCESSION_NAME[method]}
      {primary ? <span className="sr-only"> (the club&apos;s primary method)</span> : null}
    </Badge>
  );
}

/** "Thu, Oct 16 at 6:30 PM" in campus time. */
export function fmtWhen(d: Date) {
  return format(inCampusTime(d), "EEE, MMM d 'at' h:mm a");
}

type Step = { label: string; detail: string };

function stepsFor(p: { status: ElectionStatus; method: SuccessionMethod; createdAt: Date; votingOpensAt: Date; votingClosesAt: Date; appliedAt: Date | null; proposedAt: Date | null }): { steps: Step[]; at: number } {
  const closed = p.status === "CLOSED" || p.status === "APPLIED";
  const filled: Step = { label: "Seat filled", detail: p.appliedAt ? fmtWhen(p.appliedAt) : "Once it's confirmed in the org chart" };
  if (p.method === "ADVISOR_PRESIDENT") {
    const at = p.status === "APPLIED" ? 3 : p.proposedAt ? 1 : 0;
    return {
      at: p.status === "CANCELLED" ? -1 : at,
      steps: [
        { label: "Candidates", detail: `From the org chart, ${fmtWhen(p.createdAt)}` },
        { label: "Proposed", detail: p.proposedAt ? fmtWhen(p.proposedAt) : `By the President or an advisor, by ${fmtWhen(p.votingClosesAt)}` },
        { label: "Confirmed", detail: p.appliedAt ? fmtWhen(p.appliedAt) : "By the other of the two" },
      ],
    };
  }
  if (p.method === "NEXT_IN_LINE") {
    const order: ElectionStatus[] = ["VOTING", "CLOSED", "APPLIED"];
    return {
      at: p.status === "CANCELLED" ? -1 : order.indexOf(p.status) + 1,
      steps: [
        { label: "Asked", detail: fmtWhen(p.createdAt) },
        { label: "Answers", detail: closed ? `Closed ${fmtWhen(p.votingClosesAt)}` : `Due ${fmtWhen(p.votingClosesAt)}` },
        { label: "Result", detail: closed ? "The first in line who said yes" : `After ${fmtWhen(p.votingClosesAt)}` },
        filled,
      ],
    };
  }
  const order: ElectionStatus[] = ["NOMINATING", "VOTING", "CLOSED", "APPLIED"];
  return {
    at: p.status === "CANCELLED" ? -1 : order.indexOf(p.status),
    steps: [
      { label: p.method === "SELF_SELECT" ? "Candidates" : "Nominations", detail: `Opened ${fmtWhen(p.createdAt)}` },
      { label: p.method === "SELF_SELECT" ? "Leaders vote" : "Voting", detail: fmtRange(p.votingOpensAt, p.votingClosesAt) },
      { label: "Results", detail: closed ? `Closed ${fmtWhen(p.votingClosesAt)}` : `After ${fmtWhen(p.votingClosesAt)}` },
      filled,
    ],
  };
}

/** Where a selection is now, in its mode's steps (nominations → voting → results → filled, and so on). */
export function ElectionTimeline(p: { status: ElectionStatus; method: SuccessionMethod; createdAt: Date; votingOpensAt: Date; votingClosesAt: Date; appliedAt: Date | null; proposedAt?: Date | null }) {
  const { steps, at } = stepsFor({ ...p, proposedAt: p.proposedAt ?? null });
  return (
    <ol className={cn("grid gap-3", steps.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4")} aria-label="Timeline">
      {steps.map((s, i) => {
        const done = at > i;
        const current = at === i;
        return (
          <li key={s.label} className={cn("rounded-xl border px-3 py-2.5", current ? "border-brand bg-brand-50" : done ? "border-line bg-surface" : "border-dashed border-line-2 bg-surface")} aria-current={current ? "step" : undefined}>
            <p className={cn("flex items-center gap-1.5 text-sm font-semibold", current ? "text-brand" : done ? "text-ink" : "text-ink-3")}>
              {done ? <Check className="h-4 w-4 text-success" aria-hidden /> : <span aria-hidden className={cn("h-2 w-2 rounded-full", current ? "bg-brand" : "bg-line-2")} />}
              {s.label}
              {done ? <span className="sr-only">(done)</span> : current ? <span className="sr-only">(now)</span> : null}
            </p>
            <p className="mt-0.5 text-xs text-ink-3">{s.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}

export type ResultRow = { candidateId: string; name: string; avatarUrl: string | null; avatarColor: string; votes: number; share: number | null; winner: boolean; tied: boolean };

/** Vote counts per candidate and turnout, and whether turnout met the bylaws' quorum. Counts only — never who voted for whom. */
export function ElectionResultsView({ rows, totalVotes, eligibleVoters, turnout, quorum }: { rows: ResultRow[]; totalVotes: number; eligibleVoters: number; turnout: number | null; quorum?: Quorum | null }) {
  const max = Math.max(1, ...rows.map((r) => r.votes));
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.candidateId} className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <Avatar name={r.name} src={r.avatarUrl} color={r.avatarColor} size="xs" />
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.name}</span>
              {r.winner ? (
                <Badge tone="success">
                  <Trophy className="h-3 w-3" aria-hidden /> Winner
                </Badge>
              ) : r.tied ? (
                <Badge tone="warning">Tied</Badge>
              ) : null}
              <span className="w-24 text-right tabular-nums text-ink-2">
                {r.votes} vote{r.votes === 1 ? "" : "s"}
                {r.share !== null ? <span className="text-ink-3"> · {Math.round(r.share * 100)}%</span> : null}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="presentation">
              <div className={cn("h-full rounded-full", r.winner ? "bg-success" : r.tied ? "bg-warning" : "bg-brand-200")} style={{ width: `${(r.votes / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-2">
        {totalVotes} of {eligibleVoters} eligible voter{eligibleVoters === 1 ? "" : "s"} voted
        {turnout !== null ? <span className="text-ink-3"> · {Math.round(turnout * 100)}% turnout</span> : null}
        {quorum ? <span className={quorum.met ? "text-ink-3" : "font-medium text-danger"}> · quorum {quorum.met ? "met" : "not met"} ({quorum.needed} needed)</span> : null}. Ballots are secret — no one can see who voted for whom.
      </p>
    </div>
  );
}
