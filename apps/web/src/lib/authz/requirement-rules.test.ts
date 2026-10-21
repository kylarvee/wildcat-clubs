import { describe, expect, it } from "vitest";
import { awaitingGrade, fulfillmentOf, heldCapabilities, pauseFor, periodStartIn, requirementReaches, requirementState, seatDueAt, seatStatus, type AttemptLike, type RequirementEvidence, type RuleRequirement } from "./requirement-rules";

const due = new Date("2026-10-21T18:00:00Z");
const before = new Date("2026-10-20T18:00:00Z");
const after = new Date("2026-10-22T18:00:00Z");
const waiting = (submittedAt: Date | null): AttemptLike => ({ status: "NEEDS_REVIEW", submittedAt });

describe("awaitingGrade", () => {
  it("counts an attempt handed in by the deadline that waits for a grader", () => {
    expect(awaitingGrade([waiting(before)], due)).toBe(true);
    expect(awaitingGrade([waiting(due)], due)).toBe(true);
  });

  it("doesn't count one handed in late, one still in progress or one already graded", () => {
    expect(awaitingGrade([waiting(after)], due)).toBe(false);
    expect(awaitingGrade([{ status: "IN_PROGRESS", submittedAt: null }], due)).toBe(false);
    expect(awaitingGrade([{ status: "GRADED", submittedAt: before }], due)).toBe(false);
    expect(awaitingGrade([], due)).toBe(false);
  });

  it("counts any attempt waiting for a grader when there's no deadline", () => {
    expect(awaitingGrade([waiting(after)], null)).toBe(true);
    expect(awaitingGrade([waiting(null)], null)).toBe(false);
  });
});

describe("requirementState", () => {
  it("is met once it's met, whatever the date", () => {
    expect(requirementState({ met: true, awaitingGrade: false, dueAt: due, at: after })).toBe("met");
  });

  it("is due until the deadline and overdue after it", () => {
    expect(requirementState({ met: false, awaitingGrade: false, dueAt: due, at: before })).toBe("due");
    expect(requirementState({ met: false, awaitingGrade: false, dueAt: due, at: due })).toBe("due");
    expect(requirementState({ met: false, awaitingGrade: false, dueAt: due, at: after })).toBe("overdue");
  });

  it("never pauses anyone while an on-time attempt waits for grading, even past the deadline", () => {
    const on = awaitingGrade([waiting(before)], due);
    expect(requirementState({ met: false, awaitingGrade: on, dueAt: due, at: before })).toBe("review");
    expect(requirementState({ met: false, awaitingGrade: on, dueAt: due, at: after })).toBe("review");
  });

  it("goes back to the normal rule, on the same clock, once grading fails it", () => {
    const failed: AttemptLike[] = [{ status: "GRADED", submittedAt: before }];
    expect(requirementState({ met: false, awaitingGrade: awaitingGrade(failed, due), dueAt: due, at: before })).toBe("due");
    expect(requirementState({ met: false, awaitingGrade: awaitingGrade(failed, due), dueAt: due, at: after })).toBe("overdue");
  });

  it("is overdue past the deadline when the attempt was handed in late", () => {
    expect(requirementState({ met: false, awaitingGrade: awaitingGrade([waiting(after)], due), dueAt: due, at: after })).toBe("overdue");
  });
});

// ─── The whole rule, given its inputs ────────────────────────────────────────

const TERMS = [
  { name: "Fall 2025", academicYear: "2025-2026", startsOn: new Date("2025-08-25T06:00:00Z"), endsOn: new Date("2025-12-13T06:59:00Z") },
  { name: "Spring 2026", academicYear: "2025-2026", startsOn: new Date("2026-01-05T07:00:00Z"), endsOn: new Date("2026-04-25T05:59:00Z") },
  { name: "Fall 2026", academicYear: "2026-2027", startsOn: new Date("2026-08-31T06:00:00Z"), endsOn: new Date("2026-12-19T06:59:00Z") },
];
const mid = new Date("2026-10-18T18:00:00Z");
const between = new Date("2026-12-28T18:00:00Z");

describe("periodStartIn", () => {
  it("starts semesters at the current term, or the last one between terms", () => {
    expect(periodStartIn("SEMESTER", mid, TERMS)).toEqual(TERMS[2].startsOn);
    expect(periodStartIn("SEMESTER", between, TERMS)).toEqual(TERMS[2].startsOn);
    expect(periodStartIn("SEMESTER", new Date("2026-06-01T18:00:00Z"), TERMS)).toEqual(TERMS[1].startsOn);
  });

  it("starts academic years at the year's first term", () => {
    expect(periodStartIn("ACADEMIC_YEAR", new Date("2026-03-01T18:00:00Z"), TERMS)).toEqual(TERMS[0].startsOn);
    expect(periodStartIn("ACADEMIC_YEAR", mid, TERMS)).toEqual(TERMS[2].startsOn);
  });

  it("starts years on Jan 1 in campus time, and never renews NONE", () => {
    expect(periodStartIn("ANNUAL", mid, TERMS).getTime()).toBe(Date.parse("2026-01-01T07:00:00Z"));
    expect(periodStartIn("NONE", mid, TERMS).getTime()).toBe(0);
  });

  it("counts all time while the calendar has no term yet", () => {
    expect(periodStartIn("SEMESTER", mid, []).getTime()).toBe(0);
    expect(periodStartIn("ACADEMIC_YEAR", new Date("2020-01-01T00:00:00Z"), TERMS).getTime()).toBe(0);
  });
});

