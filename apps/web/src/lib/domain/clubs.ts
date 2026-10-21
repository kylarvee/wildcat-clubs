import "server-only";
import { Prisma, type Club, type ClubDocumentStatus, type ClubStatus, type FileVisibility } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { adminScope, getClubAccess } from "@/lib/authz";
import { canAskToRevive, isFounder } from "@/lib/authz/founding";
import { CLUB_REVIVAL, COFOUNDER_INVITE, FOUNDING_STATUSES, isFounding, REVIVAL_NOTE_MAX, revivalDefaultDescription, revivalHref } from "@/lib/founding/rules";
import { INSTITUTION } from "@/lib/institution";
import { logActivity } from "@/lib/lake/activity";
import { assertCan, assertCanAdminClub, assertClubCap, assertSignedIn, assertUmbrellaAdmin, conflict, forbidden, invalid, notFound } from "@/lib/domain/kit";
import { createDefaultPositions, grantRole } from "@/lib/domain/roles";
import { reopenRequirementTasks } from "@/lib/domain/requirements";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { notify } from "@/lib/domain/notify";
import { applyClubOffice, routedOfficeId } from "@/lib/domain/offices";
import { notifyOffice, officeForClub } from "@/lib/offices";
import { guessMime, MAX_UPLOAD_BYTES, putBytes } from "@/lib/files/storage";
import { sanitizeRichHtml } from "@/lib/rich/sanitize";
import { profileGaps } from "@/lib/clubs/profile-rules";
import { reindexClubSoon } from "@/lib/search/fresh";
import { SOCIAL_PLATFORMS } from "@/components/clubs/labels";

/**
 * Clubs — founding, the profile, WSUSA review, retirement. The create wizard,
 * profile editor, review queue, settings and admin tools all write through
 * here. Advisor invites live in advisors.ts, co-founder invites in
 * cofounders.ts, constitutions in constitution.ts.
 *
 * Lifecycle: DRAFT → SUBMITTED → (CHANGES_REQUESTED → SUBMITTED)* → APPROVED
 * | REJECTED; any → RETIRED; RETIRED → APPROVED (reinstated) or DRAFT if the
 * club was never approved. Every step leaves a ClubDecision row (the trail).
 * While it's being founded, its founders may list it as forming (followers
 * hear when it's approved), and a student may ask the office to bring a
 * retired club back with them as President (a revival request).
 */

// ─── Shared helpers (also used by advisors.ts and constitution.ts) ──────────

/**
 * zod → a single readable message. Every schema here labels its own errors, so
 * people see "Give your club a name" rather than "name: Too small".
 */
export function parseForm<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw invalid(r.error.issues[0]?.message ?? "Please check the form and try again.");
  return r.data;
}

const id = z.string().trim().min(1).max(64);
const optionalId = z
  .string()
  .trim()
  .max(64)
  .nullish()
  .transform((v) => v || null);
const optionalText = (max: number, msg: string) =>
  z
    .string()
    .trim()
    .max(max, msg)
    .nullish()
    .transform((v) => v || null);
export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address, like club@weber.edu.");

