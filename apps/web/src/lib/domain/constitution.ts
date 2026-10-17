import "server-only";
import type { ClubDocumentKind, JoinPolicy, SuccessionMethod } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getClubAccess } from "@/lib/authz";
import { clubsWhereUserHolds } from "@/lib/authz/people";
import { logActivity } from "@/lib/lake/activity";
import { assertCan, assertClubCap, assertSignedIn, conflict, forbidden, invalid, notFound } from "@/lib/domain/kit";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { notifyAdmins, notifyClubCapability } from "@/lib/domain/notify";
import { checkUpload, ensureClubFolder, parseForm, slugify, storeClubFile } from "@/lib/domain/clubs";
import { defaultDraftData, draftProblems, joinPolicyOf, normalizeDraftData, successionOf, type ClubFacts, type DocKind, type DraftData } from "@/lib/constitution/templates";
import { docToHtml, EMPTY_FACTS, renderDoc } from "@/lib/constitution/render";
import { renderConstitutionPdf } from "@/lib/constitution/pdf";

/**
 * Constitution & bylaws. Drafts belong to a person (one founder may run
 * several clubs); adopting a draft for a club renders both PDFs into the
 * club's files, makes them the ACTIVE documents, and auto-implements the
 * settings they decide (join policy, succession method). Custom uploads wait
 * for WSUSA approval and only then take effect.
 */

export const CONSTITUTION_FOLDER = "Constitution & Bylaws";
const KIND: Record<DocKind, ClubDocumentKind> = { constitution: "CONSTITUTION", bylaws: "BYLAWS" };
const KIND_LABEL: Record<ClubDocumentKind, string> = { CONSTITUTION: "Constitution", BYLAWS: "Bylaws", OTHER: "Document" };

// ─── Reading ─────────────────────────────────────────────────────────────────

/** The club facts the documents print (name, type, department, college). */
export async function clubFacts(clubId: string): Promise<ClubFacts> {
  const club = await db.club.findUnique({ where: { id: clubId }, select: { name: true, type: true, department: { select: { name: true } }, requestedDepartmentName: true, college: { select: { name: true } } } });
  if (!club) return EMPTY_FACTS;
  return { name: club.name, type: club.type, departmentName: club.department?.name ?? club.requestedDepartmentName ?? null, collegeName: club.college?.name ?? null };
}

/**
 * Clubs this person can adopt documents for: every club where they hold the
 * constitution capability and the club is still running. Admins hold it
 * everywhere, so for them only `includeClubId` (the club they came from) is listed.
 */
export async function adoptableClubs(actor: Actor, includeClubId?: string | null) {
  const ids = new Set(await clubsWhereUserHolds(actor.id, "constitution"));
  if (includeClubId) ids.add(includeClubId);
  const clubs = await db.club.findMany({
    where: { id: { in: [...ids] }, status: { in: ["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED"] } },
    select: { id: true, name: true, slug: true, status: true, logoUrl: true, logoColor: true, joinPolicy: true, successionMethod: true },
    orderBy: { name: "asc" },
  });
  const out: typeof clubs = [];
  for (const c of clubs) {
    const access = await getClubAccess(actor, c.id);
    if (access?.capabilities.has("constitution")) out.push(c);
  }
  return out;
}

export async function loadOwnDraft(actor: Actor | null, draftId: string) {
  assertSignedIn(actor);
  const draft = await db.constitutionDraft.findUnique({ where: { id: String(draftId) } });
  if (!draft || draft.ownerId !== actor.id) throw notFound("Draft");
  return { ...draft, data: normalizeDraftData(draft.data) };
}

// ─── Drafts ──────────────────────────────────────────────────────────────────

const CreateDraftInput = z.object({
  title: z.string().trim().max(120, "Keep the title under 120 characters.").nullish(),
  clubId: z.string().trim().max(64).nullish(),
  fromDraftId: z.string().trim().max(64).nullish(),
});

/**
 * Starts a draft. With a club, it's pre-filled from the club's current
 * settings; with `fromDraftId`, it copies a draft the person owns or one
 * behind a document in effect at a club they can amend (so a new president
 * can amend what the last one adopted).
 */
