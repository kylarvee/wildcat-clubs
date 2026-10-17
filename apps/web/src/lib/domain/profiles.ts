import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { canViewFile } from "@/lib/domain/files";
import { logActivity } from "@/lib/lake/activity";
import { notify } from "@/lib/domain/notify";
import { endAllRolesForUser } from "@/lib/domain/roles";
import { assertCan, assertSignedIn, conflict, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { sanitizeRichHtml } from "@/lib/rich/sanitize";
import { campusDate } from "@/lib/time";
import { positionKey, type YearMonth } from "@/lib/profiles/linkedin";
import { monthIndex } from "@/lib/profiles/format";

/**
 * Student profiles — the one input tool for a person's own profile:
 * name and headline, majors and minors, about, experience, education,
 * projects, preferences, and graduating.
 *
 * Club roles are never entered here. The profile reads them from
 * RoleAssignment (the Org Chart owns them), so the two can't drift. Projects
 * linked to one of your roles are the same rows the club's role history shows.
 *
 * Alumni profiles are retired: fully visible, but read-only.
 */

// ─── Shared rules ────────────────────────────────────────────────────────────

/** Editing your profile needs an active account; alumni profiles are retired. */
function assertCanEditProfile(actor: Actor | null): asserts actor is Actor {
  assertSignedIn(actor);
  if (actor.status === "ALUMNI") throw forbidden("Your profile was retired when you graduated, so it can't be changed. Your history stays as it is.");
}

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be up to ${max.toLocaleString()} characters.`)
    .optional()
    .nullable()
    .transform((s) => (s ? s : null));

/** "2024-09" (a month input) or a Date → the 1st of that month, noon on campus. */
const MonthDate = z.preprocess((v) => {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}$/.test(v)) {
    const [y, m] = v.split("-").map(Number);
    return campusDate(y, m, 1, 12);
  }
  return v;
}, z.coerce.date().nullable());

function ymDate(ym: YearMonth): Date {
  return campusDate(ym.year, ym.month, 1, 12);
}

const thisYear = () => new Date().getUTCFullYear();

/** Accepts "linkedin.com/in/name" too, and stores the full https URL. */
const LinkedInUrl = z
  .string()
  .trim()
  .max(300)
  .optional()
  .nullable()
  .transform((s) => {
    if (!s) return null;
    return /^https?:\/\//i.test(s) ? s : `https://${s}`;
  })
  .refine((s) => {
    if (!s) return true;
    try {
      const u = new URL(s);
      return u.protocol === "https:" && /(^|\.)linkedin\.com$/i.test(u.hostname) && u.pathname.length > 1;
    } catch {
      return false;
    }
  }, "Use your LinkedIn profile link, like https://www.linkedin.com/in/your-name.");

const WebUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((s) => (s ? s : null))
  .refine((u) => !u || /^https?:\/\/[^\s]+\.[^\s]+/i.test(u), "Links need to start with http:// or https://");

// ─── Profile basics ──────────────────────────────────────────────────────────

const ProfileInput = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80, "Names can be up to 80 characters."),
  pronouns: optionalText(30, "Pronouns"),
  headline: optionalText(120, "Your headline"),
  aboutHtml: z.string().max(100_000, "Your About section is too long.").optional().nullable(),
  jobTitle: optionalText(120, "Your title"),
  classYear: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().int("Pick a graduation year.").min(1950, "Pick a graduation year.").max(2100, "Pick a graduation year.").nullable()),
  linkedinUrl: LinkedInUrl,
  avatarUrl: z.string().trim().max(200).optional().nullable().transform((s) => (s ? s : null)),
  majors: z
    .array(z.object({ majorId: z.string().min(1), isMinor: z.boolean() }))
    .max(8, "Add up to 8 majors and minors.")
    .default([]),
});

export type ProfileInput = z.input<typeof ProfileInput>;

/** A profile photo must be an image you uploaded to your own files, shared publicly. */
async function checkAvatar(actor: Actor, url: string | null) {
  if (!url) return null;
  const m = /^\/api\/files\/([A-Za-z0-9_-]+)$/.exec(url);
  if (!m) throw invalid("Upload a photo here rather than linking to one.");
  const file = await db.fileItem.findUnique({ where: { id: m[1] }, select: { ownerId: true, mimeType: true, visibility: true, trashedAt: true, isFolder: true } });
  if (!file || file.ownerId !== actor.id || file.isFolder || file.trashedAt) throw invalid("That photo wasn't found in your files. Try uploading it again.");
  if (!file.mimeType?.startsWith("image/")) throw invalid("Your profile photo needs to be an image (JPG, PNG, GIF or WebP).");
  if (file.visibility !== "PUBLIC") throw invalid("Profile photos are shown everywhere your name is, so upload one marked public.");
  return url;
}

