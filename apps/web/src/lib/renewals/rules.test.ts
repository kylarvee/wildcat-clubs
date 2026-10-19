import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import {
  activeConfirmation,
  blockedMessage,
  blockingChecks,
  checkFix,
  joinNames,
  mayRenew,
  readSnapshot,
  renewalChecks,
  renewalExemption,
  renewalSourceId,
  renewalStatus,
  renewalTaskTitle,
  renewalTerm,
  renewalWindow,
  renewerBlocker,
  snapshotChecks,
  type RenewalFacts,
  type RenewalTerm,
} from "./rules";

const term = (name: string, academicYear: string, start: [number, number, number], end: [number, number, number]): RenewalTerm => ({
  name,
  academicYear,
  startsOn: campusDate(...start),
  endsOn: campusDate(end[0], end[1], end[2], 23, 59),
});

const TERMS: RenewalTerm[] = [
  term("Fall 2025", "2025-2026", [2025, 8, 25], [2025, 12, 12]),
  term("Spring 2026", "2025-2026", [2026, 1, 5], [2026, 5, 1]),
  term("Summer 2026", "2025-2026", [2026, 5, 11], [2026, 8, 14]),
  term("Fall 2026", "2026-2027", [2026, 8, 31], [2026, 12, 18]),
  term("Spring 2027", "2026-2027", [2027, 1, 11], [2027, 5, 7]),
  term("Summer 2027", "2026-2027", [2027, 5, 17], [2027, 8, 20]),
];

const OCT_18 = campusDate(2026, 10, 18, 12);

describe("renewalWindow", () => {
  it("opens on the first day of the academic year's first term and is due at the end of the day dueDays later", () => {
    const w = renewalWindow(TERMS, OCT_18, 30)!;
    expect(w.year).toBe("2026–27");
    expect(w.termYear).toBe("2026-2027");
    expect(w.opensAt).toEqual(campusDate(2026, 8, 31));
    expect(w.dueAt).toEqual(campusDate(2026, 9, 30, 23, 59));
  });

  it("keeps the same window through spring, summer and the gap before the next fall", () => {
    for (const at of [campusDate(2027, 2, 1), campusDate(2027, 7, 1), campusDate(2027, 8, 25)]) {
      expect(renewalWindow(TERMS, at, 30)?.year).toBe("2026–27");
    }
    expect(renewalWindow(TERMS, campusDate(2026, 8, 20), 30)?.year).toBe("2025–26");
  });

  it("counts calendar days in campus time, across the end of daylight saving time", () => {
    expect(renewalWindow(TERMS, OCT_18, 70)!.dueAt).toEqual(campusDate(2026, 11, 9, 23, 59));
    expect(renewalWindow(TERMS, OCT_18, 0)!.dueAt).toEqual(campusDate(2026, 8, 31, 23, 59));
  });

  it("doesn't depend on the order of the terms, and is null before any term starts", () => {
    expect(renewalWindow([...TERMS].reverse(), OCT_18, 30)!.opensAt).toEqual(campusDate(2026, 8, 31));
    expect(renewalWindow(TERMS, campusDate(2025, 1, 1), 30)).toBeNull();
    expect(renewalWindow([], OCT_18, 30)).toBeNull();
  });
});

describe("renewalTerm", () => {
  it("is the term containing now, else the next one", () => {
    expect(renewalTerm(TERMS, OCT_18)?.name).toBe("Fall 2026");
    expect(renewalTerm(TERMS, campusDate(2026, 8, 20))?.name).toBe("Fall 2026");
    expect(renewalTerm(TERMS, campusDate(2028, 1, 1))).toBeNull();
  });
});