const req = (over: Partial<RuleRequirement>): RuleRequirement => ({ id: "r", kind: "TEST", testId: "t", trainingEventId: null, renewal: "ACADEMIC_YEAR", graceDays: 30, createdAt: new Date("2024-08-06T14:00:00Z"), ...over });
const none: RequirementEvidence = { attempts: [], lastCheckIn: new Map(), person: null };
const start = TERMS[2].startsOn;

describe("fulfillmentOf", () => {
  it("is met by a pass this period (a submitted form passes), not by last period's", () => {
    const pass = (submittedAt: Date) => ({ testId: "t", status: "GRADED" as const, passed: true, submittedAt });
    expect(fulfillmentOf(req({}), start, { ...none, attempts: [pass(new Date("2026-09-10T18:00:00Z"))] }).met).toBe(true);
    expect(fulfillmentOf(req({}), start, { ...none, attempts: [pass(new Date("2026-05-10T18:00:00Z"))] }).met).toBe(false);
    expect(fulfillmentOf(req({}), start, { ...none, attempts: [{ ...pass(new Date("2026-09-10T18:00:00Z")), testId: "other" }] }).met).toBe(false);
  });

  it("is met by a check-in at the training this period", () => {
    const r = req({ kind: "TRAINING", testId: null, trainingEventId: "e" });
    expect(fulfillmentOf(r, start, { ...none, lastCheckIn: new Map([["e", new Date("2026-09-10T18:00:00Z")]]) }).met).toBe(true);
    expect(fulfillmentOf(r, start, { ...none, lastCheckIn: new Map([["e", new Date("2026-05-10T18:00:00Z")]]) }).met).toBe(false);
  });

  it("can't be met once its test or training is gone", () => {
    const passed = { ...none, attempts: [{ testId: "t", status: "GRADED" as const, passed: true, submittedAt: new Date("2026-09-10T18:00:00Z") }] };
    expect(fulfillmentOf(req({ testId: null }), start, passed).met).toBe(false);
    expect(fulfillmentOf(req({ kind: "TRAINING", testId: null, trainingEventId: null }), start, none).met).toBe(false);
  });

  it("is met by member details complete and confirmed this period", () => {
    const details = { studentId: "W01234567", birthDate: "2004-03-01", gender: "FEMALE" as const, phone: "801-555-0100", yearInSchool: "JUNIOR" as const, addressLine: "1 Main", addressCity: "Ogden", addressState: "UT", addressZip: "84408", emergencyName: "Pat", emergencyRelationship: "PARENT_GUARDIAN" as const, emergencyPhone: "801-555-0101", emergencyEmail: "pat@example.com" };
    const r = req({ kind: "PROFILE", testId: null });
    expect(fulfillmentOf(r, start, { ...none, person: { kind: "STUDENT", details: { ...details, confirmedAt: new Date("2026-09-01T18:00:00Z") } } }).met).toBe(true);
    expect(fulfillmentOf(r, start, { ...none, person: { kind: "STUDENT", details: { ...details, confirmedAt: new Date("2026-05-01T18:00:00Z") } } }).met).toBe(false);
    expect(fulfillmentOf(r, start, { ...none, person: { kind: "STUDENT", details: { ...details, phone: null, confirmedAt: new Date("2026-09-01T18:00:00Z") } } }).met).toBe(false);
  });
});

describe("seatDueAt and seatStatus", () => {
  it("runs the grace period from the latest of the seat, the club's approval, the period and the requirement", () => {
    const r = req({ graceDays: 30, createdAt: new Date("2026-09-20T18:00:00Z") });
    expect(seatDueAt(r, start, { startedAt: new Date("2025-01-01T00:00:00Z"), clubApprovedAt: null }).toISOString()).toBe("2026-10-20T18:00:00.000Z");
    expect(seatDueAt(r, start, { startedAt: new Date("2026-10-01T18:00:00Z"), clubApprovedAt: null }).toISOString()).toBe("2026-10-31T18:00:00.000Z");
    expect(seatDueAt(r, start, { startedAt: new Date("2025-01-01T00:00:00Z"), clubApprovedAt: new Date("2026-10-05T18:00:00Z") }).toISOString()).toBe("2026-11-04T18:00:00.000Z");
  });

  it("decides due, overdue and waiting per seat: the same attempt can be on time for one seat and late for another", () => {
    const r = req({ graceDays: 10 });
    const f = { met: false, attempts: [{ status: "NEEDS_REVIEW" as const, submittedAt: new Date("2026-10-05T18:00:00Z") }] };
    const early = seatStatus(r, start, f, { startedAt: new Date("2026-09-01T18:00:00Z"), clubApprovedAt: null }, mid); // due Sep 11: handed in late
    const late = seatStatus(r, start, f, { startedAt: new Date("2026-10-01T18:00:00Z"), clubApprovedAt: null }, mid); // due Oct 11: on time
    expect([early.state, early.gradingPending]).toEqual(["overdue", true]);
    expect([late.state, late.awaitingGrade]).toEqual(["review", true]);
    expect(seatStatus(r, start, { met: true, attempts: [] }, { startedAt: new Date(0), clubApprovedAt: null }, mid).state).toBe("met");
  });
});

