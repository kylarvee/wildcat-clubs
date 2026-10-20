import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import type { TermLike } from "@/lib/metrics/pure";
import { summarizeService, type ServiceCheckin } from "@/lib/metrics/service";
import { renderInvolvementPdf } from "./involvement-pdf";
import { buildInvolvementRecord, type RecordFacts } from "./record";
import { qrPath } from "./kit";

const term = (name: string, start: [number, number, number], end: [number, number, number]): TermLike => ({ name, academicYear: "2026-2027", startsOn: campusDate(...start), endsOn: campusDate(...end), countsForActivity: true });
const TERMS = [term("Fall 2025", [2025, 8, 25], [2025, 12, 13]), term("Spring 2026", [2026, 1, 7], [2026, 5, 1]), term("Fall 2026", [2026, 8, 24], [2026, 12, 12])];
const PSYCH = { id: "psych", name: "Psi Chi Honors Club / Psi Cho (Psychology Club)", slug: "psi-chi" };
const PREMED = { id: "premed", name: "Pre-Med Club 🩺", slug: "pre-med-club" };
const SERVICE = { id: "service", name: "Wildcat Service Club", slug: "wildcat-service-club" };

const svc = (n: number, p: Partial<ServiceCheckin>): ServiceCheckin => ({
  attendanceId: `a${n}`,
  occurrenceId: `o${n}`,
  eventId: `e${n}`,
  title: "Mental Health Awareness Fair",
  startsAt: campusDate(2026, 10, 10, 9),
  serviceMinutes: 180,
  club: PSYCH,
  cohosts: [],
  ...p,
});

function facts(over: Partial<RecordFacts> = {}): RecordFacts {
  return {
    person: { id: "maya", name: "Maya Chen", handle: "maya", email: "maya.chen@mail.weber.edu", kind: "STUDENT", status: "ACTIVE", majors: ["Psychology"], minors: [], classYear: 2027, graduatedAt: null, jobTitle: null, department: null },
    generatedAt: campusDate(2026, 10, 20, 15, 12),
    seats: [{ id: "s1", title: "Secretary", role: "OFFICER", club: { ...PSYCH, status: "APPROVED" }, via: null, startedAt: campusDate(2025, 9, 1), endedAt: null, endReason: null }],
    service: summarizeService(
      [
        svc(1, {}),
        svc(2, { title: "Flu Shot Clinic Volunteer Shift", club: PREMED, cohosts: [SERVICE] }),
        svc(3, { title: "WSUSA Day of Service", club: null, startsAt: campusDate(2026, 10, 3, 9) }),
        svc(4, { title: "Weber Cares Pantry Restock Night", club: null, serviceMinutes: 120, startsAt: campusDate(2026, 10, 7, 18) }),
        svc(5, { title: "Voter Registration Drive", startsAt: campusDate(2026, 2, 21, 9) }),
      ],
      TERMS,
    ),
    checkins: [
      { startsAt: campusDate(2026, 10, 7, 18), clubs: [PSYCH], guestOf: [] },
      { startsAt: campusDate(2026, 10, 9, 18), clubs: [PREMED, SERVICE], guestOf: ["service"] },
      { startsAt: campusDate(2026, 3, 9, 18), clubs: [PSYCH], guestOf: [] },
    ],
    memberships: [],
    completed: [{ id: "c1", name: "Club Officer Training", kind: "training", at: campusDate(2026, 9, 9, 17, 30), required: true }],
    terms: TERMS,
    ...over,
  };
}

const verify = { url: "http://localhost:3100/verify/ir.cmaya000000000000000000001.mgz3k2p0.AbCdEfGhIjKlMnOpQrStUvWx", issuedAt: campusDate(2026, 10, 20, 15, 12) };

describe("involvement record PDF", () => {
  it("renders a full record", async () => {
    const pdf = await renderInvolvementPdf(buildInvolvementRecord(facts()), verify);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(4000);
    if (process.env.PDF_OUT) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(`${process.env.PDF_OUT}/involvement-record.pdf`, pdf);
    }
  }, 30000);

  it("renders an empty record and a long one across pages", async () => {
    const empty = await renderInvolvementPdf(buildInvolvementRecord(facts({ seats: [], service: summarizeService([], TERMS), checkins: [], completed: [] })), verify);
    expect(empty.subarray(0, 5).toString()).toBe("%PDF-");
    const many = Array.from({ length: 70 }, (_, n) => svc(100 + n, { title: `Tutoring Night ${n + 1}`, startsAt: campusDate(2026, 9, 1 + (n % 28), 18), serviceMinutes: 90 }));
    const long = await renderInvolvementPdf(buildInvolvementRecord(facts({ service: summarizeService(many, TERMS) })), verify);
    expect(long.toString("latin1")).toMatch(/\/Count [2-9]/);
    if (process.env.PDF_OUT) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(`${process.env.PDF_OUT}/involvement-record-empty.pdf`, empty);
      await writeFile(`${process.env.PDF_OUT}/involvement-record-long.pdf`, long);
    }
  }, 30000);

  it("draws the QR code as one path of dark runs", () => {
    expect(qrPath(["1101", "0111"])).toBe("M0 0h2v1h-2zM3 0h1v1h-1zM1 1h3v1h-3z");
  });
});
