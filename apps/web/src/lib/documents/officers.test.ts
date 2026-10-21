import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import { renewalWindow, type RenewalTerm } from "@/lib/renewals/rules";
import { loadOfficersRecord, officerRows, officersFileName, officersRenewal, recognizedLine, renewalFact, renewalLine, type SeatAssignment } from "./officers";
import { renderOfficersPdf } from "./officers-pdf";

/**
 * The officers of record (lib/documents/officers): who's on the letter and in
 * what order, where the club stands, and that nothing from a student's
 * account but their name is ever read or printed.
 */

const TERMS: RenewalTerm[] = [
  { name: "Spring 2026", academicYear: "2025-2026", startsOn: campusDate(2026, 1, 5), endsOn: campusDate(2026, 5, 1, 23, 59) },
  { name: "Fall 2026", academicYear: "2026-2027", startsOn: campusDate(2026, 8, 31), endsOn: campusDate(2026, 12, 18, 23, 59) },
];
const NOW = campusDate(2026, 10, 20, 15, 12);
const window = renewalWindow(TERMS, NOW, 30)!;

const seat = (name: string, sortOrder: number, archivedAt: Date | null = null) => ({ name, sortOrder, archivedAt });
const a = (id: string, role: SeatAssignment["role"], name: string, startedAt: Date, position: SeatAssignment["position"]): SeatAssignment => ({ id, role, startedAt, position, user: { id: `u-${id}`, name } });

const ASSIGNMENTS: SeatAssignment[] = [
  a("tre", "OFFICER", "Oscar Nguyen", campusDate(2026, 9, 30), seat("Treasurer", 2)),
  a("amb", "AMBASSADOR", "Amir Haddad", campusDate(2025, 9, 7), seat("College Ambassador", 9)),
  a("pres", "PRESIDENT", "Priya Patel", campusDate(2026, 5, 1, 10), seat("President", 0)),
  a("adv2", "ADVISOR", "Prof. Nathan Reed", campusDate(2024, 1, 10), null),
  a("sec", "OFFICER", "Jordan Lee", campusDate(2025, 8, 20), seat("Secretary", 3)),
  a("old", "OFFICER", "Casey Moore", campusDate(2024, 9, 2), seat("Historian", 5, campusDate(2026, 3, 1))),
  a("vp", "VP", "Vanessa Brooks", campusDate(2026, 5, 1, 10), seat("Vice President", 1)),
  a("adv1", "ADVISOR", "Dr. Elena Alvarez", campusDate(2022, 9, 1), null),
  a("ev2", "OFFICER", "Sam Rivera", campusDate(2026, 2, 1), seat("Events Coordinator", 4)),
  a("ev1", "OFFICER", "Maya Chen", campusDate(2025, 9, 1), seat("Events Coordinator", 4)),
];

describe("officerRows", () => {
  it("lists the club's own seats in pipeline order, co-holders by who took the seat first, then its advisors", () => {
    const { officers, advisors } = officerRows(ASSIGNMENTS, "SPONSORED");
    expect(officers.map((o) => `${o.title}: ${o.name}`)).toEqual([
      "President: Priya Patel",
      "Vice President: Vanessa Brooks",
      "Treasurer: Oscar Nguyen",
      "Secretary: Jordan Lee",
      "Events Coordinator: Maya Chen",
      "Events Coordinator: Sam Rivera",
      // A seat that was archived under its holder: listed under the role, after that tier's seats.
      "Officer: Casey Moore",
    ]);
    expect(officers[0].since).toEqual(campusDate(2026, 5, 1, 10));
    expect(advisors.map((x) => x.name)).toEqual(["Dr. Elena Alvarez", "Prof. Nathan Reed"]);
  });

  it("leaves a regular club's College Ambassador off (the college places them), but lists a program's own ambassador seats", () => {
    expect(officerRows(ASSIGNMENTS, "SPONSORED").officers.some((o) => o.role === "AMBASSADOR")).toBe(false);
    expect(officerRows(ASSIGNMENTS, "COLLEGE_AMBASSADORS").officers.map((o) => o.title)).toContain("College Ambassador");
  });
});

