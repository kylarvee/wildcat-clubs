import "server-only";
import { Prisma, type ClubType, type FundingSource, type FundingStatus, type Term } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { can, getClubAccess } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { assertCan, assertClubCap, assertSignedIn, conflict, invalid, notFound, parse } from "@/lib/domain/kit";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { notifyAdmins, notifyClubCapability } from "@/lib/domain/notify";
import { eventCostSummaries } from "@/lib/domain/events";
import { getConfig } from "@/lib/config";
import { budgetTermFor, getTerms } from "@/lib/terms";
import { DAY_MS, fmtDate, fmtMoney } from "@/lib/time";
import { defaultFundingSource } from "@/lib/funding/defaults";
import { sourceName } from "@/lib/funding/labels";
import {
  ACTIVE_REQUEST_STATUSES,
  MAX_LINE_CENTS,
  MAX_REQUEST_CENTS,
  MIN_JUSTIFICATION,
  dollarsToCents,
  lineCents,
  nextInvoiceNumber,
  partialAmountProblem,
  requestTotals,
  sumBySource,
  sumCents,
  termLineTotal,
} from "@/lib/funding/math";

/**
 * Funding & budgeting — the Budget tool's write path (general costs, funding
 * requests) and the admin side (decisions, invoices).
 *
 * Where costs come from (ARCHITECTURE.md §4, §6):
 *   - Event costs are BudgetItems with an eventId, entered ONLY in the Events
 *     Builder (lib/domain/events). This module reads them, never edits them.
 *   - General costs (eventId null) are entered here.
 * A funding request asks one source for money in one term. It's built from
 * cost lines; on submission each line is snapshotted into FundingRequestItem
 * (occurrences in that term × one set), so later edits never rewrite history.
 *
 * Who may act: the club's "budget" capability for club actions (only APPROVED
 * clubs have it), `admin.funding` for decisions and invoices.
 *
 * Tasks: submitting opens an ADMINS approval task (sourceType "funding");
 * deciding or withdrawing closes it. An invoice opens an ADMINS INVOICE task
 * (sourceType "invoice") that closes when the invoice is marked processed.
 */

// ─── Shapes ──────────────────────────────────────────────────────────────────

const FUNDING = z.enum(["UNIVERSITY", "WSUSA", "COLLEGE", "DEPARTMENT"], { error: "Pick where the money should come from." });
const id = z.string().trim().min(1).max(64);

const EVENT_SELECT = {
  id: true,
  title: true,
  status: true,
  startsAt: true,
  allDay: true,
  recurrence: true,
  recurrenceInterval: true,
  recurrenceWeekdays: true,
  recurrenceUntil: true,
  recurrenceCount: true,
} satisfies Prisma.EventSelect;

const REQUEST_INCLUDE = {
  items: { orderBy: { id: "asc" } },
  invoices: { orderBy: { createdAt: "asc" }, include: { createdBy: { select: { name: true } } } },
  submittedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  term: true,
} satisfies Prisma.FundingRequestInclude;

export type FundingRequestRow = Prisma.FundingRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

export type BudgetLine = {
  id: string;
  termId: string;
  eventId: string | null;
  eventTitle: string | null;
  description: string;
  category: string;
  quantity: number;
  unitCostCents: number;
  perOccurrence: boolean;
  fundingSource: FundingSource;
  /** Times the line counts in this term (meetings for per-meeting lines, else 1). */
  occurrences: number;
  /** One set: quantity × unit cost. */
  setCents: number;
  /** setCents × occurrences — the line's cost this term. */
  totalCents: number;
  /** The submitted or approved request that already covers this line this term. */
  lockedBy: { id: string; title: string; status: FundingStatus } | null;
};

export type EventCostGroup = {
  event: Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;
  /** Scheduled meetings of the event in this term. */
  meetings: number;
  perMeetingCents: number;
  oneTimeCents: number;
  totalCents: number;
  /** The event's costs that land in other terms (repeating events can span two). */
  otherTerms: { termId: string | null; termName: string; meetings: number; totalCents: number }[];
  lines: BudgetLine[];
};

export type TermRequest = FundingRequestRow & {
  /** Drafts: what the chosen lines add up to right now. Others: the submitted amount. */
  liveCents: number;
  /** Drafts: chosen lines that are no longer in this term's budget. */
  staleLines: number;
};

export type ClubTermBudget = {
  term: Term;
  lines: BudgetLine[];
  eventGroups: EventCostGroup[];
  general: BudgetLine[];
  planned: { totalCents: number; eventCents: number; generalCents: number; unrequestedCents: number; bySource: Record<FundingSource, number> };
  requests: TermRequest[];
  money: ReturnType<typeof requestTotals>;
};

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Which line ids an active request already covers, per request (this term only). */
function lockMap(requests: FundingRequestRow[]) {
  const locks = new Map<string, { id: string; title: string; status: FundingStatus }>();
  for (const r of requests) {
    if (!ACTIVE_REQUEST_STATUSES.includes(r.status)) continue;
    for (const i of r.items) if (i.budgetItemId && !locks.has(i.budgetItemId)) locks.set(i.budgetItemId, { id: r.id, title: r.title, status: r.status });
  }
  return locks;
}

