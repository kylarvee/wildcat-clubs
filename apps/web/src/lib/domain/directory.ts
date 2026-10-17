import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { logActivity } from "@/lib/lake/activity";
import { assertCan, conflict, invalid, notFound, parse } from "@/lib/domain/kit";

/**
 * The university directory: colleges, departments, majors and campus
 * buildings. Admins manage it here (admin.directory); club profiles, the
 * founding wizard, student profiles and the Events Builder pick from it.
 *
 * Nothing in use is ever deleted — a college with departments, a department a
 * club belongs to, a major a student lists, a building an event is held in —
 * so no club, profile or event loses its data. Rename instead.
 */

const name = (what: string, max = 120) =>
  z
    .string({ error: `Enter the ${what} name.` })
    .trim()
    .min(2, `Enter the ${what} name.`)
    .max(max, `Keep the ${what} name under ${max} characters.`);

const optionalId = z
  .string()
  .trim()
  .max(40)
  .optional()
  .nullable()
  .transform((v) => v || null);

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "college"
  );
}

async function assertCollege(id: string | null) {
  if (id && !(await db.college.findUnique({ where: { id }, select: { id: true } }))) throw invalid("That college wasn't found. Pick one from the list.");
}

// ─── Colleges ────────────────────────────────────────────────────────────────

const CollegeInput = z.object({
  name: name("college"),
  shortName: z.string({ error: "Enter a short name." }).trim().min(2, "Enter a short name, like “EAST”.").max(30, "Keep the short name under 30 characters."),
});

