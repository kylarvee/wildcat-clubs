import { describe, expect, it } from "vitest";
import {
  lexemeWeights,
  meaningfulWords,
  nameIndex,
  nameSignal,
  purposeSignal,
  rankSimilar,
  SIMILAR,
  similarityScore,
  similarStanding,
  trigramSimilarity,
  wordSimilarity,
} from "@/lib/search/similar-rules";

/** "Similar clubs already exist": the ranking and the standing text (lib/search/similar-rules). */

describe("words and how alike they are", () => {
  it("keeps the words that say what a club is, without filler", () => {
    expect(meaningfulWords("Wildcat Beekeeping Society")).toEqual(["wildcat", "beekeeping"]);
    expect(meaningfulWords("The Chess Club at WSU")).toEqual(["chess"]);
    expect(meaningfulWords("")).toEqual([]);
  });

  it("scores trigrams the way pg_trgm does", () => {
    expect(trigramSimilarity("chess", "chess")).toBe(1);
    expect(trigramSimilarity("photography", "photographic")).toBeGreaterThan(0.6);
    expect(trigramSimilarity("chess", "beekeeping")).toBe(0);
  });

  it("matches plurals, other endings and words still being typed", () => {
    expect(wordSimilarity("beekeepers", "beekeeping")).toBeGreaterThanOrEqual(0.75);
    expect(wordSimilarity("robots", "robotics")).toBeGreaterThanOrEqual(0.75);
    expect(wordSimilarity("phot", "photographic")).toBeGreaterThanOrEqual(0.75);
    expect(wordSimilarity("chess", "service")).toBeLessThan(0.5);
  });
});

const NAMES = [
  "Chess Club",
  "Wildcat Service Club",
  "Wildcat Investors",
  "Wildcat Paintball Club",
  "Wildcat Esports",
  "Wildcat Ski Team",
  "Wildcat Rugby",
  "Photographic Society",
  "Board Game Club",
  "Honors Student Advisory Board",
  "Ballroom and Hip Hop Club",
  ...Array.from({ length: 140 }, (_, i) => `Filler Group ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}x`),
];
const index = nameIndex(NAMES.map(meaningfulWords));
const signal = (proposal: string, club: string) => nameSignal(meaningfulWords(proposal), meaningfulWords(club), index);

describe("the name signal", () => {
  it("finds a club with the same telling word", () => {
    expect(signal("Wildcat Chess Society", "Chess Club")).toBeGreaterThan(SIMILAR.min);
  });

  it("never matches on common name words alone", () => {
    // "wildcat" is on six of these names: two Wildcat clubs aren't alike for that.
    expect(signal("Wildcat Chess Society", "Wildcat Service Club")).toBe(0);
    expect(signal("Wildcat Club", "Wildcat Investors")).toBe(0);
  });

  it("finds a retired club by a name that's close but not the same", () => {
    expect(signal("Photography Club", "Photographic Society")).toBeGreaterThan(SIMILAR.min);
    expect(signal("Phot", "Photographic Society")).toBeGreaterThan(SIMILAR.min);
  });

  it("scores a club that shares only part of the idea lower than one that shares all of it", () => {
    const whole = signal("Board Game Night", "Board Game Club");
    const part = signal("Board Game Night", "Honors Student Advisory Board");
    expect(whole).toBeGreaterThan(SIMILAR.min);
    expect(part).toBeLessThan(SIMILAR.min);
    expect(signal("Ballroom Dance", "Ballroom and Hip Hop Club")).toBeGreaterThanOrEqual(SIMILAR.min);
  });
});

