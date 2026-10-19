import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/layout";
import { quorumOf, type SelectionRules } from "@/lib/roles/pipeline";
import { tieRuleText } from "@/lib/constitution/rules";
import { fmtWhen } from "@/components/elections/ElectionBits";

const events = (n: number) => `${n} club event${n === 1 ? "" : "s"}`;

/**
 * The bylaw rules a member vote runs under (frozen when it started), with the
 * numbers behind them: who can vote and why, the quorum and how close
 * turnout is, how a tie is settled, and the notice before voting opened.
 * The same card on the member page and the organizers' page.
 */
export function MemberVoteRules(p: {
  rules: SelectionRules;
  basis: "attendance" | "active" | "leaders" | "none";
  eligible: number;
  /** Registered members on an attendance roll, to say how many can't vote. */
  members: number | null;
  termName: string | null;
  /** Voting has opened, so the roll is final. */
  final: boolean;
  votingOpensAt: Date;
  /** Ballots cast (turnout, never choices): so far while voting is open, in all once it closed. */
  votes: number | null;
  /** Voting has closed. */
  closed?: boolean;
  /** When voting may open under the notice rule (null: no rule). */
  opensFrom: Date | null;
  /** A runoff: the tied vote it settles. */
  runoffOf: { href: string; title: string } | null;
}) {
  const r = p.rules;
  const quorum = quorumOf({ quorumPercent: r.quorumPercent, eligibleVoters: p.eligible, votes: p.votes ?? 0 });
  const anyRule = Boolean(r.minEvents || r.quorumPercent || r.tieBreak || r.noticeDays || r.runoffOf);
  const who =
    p.basis === "attendance" && r.minEvents
      ? p.final
        ? `${p.eligible} of ${p.members ?? p.eligible} members: everyone who'd been to at least ${events(r.minEvents)} this semester${p.termName ? ` (${p.termName})` : ""} when voting opened, ${fmtWhen(p.votingOpensAt)}.`
        : `${p.eligible} of ${p.members ?? p.eligible} members so far have been to at least ${events(r.minEvents)} this semester${p.termName ? ` (${p.termName})` : ""}. It's counted again when voting opens, ${fmtWhen(p.votingOpensAt)}, and that count is final.`
      : `${p.eligible} active member${p.eligible === 1 ? "" : "s"}: checked in recently, by WSUSA's activity standard.`;

  return (
    <Card>
      <CardHeader
        title="Voting rules"
        description={anyRule ? "From the club's bylaws, as they stood when this vote started." : "The club's bylaws in effect when this vote started set no voting rules, so Wildcat Clubs' standard ones apply."}
      />
      <CardBody>
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">Who can vote</dt>
            <dd className="mt-0.5 text-ink">{who}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">When the result counts</dt>
            <dd className="mt-0.5 space-y-1.5 text-ink">
              {quorum ? (
                <>
                  <p>
                    At least {quorum.needed} of the {p.eligible} eligible voters ({quorum.percent}%) must vote. With fewer, nobody wins: it&apos;s “No quorum.”
                  </p>
                  {p.votes !== null ? (
                    <div className="space-y-1">
                      <ProgressBar value={p.votes} max={quorum.needed} tone={quorum.met ? "success" : "brand"} />
                      <p className="text-xs text-ink-3">
                        {p.closed
                          ? `${p.votes} voted${quorum.met ? ", enough for the result to count" : `, ${quorum.needed - p.votes} short, so it didn't count`}.`
                          : `${p.votes} voted so far${quorum.met ? ", enough for the result to count" : `, ${quorum.needed - p.votes} more needed`}.`}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : (
                <p>Any turnout counts.</p>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">If it&apos;s a tie</dt>
            <dd className="mt-0.5 text-ink">{tieRuleText(r.runoffOf && r.tieBreak === "RUNOFF" ? "ADVISOR" : r.tieBreak)}.</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">Notice</dt>
            <dd className="mt-0.5 text-ink">
              {p.runoffOf ? (
                <>
                  A runoff opens right away: it settles a tie in{" "}
                  <Link href={p.runoffOf.href} className="underline">
                    {p.runoffOf.title}
                  </Link>
                  , which members already knew about.
                </>
              ) : r.noticeDays ? (
                `Voting opens at least ${r.noticeDays} day${r.noticeDays === 1 ? "" : "s"} after the vote was announced${p.opensFrom ? ` (from ${fmtWhen(p.opensFrom)})` : ""}.`
              ) : (
                "None: voting can open any time after the vote is announced."
              )}
            </dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}

export type RollPerson = { userId: string; name: string; handle: string; avatarUrl: string | null; avatarColor: string; attended: number; eligible: boolean };

/**
 * Who can vote under the bylaws' attendance rule, and why: every registered
 * member and their count of club events this semester. The counts are
 * attendance details, so only people who may see the club's attendance get
 * them (`showCounts`); others see who can and can't vote.
 */
export function VoterRollCard({ people, minEvents, final, showCounts }: { people: RollPerson[]; minEvents: number; final: boolean; showCounts: boolean }) {
  const can = people.filter((x) => x.eligible);
  const cannot = people.filter((x) => !x.eligible);
  const list = (title: string, rows: RollPerson[], empty: string) => (
    <div className="min-w-0 px-5 py-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">{title}</p>
      {rows.length ? (
        <ul className="max-h-72 divide-y divide-line overflow-y-auto pr-1">
          {rows.map((x) => (
            <li key={x.userId} className="flex items-center gap-2.5 py-2 text-sm">
              <Avatar name={x.name} src={x.avatarUrl} color={x.avatarColor} size="xs" />
              <Link href={`/u/${x.handle}`} className="min-w-0 flex-1 truncate text-ink hover:underline">
                {x.name}
              </Link>
              {showCounts ? (
                <span className="shrink-0 tabular-nums text-ink-3">{events(x.attended)}</span>
              ) : (
                <Badge tone={x.eligible ? "success" : "neutral"}>{x.eligible ? `${minEvents}+ events` : `Under ${minEvents}`}</Badge>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">{empty}</p>
      )}
    </div>
  );
  return (
    <Card>
      <CardHeader
        title={`Who can vote (${can.length} of ${people.length})`}
        description={
          final
            ? `Counted when voting opened: club events each member had been to this semester. ${events(minEvents)} needed.`
            : `So far this semester. It's counted again when voting opens, and that count is final. ${events(minEvents)} needed.`
        }
      />
      <div className="grid sm:grid-cols-2 sm:divide-x sm:divide-line">
        {list(`Can vote (${can.length})`, can, "Nobody yet.")}
        {list(`${final ? "Can't vote" : "Not yet"} (${cannot.length})`, cannot, "Everyone can vote.")}
      </div>
    </Card>
  );
}