/** Everyone holding a club role right now (leaders and advisors). */
export async function clubLeaderIds(clubId: string, roles?: ("PRESIDENT" | "VP" | "OFFICER" | "AMBASSADOR" | "ADVISOR")[]): Promise<string[]> {
  const rows = await db.roleAssignment.findMany({
    where: { clubId, endedAt: null, role: roles ? { in: roles } : { not: "MEMBER" }, user: { status: { not: "DEACTIVATED" } } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

/** Top-level club folder by name, created on first use. */
export async function ensureClubFolder(clubId: string, name: string, visibility: FileVisibility, createdById: string, tx: Tx = db) {
  const existing = await tx.fileItem.findFirst({ where: { clubId, parentId: null, isFolder: true, name, trashedAt: null } });
  if (existing) return existing;
  return tx.fileItem.create({ data: { clubId, name, isFolder: true, visibility, createdById } });
}

/** Stores bytes as a club file (no permission check — callers have already checked). The type comes from the name's extension only. */
export async function storeClubFile(input: { clubId: string; folderId: string; name: string; bytes: Buffer; visibility: FileVisibility; createdById: string }) {
  const storageKey = await putBytes(input.name, input.bytes);
  return db.fileItem.create({
    data: {
      clubId: input.clubId,
      parentId: input.folderId,
      name: input.name.slice(0, 200),
      mimeType: guessMime(input.name),
      sizeBytes: input.bytes.length,
      storageKey,
      visibility: input.visibility,
      createdById: input.createdById,
    },
  });
}

const RESERVED_SLUGS = new Set(["new", "manage", "list", "map", "search", "network", "create", "admin", "api"]);

export function slugify(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "club"
  );
}

async function uniqueSlug(name: string) {
  const base = slugify(name);
  let slug = RESERVED_SLUGS.has(base) ? `${base}-club` : base;
  for (let i = 2; await db.club.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;
  return slug;
}

async function assertNameFree(name: string, exceptClubId?: string) {
  // Abandoned drafts don't hold a name hostage; clubs in review or running do.
  const clash = await db.club.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, status: { in: ["SUBMITTED", "CHANGES_REQUESTED", "APPROVED"] }, ...(exceptClubId ? { id: { not: exceptClubId } } : {}) },
    select: { name: true },
  });
  if (clash) throw conflict(`There's already a club named “${clash.name}”. Choose a different name, or join that club instead.`);
}

// ─── Profile rules (shared by create, edit, the founding checklist and renewals) ─

/** Pure, in lib/clubs/profile-rules, so the renewal checks and the seed use the same rule. */
export { profileGaps };

async function checkReferences(v: { scope: string; collegeId: string | null; departmentId: string | null; focusMajorId: string | null }) {
  if (v.scope === "COLLEGE") {
    if (!v.collegeId) throw invalid("Choose the college this club belongs to.");
    if (!(await db.college.findUnique({ where: { id: v.collegeId }, select: { id: true } }))) throw invalid("That college wasn't found. Choose another.");
  }
  if (v.departmentId && !(await db.department.findUnique({ where: { id: v.departmentId }, select: { id: true } }))) throw invalid("That department wasn't found. Choose another.");
  if (v.focusMajorId && !(await db.major.findUnique({ where: { id: v.focusMajorId }, select: { id: true } }))) throw invalid("That major wasn't found. Choose another.");
}

/** Sponsored needs a department; Affiliate may have one; Registered never does. */
function departmentFields(type: string, departmentId: string | null, requested: string | null) {
  if (type === "REGISTERED") return { departmentId: null, requestedDepartmentName: null };
  if (departmentId) return { departmentId, requestedDepartmentName: null };
  if (requested) return { departmentId: null, requestedDepartmentName: requested };
  if (type === "SPONSORED") throw invalid("Sponsored clubs need a department. Choose yours, or choose “Other” and type its name.");
  return { departmentId: null, requestedDepartmentName: null };
}

// ─── Create (the wizard) ─────────────────────────────────────────────────────

const ClubTypeInput = z.enum(["SPONSORED", "AFFILIATE", "REGISTERED"], { error: "Choose a club type." });
const ScopeInput = z.enum(["COLLEGE", "UNIVERSITY", "INDEPENDENT", "SPORTS"], { error: "Choose where your club sits." });
// Names reach email subjects and Google, so control characters (line breaks) become spaces.
const NameInput = z
  .string({ error: "Give your club a name." })
  .overwrite((s) => s.replace(/[\u0000-\u001f\u007f]+/g, " "))
  .trim()
  .min(3, "Club names need at least 3 characters.")
  .max(100, "Keep the club name under 100 characters.");
const ShortInput = z
  .string({ error: "Add a short description." })
  .trim()
  .min(10, "Write at least a short sentence (10+ characters) for the description.")
  .max(200, "Keep the short description under 200 characters.");

const CreateClubInput = z.object({
  type: ClubTypeInput,
  departmentId: optionalId,
  requestedDepartmentName: optionalText(120, "Keep the department name under 120 characters."),
  name: NameInput,
  shortDescription: ShortInput,
  scope: ScopeInput,
  collegeId: optionalId,
  focusMajorId: optionalId,
  focusOther: optionalText(120, "Keep the discipline under 120 characters."),
  contactEmail: optionalEmail,
  /** "List this club as forming" (the clubs list's Forming section). */
  listedAsForming: z.boolean().default(false),
});

export type CreateClubInput = z.input<typeof CreateClubInput>;

const LOGO_SEED = ["#492365", "#1d4ed8", "#0f766e", "#b45309", "#be123c", "#4d7c0f", "#6d28d9", "#0e7490"];

/**
 * The create wizard. Saves the club as a DRAFT with the default org chart,
 * overseen by the office its scope sends it to (club sports: Campus
 * Recreation; lib/offices/rules officeKeyForClub). A student founder becomes
 * President; a faculty/staff founder becomes the advisor (they can't hold
 * student roles) with an accepted invite on record.
 */
export async function createClub(actor: Actor | null, input: unknown): Promise<{ id: string; slug: string }> {
  assertCan(actor, "club.create");
  const v = parseForm(CreateClubInput, input);
  const dept = departmentFields(v.type, v.departmentId, v.requestedDepartmentName);
  const collegeId = v.scope === "COLLEGE" ? v.collegeId : null;
  await checkReferences({ scope: v.scope, collegeId, departmentId: dept.departmentId, focusMajorId: v.focusMajorId });
  await assertNameFree(v.name);

  const now = new Date();
  const founderIsStudent = actor.kind === "STUDENT";
  // New clubs have no category yet, so the scope decides (the profile editor re-derives it until approval).
  const officeId = await routedOfficeId({ scope: v.scope, category: null });
  let club: Club | null = null;
  for (let attempt = 0; !club; attempt++) {
    const slug = attempt === 0 ? await uniqueSlug(v.name) : `${slugify(v.name)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      club = await db.$transaction(async (tx) => {
        const c = await tx.club.create({
          data: {
            slug,
            name: v.name,
            type: v.type,
            status: "DRAFT",
            scope: v.scope,
            collegeId,
            ...dept,
            focusMajorId: v.focusMajorId,
            focusOther: v.focusMajorId ? null : v.focusOther,
            shortDescription: v.shortDescription,
            contactEmail: v.contactEmail,
            listedAsForming: v.listedAsForming,
            logoColor: LOGO_SEED[Math.floor(Math.random() * LOGO_SEED.length)],
            createdById: actor.id,
            officeId,
          },
        });
        await createDefaultPositions(c.id, v.type, tx);
        if (founderIsStudent) {
          // Created before grantRole so the membership keeps its FOUNDER source.
          await tx.membership.create({ data: { userId: actor.id, clubId: c.id, status: "ACTIVE", source: "FOUNDER", joinedAt: now } });
        } else {
          await tx.advisorInvite.create({
            data: { clubId: c.id, name: actor.name, email: actor.email.toLowerCase(), status: "ACCEPTED", invitedById: actor.id, inviteeId: actor.id, respondedAt: now },
          });
        }
        await logActivity({ actorId: actor.id, action: "club.created", entityType: "club", entityId: c.id, clubId: c.id, data: { name: c.name, type: c.type, listedAsForming: c.listedAsForming } }, tx);
        return c;
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") || attempt >= 2) throw e;
    }
  }

  if (founderIsStudent) {
    const seat = await db.position.findFirst({ where: { clubId: club.id, role: "PRESIDENT", archivedAt: null }, orderBy: { sortOrder: "asc" } });
    await grantRole({ clubId: club.id, userId: actor.id, role: "PRESIDENT", positionId: seat?.id ?? null, assignedById: null });
  } else {
    await grantRole({ clubId: club.id, userId: actor.id, role: "ADVISOR", assignedById: null });
  }
  return { id: club.id, slug: club.slug };
}

// ─── Profile editor ──────────────────────────────────────────────────────────

const HEX = /^#[0-9a-fA-F]{6}$/;
const LOGO_URL = /^\/api\/files\/[A-Za-z0-9_-]{6,64}$/;

const ProfileInput = z.object({
  clubId: id,
  name: NameInput,
  shortDescription: ShortInput,
  descriptionHtml: z.string().max(100_000, "The description is too long.").nullish(),
  type: ClubTypeInput.optional(),
  scope: ScopeInput,
  collegeId: optionalId,
  departmentId: optionalId,
  requestedDepartmentName: optionalText(120, "Keep the department name under 120 characters."),
  focusMajorId: optionalId,
  focusOther: optionalText(120, "Keep the discipline under 120 characters."),
  logoUrl: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
  logoColor: z.string().regex(HEX, "Choose a color from the palette."),
  category: z.enum(["ACADEMIC", "CULTURAL", "FSL", "HONOR_SOCIETY", "SERVICE_ADVOCACY", "STUDENT_LIFE", "RELIGIOUS"]).nullish().transform((v) => v ?? null),
  websiteUrl: z.string().trim().max(300, "Keep the website address under 300 characters.").nullish().transform((v) => v || null),
  socialLinks: z
    .array(z.object({ platform: z.enum(SOCIAL_PLATFORMS), url: z.string().trim().max(300, "Keep links under 300 characters.") }))
    .max(8, "Add up to eight links.")
    .default([]),
});

export type ProfileInput = z.input<typeof ProfileInput>;

/** "instagram.com/wsuswe" → "https://instagram.com/wsuswe". Only web links (http/https) are kept. */
function webUrl(raw: string, what: string): string {
  const s = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw invalid(`Check the ${what} — it should be a web address.`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw invalid(`Check the ${what} — it should be a web address.`);
  return u.toString();
}

export async function updateClubProfile(actor: Actor | null, input: unknown) {
  const v = parseForm(ProfileInput, input);
  const access = await assertClubCap(actor, v.clubId, "profile");
  const club = await db.club.findUnique({ where: { id: v.clubId } });
  if (!club) throw notFound("Club");

  // Type is chosen when founding; it can change until the club is approved (its office's admins any time).
  const founding = club.status === "DRAFT" || club.status === "CHANGES_REQUESTED";
  let type = club.type;
  if (v.type && v.type !== club.type && club.type !== "COLLEGE_AMBASSADORS") {
    if (!founding && !access.viaPlatform) throw forbidden(`A club's type can only change before it's approved. Contact ${(await officeForClub(club.id)).name} to change it.`);
    type = v.type;
  }
  const dept = type === "COLLEGE_AMBASSADORS" ? { departmentId: club.departmentId, requestedDepartmentName: club.requestedDepartmentName } : departmentFields(type, v.departmentId, v.requestedDepartmentName);
  const collegeId = v.scope === "COLLEGE" ? v.collegeId : null;
  await checkReferences({ scope: v.scope, collegeId, departmentId: dept.departmentId, focusMajorId: v.focusMajorId });
  if (v.name.toLowerCase() !== club.name.toLowerCase()) await assertNameFree(v.name, club.id);
  // A new logo must be an image this club uploaded; an unchanged one is left alone.
  if (v.logoUrl && v.logoUrl !== club.logoUrl) {
    if (!LOGO_URL.test(v.logoUrl)) throw invalid("Upload the logo again — that image link isn't valid.");
    const fileId = v.logoUrl.split("/").pop()!;
    const file = await db.fileItem.findUnique({ where: { id: fileId }, select: { clubId: true, mimeType: true } });
    if (!file || file.clubId !== club.id || !file.mimeType?.startsWith("image/")) throw invalid("Upload the logo again — that image isn't one of this club's files.");
  }

  const data = {
    name: v.name,
    shortDescription: v.shortDescription,
    descriptionHtml: sanitizeRichHtml(v.descriptionHtml) || null,
    type,
    scope: v.scope,
    collegeId,
    ...dept,
    focusMajorId: v.focusMajorId,
    focusOther: v.focusMajorId ? null : v.focusOther,
    logoUrl: v.logoUrl,
    logoColor: v.logoColor.toLowerCase(),
    category: v.category,
    websiteUrl: v.websiteUrl ? webUrl(v.websiteUrl, "website") : null,
    socialLinks: v.socialLinks.filter((l) => l.url).map((l) => ({ platform: l.platform, url: webUrl(l.url, `${l.platform} link`) })),
  };
  const same = (k: keyof typeof data) => (k === "socialLinks" ? JSON.stringify(club.socialLinks ?? []) === JSON.stringify(data.socialLinks) : (club[k] ?? null) === (data[k] ?? null));
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => !same(k));
  if (changed.length === 0) return club;

  const updated = await db.club.update({ where: { id: club.id }, data });
  reindexClubSoon(club.id);

  // Until it's approved, a club's office follows its scope and category (lib/offices/rules);
  // its open admin tasks, like a submission waiting for review, move with it.
  const beforeApproval = club.status === "DRAFT" || club.status === "SUBMITTED" || club.status === "CHANGES_REQUESTED";
  if (beforeApproval && (club.scope !== updated.scope || club.category !== updated.category)) {
    const next = await routedOfficeId(updated);
    if (next !== updated.officeId) {
      const office = next ? await db.office.findUnique({ where: { id: next }, select: { name: true } }) : null;
      await db.$transaction(async (tx) => {
        if (await applyClubOffice(tx, club.id, next))
          await logActivity({ actorId: actor!.id, action: "club.office_changed", entityType: "club", entityId: club.id, clubId: club.id, data: { office: office?.name ?? null, officeId: next, auto: true } }, tx);
      });
    }
  }

  // A department request follows what the founder typed: cancel stale ones, file a new one if WSUSA is already involved.
  if (club.requestedDepartmentName !== updated.requestedDepartmentName) {
    await resolveTasks("departmentRequest", club.id, actor!.id, db, "CANCELLED");
    if (updated.requestedDepartmentName && updated.status !== "DRAFT" && updated.status !== "CHANGES_REQUESTED") await openDepartmentRequest(updated, actor!.id);
  }
  await logActivity({ actorId: actor!.id, action: "club.profile_updated", entityType: "club", entityId: club.id, clubId: club.id, data: { fields: changed } });
  return updated;
}

async function openDepartmentRequest(club: Pick<Club, "id" | "name" | "requestedDepartmentName">, createdById: string) {
  const open = await db.task.count({ where: { sourceType: "departmentRequest", sourceId: club.id, status: "OPEN" } });
  if (open) return;
  await createTask({
    kind: "APPROVAL",
    title: `Add “${club.requestedDepartmentName}” to the department list for ${club.name}`,
    description: "A founder chose “Other” for their department. Add it to the list and link the club.",
    // The department list is WSUSA's (the directory), whichever office oversees the club.
    assignee: { type: "ADMINS", umbrella: true },
    clubId: club.id,
    href: `/admin/clubs/${club.id}`,
    source: { type: "departmentRequest", id: club.id },
    createdById,
  });
}

/**
 * The club's Google account. Drive / Calendar / Chat sync runs as it through
 * domain-wide delegation, so leaders only propose it: sync waits until WSUSA
 * verifies it (setClubGoogleAccountVerified). A new address starts unverified
 * and forgets the old account's calendar, Drive folder and Chat space (and the
 * copies in them), so the next sync builds fresh ones in the new account.
 */
export async function setClubContactEmail(actor: Actor | null, input: unknown) {
  const v = parseForm(z.object({ clubId: id, contactEmail: optionalEmail }), input);
  await assertClubCap(actor, v.clubId, "profile");
  const current = await db.club.findUnique({ where: { id: v.clubId } });
  if (!current) throw notFound("Club");
  if (current.contactEmail === v.contactEmail) return current;

  const club = await db.$transaction(async (tx) => {
    const c = await tx.club.update({
      where: { id: current.id },
      data: { contactEmail: v.contactEmail, googleAccountVerifiedAt: null, googleAccountVerifiedById: null, googleCalendarId: null, googleDriveFolderId: null, googleChatSpaceId: null },
    });
    await tx.fileItem.updateMany({ where: { clubId: c.id, driveFileId: { not: null } }, data: { driveFileId: null } });
    await tx.event.updateMany({ where: { clubId: c.id, googleEventId: { not: null } }, data: { googleEventId: null } });
    await tx.conversation.updateMany({ where: { clubId: c.id, googleSpaceId: { not: null } }, data: { googleSpaceId: null } });
    await resolveTasks("googleAccount", c.id, actor!.id, tx, "CANCELLED");
    await logActivity({ actorId: actor!.id, action: "club.contact_email_set", entityType: "club", entityId: c.id, clubId: c.id }, tx);
    return c;
  });
  // Like a department request: WSUSA is asked once they're involved (submission asks for founding clubs).
  if (club.contactEmail && club.status !== "DRAFT" && club.status !== "CHANGES_REQUESTED") await openGoogleAccountCheck(club, actor!.id);
  return club;
}

async function openGoogleAccountCheck(club: Pick<Club, "id" | "name" | "contactEmail">, createdById: string) {
  const open = await db.task.count({ where: { sourceType: "googleAccount", sourceId: club.id, status: "OPEN" } });
  if (open) return;
  await createTask({
    kind: "APPROVAL",
    title: `Verify ${club.name}'s Google account`,
    description: `Confirm ${club.contactEmail} is the club's own Workspace account. Drive, Calendar and Chat sync run as it once you verify it.`,
    // Google accounts are a platform matter: WSUSA verifies every club's.
    assignee: { type: "ADMINS", umbrella: true },
    clubId: club.id,
    href: `/admin/clubs/${club.id}#google-account`,
    source: { type: "googleAccount", id: club.id },
    createdById,
  });
}

