import "server-only";
import type { ClubRole, Position } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { CAPABILITIES, type Capability } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { assertClubCap, conflict, invalid, notFound, parse } from "@/lib/domain/kit";
import { createDefaultPositions } from "@/lib/domain/roles";
import { seatsFor } from "@/lib/roles/defaults";

/**
 * Org chart seats — the structure, not the people. Seats are edited here by
 * anyone holding the `orgchart` capability; who sits in them changes only
 * through lib/domain/roles (assignRole, hand-offs, elections, placements).
 *
 * Rules kept deliberately simple:
 *   - New seats are OFFICER or AMBASSADOR. President and VP seats come with
 *     every club, are "core", and can be renamed but never archived.
 *   - A seat's role never changes after creation (it would rewrite history).
 *   - A seat can't be archived while someone holds it or an election for it
 *     is still running; its history stays either way.
 *   - The holder limit can't drop below the number of people in the seat.
 */

const TIER_ORDER: Record<ClubRole, number> = { PRESIDENT: 0, VP: 1, OFFICER: 2, AMBASSADOR: 3, ADVISOR: 4, MEMBER: 5 };

export function seatSort(a: Pick<Position, "role" | "sortOrder" | "name">, b: Pick<Position, "role" | "sortOrder" | "name">) {
  return TIER_ORDER[a.role] - TIER_ORDER[b.role] || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

function cleanCaps(perms: string[] | undefined): Capability[] {
  return [...new Set((perms ?? []).filter((p): p is Capability => p in CAPABILITIES))];
}

const Responsibilities = z
  .array(z.string().trim().max(200, "Keep each responsibility under 200 characters."))
  .max(20, "Up to 20 responsibilities per seat.")
  .transform((list) => list.filter(Boolean));

const SeatName = z.string().trim().min(2, "Give the seat a name.").max(80, "Seat names can be up to 80 characters.");

const CreateSeat = z.object({
  clubId: z.string().min(1),
  name: SeatName,
  role: z.enum(["OFFICER", "AMBASSADOR"]),
  responsibilities: Responsibilities.default([]),
  defaultPermissions: z.array(z.string()).default([]),
  maxHolders: z.coerce.number().int().min(1, "At least one person must fit in the seat.").max(50, "Up to 50 people per seat."),
});

const UpdateSeat = z.object({
  name: SeatName.optional(),
  responsibilities: Responsibilities.optional(),
  defaultPermissions: z.array(z.string()).optional(),
  maxHolders: z.coerce.number().int().min(1, "At least one person must fit in the seat.").max(50, "Up to 50 people per seat.").optional(),
});

async function assertNameFree(clubId: string, name: string, exceptId?: string) {
  const clash = await db.position.findFirst({
    where: { clubId, archivedAt: null, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw conflict(`There's already a seat called "${name}".`);
}

async function loadSeat(seatId: string) {
  const seat = await db.position.findUnique({ where: { id: seatId } });
  if (!seat) throw notFound("Seat");
  return seat;
}

/** "Start from the default setup": the native seats for this kind of club. Only when the club has none yet. */
export async function startDefaultSeats(actor: Actor | null, clubId: string) {
  await assertClubCap(actor, clubId, "orgchart");
  const club = await db.club.findUnique({ where: { id: clubId }, select: { type: true } });
  if (!club) throw notFound("Club");
  const existing = await db.position.count({ where: { clubId } });
  if (existing > 0) throw conflict("This club already has seats. Use “Restore defaults” to bring back missing ones.");
  await createDefaultPositions(clubId, club.type);
  await logActivity({ actorId: actor!.id, action: "orgchart.defaults_started", entityType: "club", entityId: clubId, clubId });
}

/**
 * "Restore defaults": brings back every default seat that's missing or
 * archived and resets the default seats' responsibilities and permissions to
 * the template. Custom seats and everyone's roles are left alone.
 */
export async function restoreDefaultSeats(actor: Actor | null, clubId: string) {
  await assertClubCap(actor, clubId, "orgchart");
  const club = await db.club.findUnique({ where: { id: clubId }, select: { type: true } });
  if (!club) throw notFound("Club");
  const templates = seatsFor(club.type);
  const seats = await db.position.findMany({ where: { clubId }, include: { _count: { select: { assignments: { where: { endedAt: null } } } } } });
  const used = new Set<string>();
  const restored: string[] = [];

  await db.$transaction(async (tx) => {
    for (const [i, t] of templates.entries()) {
      // Core seats match by role (they may have been renamed); others by name.
      const match =
        seats.find((s) => !used.has(s.id) && t.isCore && s.isCore && s.role === t.role && !s.archivedAt) ??
        seats.find((s) => !used.has(s.id) && s.role === t.role && s.name.trim().toLowerCase() === t.name.toLowerCase());
      if (match) {
        used.add(match.id);
        if (match.archivedAt) restored.push(t.name);
        await tx.position.update({
          where: { id: match.id },
          data: {
            name: t.name,
            responsibilities: t.responsibilities,
            defaultPermissions: t.defaultPermissions,
            maxHolders: Math.max(t.maxHolders, match._count.assignments),
            isCore: Boolean(t.isCore),
            archivedAt: null,
            sortOrder: i,
          },
        });
      } else {
        restored.push(t.name);
        await tx.position.create({
          data: {
            clubId,
            role: t.role,
            name: t.name,
            responsibilities: t.responsibilities,
            defaultPermissions: t.defaultPermissions,
            maxHolders: t.maxHolders,
            isCore: Boolean(t.isCore),
            sortOrder: i,
          },
        });
      }
    }
    // Custom seats keep their order, after the defaults.
    const custom = seats.filter((s) => !used.has(s.id)).sort(seatSort);
    for (const [j, s] of custom.entries()) await tx.position.update({ where: { id: s.id }, data: { sortOrder: templates.length + j } });
    await logActivity({ actorId: actor!.id, action: "orgchart.defaults_restored", entityType: "club", entityId: clubId, clubId, data: { restored } }, tx);
  });
  return { restored };
}

/** Add an officer or ambassador seat. */
export async function createSeat(actor: Actor | null, input: unknown) {
  const v = parse(CreateSeat, input);
  await assertClubCap(actor, v.clubId, "orgchart");
  await assertNameFree(v.clubId, v.name);
  const last = await db.position.findFirst({ where: { clubId: v.clubId, role: v.role }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const anyLast = await db.position.findFirst({ where: { clubId: v.clubId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const seat = await db.position.create({
    data: {
      clubId: v.clubId,
      role: v.role,
      name: v.name,
      responsibilities: v.responsibilities,
      defaultPermissions: cleanCaps(v.defaultPermissions),
      maxHolders: v.maxHolders,
      sortOrder: (last?.sortOrder ?? anyLast?.sortOrder ?? 0) + 1,
    },
  });
  await logActivity({ actorId: actor!.id, action: "orgchart.seat_created", entityType: "position", entityId: seat.id, clubId: v.clubId, data: { name: seat.name, role: seat.role } });
  return seat;
}

/** Rename a seat, edit its responsibilities, default permissions or holder limit. */
export async function updateSeat(actor: Actor | null, seatId: string, input: unknown) {
  const seat = await loadSeat(seatId);
  await assertClubCap(actor, seat.clubId, "orgchart");
  const v = parse(UpdateSeat, input);
  if (seat.archivedAt) throw invalid("Restore this seat before editing it.");
  if (v.name && v.name.toLowerCase() !== seat.name.toLowerCase()) await assertNameFree(seat.clubId, v.name, seat.id);
  if (v.maxHolders !== undefined) {
    const holders = await db.roleAssignment.count({ where: { positionId: seat.id, endedAt: null } });
    if (v.maxHolders < holders) throw invalid(`${holders} people hold this seat now. Keep the limit at ${holders} or more, or end someone's role first.`);
  }
  const updated = await db.position.update({
    where: { id: seat.id },
    data: {
      ...(v.name !== undefined ? { name: v.name } : {}),
      ...(v.responsibilities !== undefined ? { responsibilities: v.responsibilities } : {}),
      // President and VP hold every capability; their seat defaults would be noise.
      ...(v.defaultPermissions !== undefined && seat.role !== "PRESIDENT" && seat.role !== "VP" ? { defaultPermissions: cleanCaps(v.defaultPermissions) } : {}),
      ...(v.maxHolders !== undefined ? { maxHolders: v.maxHolders } : {}),
    },
  });
  await logActivity({
    actorId: actor!.id,
    action: "orgchart.seat_updated",
    entityType: "position",
    entityId: seat.id,
    clubId: seat.clubId,
    data: { name: updated.name, changed: Object.keys(v) },
  });
  return updated;
}

/** Move a seat one place up or down within its tier (Officers, Ambassadors…). */
export async function moveSeat(actor: Actor | null, seatId: string, direction: "up" | "down") {
  const seat = await loadSeat(seatId);
  await assertClubCap(actor, seat.clubId, "orgchart");
  const all = (await db.position.findMany({ where: { clubId: seat.clubId, archivedAt: null } })).sort(seatSort);
  const tier = all.filter((s) => s.role === seat.role);
  const i = tier.findIndex((s) => s.id === seat.id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= tier.length) return;
  [tier[i], tier[j]] = [tier[j], tier[i]];
  // Renumber the whole chart so stale or duplicate sortOrders can't stick.
  // `all` is grouped by tier, so the swapped tier drops back into its slots.
  let k = 0;
  const final = all.map((s) => (s.role === seat.role ? tier[k++] : s));
  await db.$transaction(final.map((s, idx) => db.position.update({ where: { id: s.id }, data: { sortOrder: idx } })));
  await logActivity({ actorId: actor!.id, action: "orgchart.seat_moved", entityType: "position", entityId: seat.id, clubId: seat.clubId, data: { direction } });
}

/** Retire a seat from the chart. Its role history stays visible. */
export async function archiveSeat(actor: Actor | null, seatId: string) {
  const seat = await loadSeat(seatId);
  await assertClubCap(actor, seat.clubId, "orgchart");
  if (seat.isCore) throw invalid(`${seat.name} is a core seat and can't be archived.`);
  if (seat.archivedAt) return seat;
  const holders = await db.roleAssignment.count({ where: { positionId: seat.id, endedAt: null } });
  if (holders > 0) throw conflict(`Someone still holds ${seat.name}. End their role first, then archive the seat.`);
  const running = await db.election.count({ where: { positionId: seat.id, status: { in: ["NOMINATING", "VOTING", "CLOSED"] } } });
  if (running > 0) throw conflict(`There's an election for ${seat.name} that hasn't finished. Cancel or apply it first.`);
  const updated = await db.position.update({ where: { id: seat.id }, data: { archivedAt: new Date() } });
  await logActivity({ actorId: actor!.id, action: "orgchart.seat_archived", entityType: "position", entityId: seat.id, clubId: seat.clubId, data: { name: seat.name } });
  return updated;
}

/** Bring an archived seat back onto the chart. */
export async function restoreSeat(actor: Actor | null, seatId: string) {
  const seat = await loadSeat(seatId);
  await assertClubCap(actor, seat.clubId, "orgchart");
  if (!seat.archivedAt) return seat;
  await assertNameFree(seat.clubId, seat.name, seat.id);
  const updated = await db.position.update({ where: { id: seat.id }, data: { archivedAt: null } });
  await logActivity({ actorId: actor!.id, action: "orgchart.seat_restored", entityType: "position", entityId: seat.id, clubId: seat.clubId, data: { name: seat.name } });
  return updated;
}