describe("where the club stands", () => {
  const club = { status: "APPROVED", type: "SPONSORED", approvedAt: campusDate(2022, 9, 20) };

  it("says whether it re-registered this academic year, under the one window every club shares", () => {
    expect(officersRenewal(club, window, campusDate(2026, 9, 13), NOW)).toEqual({ kind: "renewed", year: "2026–27", at: campusDate(2026, 9, 13) });
    expect(officersRenewal(club, window, null, campusDate(2026, 9, 10))).toMatchObject({ kind: "due", dueAt: window.dueAt });
    expect(officersRenewal(club, window, null, NOW)).toMatchObject({ kind: "overdue" });
    expect(officersRenewal({ ...club, approvedAt: campusDate(2026, 9, 21) }, window, null, NOW)).toEqual({ kind: "firstYear", year: "2026–27" });
    expect(officersRenewal({ ...club, type: "COLLEGE_AMBASSADORS" }, window, null, NOW)).toEqual({ kind: "none" });
    expect(officersRenewal(club, null, null, NOW)).toEqual({ kind: "none" });
  });

  it("words it the same way on the letter and the verify page", () => {
    expect(recognizedLine({ recognizedSince: campusDate(2022, 9, 20) })).toBe("Recognized since September 20, 2022");
    expect(recognizedLine({ recognizedSince: null })).toBeNull();
    expect(renewalLine(officersRenewal(club, window, campusDate(2026, 9, 13), NOW))).toBe("Re-registered for 2026–27 on September 13, 2026");
    expect(renewalLine(officersRenewal(club, window, null, NOW))).toBe("Not yet re-registered for 2026–27 (it was due September 30, 2026)");
    expect(renewalFact(officersRenewal(club, window, null, campusDate(2026, 9, 10)))).toEqual({ label: "2026–27 renewal", value: "Not yet re-registered", hint: "Due September 30, 2026" });
    expect(renewalFact(officersRenewal(club, window, campusDate(2026, 9, 13), NOW))).toEqual({ label: "2026–27 renewal", value: "Re-registered September 13, 2026" });
    expect(renewalFact({ kind: "none" })).toBeNull();
    expect(officersFileName({ club: { id: "c", name: "RC Wrecker Bots Club", slug: "rc-wrecker-bots-club", status: "APPROVED", type: "SPONSORED", retiredAt: null }, generatedAt: NOW })).toBe(
      "officers-of-record-rc-wrecker-bots-club-2026-10-20.pdf",
    );
  });
});

/** A Prisma-like client that returns only the fields a query selects, over rows that do have contact details. */
function fakeClient(opts: { officeId: string | null; offices: { id: string; umbrella: boolean; name: string; email: string | null; phone: string | null }[]; renewedAt?: Date }) {
  const seen: { select: unknown }[] = [];
  const pick = (row: Record<string, unknown>, select: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(select).map(([k, v]) => {
        const value = row[k];
        if (v === true) return [k, value];
        const inner = (v as { select: Record<string, unknown> }).select;
        return [k, value && typeof value === "object" && !(value instanceof Date) ? pick(value as Record<string, unknown>, inner) : value];
      }),
    );
  const people = ASSIGNMENTS.map((x) => ({
    ...x,
    user: { ...x.user, email: `${x.user.id}@mail.weber.edu`, phone: "801-555-0100", details: { phone: "801-555-0199", emergencyContact: "Mom" } },
  }));
  const client = {
    club: {
      findUnique: async ({ select }: { select: Record<string, unknown> }) =>
        pick({ id: "robotics", name: "RC Wrecker Bots Club", slug: "rc-wrecker-bots-club", status: "APPROVED", type: "SPONSORED", approvedAt: campusDate(2022, 9, 20), retiredAt: null, officeId: opts.officeId, contactEmail: "rcwreckerbots@weber.edu" }, select),
    },
    roleAssignment: {
      findMany: async ({ select }: { select: Record<string, unknown> }) => {
        seen.push({ select });
        return people.map((p) => pick(p as unknown as Record<string, unknown>, select));
      },
    },
    office: {
      findFirst: async ({ where, select }: { where: { id?: string; umbrella?: boolean }; select: Record<string, unknown> }) => {
        const o = opts.offices.find((x) => (where.id ? x.id === where.id : x.umbrella));
        return o ? pick({ ...o, location: "Stewart Wasatch Hall", hours: "Weekdays 8–5" }, select) : null;
      },
    },
    clubRenewal: { findUnique: async () => (opts.renewedAt ? { submittedAt: opts.renewedAt } : null) },
  };
  return { client: client as unknown as Parameters<typeof loadOfficersRecord>[0], seen };
}