describe("renewalExemption", () => {
  const w = renewalWindow(TERMS, OCT_18, 30)!;
  const club = { status: "APPROVED", type: "REGISTERED", approvedAt: campusDate(2023, 2, 1) };

  it("asks every approved club approved before the window opened", () => {
    expect(renewalExemption(club, w)).toBeNull();
    expect(renewalExemption({ ...club, approvedAt: null }, w)).toBeNull();
  });

  it("leaves out clubs approved this year, ambassador programs and clubs that aren't approved", () => {
    expect(renewalExemption({ ...club, approvedAt: campusDate(2026, 9, 10) }, w)).toMatch(/renews starting next year/);
    expect(renewalExemption({ ...club, type: "COLLEGE_AMBASSADORS" }, w)).toMatch(/ambassador programs don't renew/);
    expect(renewalExemption({ ...club, status: "RETIRED" }, w)).toMatch(/Only approved clubs/);
    expect(renewalExemption(club, null)).toMatch(/academic calendar/);
  });
});

describe("renewalStatus", () => {
  const window = renewalWindow(TERMS, OCT_18, 30)!;
  const at = (d: Date, renewedAt: Date | null = null, exemption: string | null = null) => renewalStatus({ window, now: d, renewedAt, exemption });

  it("names each state the way every screen shows it", () => {
    expect(at(campusDate(2026, 9, 2)).label).toBe("Due Sep 30");
    expect(at(window.dueAt).kind).toBe("due");
    expect(at(new Date(window.dueAt.getTime() + 60_000)).label).toBe("Overdue since Sep 30");
    expect(at(OCT_18, campusDate(2026, 9, 12)).label).toBe("Re-registered 2026–27");
    expect(at(OCT_18, null, "It was approved this academic year, so it renews starting next year.")).toMatchObject({ kind: "upcoming", label: "Not open yet" });
    expect(at(campusDate(2026, 8, 1))).toMatchObject({ kind: "upcoming", label: "Not open yet", hint: "Renewal for 2026–27 opens Aug 31, 2026." });
    expect(renewalStatus({ window: null, now: OCT_18, renewedAt: null, exemption: null }).label).toBe("Not open yet");
  });

  it("stays re-registered after the deadline, and says nothing is lost when it's late", () => {
    expect(at(campusDate(2027, 3, 1), campusDate(2026, 10, 1)).kind).toBe("renewed");
    expect(at(OCT_18).hint).toBe("It was due Sep 30, 2026. Renew as soon as you can.");
  });

  it("uses brand for re-registered (green is for Active standing) and warns when due or late", () => {
    expect(at(OCT_18, OCT_18).tone).toBe("brand");
    expect(at(campusDate(2026, 9, 2)).tone).toBe("warning");
    expect(at(OCT_18).tone).toBe("danger");
  });
});

describe("renewalChecks", () => {
  const ready: RenewalFacts = {
    profileGaps: [],
    presidents: ["Priya Patel"],
    vicePresidents: ["Jordan Lee"],
    advisors: ["Dr. Elena Alvarez"],
    constitution: "active",
    bylaws: "active",
    termName: "Fall 2026",
    eventsThisTerm: 14,
  };

  it("lists the required checks, then the recommended ones", () => {
    const checks = renewalChecks(ready);
    expect(checks.map((c) => c.key)).toEqual(["profile", "president", "advisor", "documents", "vicePresident", "events"]);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.find((c) => c.key === "events")?.detail).toBe("14 events on the calendar for Fall 2026.");
    expect(blockingChecks(checks)).toEqual([]);
  });

  it("only warns about a missing Vice President or an empty calendar: neither blocks renewal", () => {
    const checks = renewalChecks({ ...ready, vicePresidents: [], eventsThisTerm: 0 });
    expect(checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(["vicePresident", "events"]);
    expect(checks.find((c) => c.key === "events")?.detail).toBe("Nothing on the calendar for Fall 2026 yet.");
    expect(blockingChecks(checks)).toEqual([]);
  });

  it("blocks on a missing advisor, President, profile field or document, with a clear message", () => {
    const noAdvisor = blockingChecks(renewalChecks({ ...ready, advisors: [] }));
    expect(noAdvisor.map((c) => c.key)).toEqual(["advisor"]);
    expect(blockedMessage("Microbiology Club", noAdvisor)).toBe("Before Microbiology Club can renew, it needs a faculty or staff advisor.");
    const dormant = blockingChecks(renewalChecks({ ...ready, presidents: [], advisors: [], profileGaps: ["Category"] }));
    expect(blockedMessage("Art Guild", dormant)).toBe("Before Art Guild can renew, it needs a complete club profile, a President and a faculty or staff advisor.");
    expect(renewalChecks({ ...ready, profileGaps: ["Short description", "Category"] })[0].detail).toBe("Still needed: Short description, Category.");
  });

  it("says which document is missing or waiting for WSUSA", () => {
    const doc = (constitution: RenewalFacts["constitution"], bylaws: RenewalFacts["bylaws"]) => renewalChecks({ ...ready, constitution, bylaws })[3];
    expect(doc("active", "missing")).toMatchObject({ ok: false, detail: "No bylaws in effect yet." });
    expect(doc("pending", "active")).toMatchObject({ ok: false, detail: "Your custom constitution is waiting for WSUSA approval." });
    expect(doc("missing", "missing").detail).toBe("Neither a constitution nor bylaws are in effect yet.");
  });

  it("names co-presidents, and copes with no term on the calendar", () => {
    expect(renewalChecks({ ...ready, presidents: ["Ana Lee", "Ben Ruiz"] })[1].detail).toBe("Ana Lee and Ben Ruiz");
    expect(renewalChecks({ ...ready, termName: null })[5]).toMatchObject({ ok: false, detail: "There's no current term on the academic calendar." });
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });

  it("links every check to the tool that fixes it", () => {
    expect(checkFix("rc-wrecker-bots-club", "vicePresident")).toEqual({ label: "Fill this seat", href: "/clubs/rc-wrecker-bots-club/manage/org-chart" });
    expect(checkFix("x", "advisor").href).toBe("/clubs/x/manage/settings");
    expect(checkFix("x", "documents").href).toBe("/clubs/x/manage/constitution");
  });

  it("stores a plain snapshot and reads it back, skipping anything malformed", () => {
    const snap = snapshotChecks(renewalChecks(ready));
    expect(readSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
    expect(readSnapshot([{ key: "nope", ok: true }, null, { key: "advisor", ok: "yes" }, { key: "advisor", ok: false }])).toEqual([
      { key: "advisor", label: "A current advisor", ok: false, detail: "" },
    ]);
    expect(readSnapshot("[]")).toEqual([]);
  });
});

describe("who renews", () => {
  const leader = (role: string | null, extra: Partial<{ viaPlatform: string | null; isAdvisor: boolean; suspended: boolean }> = {}) => ({
    role,
    viaPlatform: null,
    isAdvisor: role === "ADVISOR",
    suspended: false,
    ...extra,
  });

  it("is the President, a Vice President, an advisor or an admin", () => {
    expect(["PRESIDENT", "VP", "ADVISOR"].map((r) => mayRenew(leader(r)))).toEqual([true, true, true]);
    expect(mayRenew(leader(null, { viaPlatform: "ADMIN" }))).toBe(true);
    expect(["OFFICER", "AMBASSADOR", "MEMBER", null].map((r) => mayRenew(leader(r)))).toEqual([false, false, false, false]);
    expect(renewerBlocker(leader("OFFICER"), "SWE")).toBe("Only the President, a Vice President, an advisor or WSUSA can renew SWE.");
  });

  it("waits while a President's or VP's permissions are paused", () => {
    expect(mayRenew(leader("PRESIDENT", { suspended: true }))).toBe(false);
    expect(renewerBlocker(leader("VP", { suspended: true }), "SWE")).toMatch(/paused/);
    expect(renewerBlocker(leader("PRESIDENT"), "SWE")).toBeNull();
  });
});

describe("names", () => {
  it("keeps task sources, titles and the confirmation in one place", () => {
    expect(renewalSourceId("c1", "2026–27")).toBe("c1:2026–27");
    expect(renewalTaskTitle("RC Wrecker Bots Club", "2026–27")).toBe("Renew RC Wrecker Bots Club for 2026–27");
    expect(activeConfirmation("SWE")).toBe("SWE will be active this academic year.");
  });
});