const VerifyInput = z.object({ clubId: id, email: z.string().trim().toLowerCase().max(200), verified: z.boolean() });

/**
 * WSUSA confirms (or withdraws) that the club's Google account is the club's
 * own, which is what lets Google sync act as it. `email` is the address the
 * admin checked, so an address changed in the meantime is never verified.
 */
export async function setClubGoogleAccountVerified(actor: Actor | null, input: unknown) {
  assertUmbrellaAdmin(actor, "admin.clubs", "Verifying a club's Google account");
  const v = parseForm(VerifyInput, input);
  const club = await db.club.findUnique({ where: { id: v.clubId }, select: { id: true, name: true, slug: true } });
  if (!club) throw notFound("Club");
  await db.$transaction(async (tx) => {
    const claimed = await tx.club.updateMany({
      where: { id: club.id, contactEmail: v.email },
      data: v.verified ? { googleAccountVerifiedAt: new Date(), googleAccountVerifiedById: actor.id } : { googleAccountVerifiedAt: null, googleAccountVerifiedById: null },
    });
    if (!claimed.count) throw conflict("The club's Google account changed since you opened this page. Reload to check the new address.");
    if (v.verified) await resolveTasks("googleAccount", club.id, actor.id, tx);
    await logActivity({ actorId: actor.id, action: v.verified ? "club.google_account_verified" : "club.google_account_unverified", entityType: "club", entityId: club.id, clubId: club.id }, tx);
  });
  if (v.verified) {
    await notify({
      userIds: await clubLeaderIds(club.id, ["PRESIDENT", "VP", "ADVISOR"]),
      kind: "club.google_account_verified",
      title: `WSUSA verified ${club.name}'s Google account`,
      body: "When Google sync is on, the club's Drive, Calendar and Chat copies run as this account.",
      href: `/clubs/${club.slug}/manage/settings`,
    });
  }
  return { verified: v.verified };
}

/** Co-host requests from other clubs land on this club's calendar without a leader's approval. */
export async function setAutoApproveCohosts(actor: Actor | null, input: unknown) {
  const v = parseForm(z.object({ clubId: id, on: z.boolean() }), input);
  await assertClubCap(actor, v.clubId, "events");
  const club = await db.club.update({ where: { id: v.clubId }, data: { autoApproveCohosts: v.on } });
  await logActivity({ actorId: actor!.id, action: "club.cohost_auto_set", entityType: "club", entityId: club.id, clubId: club.id, data: { on: v.on } });
  return club;
}

