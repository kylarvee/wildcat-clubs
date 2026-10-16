import type { ElectionStatus } from "@prisma/client";
import { Check, Trophy } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { format } from "date-fns";
import { ELECTION_STATUS_LABEL, ELECTION_STATUS_TONE } from "@/lib/roles/labels";
import { fmtRange, inCampusTime } from "@/lib/time";

export function ElectionStatusBadge({ status }: { status: ElectionStatus }) {
  return <Badge tone={ELECTION_STATUS_TONE[status]}>{ELECTION_STATUS_LABEL[status]}</Badge>;
}

/** "Thu, Oct 16 at 6:30 PM" in campus time. */
export function fmtWhen(d: Date) {
  return format(inCampusTime(d), "EEE, MMM d 'at' h:mm a");
}

/** Nominations → voting → results, with where the election is now. */
export function ElectionTimeline({
  status,
  createdAt,
  votingOpensAt,
  votingClosesAt,
  appliedAt,
}: {
  status: ElectionStatus;
  createdAt: Date;
  votingOpensAt: Date;
  votingClosesAt: Date;
  appliedAt: Date | null;
}) {
  const order: ElectionStatus[] = ["NOMINATING", "VOTING", "CLOSED", "APPLIED"];
  const at = status === "CANCELLED" ? -1 : order.indexOf(status);
  const steps = [
    { label: "Nominations", detail: `Opened ${fmtWhen(createdAt)}`, i: 0 },
    { label: "Voting", detail: fmtRange(votingOpensAt, votingClosesAt), i: 1 },
    { label: "Results", detail: status === "CLOSED" || status === "APPLIED" ? `Closed ${fmtWhen(votingClosesAt)}` : `After ${fmtWhen(votingClosesAt)}`, i: 2 },
    { label: "Applied to the org chart", detail: appliedAt ? fmtWhen(appliedAt) : "Once results are confirmed", i: 3 },
  ];
  return (
    <ol className="grid gap-3 sm:grid-cols-4" aria-label="Election timeline">
      {steps.map((s) => {
        const done = at > s.i;
        const current = at === s.i;
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

/** Vote counts per candidate and turnout. Counts only — never who voted for whom. */
export function ElectionResultsView({ rows, totalVotes, eligibleVoters, turnout }: { rows: ResultRow[]; totalVotes: number; eligibleVoters: number; turnout: number | null }) {
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
        {turnout !== null ? <span className="text-ink-3"> · {Math.round(turnout * 100)}% turnout</span> : null}. Ballots are secret — no one can see who voted for whom.
      </p>
    </div>
  );
}
