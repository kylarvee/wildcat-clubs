import { describe, expect, test } from "vitest";
import {
  bayesianRating,
  logScale,
  majorMatch,
  personalScore,
  popularityScore,
  rankClubs,
  rankContext,
  reasonsFor,
  scoreClub,
  WEIGHTS,
  type PersonalSignals,
  type RankContext,
  type RankInput,
  type RankMetrics,
} from "@/lib/search/rank";

const metrics = (m: Partial<RankMetrics> = {}): RankMetrics => ({ activeMembers: 0, activityScore: 0, avgRating: null, reviewCount: 0, isActive: false, ...m });
const personal = (p: Partial<PersonalSignals> = {}): PersonalSignals => ({ majorMatch: null, peers: 0, peerLift: 0, attended: 0, subscribed: false, member: false, ...p });
const club = (id: string, c: Partial<RankInput> = {}): RankInput => ({ id, name: id, metrics: metrics(), relevance: null, personal: null, ...c });
const ctx: RankContext = { meanRating: 4.2, popularMin: 20, busyMin: 8 };

describe("Bayesian rating", () => {
  test("no reviews reads as the campus mean", () => {
    expect(bayesianRating(null, 0, 4.2)).toBeCloseTo(4.2);
    expect(bayesianRating(5, 0, 4.2)).toBeCloseTo(4.2);
  });

  test("a few reviews barely move a club; many reviews carry it", () => {
    const one = bayesianRating(5, 1, 4.2);
    const many = bayesianRating(4.8, 40, 4.2);
    expect(one).toBeCloseTo((5 * 4.2 + 5) / 6);
    expect(one).toBeLessThan(4.4);
    expect(many).toBeGreaterThan(4.7);
    expect(many).toBeGreaterThan(one);
    expect(bayesianRating(1, 2, 4.2)).toBeGreaterThan(3); // two angry reviews don't sink a club
  });

  test("a lone 5★ review doesn't outrank 40 reviews at 4.8★", () => {
    const a = popularityScore(metrics({ avgRating: 5, reviewCount: 1 }), ctx);
    const b = popularityScore(metrics({ avgRating: 4.8, reviewCount: 40 }), ctx);
    expect(b).toBeGreaterThan(a);
  });

  test("campus mean is review-weighted and defaults to 4", () => {
    expect(rankContext([]).meanRating).toBe(4);
    expect(rankContext([metrics({ avgRating: 5, reviewCount: 3 }), metrics({ avgRating: 3, reviewCount: 1 })]).meanRating).toBeCloseTo(4.5);
  });
});

