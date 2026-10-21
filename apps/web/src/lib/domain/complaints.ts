import "server-only";
import { randomInt } from "node:crypto";
import type { ComplaintStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { logActivity } from "@/lib/lake/activity";
import { campusDate } from "@/lib/time";
import { assertCan, assertSignedIn, conflict, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { notify, notifyAdmins } from "@/lib/domain/notify";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { COMPLAINT_CATEGORIES, COMPLAINT_STATUS_LABEL, normalizeCaseCode } from "@/components/admin/complaint-copy";

/**
 * Reports ("complaints") — the one input tool is the form at /report; the
 * only place they're read is the admin tool at /admin/complaints.
 *
 * Anonymity (ARCHITECTURE §6): an anonymous report stores NO reporter id, and
 * nothing that could identify the reporter is written anywhere else either —
 * the activity row has no actor and no data, nobody is notified on their
 * behalf, and nothing goes to the outbox about them. The reporter keeps a case
 * code to check the status. Every time an admin opens a report it's logged in
 * ComplaintAccessLog; anonymous ones only open after the admin acknowledges
 * the anonymity notice, every time.
 *
 * Report content (subject, body, club, dates, notes) never goes into
 * notifications, tasks, the activity log, exports or the AI assistant.
 * Activity rows here never carry a clubId, so they can't surface in a club's feed.
 */

const CATEGORY_VALUES = COMPLAINT_CATEGORIES.map((c) => c.value) as [string, ...string[]];
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I look-alikes

function newCaseCode() {
  let mid = "";
  for (let i = 0; i < 4; i++) mid += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `WC-${mid}-${randomInt(10, 100)}`;
}

/** "YYYY-MM-DD" in campus time → noon campus time that day (so it never shifts a day when shown). */
function campusDay(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return campusDate(y, m, d, 12, 0);
}

const SubmitInput = z.object({
  category: z.enum(CATEGORY_VALUES, { error: "Pick the kind of concern." }),
  subject: z.string({ error: "Give your report a short subject." }).trim().min(5, "Give your report a short subject (at least 5 characters).").max(140, "Keep the subject under 140 characters."),
  body: z
    .string({ error: "Tell us what happened." })
    .trim()
    .min(20, "Tell us a little more about what happened (at least 20 characters).")
    .max(5000, "Keep the description under 5,000 characters."),
  clubId: z
    .string()
    .trim()
    .max(40)
    .optional()
    .nullable()
    .transform((v) => v || null),
  incidentDate: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => v || null)
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter the date as YYYY-MM-DD."),
  anonymous: z.boolean({ error: "Choose whether to report anonymously or with your name." }),
});

export type SubmitComplaintInput = z.input<typeof SubmitInput>;

/**
 * File a report. Anonymous: reporterId stays null and nothing links it to the
 * person. Named: the reporter can follow it under "My reports".
 * Returns the case code — for anonymous reports it's shown once and never again.
 */
export async function submitComplaint(actor: Actor | null, input: unknown): Promise<{ caseCode: string; isAnonymous: boolean }> {
  assertCan(actor, "complaint.submit");
  const v = parse(SubmitInput, input);

  let incidentDate: Date | null = null;
  if (v.incidentDate) {
    incidentDate = campusDay(v.incidentDate);
    if (Number.isNaN(incidentDate.getTime())) throw invalid("That incident date isn't a real date.");
    if (incidentDate.getTime() > Date.now() + 12 * 3_600_000) throw invalid("The incident date can't be in the future.");
    if (incidentDate.getFullYear() < 2000) throw invalid("Check the incident date — it looks too far in the past.");
  }
  if (v.clubId) {
    const club = await db.club.findUnique({ where: { id: v.clubId }, select: { status: true } });
    if (!club || club.status === "DRAFT") throw invalid("That club wasn't found. Pick it from the list, or leave the club blank.");
  }

  // Case codes are unique; retry on the rare collision.
  let complaint: { id: string; caseCode: string } | null = null;
  for (let attempt = 0; attempt < 6 && !complaint; attempt++) {
    const caseCode = newCaseCode();
    if (await db.complaint.findUnique({ where: { caseCode }, select: { id: true } })) continue;
    complaint = await db.complaint.create({
      data: {
        caseCode,
        isAnonymous: v.anonymous,
        reporterId: v.anonymous ? null : actor.id,
        category: v.category,
        subject: v.subject,
        body: v.body,
        clubId: v.clubId,
        incidentDate,
      },
      select: { id: true, caseCode: true },
    });
  }
  if (!complaint) throw conflict("We couldn't file your report just now. Please try again.");

  // Anonymous: no actor, no data. Named: the reporter, still no content.
  await logActivity({ actorId: v.anonymous ? null : actor.id, action: "complaint.submitted", entityType: "complaint", entityId: complaint.id });

  // One task for the admin inbox, with no content (closes once the report leaves New).
  await createTask({
    kind: "APPROVAL",
    title: "A new report is waiting",
    description: "Open it in Reports. Report details never appear in tasks, notifications or email.",
    assignee: { type: "ADMINS", umbrella: true }, // reports are WSUSA's alone
    href: `/admin/complaints?open=${complaint.id}`,
    source: { type: "complaint", id: complaint.id },
  });
  // Nobody is skipped for anonymous reports: leaving the reporter out would identify them.
  await notifyAdmins({
    kind: "complaint.new",
    title: "A new report was submitted",
    body: "Open Reports in the admin tools to review it.",
    href: "/admin/complaints",
    exceptUserId: v.anonymous ? null : actor.id,
  });
  if (!v.anonymous) {
    await notify({
      userIds: [actor.id],
      kind: "complaint.received",
      title: "We received your report",
      body: `Case ${complaint.caseCode}. WSUSA administrators will review it — follow its status under My reports.`,
      href: "/report",
    });
  }
  return { caseCode: complaint.caseCode, isAnonymous: v.anonymous };
}

/**
 * Status by case code — the reporter's receipt. Returns the status and when
 * it last changed, nothing else. Nothing about the lookup is recorded.
 */
export async function complaintStatusByCode(actor: Actor | null, code: unknown) {
  assertSignedIn(actor);
  const normalized = typeof code === "string" ? normalizeCaseCode(code) : null;
  if (!normalized) throw invalid("Case codes look like WC-7KQ2-48. Check the code and try again.");
  const c = await db.complaint.findUnique({ where: { caseCode: normalized }, select: { caseCode: true, status: true, updatedAt: true } });
  if (!c) throw notFound(`A report with case code ${normalized}`);
  return { caseCode: c.caseCode, status: c.status, updatedAt: c.updatedAt.toISOString() };
}

/** Reports this person filed with their name (anonymous ones aren't linked to anyone). */
export async function myComplaints(actor: Actor | null) {
  assertSignedIn(actor);
  return db.complaint.findMany({
    where: { reporterId: actor.id, isAnonymous: false },
    orderBy: { createdAt: "desc" },
    select: { id: true, caseCode: true, category: true, subject: true, status: true, createdAt: true, updatedAt: true, club: { select: { name: true } } },
  });
}

// ─── Admin tool ──────────────────────────────────────────────────────────────

export type ComplaintFilters = {
  status?: ComplaintStatus | "open" | "all";
  type?: "anonymous" | "named" | "all";
  category?: string | null;
};

/**
 * The admin list. Deliberately carries NO report content — no subject, body,
 * club, reporter or incident date — so opening a report (and acknowledging
 * the anonymity notice) is the only way to read one.
 */
export async function listComplaints(actor: Actor | null, filters: ComplaintFilters = {}) {
  assertCan(actor, "admin.complaints");
  const where: Prisma.ComplaintWhereInput = {};
  if (filters.status === "open" || filters.status === undefined) where.status = { in: ["NEW", "IN_REVIEW", "REFERRED"] };
  else if (filters.status !== "all") where.status = filters.status;
  if (filters.type === "anonymous") where.isAnonymous = true;
  if (filters.type === "named") where.isAnonymous = false;
  if (filters.category) where.category = filters.category;

  const rows = await db.complaint.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: 500,
    select: { id: true, caseCode: true, isAnonymous: true, category: true, status: true, createdAt: true, updatedAt: true, _count: { select: { accessLog: true, notes: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    caseCode: r.caseCode,
    isAnonymous: r.isAnonymous,
    category: r.category,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    opens: r._count.accessLog,
    notes: r._count.notes,
  }));
}

export type ComplaintListRow = Awaited<ReturnType<typeof listComplaints>>[number];

/** Counts per status and the categories in use (for the filters). No content. */
export async function complaintOverview(actor: Actor | null) {
  assertCan(actor, "admin.complaints");
  const [byStatus, categories] = await Promise.all([
    db.complaint.groupBy({ by: ["status"], _count: { _all: true } }),
    db.complaint.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
  ]);
  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Partial<Record<ComplaintStatus, number>>;
  return { counts, categories: categories.map((c) => c.category) };
}

const detailSelect = {
  id: true,
  caseCode: true,
  isAnonymous: true,
  category: true,
  subject: true,
  body: true,
  incidentDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  club: { select: { id: true, name: true, slug: true } },
  reporter: { select: { id: true, name: true, email: true } },
  notes: { orderBy: { createdAt: "asc" }, select: { id: true, body: true, createdAt: true, author: { select: { name: true } } } },
  accessLog: { orderBy: { at: "desc" }, take: 50, select: { id: true, at: true, acknowledgedAnonymity: true, admin: { select: { name: true } } } },
  _count: { select: { accessLog: true } },
} satisfies Prisma.ComplaintSelect;

function toDetail(c: Prisma.ComplaintGetPayload<{ select: typeof detailSelect }>) {
  return {
    id: c.id,
    caseCode: c.caseCode,
    isAnonymous: c.isAnonymous,
    category: c.category,
    subject: c.subject,
    body: c.body,
    incidentDate: c.incidentDate ? c.incidentDate.toISOString() : null,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    club: c.club,
    // Belt and braces: never hand back a reporter for an anonymous report.
    reporter: c.isAnonymous ? null : c.reporter,
    notes: c.notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString(), author: n.author.name })),
    accessLog: c.accessLog.map((a) => ({ id: a.id, at: a.at.toISOString(), admin: a.admin.name, acknowledged: a.acknowledgedAnonymity })),
    totalOpens: c._count.accessLog,
  };
}