/**
 * "List this club as forming": while it's being founded, its founders (lib/authz
 * founding isFounder) put it in the clubs list's Forming section, where
 * signed-in accounts see its name, short description and founders' names and
 * can follow it, or take it off. Approval and rejection turn it off.
 */
export async function setListedAsForming(actor: Actor | null, input: unknown) {
  assertSignedIn(actor);
  const v = parseForm(z.object({ clubId: id, on: z.boolean() }), input);
  const club = await db.club.findUnique({ where: { id: v.clubId }, select: { id: true, status: true, createdById: true, listedAsForming: true } });
  if (!club) throw notFound("Club");
  const access = await getClubAccess(actor, club.id);
  if (!access) throw notFound("Club");
  if (!isFounding(club.status)) throw conflict("Only clubs that are still being founded can be listed as forming.");
  if (!isFounder(access, club, actor.id)) throw forbidden("Only the club's founders can list it as forming.");
  if (club.listedAsForming === v.on) return { on: v.on };
  // Only while it's still being founded, even if it's decided in the meantime.
  const claimed = await db.club.updateMany({ where: { id: club.id, status: { in: [...FOUNDING_STATUSES] } }, data: { listedAsForming: v.on } });
  if (!claimed.count) throw conflict("Only clubs that are still being founded can be listed as forming.");
  await logActivity({ actorId: actor.id, action: "club.forming_set", entityType: "club", entityId: club.id, clubId: club.id, data: { on: v.on } });
  return { on: v.on };
}

// ─── Additional documents on the profile ─────────────────────────────────────

const DOC_EXTENSIONS = /\.(pdf|docx?|pptx?|xlsx?|txt|md|png|jpe?g)$/i;

export const OTHER_DOCS_FOLDER = "Club documents";

/** "Additional documents" on the club profile — no approval needed (unlike constitutions). */
export async function addClubDocument(
  actor: Actor | null,
  input: { clubId: string; title: string; visibility: string; file: { name: string; mimeType?: string | null; bytes: Buffer } },
) {
  const v = parseForm(
    z.object({
      clubId: id,
      title: z.string({ error: "Give the document a title." }).trim().min(2, "Give the document a title.").max(120, "Keep the title under 120 characters."),
      visibility: z.enum(["PUBLIC", "MEMBERS"], { error: "Choose who can see it." }),
    }),
    input,
  );
  await assertClubCap(actor, v.clubId, "profile");
  checkUpload(input.file, DOC_EXTENSIONS, "Upload a PDF, Word, PowerPoint, Excel, text or image file.");
  const folder = await ensureClubFolder(v.clubId, OTHER_DOCS_FOLDER, "INHERIT", actor!.id);
  const file = await storeClubFile({ clubId: v.clubId, folderId: folder.id, name: input.file.name, bytes: input.file.bytes, visibility: v.visibility, createdById: actor!.id });
  const doc = await db.clubDocument.create({
    data: { clubId: v.clubId, kind: "OTHER", title: v.title, source: "CUSTOM_UPLOAD", status: "ACTIVE", fileId: file.id, createdById: actor!.id },
  });
  await logActivity({ actorId: actor!.id, action: "club.document_added", entityType: "clubDocument", entityId: doc.id, clubId: v.clubId, data: { title: v.title }, isPublic: v.visibility === "PUBLIC" });
  reindexClubSoon(v.clubId);
  return doc;
}

/** Takes a document off the profile. The file itself stays in Club files. */
export async function removeClubDocument(actor: Actor | null, docId: string) {
  assertSignedIn(actor);
  const doc = await db.clubDocument.findUnique({ where: { id: String(docId) } });
  if (!doc || doc.kind !== "OTHER" || doc.status !== "ACTIVE") throw notFound("Document");
  await assertClubCap(actor, doc.clubId, "profile");
  await db.clubDocument.update({ where: { id: doc.id }, data: { status: "SUPERSEDED", decidedAt: new Date() } });
  await logActivity({ actorId: actor.id, action: "club.document_removed", entityType: "clubDocument", entityId: doc.id, clubId: doc.clubId, data: { title: doc.title } });
  reindexClubSoon(doc.clubId);
}

export function checkUpload(file: { name: string; bytes: Buffer } | null | undefined, allowed: RegExp, message: string) {
  if (!file || !file.bytes?.length) throw invalid("Choose a file to upload.");
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw invalid("Files can be up to 25 MB.");
  if (!allowed.test(file.name)) throw invalid(message);
}

// ─── Founding checklist & submission ─────────────────────────────────────────

export type DocState = { id: string; status: ClubDocumentStatus; version: number; source: "BUILDER" | "CUSTOM_UPLOAD"; fileId: string | null; createdAt: Date } | null;

export type FoundingChecklist = {
  profile: { done: boolean; gaps: string[] };
  advisor: { done: boolean; advisors: { id: string; name: string; email: string; avatarUrl: string | null; avatarColor: string }[] };
  documents: { done: boolean; constitution: DocState; bylaws: DocState };
  ready: boolean;
  missing: string[];
};

/** Live status of everything WSUSA needs before a club can be submitted. */
export async function foundingChecklist(clubId: string): Promise<FoundingChecklist> {
  const club = await db.club.findUnique({ where: { id: clubId } });
  if (!club) throw notFound("Club");
  const [advisorRoles, docs] = await Promise.all([
    db.roleAssignment.findMany({
      where: { clubId, role: "ADVISOR", endedAt: null },
      select: { user: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } } },
      orderBy: { startedAt: "asc" },
    }),
    db.clubDocument.findMany({
      where: { clubId, kind: { in: ["CONSTITUTION", "BYLAWS"] }, status: { in: ["ACTIVE", "PENDING_APPROVAL"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, status: true, version: true, source: true, fileId: true, createdAt: true },
    }),
  ]);
  // An active document wins over a pending one for the checklist.
  const pick = (kind: "CONSTITUTION" | "BYLAWS"): DocState => {
    const d = docs.find((x) => x.kind === kind && x.status === "ACTIVE") ?? docs.find((x) => x.kind === kind);
    return d ? { id: d.id, status: d.status, version: d.version, source: d.source, fileId: d.fileId, createdAt: d.createdAt } : null;
  };
  const gaps = profileGaps(club);
  const constitution = pick("CONSTITUTION");
  const bylaws = pick("BYLAWS");
  const out: FoundingChecklist = {
    profile: { done: gaps.length === 0, gaps },
    advisor: { done: advisorRoles.length > 0, advisors: advisorRoles.map((r) => r.user) },
    documents: { done: Boolean(constitution && bylaws), constitution, bylaws },
    ready: false,
    missing: [],
  };
  if (!out.profile.done) out.missing.push(`Finish your profile (${gaps.join(", ").toLowerCase()})`);
  if (!out.advisor.done) out.missing.push("Get a faculty or staff advisor to accept your invite");
  if (!constitution) out.missing.push("Adopt a constitution");
  if (!bylaws) out.missing.push("Adopt bylaws");
  out.ready = out.missing.length === 0;
  return out;
}

/**
 * Sends a founding club to its office for review (WSUSA, or the office its
 * scope and category send it to). Allowed from DRAFT or CHANGES_REQUESTED
 * once the checklist is done.
 */