/**
 * A club's budget for one term: event costs (with each repeating event's
 * meetings in the term), general costs, totals by funding source, and the
 * term's funding requests. Read-only; callers check the "budget" capability
 * (or admin.funding) first.
 */
export async function loadClubTermBudget(clubId: string, termId: string): Promise<ClubTermBudget> {
  const terms = await getTerms();
  const term = terms.find((t) => t.id === termId);
  if (!term) throw notFound("Semester");

  const [items, requests] = await Promise.all([
    db.budgetItem.findMany({
      // Per-meeting event lines can be filed under an earlier term and still have meetings in this one.
      where: { clubId, OR: [{ termId }, { eventId: { not: null }, perOccurrence: true }] },
      include: { event: { select: EVENT_SELECT } },
      orderBy: { createdAt: "asc" },
    }),
    db.fundingRequest.findMany({ where: { clubId, termId }, include: REQUEST_INCLUDE, orderBy: { createdAt: "desc" } }),
  ]);

  const summaries = await eventCostSummaries(items.map((i) => i.eventId).filter((x): x is string => Boolean(x)));
  const meetingsIn = (eventId: string, tId: string | null) => summaries.get(eventId)?.occurrencesByTerm.find((b) => b.termId === tId)?.occurrences ?? 0;
  const locks = lockMap(requests);

  const lines: BudgetLine[] = [];
  for (const i of items) {
    const t = termLineTotal(i, termId, i.eventId ? meetingsIn(i.eventId, termId) : 0);
    if (t.occurrences === 0) continue;
    lines.push({
      id: i.id,
      termId: i.termId,
      eventId: i.eventId,
      eventTitle: i.event?.title ?? null,
      description: i.description,
      category: i.category,
      quantity: i.quantity,
      unitCostCents: i.unitCostCents,
      perOccurrence: Boolean(i.eventId) && i.perOccurrence,
      fundingSource: i.fundingSource,
      occurrences: t.occurrences,
      setCents: t.setCents,
      totalCents: t.totalCents,
      lockedBy: locks.get(i.id) ?? null,
    });
  }

  const groups = new Map<string, EventCostGroup>();
  for (const line of lines) {
    if (!line.eventId) continue;
    const item = items.find((i) => i.id === line.id)!;
    let g = groups.get(line.eventId);
    if (!g) {
      const summary = summaries.get(line.eventId);
      g = {
        event: item.event!,
        meetings: meetingsIn(line.eventId, termId),
        perMeetingCents: 0,
        oneTimeCents: 0,
        totalCents: 0,
        otherTerms: (summary?.occurrencesByTerm ?? []).filter((b) => b.termId !== termId && b.totalCents > 0).map((b) => ({ ...b, meetings: b.occurrences })),
        lines: [],
      };
      groups.set(line.eventId, g);
    }
    g.lines.push(line);
    if (line.perOccurrence) g.perMeetingCents += line.setCents;
    else g.oneTimeCents += line.totalCents;
    g.totalCents += line.totalCents;
  }
  const eventGroups = [...groups.values()]
    .map((g) => ({ ...g, lines: [...g.lines].sort((a, b) => Number(b.perOccurrence) - Number(a.perOccurrence)) }))
    .sort((a, b) => (a.event.startsAt?.getTime() ?? Infinity) - (b.event.startsAt?.getTime() ?? Infinity) || a.event.title.localeCompare(b.event.title));
  const general = lines.filter((l) => !l.eventId);

  const liveById = new Map(lines.map((l) => [l.id, l]));
  const termRequests: TermRequest[] = requests.map((r) => {
    if (r.status !== "DRAFT") return { ...r, liveCents: r.amountRequestedCents, staleLines: 0 };
    const chosen = r.items.map((i) => (i.budgetItemId ? liveById.get(i.budgetItemId) : undefined));
    return { ...r, liveCents: chosen.reduce((s, l) => s + (l?.totalCents ?? 0), 0), staleLines: chosen.filter((l) => !l).length };
  });

  const eventCents = sumCents(lines.filter((l) => l.eventId));
  const generalCents = sumCents(general);
  return {
    term,
    lines,
    eventGroups,
    general,
    planned: {
      totalCents: eventCents + generalCents,
      eventCents,
      generalCents,
      unrequestedCents: sumCents(lines.filter((l) => !l.lockedBy)),
      bySource: sumBySource(lines),
    },
    requests: termRequests,
    money: requestTotals(requests),
  };
}

/**
 * Terms a club's budget can show: every term it has costs or requests in, plus
 * the current budget term and the next semester (so planning ahead works).
 */
export async function budgetTermOptions(clubId: string, now = new Date()): Promise<{ terms: Term[]; current: Term | null }> {
  const terms = await getTerms();
  const current = budgetTermFor(terms, now);
  const [itemTerms, requestTerms] = await Promise.all([
    db.budgetItem.findMany({ where: { clubId }, distinct: ["termId"], select: { termId: true } }),
    db.fundingRequest.findMany({ where: { clubId }, distinct: ["termId"], select: { termId: true } }),
  ]);
  const ids = new Set([...itemTerms, ...requestTerms].map((r) => r.termId));
  if (current) {
    ids.add(current.id);
    const next = terms.find((t) => t.startsOn > current.endsOn && t.countsForActivity);
    if (next) ids.add(next.id);
  }
  return { terms: terms.filter((t) => ids.has(t.id)), current };
}

