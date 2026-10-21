import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import {
  activeConfirmation,
  blockedMessage,
  blockingChecks,
  checkFix,
  isEmptyPlan,
  joinNames,
  mayRenew,
  readSnapshot,
  renewalCardHint,
  renewalCardIntro,
  renewalChecks,
  renewalDueNotice,
  renewalExemption,
  renewalSourceClub,
  renewalSourceId,
  renewalStatus,
  renewalTaskDescription,
  renewalTaskPlan,
  renewalTaskTitle,
  renewalTerm,
  renewalWindow,
  renewerBlocker,
  snapshotChecks,
  tookOfficeDuringWindow,
  type RenewalFacts,
  type RenewalHolder,
  type RenewalTaskRow,
  type RenewalTaskState,
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
    expect(renewalSourceClub("c1:2026–27")).toBe("c1");
    expect([renewalSourceClub(null), renewalSourceClub("c1"), renewalSourceClub(":2026–27")]).toEqual([null, null, null]);
    expect(renewalTaskTitle("RC Wrecker Bots Club", "2026–27")).toBe("Renew RC Wrecker Bots Club for 2026–27");
    expect(activeConfirmation("SWE")).toBe("SWE will be active this academic year.");
  });
});

describe("renewalTaskPlan (the per-club sync the job and every role change apply)", () => {
  const window = renewalWindow(TERMS, OCT_18, 30)!;
  const year = window.year;
  const ana: RenewalHolder = { id: "ana", name: "Ana Lee", role: "PRESIDENT", since: campusDate(2026, 5, 1) };
  const ben: RenewalHolder = { id: "ben", name: "Ben Ruiz", role: "PRESIDENT", since: campusDate(2026, 10, 14, 18) };
  const elena: RenewalHolder = { id: "elena", name: "Dr. Elena Alvarez", role: "ADVISOR", since: campusDate(2022, 9, 1) };
  const club = (over: Partial<RenewalTaskState> = {}): RenewalTaskState => ({ club: { id: "c1", name: "Chess Club", officeId: null }, exemption: null, renewal: null, holders: [ana, elena], ...over });
  const task = (id: string, assigneeId: string | null, over: Partial<RenewalTaskRow> = {}): RenewalTaskRow => ({
    id,
    sourceId: renewalSourceId("c1", year),
    assigneeId,
    dueAt: window.dueAt,
    officeId: null,
    title: renewalTaskTitle("Chess Club", year),
    ...over,
  });
  const inLine = [task("t-ana", "ana"), task("t-elena", "elena")];

  it("gives a new President the task at once and cancels the outgoing President's", () => {
    const plan = renewalTaskPlan(club({ holders: [ben, elena] }), inLine, window, OCT_18);
    expect(plan.open.map((h) => h.id)).toEqual(["ben"]);
    expect(plan.cancel).toEqual(["t-ana"]);
    expect(plan).toMatchObject({ done: [], update: [] });
  });

  it("opens one task per current President and advisor the day renewal opens, and then has nothing to do", () => {
    expect(renewalTaskPlan(club(), [], window, window.opensAt).open.map((h) => h.id)).toEqual(["ana", "elena"]);
    expect(isEmptyPlan(renewalTaskPlan(club(), inLine, window, OCT_18))).toBe(true);
    // A co-President takes office: only the new one gets a task.
    expect(renewalTaskPlan(club({ holders: [ana, ben, elena] }), inLine, window, OCT_18).open.map((h) => h.id)).toEqual(["ben"]);
  });

  it("does nothing outside the window: before it opens, or with no academic calendar", () => {
    const early = campusDate(2026, 8, 30);
    expect(isEmptyPlan(renewalTaskPlan(club({ holders: [ben, elena] }), [], window, early))).toBe(true);
    expect(isEmptyPlan(renewalTaskPlan(club({ holders: [ben, elena] }), [], null, OCT_18))).toBe(true);
    // Anything left open then is cancelled.
    expect(renewalTaskPlan(club(), inLine, window, early).cancel).toEqual(["t-ana", "t-elena"]);
  });

  it("does nothing once the club renewed, beyond closing what's still open as done", () => {
    const renewed = club({ holders: [ben, elena], renewal: { submittedAt: campusDate(2026, 9, 20) } });
    expect(isEmptyPlan(renewalTaskPlan(renewed, [], window, OCT_18))).toBe(true);
    expect(renewalTaskPlan(renewed, inLine, window, OCT_18)).toMatchObject({ open: [], done: ["t-ana", "t-elena"], cancel: [] });
  });

  it("cancels the tasks of clubs that aren't asked or are gone, earlier years' tasks and duplicates", () => {
    expect(renewalTaskPlan(club({ exemption: "It was approved this academic year, so it renews starting next year." }), inLine, window, OCT_18).cancel).toEqual(["t-ana", "t-elena"]);
    expect(renewalTaskPlan(null, inLine, window, OCT_18).cancel).toEqual(["t-ana", "t-elena"]);
    const plan = renewalTaskPlan(club(), [...inLine, task("t-old", "ana", { sourceId: renewalSourceId("c1", "2025–26") }), task("t-twice", "ana"), task("t-nobody", null)], window, OCT_18);
    expect(plan.cancel).toEqual(["t-old", "t-twice", "t-nobody"]);
    expect(plan.open).toEqual([]);
  });

  it("keeps one window for every club: open tasks follow its due date, the club's office and its name", () => {
    const later = renewalWindow(TERMS, OCT_18, 45)!;
    expect(renewalTaskPlan(club(), inLine, later, OCT_18).update).toEqual(["t-ana", "t-elena"]);
    expect(renewalTaskPlan(club({ club: { id: "c1", name: "Chess Club", officeId: "campus-rec" } }), inLine, window, OCT_18).update).toEqual(["t-ana", "t-elena"]);
    expect(renewalTaskPlan(club({ club: { id: "c1", name: "Wildcat Chess", officeId: null } }), inLine, window, OCT_18).update).toEqual(["t-ana", "t-elena"]);
  });
});

