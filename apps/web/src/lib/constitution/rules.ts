import type { ClubDocumentKind, JoinPolicy, SuccessionMethod } from "@prisma/client";
import { fieldDoc, fieldIncluded, FIELDS, type DocKind, type DraftData } from "@/lib/constitution/templates";
import { isTieBreak, NO_SELECTION_RULES, type SelectionRules, type TieBreak } from "@/lib/roles/pipeline";
import { SUCCESSION_NAME } from "@/lib/roles/labels";
import type { StaffingGap } from "@/lib/staffing/rules";

/**
 * The builder answers Wildcat Clubs enforces, and the words around them.
 * Pure and client-safe; lib/constitution/club-rules reads them from the
 * club's documents in effect (clubRules), once.
 *
 *   voteMinEvents       member votes: who can vote (lib/domain/elections)
 *   quorumPercent       member votes: whether a result counts
 *   tieBreak            member votes: how a tie is settled
 *   noticeDays          member votes: the earliest voting may open
 *   votingDays          the voting window a new selection suggests (lib/roles/selection-setup)
 *   vacancyDays         when WSUSA's follow-up on an empty President seat is due (lib/domain/staffing)
 *   advisorReplaceDays  when WSUSA's follow-up on a club with no advisor is due
 *
 * Joining and the primary succession method are Club fields, set when the
 * documents are adopted (or a custom one is approved). Each answer is read
 * from the document that asks it, and only from builder documents that kept
 * their answers (ClubDocument.builderAnswers): a custom document in effect
 * sets only what the club stated, and the platform's defaults cover the rest.
 * Everything else the builder asks is written into the documents only; the
 * builder marks the answers a club might expect us to check (FieldDef.clubEnforced).
 */

export type ClubRules = {
  voteMinEvents: number | null;
  quorumPercent: number | null;
  votingDays: number | null;
  tieBreak: TieBreak | null;
  noticeDays: number | null;
  vacancyDays: number | null;
  advisorReplaceDays: number | null;
};

export const NO_CLUB_RULES: ClubRules = { voteMinEvents: null, quorumPercent: null, votingDays: null, tieBreak: null, noticeDays: null, vacancyDays: null, advisorReplaceDays: null };

/** A whole-number answer within the field's limits, when its section is in the documents; else null. */
function numberAnswer(data: DraftData, id: string): number | null {
  if (!fieldIncluded(data, id)) return null;
  const raw = (data.fields[id] ?? "").trim();
  const n = raw ? Number(raw) : NaN;
  const f = FIELDS.get(id);
  if (!Number.isInteger(n) || (f?.min !== undefined && n < f.min) || (f?.max !== undefined && n > f.max)) return null;
  return n;
}

/**
 * The rules in a club's documents in effect. `docs` holds each document's
 * builder answers, or null when that document isn't a builder document with
 * answers (a custom upload, say). Each rule comes from the document that asks it.
 */
export function rulesFromAnswers(docs: Partial<Record<DocKind, DraftData | null>>): ClubRules {
  const from = (id: string) => docs[fieldDoc(id) ?? "bylaws"] ?? null;
  const num = (id: string) => {
    const d = from(id);
    return d ? numberAnswer(d, id) : null;
  };
  const tieDoc = from("tieBreak");
  const tie = tieDoc && fieldIncluded(tieDoc, "tieBreak") ? tieDoc.fields.tieBreak : null;
  return {
    voteMinEvents: num("voteMinEvents"),
    quorumPercent: num("quorumPercent"),
    votingDays: num("votingDays"),
    tieBreak: isTieBreak(tie) ? tie : null,
    noticeDays: num("noticeDays"),
    vacancyDays: num("vacancyDays"),
    advisorReplaceDays: num("advisorReplaceDays"),
  };
}

/** What a new selection freezes in Election.rules. Only member votes use them; the other modes ignore them. */
export function selectionRulesFor(rules: ClubRules): SelectionRules {
  return { ...NO_SELECTION_RULES, minEvents: rules.voteMinEvents, quorumPercent: rules.quorumPercent, tieBreak: rules.tieBreak, noticeDays: rules.noticeDays };
}

/** When WSUSA's staffing task for a gap is due: the bylaws' days to fill an empty President seat, or to find a new advisor. Null when they don't say. */
export function staffingDueAt(gap: StaffingGap, rules: ClubRules, from: Date): Date | null {
  const days = gap === "president" ? rules.vacancyDays : gap === "advisor" ? rules.advisorReplaceDays : null;
  return days ? new Date(from.getTime() + days * 86_400_000) : null;
}

// ─── Words ───────────────────────────────────────────────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Who votes in a member vote, in a phrase: "Members who'd been to at least 2 club events this semester when voting opened". */
export function voterRuleText(minEvents: number | null): string {
  return minEvents ? `Members who've been to at least ${plural(minEvents, "club event")} this semester, counted when voting opens` : "Active members, by WSUSA's activity standard";
}

export function quorumRuleText(quorumPercent: number | null): string {
  return quorumPercent ? `At least ${quorumPercent}% of eligible voters must vote for the result to count` : "Any turnout counts";
}