describe("weights", () => {
  test("every weight is a finite number, and only the member penalty is negative", () => {
    const flat = [...Object.values(WEIGHTS.popularity), ...Object.values(WEIGHTS.personal)];
    expect(flat.every((w) => Number.isFinite(w))).toBe(true);
    expect(Object.entries(WEIGHTS.personal).filter(([, w]) => w < 0).map(([k]) => k)).toEqual(["member"]);
  });

  test("log scale: 0 → 0, full marks at `full`, never above 1, first few count most", () => {
    expect(logScale(0, 60)).toBe(0);
    expect(logScale(60, 60)).toBeCloseTo(1);
    expect(logScale(500, 60)).toBe(1);
    expect(logScale(-3, 60)).toBe(0);
    expect(logScale(10, 60) - logScale(0, 60)).toBeGreaterThan(logScale(60, 60) - logScale(50, 60));
  });

  test("popularity grows with active members and activity; being active is a small boost", () => {
    expect(popularityScore(metrics({ activeMembers: 40 }), ctx)).toBeGreaterThan(popularityScore(metrics({ activeMembers: 10 }), ctx));
    expect(popularityScore(metrics({ activityScore: 10 }), ctx)).toBeGreaterThan(popularityScore(metrics({ activityScore: 2 }), ctx));
    const boost = popularityScore(metrics({ isActive: true }), ctx) - popularityScore(metrics(), ctx);
    expect(boost).toBeCloseTo(WEIGHTS.popularity.active);
    expect(boost).toBeLessThan(WEIGHTS.popularity.members);
  });

  test("a strong text match beats a weak one, however popular or personal the weak one is", () => {
    const strong = club("strong", { relevance: 0.6 });
    const weak = club("weak", {
      relevance: 0.15,
      metrics: metrics({ activeMembers: 500, activityScore: 50, avgRating: 5, reviewCount: 200, isActive: true }),
      personal: personal({ majorMatch: { level: "major", label: "Nursing" }, peers: 50, peerLift: 10, attended: 30, subscribed: true }),
    });
    expect(scoreClub(strong, "relevance", ctx)).toBeGreaterThan(scoreClub(weak, "relevance", ctx));
  });

  test("co-members count by how unusual the overlap is, not how many (big clubs don't win twice)", () => {
    const bigAsExpected = personalScore(personal({ peers: 40, peerLift: 1 }), "recommended");
    const smallButClose = personalScore(personal({ peers: 4, peerLift: 3 }), "recommended");
    expect(bigAsExpected).toBe(0);
    expect(smallButClose).toBeCloseTo(WEIGHTS.personal.peers);
    expect(personalScore(personal({ peers: 1, peerLift: 9 }), "recommended")).toBe(0); // one person is not a pattern
  });

  test("among equal matches, popularity and the viewer's own signals decide", () => {
    const quiet = club("quiet", { relevance: 0.3 });
    const busy = club("busy", { relevance: 0.3, metrics: metrics({ activeMembers: 30, activityScore: 9, isActive: true }) });
    const mine = club("mine", { relevance: 0.3, personal: personal({ majorMatch: { level: "major", label: "Nursing" } }) });
    expect(rankClubs([quiet, busy], "relevance", ctx).map((c) => c.id)).toEqual(["busy", "quiet"]);
    expect(scoreClub(mine, "relevance", ctx)).toBeGreaterThan(scoreClub(quiet, "relevance", ctx));
  });

  test("relevance only counts with a query (Recommended ignores it)", () => {
    expect(scoreClub(club("a", { relevance: 1 }), "recommended", ctx)).toBe(scoreClub(club("a"), "recommended", ctx));
  });

  test("major beats department beats college; a dormant club in your major doesn't beat a thriving one outside it", () => {
    const at = (level: "major" | "department" | "college") => personalScore(personal({ majorMatch: { level, label: "x" } }), "recommended");
    expect(at("major")).toBeGreaterThan(at("department"));
    expect(at("department")).toBeGreaterThan(at("college"));
    const dormantInMajor = club("dormant", { personal: personal({ majorMatch: { level: "major", label: "Nursing" } }) });
    const thriving = club("thriving", { metrics: metrics({ activeMembers: 80, activityScore: 15, avgRating: 4.8, reviewCount: 30, isActive: true }), personal: personal() });
    expect(scoreClub(thriving, "recommended", ctx)).toBeGreaterThan(scoreClub(dormantInMajor, "recommended", ctx));
  });
});

describe("members in Recommended", () => {
  const popularMember = club("popular-member", {
    metrics: metrics({ activeMembers: 90, activityScore: 20, avgRating: 4.9, reviewCount: 50, isActive: true }),
    personal: personal({ member: true, peers: 40, peerLift: 3, attended: 25, majorMatch: { level: "major", label: "Mechanical Engineering" } }),
  });
  const smallNew = club("small-new", { metrics: metrics({ activeMembers: 3, activityScore: 1 }), personal: personal() });

  test("clubs you're already in sink below the rest, but stay listed", () => {
    const ranked = rankClubs([popularMember, smallNew], "recommended", ctx);
    expect(ranked.map((c) => c.id)).toEqual(["small-new", "popular-member"]);
    expect(ranked).toHaveLength(2);
  });

  test("…but not when you search: your own club can be the best match", () => {
    const ranked = rankClubs([{ ...popularMember, relevance: 0.7 }, { ...smallNew, relevance: 0.2 }], "relevance", ctx);
    expect(ranked[0].id).toBe("popular-member");
  });

  test("signed-out viewers get no personal score", () => {
    expect(personalScore(null, "recommended")).toBe(0);
  });
});