/** The term an event's costs are planned in: its next scheduled meeting's, else its latest meeting's. */
export async function budgetTermForEvent(eventId: string, now = new Date()): Promise<string | null> {
  const [next, last, terms] = await Promise.all([
    db.eventOccurrence.findFirst({ where: { eventId, status: "SCHEDULED", startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, select: { startsAt: true } }),
    db.eventOccurrence.findFirst({ where: { eventId, status: "SCHEDULED" }, orderBy: { startsAt: "desc" }, select: { startsAt: true } }),
    getTerms(),
  ]);
  const at = next?.startsAt ?? last?.startsAt;
  if (at) return budgetTermFor(terms, at)?.id ?? null;
  const item = await db.budgetItem.findFirst({ where: { eventId }, select: { termId: true } });
  return item?.termId ?? null;
}

/** Every request a club has made (all terms), newest first. */
export async function listClubRequests(clubId: string) {
  return db.fundingRequest.findMany({ where: { clubId }, include: REQUEST_INCLUDE, orderBy: [{ createdAt: "desc" }] });
}

/** One request with its club, for the club's detail page (caller checks "budget") or the admin page. */
export async function loadFundingRequest(requestId: string) {
  return db.fundingRequest.findUnique({
    where: { id: requestId },
    include: {
      ...REQUEST_INCLUDE,
      club: {
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          status: true,
          logoUrl: true,
          logoColor: true,
          contactEmail: true,
          departmentId: true,
          department: { select: { name: true } },
          college: { select: { name: true } },
        },
      },
    },
  });
}

/** An invoice with everything its PDF shows, if the viewer may see it (admins, or the club's budget holders). */
export async function loadInvoiceForViewer(actor: Actor | null, invoiceId: string) {
  assertSignedIn(actor);
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      createdBy: { select: { name: true } },
      request: {
        include: {
          ...REQUEST_INCLUDE,
          club: { select: { id: true, name: true, slug: true, type: true, contactEmail: true, department: { select: { name: true } }, college: { select: { name: true } } } },
        },
      },
    },
  });
  if (!invoice) throw notFound("Invoice");
  if (!can(actor, "admin.funding")) {
    const access = await getClubAccess(actor, invoice.request.clubId);
    // Not found rather than forbidden, so invoice ids don't reveal anything.
    if (!access?.capabilities.has("budget")) throw notFound("Invoice");
  }
  return invoice;
}

// ─── General costs (the Budget tool's own lines) ─────────────────────────────

const CostFields = {
  termId: id,
  description: z.string({ error: "Describe what the money is for." }).trim().min(1, "Describe what the money is for.").max(200, "Keep the description under 200 characters."),
  category: z.string().trim().min(1, "Pick a category.").max(60, "Keep the category under 60 characters.").default("Supplies"),
  quantity: z.coerce.number({ error: "Enter a quantity." }).positive("The quantity needs to be more than zero.").max(100_000, "Quantities top out at 100,000."),
  /** Dollars (the form's unit); stored as integer cents. */
  unitCost: z.coerce.number({ error: "Enter the cost per item in dollars." }).min(0, "Costs can't be negative.").max(1_000_000, "Each item can cost up to $1,000,000."),
  fundingSource: FUNDING.nullish(),
};
const NewCost = z.object({ clubId: id, ...CostFields });
const EditCost = z.object(CostFields);
export type GeneralCostInput = z.input<typeof NewCost>;

function costData(c: z.output<typeof EditCost>, club: { type: ClubType; departmentId: string | null }) {
  const unitCostCents = dollarsToCents(c.unitCost);
  if (lineCents(c.quantity, unitCostCents) > MAX_LINE_CENTS) throw invalid(`One cost line can be up to ${fmtMoney(MAX_LINE_CENTS)}. Split bigger purchases into separate lines.`);
  return {
    termId: c.termId,
    description: c.description,
    category: c.category,
    quantity: c.quantity,
    unitCostCents,
    perOccurrence: false,
    fundingSource: c.fundingSource ?? defaultFundingSource(club),
  };
}

async function assertTerm(termId: string) {
  const term = await db.term.findUnique({ where: { id: termId }, select: { id: true, name: true } });
  if (!term) throw invalid("Pick a semester from the list.");
  return term;
}

/** A general cost line can't change while a submitted or approved request covers it. */
async function assertNotRequested(itemId: string) {
  const row = await db.fundingRequestItem.findFirst({
    where: { budgetItemId: itemId, request: { status: { in: ACTIVE_REQUEST_STATUSES } } },
    select: { request: { select: { title: true, status: true } } },
  });
  if (row) {
    const where = row.request.status === "SUBMITTED" ? "is being reviewed" : "was approved";
    throw conflict(`This cost is part of “${row.request.title}”, which ${where}, so it's locked to match what you asked for. Add a new line instead.`);
  }
}

async function loadGeneralItem(itemId: string) {
  const item = await db.budgetItem.findUnique({ where: { id: itemId }, include: { club: { select: { id: true, type: true, departmentId: true } } } });
  if (!item) throw notFound("Cost line");
  if (item.eventId) throw invalid("This cost belongs to an event, so it's changed in the Events Builder (the event's Costs section).");
  return item;
}

