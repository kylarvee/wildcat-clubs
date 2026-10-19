import "server-only";
import { TZDate } from "@date-fns/tz";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/authz";
import { budgetTermFor, getTerms } from "@/lib/terms";
import { campusDate, DAY_MS, TZ } from "@/lib/time";
import { toCampusLocal } from "@/lib/roles/datetime";
import { clubPipeline } from "@/lib/roles/queries";
import { inClubPipeline, nextInLine, noticeEarliest } from "@/lib/roles/pipeline";
import { clubRules } from "@/lib/constitution/club-rules";

/** A campus-time default: `days` from `from` at `hour`:00. */
function campusDefault(days: number, hour: number, from = Date.now()) {
  const d = new TZDate(from + days * DAY_MS, TZ);
  return campusDate(d.getFullYear(), d.getMonth() + 1, d.getDate(), hour, 0);
}

/**
 * What the "Fill a seat" form needs: the seats the club fills itself (in
 * pipeline order), who's next in line for each, which are already being
 * filled, a term label for the title, and campus-time date defaults for each
 * mode (a voting window, a respond-by date, a decide-by date). The voting
 * window is the bylaws' votingDays (2 days without one), and a member vote
 * gets its own defaults that respect the bylaws' notice (noticeDays), with
 * the rules the form explains.
 */
export async function selectionSetup(clubId: string) {
  const [pipeline, running, terms, rules] = await Promise.all([
    clubPipeline(clubId),
    db.election.findMany({ where: { clubId, status: { in: ["NOMINATING", "VOTING", "CLOSED"] } }, select: { id: true, positionId: true } }),
    getTerms(),
    clubRules(clubId),
  ]);
  const own = pipeline.seats.filter((s) => inClubPipeline(s.role, pipeline.clubType));
  const ids = [...new Set(pipeline.seats.flatMap((s) => s.holders.map((h) => h.userId)))];
  const names = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const runningBySeat = new Map(running.map((r) => [r.positionId, r.id]));
  const opens = campusDefault(3, 9);
  const closesAfter = (from: Date) => campusDefault(rules.votingDays ?? 2, 17, from.getTime());
  // A member vote opens no sooner than the bylaws' notice: the first 9 AM after it, if that's later than the usual default.
  const earliest = noticeEarliest(new Date(), rules.noticeDays);
  let memberOpens = opens;
  if (earliest && rules.noticeDays && memberOpens < earliest) {
    memberOpens = campusDefault(rules.noticeDays, 9);
    if (memberOpens < earliest) memberOpens = campusDefault(rules.noticeDays + 1, 9);
  }
  return {
    pipeline,
    names,
    runningBySeat,
    rules,
    seats: own.map((s) => ({
      id: s.id,
      name: s.name,
      roleLabel: ROLE_LABEL[s.role],
      busy: runningBySeat.has(s.id),
      nextInLine: nextInLine(pipeline.seats, s.id, pipeline.clubType).map((p) => names.get(p.userId) ?? "Someone"),
    })),
    defaults: {
      opens: toCampusLocal(opens),
      closes: toCampusLocal(closesAfter(opens)),
      respondBy: toCampusLocal(campusDefault(7, 17)),
      decideBy: toCampusLocal(campusDefault(14, 17)),
      /** A runoff opens at once and stays open the bylaws' window. */
      runoffCloses: toCampusLocal(campusDefault(rules.votingDays ?? 2, 17)),
      memberVote: {
        opens: toCampusLocal(memberOpens),
        closes: toCampusLocal(closesAfter(memberOpens)),
        earliest: earliest ? toCampusLocal(earliest) : null,
        noticeDays: rules.noticeDays,
        votingDays: rules.votingDays,
        minEvents: rules.voteMinEvents,
        quorumPercent: rules.quorumPercent,
        tieBreak: rules.tieBreak,
      },
    },
    termLabel: budgetTermFor(terms, opens)?.name ?? null,
  };
}