/** Save the basics of your profile. Students set majors, minors and class year; faculty and staff set a title. */
export async function updateProfile(actor: Actor | null, input: unknown) {
  assertCanEditProfile(actor);
  const v = parse(ProfileInput, input);
  const student = actor.kind === "STUDENT";

  const majorIds = v.majors.map((m) => m.majorId);
  if (new Set(majorIds).size !== majorIds.length) throw invalid("Each major or minor can be listed once.");
  if (!student && majorIds.length) throw invalid("Majors and minors are for student accounts.");
  if (majorIds.length) {
    const found = await db.major.count({ where: { id: { in: majorIds } } });
    if (found !== majorIds.length) throw invalid("One of those majors isn't in Weber State's list any more. Pick it again.");
  }
  if (v.classYear && (v.classYear < thisYear() - 70 || v.classYear > thisYear() + 8)) throw invalid("Pick a graduation year close to now.");
  const avatarUrl = await checkAvatar(actor, v.avatarUrl);
  const about = sanitizeRichHtml(v.aboutHtml);

  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: actor.id },
      data: {
        name: v.name,
        pronouns: v.pronouns,
        headline: v.headline,
        aboutHtml: about.trim() ? about : null,
        linkedinUrl: v.linkedinUrl,
        avatarUrl,
        ...(student ? { classYear: v.classYear } : { jobTitle: v.jobTitle }),
      },
      select: { id: true, handle: true, name: true },
    });
    if (student) {
      await tx.userMajor.deleteMany({ where: { userId: actor.id } });
      if (v.majors.length) await tx.userMajor.createMany({ data: v.majors.map((m) => ({ userId: actor.id, majorId: m.majorId, isMinor: m.isMinor })) });
    }
    return u;
  });
  await logActivity({ actorId: actor.id, action: "profile.updated", entityType: "user", entityId: actor.id });
  return user;
}

// ─── Experience ──────────────────────────────────────────────────────────────

const ExperienceInput = z
  .object({
    title: z.string().trim().min(1, "Add a title.").max(200, "Titles can be up to 200 characters."),
    organization: z.string().trim().min(1, "Add the company or organization.").max(200, "Organization names can be up to 200 characters."),
    location: optionalText(200, "Location"),
    startDate: MonthDate.refine((d) => d !== null, "Add a start month."),
    endDate: MonthDate.optional(),
    description: optionalText(2000, "The description"),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "The end month is before the start month." });
    if (v.startDate && monthIndex(v.startDate) > monthIndex(new Date()) + 12) ctx.addIssue({ code: "custom", path: ["startDate"], message: "The start month is too far in the future." });
  });

async function ownExperience(actor: Actor, id: string) {
  const e = await db.experience.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!e || e.userId !== actor.id) throw notFound("Experience");
  return e;
}

export async function addExperience(actor: Actor | null, input: unknown) {
  assertCanEditProfile(actor);
  const v = parse(ExperienceInput, input);
  const e = await db.experience.create({
    data: { userId: actor.id, title: v.title, organization: v.organization, location: v.location, startDate: v.startDate!, endDate: v.endDate ?? null, description: v.description, source: "MANUAL" },
  });
  await logActivity({ actorId: actor.id, action: "profile.experience_added", entityType: "experience", entityId: e.id });
  return e;
}

export async function updateExperience(actor: Actor | null, id: string, input: unknown) {
  assertCanEditProfile(actor);
  await ownExperience(actor, id);
  const v = parse(ExperienceInput, input);
  const e = await db.experience.update({
    where: { id },
    data: { title: v.title, organization: v.organization, location: v.location, startDate: v.startDate!, endDate: v.endDate ?? null, description: v.description },
  });
  await logActivity({ actorId: actor.id, action: "profile.experience_updated", entityType: "experience", entityId: id });
  return e;
}

export async function deleteExperience(actor: Actor | null, id: string) {
  assertCanEditProfile(actor);
  await ownExperience(actor, id);
  await db.experience.delete({ where: { id } });
  await logActivity({ actorId: actor.id, action: "profile.experience_removed", entityType: "experience", entityId: id });
}