export async function addBudgetItem(actor: Actor | null, input: unknown) {
  const v = parse(NewCost, input);
  await assertClubCap(actor, v.clubId, "budget");
  const club = await db.club.findUniqueOrThrow({ where: { id: v.clubId }, select: { type: true, departmentId: true } });
  await assertTerm(v.termId);
  const item = await db.budgetItem.create({ data: { ...costData(v, club), clubId: v.clubId, eventId: null, createdById: actor!.id } });
  await logActivity({ actorId: actor!.id, action: "budget.item_added", entityType: "budgetItem", entityId: item.id, clubId: v.clubId, data: { description: item.description, cents: lineCents(item.quantity, item.unitCostCents) } });
  return item;
}

export async function updateBudgetItem(actor: Actor | null, itemId: string, input: unknown) {
  assertSignedIn(actor);
  const item = await loadGeneralItem(itemId);
  await assertClubCap(actor, item.clubId, "budget");
  const v = parse(EditCost, input);
  await assertTerm(v.termId);
  await assertNotRequested(item.id);
  const updated = await db.budgetItem.update({ where: { id: item.id }, data: costData(v, item.club) });
  await logActivity({ actorId: actor.id, action: "budget.item_updated", entityType: "budgetItem", entityId: item.id, clubId: item.clubId, data: { description: updated.description, cents: lineCents(updated.quantity, updated.unitCostCents) } });
  return updated;
}

/** Removes a general cost. Drafts that included it drop the line; submitted snapshots keep their copy. */
export async function removeBudgetItem(actor: Actor | null, itemId: string) {
  assertSignedIn(actor);
  const item = await loadGeneralItem(itemId);
  await assertClubCap(actor, item.clubId, "budget");
  await assertNotRequested(item.id);
  await db.$transaction(async (tx) => {
    await tx.fundingRequestItem.deleteMany({ where: { budgetItemId: item.id, request: { status: "DRAFT" } } });
    await tx.budgetItem.delete({ where: { id: item.id } });
    await logActivity({ actorId: actor.id, action: "budget.item_removed", entityType: "budgetItem", entityId: item.id, clubId: item.clubId, data: { description: item.description } }, tx);
  });
  return { id: item.id };
}

// ─── Funding requests (club side) ────────────────────────────────────────────

const RequestFields = {
  fundingSource: FUNDING,
  title: z.string({ error: "Give the request a short title." }).trim().min(3, "Give the request a short title (at least 3 characters).").max(140, "Keep the title under 140 characters."),
  justification: z
    .string()
    .trim()
    .max(4000, "Keep the explanation under 4,000 characters.")
    .nullish()
    .transform((s) => (s ? s : null)),
  budgetItemIds: z.array(id).max(300, "A request can include up to 300 cost lines.").default([]),
};
const NewRequest = z.object({ clubId: id, termId: id, ...RequestFields });
const EditRequest = z.object(RequestFields);
export type FundingRequestInput = z.input<typeof NewRequest>;

/** Turns chosen line ids into this term's lines, refusing ones another active request already covers. */
function resolveSelection(budget: ClubTermBudget, ids: string[], requestId: string | null) {
  const byId = new Map(budget.lines.map((l) => [l.id, l]));
  const out: BudgetLine[] = [];
  for (const lineId of [...new Set(ids)]) {
    const line = byId.get(lineId);
    if (!line) throw invalid(`One of the cost lines you picked isn't in ${budget.term.name}'s budget anymore — someone may have changed or removed it. Reload and pick again.`);
    if (line.lockedBy && line.lockedBy.id !== requestId) throw conflict(`“${line.description}” is already part of “${line.lockedBy.title}”, so it can't be requested twice.`);
    out.push(line);
  }
  return out;
}

function snapshotRows(lines: BudgetLine[]) {
  // Event lines grouped by event, then general costs — the order the admin reads them in.
  const sorted = [...lines].sort((a, b) => Number(Boolean(b.eventTitle)) - Number(Boolean(a.eventTitle)) || (a.eventTitle ?? "").localeCompare(b.eventTitle ?? ""));
  return sorted.map((l) => ({
    budgetItemId: l.id,
    description: l.description,
    eventTitle: l.eventTitle,
    quantity: l.quantity,
    unitCostCents: l.unitCostCents,
    occurrences: l.occurrences,
    totalCents: l.totalCents,
  }));
}

function assertTotal(total: number) {
  if (total > MAX_REQUEST_CENTS) throw invalid(`One request can ask for up to ${fmtMoney(MAX_REQUEST_CENTS)}. Split it into separate requests.`);
}

/** Starts a DRAFT request for one term and one funding source. */
export async function createFundingRequest(actor: Actor | null, input: unknown) {
  const v = parse(NewRequest, input);
  await assertClubCap(actor, v.clubId, "budget");
  const budget = await loadClubTermBudget(v.clubId, v.termId);
  const lines = resolveSelection(budget, v.budgetItemIds, null);
  const total = sumCents(lines);
  assertTotal(total);
  const request = await db.$transaction(async (tx) => {
    const r = await tx.fundingRequest.create({
      data: {
        clubId: v.clubId,
        termId: v.termId,
        title: v.title,
        justification: v.justification,
        fundingSource: v.fundingSource,
        amountRequestedCents: total,
        status: "DRAFT",
        submittedById: actor!.id,
        items: { create: snapshotRows(lines) },
      },
    });
    await logActivity({ actorId: actor!.id, action: "funding.draft_created", entityType: "fundingRequest", entityId: r.id, clubId: v.clubId, data: { title: v.title, cents: total } }, tx);
    return r;
  });
  return { id: request.id };
}