export async function submitForReview(actor: Actor | null, clubId: string) {
  await assertClubCap(actor, String(clubId), "profile");
  const club = await db.club.findUnique({ where: { id: String(clubId) } });
  if (!club) throw notFound("Club");
  const office = await officeForClub(club.id);
  if (club.status !== "DRAFT" && club.status !== "CHANGES_REQUESTED") throw conflict(club.status === "SUBMITTED" ? `This club is already with ${office.name} for review.` : "This club can't be submitted for review.");
  // Drafts don't hold names, so another club may have taken this one since.
  await assertNameFree(club.name, club.id);
  const check = await foundingChecklist(club.id);
  if (!check.ready) throw invalid(`Almost there — before submitting: ${check.missing.join("; ")}.`);

  const resubmission = club.status === "CHANGES_REQUESTED";
  const now = new Date();
  await db.$transaction(async (tx) => {
    // Claim the transition, so a double submit can't file two reviews.
    const claimed = await tx.club.updateMany({ where: { id: club.id, status: club.status }, data: { status: "SUBMITTED", submittedAt: now } });
    if (!claimed.count) throw conflict(`This club is already with ${office.name} for review.`);
    await tx.clubDecision.create({ data: { clubId: club.id, action: "SUBMITTED", byId: actor!.id, note: resubmission ? "Resubmitted with changes" : null } });
    // Routed to the club's office (lib/domain/tasks createTask).
    await createTask(
      {
        kind: "APPROVAL",
        title: `${resubmission ? "Re-review" : "Review"} ${club.name} for recognition`,
        description: `${club.type.charAt(0) + club.type.slice(1).toLowerCase()} club submitted by ${actor!.name}.`,
        assignee: { type: "ADMINS" },
        clubId: club.id,
        href: `/admin/clubs/${club.id}`,
        source: { type: "club", id: club.id },
        createdById: actor!.id,
      },
      tx,
    );
    await logActivity({ actorId: actor!.id, action: resubmission ? "club.resubmitted" : "club.submitted", entityType: "club", entityId: club.id, clubId: club.id, data: { office: office.name } }, tx);
  });
  if (club.requestedDepartmentName && !club.departmentId) await openDepartmentRequest(club, actor!.id);
  if (club.contactEmail && !club.googleAccountVerifiedAt) await openGoogleAccountCheck(club, actor!.id);
  await notifyOffice(
    { clubId: club.id },
    {
      kind: "club.submitted",
      title: `${club.name} ${resubmission ? "was resubmitted" : "was submitted"} for review`,
      body: `${actor!.name} sent ${club.name} to ${office.name} for recognition.${club.requestedDepartmentName && !club.departmentId ? ` They also asked to add the department “${club.requestedDepartmentName}”.` : ""}`,
      href: `/admin/clubs/${club.id}`,
      exceptUserId: actor!.id,
    },
  );
  await notify({
    userIds: (await clubLeaderIds(club.id)).filter((u) => u !== actor!.id),
    kind: "club.submitted",
    title: `${club.name} is with ${office.name} for review`,
    body: `${actor!.name} submitted the club. You'll hear back when ${office.name} decides.`,
    href: `/clubs/${club.slug}/manage`,
  });
  return { slug: club.slug };
}

// ─── WSUSA review (admins) ───────────────────────────────────────────────────

const DecisionInput = z
  .object({
    clubId: id,
    decision: z.enum(["APPROVE", "CHANGES", "REJECT"], { error: "Choose a decision." }),
    note: optionalText(4000, "Keep the note under 4,000 characters."),
  })
  .refine((v) => v.decision === "APPROVE" || Boolean(v.note), "Add a note so the founders know what to do next.");

const DECISION = {
  APPROVE: { status: "APPROVED", action: "APPROVED", verb: "approved" },
  CHANGES: { status: "CHANGES_REQUESTED", action: "CHANGES_REQUESTED", verb: "asked for changes to" },
  REJECT: { status: "REJECTED", action: "REJECTED", verb: "didn't approve" },
} as const;

export async function decideClub(actor: Actor | null, input: unknown) {
  const v = parseForm(DecisionInput, input);
  const club = await db.club.findUnique({ where: { id: v.clubId } });
  assertCanAdminClub(actor, "admin.clubs", club ?? { officeId: null });
  if (!club) throw notFound("Club");
  if (club.status !== "SUBMITTED") throw conflict("This club isn't waiting for review — someone may have decided it already.");
  const d = DECISION[v.decision];
  const office = await officeForClub(club.id);

  if (v.decision === "APPROVE") {
    if (club.requestedDepartmentName && !club.departmentId)
      throw invalid(
        adminScope(actor).all
          ? `Add “${club.requestedDepartmentName}” to the department list (or link an existing department) before approving.`
          : `WSUSA adds departments to the list. “${club.requestedDepartmentName}” is in WSUSA's queue; you can approve the club once it's added.`,
      );
    const docs = await db.clubDocument.findMany({ where: { clubId: club.id, kind: { in: ["CONSTITUTION", "BYLAWS"] }, status: { in: ["ACTIVE", "PENDING_APPROVAL"] } }, select: { kind: true, status: true } });
    const active = new Set(docs.filter((d) => d.status === "ACTIVE").map((d) => d.kind));
    if (!active.has("CONSTITUTION") || !active.has("BYLAWS")) {
      throw invalid(
        docs.some((d) => d.status === "PENDING_APPROVAL")
          ? "Approve or return the club's custom constitution/bylaws first — an approved club needs both in effect."
          : "This club doesn't have both a constitution and bylaws in effect. Request changes so the founders can adopt them.",
      );
    }
    const advisors = await db.roleAssignment.count({ where: { clubId: club.id, role: "ADVISOR", endedAt: null } });
    if (!advisors) throw invalid("This club no longer has an advisor. Request changes so the founders can invite one.");
    await assertNameFree(club.name, club.id);
  }

  const now = new Date();
  // Co-founder invitees whose invitation closes with the decision (they hear about an approval like followers do).
  let closedInvitees: string[] = [];
  await db.$transaction(async (tx) => {
    // Claim the decision, so two admins deciding at once can't both write one. A decided club isn't forming anymore.
    const claimed = await tx.club.updateMany({
      where: { id: club.id, status: "SUBMITTED" },
      data: { status: d.status, ...(v.decision === "APPROVE" && !club.approvedAt ? { approvedAt: now } : {}), ...(v.decision !== "CHANGES" ? { listedAsForming: false } : {}) },
    });
    if (!claimed.count) throw conflict("This club isn't waiting for review — someone may have decided it already.");
    await tx.clubDecision.create({ data: { clubId: club.id, action: d.action, note: v.note, byId: actor.id } });
    await resolveTasks("club", club.id, actor.id, tx);
    if (v.decision === "REJECT") {
      // A rejected club can't take an advisor, so open invitations close with it (inlined: advisors.ts imports this file).
      const pending = await tx.advisorInvite.findMany({ where: { clubId: club.id, status: "PENDING" }, select: { id: true } });
      await tx.advisorInvite.updateMany({ where: { id: { in: pending.map((i) => i.id) }, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: now } });
      for (const i of pending) await resolveTasks("advisorInvite", i.id, actor.id, tx, "CANCELLED");
    }
    if (v.decision !== "CHANGES") {
      // Co-founders join while a club is being founded; once it's decided, students join (or not) from its page (inlined: cofounders.ts imports this file).
      const open = await tx.cofounderInvite.findMany({ where: { clubId: club.id, status: "PENDING" }, select: { id: true, inviteeId: true } });
      await tx.cofounderInvite.updateMany({ where: { id: { in: open.map((i) => i.id) }, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: now } });
      for (const i of open) await resolveTasks(COFOUNDER_INVITE, i.id, actor.id, tx, "CANCELLED");
      closedInvitees = open.flatMap((i) => (i.inviteeId ? [i.inviteeId] : []));
    }
    await logActivity({ actorId: actor.id, action: `club.${d.status.toLowerCase()}`, entityType: "club", entityId: club.id, clubId: club.id, data: { note: v.note }, isPublic: v.decision === "APPROVE" }, tx);
  });
  // Approval puts the club in search; the indexer leaves out (and drops) clubs that aren't approved.
  reindexClubSoon(club.id);
  if (v.decision !== "APPROVE") {
    await resolveTasks("departmentRequest", club.id, actor.id, db, "CANCELLED");
    await resolveTasks("googleAccount", club.id, actor.id, db, "CANCELLED");
  }

  const title =
    v.decision === "APPROVE"
      ? `${club.name} is approved — welcome to Wildcat Clubs!`
      : v.decision === "CHANGES"
        ? `${office.name} asked for changes to ${club.name}`
        : `${office.name} didn't approve ${club.name}`;
  // The founding team: everyone holding a role, and co-founders who don't have a seat yet (they can't open the workspace, so they get the club's page).
  const leaders = await clubLeaderIds(club.id);
  const unseated = (await db.membership.findMany({ where: { clubId: club.id, status: "ACTIVE", userId: { notIn: leaders } }, select: { userId: true } })).map((m) => m.userId);
  await notify({
    userIds: leaders,
    kind: `club.${d.status.toLowerCase()}`,
    title,
    body: v.note ?? "Events, budgets, attendance and the rest of your club tools are now unlocked.",
    href: `/clubs/${club.slug}/manage`,
  });
  if (v.decision !== "CHANGES" && unseated.length) {
    await notify({
      userIds: unseated,
      kind: `club.${d.status.toLowerCase()}`,
      title,
      body: v.note ?? "You're one of its founding members, and its events, members and announcements open up now.",
      href: `/clubs/${club.slug}`,
    });
  }
  if (v.decision === "APPROVE") await tellFollowersApproved(club, [...leaders, ...unseated], closedInvitees);
  return { status: d.status as ClubStatus };
}