describe("the purpose signal", () => {
  const df = (l: string) => ({ chess: 2, tournament: 8, game: 40, campus: 130 })[l] ?? 0;

  it("weighs rare words more, description words less, and marks common words as not telling", () => {
    const w = lexemeWeights(
      [
        { lexeme: "chess", fromName: true },
        { lexeme: "tournament", fromName: false },
        { lexeme: "game", fromName: false },
        { lexeme: "campus", fromName: false },
      ],
      df,
      300,
    );
    const by = Object.fromEntries(w.map((x) => [x.lexeme, x]));
    expect(by.chess.weight).toBeGreaterThan(by.tournament.weight);
    expect(by.tournament.weight).toBeGreaterThan(by.game.weight);
    expect(by.chess.telling && by.tournament.telling).toBe(true);
    expect(by.game.telling || by.campus.telling).toBe(false);
  });

  it("is the share of the proposal found, scaled by how many telling words were found", () => {
    expect(purposeSignal(10, 10, 2, 2)).toBe(1);
    expect(purposeSignal(5, 10, 1, 1)).toBeCloseTo(0.5);
    expect(purposeSignal(5, 10, 1, 4)).toBeCloseTo(0.25);
    expect(purposeSignal(8, 10, 0, 2)).toBe(0);
  });
});

describe("ranking", () => {
  const c = (id: string, name: number, purpose: number, status: "APPROVED" | "RETIRED" = "APPROVED") => ({ id, name: id, status, nameScore: name, purposeScore: purpose });

  it("lists the stronger signal plus a little of the weaker, above the bar, best first", () => {
    // Purpose counts SIMILAR.purposeWeight as much as name: 0.6 + 0.25 × (0.4 × 0.85).
    expect(similarityScore(0.6, 0.4)).toBeCloseTo(0.685);
    expect(similarityScore(0, 0.8)).toBeLessThan(similarityScore(0.75, 0));
    const ranked = rankSimilar([c("weak", 0.2, 0.1), c("name", 0.7, 0), c("both", 0.6, 0.6), c("purpose", 0, 0.5)]);
    expect(ranked.map((r) => r.id)).toEqual(["both", "name", "purpose"]);
    expect(ranked.map((r) => r.reason)).toEqual(["name", "name", "purpose"]);
  });

  it("puts an approved club before a retired one on a tie, and stops at the limit", () => {
    expect(rankSimilar([c("Retired", 0.8, 0, "RETIRED"), c("Approved", 0.8, 0)]).map((r) => r.id)).toEqual(["Approved", "Retired"]);
    expect(rankSimilar(Array.from({ length: 9 }, (_, i) => c(`c${i}`, 0.9, 0))).length).toBe(SIMILAR.limit);
  });
});

describe("standing in plain words", () => {
  const now = new Date("2026-10-20T18:00:00Z");
  const base = { status: "APPROVED" as const, isActive: true, inPilot: false, members: 24, lastHeldAt: new Date("2026-10-12T18:00:00Z"), retiredAt: null, now };

  it("says an active club's members and last event", () => {
    expect(similarStanding(base)).toEqual({ standing: "active", label: "Active", facts: ["24 members", "Last event Oct 12"] });
    expect(similarStanding({ ...base, inPilot: true }).label).toBe("Pilot period");
  });

  it("says plainly when an inactive club stopped holding events", () => {
    const quiet = similarStanding({ ...base, isActive: false, members: 6, lastHeldAt: new Date("2026-03-11T18:00:00Z") });
    expect(quiet).toEqual({ standing: "inactive", label: "Inactive", facts: ["No events since March", "6 members"] });
    expect(similarStanding({ ...base, isActive: false, lastHeldAt: new Date("2025-04-02T18:00:00Z") }).facts[0]).toBe("No events since April 2025");
    expect(similarStanding({ ...base, isActive: false, lastHeldAt: null }).facts[0]).toBe("No events yet");
    // Still meeting, but too few members to count as active.
    expect(similarStanding({ ...base, isActive: false, members: 5 }).facts).toEqual(["Only 5 members", "Last event Oct 12"]);
  });

  it("says when a retired club retired, how many members it had and when it last met", () => {
    const r = similarStanding({ ...base, status: "RETIRED", isActive: false, members: 13, lastHeldAt: new Date("2025-04-20T18:00:00Z"), retiredAt: new Date("2025-04-30T21:00:00Z") });
    expect(r).toEqual({ standing: "retired", label: "Retired", facts: ["Retired in April 2025", "Had 13 members", "Last event in April 2025"] });
  });
});
