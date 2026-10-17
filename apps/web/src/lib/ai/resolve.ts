import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess, isAdmin } from "@/lib/authz";
import { slugify } from "@/lib/domain/clubs";

/**
 * Turning the names people type ("robotics", "Tracy Hall", "Jordan") into
 * records, for the assistant's tools. Every lookup either finds exactly one
 * thing or throws a ToolError whose message tells the model what to ask.
 *
 * Read-only. Visibility follows lib/authz: clubs still being founded are only
 * found by their own leaders and admins, like everywhere else.
 */

/** A problem the model should see and explain (or fix by asking a question). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

const clean = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, 160);

function listNames(names: string[]) {
  return names.map((n) => `“${n}”`).join(", ");
}

export const clubLookupSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  type: true,
  joinPolicy: true,
  departmentId: true,
} satisfies Prisma.ClubSelect;

export type ResolvedClub = Prisma.ClubGetPayload<{ select: typeof clubLookupSelect }>;

/** Approved and retired clubs are public; founding or rejected clubs only for their own people and admins. */
async function canFind(actor: Actor, club: ResolvedClub): Promise<boolean> {
  if (club.status === "APPROVED" || club.status === "RETIRED") return true;
  if (isAdmin(actor)) return true;
  const access = await getClubAccess(actor, club.id);
  return Boolean(access && (access.isLeader || access.isMember));
}

/**
 * Finds one club by slug, id or name (exact, then partial). `approvedOnly`
 * narrows to clubs that are running (for joining, subscribing, events).
 */
export async function resolveClub(actor: Actor, ref: string, opts: { approvedOnly?: boolean } = {}): Promise<ResolvedClub> {
  const q = clean(ref);
  if (!q) throw new ToolError("Say which club you mean.");
  const visible = async (rows: ResolvedClub[]) => {
    const out: ResolvedClub[] = [];
    for (const c of rows) if ((!opts.approvedOnly || c.status === "APPROVED") && (await canFind(actor, c))) out.push(c);
    return out;
  };

  const direct = await db.club.findFirst({ where: { OR: [{ slug: q.toLowerCase() }, { slug: slugify(q) }, { id: q }] }, select: clubLookupSelect });
  if (direct && (await visible([direct])).length) return direct;

  const exact = await visible(await db.club.findMany({ where: { name: { equals: q, mode: "insensitive" } }, select: clubLookupSelect, take: 5 }));
  // Prefer the running club when a draft shares its name.
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact.find((c) => c.status === "APPROVED") ?? exact[0];

  const partial = await visible(
    await db.club.findMany({
      where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: slugify(q) } }] },
      select: clubLookupSelect,
      orderBy: { name: "asc" },
      take: 8,
    }),
  );
  const running = partial.filter((c) => c.status === "APPROVED");
  const pool = running.length ? running : partial;
  if (pool.length === 1) return pool[0];
  if (pool.length > 1) throw new ToolError(`“${q}” matches several clubs: ${listNames(pool.map((c) => c.name))}. Ask which one they mean.`);
  if (direct || exact.length) throw new ToolError(opts.approvedOnly ? `“${q}” isn't an approved club right now.` : `No club named “${q}” is visible to this person.`);
  throw new ToolError(`No club matches “${q}”. Try search_clubs with a broader keyword.`);
}

export async function resolveCollege(ref: string) {
  const q = clean(ref);
  const rows = await db.college.findMany({
    where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { shortName: { equals: q, mode: "insensitive" } }, { slug: q.toLowerCase() }] },
    select: { id: true, name: true, shortName: true, slug: true },
    take: 6,
  });
  const exact = rows.filter((c) => c.name.toLowerCase() === q.toLowerCase() || c.shortName.toLowerCase() === q.toLowerCase() || c.slug === q.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) throw new ToolError(`“${q}” matches several colleges: ${listNames(rows.map((c) => c.name))}.`);
  throw new ToolError(`No college matches “${q}”. Use directory_lookup with kind "college" to see the list.`);
}

/** Departments: returns null (not an error) when nothing matches, so founders can request a new one. */
export async function findDepartment(ref: string) {
  const q = clean(ref);
  const rows = await db.department.findMany({ where: { name: { contains: q, mode: "insensitive" } }, select: { id: true, name: true }, take: 6 });
  const exact = rows.find((d) => d.name.toLowerCase() === q.toLowerCase());
  if (exact) return exact;
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) throw new ToolError(`“${q}” matches several departments: ${listNames(rows.map((d) => d.name))}. Ask which one.`);
  return null;
}

/** Majors: null when nothing matches (the focus is then kept as typed). */
export async function findMajor(ref: string) {
  const q = clean(ref);
  const rows = await db.major.findMany({ where: { name: { contains: q, mode: "insensitive" } }, select: { id: true, name: true }, take: 6 });
  const exact = rows.find((m) => m.name.toLowerCase() === q.toLowerCase());
  if (exact) return exact;
  return rows.length === 1 ? rows[0] : null;
}

export async function resolveBuilding(ref: string) {
  const q = clean(ref);
  const rows = await db.building.findMany({
    where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { equals: q, mode: "insensitive" } }] },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
    take: 8,
  });
  const exact = rows.filter((b) => b.name.toLowerCase() === q.toLowerCase() || b.code.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) throw new ToolError(`“${q}” matches several campus buildings: ${listNames(rows.map((b) => b.name))}. Ask which one.`);
  throw new ToolError(`No campus building matches “${q}”. Use directory_lookup with kind "building", or set the location to an address.`);
}

/** An active member of the club, by name, handle or email. */
export async function resolveMember(clubId: string, ref: string) {
  const q = clean(ref).replace(/^@/, "");
  const rows = await db.membership.findMany({
    where: {
      clubId,
      status: "ACTIVE",
      user: { OR: [{ name: { contains: q, mode: "insensitive" } }, { handle: { equals: q.toLowerCase() } }, { email: { equals: q.toLowerCase() } }] },
    },
    select: { user: { select: { id: true, name: true, handle: true, kind: true, status: true } } },
    take: 8,
  });
  const people = rows.map((r) => r.user);
  const exact = people.filter((p) => p.name.toLowerCase() === q.toLowerCase() || p.handle === q.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (people.length === 1) return people[0];
  if (people.length > 1) throw new ToolError(`Several members match “${q}”: ${listNames(people.map((p) => p.name))}. Ask which one.`);
  throw new ToolError(`No active member of this club matches “${q}”. They need to register for the club before they can take a role.`);
}

const ROLE_WORDS: Record<string, "PRESIDENT" | "VP"> = {
  president: "PRESIDENT",
  "co-president": "PRESIDENT",
  vp: "VP",
  "vice president": "VP",
  "vice-president": "VP",
};

/** A live (not archived) seat on the club's org chart. */
export async function resolveSeat(clubId: string, ref: string) {
  const q = clean(ref);
  const seats = await db.position.findMany({ where: { clubId, archivedAt: null }, orderBy: { sortOrder: "asc" } });
  const lower = q.toLowerCase();
  const exact = seats.filter((s) => s.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const role = ROLE_WORDS[lower];
  if (role) {
    const byRole = seats.filter((s) => s.role === role);
    if (byRole.length >= 1) return byRole[0];
  }
  const partial = seats.filter((s) => s.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new ToolError(`“${q}” matches several seats: ${listNames(partial.map((s) => s.name))}. Ask which one.`);
  throw new ToolError(`This club has no seat called “${q}”. Its seats are: ${listNames(seats.map((s) => s.name))}. Use org_chart to see them.`);
}