const ImportRow = z.object({
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  location: z.string().trim().max(200).optional().default(""),
  startedOn: z.object({ year: z.number().int().min(1950).max(2100), month: z.number().int().min(1).max(12) }),
  finishedOn: z.object({ year: z.number().int().min(1950).max(2100), month: z.number().int().min(1).max(12) }).nullable().optional(),
});
const ImportInput = z.object({ positions: z.array(ImportRow).min(1, "Pick at least one position to import.").max(100, "Import up to 100 positions at a time.") });

/**
 * Import positions from LinkedIn's Positions.csv (parsed and previewed in the
 * browser by lib/profiles/linkedin). Positions you already have — same title,
 * company and start month — are skipped, so importing twice is safe.
 */
export async function importLinkedInPositions(actor: Actor | null, input: unknown) {
  assertCanEditProfile(actor);
  const v = parse(ImportInput, input);
  const existing = await db.experience.findMany({ where: { userId: actor.id }, select: { title: true, organization: true, startDate: true } });
  const seen = new Set(
    existing.map((e) => {
      const i = monthIndex(e.startDate);
      return positionKey({ title: e.title, company: e.organization, startedOn: { year: Math.floor(i / 12), month: (i % 12) + 1 } });
    }),
  );
  const fresh: z.infer<typeof ImportRow>[] = [];
  for (const p of v.positions) {
    const key = positionKey(p);
    if (seen.has(key)) continue;
    if (p.finishedOn && p.finishedOn.year * 12 + p.finishedOn.month < p.startedOn.year * 12 + p.startedOn.month) throw invalid(`“${p.title}” ends before it starts.`);
    seen.add(key);
    fresh.push(p);
  }
  if (fresh.length) {
    await db.experience.createMany({
      data: fresh.map((p) => ({
        userId: actor.id,
        title: p.title,
        organization: p.company,
        location: p.location || null,
        startDate: ymDate(p.startedOn),
        endDate: p.finishedOn ? ymDate(p.finishedOn) : null,
        description: p.description || null,
        source: "LINKEDIN_IMPORT" as const,
      })),
    });
  }
  const result = { imported: fresh.length, duplicates: v.positions.length - fresh.length };
  await logActivity({ actorId: actor.id, action: "profile.linkedin_imported", entityType: "user", entityId: actor.id, data: result });
  return result;
}

// ─── Education ───────────────────────────────────────────────────────────────

const Year = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().int("Years are whole numbers.").min(1950, "Pick a year after 1950.").max(2100, "Pick a year before 2100.").nullable());

const EducationInput = z
  .object({
    school: z.string().trim().min(2, "Add the school.").max(200, "School names can be up to 200 characters."),
    degree: optionalText(120, "The degree"),
    field: optionalText(120, "The field of study"),
    startYear: Year.optional(),
    endYear: Year.optional(),
    description: optionalText(2000, "The description"),
  })
  .superRefine((v, ctx) => {
    if (v.startYear && v.endYear && v.endYear < v.startYear) ctx.addIssue({ code: "custom", path: ["endYear"], message: "The end year is before the start year." });
  });

async function ownEducation(actor: Actor, id: string) {
  const e = await db.education.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!e || e.userId !== actor.id) throw notFound("Education");
  return e;
}

export async function addEducation(actor: Actor | null, input: unknown) {
  assertCanEditProfile(actor);
  const v = parse(EducationInput, input);
  const e = await db.education.create({ data: { userId: actor.id, school: v.school, degree: v.degree, field: v.field, startYear: v.startYear ?? null, endYear: v.endYear ?? null, description: v.description } });
  await logActivity({ actorId: actor.id, action: "profile.education_added", entityType: "education", entityId: e.id });
  return e;
}

export async function updateEducation(actor: Actor | null, id: string, input: unknown) {
  assertCanEditProfile(actor);
  await ownEducation(actor, id);
  const v = parse(EducationInput, input);
  const e = await db.education.update({ where: { id }, data: { school: v.school, degree: v.degree, field: v.field, startYear: v.startYear ?? null, endYear: v.endYear ?? null, description: v.description } });
  await logActivity({ actorId: actor.id, action: "profile.education_updated", entityType: "education", entityId: id });
  return e;
}

export async function deleteEducation(actor: Actor | null, id: string) {
  assertCanEditProfile(actor);
  await ownEducation(actor, id);
  await db.education.delete({ where: { id } });
  await logActivity({ actorId: actor.id, action: "profile.education_removed", entityType: "education", entityId: id });
}

// ─── Projects ────────────────────────────────────────────────────────────────