async function loadClubRequest(actor: Actor | null, requestId: string) {
  assertSignedIn(actor);
  const request = await db.fundingRequest.findUnique({ where: { id: requestId }, include: { club: { select: { id: true, name: true, slug: true, department: { select: { name: true } }, college: { select: { name: true } } } }, term: true, items: true } });
  if (!request) throw notFound("Funding request");
  await assertClubCap(actor, request.clubId, "budget");
  return request;
}

/** Edits a draft (its term stays fixed — start a new request for another semester). */
export async function updateFundingRequest(actor: Actor | null, requestId: string, input: unknown) {
  const request = await loadClubRequest(actor, requestId);
  if (request.status !== "DRAFT") throw conflict("Only drafts can be changed. This request was already submitted.");
  const v = parse(EditRequest, input);
  const budget = await loadClubTermBudget(request.clubId, request.termId);
  const lines = resolveSelection(budget, v.budgetItemIds, request.id);
  const total = sumCents(lines);
  assertTotal(total);
  await db.$transaction(async (tx) => {
    const claimed = await tx.fundingRequest.updateMany({
      where: { id: request.id, status: "DRAFT" },
      data: { title: v.title, justification: v.justification, fundingSource: v.fundingSource, amountRequestedCents: total },
    });
    if (!claimed.count) throw conflict("Only drafts can be changed. Someone just submitted this request.");
    await tx.fundingRequestItem.deleteMany({ where: { requestId: request.id } });
    await tx.fundingRequestItem.createMany({ data: snapshotRows(lines).map((row) => ({ ...row, requestId: request.id })) });
    await logActivity({ actorId: actor!.id, action: "funding.draft_updated", entityType: "fundingRequest", entityId: request.id, clubId: request.clubId, data: { title: v.title, cents: total } }, tx);
  });
  return { id: request.id };
}

/** Throws away a draft. Submitted requests are withdrawn instead, so their history stays. */
export async function discardFundingDraft(actor: Actor | null, requestId: string) {
  const request = await loadClubRequest(actor, requestId);
  if (request.status !== "DRAFT") throw conflict("Only drafts can be discarded. Withdraw a submitted request instead.");
  await db.$transaction(async (tx) => {
    const gone = await tx.fundingRequest.deleteMany({ where: { id: request.id, status: "DRAFT" } });
    if (!gone.count) throw conflict("This draft was just submitted, so it can't be discarded.");
    await logActivity({ actorId: actor!.id, action: "funding.draft_discarded", entityType: "fundingRequest", entityId: request.id, clubId: request.clubId, data: { title: request.title } }, tx);
  });
  return { id: request.id };
}

/**
 * Sends a draft for review: re-reads its lines from the live budget, snapshots
 * them (meetings in the term × one set), and opens the admins' approval task.
 */
export async function submitFundingRequest(actor: Actor | null, requestId: string) {
  const request = await loadClubRequest(actor, requestId);
  if (request.status !== "DRAFT") throw conflict("This request was already submitted.");
  if ((request.justification ?? "").trim().length < MIN_JUSTIFICATION)
    throw invalid("Add a sentence or two about what this money is for and who it helps — WSUSA reads that first.");
  const budget = await loadClubTermBudget(request.clubId, request.termId);
  const chosen = request.items.map((i) => i.budgetItemId);
  if (chosen.some((x) => !x)) throw invalid("Some lines in this draft were removed from the budget after you saved it. Check the lines and save the draft again before submitting.");
  const lines = resolveSelection(budget, chosen as string[], request.id);
  if (!lines.length) throw invalid("Pick at least one cost line to request.");
  const total = sumCents(lines);
  if (total <= 0) throw invalid("The lines you picked add up to $0.00. Add the costs before asking for money.");
  assertTotal(total);

  const now = new Date();
  const club = request.club;
  const source = sourceName(request.fundingSource, club);
  await db.$transaction(async (tx) => {
    const claimed = await tx.fundingRequest.updateMany({
      where: { id: request.id, status: "DRAFT" },
      data: { status: "SUBMITTED", submittedAt: now, submittedById: actor!.id, amountRequestedCents: total },
    });
    if (!claimed.count) throw conflict("This request was already submitted.");
    await tx.fundingRequestItem.deleteMany({ where: { requestId: request.id } });
    await tx.fundingRequestItem.createMany({ data: snapshotRows(lines).map((row) => ({ ...row, requestId: request.id })) });
    await createTask(
      {
        kind: "APPROVAL",
        title: `Funding request from ${club.name}: ${request.title}`,
        description: `${fmtMoney(total)} requested from ${source} for ${request.term.name}.`,
        assignee: { type: "ADMINS" },
        clubId: club.id,
        href: `/admin/funding/${request.id}`,
        source: { type: "funding", id: request.id },
        createdById: actor!.id,
      },
      tx,
    );
    await logActivity({ actorId: actor!.id, action: "funding.submitted", entityType: "fundingRequest", entityId: request.id, clubId: club.id, data: { title: request.title, cents: total, source: request.fundingSource } }, tx);
  });

  const cfg = await getConfig();
  await notifyAdmins({
    kind: "funding.submitted",
    title: `Funding request: ${club.name} — ${request.title}`,
    body: `${fmtMoney(total)} requested from ${source} for ${request.term.name}.`,
    href: `/admin/funding/${request.id}`,
  });
  await notifyClubCapability(club.id, "budget", {
    kind: "funding.submitted",
    title: `Funding request submitted: ${request.title}`,
    body: `${actor!.name} asked ${source} for ${fmtMoney(total)}. WSUSA usually responds within about ${cfg["wsusa.office"].reviewDays} business days.`,
    href: `/clubs/${club.slug}/manage/budget/requests/${request.id}`,
    exceptUserId: actor!.id,
    email: false,
  });
  return { id: request.id, amountRequestedCents: total };
}

