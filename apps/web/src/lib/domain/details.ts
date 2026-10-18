import "server-only";
import type { PersonalDetails, YearInSchool } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { canSeeMemberContacts, isClubMemberOrRequest, seesAllDetails } from "@/lib/authz/details";
import { logActivity } from "@/lib/lake/activity";
import { assertSignedIn, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { syncUserRequirements } from "@/lib/domain/requirements";
import { missingDetails, normalizePhone, normalizeStudentId, US_STATES } from "@/lib/details/rules";

/**
 * Member details — the one input tool for the personal information WSUSA
 * needs from club members (Settings → Member details). Entered once and
 * reused for every club, instead of in each club's sign-up. Who may see what
 * is lib/authz/details. The activity log records that details changed or
 * were opened, never the values.
 */

const Text = (max: number, msg: string) => z.string().trim().max(max, msg);
const Optional = (s: z.ZodString) => s.nullish().transform((v) => v || null);

const Input = z.object({
  studentId: Optional(Text(20, "That doesn't look like a W-number.")),
  birthDate: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter your date of birth."),
  gender: z.enum(["FEMALE", "MALE", "NON_BINARY", "PREFER_NOT_TO_SAY"]).nullish().transform((v) => v ?? null),
  phone: Optional(Text(30, "That phone number is too long.")),
  contactEmail: Optional(Text(200, "That email is too long.")),
  yearInSchool: z.enum(["FRESHMAN", "SOPHOMORE", "JUNIOR", "SENIOR", "GRADUATE", "OTHER"]).nullish().transform((v) => v ?? null),
  addressLine: Optional(Text(200, "Keep the street address under 200 characters.")),
  addressCity: Optional(Text(100, "Keep the city under 100 characters.")),
  addressState: Optional(Text(2, "Choose a state.")),
  addressZip: Optional(Text(10, "That ZIP code is too long.")),
  emergencyName: Optional(Text(120, "Keep the name under 120 characters.")),
  emergencyRelationship: z.enum(["PARENT_GUARDIAN", "SPOUSE_PARTNER", "CHILD", "SIBLING", "RELATIVE", "FRIEND", "OTHER"]).nullish().transform((v) => v ?? null),
  emergencyPhone: Optional(Text(30, "That phone number is too long.")),
  emergencyEmail: Optional(Text(200, "That email is too long.")),
});
export type DetailsInput = z.input<typeof Input>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(raw: z.infer<typeof Input>, kind: Actor["kind"], now: Date) {
  const v = { ...raw };
  if (v.studentId) {
    const id = normalizeStudentId(v.studentId);
    if (!id) throw invalid("Enter your W-number: a W and eight digits, like W01234567.");
    v.studentId = id;
  }
  if (kind !== "STUDENT") {
    v.studentId = null;
    v.yearInSchool = null;
  }
  let birthDate: Date | null = null;
  if (v.birthDate) {
    birthDate = new Date(`${v.birthDate}T00:00:00Z`);
    const years = (now.getTime() - birthDate.getTime()) / (365.25 * 86_400_000);
    if (Number.isNaN(years) || years < 13 || years > 100) throw invalid("Check your date of birth.");
  }
  for (const key of ["phone", "emergencyPhone"] as const) {
    if (!v[key]) continue;
    const p = normalizePhone(v[key]!);
    if (!p) throw invalid(key === "phone" ? "Enter your phone number with its area code." : "Enter your emergency contact's phone number with its area code.");
    v[key] = p;
  }
  for (const key of ["contactEmail", "emergencyEmail"] as const) {
    if (v[key] && !EMAIL.test(v[key]!)) throw invalid(key === "contactEmail" ? "Check your personal email." : "Check your emergency contact's email.");
    if (v[key]) v[key] = v[key]!.toLowerCase();
  }
  if (v.addressState) {
    v.addressState = v.addressState.toUpperCase();
    if (!(US_STATES as readonly string[]).includes(v.addressState)) throw invalid("Choose a state.");
  }
  if (v.addressZip && !/^\d{5}(-\d{4})?$/.test(v.addressZip)) throw invalid("Enter a 5-digit ZIP code.");
  return { ...v, birthDate };
}

/** Your own details (null until you've saved them once). */
export async function myDetails(actor: Actor | null): Promise<PersonalDetails | null> {
  assertSignedIn(actor);
  return db.personalDetails.findUnique({ where: { userId: actor.id } });
}

/**
 * Save your details. Saving a complete set also confirms it for the year
 * (that's what a "Member details" requirement asks), and the requirement
 * task closes. Saving an incomplete set keeps what you typed.
 */
export async function saveMyDetails(actor: Actor | null, input: unknown): Promise<{ complete: boolean; missing: string[] }> {
  assertSignedIn(actor);
  const now = new Date();
  const data = clean(parse(Input, input), actor.kind, now);
  const missing = missingDetails(data, actor.kind);
  const confirmedAt = missing.length ? null : now;
  await db.personalDetails.upsert({ where: { userId: actor.id }, create: { userId: actor.id, ...data, confirmedAt }, update: { ...data, confirmedAt } });
  // Which fields changed is private; the log only says they were updated.
  await logActivity({ actorId: actor.id, action: missing.length ? "details.updated" : "details.confirmed", entityType: "user", entityId: actor.id, isPublic: false });
  await syncUserRequirements(actor.id, { notify: false, now });
  return { complete: !missing.length, missing };
}

/** "Everything's still right": confirm a complete set for this year without changing it. */
export async function confirmMyDetails(actor: Actor | null): Promise<void> {
  assertSignedIn(actor);
  const d = await db.personalDetails.findUnique({ where: { userId: actor.id } });
  const missing = missingDetails(d, actor.kind);
  if (missing.length) throw invalid(`Fill in ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " and the rest" : ""} first.`);
  const now = new Date();
  await db.personalDetails.update({ where: { userId: actor.id }, data: { confirmedAt: now } });
  await logActivity({ actorId: actor.id, action: "details.confirmed", entityType: "user", entityId: actor.id, isPublic: false });
  await syncUserRequirements(actor.id, { notify: false, now });
}

export type MemberContact = { phone: string | null; contactEmail: string | null; yearInSchool: YearInSchool | null; hasEmergency: boolean };

/** Contact basics for a club's roster (roster holders and advisors only; lib/authz/details). */
export async function memberContacts(actor: Actor | null, clubId: string, userIds: string[]): Promise<Map<string, MemberContact>> {
  if (!(await canSeeMemberContacts(actor, clubId))) throw forbidden();
  const members = await db.membership.findMany({ where: { clubId, userId: { in: userIds }, status: { in: ["ACTIVE", "PENDING"] } }, select: { userId: true } });
  const rows = await db.personalDetails.findMany({
    where: { userId: { in: members.map((m) => m.userId) } },
    select: { userId: true, phone: true, contactEmail: true, yearInSchool: true, emergencyName: true, emergencyPhone: true },
  });
  return new Map(rows.map((r) => [r.userId, { phone: r.phone, contactEmail: r.contactEmail, yearInSchool: r.yearInSchool, hasEmergency: Boolean(r.emergencyName && r.emergencyPhone) }]));
}

export type EmergencyContact = { name: string; relationship: PersonalDetails["emergencyRelationship"]; phone: string | null; email: string | null };

/**
 * Open a member's emergency contact. Roster holders and advisors of a club
 * may open it for that club's members; the person and admins anywhere.
 * Every opening is logged (who, whose, which club — never the contact).
 */
export async function revealEmergencyContact(actor: Actor | null, clubId: string | null, userId: string): Promise<EmergencyContact> {
  assertSignedIn(actor);
  if (!seesAllDetails(actor, userId)) {
    if (!clubId || !(await canSeeMemberContacts(actor, clubId)) || !(await isClubMemberOrRequest(userId, clubId))) throw forbidden();
  }
  const d = await db.personalDetails.findUnique({ where: { userId }, select: { emergencyName: true, emergencyRelationship: true, emergencyPhone: true, emergencyEmail: true } });
  if (!d?.emergencyName) throw notFound("Emergency contact");
  if (actor.id !== userId) {
    await logActivity({ actorId: actor.id, action: "details.emergency_viewed", entityType: "user", entityId: userId, clubId, isPublic: false });
  }
  return { name: d.emergencyName, relationship: d.emergencyRelationship, phone: d.emergencyPhone, email: d.emergencyEmail };
}

/** Everything but the emergency contact, for the person or an admin (the admin People page). The contact opens separately (revealEmergencyContact). */
export async function detailsFor(actor: Actor | null, userId: string) {
  assertSignedIn(actor);
  if (!seesAllDetails(actor, userId)) throw forbidden();
  return db.personalDetails.findUnique({
    where: { userId },
    select: {
      studentId: true, birthDate: true, gender: true, phone: true, contactEmail: true, yearInSchool: true,
      addressLine: true, addressCity: true, addressState: true, addressZip: true, confirmedAt: true, updatedAt: true,
      emergencyName: true,
    },
  });
}