const ProjectInput = z
  .object({
    title: z.string().trim().min(2, "Give the project a title.").max(120, "Titles can be up to 120 characters."),
    descriptionHtml: z.string().max(100_000, "The description is too long.").optional().nullable(),
    url: WebUrl,
    startDate: MonthDate.optional(),
    endDate: MonthDate.optional(),
    roleAssignmentId: z.string().trim().max(64).optional().nullable().transform((s) => (s ? s : null)),
    fileIds: z.array(z.string().min(1).max(64)).max(20, "Attach up to 20 files.").default([]),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "The end month is before the start month." });
  });

/** The role a project is tied to must be one you held (any time, current or past). */
async function ownRole(actor: Actor, roleAssignmentId: string | null) {
  if (!roleAssignmentId) return null;
  const a = await db.roleAssignment.findUnique({ where: { id: roleAssignmentId }, select: { id: true, userId: true, clubId: true, role: true } });
  if (!a || a.userId !== actor.id || a.role === "MEMBER") throw invalid("Pick one of your own club roles.");
  return a;
}

/** Only files the person can open get attached (same rule as role contributions). */
async function visibleFileIds(actor: Actor, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const files = await db.fileItem.findMany({ where: { id: { in: unique }, isFolder: false, trashedAt: null } });
  const ok: string[] = [];
  for (const f of files) if (await canViewFile(actor, f)) ok.push(f.id);
  return ok;
}

export async function addProject(actor: Actor | null, input: unknown) {
  assertCanEditProfile(actor);
  const v = parse(ProjectInput, input);
  const role = await ownRole(actor, v.roleAssignmentId);
  const fileIds = await visibleFileIds(actor, v.fileIds);
  const description = sanitizeRichHtml(v.descriptionHtml);
  const project = await db.project.create({
    data: {
      userId: actor.id,
      clubId: role?.clubId ?? null,
      roleAssignmentId: role?.id ?? null,
      title: v.title,
      descriptionHtml: description.trim() ? description : null,
      url: v.url,
      startDate: v.startDate ?? null,
      endDate: v.endDate ?? null,
      files: fileIds.length ? { create: fileIds.map((fileId) => ({ fileId })) } : undefined,
    },
  });
  // Same public entry the club's role history writes, so profiles and club feeds agree.
  await logActivity({
    actorId: actor.id,
    action: "project.added",
    entityType: "project",
    entityId: project.id,
    clubId: role?.clubId ?? null,
    data: { title: project.title, userId: actor.id, ...(role ? { roleAssignmentId: role.id } : {}) },
    isPublic: true,
  });
  return { project, skippedFiles: new Set(v.fileIds).size - fileIds.length };
}

export async function updateProject(actor: Actor | null, id: string, input: unknown) {
  assertCanEditProfile(actor);
  const existing = await db.project.findUnique({ where: { id }, select: { id: true, userId: true, files: { select: { fileId: true } } } });
  if (!existing || existing.userId !== actor.id) throw notFound("Project");
  const v = parse(ProjectInput, input);
  const role = await ownRole(actor, v.roleAssignmentId);
  // Files already attached stay attached; new ones must be files you can open.
  const kept = new Set(existing.files.map((f) => f.fileId));
  const wanted = [...new Set(v.fileIds)];
  const added = await visibleFileIds(actor, wanted.filter((f) => !kept.has(f)));
  const finalIds = [...wanted.filter((f) => kept.has(f)), ...added];
  const description = sanitizeRichHtml(v.descriptionHtml);
  const project = await db.$transaction(async (tx) => {
    await tx.projectFile.deleteMany({ where: { projectId: id, fileId: { notIn: finalIds } } });
    if (added.length) await tx.projectFile.createMany({ data: added.map((fileId) => ({ projectId: id, fileId })), skipDuplicates: true });
    return tx.project.update({
      where: { id },
      data: {
        clubId: role?.clubId ?? null,
        roleAssignmentId: role?.id ?? null,
        title: v.title,
        descriptionHtml: description.trim() ? description : null,
        url: v.url,
        startDate: v.startDate ?? null,
        endDate: v.endDate ?? null,
      },
    });
  });
  await logActivity({ actorId: actor.id, action: "project.updated", entityType: "project", entityId: id, clubId: project.clubId, data: { title: project.title } });
  return { project, skippedFiles: wanted.length - finalIds.length };
}

export async function deleteProject(actor: Actor | null, id: string) {
  assertCanEditProfile(actor);
  const p = await db.project.findUnique({ where: { id }, select: { id: true, userId: true, title: true, clubId: true } });
  if (!p || p.userId !== actor.id) throw notFound("Project");
  await db.project.delete({ where: { id } });
  await logActivity({ actorId: actor.id, action: "project.removed", entityType: "project", entityId: id, clubId: p.clubId, data: { title: p.title } });
}