export function tieRuleText(tieBreak: TieBreak | null): string {
  if (tieBreak === "RUNOFF") return "A runoff between the tied candidates (if that ties too, the advisor decides)";
  if (tieBreak === "ADVISOR") return "The advisor casts the deciding vote";
  if (tieBreak === "PRESIDENT") return "The President casts the deciding vote (the advisor, if the President is tied)";
  return "Whoever applies the result chooses between the tied candidates";
}

export function noticeRuleText(noticeDays: number | null): string {
  return noticeDays ? `Voting opens at least ${plural(noticeDays, "day")} after a vote is announced` : "Voting can open any time after a vote is announced";
}

/** The enforced answers as labelled facts, for the club's Constitution page. */
export function ruleFacts(rules: ClubRules): { label: string; value: string }[] {
  return [
    { label: "Who can vote in member votes", value: voterRuleText(rules.voteMinEvents) },
    { label: "When a member vote counts", value: quorumRuleText(rules.quorumPercent) },
    { label: "Ties in member votes", value: tieRuleText(rules.tieBreak) },
    { label: "Notice before a member vote opens", value: rules.noticeDays ? plural(rules.noticeDays, "day") : "None" },
    { label: "Voting window Wildcat Clubs suggests", value: rules.votingDays ? plural(rules.votingDays, "day") : "2 days" },
    { label: "WSUSA follows up on an empty President seat after", value: rules.vacancyDays ? plural(rules.vacancyDays, "day") : "No set time" },
    { label: "WSUSA follows up on a missing advisor after", value: rules.advisorReplaceDays ? plural(rules.advisorReplaceDays, "day") : "No set time" },
  ];
}

// ─── Custom documents ────────────────────────────────────────────────────────

/** The one setting each kind of document governs: a constitution says how students join, bylaws say how leaders are chosen. */
export function governedSetting(kind: ClubDocumentKind): "joinPolicy" | "successionMethod" | null {
  return kind === "CONSTITUTION" ? "joinPolicy" : kind === "BYLAWS" ? "successionMethod" : null;
}

// ─── Telling people when the settings change ─────────────────────────────────

export type ClubSettings = { joinPolicy: JoinPolicy; successionMethod: SuccessionMethod };
export type SettingsChange = { joinPolicy: { from: JoinPolicy; to: JoinPolicy } | null; successionMethod: { from: SuccessionMethod; to: SuccessionMethod } | null };

/** What changed between the club's settings before and after (null when nothing did). */
export function settingsChange(before: ClubSettings, after: Partial<ClubSettings>): SettingsChange | null {
  const join = after.joinPolicy && after.joinPolicy !== before.joinPolicy ? { from: before.joinPolicy, to: after.joinPolicy } : null;
  const succession = after.successionMethod && after.successionMethod !== before.successionMethod ? { from: before.successionMethod, to: after.successionMethod } : null;
  return join || succession ? { joinPolicy: join, successionMethod: succession } : null;
}

const HOW: Record<SuccessionMethod, string> = {
  ADVISOR_PRESIDENT: "The President or the advisor proposes each new leader, and the other confirms.",
  NEXT_IN_LINE: "When a seat opens, the people in the seats just below it are asked to move up.",
  SELF_SELECT: "The current leaders choose new leaders by secret ballot, and the choice has to be unanimous.",
  MEMBER_VOTE: "Members elect new leaders by secret ballot.",
};

const JOINING: Record<JoinPolicy, { title: (club: string) => string; body: string; phrase: string }> = {
  APPROVAL: { title: (club) => `Joining ${club} now takes a leader's approval`, body: "Join requests wait until a leader with the Members permission approves them.", phrase: "a leader approves each join request" },
  OPEN: { title: (club) => `${club} is now open to join`, body: "Students become members as soon as they register or check in at an event.", phrase: "students become members as soon as they register or check in" },
};

export type ChangeVia = { kind: "adopted"; by: string } | { kind: "custom"; doc: ClubDocumentKind };

/** The notice members and WSUSA get, in plain words: "{club} now uses Self-select to fill seats". */
export function settingsChangeNotice(clubName: string, change: SettingsChange, via: ChangeVia): { title: string; body: string } {
  const how = via.kind === "adopted" ? `${via.by} adopted the club's new constitution and bylaws.` : `WSUSA approved the club's custom ${via.doc === "CONSTITUTION" ? "constitution" : "bylaws"}.`;
  const s = change.successionMethod;
  const j = change.joinPolicy;
  if (s && j) {
    return { title: `${clubName} changed how it fills seats and who can join`, body: `It now uses ${SUCCESSION_NAME[s.to]} to fill seats, and ${JOINING[j.to].phrase}. ${how}` };
  }
  if (s) return { title: `${clubName} now uses ${SUCCESSION_NAME[s.to]} to fill seats`, body: `${HOW[s.to]} Before, it used ${SUCCESSION_NAME[s.from]}. ${how}` };
  const jj = j!;
  return { title: JOINING[jj.to].title(clubName), body: `${JOINING[jj.to].body} ${how}` };
}
