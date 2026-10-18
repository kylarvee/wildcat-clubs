import { describe, expect, it } from "vitest";
import { ageOn, detailsCurrent, missingDetails, normalizePhone, normalizeStudentId } from "@/lib/details/rules";

const complete = {
  studentId: "W01234567", birthDate: "2004-05-02", gender: "FEMALE", phone: "801-555-0101", yearInSchool: "JUNIOR",
  addressLine: "123 Harrison Blvd", addressCity: "Ogden", addressState: "UT", addressZip: "84408",
  emergencyName: "Pat Doe", emergencyRelationship: "PARENT_GUARDIAN", emergencyPhone: "801-555-0102", emergencyEmail: "pat@example.com",
} as const;

describe("missingDetails", () => {
  it("is empty when everything is filled in", () => {
    expect(missingDetails(complete, "STUDENT")).toEqual([]);
  });
  it("names what's missing", () => {
    expect(missingDetails({ ...complete, phone: "", emergencyEmail: null }, "STUDENT")).toEqual(["Phone", "Emergency contact email"]);
    expect(missingDetails(null, "STUDENT")).toHaveLength(13);
  });
  it("doesn't ask faculty and staff for a student ID, year in school or birth date", () => {
    expect(missingDetails({ ...complete, studentId: null, yearInSchool: null, birthDate: null }, "FACULTY_STAFF")).toEqual([]);
  });
});

describe("detailsCurrent", () => {
  const since = new Date("2026-08-24T06:00:00Z");
  it("needs a confirmation this period", () => {
    expect(detailsCurrent({ ...complete, confirmedAt: "2026-09-01T00:00:00Z" }, "STUDENT", since)).toBe(true);
    expect(detailsCurrent({ ...complete, confirmedAt: "2026-05-01T00:00:00Z" }, "STUDENT", since)).toBe(false);
    expect(detailsCurrent({ ...complete, confirmedAt: null }, "STUDENT", since)).toBe(false);
  });
  it("is never current with a gap", () => {
    expect(detailsCurrent({ ...complete, addressZip: null, confirmedAt: "2026-09-01T00:00:00Z" }, "STUDENT", since)).toBe(false);
  });
});

describe("normalizers", () => {
  it("reads W-numbers", () => {
    expect(normalizeStudentId("w01234567")).toBe("W01234567");
    expect(normalizeStudentId("01234567")).toBe("W01234567");
    expect(normalizeStudentId("W123")).toBeNull();
  });
  it("formats US phones and keeps international ones", () => {
    expect(normalizePhone("(801) 555-0123")).toBe("801-555-0123");
    expect(normalizePhone("1 801 555 0123")).toBe("801-555-0123");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(normalizePhone("555-0123")).toBeNull();
  });
  it("counts age on the birthday", () => {
    expect(ageOn(new Date("2008-10-18"), new Date("2026-10-18T12:00:00Z"))).toBe(18);
    expect(ageOn(new Date("2008-10-19"), new Date("2026-10-18T12:00:00Z"))).toBe(17);
  });
});
