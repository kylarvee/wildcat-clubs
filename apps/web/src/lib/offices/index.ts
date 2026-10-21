import "server-only";
import { cache } from "react";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { adminIds } from "@/lib/authz/people";
import { notify, type NotifyInput } from "@/lib/domain/notify";
import { fundingOfficeId, OFFICE_KEYS, UMBRELLA_DEFAULTS } from "@/lib/offices/rules";

/**
 * Offices, read side: which campus office oversees a club, who its staff are,
 * and telling them. The rules (the umbrella invariant, routing, the new-club
 * rule) are pure in lib/offices/rules; the one write path is
 * lib/domain/offices. A null officeId anywhere means the umbrella (WSUSA),
 * whose staff are the platform admins.
 */

export const officeSelect = {
  id: true,
  key: true,
  name: true,
  shortName: true,
  umbrella: true,
  decidesFunding: true,
  location: true,
  hours: true,
  email: true,
  phone: true,
  reviewDays: true,
} satisfies Prisma.OfficeSelect;

export type OfficeInfo = Prisma.OfficeGetPayload<{ select: typeof officeSelect }>;

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The umbrella office, created when it's missing: an older database (from
 * before offices) upgrades without a reseed, taking WSUSA's contacts and
 * review time from its stored `wsusa.office` setting when there is one.
 */
export async function ensureUmbrellaOffice(client: Tx = db): Promise<OfficeInfo> {
  const found = await client.office.findFirst({ where: { umbrella: true }, select: officeSelect, orderBy: { createdAt: "asc" } });
  if (found) return found;
  const stored = (await client.systemConfig.findUnique({ where: { key: "wsusa.office" }, select: { value: true } }))?.value as Record<string, unknown> | null | undefined;
  const days = Number(stored?.reviewDays);
  try {
    return await client.office.create({
      data: {
        key: OFFICE_KEYS.umbrella,
        name: UMBRELLA_DEFAULTS.name,
        shortName: UMBRELLA_DEFAULTS.shortName,
        umbrella: true,
        decidesFunding: true,
        location: stored ? text(stored.location) : UMBRELLA_DEFAULTS.location,
        hours: stored ? text(stored.hours) : UMBRELLA_DEFAULTS.hours,
        email: stored ? text(stored.email) : UMBRELLA_DEFAULTS.email,
        phone: stored ? text(stored.phone) : UMBRELLA_DEFAULTS.phone,
        reviewDays: Number.isInteger(days) && days > 0 ? days : UMBRELLA_DEFAULTS.reviewDays,
      },
      select: officeSelect,
    });
  } catch (e) {
    // Two requests creating it at once: the other one won.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await client.office.findFirst({ where: { umbrella: true }, select: officeSelect });
      if (row) return row;
    }
    throw e;
  }
}

/** The umbrella office (WSUSA), once per request. */
export const umbrellaOffice = cache((): Promise<OfficeInfo> => ensureUmbrellaOffice());

/** Every office, the umbrella first, then by name (once per request). */
export const listOffices = cache(async (): Promise<OfficeInfo[]> => {
  const umbrella = await umbrellaOffice();
  const rest = await db.office.findMany({ where: { umbrella: false }, select: officeSelect, orderBy: { name: "asc" } });
  return [umbrella, ...rest];
});

/** An office by id; null (or an unknown id) is the umbrella. */
export async function officeById(officeId: string | null | undefined): Promise<OfficeInfo> {
  if (officeId) {
    const row = (await listOffices()).find((o) => o.id === officeId);
    if (row) return row;
  }
  return umbrellaOffice();
}

/** The office that oversees a club (the umbrella when the club has none, or doesn't exist). */
export async function officeForClub(clubId: string): Promise<OfficeInfo> {
  const club = await db.club.findUnique({ where: { id: clubId }, select: { officeId: true } });
  return officeById(club?.officeId ?? null);
}

/** The office whose staff decide a club's funding: its own when that office decides funding, else the umbrella. */
export async function fundingOfficeForClub(clubId: string): Promise<OfficeInfo> {
  const office = await officeForClub(clubId);
  return office.umbrella ? office : officeById(fundingOfficeId({ officeId: office.id, decidesFunding: office.decidesFunding }));
}

/**
 * Who works an office's queue: the platform admins for the umbrella (null),
 * else the office's active staff. An office with nobody on staff falls back
 * to the platform admins, so nothing goes unseen.
 */
export async function officeStaffIds(officeId: string | null): Promise<string[]> {
  if (officeId) {
    const rows = await db.officeMember.findMany({ where: { officeId, office: { umbrella: false }, user: { status: "ACTIVE" } }, select: { userId: true } });
    if (rows.length) return rows.map((r) => r.userId);
  }
  return adminIds();
}

/** Offices (besides the umbrella) with no active staff: their work falls back to the platform admins (once per request). */
export const unstaffedOfficeIds = cache(async (): Promise<string[]> => {
  const rows = await db.office.findMany({ where: { umbrella: false, members: { none: { user: { status: "ACTIVE" } } } }, select: { id: true } });
  return rows.map((r) => r.id);
});

/**
 * Tells an office's staff (officeStaffIds) through the one notify path: the
 * office that oversees a club, or an office by id (null = the umbrella).
 */
export async function notifyOffice(target: { clubId: string } | { officeId: string | null }, input: Omit<NotifyInput, "userIds">) {
  const officeId = "clubId" in target ? (await db.club.findUnique({ where: { id: target.clubId }, select: { officeId: true } }))?.officeId ?? null : target.officeId;
  await notify({ ...input, userIds: await officeStaffIds(officeId) });
}
