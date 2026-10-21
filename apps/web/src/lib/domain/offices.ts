import "server-only";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { emailKind } from "@/lib/institution";
import { logActivity } from "@/lib/lake/activity";
import { assertCan, conflict, DomainError, invalid, notFound, oneLine, parse } from "@/lib/domain/kit";
import { notify } from "@/lib/domain/notify";
import { ensureUmbrellaOffice } from "@/lib/offices";
import { FUNDING_TASK_SOURCES, officeKeyForClub, REVIEW_DAYS, routeAdminTask, storedOfficeId, UMBRELLA_TASK_SOURCES } from "@/lib/offices/rules";

/**
 * Offices — the one write path for Office, OfficeMember and Club.officeId.
 * WSUSA's admins (admin.offices) edit each office's details and staff, and
 * move a club to another office. A club's office is set when it's created
 * (lib/offices/rules officeKeyForClub) and follows its founders' scope and
 * category until it's approved; after that only WSUSA moves it.
 *
 * The umbrella invariant (lib/offices/rules): nothing stores the umbrella's
 * id. Setting a club's office to WSUSA stores null, and WSUSA's staff are the
 * platform admins, so it has no OfficeMember rows.
 */

const optionalText = (max: number, msg: string) =>
  z
    .string()
    .overwrite(oneLine)
    .trim()
    .max(max, msg)
    .nullish()
    .transform((v) => v || null);

