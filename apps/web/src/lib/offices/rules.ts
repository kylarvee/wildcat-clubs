/**
 * Offices: which campus office oversees a club. Pure and client-safe (no
 * imports), so domain code, pages, the seed and tests share one rule. The
 * reads are lib/offices; the writes lib/domain/offices.
 *
 * The umbrella invariant. One office is the umbrella: WSUSA. Nothing points
 * at it by id. A null officeId (on a Club, Task, Test or RoleRequirement)
 * means the umbrella, and setting anything to the umbrella stores null. Its
 * staff are the platform admins (ADMIN, SYSADMIN); every other office's staff
 * are its OfficeMember rows, who oversee that office's clubs only. An office
 * with no staff falls back to the umbrella's, so nothing goes unseen.
 */

/** The seed's and the code's stable keys (Office.key). */
export const OFFICE_KEYS = { umbrella: "wsusa", campusRec: "campus-rec", fsl: "fsl" } as const;

export type OfficeKey = (typeof OFFICE_KEYS)[keyof typeof OFFICE_KEYS];

/**
 * The office a new club goes to: club sports (scope Sports) to Campus
 * Recreation, fraternities and sororities (category FSL) to Fraternity &
 * Sorority Life, everything else to WSUSA. Applied when a club is created,
 * and again whenever a founder changes the scope or category before approval.
 */
export function officeKeyForClub(club: { scope: string; category: string | null }): OfficeKey {
  if (club.scope === "SPORTS") return OFFICE_KEYS.campusRec;
  if (club.category === "FSL") return OFFICE_KEYS.fsl;
  return OFFICE_KEYS.umbrella;
}

/** What to store for "this office": its id, or null for the umbrella (or no office). */
export function storedOfficeId(office: { id: string; umbrella: boolean } | null | undefined): string | null {
  return office && !office.umbrella ? office.id : null;
}

/**
 * Work that stays with the umbrella whatever office oversees the club, because
 * it's platform-wide: reports, review moderation, department requests (the
 * directory) and club Google account checks.
 */
export const UMBRELLA_TASK_SOURCES: readonly string[] = ["complaint", "reviewBombing", "reviewFlag", "departmentRequest", "googleAccount"];

/** Funding requests and invoices go to the club's office only when it decides its clubs' funding; else to the umbrella. */
export const FUNDING_TASK_SOURCES: readonly string[] = ["funding", "invoice"];

/**
 * Which office an admin task about a club is for (the officeId to store):
 * the club's office, except platform-wide work (the umbrella) and funding,
 * which goes to the club's office only when that office decides funding.
 * `club` is null for tasks about no club (they're the umbrella's).
 */
export function routeAdminTask(sourceType: string | null | undefined, club: { officeId: string | null; decidesFunding: boolean } | null): string | null {
  if (!club?.officeId) return null;
  if (sourceType && UMBRELLA_TASK_SOURCES.includes(sourceType)) return null;
  if (sourceType && FUNDING_TASK_SOURCES.includes(sourceType)) return club.decidesFunding ? club.officeId : null;
  return club.officeId;
}

/**
 * The office whose staff decide a club's funding: its own office when that
 * office decides funding, else the umbrella (null).
 */
export function fundingOfficeId(club: { officeId: string | null; decidesFunding: boolean }): string | null {
  return club.officeId && club.decidesFunding ? club.officeId : null;
}

/** Review time is a whole number of days, at least 1. */
export const REVIEW_DAYS = { min: 1, max: 60 } as const;

/**
 * The umbrella's contacts when there's no Office row yet (an older database
 * upgrades from its stored `wsusa.office` setting, lib/offices
 * ensureUmbrellaOffice). Student Involvement & Leadership (SIL) runs Clubs &
 * Organizations (https://www.weber.edu/studentinvolvement/). Room, hours,
 * phone and email are its Ogden office's, from
 * https://www.weber.edu/studentinvolvement/contact.html (checked October
 * 2026). reviewDays isn't published there: it's the platform's own estimate.
 * Admin → Offices asks a WSUSA admin to confirm these.
 */
export const UMBRELLA_DEFAULTS = {
  key: OFFICE_KEYS.umbrella,
  name: "WSUSA",
  shortName: "WSUSA",
  location: "Shepherd Union, Room 326",
  hours: "Monday–Friday, 8 a.m.–6 p.m.; Wednesday, 7 a.m.–7 p.m. (extended hours by appointment)",
  email: "wsusa@weber.edu",
  phone: "801-626-6349",
  reviewDays: 10,
} as const;

/** "Overseen by Campus Recreation": what a club page says. */
export function overseenBy(office: { name: string }): string {
  return `Overseen by ${office.name}`;
}