export async function createDraft(actor: Actor | null, input: unknown) {
  assertSignedIn(actor);
  const v = parseForm(CreateDraftInput, input);
  let club: { id: string; name: string; joinPolicy: JoinPolicy; successionMethod: SuccessionMethod } | null = null;
  if (v.clubId) {
    await assertClubCap(actor, v.clubId, "constitution");
    club = await db.club.findUnique({ where: { id: v.clubId }, select: { id: true, name: true, joinPolicy: true, successionMethod: true } });
    if (!club) throw notFound("Club");
  }
  let data: DraftData = defaultDraftData({ joinPolicy: club?.joinPolicy, successionMethod: club?.successionMethod, previewClubId: club?.id ?? null });
  if (v.fromDraftId) {
    const source = await db.constitutionDraft.findUnique({ where: { id: v.fromDraftId }, include: { documents: { select: { clubId: true } } } });
    if (!source) throw notFound("Draft");
    let allowed = source.ownerId === actor.id;
    for (const d of source.documents) {
      if (allowed) break;
      allowed = Boolean((await getClubAccess(actor, d.clubId))?.capabilities.has("constitution"));
    }
    if (!allowed) throw forbidden();
    data = { ...normalizeDraftData(source.data), previewClubId: club?.id ?? normalizeDraftData(source.data).previewClubId };
    // The club's current settings win over whatever the copied draft said.
    if (club) data.fields = { ...data.fields, joinPolicy: club.joinPolicy, successionMethod: club.successionMethod };
  }
  const draft = await db.constitutionDraft.create({
    data: { ownerId: actor.id, title: v.title || (club ? `${club.name} — constitution & bylaws` : "My constitution & bylaws"), data, successionMethod: successionOf(data) },
  });
  await logActivity({ actorId: actor.id, action: "constitution.draft_created", entityType: "constitutionDraft", entityId: draft.id, clubId: club?.id ?? null });
  return draft;
}

export async function saveDraft(actor: Actor | null, input: unknown) {
  assertSignedIn(actor);
  const v = parseForm(
    z.object({
      draftId: z.string().trim().min(1),
      title: z.string({ error: "Give the draft a title." }).trim().min(1, "Give the draft a title.").max(120, "Keep the title under 120 characters."),
      data: z.unknown(),
    }),
    input,
  );
  const draft = await loadOwnDraft(actor, v.draftId);
  const data = normalizeDraftData(v.data);
  if (data.previewClubId && !(await getClubAccess(actor, data.previewClubId))?.isLeader) data.previewClubId = null;
  const saved = await db.constitutionDraft.update({ where: { id: draft.id }, data: { title: v.title, data, successionMethod: successionOf(data) } });
  await logActivity({ actorId: actor.id, action: "constitution.draft_saved", entityType: "constitutionDraft", entityId: draft.id });
  return { id: saved.id, updatedAt: saved.updatedAt };
}

export async function deleteDraft(actor: Actor | null, draftId: string) {
  const draft = await loadOwnDraft(actor, draftId);
  // Adopted documents keep their PDFs and text; they just lose the link back to this draft.
  await db.constitutionDraft.delete({ where: { id: draft.id } });
  await logActivity({ actorId: actor!.id, action: "constitution.draft_deleted", entityType: "constitutionDraft", entityId: draft.id });
}

// ─── Adopting builder documents ──────────────────────────────────────────────

const AdoptInput = z.object({
  draftId: z.string().trim().min(1),
  clubIds: z.array(z.string().trim().min(1)).min(1, "Choose at least one club.").max(10, "Adopt for up to 10 clubs at a time."),
});

export type AdoptResult = { clubId: string; name: string; slug: string; constitutionVersion: number; bylawsVersion: number };

/** Next version number for a kind: documents that took effect only (pending/rejected uploads are version 0). */
async function nextVersion(clubId: string, kind: ClubDocumentKind) {
  const last = await db.clubDocument.aggregate({ where: { clubId, kind, status: { in: ["ACTIVE", "SUPERSEDED"] } }, _max: { version: true } });
  return (last._max.version ?? 0) + 1;
}