export type ComplaintDetail = ReturnType<typeof toDetail>;

/**
 * Opens a report for an admin. Anonymous reports refuse to open unless the
 * admin acknowledged the anonymity notice for THIS opening. Every opening,
 * named or anonymous, is written to ComplaintAccessLog.
 */
export async function openComplaint(actor: Actor | null, complaintId: string, opts: { acknowledged?: boolean } = {}): Promise<ComplaintDetail> {
  assertCan(actor, "admin.complaints");
  const head = await db.complaint.findUnique({ where: { id: String(complaintId ?? "") }, select: { id: true, isAnonymous: true } });
  if (!head) throw notFound("That report");
  if (head.isAnonymous && opts.acknowledged !== true) throw forbidden("This report is anonymous. Acknowledge the anonymity notice to open it.");
  await db.complaintAccessLog.create({ data: { complaintId: head.id, adminId: actor.id, acknowledgedAnonymity: head.isAnonymous } });
  const c = await db.complaint.findUniqueOrThrow({ where: { id: head.id }, select: detailSelect });
  return toDetail(c);
}

const NoteInput = z.object({
  body: z.string({ error: "Write the note first." }).trim().min(2, "Write the note first.").max(4000, "Keep notes under 4,000 characters."),
});

/** Internal note on a report. Visible to admins only; the reporter never sees notes. */
export async function addComplaintNote(actor: Actor | null, complaintId: string, input: unknown) {
  assertCan(actor, "admin.complaints");
  const { body } = parse(NoteInput, input);
  const c = await db.complaint.findUnique({ where: { id: String(complaintId ?? "") }, select: { id: true } });
  if (!c) throw notFound("That report");
  const note = await db.complaintNote.create({ data: { complaintId: c.id, authorId: actor.id, body }, select: { id: true, body: true, createdAt: true } });
  await logActivity({ actorId: actor.id, action: "complaint.note_added", entityType: "complaint", entityId: c.id });
  return { id: note.id, body: note.body, createdAt: note.createdAt.toISOString(), author: actor.name };
}