describe("reasons", () => {
  test("at most two, the viewer's own first", () => {
    const r = reasonsFor(
      {
        metrics: metrics({ activeMembers: 50, activityScore: 12, avgRating: 4.9, reviewCount: 30 }),
        personal: personal({ majorMatch: { level: "major", label: "Mechanical Engineering" }, attended: 2, peers: 4, peerLift: 2, subscribed: true }),
      },
      ctx,
    );
    expect(r).toEqual(["Matches your major (Mechanical Engineering)", "You've attended 2 of its events"]);
  });

  test("co-members are a count, never names, only from two, and only when the overlap stands out", () => {
    expect(reasonsFor({ metrics: metrics(), personal: personal({ peers: 4, peerLift: 2 }) }, ctx)).toEqual(["4 people in your clubs are members"]);
    expect(reasonsFor({ metrics: metrics(), personal: personal({ peers: 30, peerLift: 1.1 }) }, ctx)).toEqual([]);
    expect(reasonsFor({ metrics: metrics(), personal: personal({ peers: 1, peerLift: 5 }) }, ctx)).toEqual([]);
  });

  test("nothing about attending, co-members or following for clubs you're already in", () => {
    expect(reasonsFor({ metrics: metrics(), personal: personal({ member: true, attended: 9, peers: 9, peerLift: 3, subscribed: true }) }, ctx)).toEqual([]);
    expect(reasonsFor({ metrics: metrics(), personal: personal({ subscribed: true }) }, ctx)).toEqual(["You follow its calendar"]);
    expect(reasonsFor({ metrics: metrics(), personal: personal({ attended: 1 }) }, ctx)).toEqual(["You've attended 1 of its events"]);
  });

  test("signed out: one line about the club's standing, at most", () => {
    expect(reasonsFor({ metrics: metrics({ activeMembers: 25, activityScore: 9 }), personal: null }, ctx)).toEqual(["Popular this term"]);
    expect(reasonsFor({ metrics: metrics({ activeMembers: 5, activityScore: 9 }), personal: null }, ctx)).toEqual(["Busy calendar lately"]);
    expect(reasonsFor({ metrics: metrics({ activeMembers: 5 }), personal: null }, ctx)).toEqual([]);
  });

  test("highly rated needs enough reviews", () => {
    expect(reasonsFor({ metrics: metrics({ avgRating: 5, reviewCount: 2 }), personal: null }, ctx)).toEqual([]);
    expect(reasonsFor({ metrics: metrics({ avgRating: 4.95, reviewCount: 40 }), personal: null }, ctx)).toEqual(["Highly rated by students"]);
  });

  test("popular means the top 5% of campus, and at least the minimum", () => {
    const all = Array.from({ length: 100 }, (_, i) => metrics({ activeMembers: i }));
    expect(rankContext(all).popularMin).toBe(95);
    expect(rankContext([metrics({ activeMembers: 3 })]).popularMin).toBe(WEIGHTS.reasons.popularMin);
  });

  test("each major-match level reads plainly", () => {
    const say = (level: "major" | "minor" | "department" | "college", label: string) => reasonsFor({ metrics: metrics(), personal: personal({ majorMatch: { level, label } }) }, ctx)[0];
    expect(say("minor", "Spanish")).toBe("Matches your minor (Spanish)");
    expect(say("department", "Nursing")).toBe("Related to your major (Nursing)");
    expect(say("college", "EAST")).toBe("In your college (EAST)");
  });
});

describe("major match", () => {
  const majors = [
    { id: "me", name: "Mechanical Engineering", minor: false, departmentId: "dept-me", collegeId: "east", collegeName: "EAST" },
    { id: "span", name: "Spanish", minor: true, departmentId: "dept-lang", collegeId: "arts", collegeName: "Arts & Humanities" },
  ];
  const facets = (f: Partial<Parameters<typeof majorMatch>[1]> = {}) => ({ focusMajorId: null, focusMajorDepartmentId: null, departmentId: null, collegeId: null, ...f });

  test("focus major, then department, then college", () => {
    expect(majorMatch(majors, facets({ focusMajorId: "me" }))).toEqual({ level: "major", label: "Mechanical Engineering" });
    expect(majorMatch(majors, facets({ focusMajorId: "span" }))).toEqual({ level: "minor", label: "Spanish" });
    expect(majorMatch(majors, facets({ departmentId: "dept-me" }))).toEqual({ level: "department", label: "Mechanical Engineering" });
    expect(majorMatch(majors, facets({ focusMajorDepartmentId: "dept-me" }))).toEqual({ level: "department", label: "Mechanical Engineering" });
    expect(majorMatch(majors, facets({ collegeId: "east" }))).toEqual({ level: "college", label: "EAST" });
    expect(majorMatch(majors, facets({ collegeId: "nowhere" }))).toBeNull();
  });

  test("a minor's department or college isn't enough", () => {
    expect(majorMatch(majors, facets({ departmentId: "dept-lang" }))).toBeNull();
    expect(majorMatch(majors, facets({ collegeId: "arts" }))).toBeNull();
  });
});

describe("member penalty bounds", () => {
  test("no member club can outrank a non-member club in Recommended", () => {
    const best = metrics({ activeMembers: 10_000, activityScore: 10_000, avgRating: 5, reviewCount: 10_000, isActive: true });
    const memberBest = scoreClub(club("m", { metrics: best, personal: personal({ member: true, peers: 99, peerLift: 99, attended: 99, subscribed: true, majorMatch: { level: "major", label: "x" } }) }), "recommended", ctx);
    const nonMemberWorst = scoreClub(club("n", { metrics: metrics({ avgRating: 1, reviewCount: 10_000 }), personal: personal() }), "recommended", ctx);
    expect(memberBest).toBeLessThan(nonMemberWorst);
  });
});
