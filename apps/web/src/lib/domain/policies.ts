import "server-only";
import { createHash } from "node:crypto";
import type { Policy, PolicyPlacement, PolicyStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { assertCan, invalid, notFound, parse } from "@/lib/domain/kit";
import { richToText, sanitizeRichHtml } from "@/lib/rich/sanitize";
import { campusDate, inCampusTime } from "@/lib/time";
import { isPolicyDocument, policySlug, SLUG_PATTERN } from "@/components/policies/placements";

/**
 * Policies — the one write path for university policy text. Admins write a
 * policy in the editor or upload a document; it shows in the policy library
 * and wherever its placements say (<PolicyNotices placement=…/>).
 *
 * Versions: publishing changed wording, title, summary or document of a policy
 * that was published before makes it the next version. Re-publishing the same
 * text (e.g. after archiving) keeps the number. The fingerprint of what was
 * last published is kept on the activity row ("publishedHash"), so the number
 * can't drift from what readers actually saw.
 *
 * Addresses: a policy's slug is its public link (the footer links to two of
 * them), so it can change only until the policy is first published.
 */

const PLACEMENT_VALUES = ["GENERAL", "CLUB_CREATION", "MEMBERSHIP", "OFFICER_ROLES", "EVENTS", "FUNDING", "FILES", "MESSAGING", "REVIEWS", "COMPLAINTS"] as const;

const PolicyInput = z.object({
  title: z.string().trim().min(3, "Give the policy a title (at least 3 characters).").max(120, "Titles can be up to 120 characters."),
  slug: z.string().trim().toLowerCase().max(80, "Keep the web address under 80 characters.").optional().default(""),
  summary: z
    .string()
    .trim()
    .min(10, "Write a one- or two-sentence summary (at least 10 characters). It shows everywhere the policy appears.")
    .max(400, "Keep the summary under 400 characters — the full text is one click away."),
  mode: z.enum(["write", "upload"]),
  bodyHtml: z.string().max(400_000, "That policy is too long to save. Split it, or upload it as a document.").nullish(),
  documentFileId: z.string().nullish(),
  placements: z.array(z.enum(PLACEMENT_VALUES)).max(PLACEMENT_VALUES.length),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  /** Campus date "YYYY-MM-DD", or empty. */
  effectiveOn: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Enter the effective date as a date.")
    .optional()
    .default(""),
});

export type PolicyInput = z.input<typeof PolicyInput>;

function contentHash(p: { title: string; summary: string; bodyHtml: string | null; documentFileId: string | null }): string {
  return createHash("sha256")
    .update(JSON.stringify([p.title, p.summary, p.bodyHtml ?? "", p.documentFileId ?? ""]))
    .digest("hex")
    .slice(0, 32);
}

/** Fingerprint of the content readers last saw published, or null if it was never published. */
async function lastPublishedHash(prev: Policy): Promise<string | null> {
  const rows = await db.activityLog.findMany({
    where: { entityType: "policy", entityId: prev.id, action: { in: ["policy.published", "policy.updated", "policy.archived"] } },
    orderBy: { id: "desc" },
    take: 10,
    select: { data: true },
  });
  for (const r of rows) {
    const h = (r.data as { publishedHash?: unknown } | null)?.publishedHash;
    if (typeof h === "string") return h;
  }
  // Policies that predate the activity trail (seeded) and aren't drafts were published as they are now.
  return prev.status !== "DRAFT" ? contentHash(prev) : null;
}

/** True once a policy has ever been published (its address is then fixed). */
export async function everPublished(p: Pick<Policy, "id" | "status" | "version">): Promise<boolean> {
  if (p.status !== "DRAFT" || p.version > 1) return true;
  return (await db.activityLog.count({ where: { entityType: "policy", entityId: p.id, action: "policy.published" } })) > 0;
}

function effectiveDate(v: string): Date | null {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  const date = campusDate(y, m, d);
  if (Number.isNaN(date.getTime()) || y < 1990 || y > 2100) throw invalid("Enter a real effective date.");
  return date;
}

function todayCampus(): Date {
  const now = inCampusTime(new Date());
  return campusDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

async function checkDocument(fileId: string) {
  const f = await db.fileItem.findUnique({ where: { id: fileId }, select: { id: true, name: true, mimeType: true, clubId: true, ownerId: true, isFolder: true, trashedAt: true, visibility: true } });
  if (!f || f.isFolder || f.trashedAt) throw invalid("That document isn't available anymore. Upload it again.");
  if (f.clubId || f.ownerId) throw invalid("Upload the document from this page, so it's kept with the university's files.");
  if (f.visibility !== "PUBLIC") throw invalid("Policy documents must be public, since anyone can read the policy library. Upload it again from this page.");
  if (!isPolicyDocument(f.name, f.mimeType)) throw invalid("Upload a PDF or Word document.");
  return f;
}

/**
 * Create (id null) or save a policy. The chosen status applies on save:
 * PUBLISHED puts it in the library and everywhere its placements say.
 */
export async function savePolicy(actor: Actor | null, id: string | null, input: unknown): Promise<{ id: string; slug: string; version: number; status: PolicyStatus; bumped: boolean }> {
  assertCan(actor, "admin.policies");
  const v = parse(PolicyInput, input);
  const prev = id ? await db.policy.findUnique({ where: { id } }) : null;
  if (id && !prev) throw notFound("Policy");

  // Address
  let slug = v.slug || policySlug(v.title);
  if (!slug) throw invalid("Give the policy a web address using letters or numbers.");
  if (!SLUG_PATTERN.test(slug)) throw invalid("Use lowercase letters, numbers and single hyphens in the web address (for example, event-safety).");
  if (prev && slug !== prev.slug && (await everPublished(prev))) {
    slug = prev.slug;
    if (v.slug && v.slug !== prev.slug) throw invalid(`This policy has been published, so its web address stays /policies/${prev.slug} — links to it would break otherwise.`);
  }
  const taken = await db.policy.findFirst({ where: { slug, ...(id ? { id: { not: id } } : {}) }, select: { title: true } });
  if (taken) throw invalid(`“${taken.title}” already uses /policies/${slug}. Choose another web address.`);

  // Content: written in the editor, or one uploaded document.
  let bodyHtml: string | null = null;
  let documentFileId: string | null = null;
  if (v.mode === "write") {
    bodyHtml = sanitizeRichHtml(v.bodyHtml ?? "");
    if (!richToText(bodyHtml).trim()) throw invalid("Write the policy text, or switch to “Upload a document”.");
  } else {
    if (!v.documentFileId) throw invalid("Upload the policy document, or switch to “Write”.");
    documentFileId = (await checkDocument(v.documentFileId)).id;
  }

  const placements: PolicyPlacement[] = v.placements.length ? [...new Set(v.placements)] : ["GENERAL"];
  let effectiveAt = effectiveDate(v.effectiveOn);
  if (v.status === "PUBLISHED" && !effectiveAt) effectiveAt = prev?.effectiveAt ?? todayCampus();

  const content = { title: v.title, summary: v.summary, bodyHtml, documentFileId };
  const hash = contentHash(content);
  let version = prev?.version ?? 1;
  let bumped = false;
  let baseline: string | null = null;
  if (prev && v.status === "PUBLISHED") {
    baseline = await lastPublishedHash(prev);
    if (baseline !== null && baseline !== hash) {
      version = prev.version + 1;
      bumped = true;
    }
  }

  const data = { slug, ...content, placements, status: v.status, effectiveAt, version };
  const row = prev ? await db.policy.update({ where: { id: prev.id }, data }) : await db.policy.create({ data: { ...data, authorId: actor.id } });

  // Activity: publishing is public news; everything else is an admin record.
  const base = { actorId: actor.id, entityType: "policy", entityId: row.id };
  const facts = { title: row.title, slug: row.slug, version: row.version, placements: row.placements };
  if (v.status === "PUBLISHED" && (prev?.status !== "PUBLISHED" || bumped || baseline === null)) {
    await logActivity({ ...base, action: "policy.published", data: { ...facts, publishedHash: hash, newVersion: bumped }, isPublic: true });
  } else if (v.status === "PUBLISHED") {
    await logActivity({ ...base, action: "policy.updated", data: { ...facts, publishedHash: hash } });
  } else if (v.status === "ARCHIVED" && prev?.status !== "ARCHIVED") {
    await logActivity({ ...base, action: "policy.archived", data: facts });
  } else {
    await logActivity({ ...base, action: prev ? "policy.saved" : "policy.created", data: { ...facts, status: row.status } });
  }
  return { id: row.id, slug: row.slug, version: row.version, status: row.status, bumped };
}

/** Delete a draft that was never published. Published policies are archived instead, so their history stays. */
export async function deletePolicy(actor: Actor | null, id: string): Promise<void> {
  assertCan(actor, "admin.policies");
  const p = await db.policy.findUnique({ where: { id } });
  if (!p) throw notFound("Policy");
  if (await everPublished(p)) throw invalid("This policy has been published, so it can't be deleted. Archive it instead — it leaves the library and the app, and its record stays.");
  await db.policy.delete({ where: { id } });
  await logActivity({ actorId: actor.id, action: "policy.deleted", entityType: "policy", entityId: id, data: { title: p.title, slug: p.slug } });
}

// ─── Reads ───────────────────────────────────────────────────────────────────

const docSelect = { id: true, name: true, mimeType: true, sizeBytes: true } as const;

/** The admin list: every policy, newest edits first. */
export async function listPoliciesForAdmin() {
  return db.policy.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: { author: { select: { name: true } }, documentFile: { select: docSelect } },
  });
}