// ─── Preferences ─────────────────────────────────────────────────────────────

const NotificationSettings = z.object({ emailNotifications: z.boolean() });

/** Email on or off. In-app notifications always arrive; push follows the mobile app's own permission. */
export async function updateNotificationSettings(actor: Actor | null, input: unknown) {
  assertSignedIn(actor);
  const v = parse(NotificationSettings, input);
  await db.user.update({ where: { id: actor.id }, data: { emailNotifications: v.emailNotifications } });
  await logActivity({ actorId: actor.id, action: "user.settings_updated", entityType: "user", entityId: actor.id, data: v });
  return v;
}

/** "Not now" on the get-the-app prompt — permanent for this person. */
export async function dismissAppPrompt(actor: Actor | null) {
  assertSignedIn(actor);
  await db.user.update({ where: { id: actor.id }, data: { appPromptDismissedAt: new Date() } });
  await logActivity({ actorId: actor.id, action: "user.app_prompt_dismissed", entityType: "user", entityId: actor.id });
}

// ─── Graduating ──────────────────────────────────────────────────────────────

/** "2026-05-08" (a date input) or a Date → noon on campus that day; never in the future. */
const GraduationDate = z.preprocess(
  (v) => {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split("-").map(Number);
      return campusDate(y, m, d, 12);
    }
    return v;
  },
  z.coerce
    .date({ error: "Pick the date you graduated." })
    .refine((d) => d.getUTCFullYear() >= 1950, "Pick the date you graduated.")
    .refine((d) => d.getTime() <= Date.now() + 86_400_000, "Pick a date that isn't in the future — come back once you've graduated."),
);

async function graduate(userId: string, graduatedAt: Date, byId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, handle: true, kind: true, status: true } });
  if (!user) throw notFound("Person");
  if (user.kind !== "STUDENT") throw invalid("Only student accounts graduate. Faculty and staff accounts stay as they are.");
  if (user.status === "ALUMNI") throw conflict(`${user.name} is already marked as graduated.`);
  if (user.status !== "ACTIVE") throw invalid("This account isn't active.");

  // Roles end (GRADUATED) and memberships become alumni first — the org chart
  // tells each club the seat is open — then the account is retired.
  const ended = await endAllRolesForUser(user.id, "GRADUATED", byId);
  const [, tasks] = await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { status: "ALUMNI", graduatedAt } }),
    // Officer requirements and club to-dos belong to roles and memberships that just ended.
    db.task.updateMany({
      where: { assigneeType: "USER", assigneeId: user.id, status: "OPEN", kind: { in: ["REQUIREMENT", "CLUB"] } },
      data: { status: "CANCELLED", completedAt: new Date(), completedById: byId },
    }),
  ]);
  await logActivity({
    actorId: byId,
    action: "user.graduated",
    entityType: "user",
    entityId: user.id,
    data: { userId: user.id, graduatedAt: graduatedAt.toISOString(), endedRoles: ended.endedAssignments, alumniMemberships: ended.alumniMemberships, cancelledTasks: tasks.count },
    isPublic: true,
  });
  return { user, ...ended, cancelledTasks: tasks.count };
}

/**
 * "I've graduated." Ends every club role you hold (marked Graduated in each
 * club's role history), makes your memberships alumni and retires your
 * profile. Everything you did stays on your profile and in the clubs.
 */
export async function markGraduated(actor: Actor | null, input: unknown) {
  assertSignedIn(actor);
  const v = parse(z.object({ graduatedAt: GraduationDate }), input);
  const r = await graduate(actor.id, v.graduatedAt, actor.id);
  return { endedAssignments: r.endedAssignments, alumniMemberships: r.alumniMemberships };
}

/** Admin People tool: mark a student as graduated (e.g. from the registrar's list). */
export async function markUserGraduated(admin: Actor | null, userId: string, date: Date | string) {
  assertCan(admin, "admin.users");
  const graduatedAt = parse(GraduationDate, date);
  const r = await graduate(userId, graduatedAt, admin.id);
  await notify({
    userIds: [r.user.id],
    kind: "profile.alumni",
    title: "Congratulations, graduate!",
    body: "WSUSA marked your account as graduated. Your club roles have ended and your profile is now an alumni profile — your history in every club stays.",
    href: `/u/${r.user.handle}`,
  });
  return { endedAssignments: r.endedAssignments, alumniMemberships: r.alumniMemberships };
}