const StatusInput = z.object({
  status: z.enum(["IN_REVIEW", "REFERRED", "RESOLVED", "CLOSED"], { error: "Pick a status." }),
  note: z
    .string()
    .trim()
    .max(4000, "Keep notes under 4,000 characters.")
    .optional()
    .nullable()
    .transform((v) => v || null),
});

/**
 * Moves a report along: New → In review → Referred / Resolved / Closed (and
 * back to In review to reopen). A report never returns to New. An optional
 * note is saved with the change. Named reporters get an in-app nudge with the
 * new status only.
 */
export async function setComplaintStatus(actor: Actor | null, complaintId: string, input: unknown) {
  assertCan(actor, "admin.complaints");
  const v = parse(StatusInput, input);
  const c = await db.complaint.findUnique({ where: { id: String(complaintId ?? "") }, select: { id: true, status: true, caseCode: true, isAnonymous: true, reporterId: true } });
  if (!c) throw notFound("That report");
  if (c.status === v.status) throw conflict(`This report is already ${COMPLAINT_STATUS_LABEL[v.status].toLowerCase()}.`);

  const [updated, note] = await db.$transaction(async (tx) => {
    const u = await tx.complaint.update({ where: { id: c.id }, data: { status: v.status }, select: { status: true, updatedAt: true } });
    const n = v.note ? await tx.complaintNote.create({ data: { complaintId: c.id, authorId: actor.id, body: v.note }, select: { id: true, body: true, createdAt: true } }) : null;
    await logActivity({ actorId: actor.id, action: "complaint.status_changed", entityType: "complaint", entityId: c.id, data: { from: c.status, to: v.status } }, tx);
    if (c.status === "NEW") await resolveTasks("complaint", c.id, actor.id, tx);
    return [u, n] as const;
  });

  if (!c.isAnonymous && c.reporterId) {
    await notify({
      userIds: [c.reporterId],
      kind: "complaint.updated",
      title: `Your report ${c.caseCode} is now ${COMPLAINT_STATUS_LABEL[v.status].toLowerCase()}`,
      body: "See My reports for its status.",
      href: "/report",
      exceptUserId: actor.id,
    });
  }
  return {
    status: updated.status,
    updatedAt: updated.updatedAt.toISOString(),
    note: note ? { id: note.id, body: note.body, createdAt: note.createdAt.toISOString(), author: actor.name } : null,
  };
}