/**
 * Adopt a draft for one or more clubs. For each club: both PDFs go into the
 * club's "Constitution & Bylaws" folder (public), become the ACTIVE documents
 * (previous ones SUPERSEDED, pending custom uploads withdrawn), and the club's
 * join policy and succession method follow the draft.
 */
export async function adoptDraft(actor: Actor | null, input: unknown): Promise<AdoptResult[]> {
  assertSignedIn(actor);
  const v = parseForm(AdoptInput, input);
  const draft = await loadOwnDraft(actor, v.draftId);
  const problems = draftProblems(draft.data);
  if (problems.length) throw invalid(`Finish the draft first: ${problems[0].message}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`);

  const clubIds = [...new Set(v.clubIds)];
  // Check every club before writing anything, so a bad pick doesn't leave a half-adopted batch.
  for (const clubId of clubIds) await assertClubCap(actor, clubId, "constitution");

  const joinPolicy = joinPolicyOf(draft.data);
  const successionMethod = successionOf(draft.data);
  const results: AdoptResult[] = [];
  for (const clubId of clubIds) {
    const club = await db.club.findUniqueOrThrow({ where: { id: clubId }, select: { id: true, name: true, slug: true, joinPolicy: true, successionMethod: true } });
    const facts = await clubFacts(clubId);
    const folder = await ensureClubFolder(clubId, CONSTITUTION_FOLDER, "PUBLIC", actor.id);
    const now = new Date();
    const versions: Record<DocKind, number> = { constitution: 0, bylaws: 0 };

    for (const kind of ["constitution", "bylaws"] as DocKind[]) {
      const docKind = KIND[kind];
      const version = await nextVersion(clubId, docKind);
      const rendered = renderDoc(kind, draft.data, facts);
      const pdf = await renderConstitutionPdf(rendered, { adoptedOn: now, version });
      const file = await storeClubFile({
        clubId,
        folderId: folder.id,
        name: `${slugify(club.name)}-${kind}-v${version}.pdf`,
        bytes: pdf,
        visibility: "PUBLIC",
        createdById: actor.id,
      });
      const withdrawn = await db.clubDocument.findMany({ where: { clubId, kind: docKind, status: "PENDING_APPROVAL" }, select: { id: true } });
      await db.$transaction(async (tx) => {
        await tx.clubDocument.updateMany({ where: { clubId, kind: docKind, status: { in: ["ACTIVE", "PENDING_APPROVAL"] } }, data: { status: "SUPERSEDED", decidedAt: now } });
        await tx.clubDocument.create({
          data: { clubId, kind: docKind, title: KIND_LABEL[docKind], version, source: "BUILDER", status: "ACTIVE", draftId: draft.id, contentHtml: docToHtml(rendered), fileId: file.id, createdById: actor.id, decidedAt: now },
        });
        for (const w of withdrawn) await resolveTasks("clubDocument", w.id, actor.id, tx, "CANCELLED");
      });
      versions[kind] = version;
    }

    await db.club.update({ where: { id: clubId }, data: { joinPolicy, successionMethod } });
    await logActivity({
      actorId: actor.id,
      action: "constitution.adopted",
      entityType: "club",
      entityId: clubId,
      clubId,
      data: { draftId: draft.id, constitutionVersion: versions.constitution, bylawsVersion: versions.bylaws, joinPolicy, successionMethod, previous: { joinPolicy: club.joinPolicy, successionMethod: club.successionMethod } },
      isPublic: true,
    });
    await notifyClubCapability(clubId, "constitution", {
      kind: "constitution.adopted",
      title: `${club.name} adopted a new constitution and bylaws`,
      body: `${actor.name} adopted version ${versions.constitution} of the constitution and version ${versions.bylaws} of the bylaws.`,
      href: `/clubs/${club.slug}/manage/constitution`,
      exceptUserId: actor.id,
      email: false,
    });
    results.push({ clubId, name: club.name, slug: club.slug, constitutionVersion: versions.constitution, bylawsVersion: versions.bylaws });
  }
  return results;
}

// ─── Custom documents (need WSUSA approval) ──────────────────────────────────

const CUSTOM_EXTENSIONS = /\.(pdf|docx?)$/i;