describe("who a requirement reaches", () => {
  const leaders = ["OFFICER", "VP", "PRESIDENT"] as const;
  const umbrella = { appliesTo: [...leaders] };
  const campusRec = { appliesTo: [...leaders], officeId: "rec" };
  const safety = { appliesTo: [...leaders], gatesCapability: "events" };

  it("reaches its roles in every club when it's the umbrella's", () => {
    expect(requirementReaches(umbrella, { role: "OFFICER", clubOfficeId: null, holds: new Set() })).toBe(true);
    expect(requirementReaches(umbrella, { role: "OFFICER", clubOfficeId: "rec", holds: new Set() })).toBe(true);
    expect(requirementReaches(umbrella, { role: "MEMBER", clubOfficeId: null })).toBe(false);
    // Rows from before offices have no office or permission at all.
    expect(requirementReaches({ appliesTo: ["MEMBER"] }, { role: "MEMBER" })).toBe(true);
  });

  it("reaches only its own office's clubs when an office owns it", () => {
    expect(requirementReaches(campusRec, { role: "PRESIDENT", clubOfficeId: "rec", holds: "all" })).toBe(true);
    expect(requirementReaches(campusRec, { role: "PRESIDENT", clubOfficeId: null, holds: "all" })).toBe(false);
    expect(requirementReaches(campusRec, { role: "PRESIDENT", clubOfficeId: "fsl", holds: "all" })).toBe(false);
    expect(requirementReaches({ appliesTo: ["MEMBER"], officeId: "rec" }, { role: "MEMBER", clubOfficeId: "rec" })).toBe(true);
    expect(requirementReaches({ appliesTo: ["MEMBER"], officeId: "rec" }, { role: "MEMBER", clubOfficeId: null })).toBe(false);
  });

  it("reaches only leaders who hold its one permission: presidents and VPs hold them all", () => {
    expect(requirementReaches(safety, { role: "PRESIDENT", holds: heldCapabilities([{ role: "PRESIDENT", permissions: [] }]) })).toBe(true);
    expect(requirementReaches(safety, { role: "VP", holds: heldCapabilities([{ role: "VP", permissions: [] }]) })).toBe(true);
    expect(requirementReaches(safety, { role: "OFFICER", holds: heldCapabilities([{ role: "OFFICER", permissions: ["events", "budget"] }]) })).toBe(true);
    expect(requirementReaches(safety, { role: "OFFICER", holds: heldCapabilities([{ role: "OFFICER", permissions: ["budget"] }]) })).toBe(false);
    // Unknown holdings never reach (nothing is assumed).
    expect(requirementReaches(safety, { role: "OFFICER" })).toBe(false);
    // Members hold no permissions.
    expect(requirementReaches({ ...safety, appliesTo: ["MEMBER", ...leaders] }, { role: "MEMBER", holds: "all" })).toBe(false);
  });

  it("adds up a person's seats in the club: a second seat with the permission counts", () => {
    const held = heldCapabilities([
      { role: "OFFICER", permissions: ["budget"] },
      { role: "OFFICER", permissions: ["events"] },
    ]);
    expect(held === "all" ? "all" : [...held].sort()).toEqual(["budget", "events"]);
    expect(heldCapabilities([{ role: "ADVISOR", permissions: [] }])).toBe("all");
  });
});

describe("what an overdue requirement pauses", () => {
  it("pauses nothing when nothing is overdue", () => {
    expect(pauseFor([])).toEqual({ all: false, capabilities: [] });
  });

  it("pauses only the gated permission", () => {
    expect(pauseFor([{ gatesCapability: "events" }])).toEqual({ all: false, capabilities: ["events"] });
    expect(pauseFor([{ gatesCapability: "events" }, { gatesCapability: "budget" }, { gatesCapability: "events" }])).toEqual({ all: false, capabilities: ["budget", "events"] });
  });

  it("pauses everything when any overdue requirement gates no single permission", () => {
    expect(pauseFor([{ gatesCapability: "events" }, { gatesCapability: null }])).toEqual({ all: true, capabilities: [] });
    expect(pauseFor([{}])).toEqual({ all: true, capabilities: [] });
  });
});
