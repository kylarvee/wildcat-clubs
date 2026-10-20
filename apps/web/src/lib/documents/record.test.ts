import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import type { TermLike } from "@/lib/metrics/pure";
import { summarizeService } from "@/lib/metrics/service";
import { buildInvolvementRecord, clubEventsLabel, seatDates, studyLine, type RecordFacts, type RecordPerson } from "./record";

const term = (name: string, start: [number, number, number], end: [number, number, number]): TermLike => ({
  name,
  academicYear: "2025-2026",
  startsOn: campusDate(...start),
  endsOn: campusDate(...end),
  countsForActivity: true,
});
const TERMS = [term("Fall 2026", [2026, 8, 24], [2026, 12, 12]), term("Spring 2026", [2026, 1, 7], [2026, 5, 1])];

const PSYCH = { id: "psych", name: "Psi Chi", slug: "psi-chi" };
const PREMED = { id: "premed", name: "Pre-Med Club", slug: "pre-med-club" };
const SERVICE = { id: "service", name: "Wildcat Service Club", slug: "wildcat-service-club" };
const FOUNDING = { id: "draft", name: "Drafty Club", slug: "drafty-club" };

const maya: RecordPerson = {
  id: "maya",
  name: "Maya Chen",
  handle: "maya",
  email: "maya.chen@mail.weber.edu",
  kind: "STUDENT",
  status: "ACTIVE",
  majors: ["Psychology"],
  minors: ["Spanish"],
  classYear: 2027,
  graduatedAt: null,
  jobTitle: null,
  department: null,
};

const service = summarizeService(
  [
    { attendanceId: "a1", occurrenceId: "o1", eventId: "e1", title: "Food Drive", startsAt: campusDate(2026, 10, 3, 9), serviceMinutes: 120, club: SERVICE, cohosts: [] },
    { attendanceId: "a2", occurrenceId: "o2", eventId: "e2", title: "WSUSA Day of Service", startsAt: campusDate(2026, 9, 26, 9), serviceMinutes: 180, club: null, cohosts: [] },
  ],
  TERMS,
);

const facts: RecordFacts = {
  person: maya,
  generatedAt: campusDate(2026, 10, 20, 15),
  seats: [
    { id: "s1", title: "Secretary", role: "OFFICER", club: { ...PSYCH, status: "APPROVED" }, via: null, startedAt: campusDate(2025, 9, 1), endedAt: campusDate(2026, 5, 1), endReason: "Term ended" },
    { id: "s2", title: "Vice President", role: "VP", club: { ...PSYCH, status: "APPROVED" }, via: null, startedAt: campusDate(2026, 5, 2), endedAt: null, endReason: null },
    { id: "s3", title: "President", role: "PRESIDENT", club: { ...FOUNDING, status: "DRAFT" }, via: null, startedAt: campusDate(2026, 9, 1), endedAt: null, endReason: null },
  ],
  service,
  checkins: [
    { startsAt: campusDate(2026, 10, 7, 18), clubs: [PSYCH], guestOf: [] },
    { startsAt: campusDate(2026, 10, 14, 18), clubs: [PSYCH], guestOf: [] },
    // Co-hosted by Pre-Med, which she isn't in.
    { startsAt: campusDate(2026, 10, 9, 18), clubs: [PSYCH, PREMED], guestOf: ["premed"] },
    { startsAt: campusDate(2026, 10, 3, 9), clubs: [SERVICE], guestOf: [] },
    { startsAt: campusDate(2026, 2, 10, 18), clubs: [PSYCH], guestOf: [] },
    // University events aren't club attendance (they're under service hours or trainings).
    { startsAt: campusDate(2026, 9, 26, 9), clubs: [], guestOf: [] },
  ],
  memberships: [
    { club: { ...PSYCH, status: "APPROVED" }, status: "ACTIVE", joinedAt: campusDate(2024, 9, 1) },
    { club: { ...SERVICE, status: "APPROVED" }, status: "ACTIVE", joinedAt: campusDate(2026, 10, 1) },
    { club: { id: "hiking", name: "Hiking Club", slug: "hiking", status: "APPROVED" }, status: "PENDING", joinedAt: null },
    { club: { ...FOUNDING, status: "DRAFT" }, status: "ACTIVE", joinedAt: campusDate(2026, 9, 1) },
  ],
  completed: [
    { id: "c1", name: "Club Officer Training", kind: "training", at: campusDate(2025, 9, 10, 17), required: true },
    { id: "c2", name: "Club Officer Policy Test", kind: "test", at: campusDate(2026, 9, 12, 12), required: true },
  ],
  terms: TERMS,
};

describe("the involvement record", () => {
  const r = buildInvolvementRecord(facts);

  it("lists leadership seats from the role history, current first, recognized clubs only", () => {
    expect(r.leadership.map((s) => `${s.title} · ${s.club.name}`)).toEqual(["Vice President · Psi Chi", "Secretary · Psi Chi"]);
    expect(r.leadership[0].club).toEqual(PSYCH);
  });

  it("counts club events by term, a co-hosted one for each club, members and guests apart", () => {
    expect(r.attendance.events).toBe(5);
    expect(r.attendance.byTerm).toEqual([
      {
        term: "Fall 2026",
        events: 4,
        clubs: [
          { club: PSYCH, events: 3, asMember: true },
          { club: PREMED, events: 1, asMember: false },
          { club: SERVICE, events: 1, asMember: true },
        ],
      },
      { term: "Spring 2026", events: 1, clubs: [{ club: PSYCH, events: 1, asMember: true }] },
    ]);
  });

  it("sums up the four numbers from the same facts", () => {
    // Clubs: Psi Chi, Pre-Med (visited), Wildcat Service. Not the pending request or the club in founding.
    expect(r.summary).toEqual({ serviceMinutes: 300, serviceEvents: 2, clubs: 3, leadershipRoles: 2 });
  });

  it("keeps the service summary as lib/metrics made it, and completions newest first", () => {
    expect(r.service).toBe(service);
    expect(r.completed.map((c) => c.id)).toEqual(["c2", "c1"]);
  });

  it("is empty but whole for someone just starting", () => {
    const empty = buildInvolvementRecord({ ...facts, seats: [], service: summarizeService([], TERMS), checkins: [], memberships: [], completed: [] });
    expect(empty.summary).toEqual({ serviceMinutes: 0, serviceEvents: 0, clubs: 0, leadershipRoles: 0 });
    expect(empty.attendance).toEqual({ events: 0, byTerm: [] });
  });
});

describe("record wording", () => {
  it("dates seats by month", () => {
    expect(seatDates({ startedAt: campusDate(2025, 9, 1), endedAt: campusDate(2026, 5, 1) })).toBe("Sep 2025 – May 2026");
    expect(seatDates({ startedAt: campusDate(2026, 5, 2), endedAt: null })).toBe("May 2026 – present");
  });

  it("says what someone studies, or what they do on staff", () => {
    expect(studyLine(maya)).toBe("Psychology major · Spanish minor · Class of 2027");
    expect(studyLine({ ...maya, majors: ["Physics", "Math"], minors: [], status: "ALUMNI", graduatedAt: campusDate(2026, 5, 2) })).toBe("Physics & Math majors · Graduated May 2026");
    expect(studyLine({ ...maya, kind: "FACULTY_STAFF", jobTitle: "Associate Professor", department: "Psychology" })).toBe("Associate Professor · Psychology");
    expect(clubEventsLabel(1)).toBe("1 club event");
  });
});