const CustomInput = z.object({
  clubId: z.string().trim().min(1),
  kind: z.enum(["CONSTITUTION", "BYLAWS"], { error: "Choose constitution or bylaws." }),
  title: z.string().trim().max(120, "Keep the title under 120 characters.").nullish(),
  successionMethod: z.enum(["SENIORITY", "MEMBER_VOTE", "LEADERSHIP_VOTE"], { error: "Choose how your document picks the next leaders." }),
  joinPolicy: z.enum(["OPEN", "APPROVAL"], { error: "Choose how students join under your document." }),
  note: z.string().trim().max(2000, "Keep the note under 2,000 characters.").nullish(),
});

/**
 * Uploads a custom constitution or bylaws for WSUSA review. The club states
 * the succession method and join policy the document sets; both are applied
 * when WSUSA approves. Current documents stay in effect until then.
 */
export async function submitCustomDocument(actor: Actor | null, input: { file: { name: string; mimeType?: string | null; bytes: Buffer } } & Record<string, unknown>) {
  assertSignedIn(actor);
  const v = parseForm(CustomInput, input);
  await assertClubCap(actor, v.clubId, "constitution");
  checkUpload(input.file, CUSTOM_EXTENSIONS, "Upload your document as a PDF or Word file.");
  const club = await db.club.findUniqueOrThrow({ where: { id: v.clubId }, select: { id: true, name: true, slug: true } });
  const pending = await db.clubDocument.findFirst({ where: { clubId: club.id, kind: v.kind, status: "PENDING_APPROVAL" } });
  if (pending) throw conflict(`Your custom ${KIND_LABEL[v.kind].toLowerCase()} is already waiting for WSUSA. Withdraw it first to upload a new one.`);

  const folder = await ensureClubFolder(club.id, CONSTITUTION_FOLDER, "PUBLIC", actor.id);
  // Leaders-only until WSUSA approves; approval makes it public like builder documents.
  const file = await storeClubFile({ clubId: club.id, folderId: folder.id, name: input.file.name, bytes: input.file.bytes, visibility: "LEADERS", createdById: actor.id });
  const doc = await db.clubDocument.create({
    data: {
      clubId: club.id,
      kind: v.kind,
      title: v.title || `Custom ${KIND_LABEL[v.kind].toLowerCase()}`,
      // Unnumbered (0) until WSUSA approves it; withdrawn or rejected uploads never take a version number.
      version: 0,
      source: "CUSTOM_UPLOAD",
      status: "PENDING_APPROVAL",
      statedSuccessionMethod: v.successionMethod ?? null,
      statedJoinPolicy: v.joinPolicy ?? null,
      note: v.note ?? null,
      fileId: file.id,
      createdById: actor.id,
    },
  });
  await createTask({
    kind: "APPROVAL",
    title: `Review ${club.name}'s custom ${KIND_LABEL[v.kind].toLowerCase()}`,
    description: v.note ?? undefined,
    assignee: { type: "ADMINS" },
    clubId: club.id,
    href: `/admin/clubs/${club.id}#documents`,
    source: { type: "clubDocument", id: doc.id },
    createdById: actor.id,
  });
  await logActivity({ actorId: actor.id, action: "constitution.custom_submitted", entityType: "clubDocument", entityId: doc.id, clubId: club.id, data: { kind: v.kind, successionMethod: v.successionMethod, joinPolicy: v.joinPolicy, note: v.note ?? null } });
  await notifyAdmins({
    kind: "constitution.custom_submitted",
    title: `${club.name} uploaded a custom ${KIND_LABEL[v.kind].toLowerCase()} for approval`,
    body: v.note ?? undefined,
    href: `/admin/clubs/${club.id}#documents`,
    exceptUserId: actor.id,
  });
  return doc;
}

/** The succession method / join policy a club stated when it uploaded a custom document. */
export async function statedSettings(docId: string): Promise<{ successionMethod: SuccessionMethod | null; joinPolicy: JoinPolicy | null; note: string | null }> {
  const d = await db.clubDocument.findUnique({ where: { id: docId }, select: { statedSuccessionMethod: true, statedJoinPolicy: true, note: true } });
  return { successionMethod: d?.statedSuccessionMethod ?? null, joinPolicy: d?.statedJoinPolicy ?? null, note: d?.note ?? null };
}

