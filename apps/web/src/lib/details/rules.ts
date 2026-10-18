import type { EmergencyRelationship, Gender, UserKind, YearInSchool } from "@prisma/client";

/**
 * Member details: what WSUSA needs from every club member, kept once per
 * person (Settings → Member details) instead of in each club's sign-up.
 * Pure and client-safe: labels, what "complete" means, and formatting.
 */

export const GENDER_LABEL: Record<Gender, string> = {
  FEMALE: "Female",
  MALE: "Male",
  NON_BINARY: "Non-binary",
  PREFER_NOT_TO_SAY: "Prefer not to say",
};

export const YEAR_LABEL: Record<YearInSchool, string> = {
  FRESHMAN: "Freshman",
  SOPHOMORE: "Sophomore",
  JUNIOR: "Junior",
  SENIOR: "Senior",
  GRADUATE: "Graduate student",
  OTHER: "Other",
};

export const RELATIONSHIP_LABEL: Record<EmergencyRelationship, string> = {
  PARENT_GUARDIAN: "Parent or guardian",
  SPOUSE_PARTNER: "Spouse or partner",
  CHILD: "Child",
  SIBLING: "Sibling",
  RELATIVE: "Relative",
  FRIEND: "Friend",
  OTHER: "Other",
};

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE",
  "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "AS", "GU", "MP", "PR", "VI",
] as const;

export type DetailsLike = {
  studentId?: string | null;
  birthDate?: Date | string | null;
  gender?: Gender | null;
  phone?: string | null;
  yearInSchool?: YearInSchool | null;
  addressLine?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  emergencyName?: string | null;
  emergencyRelationship?: EmergencyRelationship | null;
  emergencyPhone?: string | null;
  emergencyEmail?: string | null;
  confirmedAt?: Date | string | null;
};

const FIELD_LABEL: Record<string, string> = {
  studentId: "Student ID",
  birthDate: "Date of birth",
  gender: "Gender",
  phone: "Phone",
  yearInSchool: "Year in school",
  addressLine: "Street address",
  addressCity: "City",
  addressState: "State",
  addressZip: "ZIP code",
  emergencyName: "Emergency contact name",
  emergencyRelationship: "Emergency contact relationship",
  emergencyPhone: "Emergency contact phone",
  emergencyEmail: "Emergency contact email",
};

/** What's still missing, as field labels. Faculty and staff aren't asked for a student ID, year in school or date of birth. */
export function missingDetails(d: DetailsLike | null | undefined, kind: UserKind): string[] {
  const keys = Object.keys(FIELD_LABEL).filter((k) => kind === "STUDENT" || !["studentId", "yearInSchool", "birthDate"].includes(k));
  return keys.filter((k) => !d || d[k as keyof DetailsLike] === null || d[k as keyof DetailsLike] === undefined || d[k as keyof DetailsLike] === "").map((k) => FIELD_LABEL[k]);
}

/** Complete, and confirmed on or after `since` (the start of the renewal period). */
export function detailsCurrent(d: DetailsLike | null | undefined, kind: UserKind, since: Date): boolean {
  if (!d?.confirmedAt || missingDetails(d, kind).length) return false;
  return new Date(d.confirmedAt) >= since;
}

/** "W01234567" from "w01234567" or "01234567". Null when it isn't a W-number. */
export function normalizeStudentId(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  const m = /^W?(\d{8})$/.exec(s);
  return m ? `W${m[1]}` : null;
}

/** "801-555-0123" for US numbers (10 digits, optional leading 1); "+44 20 7946 0958" kept as typed for others. Null when it isn't a phone number. */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim();
  const digits = s.replace(/\D/g, "");
  if (!s.startsWith("+") && (digits.length === 10 || (digits.length === 11 && digits.startsWith("1")))) {
    const d = digits.slice(-10);
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (s.startsWith("+") && digits.length >= 8 && digits.length <= 15) return s.replace(/\s+/g, " ");
  return null;
}

/** Whole years old on `at` (birthday counted on the day). */
export function ageOn(birthDate: Date, at: Date): number {
  const b = new Date(birthDate);
  let age = at.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday = at.getUTCMonth() < b.getUTCMonth() || (at.getUTCMonth() === b.getUTCMonth() && at.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age--;
  return age;
}