const Withdraw = z.object({ reason: z.string().trim().max(1000, "Keep the reason under 1,000 characters.").nullish() });

/** Pulls a submitted request back before WSUSA decides. Its lines can be requested again. */
export async function withdrawFundingRequest(actor: Actor | null, requestId: string, input: unknown = {}) {
  const request = await loadClubRequest(actor, requestId);
  if (request.status !== "SUBMITTED") throw conflict(request.status === "DRAFT" ? "This request hasn't been submitted yet — discard the draft instead." : "WSUSA already decided this request, so it can't be withdrawn.");
  const v = parse(Withdraw, input ?? {});
  await db.$transaction(async (tx) => {
    const claimed = await tx.fundingRequest.updateMany({ where: { id: request.id, status: "SUBMITTED" }, data: { status: "WITHDRAWN", decidedAt: new Date(), decidedById: null, decisionNote: v.reason || null } });
    if (!claimed.count) throw conflict("WSUSA just decided this request, so it can't be withdrawn.");
    await resolveTasks("funding", request.id, actor!.id, tx, "CANCELLED");
    await logActivity({ actorId: actor!.id, action: "funding.withdrawn", entityType: "fundingRequest", entityId: request.id, clubId: request.clubId, data: { title: request.title, reason: v.reason ?? null } }, tx);
  });
  await notifyAdmins({ kind: "funding.withdrawn", title: `${request.club.name} withdrew “${request.title}”`, body: v.reason || undefined, href: `/admin/funding/${request.id}`, email: false, push: false });
  return { id: request.id };
}

// ─── Decisions & invoices (admin side) ───────────────────────────────────────

const Decision = z.object({
  requestId: id,
  decision: z.enum(["APPROVE", "PARTIAL", "DENY"], { error: "Choose approve, partly approve or deny." }),
  /** Dollars, for a partial approval. */
  amount: z.coerce.number({ error: "Enter the amount you're approving." }).min(0).max(MAX_REQUEST_CENTS / 100).nullish(),
  note: z
    .string()
    .trim()
    .max(2000, "Keep the note under 2,000 characters.")
    .nullish()
    .transform((s) => (s ? s : null)),
});
export type FundingDecisionInput = z.input<typeof Decision>;

const DECIDED: Record<"APPROVE" | "PARTIAL" | "DENY", FundingStatus> = { APPROVE: "APPROVED", PARTIAL: "PARTIALLY_APPROVED", DENY: "DENIED" };

export async function decideFundingRequest(actor: Actor | null, input: unknown) {
  assertCan(actor, "admin.funding");
  const v = parse(Decision, input);
  const request = await loadFundingRequest(v.requestId);
  if (!request) throw notFound("Funding request");
  if (request.status !== "SUBMITTED") throw conflict("This request isn't waiting for a decision — someone may have decided it already, or the club withdrew it.");

  let approved: number | null = null;
  if (v.decision === "APPROVE") approved = request.amountRequestedCents;
  if (v.decision === "PARTIAL") {
    approved = dollarsToCents(v.amount ?? 0);
    const problem = partialAmountProblem(request.amountRequestedCents, approved);
    if (problem) throw invalid(problem);
  }
  if (v.decision !== "APPROVE" && (v.note ?? "").length < 3) throw invalid(v.decision === "DENY" ? "Tell the club why, so they know what to change or where else to look." : "Tell the club what's covered and why the rest isn't.");

  const status = DECIDED[v.decision];
  const now = new Date();
  await db.$transaction(async (tx) => {
    const claimed = await tx.fundingRequest.updateMany({
      where: { id: request.id, status: "SUBMITTED" },
      data: { status, amountApprovedCents: approved, decidedById: actor.id, decidedAt: now, decisionNote: v.note },
    });
    if (!claimed.count) throw conflict("Someone just decided this request, or the club withdrew it.");
    await resolveTasks("funding", request.id, actor.id, tx);
    await logActivity({ actorId: actor.id, action: `funding.${status.toLowerCase()}`, entityType: "fundingRequest", entityId: request.id, clubId: request.clubId, data: { requested: request.amountRequestedCents, cents: approved ?? 0 } }, tx);
  });

  const title =
    v.decision === "APPROVE" ? `Funding approved: ${request.title}` : v.decision === "PARTIAL" ? `Funding partly approved: ${request.title}` : `Funding not approved: ${request.title}`;
  const lead =
    v.decision === "APPROVE"
      ? `WSUSA approved the full ${fmtMoney(approved!)}.`
      : v.decision === "PARTIAL"
        ? `WSUSA approved ${fmtMoney(approved!)} of the ${fmtMoney(request.amountRequestedCents)} requested.`
        : `WSUSA didn't approve the ${fmtMoney(request.amountRequestedCents)} requested.`;
  await notifyClubCapability(request.clubId, "budget", {
    kind: `funding.${status.toLowerCase()}`,
    title,
    body: v.note ? `${lead} ${v.note}` : lead,
    href: `/clubs/${request.club.slug}/manage/budget/requests/${request.id}`,
  });
  return { status, amountApprovedCents: approved };
}

