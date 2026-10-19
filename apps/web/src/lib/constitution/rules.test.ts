import { describe, expect, it } from "vitest";
import { defaultDraftData, FIELDS, fieldDoc, SECTIONS, TIE_BREAK_OPTIONS, type DraftData } from "@/lib/constitution/templates";
import { governedSetting, NO_CLUB_RULES, rulesFromAnswers, ruleFacts, selectionRulesFor, settingsChange, settingsChangeNotice, staffingDueAt } from "@/lib/constitution/rules";
import { renderDoc } from "@/lib/constitution/render";
import { TIE_BREAKS } from "@/lib/roles/pipeline";

/** The builder answers Wildcat Clubs enforces (lib/constitution/rules), and the words around them. */

const facts = { name: "Weber State Chess Club", type: "REGISTERED" as const, departmentName: null, collegeName: null };
const DAY = 86_400_000;

/** Psi Chi's bylaws in the seed: a member vote with an attendance requirement and a quorum. */
function psychAnswers(): DraftData {
  const d = defaultDraftData({ successionMethod: "MEMBER_VOTE" });
  d.modules.bylaws = [...d.modules.bylaws, "voteAttendance"];
  d.fields.voteMinEvents = "2";
  d.fields.quorumPercent = "25";
  return d;
}

const text = (kind: "constitution" | "bylaws", data: DraftData, title: string) =>
  renderDoc(kind, data, facts)
    .articles.find((a) => a.title === title)!
    .blocks.map((b) => (b.type === "p" ? b.text : b.items.join(" ")))
    .join(" ");

describe("the rules helper", () => {
  it("reads the defaults: no attendance requirement until the section is on", () => {
    const d = defaultDraftData();
    expect(rulesFromAnswers({ constitution: d, bylaws: d })).toEqual({ voteMinEvents: null, quorumPercent: 25, votingDays: 3, tieBreak: "RUNOFF", noticeDays: 7, vacancyDays: 14, advisorReplaceDays: 30 });
  });

  it("reads the attendance requirement and quorum a club wrote", () => {
    const d = psychAnswers();
    expect(rulesFromAnswers({ constitution: d, bylaws: d })).toMatchObject({ voteMinEvents: 2, quorumPercent: 25 });
  });

  it("reads each answer from the document that asks it", () => {
    expect(fieldDoc("advisorReplaceDays")).toBe("constitution");
    for (const id of ["voteMinEvents", "quorumPercent", "votingDays", "tieBreak", "noticeDays", "vacancyDays"]) expect(fieldDoc(id)).toBe("bylaws");
    const d = psychAnswers();
    // Custom bylaws in effect: only the builder constitution's answers apply.
    expect(rulesFromAnswers({ constitution: d, bylaws: null })).toEqual({ ...NO_CLUB_RULES, advisorReplaceDays: 30 });
    // A custom constitution: the builder bylaws still set the voting rules.
    expect(rulesFromAnswers({ constitution: null, bylaws: d })).toEqual({ voteMinEvents: 2, quorumPercent: 25, votingDays: 3, tieBreak: "RUNOFF", noticeDays: 7, vacancyDays: 14, advisorReplaceDays: null });
    expect(rulesFromAnswers({})).toEqual(NO_CLUB_RULES);
  });

  it("ignores answers outside the field's limits", () => {
    const d = psychAnswers();
    d.fields.quorumPercent = "140";
    d.fields.votingDays = "2.5";
    d.fields.noticeDays = "";
    d.fields.tieBreak = "COIN_FLIP";
    expect(rulesFromAnswers({ constitution: d, bylaws: d })).toMatchObject({ quorumPercent: null, votingDays: null, noticeDays: null, tieBreak: null });
  });

  it("freezes the member-vote rules into a new selection", () => {
    const d = psychAnswers();
    expect(selectionRulesFor(rulesFromAnswers({ constitution: d, bylaws: d }))).toEqual({ minEvents: 2, quorumPercent: 25, tieBreak: "RUNOFF", noticeDays: 7, runoffOf: null });
  });

  it("dates WSUSA's staffing tasks from the vacancy and advisor answers", () => {
    const d = defaultDraftData();
    const rules = rulesFromAnswers({ constitution: d, bylaws: d });
    const from = new Date("2026-10-19T18:00:00Z");
    expect(staffingDueAt("president", rules, from)?.getTime()).toBe(from.getTime() + 14 * DAY);
    expect(staffingDueAt("advisor", rules, from)?.getTime()).toBe(from.getTime() + 30 * DAY);
    expect(staffingDueAt("approver", rules, from)).toBeNull();
    expect(staffingDueAt("president", NO_CLUB_RULES, from)).toBeNull();
  });

  it("lists the enforced answers for the club's Constitution page", () => {
    const d = psychAnswers();
    const facts = ruleFacts(rulesFromAnswers({ constitution: d, bylaws: d }));
    expect(facts.find((f) => f.label === "Who can vote in member votes")?.value).toContain("at least 2 club events this semester");
    expect(facts.find((f) => f.label === "When a member vote counts")?.value).toContain("25%");
  });
});