export async function withdrawCustomDocument(actor: Actor | null, docId: string) {
  assertSignedIn(actor);
  const doc = await db.clubDocument.findUnique({ where: { id: String(docId) } });
  if (!doc || doc.status !== "PENDING_APPROVAL") throw notFound("Pending document");
  await assertClubCap(actor, doc.clubId, "constitution");
  await db.clubDocument.update({ where: { id: doc.id }, data: { status: "SUPERSEDED", decidedAt: new Date() } });
  await resolveTasks("clubDocument", doc.id, actor.id, db, "CANCELLED");
  await logActivity({ actorId: actor.id, action: "constitution.custom_withdrawn", entityType: "clubDocument", entityId: doc.id, clubId: doc.clubId });
}

const DecideDocInput = z
  .object({ docId: z.string().trim().min(1), approve: z.boolean(), note: z.string().trim().max(2000, "Keep the note under 2,000 characters.").nullish() })
  .refine((v) => v.approve || Boolean(v.note), "Add a note so the club knows what to fix.");

/** WSUSA approves (it takes effect, settings apply) or rejects a custom document. */
export async function decideCustomDocument(actor: Actor | null, input: unknown) {
  assertCan(actor, "admin.clubs");
  const v = parseForm(DecideDocInput, input);
  const doc = await db.clubDocument.findUnique({ where: { id: v.docId }, include: { club: { select: { id: true, name: true, slug: true } } } });
  if (!doc || doc.kind === "OTHER") throw notFound("Document");
  if (doc.status !== "PENDING_APPROVAL") throw conflict("This document was already decided or withdrawn.");
  const stated = await statedSettings(doc.id);
  const now = new Date();
  const label = KIND_LABEL[doc.kind];

  await db.$transaction(async (tx) => {
    if (v.approve) {
      const last = await tx.clubDocument.aggregate({ where: { clubId: doc.clubId, kind: doc.kind, status: { in: ["ACTIVE", "SUPERSEDED"] } }, _max: { version: true } });
      await tx.clubDocument.updateMany({ where: { clubId: doc.clubId, kind: doc.kind, status: "ACTIVE" }, data: { status: "SUPERSEDED", decidedAt: now } });
      await tx.clubDocument.update({ where: { id: doc.id }, data: { status: "ACTIVE", decidedAt: now, version: (last._max.version ?? 0) + 1 } });
      if (doc.fileId) await tx.fileItem.update({ where: { id: doc.fileId }, data: { visibility: "PUBLIC" } });
      await tx.club.update({
        where: { id: doc.clubId },
        data: { ...(stated.successionMethod ? { successionMethod: stated.successionMethod } : {}), ...(stated.joinPolicy ? { joinPolicy: stated.joinPolicy } : {}) },
      });
    } else {
      await tx.clubDocument.update({ where: { id: doc.id }, data: { status: "REJECTED", decidedAt: now } });
    }
    await tx.clubDecision.create({
      data: { clubId: doc.clubId, action: v.approve ? "DOCUMENT_APPROVED" : "DOCUMENT_REJECTED", note: [`Custom ${label.toLowerCase()}`, v.note].filter(Boolean).join(": "), byId: actor.id },
    });
    await resolveTasks("clubDocument", doc.id, actor.id, tx);
    await logActivity({ actorId: actor.id, action: v.approve ? "constitution.custom_approved" : "constitution.custom_rejected", entityType: "clubDocument", entityId: doc.id, clubId: doc.clubId, data: { successionMethod: stated.successionMethod, joinPolicy: stated.joinPolicy, note: v.note ?? null }, isPublic: v.approve }, tx);
  });
  await notifyClubCapability(doc.clubId, "constitution", {
    kind: v.approve ? "constitution.custom_approved" : "constitution.custom_rejected",
    title: v.approve ? `WSUSA approved ${doc.club.name}'s custom ${label.toLowerCase()}` : `WSUSA didn't approve ${doc.club.name}'s custom ${label.toLowerCase()}`,
    body: v.note ?? (v.approve ? "It's now in effect, and your club settings follow it." : undefined),
    href: `/clubs/${doc.club.slug}/manage/constitution`,
  });
}