/**
 * The approval's news for everyone outside the founding team who wanted it:
 * followers (who followed it while it was forming) and co-founder invitees
 * whose invitation just closed. The team heard already.
 */
async function tellFollowersApproved(club: Pick<Club, "id" | "name" | "slug">, team: string[], invitees: string[]) {
  const followers = await db.calendarSubscription.findMany({ where: { clubId: club.id, user: { status: "ACTIVE" } }, select: { userId: true } });
  const userIds = [...new Set([...followers.map((f) => f.userId), ...invitees])].filter((u) => !team.includes(u));
  if (!userIds.length) return;
  await notify({
    userIds,
    kind: "club.forming_approved",
    title: `${club.name} is now an official ${INSTITUTION.shortName} club`,
    body: "Join it from its club page.",
    href: `/clubs/${club.slug}`,
  });
}

/** Adds the department a founder typed under "Other" (or links an existing one with that name) and links the club. */
export async function addDepartmentForClub(actor: Actor | null, clubId: string, input: { name: string; collegeId?: string | null }) {
  // The department list is the directory's: WSUSA's, whichever office oversees the club.
  assertUmbrellaAdmin(actor, "admin.clubs", "Adding a department");
  const v = parseForm(
    z.object({
      clubId: id,
      name: z.string({ error: "Enter the department name." }).trim().min(2, "Enter the department name.").max(120, "Keep the department name under 120 characters."),
      collegeId: optionalId,
    }),
    { ...(input ?? {}), clubId },
  );
  const club = await db.club.findUnique({ where: { id: v.clubId } });
  if (!club) throw notFound("Club");
  if (v.collegeId && !(await db.college.findUnique({ where: { id: v.collegeId }, select: { id: true } }))) throw invalid("That college wasn't found.");

  const existing = await db.department.findFirst({ where: { name: { equals: v.name, mode: "insensitive" } } });
  const department = existing ?? (await db.department.create({ data: { name: v.name, collegeId: v.collegeId } }));
  await db.$transaction(async (tx) => {
    await tx.club.update({ where: { id: club.id }, data: { departmentId: department.id, requestedDepartmentName: null } });
    await tx.clubDecision.create({ data: { clubId: club.id, action: "DEPARTMENT_ADDED", note: existing ? `Linked to the existing department “${department.name}”.` : `Added “${department.name}” to the department list.`, byId: actor.id } });
    await resolveTasks("departmentRequest", club.id, actor.id, tx);
    await logActivity({ actorId: actor.id, action: existing ? "department.linked" : "department.created", entityType: "department", entityId: department.id, clubId: club.id, data: { name: department.name } }, tx);
  });
  reindexClubSoon(club.id);
  await notify({
    userIds: await clubLeaderIds(club.id, ["PRESIDENT", "VP", "ADVISOR"]),
    kind: "club.department_added",
    title: `${department.name} is now ${club.name}'s department`,
    href: `/clubs/${club.slug}/manage/profile`,
  });
  return department;
}

// ─── Retire & reinstate ──────────────────────────────────────────────────────

/**
 * Retires a club: roles end (CLUB_RETIRED) — for a College Ambassadors org,
 * its placements in other clubs too — members become alumni, future meetings
 * are cancelled, open requests close (funding withdrawn, pending documents
 * superseded, their tasks cancelled). Approved invoices and review moderation
 * stay open for WSUSA. History, files and role history stay. Presidents,
 * advisors and admins (access.canRetire).
 */
export async function retireClub(actor: Actor | null, input: unknown) {
  assertSignedIn(actor);
  const v = parseForm(
    z.object({ clubId: id, reason: z.string({ error: "Tell us why the club is retiring." }).trim().min(5, "Tell us briefly why the club is retiring.").max(2000, "Keep the reason under 2,000 characters.") }),
    input,
  );
  const access = await getClubAccess(actor, v.clubId);
  if (!access) throw notFound("Club");
  if (!access.canRetire) throw forbidden(`Only the President, an advisor or ${(await officeForClub(v.clubId)).name} can retire this club.`);
  const club = await db.club.findUnique({ where: { id: v.clubId } });
  if (!club || club.status === "RETIRED") throw conflict("This club is already retired.");

  const members = await db.membership.findMany({ where: { clubId: club.id, status: "ACTIVE" }, select: { userId: true } });
  // Everyone whose roles retirement ends, including ambassadors this club placed in other clubs.
  const leaders = [
    ...new Set((await db.roleAssignment.findMany({ where: { OR: [{ clubId: club.id }, { viaClubId: club.id }], endedAt: null }, select: { userId: true } })).map((r) => r.userId)),
  ];
  const now = new Date();
  await db.$transaction(async (tx) => {
    // Claim the transition first, so a double retire can't write two decisions.
    const claimed = await tx.club.updateMany({ where: { id: club.id, status: { not: "RETIRED" } }, data: { status: "RETIRED", retiredAt: now, retiredReason: v.reason, listedAsForming: false } });
    if (!claimed.count) throw conflict("This club is already retired.");
    // endedAt = retiredAt marks who retirement moved, so a reinstatement can bring exactly them back.
    await tx.roleAssignment.updateMany({ where: { OR: [{ clubId: club.id }, { viaClubId: club.id }], endedAt: null }, data: { endedAt: now, endReason: "CLUB_RETIRED" } });
    await tx.membership.updateMany({ where: { clubId: club.id, status: "ACTIVE" }, data: { status: "ALUMNI", endedAt: now } });
    await tx.membership.updateMany({ where: { clubId: club.id, status: "PENDING" }, data: { status: "DECLINED", endedAt: now } });
    await tx.eventOccurrence.updateMany({ where: { event: { clubId: club.id }, status: "SCHEDULED", startsAt: { gt: now } }, data: { status: "CANCELLED", note: "Cancelled — the club retired." } });
    await tx.advisorInvite.updateMany({ where: { clubId: club.id, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: now } });
    await tx.cofounderInvite.updateMany({ where: { clubId: club.id, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: now } });
    // Requests WSUSA hasn't decided close with the club, so nothing gets approved for a retired club.
    await tx.fundingRequest.updateMany({ where: { clubId: club.id, status: "SUBMITTED" }, data: { status: "WITHDRAWN", decidedAt: now, decidedById: null, decisionNote: "The club retired." } });
    await tx.clubDocument.updateMany({ where: { clubId: club.id, status: "PENDING_APPROVAL" }, data: { status: "SUPERSEDED", decidedAt: now } });
    // Approved money still has to be paid out, and review moderation isn't the club's to close.
    // Requirement tasks are left for the requirement sync below, which also excuses their officer tests.
    // (sourceType: null is spelled out: SQL's NOT IN never matches the club's own to-dos, which have no source.)
    await tx.task.updateMany({
      where: { clubId: club.id, status: "OPEN", OR: [{ sourceType: null }, { sourceType: { notIn: ["invoice", "reviewFlag", "reviewBombing", "requirement"] } }] },
      data: { status: "CANCELLED", completedAt: now, completedById: actor.id },
    });
    await tx.clubDecision.create({ data: { clubId: club.id, action: "RETIRED", note: v.reason, byId: actor.id } });
    await logActivity({ actorId: actor.id, action: "club.retired", entityType: "club", entityId: club.id, clubId: club.id, data: { reason: v.reason, previousStatus: club.status }, isPublic: true }, tx);
  });
  // Retired clubs leave search (the archive keeps its own simple match).
  reindexClubSoon(club.id);
  // Ended roles: requirements they no longer owe close now (tasks and officer tests), not on the next job tick.
  for (const id of leaders) await reopenRequirementTasks(id);
  await notify({
    userIds: members.map((m) => m.userId),
    kind: "club.retired",
    title: `${club.name} has retired`,
    body: `Thanks for being part of ${club.name}. Its history and your role in it stay on your profile.`,
    href: `/clubs/${club.slug}`,
    exceptUserId: actor.id,
  });
  return { slug: club.slug };
}