const OfficeInput = z.object({
  officeId: z.string().trim().min(1).max(64),
  name: z.string({ error: "Give the office a name." }).overwrite(oneLine).trim().min(2, "Give the office a name.").max(100, "Keep the name under 100 characters."),
  shortName: z.string({ error: "Give the office a short name." }).overwrite(oneLine).trim().min(2, "Give the office a short name, like “Campus Rec”.").max(30, "Keep the short name under 30 characters."),
  location: optionalText(200, "Keep the location under 200 characters."),
  hours: optionalText(300, "Keep the hours under 300 characters."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address, like campusrec@weber.edu."),
  phone: optionalText(40, "Keep the phone number under 40 characters.").refine((v) => v === null || /^[\d\s().+\-x]+$/i.test(v), "Enter the phone number with digits, like 801-626-6000."),
  reviewDays: z.coerce
    .number({ error: "Enter how many days a review usually takes." })
    .int("Enter a whole number of days.")
    .min(REVIEW_DAYS.min, `A review takes at least ${REVIEW_DAYS.min} day.`)
    .max(REVIEW_DAYS.max, `Keep the review time to ${REVIEW_DAYS.max} days or fewer.`),
  decidesFunding: z.boolean().default(false),
});

export type OfficeInput = z.input<typeof OfficeInput>;

const FIELDS = ["name", "shortName", "location", "hours", "email", "phone", "reviewDays", "decidesFunding"] as const;

/**
 * Edits an office's name, contacts, review time and whether it decides its
 * clubs' funding. WSUSA always decides funding: it's where every other
 * office's funding goes. Switching an office's funding on or off moves its
 * clubs' open funding requests and invoices to it, or back to WSUSA. Saving
 * without changes still records that someone confirmed the details (Admin →
 * Offices asks for that once).
 */
export async function updateOffice(actor: Actor | null, input: unknown) {
  assertCan(actor, "admin.offices");
  const v = parse(OfficeInput, input);
  const office = await db.office.findUnique({ where: { id: v.officeId } });
  if (!office) throw notFound("Office");
  const data = { name: v.name, shortName: v.shortName, location: v.location, hours: v.hours, email: v.email, phone: v.phone, reviewDays: v.reviewDays, decidesFunding: office.umbrella ? true : v.decidesFunding };
  const changed = FIELDS.filter((k) => (office[k] ?? null) !== (data[k] ?? null));
  if (!changed.length) {
    await logActivity({ actorId: actor.id, action: "office.updated", entityType: "office", entityId: office.id, data: { name: office.name, fields: [], confirmed: true } });
    return office;
  }
  const clash = await db.office.findFirst({ where: { id: { not: office.id }, OR: [{ name: { equals: data.name, mode: "insensitive" } }, { shortName: { equals: data.shortName, mode: "insensitive" } }] }, select: { name: true } });
  if (clash) throw conflict(`${clash.name} already uses that name. Give each office its own.`);
  return db.$transaction(async (tx) => {
    const updated = await tx.office.update({ where: { id: office.id }, data });
    if (!office.umbrella && data.decidesFunding !== office.decidesFunding) {
      await tx.task.updateMany({
        where: { assigneeType: "ADMINS", status: "OPEN", sourceType: { in: [...FUNDING_TASK_SOURCES] }, club: { officeId: office.id } },
        data: { officeId: data.decidesFunding ? office.id : null },
      });
    }
    await logActivity({ actorId: actor.id, action: "office.updated", entityType: "office", entityId: office.id, data: { name: updated.name, fields: changed } }, tx);
    return updated;
  });
}

// ─── Staff ───────────────────────────────────────────────────────────────────

const StaffInput = z.object({
  officeId: z.string().trim().min(1).max(64),
  email: z.string({ error: "Enter their Weber State email." }).trim().toLowerCase().email("Enter a valid email address, like jane.doe@weber.edu."),
});

/**
 * Adds a faculty or staff member to an office's staff: they get the admin
 * console for that office's clubs. They must already have signed in once (so
 * the account exists), like a new administrator. WSUSA's staff are the
 * platform's administrators (System → Administrators), so it takes none here.
 */
export async function addOfficeStaff(actor: Actor | null, input: unknown) {
  assertCan(actor, "admin.offices");
  const v = parse(StaffInput, input);
  const office = await db.office.findUnique({ where: { id: v.officeId }, select: { id: true, name: true, shortName: true, umbrella: true } });
  if (!office) throw notFound("Office");
  if (office.umbrella) throw invalid(`${office.name}'s staff are the platform's administrators. A system administrator adds them in System → Administrators.`);
  if (emailKind(v.email) !== "FACULTY_STAFF") throw invalid("Office staff use a faculty or staff (@weber.edu) account.");
  const user = await db.user.findUnique({ where: { email: v.email }, select: { id: true, name: true, kind: true, status: true, platformRole: true } });
  if (!user) throw new DomainError("NOT_FOUND", `Nobody has signed in as ${v.email} yet. They need to sign in to Wildcat Clubs once, then you can add them.`);
  if (user.kind !== "FACULTY_STAFF") throw invalid("Office staff use a faculty or staff account.");
  if (user.status !== "ACTIVE") throw invalid(`${user.name}'s account isn't active.`);
  if (user.platformRole !== "USER") throw conflict(`${user.name} is a WSUSA administrator, so they already oversee every office's clubs.`);
  const existing = await db.officeMember.findUnique({ where: { officeId_userId: { officeId: office.id, userId: user.id } }, select: { userId: true } });
  if (existing) throw conflict(`${user.name} is already on ${office.name}'s staff.`);
  await db.$transaction(async (tx) => {
    await tx.officeMember.create({ data: { officeId: office.id, userId: user.id, addedById: actor.id } });
    await logActivity({ actorId: actor.id, action: "office.staff_added", entityType: "office", entityId: office.id, data: { userId: user.id, name: user.name, office: office.name } }, tx);
  });
  await notify({
    userIds: [user.id],
    kind: "office.staff_added",
    title: `You're now on ${office.name}'s staff in Wildcat Clubs`,
    body: `Admin tools for the clubs ${office.shortName} oversees are in your account menu: their approvals, renewals, analytics and what's waiting on your office.`,
    href: "/admin",
  });
  return { name: user.name };
}

export async function removeOfficeStaff(actor: Actor | null, input: unknown) {
  assertCan(actor, "admin.offices");
  const v = parse(z.object({ officeId: z.string().trim().min(1).max(64), userId: z.string().trim().min(1).max(64) }), input);
  const row = await db.officeMember.findUnique({
    where: { officeId_userId: { officeId: v.officeId, userId: v.userId } },
    select: { office: { select: { id: true, name: true } }, user: { select: { id: true, name: true } } },
  });
  if (!row) throw notFound("That staff member");
  await db.$transaction(async (tx) => {
    await tx.officeMember.delete({ where: { officeId_userId: { officeId: v.officeId, userId: v.userId } } });
    await logActivity({ actorId: actor.id, action: "office.staff_removed", entityType: "office", entityId: row.office.id, data: { userId: row.user.id, name: row.user.name, office: row.office.name } }, tx);
  });
  await notify({ userIds: [row.user.id], kind: "office.staff_removed", title: `You're no longer on ${row.office.name}'s staff in Wildcat Clubs`, href: "/dashboard" });
  return { name: row.user.name };
}

// ─── Which office oversees a club ────────────────────────────────────────────

/**
 * Points a club at an office (null = the umbrella) and moves its open admin
 * tasks with it, by the same rule createTask routes them
 * (lib/offices/rules routeAdminTask): platform-wide work stays with WSUSA,
 * funding goes to the new office only when it decides funding. Returns
 * whether anything changed. Callers check permission.
 */
export async function applyClubOffice(tx: Tx, clubId: string, officeId: string | null): Promise<boolean> {
  const club = await tx.club.findUnique({ where: { id: clubId }, select: { officeId: true } });
  if (!club || club.officeId === officeId) return false;
  const office = officeId ? await tx.office.findUnique({ where: { id: officeId }, select: { id: true, umbrella: true, decidesFunding: true } }) : null;
  const stored = storedOfficeId(office);
  if (club.officeId === stored) return false;
  await tx.club.update({ where: { id: clubId }, data: { officeId: stored } });
  const routed = { officeId: stored, decidesFunding: office?.decidesFunding ?? false };
  const open = { clubId, assigneeType: "ADMINS" as const, status: "OPEN" as const };
  // Everything about the club except platform-wide and funding work…
  await tx.task.updateMany({
    where: { ...open, OR: [{ sourceType: null }, { sourceType: { notIn: [...UMBRELLA_TASK_SOURCES, ...FUNDING_TASK_SOURCES] } }] },
    data: { officeId: routeAdminTask(null, routed) },
  });
  // …and funding, to whichever office decides it now.
  await tx.task.updateMany({ where: { ...open, sourceType: { in: [...FUNDING_TASK_SOURCES] } }, data: { officeId: routeAdminTask(FUNDING_TASK_SOURCES[0], routed) } });
  return true;
}

/** The office (stored id: null for WSUSA) a club's scope and category send it to. Unknown keys fall back to WSUSA. */
export async function routedOfficeId(club: { scope: string; category: string | null }, tx: Tx = db): Promise<string | null> {
  const office = await tx.office.findUnique({ where: { key: officeKeyForClub(club) }, select: { id: true, umbrella: true } });
  return storedOfficeId(office);
}

const SetOffice = z.object({ clubId: z.string().trim().min(1).max(64), officeId: z.string().trim().min(1).max(64) });

/**
 * WSUSA moves a club to another office (Admin → Club approvals → the club):
 * its open admin tasks move too, it's logged, and the club's leaders hear who
 * oversees them now.
 */
export async function setClubOffice(actor: Actor | null, input: unknown) {
  assertCan(actor, "admin.offices");
  const v = parse(SetOffice, input);
  const [club, office] = await Promise.all([
    db.club.findUnique({ where: { id: v.clubId }, select: { id: true, name: true, slug: true, officeId: true, office: { select: { name: true } } } }),
    db.office.findUnique({ where: { id: v.officeId }, select: { id: true, name: true, umbrella: true } }),
  ]);
  if (!club) throw notFound("Club");
  if (!office) throw notFound("Office");
  const from = club.office?.name ?? (await ensureUmbrellaOffice()).name;
  const moved = await db.$transaction(async (tx) => {
    const changed = await applyClubOffice(tx, club.id, office.id);
    if (changed) await logActivity({ actorId: actor.id, action: "club.office_changed", entityType: "club", entityId: club.id, clubId: club.id, data: { from, office: office.name, officeId: storedOfficeId(office) } }, tx);
    return changed;
  });
  if (!moved) return { moved: false, office: office.name };
  // The club's Presidents, Vice Presidents and advisors (clubs.clubLeaderIds' rule; inlined, as clubs.ts imports this file).
  const leaders = await db.roleAssignment.findMany({ where: { clubId: club.id, endedAt: null, role: { in: ["PRESIDENT", "VP", "ADVISOR"] }, user: { status: { not: "DEACTIVATED" } } }, select: { userId: true } });
  await notify({
    userIds: leaders.map((r) => r.userId),
    kind: "club.office_changed",
    title: `${club.name} is now overseen by ${office.name}`,
    body: `${office.name} handles the club's approvals, renewal and anything else it needs from a campus office. Its contacts are on the club page.`,
    href: `/clubs/${club.slug}`,
    exceptUserId: actor.id,
  });
  return { moved: true, office: office.name };
}