const CAMPUS_REC = { id: "rec", umbrella: false, name: "Campus Recreation", email: "campusrec@weber.edu", phone: "801-626-6000" };

describe("loadOfficersRecord", () => {
  it("reads names, titles and start dates only: no student's email, phone or details reach the letter", async () => {
    const { client, seen } = fakeClient({ officeId: "rec", offices: [CAMPUS_REC] });
    const record = (await loadOfficersRecord(client, "robotics", { window, now: NOW }))!;
    expect(seen[0].select).toMatchObject({ user: { select: { id: true, name: true } } });
    expect(Object.keys((seen[0].select as { user: { select: object } }).user.select)).toEqual(["id", "name"]);
    const text = JSON.stringify(record);
    expect(text).not.toMatch(/mail\.weber\.edu|801-555|emergency/i);
    expect(record.officers[0]).toEqual({ id: "pres", title: "President", role: "PRESIDENT", name: "Priya Patel", since: campusDate(2026, 5, 1, 10) });
    // The only contacts are the overseeing office's public ones.
    expect(record.office).toEqual({ name: "Campus Recreation", location: "Stewart Wasatch Hall", hours: "Weekdays 8–5", email: "campusrec@weber.edu", phone: "801-626-6000" });
    expect(record.renewal).toMatchObject({ kind: "overdue", year: "2026–27" });
    expect(record.generatedAt).toEqual(NOW);
  });

  it("names WSUSA for a club with no office of its own, even before WSUSA's office row exists", async () => {
    const umbrella = { id: "wsusa", umbrella: true, name: "WSUSA", email: "wsusa@weber.edu", phone: "801-626-6349" };
    expect((await loadOfficersRecord(fakeClient({ officeId: null, offices: [umbrella, CAMPUS_REC] }).client, "robotics", { window, now: NOW }))!.office.name).toBe("WSUSA");
    const fallback = (await loadOfficersRecord(fakeClient({ officeId: null, offices: [] }).client, "robotics", { window, now: NOW }))!;
    expect(fallback.office).toMatchObject({ name: "WSUSA", email: "wsusa@weber.edu" });
  });

  it("renders a one-page letter", async () => {
    const { client } = fakeClient({ officeId: null, offices: [], renewedAt: campusDate(2026, 9, 13) });
    const record = (await loadOfficersRecord(client, "robotics", { window, now: NOW }))!;
    const pdf = await renderOfficersPdf(record, { url: "http://localhost:3100/verify/or.robotics.mgz3k2p0.AbCdEfGhIjKlMnOpQrStUvWx", issuedAt: NOW });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).toMatch(/\/Count 1\b/);
    const empty = await renderOfficersPdf({ ...record, officers: [], advisors: [], renewal: { kind: "none" } }, { url: "http://localhost:3100/verify/x", issuedAt: NOW });
    expect(empty.subarray(0, 5).toString()).toBe("%PDF-");
    if (process.env.PDF_OUT) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(`${process.env.PDF_OUT}/officers-of-record.pdf`, pdf);
      await writeFile(`${process.env.PDF_OUT}/officers-of-record-empty.pdf`, empty);
    }
  }, 30000);
});
