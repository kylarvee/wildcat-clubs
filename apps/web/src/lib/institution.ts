// Everything that tailors the platform to one university lives here (code-level)
// or in system config (things a sysadmin changes at runtime, like office hours
// and the help email, `platform.supportEmail`).
// To run the platform for another school, change this file, the config defaults and the seed data.

export const PLATFORM = {
  name: "Wildcat Clubs",
  tagline: "Find, found and run your club at Weber State.",
} as const;

export const INSTITUTION = {
  name: "Weber State University",
  shortName: "Weber State",
  abbreviation: "WSU",
  mascot: "Wildcats",
  studentGovernment: "WSUSA",
  studentGovernmentLong: "Weber State University Student Association",
  /** Students sign in with this domain. */
  studentEmailDomain: "mail.weber.edu",
  /** Faculty and staff (the only accounts that can be club advisors). */
  staffEmailDomain: "weber.edu",
  timezone: "America/Denver",
  city: "Ogden, Utah",
  /** Appended to campus building names so Google Maps pins the right place. */
  mapsSuffix: "Weber State University, Ogden, UT",
  campusCenter: { lat: 41.1915, lng: -111.9441 },
} as const;

export type EmailKind = "STUDENT" | "FACULTY_STAFF";

/** Which kind of account an email belongs to, or null if it isn't a university email. */
export function emailKind(email: string): EmailKind | null {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (domain === INSTITUTION.studentEmailDomain) return "STUDENT";
  if (domain === INSTITUTION.staffEmailDomain) return "FACULTY_STAFF";
  return null;
}

export function isUniversityEmail(email: string): boolean {
  return emailKind(email) !== null;
}

export function isStaffEmail(email: string): boolean {
  return emailKind(email) === "FACULTY_STAFF";
}