describe("the builder is honest about what it enforces", () => {
  const all = [...SECTIONS.constitution, ...SECTIONS.bylaws].flatMap((s) => s.fields);

  it("marks the answers no engine reads as the club's to enforce", () => {
    const clubOnly = all.filter((f) => f.clubEnforced).map((f) => f.id).sort();
    expect(clubOnly).toEqual(["amendmentVote", "duesAmount", "minGpa", "removalVote", "termLength"]);
  });

  it("says what Wildcat Clubs does with every answer it applies", () => {
    const applied = all.filter((f) => f.applies).map((f) => f.id).sort();
    expect(applied).toEqual(["advisorReplaceDays", "joinPolicy", "noticeDays", "quorumPercent", "successionMethod", "tieBreak", "vacancyDays", "voteMinEvents", "votingDays"]);
    expect(all.filter((f) => f.applies && f.clubEnforced)).toEqual([]);
  });

  it("offers the three ways to settle a tie", () => {
    expect(TIE_BREAK_OPTIONS.map((o) => o.value)).toEqual([...TIE_BREAKS]);
    expect(FIELDS.get("tieBreak")?.options?.map((o) => o.value)).toEqual(["RUNOFF", "ADVISOR", "PRESIDENT"]);
  });

  it("doesn't claim Wildcat Clubs runs removal or amendment votes", () => {
    const d = defaultDraftData();
    const voting = text("bylaws", d, "Voting Procedures");
    expect(voting).toContain("Votes on leadership are held in Wildcat Clubs by secret ballot.");
    expect(voting).toContain("Wildcat Clubs doesn't run them");
    expect(voting).not.toMatch(/removal and amendments are held in Wildcat Clubs/);
    expect(text("bylaws", d, "Removal")).toContain("Wildcat Clubs doesn't run removal votes");
    expect(text("constitution", d, "Amendments")).toContain("Wildcat Clubs doesn't run them");
    expect(text("constitution", d, "Officer Requirements")).toContain("Wildcat Clubs doesn't see grades");
  });

  it("says what Wildcat Clubs does enforce", () => {
    const d = psychAnswers();
    expect(text("bylaws", d, "Attendance Requirement to Vote")).toContain("Wildcat Clubs counts them when voting opens");
    const voting = text("bylaws", d, "Voting Procedures");
    expect(voting).toContain("Eligible voters are members who meet the Attendance Requirement to Vote");
    expect(voting).toContain("at least 25% of eligible voters");
    expect(voting).toContain("Wildcat Clubs checks this when a member vote closes");
    expect(voting).toContain("Wildcat Clubs won't open voting before the notice is up");
    expect(voting).not.toContain("the second vote needs no quorum");
    expect(text("bylaws", d, "Vacancies")).toContain("WSUSA follows up if the seat is still empty after 14 days");
    expect(text("constitution", d, "Advisor")).toContain("after those 30 days");
  });

  it("describes each tie rule the way the engine settles it", () => {
    const d = defaultDraftData();
    expect(text("bylaws", d, "Voting Procedures")).toContain("a runoff is held between the tied candidates");
    d.fields.tieBreak = "ADVISOR";
    expect(text("bylaws", d, "Voting Procedures")).toContain("the advisor casts the deciding vote");
    d.fields.tieBreak = "PRESIDENT";
    expect(text("bylaws", d, "Voting Procedures")).toContain("If the President is one of the tied candidates");
  });
});

describe("custom documents and settings changes", () => {
  it("lets each kind of document state only what it governs", () => {
    expect(governedSetting("CONSTITUTION")).toBe("joinPolicy");
    expect(governedSetting("BYLAWS")).toBe("successionMethod");
    expect(governedSetting("OTHER")).toBeNull();
  });

  it("finds what changed, if anything", () => {
    const before = { joinPolicy: "OPEN" as const, successionMethod: "ADVISOR_PRESIDENT" as const };
    expect(settingsChange(before, before)).toBeNull();
    expect(settingsChange(before, { joinPolicy: undefined, successionMethod: "SELF_SELECT" })).toEqual({ joinPolicy: null, successionMethod: { from: "ADVISOR_PRESIDENT", to: "SELF_SELECT" } });
    expect(settingsChange(before, { joinPolicy: "APPROVAL" })).toEqual({ joinPolicy: { from: "OPEN", to: "APPROVAL" }, successionMethod: null });
  });

  it("tells members and WSUSA in plain words", () => {
    const seats = settingsChangeNotice("Chess Club", { joinPolicy: null, successionMethod: { from: "ADVISOR_PRESIDENT", to: "SELF_SELECT" } }, { kind: "adopted", by: "Priya Patel" });
    expect(seats.title).toBe("Chess Club now uses Self-select to fill seats");
    expect(seats.body).toContain("Before, it used Advisor & President.");
    expect(seats.body).toContain("Priya Patel adopted the club's new constitution and bylaws.");
    const join = settingsChangeNotice("Chess Club", { joinPolicy: { from: "OPEN", to: "APPROVAL" }, successionMethod: null }, { kind: "custom", doc: "CONSTITUTION" });
    expect(join.title).toBe("Joining Chess Club now takes a leader's approval");
    expect(join.body).toContain("WSUSA approved the club's custom constitution.");
    const both = settingsChangeNotice("Chess Club", { joinPolicy: { from: "APPROVAL", to: "OPEN" }, successionMethod: { from: "SELF_SELECT", to: "MEMBER_VOTE" } }, { kind: "adopted", by: "Sam" });
    expect(both.title).toBe("Chess Club changed how it fills seats and who can join");
    expect(both.body).toContain("It now uses Member vote to fill seats, and students become members as soon as they register or check in.");
  });
});