/**
 * What reinstating a club gives back: the roles its retirement ended (for an
 * ambassador org, also its placements in clubs that are still running, when
 * the ambassador is still a member there) and the memberships it made alumni,
 * for people whose accounts are still active.
 */
async function reinstatementPlan(club: Pick<Club, "id">, retiredAt: Date) {
  const [ended, memberships] = await Promise.all([
    // The club's own roles, plus (for an ambassador org) its placements in clubs that are still running.
    db.roleAssignment.findMany({
      where: { OR: [{ clubId: club.id }, { viaClubId: club.id, club: { status: "APPROVED" } }], endReason: "CLUB_RETIRED", endedAt: retiredAt, user: { status: "ACTIVE" } },
      orderBy: { startedAt: "asc" },
    }),
    db.membership.findMany({ where: { clubId: club.id, status: "ALUMNI", endedAt: retiredAt, user: { status: "ACTIVE" } }, select: { id: true, userId: true } }),
  ]);
  // A placement only comes back if its ambassador is still a member of that club.
  const placements = ended.filter((r) => r.clubId !== club.id);
  const stillMembers = placements.length
    ? await db.membership.findMany({ where: { status: "ACTIVE", OR: placements.map((r) => ({ userId: r.userId, clubId: r.clubId })) }, select: { userId: true, clubId: true } })
    : [];
  const roles = ended.filter((r) => r.clubId === club.id || stillMembers.some((m) => m.userId === r.userId && m.clubId === r.clubId));
  return { roles, memberships };
}

/**
 * Brings a retired club back (reinstateClub, and an approved revival
 * request): approved clubs return APPROVED, never-approved ones DRAFT.
 * Reinstating gives former leaders their seats back; a revival is a fresh
 * start under the student who asked (`revivedBy`), so it brings the members
 * back but none of the old seats (the new President can re-seat anyone).
 * Returns who was told (members whose membership came back).
 */
async function reinstate(actor: Actor, club: Club, note: string | null, opts: { revivedBy?: string } = {}) {
  if (club.status !== "RETIRED" || !club.retiredAt) throw conflict("Only retired clubs can be reinstated.");
  const status: ClubStatus = club.approvedAt ? "APPROVED" : "DRAFT";
  const plan = await reinstatementPlan(club, club.retiredAt);
  const memberships = plan.memberships;
  const roles = opts.revivedBy ? [] : plan.roles;
  await db.$transaction(async (tx) => {
    const claimed = await tx.club.updateMany({ where: { id: club.id, status: "RETIRED" }, data: { status, retiredAt: null, retiredReason: null } });
    if (!claimed.count) throw conflict("Only retired clubs can be reinstated.");
    await tx.membership.updateMany({ where: { id: { in: memberships.map((m) => m.id) } }, data: { status: "ACTIVE", endedAt: null } });
    await tx.clubDecision.create({ data: { clubId: club.id, action: "REINSTATED", note, byId: actor.id } });
    await logActivity({ actorId: actor.id, action: "club.reinstated", entityType: "club", entityId: club.id, clubId: club.id, data: { status, restoredRoles: roles.length, restoredMembers: memberships.length }, isPublic: true }, tx);
  });
  reindexClubSoon(club.id);
  // Leaders get their seats back as new assignments, so the role history shows the gap.
  for (const r of roles) {
    await grantRole({ clubId: r.clubId, userId: r.userId, role: r.role, positionId: r.positionId, permissions: r.permissions, viaClubId: r.viaClubId, assignedById: actor.id });
  }
  const told = memberships.map((m) => m.userId).filter((u) => !roles.some((r) => r.clubId === club.id && r.userId === u));
  const officeName = (await officeForClub(club.id)).name;
  await notify({
    userIds: told,
    kind: "club.reinstated",
    title: `${club.name} is back`,
    body:
      note ??
      (opts.revivedBy
        ? `${officeName} brought the club back with ${opts.revivedBy} as President, and your membership is active again. You can leave from the club page anytime.`
        : `${officeName} reinstated the club, and your membership is active again.`),
    href: `/clubs/${club.slug}`,
  });
  return { status, told };
}

/** Admins (WSUSA, or the club's office) bring a retired club back: approved clubs return APPROVED, never-approved ones return to DRAFT. */
export async function reinstateClub(actor: Actor | null, input: unknown) {
  const v = parseForm(z.object({ clubId: id, note: optionalText(2000, "Keep the note under 2,000 characters.") }), input);
  const club = await db.club.findUnique({ where: { id: v.clubId } });
  assertCanAdminClub(actor, "admin.clubs", club ?? { officeId: null });
  if (!club) throw notFound("Club");
  const { status, told } = await reinstate(actor, club, v.note);
  // A student's open request to bring it back is answered by this too.
  const request = await openRevivalRequest(club.id);
  if (request) {
    await resolveTasks(CLUB_REVIVAL, club.id, actor.id, db, "CANCELLED");
    if (request.createdById && !told.includes(request.createdById)) {
      const office = await officeForClub(club.id);
      await notify({
        userIds: [request.createdById],
        kind: "club.reinstated",
        title: `${club.name} is back`,
        body: `${office.name} reinstated the club, so your request to bring it back is closed. ${status === "APPROVED" ? "Register on its page to join." : "It's back with its founders as a draft."}`,
        href: `/clubs/${club.slug}`,
      });
    }
  }
  return { status };
}

// ─── Reviving a retired club (a student's request) ───────────────────────────

/** The open request to bring a retired club back, if there is one (one at a time). */
export function openRevivalRequest(clubId: string) {
  return db.task.findFirst({
    where: { sourceType: CLUB_REVIVAL, sourceId: clubId, status: "OPEN" },
    select: { id: true, createdAt: true, description: true, createdById: true, createdBy: { select: { id: true, name: true, email: true, kind: true, status: true } } },
  });
}

const RevivalRequestInput = z.object({ clubId: id, note: optionalText(REVIVAL_NOTE_MAX, `Keep the note under ${REVIVAL_NOTE_MAX.toLocaleString("en-US")} characters.`) });

/**
 * "Ask to revive it": a student asks the club's office to bring a retired
 * club back, with them as its President. One open request per club: an
 * APPROVAL task in the office's queue (sourceType clubRevival, routed by
 * createTask), and the office's staff are told. The office approves
 * (approveClubRevival) or declines with a note (declineClubRevival).
 */