export async function policyForEditor(id: string) {
  const p = await db.policy.findUnique({ where: { id }, include: { documentFile: { select: docSelect } } });
  if (!p) return null;
  return { policy: p, published: await everPublished(p) };
}

/** The public library: published policies only, optionally matching a search (title, summary or text). */
export async function publishedPolicies(q?: string | null) {
  const term = (q ?? "").trim().slice(0, 100);
  const text = { contains: term, mode: "insensitive" as const };
  return db.policy.findMany({
    where: { status: "PUBLISHED", ...(term ? { OR: [{ title: text }, { summary: text }, { bodyHtml: text }, { documentFile: { name: text } }] } : {}) },
    orderBy: { title: "asc" },
    select: { id: true, slug: true, title: true, summary: true, placements: true, version: true, effectiveAt: true, updatedAt: true, documentFileId: true },
  });
}

/**
 * One policy for its public page. Drafts and archived policies are visible
 * only to admins (as a preview, clearly labelled); everyone else gets null.
 */
export async function policyBySlug(actor: Actor | null, slug: string) {
  const p = await db.policy.findUnique({ where: { slug }, include: { documentFile: { select: docSelect } } });
  if (!p) return null;
  if (p.status !== "PUBLISHED" && !can(actor, "admin.policies")) return null;
  return p;
}