/** Campus calendar year, so an invoice made late on Dec 31 isn't numbered for the next year. */
const campusYear = (d: Date) => Number(fmtDate(d, "yyyy"));

/**
 * Creates the request's invoice (one per request) for the approved amount, with
 * the next WC-<year>-<seq> number, and opens the admins' INVOICE task to make
 * sure the money moves in the university finance system.
 */
export async function createInvoice(actor: Actor | null, requestId: string) {
  assertCan(actor, "admin.funding");
  const request = await loadFundingRequest(requestId);
  if (!request) throw notFound("Funding request");
  if (request.status !== "APPROVED" && request.status !== "PARTIALLY_APPROVED") throw invalid("Only approved requests get an invoice.");
  const amount = request.amountApprovedCents ?? 0;
  if (amount <= 0) throw invalid("This request has no approved amount to invoice.");

  const year = campusYear(new Date());
  for (let attempt = 0; ; attempt++) {
    try {
      const invoice = await db.$transaction(async (tx) => {
        // Lock the request row so two admins can't both create its invoice.
        await tx.$queryRaw`SELECT id FROM "FundingRequest" WHERE id = ${request.id} FOR UPDATE`;
        const existing = await tx.invoice.findFirst({ where: { requestId: request.id }, select: { number: true } });
        if (existing) throw conflict(`This request already has invoice ${existing.number}.`);
        const used = await tx.invoice.findMany({ where: { number: { startsWith: `WC-${year}-` } }, select: { number: true } });
        const number = nextInvoiceNumber(
          used.map((u) => u.number),
          year,
        );
        const inv = await tx.invoice.create({ data: { number, requestId: request.id, amountCents: amount, createdById: actor.id } });
        await createTask(
          {
            kind: "INVOICE",
            title: `Make sure funding for ${request.club.name} — ${request.title} goes through in the university finance system`,
            description: `Invoice ${number} · ${fmtMoney(amount)} from ${sourceName(request.fundingSource, request.club)}. Mark the invoice processed once the transfer shows up.`,
            assignee: { type: "ADMINS" },
            clubId: request.clubId,
            href: `/admin/funding/${request.id}`,
            dueAt: new Date(Date.now() + 10 * DAY_MS),
            source: { type: "invoice", id: inv.id },
            createdById: actor.id,
          },
          tx,
        );
        await logActivity({ actorId: actor.id, action: "invoice.created", entityType: "invoice", entityId: inv.id, clubId: request.clubId, data: { number, cents: amount, requestId: request.id } }, tx);
        return inv;
      });
      // In-app only: the club can download the invoice now; the email comes when the money goes through.
      await notifyClubCapability(request.clubId, "budget", {
        kind: "invoice.created",
        title: `Invoice ${invoice.number} is ready`,
        body: `WSUSA created the invoice for “${request.title}” (${fmtMoney(amount)}) and is sending it through the university finance system.`,
        href: `/clubs/${request.club.slug}/manage/budget/requests/${request.id}`,
        email: false,
        push: false,
      });
      return { id: invoice.id, number: invoice.number };
    } catch (e) {
      // Another invoice took the number between our read and write: try the next one.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) continue;
      throw e;
    }
  }
}

/** The money went through in the university finance system: close the invoice and its task, tell the club. */
export async function markInvoiceProcessed(actor: Actor | null, invoiceId: string) {
  assertCan(actor, "admin.funding");
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { request: { select: { id: true, title: true, clubId: true, club: { select: { slug: true } } } } } });
  if (!invoice) throw notFound("Invoice");
  await db.$transaction(async (tx) => {
    const claimed = await tx.invoice.updateMany({ where: { id: invoice.id, status: "OPEN" }, data: { status: "PROCESSED", processedAt: new Date() } });
    if (!claimed.count) throw conflict(`Invoice ${invoice.number} is already marked processed.`);
    await resolveTasks("invoice", invoice.id, actor.id, tx);
    await logActivity({ actorId: actor.id, action: "invoice.processed", entityType: "invoice", entityId: invoice.id, clubId: invoice.request.clubId, data: { number: invoice.number, cents: invoice.amountCents } }, tx);
  });
  await notifyClubCapability(invoice.request.clubId, "budget", {
    kind: "invoice.processed",
    title: `Funding for ${invoice.request.title} went through`,
    body: `${fmtMoney(invoice.amountCents)} was processed in the university finance system (invoice ${invoice.number}). Keep your receipts for WSUSA.`,
    href: `/clubs/${invoice.request.club.slug}/manage/budget/requests/${invoice.request.id}`,
  });
  return { id: invoice.id };
}