export async function requestClubRevival(actor: Actor | null, input: unknown) {
  assertSignedIn(actor);
  const v = parseForm(RevivalRequestInput, input);
  if (!canAskToRevive(actor)) throw forbidden(actor.kind === "STUDENT" ? "Alumni accounts can't lead clubs." : "Only students can ask to bring a club back, since its new President has to be a student.");
  const club = await db.club.findUnique({ where: { id: v.clubId }, select: { id: true, name: true, status: true, type: true } });
  if (!club) throw notFound("Club");
  if (club.status !== "RETIRED") throw conflict(`${club.name} isn't retired, so there's nothing to bring back.`);
  if (club.type === "COLLEGE_AMBASSADORS") throw invalid("WSUSA restarts college ambassador programs. Contact WSUSA if you'd like this one back.");
  const office = await officeForClub(club.id);
  const note = v.note;
  // One request at a time, checked under a lock on the club so two students asking at once can't both file one.
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Club" WHERE id = ${club.id} FOR UPDATE`;
    const open = await tx.task.findFirst({ where: { sourceType: CLUB_REVIVAL, sourceId: club.id, status: "OPEN" }, select: { createdById: true } });
    if (open) throw conflict(open.createdById === actor.id ? `You already asked to bring ${club.name} back. ${office.name} will let you know.` : `Someone already asked to bring ${club.name} back, and ${office.name} is deciding.`);
    await createTask(
      {
        kind: "APPROVAL",
        title: `${actor.name} asked to bring back ${club.name}`,
        description: note ?? revivalDefaultDescription(actor.name),
        assignee: { type: "ADMINS" },
        clubId: club.id,
        href: revivalHref(club.id),
        source: { type: CLUB_REVIVAL, id: club.id },
        createdById: actor.id,
      },
      tx,
    );
    await logActivity({ actorId: actor.id, action: "club.revival_requested", entityType: "club", entityId: club.id, clubId: club.id, data: { note } }, tx);
  });
  await notifyOffice(
    { clubId: club.id },
    {
      kind: "club.revival_requested",
      title: `${actor.name} asked to bring back ${club.name}`,
      body: note ?? `Bringing it back makes ${actor.name} its President.`,
      href: revivalHref(club.id),
      exceptUserId: actor.id,
    },
  );
  return { office: office.name };
}

const RevivalDecisionInput = z.object({ clubId: id, note: optionalText(2000, "Keep the note under 2,000 characters.") });

/** The open request, for the office deciding it (another office's club is not found). */
async function revivalToDecide(actor: Actor | null, clubId: string) {
  const club = await db.club.findUnique({ where: { id: clubId } });
  assertCanAdminClub(actor, "admin.clubs", club ?? { officeId: null });
  if (!club) throw notFound("Club");
  const request = await openRevivalRequest(club.id);
  if (!request?.createdBy) throw conflict("This request was already decided.");
  return { club, request, requester: request.createdBy };
}

/** Closes the request only while it's open, so two staff deciding at once can't both act on it. */
async function claimRevival(taskId: string, actorId: string, status: "DONE" | "CANCELLED") {
  const claimed = await db.task.updateMany({ where: { id: taskId, status: "OPEN" }, data: { status, completedAt: new Date(), completedById: actorId } });
  if (!claimed.count) throw conflict("This request was already decided.");
}

/**
 * The office approves a revival request: the club is reinstated (the same
 * path as reinstateClub) and the student who asked takes its President seat
 * through the Org Chart's write path (roles.grantRole), told once.
 */
export async function approveClubRevival(actor: Actor | null, input: unknown) {
  const v = parseForm(RevivalDecisionInput, input);
  const { club, request, requester } = await revivalToDecide(actor, v.clubId);
  if (club.status !== "RETIRED" || !club.retiredAt) throw conflict("Only retired clubs can be brought back.");
  if (requester.kind !== "STUDENT" || requester.status !== "ACTIVE") {
    throw invalid(`${requester.name} can't lead a club now: their account isn't an active student account. Decline the request with a note, or reinstate the club below.`);
  }
  const seat = await db.position.findFirst({ where: { clubId: club.id, role: "PRESIDENT", archivedAt: null }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  await claimRevival(request.id, actor!.id, "DONE");
  let status: ClubStatus;
  try {
    // A fresh start: the members come back, the old seats don't, and the student who asked leads it.
    ({ status } = await reinstate(actor!, club, v.note, { revivedBy: requester.name }));
  } catch (e) {
    // Nothing changed, so the request is still waiting.
    await db.task.update({ where: { id: request.id }, data: { status: "OPEN", completedAt: null, completedById: null } });
    throw e;
  }
  await grantRole({ clubId: club.id, userId: requester.id, role: "PRESIDENT", positionId: seat?.id ?? null, assignedById: actor!.id, checkSeat: Boolean(seat), notifyHolder: false });
  await logActivity({ actorId: actor!.id, action: "club.revival_approved", entityType: "club", entityId: club.id, clubId: club.id, data: { userId: requester.id, note: v.note } });
  const office = await officeForClub(club.id);
  await notify({
    userIds: [requester.id],
    kind: "club.revival_approved",
    title: `${office.name} brought ${club.name} back, with you as President`,
    body: v.note ?? (status === "APPROVED" ? "It's an approved club again. Open its workspace to invite members and plan a first event." : "It's back as a draft. Finish its founding checklist and send it in."),
    href: `/clubs/${club.slug}/manage`,
  });
  return { status, president: requester.name };
}

/** The office declines a revival request with a note; the student who asked hears why. */
export async function declineClubRevival(actor: Actor | null, input: unknown) {
  const v = parseForm(
    z.object({ clubId: id, note: z.string({ error: "Add a note so the student knows why." }).trim().min(3, "Add a note so the student knows why.").max(2000, "Keep the note under 2,000 characters.") }),
    input,
  );
  const { club, request, requester } = await revivalToDecide(actor, v.clubId);
  await claimRevival(request.id, actor!.id, "CANCELLED");
  await logActivity({ actorId: actor!.id, action: "club.revival_declined", entityType: "club", entityId: club.id, clubId: club.id, data: { userId: requester.id, note: v.note } });
  const office = await officeForClub(club.id);
  await notify({
    userIds: [requester.id],
    kind: "club.revival_declined",
    title: `${office.name} isn't bringing ${club.name} back right now`,
    body: v.note,
    href: `/clubs/${club.slug}`,
  });
}

// ─── College Ambassadors programs (admin) ────────────────────────────────────

/**
 * Starts a college's ambassador program: one COLLEGE_AMBASSADORS org per
 * college, created already approved (it's a university program, not a student
 * petition). Students then request to join; an admin or advisor names its
 * President in the org chart, and its leaders place Club Representative
 * Ambassadors into the college's clubs.
 */
export async function startAmbassadorProgram(actor: Actor | null, collegeId: string): Promise<{ id: string; slug: string }> {
  assertUmbrellaAdmin(actor, "admin.clubs", "Starting an ambassador program");
  const college = await db.college.findUnique({ where: { id: String(collegeId) } });
  if (!college) throw notFound("College");
  const existing = await db.club.findFirst({ where: { type: "COLLEGE_AMBASSADORS", collegeId: college.id, status: { not: "RETIRED" } }, select: { slug: true } });
  if (existing) throw conflict(`${college.shortName} already has an ambassador program.`);
  const name = `${college.shortName} Ambassadors`;
  const now = new Date();
  const club = await db.$transaction(async (tx) => {
    const c = await tx.club.create({
      data: {
        slug: await uniqueSlug(name),
        name,
        type: "COLLEGE_AMBASSADORS",
        status: "APPROVED",
        scope: "COLLEGE",
        collegeId: college.id,
        shortDescription: `Student ambassadors for the ${college.name}: marketing, inter-club coordination, college-wide events, and a representative in every club.`,
        joinPolicy: "APPROVAL",
        logoColor: LOGO_SEED[Math.floor(Math.random() * LOGO_SEED.length)],
        createdById: actor.id,
        approvedAt: now,
      },
    });
    await createDefaultPositions(c.id, "COLLEGE_AMBASSADORS", tx);
    await tx.clubDecision.create({ data: { clubId: c.id, action: "APPROVED", note: "Ambassador program started by WSUSA.", byId: actor.id } });
    await logActivity({ actorId: actor.id, action: "club.ambassador_program_started", entityType: "club", entityId: c.id, clubId: c.id, data: { college: college.name }, isPublic: true }, tx);
    return c;
  });
  return { id: club.id, slug: club.slug };
}