export async function createCollege(actor: Actor | null, input: unknown) {
  assertCan(actor, "admin.directory");
  const v = parse(CollegeInput, input);
  if (await db.college.findFirst({ where: { name: { equals: v.name, mode: "insensitive" } }, select: { id: true } })) throw conflict(`There's already a college named “${v.name}”.`);
  // The slug appears in clubs-list links (?college=…), so it's set once and never changes.
  const base = slugify(v.shortName.length >= 3 ? v.shortName : v.name);
  let slug = base;
  for (let i = 2; await db.college.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;
  const college = await db.college.create({ data: { name: v.name, shortName: v.shortName, slug } });
  await logActivity({ actorId: actor.id, action: "college.created", entityType: "college", entityId: college.id, data: { name: college.name } });
  return college;
}

export async function updateCollege(actor: Actor | null, collegeId: string, input: unknown) {
  assertCan(actor, "admin.directory");
  const v = parse(CollegeInput, input);
  const college = await db.college.findUnique({ where: { id: String(collegeId ?? "") } });
  if (!college) throw notFound("That college");
  if (await db.college.findFirst({ where: { name: { equals: v.name, mode: "insensitive" }, id: { not: college.id } }, select: { id: true } })) throw conflict(`There's already a college named “${v.name}”.`);
  const updated = await db.college.update({ where: { id: college.id }, data: { name: v.name, shortName: v.shortName } });
  await logActivity({ actorId: actor.id, action: "college.updated", entityType: "college", entityId: college.id, data: { name: updated.name, previousName: college.name } });
  return updated;
}

export async function deleteCollege(actor: Actor | null, collegeId: string) {
  assertCan(actor, "admin.directory");
  const college = await db.college.findUnique({ where: { id: String(collegeId ?? "") }, include: { _count: { select: { departments: true, majors: true, clubs: true } } } });
  if (!college) throw notFound("That college");
  const uses = inUse([
    [college._count.clubs, "club"],
    [college._count.departments, "department"],
    [college._count.majors, "major"],
  ]);
  if (uses) throw conflict(`${college.name} can't be deleted — it has ${uses}. Move them to another college first, or rename this one.`);
  await db.college.delete({ where: { id: college.id } });
  await logActivity({ actorId: actor.id, action: "college.deleted", entityType: "college", entityId: college.id, data: { name: college.name } });
}

// ─── Departments ─────────────────────────────────────────────────────────────

const DepartmentInput = z.object({ name: name("department"), collegeId: optionalId });

export async function createDepartment(actor: Actor | null, input: unknown) {
  assertCan(actor, "admin.directory");
  const v = parse(DepartmentInput, input);
  await assertCollege(v.collegeId);
  if (await db.department.findFirst({ where: { name: { equals: v.name, mode: "insensitive" } }, select: { id: true } })) throw conflict(`There's already a department named “${v.name}”.`);
  const dept = await db.department.create({ data: { name: v.name, collegeId: v.collegeId } });
  await logActivity({ actorId: actor.id, action: "department.created", entityType: "department", entityId: dept.id, data: { name: dept.name } });
  return dept;
}

export async function updateDepartment(actor: Actor | null, departmentId: string, input: unknown) {
  assertCan(actor, "admin.directory");
  const v = parse(DepartmentInput, input);
  await assertCollege(v.collegeId);
  const dept = await db.department.findUnique({ where: { id: String(departmentId ?? "") } });
  if (!dept) throw notFound("That department");
  if (await db.department.findFirst({ where: { name: { equals: v.name, mode: "insensitive" }, id: { not: dept.id } }, select: { id: true } })) throw conflict(`There's already a department named “${v.name}”.`);
  const updated = await db.department.update({ where: { id: dept.id }, data: { name: v.name, collegeId: v.collegeId } });
  await logActivity({ actorId: actor.id, action: "department.updated", entityType: "department", entityId: dept.id, data: { name: updated.name, previousName: dept.name } });
  return updated;
}

export async function deleteDepartment(actor: Actor | null, departmentId: string) {
  assertCan(actor, "admin.directory");
  const dept = await db.department.findUnique({ where: { id: String(departmentId ?? "") }, include: { _count: { select: { clubs: true, majors: true, faculty: true } } } });
  if (!dept) throw notFound("That department");
  const uses = inUse([
    [dept._count.clubs, "club"],
    [dept._count.majors, "major"],
    [dept._count.faculty, "faculty or staff profile"],
  ]);
  if (uses) throw conflict(`${dept.name} can't be deleted — it's in use by ${uses}. Rename it instead, or move them first.`);
  await db.department.delete({ where: { id: dept.id } });
  await logActivity({ actorId: actor.id, action: "department.deleted", entityType: "department", entityId: dept.id, data: { name: dept.name } });
}

// ─── Majors ──────────────────────────────────────────────────────────────────

const MajorInput = z.object({ name: name("major"), collegeId: optionalId, departmentId: optionalId });

/** A department's college wins when both are given, so a major can't sit in two colleges. */
async function resolveMajorPlacement(v: { collegeId: string | null; departmentId: string | null }) {
  await assertCollege(v.collegeId);
  if (!v.departmentId) return { collegeId: v.collegeId, departmentId: null };
  const dept = await db.department.findUnique({ where: { id: v.departmentId }, select: { id: true, name: true, collegeId: true, college: { select: { name: true } } } });
  if (!dept) throw invalid("That department wasn't found. Pick one from the list.");
  if (v.collegeId && dept.collegeId && v.collegeId !== dept.collegeId) throw invalid(`${dept.name} belongs to ${dept.college?.name ?? "another college"}. Pick that college or leave the college blank.`);
  return { collegeId: dept.collegeId ?? v.collegeId, departmentId: dept.id };
}

export async function createMajor(actor: Actor | null, input: unknown) {
  assertCan(actor, "admin.directory");
  const v = parse(MajorInput, input);
  const placement = await resolveMajorPlacement(v);
  if (await db.major.findFirst({ where: { name: { equals: v.name, mode: "insensitive" } }, select: { id: true } })) throw conflict(`There's already a major named “${v.name}”.`);
  const major = await db.major.create({ data: { name: v.name, ...placement } });
  await logActivity({ actorId: actor.id, action: "major.created", entityType: "major", entityId: major.id, data: { name: major.name } });
  return major;
}

export async function updateMajor(actor: Actor | null, majorId: string, input: unknown) {
  assertCan(actor, "admin.directory");
  const v = parse(MajorInput, input);
  const major = await db.major.findUnique({ where: { id: String(majorId ?? "") } });
  if (!major) throw notFound("That major");
  const placement = await resolveMajorPlacement(v);
  if (await db.major.findFirst({ where: { name: { equals: v.name, mode: "insensitive" }, id: { not: major.id } }, select: { id: true } })) throw conflict(`There's already a major named “${v.name}”.`);
  const updated = await db.major.update({ where: { id: major.id }, data: { name: v.name, ...placement } });
  await logActivity({ actorId: actor.id, action: "major.updated", entityType: "major", entityId: major.id, data: { name: updated.name, previousName: major.name } });
  return updated;
}

export async function deleteMajor(actor: Actor | null, majorId: string) {
  assertCan(actor, "admin.directory");
  const major = await db.major.findUnique({ where: { id: String(majorId ?? "") }, include: { _count: { select: { students: true, clubs: true } } } });
  if (!major) throw notFound("That major");
  const uses = inUse([
    [major._count.clubs, "club"],
    [major._count.students, "student profile"],
  ]);
  if (uses) throw conflict(`${major.name} can't be deleted — it's in use by ${uses}. Rename it instead.`);
  await db.major.delete({ where: { id: major.id } });
  await logActivity({ actorId: actor.id, action: "major.deleted", entityType: "major", entityId: major.id, data: { name: major.name } });
}

// ─── Buildings ───────────────────────────────────────────────────────────────

const coord = (min: number, max: number, label: string) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
      const n = typeof v === "number" ? v : Number(v.trim());
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${label} must be a number between ${min} and ${max}.` });
        return z.NEVER;
      }
      return Math.round(n * 1e6) / 1e6;
    });

const BuildingInput = z
  .object({
    code: z
      .string({ error: "Enter the building code." })
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{0,9}$/, "Building codes are 1–10 letters or digits, like “SU” or “TY”."),
    name: name("building"),
    campus: z.string({ error: "Enter the campus." }).trim().min(2, "Enter the campus, like “Ogden”.").max(60, "Keep the campus under 60 characters."),
    address: z
      .string()
      .trim()
      .max(200, "Keep the address under 200 characters.")
      .optional()
      .nullable()
      .transform((v) => v || null),
    lat: coord(-90, 90, "Latitude"),
    lng: coord(-180, 180, "Longitude"),
  })
  .refine((b) => (b.lat === null) === (b.lng === null), { message: "Enter both latitude and longitude, or leave both blank.", path: ["lat"] });

export async function createBuilding(actor: Actor | null, input: unknown) {
  assertCan(actor, "admin.directory");
  const v = parse(BuildingInput, input);
  if (await db.building.findUnique({ where: { code: v.code }, select: { id: true } })) throw conflict(`Another building already uses the code ${v.code}.`);
  const b = await db.building.create({ data: v });
  await logActivity({ actorId: actor.id, action: "building.created", entityType: "building", entityId: b.id, data: { code: b.code, name: b.name } });
  return b;
}

export async function updateBuilding(actor: Actor | null, buildingId: string, input: unknown) {
  assertCan(actor, "admin.directory");
  const v = parse(BuildingInput, input);
  const b = await db.building.findUnique({ where: { id: String(buildingId ?? "") } });
  if (!b) throw notFound("That building");
  if (await db.building.findFirst({ where: { code: v.code, id: { not: b.id } }, select: { id: true } })) throw conflict(`Another building already uses the code ${v.code}.`);
  const updated = await db.building.update({ where: { id: b.id }, data: v });
  await logActivity({ actorId: actor.id, action: "building.updated", entityType: "building", entityId: b.id, data: { code: updated.code, name: updated.name } });
  return updated;
}

export async function deleteBuilding(actor: Actor | null, buildingId: string) {
  assertCan(actor, "admin.directory");
  const b = await db.building.findUnique({ where: { id: String(buildingId ?? "") }, include: { _count: { select: { events: true } } } });
  if (!b) throw notFound("That building");
  const uses = inUse([[b._count.events, "event"]]);
  if (uses) throw conflict(`${b.name} can't be deleted — it's the location of ${uses}. Edit it instead.`);
  await db.building.delete({ where: { id: b.id } });
  await logActivity({ actorId: actor.id, action: "building.deleted", entityType: "building", entityId: b.id, data: { code: b.code, name: b.name } });
}

/** "3 clubs and 1 major", or null when nothing uses the item. */
function inUse(parts: [number, string][]): string | null {
  const used = parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}${n === 1 ? "" : "s"}`);
  if (!used.length) return null;
  return used.length === 1 ? used[0] : `${used.slice(0, -1).join(", ")} and ${used.at(-1)}`;
}