// ─── Admin reads ─────────────────────────────────────────────────────────────

/** Approved requests whose money hasn't gone through yet: no invoice, or an open one. */
const INVOICE_PENDING: Prisma.FundingRequestWhereInput = {
  status: { in: ["APPROVED", "PARTIALLY_APPROVED"] },
  OR: [{ invoices: { none: {} } }, { invoices: { some: { status: "OPEN" } } }],
};

export type AdminQueue = "submitted" | "approved" | "all";

/** The admin funding queue. Drafts are the club's own work and never show here. */
export async function adminFundingQueue(actor: Actor | null, opts: { queue: AdminQueue; source?: FundingSource | null; clubId?: string | null; take?: number }) {
  assertCan(actor, "admin.funding");
  const where: Prisma.FundingRequestWhereInput = {
    status: opts.queue === "submitted" ? "SUBMITTED" : opts.queue === "approved" ? { in: ["APPROVED", "PARTIALLY_APPROVED"] } : { not: "DRAFT" },
    ...(opts.queue === "approved" ? { OR: INVOICE_PENDING.OR } : {}),
    ...(opts.source ? { fundingSource: opts.source } : {}),
    ...(opts.clubId ? { clubId: opts.clubId } : {}),
  };
  const orderBy: Prisma.FundingRequestOrderByWithRelationInput[] =
    opts.queue === "submitted" ? [{ submittedAt: "asc" }] : opts.queue === "approved" ? [{ decidedAt: "asc" }] : [{ submittedAt: { sort: "desc", nulls: "last" } }];
  const [rows, total] = await Promise.all([
    db.fundingRequest.findMany({
      where,
      orderBy,
      take: opts.take ?? 100,
      include: {
        club: { select: { id: true, name: true, slug: true, logoUrl: true, logoColor: true, department: { select: { name: true } }, college: { select: { name: true } } } },
        term: { select: { name: true } },
        invoices: { select: { id: true, number: true, status: true, createdAt: true } },
        _count: { select: { items: true } },
      },
    }),
    db.fundingRequest.count({ where }),
  ]);
  return { rows, total };
}

/** Counts for the queue tabs. */
export async function adminFundingCounts() {
  const [submitted, approved] = await Promise.all([db.fundingRequest.count({ where: { status: "SUBMITTED" } }), db.fundingRequest.count({ where: INVOICE_PENDING })]);
  return { submitted, approved };
}

/**
 * The admin funding page's headline numbers: what's waiting on a decision,
 * what's approved but not yet through the finance system, and what was
 * approved for the current budget semester.
 */
export async function adminFundingOverview(actor: Actor | null, now = new Date()) {
  assertCan(actor, "admin.funding");
  const terms = await getTerms();
  const term = budgetTermFor(terms, now);
  const [waiting, oldest, needsInvoice, openInvoices, approvedThisTerm] = await Promise.all([
    db.fundingRequest.aggregate({ where: { status: "SUBMITTED" }, _count: { _all: true }, _sum: { amountRequestedCents: true } }),
    db.fundingRequest.findFirst({ where: { status: "SUBMITTED" }, orderBy: { submittedAt: "asc" }, select: { submittedAt: true } }),
    db.fundingRequest.count({ where: { status: { in: ["APPROVED", "PARTIALLY_APPROVED"] }, invoices: { none: {} } } }),
    db.invoice.aggregate({ where: { status: "OPEN" }, _count: { _all: true }, _sum: { amountCents: true } }),
    term
      ? db.fundingRequest.aggregate({ where: { termId: term.id, status: { in: ["APPROVED", "PARTIALLY_APPROVED"] } }, _count: { _all: true }, _sum: { amountApprovedCents: true } })
      : null,
  ]);
  return {
    waiting: { count: waiting._count._all, cents: waiting._sum.amountRequestedCents ?? 0, oldestSubmittedAt: oldest?.submittedAt ?? null },
    needsInvoice,
    openInvoices: { count: openInvoices._count._all, cents: openInvoices._sum.amountCents ?? 0 },
    approvedThisTerm: term ? { termName: term.name, count: approvedThisTerm?._count._all ?? 0, cents: approvedThisTerm?._sum.amountApprovedCents ?? 0 } : null,
  };
}

/** Clubs that have ever sent a request (for the admin club filter). */
export async function clubsWithRequests() {
  return db.club.findMany({ where: { fundingRequests: { some: { status: { not: "DRAFT" } } } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** The club's other requests, newest first (the admin detail page's history). */
export async function priorRequests(clubId: string, exceptId: string) {
  return db.fundingRequest.findMany({
    where: { clubId, id: { not: exceptId }, status: { not: "DRAFT" } },
    orderBy: { submittedAt: { sort: "desc", nulls: "last" } },
    take: 12,
    select: { id: true, title: true, status: true, fundingSource: true, amountRequestedCents: true, amountApprovedCents: true, submittedAt: true, term: { select: { name: true } } },
  });
}