describe("wording for a President or advisor who took office mid-window", () => {
  const window = renewalWindow(TERMS, OCT_18, 30)!;
  const since = campusDate(2026, 10, 14, 18);
  const status = renewalStatus({ window, now: OCT_18, renewedAt: null, exemption: null });

  it("knows who took the seat after renewal opened", () => {
    expect(tookOfficeDuringWindow({ since }, window)).toBe(true);
    expect(tookOfficeDuringWindow({ since: campusDate(2026, 5, 1) }, window)).toBe(false);
    expect(tookOfficeDuringWindow({ since: window.opensAt }, window)).toBe(false);
  });

  it("tells them the club hasn't renewed and it's theirs to finish, on the card, the task and the bell", () => {
    expect(renewalCardIntro("Chess Club", "Campus Recreation", window, { role: "PRESIDENT", since })).toBe(
      "You became President on Oct 14, 2026, after renewal opened, and the club hasn't re-registered with Campus Recreation for 2026–27 yet, so it's yours to finish. Once the required checks are green, confirm the club will be active and you're done.",
    );
    expect(renewalCardIntro("Chess Club", "WSUSA", window, { role: "ADVISOR", since })).toMatch(/^You became Chess Club's advisor on Oct 14, 2026/);
    expect(renewalCardIntro("Chess Club", "WSUSA", window)).toBe("WSUSA re-registers its clubs once a year. Once the required checks are green, confirm the club will be active and you're done.");
    expect(renewalCardHint(status, window, { since })).toBe("It was due Sep 30, 2026, before you took office. Renew as soon as you can.");
    expect(renewalCardHint(status, window, { since: campusDate(2026, 9, 10) })).toBe(status.hint);
    expect(renewalTaskDescription("Campus Recreation", true)).toMatch(/^You took office after renewal opened, and the club hasn't re-registered with Campus Recreation yet/);
    expect(renewalTaskDescription("WSUSA")).toMatch(/^WSUSA re-registers every club once a year/);
    expect(renewalDueNotice("Chess Club", window, true, "WSUSA", { role: "PRESIDENT", since })).toEqual({
      title: "Chess Club still needs to renew for 2026–27",
      body: "It was due Sep 30, 2026, before you took office, and it's yours to finish as President. Check the club's details and renew with WSUSA when you can.",
    });
    expect(renewalDueNotice("Chess Club", window, false, "WSUSA", { role: "ADVISOR", since: campusDate(2026, 9, 10) }).body).toBe(
      "It's yours to finish as its advisor: check the club's details and renew with WSUSA by Sep 30.",
    );
    expect(renewalDueNotice("Chess Club", window, false).title).toBe("Time to renew Chess Club for 2026–27");
  });
});
