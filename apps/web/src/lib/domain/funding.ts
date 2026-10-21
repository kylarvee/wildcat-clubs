import "server-only";
import { Prisma, type ClubType, type FundingSource, type FundingStatus, type Term } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { adminFundingClubWhere, adminScope, canAdminFunding, getClubAccess } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { assertCan, assertClubCap, assertSignedIn, conflict, invalid, notFound, parse } from "@/lib/domain/kit";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { notifyClubCapability } from "@/lib/domain/notify";
import { costLineLocks, eventCostSummaries } from "@/lib/domain/events";
import { fundingOfficeForClub, listOffices, notifyOffice } from "@/lib/offices";
import { storedOfficeId } from "@/lib/offices/rules";
import { budgetTermFor, getTerms } from "@/lib/terms";
import { DAY_MS, fmtDate, fmtMoney } from "@/lib/time";
import { defaultFundingSource } from "@/lib/funding/defaults";
import { plural, sourceName } from "@/lib/funding/labels";
import { grantedCents, lineStanding, type CoveringLine } from "@/lib/funding/locks";
import { INVOICE_DUE_DAYS, fundingTasks } from "@/lib/funding/review";
import {
  ACTIVE_REQUEST_STATUSES,
  MAX_LINE_CENTS,
  MAX_REQUEST_CENTS,
  MIN_JUSTIFICATION,
  decideLines,
  dollarsToCents,
  lineCents,
  nextInvoiceNumber,
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
 * A funding request asks for money in one term from the source the club
 * expects (`fundingSource`, "Expected source"). WSUSA reviews every request
 * and records the source that actually funds it (`fundedSource`). It's built
 * from cost lines; on submission each line is snapshotted into
 * FundingRequestItem (occurrences in that term × one set, less anything
 * already funded), so later edits never rewrite history.
 *
 * WSUSA decides line by line (`approvedCents`; the request's approved amount
 * is their sum). Locks follow lib/funding/locks: a line in review or funded in
 * full stays locked; one funded for less lets go, so the club can ask another
 * source for the rest.
 *
 * Who may act: the club's "budget" capability for club actions (only APPROVED
 * clubs have it), `admin.funding` for decisions and invoices.
 *
 * Tasks: submitting opens an ADMINS approval task (sourceType "funding");
 * deciding or withdrawing closes it. Approving creates the invoice in the same
 * step, with an ADMINS INVOICE task (sourceType "invoice", due in
 * INVOICE_DUE_DAYS) that closes when the invoice is marked processed. The
 * "Funding follow-ups" job (lib/jobs/funding) reminds WSUSA about both when
 * they run late.
 */

// ─── Shapes ──────────────────────────────────────────────────────────────────

const FUNDING = z.enum(["UNIVERSITY", "WSUSA", "COLLEGE", "DEPARTMENT"], { error: "Pick a funding source from the list." });
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
  /** The request holding this line locked this term (lib/funding/locks): in WSUSA review, or funded in full. */
  lockedBy: { id: string; title: string; status: FundingStatus } | null;
  /** WSUSA's decisions on this line in approved requests this term, oldest first. */
  decisions: { id: string; title: string; askedCents: number; approvedCents: number }[];
  /** What approved requests granted for it this term. */
  fundedCents: number;
  /** What a new request would ask for: its cost this term minus what's funded (0 while locked). */
  openCents: number;
  /** A new request may include it (unlocked, and not already funded in full). */
  requestable: boolean;
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
  /** Drafts: what the chosen lines would ask for right now. Others: the submitted amount. */
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

type Covering = CoveringLine & { request: { id: string; title: string; status: FundingStatus; decidedAt: Date | null } };

/** Every submitted or approved request line covering each cost line, by line id (this term's requests only). */
function coverageMap(requests: FundingRequestRow[]) {
  const map = new Map<string, Covering[]>();
  for (const r of requests) {
    if (!ACTIVE_REQUEST_STATUSES.includes(r.status)) continue;
    for (const i of r.items) {
      if (!i.budgetItemId) continue;
      const list = map.get(i.budgetItemId) ?? [];
      list.push({ status: r.status, totalCents: i.totalCents, approvedCents: i.approvedCents, request: { id: r.id, title: r.title, status: r.status, decidedAt: r.decidedAt } });
      map.set(i.budgetItemId, list);
    }
  }
  return map;
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
  const coverage = coverageMap(requests);

  const lines: BudgetLine[] = [];
  for (const i of items) {
    const t = termLineTotal(i, termId, i.eventId ? meetingsIn(i.eventId, termId) : 0);
    if (t.occurrences === 0) continue;
    const covering = coverage.get(i.id) ?? [];
    const standing = lineStanding(t.totalCents, covering);
    const decisions = covering
      .filter((c) => c.status !== "SUBMITTED")
      .sort((a, b) => (a.request.decidedAt?.getTime() ?? 0) - (b.request.decidedAt?.getTime() ?? 0))
      .map((c) => ({ id: c.request.id, title: c.request.title, askedCents: c.totalCents, approvedCents: grantedCents(c) }));
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
      lockedBy: standing.lockedBy ? { id: standing.lockedBy.request.id, title: standing.lockedBy.request.title, status: standing.lockedBy.request.status } : null,
      decisions,
      fundedCents: standing.fundedCents,
      openCents: standing.openCents,
      requestable: standing.requestable,
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
    return { ...r, liveCents: chosen.reduce((s, l) => s + (l?.openCents ?? 0), 0), staleLines: chosen.filter((l) => !l).length };
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
      // Lines no request covers yet, plus whatever WSUSA didn't fund.
      unrequestedCents: lines.reduce((s, l) => s + l.openCents, 0),
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
          officeId: true,
          department: { select: { name: true } },
          college: { select: { name: true } },
        },
      },
    },
  });
}

/** An invoice with everything its PDF shows, if the viewer may see it (the admins who decide the club's funding, or its budget holders). */
export async function loadInvoiceForViewer(actor: Actor | null, invoiceId: string) {
  assertSignedIn(actor);
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      createdBy: { select: { name: true } },
      request: {
        include: {
          ...REQUEST_INCLUDE,
          club: { select: { id: true, name: true, slug: true, type: true, contactEmail: true, officeId: true, department: { select: { name: true } }, college: { select: { name: true } } } },
        },
      },
    },
  });
  if (!invoice) throw notFound("Invoice");
  if (!canAdminFunding(actor, invoice.request.club)) {
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

/**
 * A general cost line can't change while a request holds it: in WSUSA review,
 * or funded in full. One lock rule for every cost line, general or event
 * (lib/funding/locks, through costLineLocks).
 */
async function assertNotRequested(itemId: string) {
  const lock = (await costLineLocks([itemId])).get(itemId);
  if (lock) {
    const where = lock.status === "SUBMITTED" ? "is being reviewed" : "WSUSA funded in full";
    throw conflict(`This cost is part of “${lock.title}”, which ${where}, so it's locked to match what you asked for. Add a new line instead.`);
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
  /** The source the club expects ("Expected source"). WSUSA may fund it from another. */
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

/** Turns chosen line ids into this term's lines, refusing ones a request holds or that are already funded in full. */
function resolveSelection(budget: ClubTermBudget, ids: string[], requestId: string | null) {
  const byId = new Map(budget.lines.map((l) => [l.id, l]));
  const out: BudgetLine[] = [];
  for (const lineId of [...new Set(ids)]) {
    const line = byId.get(lineId);
    if (!line) throw invalid(`One of the cost lines you picked isn't in ${budget.term.name}'s budget anymore — someone may have changed or removed it. Reload and pick again.`);
    if (line.lockedBy && line.lockedBy.id !== requestId) throw conflict(`“${line.description}” is already part of “${line.lockedBy.title}”, so it can't be requested twice.`);
    if (!line.lockedBy && !line.requestable) throw conflict(`“${line.description}” is already funded in full, so there's nothing left to ask for.`);
    out.push(line);
  }
  return out;
}

/** What the chosen lines ask for: each line's cost less what's already funded. */
const askedCents = (lines: BudgetLine[]) => lines.reduce((s, l) => s + l.openCents, 0);

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
    // A line funded in part before asks only for the rest (earlierFundedCents() reads the difference back).
    totalCents: l.openCents,
  }));
}

function assertTotal(total: number) {
  if (total > MAX_REQUEST_CENTS) throw invalid(`One request can ask for up to ${fmtMoney(MAX_REQUEST_CENTS)}. Split it into separate requests.`);
}

/** Starts a DRAFT request for one term, with the source the club expects. */
export async function createFundingRequest(actor: Actor | null, input: unknown) {
  const v = parse(NewRequest, input);
  await assertClubCap(actor, v.clubId, "budget");
  const budget = await loadClubTermBudget(v.clubId, v.termId);
  const lines = resolveSelection(budget, v.budgetItemIds, null);
  const total = askedCents(lines);
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
  const total = askedCents(lines);
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
 * them (meetings in the term × one set), and opens the approval task for the
 * office that decides the club's funding (its own office when that office
 * decides funding, else WSUSA: lib/offices/rules routeAdminTask).
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
  const total = askedCents(lines);
  if (total <= 0) throw invalid("The lines you picked add up to $0.00. Add the costs before asking for money.");
  assertTotal(total);

  const now = new Date();
  const club = request.club;
  const source = sourceName(request.fundingSource, club);
  const office = await fundingOfficeForClub(club.id);
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
        description: `${fmtMoney(total)} for ${request.term.name}. The club expects it from ${source}; record the source that funds it when you approve.`,
        // Routed to the office that decides the club's funding.
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

  await notifyOffice(
    { officeId: storedOfficeId(office) },
    {
      kind: "funding.submitted",
      title: `Funding request: ${club.name} — ${request.title}`,
      body: `${fmtMoney(total)} for ${request.term.name}, expected from ${source}.`,
      href: `/admin/funding/${request.id}`,
    },
  );
  await notifyClubCapability(club.id, "budget", {
    kind: "funding.submitted",
    title: `Funding request submitted: ${request.title}`,
    body: `${actor!.name} sent it to ${office.name} for ${fmtMoney(total)}, expected from ${source}. ${office.name} reviews every request, usually within about ${office.reviewDays} business days, and may fund it from another source.`,
    href: `/clubs/${club.slug}/manage/budget/requests/${request.id}`,
    exceptUserId: actor!.id,
  });
  return { id: request.id, amountRequestedCents: total };
}

const Withdraw = z.object({ reason: z.string().trim().max(1000, "Keep the reason under 1,000 characters.").nullish() });

/** Pulls a submitted request back before WSUSA decides. Its lines can be requested again. */
export async function withdrawFundingRequest(actor: Actor | null, requestId: string, input: unknown = {}) {
  const request = await loadClubRequest(actor, requestId);
  const office = await fundingOfficeForClub(request.clubId);
  if (request.status !== "SUBMITTED") throw conflict(request.status === "DRAFT" ? "This request hasn't been submitted yet — discard the draft instead." : `${office.name} already decided this request, so it can't be withdrawn.`);
  const v = parse(Withdraw, input ?? {});
  // Whoever has the task (its office may have changed since it was submitted).
  const task = await db.task.findFirst({ where: { sourceType: "funding", sourceId: request.id, status: "OPEN", assigneeType: "ADMINS" }, select: { officeId: true } });
  await db.$transaction(async (tx) => {
    const claimed = await tx.fundingRequest.updateMany({ where: { id: request.id, status: "SUBMITTED" }, data: { status: "WITHDRAWN", decidedAt: new Date(), decidedById: null, decisionNote: v.reason || null } });
    if (!claimed.count) throw conflict(`${office.name} just decided this request, so it can't be withdrawn.`);
    await resolveTasks("funding", request.id, actor!.id, tx, "CANCELLED");
    await logActivity({ actorId: actor!.id, action: "funding.withdrawn", entityType: "fundingRequest", entityId: request.id, clubId: request.clubId, data: { title: request.title, reason: v.reason ?? null } }, tx);
  });
  await notifyOffice({ officeId: task ? task.officeId : storedOfficeId(office) }, { kind: "funding.withdrawn", title: `${request.club.name} withdrew “${request.title}”`, body: v.reason || undefined, href: `/admin/funding/${request.id}` });
  return { id: request.id };
}

// ─── Decisions & invoices (admin side) ───────────────────────────────────────

const Decision = z.object({
  requestId: id,
  decision: z.enum(["APPROVE", "DENY"], { error: "Choose approve or don't approve." }),
  /**
   * Approvals: dollars approved per request line (the FundingRequestItem id).
   * Lines left out get their full total; any line that gets less makes it a
   * partial approval.
   */
  lines: z
    .record(z.string().trim().min(1).max(64), z.coerce.number({ error: "Enter each line's approved amount in dollars." }).min(0, "Approved amounts can't be negative.").max(MAX_REQUEST_CENTS / 100))
    .nullish(),
  /** Approvals: the source that funds it ("Funded by"). Defaults to the source the club expects. */
  fundedSource: FUNDING.nullish(),
  note: z
    .string()
    .trim()
    .max(2000, "Keep the note under 2,000 characters.")
    .nullish()
    .transform((s) => (s ? s : null)),
});
export type FundingDecisionInput = z.input<typeof Decision>;

/** Campus calendar year, so an invoice made late on Dec 31 isn't numbered for the next year. */
const campusYear = (d: Date) => Number(fmtDate(d, "yyyy"));

/** Writes WSUSA's line-by-line decision: every line's approved cents (0 for all of a denial). */
async function recordLineDecisions(tx: Tx, requestId: string, lines: { id: string; totalCents: number; approvedCents: number }[] | null) {
  if (!lines) {
    await tx.fundingRequestItem.updateMany({ where: { requestId }, data: { approvedCents: 0 } });
    return;
  }
  await tx.$executeRaw`UPDATE "FundingRequestItem" SET "approvedCents" = "totalCents" WHERE "requestId" = ${requestId}`;
  for (const l of lines) if (l.approvedCents < l.totalCents) await tx.fundingRequestItem.update({ where: { id: l.id }, data: { approvedCents: l.approvedCents } });
}

/**
 * The approved request's invoice (one per request, made in the approval's
 * transaction): the next WC-<year>-<seq> number, and the admins' INVOICE task
 * to make sure the money moves in the university finance system.
 */
async function openInvoice(
  tx: Tx,
  r: { requestId: string; clubId: string; clubName: string; title: string; cents: number; source: string; actorId: string; at: Date },
) {
  const year = campusYear(r.at);
  const used = await tx.invoice.findMany({ where: { number: { startsWith: `WC-${year}-` } }, select: { number: true } });
  const number = nextInvoiceNumber(
    used.map((u) => u.number),
    year,
  );
  const inv = await tx.invoice.create({ data: { number, requestId: r.requestId, amountCents: r.cents, createdById: r.actorId, createdAt: r.at } });
  await createTask(
    {
      kind: "INVOICE",
      title: `Make sure funding for ${r.clubName} — ${r.title} goes through in the university finance system`,
      description: `Invoice ${number} · ${fmtMoney(r.cents)}, funded by ${r.source}. Mark the invoice processed once the transfer shows up.`,
      assignee: { type: "ADMINS" },
      clubId: r.clubId,
      href: `/admin/funding/${r.requestId}`,
      dueAt: new Date(r.at.getTime() + INVOICE_DUE_DAYS * DAY_MS),
      source: { type: "invoice", id: inv.id },
      createdById: r.actorId,
    },
    tx,
  );
  await logActivity({ actorId: r.actorId, action: "invoice.created", entityType: "invoice", entityId: inv.id, clubId: r.clubId, data: { number, cents: r.cents, requestId: r.requestId } }, tx);
  return { id: inv.id, number };
}

/**
 * WSUSA's decision on a submitted request: approve it (every line in full, or
 * some lines for less: a partial approval), or don't. An approval records the
 * source that funds it and creates the invoice and its INVOICE task in the
 * same step. Lines approved for less than they asked (and every line of a
 * request that isn't approved) unlock, so the club can ask another source.
 */
export async function decideFundingRequest(actor: Actor | null, input: unknown) {
  assertCan(actor, "admin.funding");
  const v = parse(Decision, input);
  const request = await loadFundingRequest(v.requestId);
  // Office staff decide only their own office's clubs' requests (lib/authz canAdminFunding).
  if (!request || !canAdminFunding(actor, request.club)) throw notFound("Funding request");
  const office = await fundingOfficeForClub(request.clubId);
  if (request.status !== "SUBMITTED") throw conflict("This request isn't waiting for a decision — someone may have decided it already, or the club withdrew it.");

  let status: FundingStatus = "DENIED";
  let approved: number | null = null;
  let lines: { id: string; totalCents: number; approvedCents: number }[] | null = null;
  let reduced = 0;
  if (v.decision === "APPROVE") {
    const amounts = Object.fromEntries(Object.entries(v.lines ?? {}).map(([lineId, dollars]) => [lineId, dollarsToCents(dollars)]));
    const d = decideLines(request.items, amounts);
    if (!d.ok) throw invalid(d.problem);
    ({ status, approvedCents: approved, lines, reduced } = d);
  }
  if (status !== "APPROVED" && (v.note ?? "").length < 3)
    throw invalid(status === "DENIED" ? "Tell the club why, so they know what to change or where else to look." : "Tell the club what's covered and why the rest isn't.");
  const fundedSource: FundingSource | null = status === "DENIED" ? null : (v.fundedSource ?? request.fundingSource);
  const fundedBy = fundedSource ? sourceName(fundedSource, request.club) : null;

  const now = new Date();
  let invoice: { id: string; number: string } | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      invoice = await db.$transaction(async (tx) => {
        const claimed = await tx.fundingRequest.updateMany({
          where: { id: request.id, status: "SUBMITTED" },
          data: { status, amountApprovedCents: approved, fundedSource, decidedById: actor.id, decidedAt: now, decisionNote: v.note },
        });
        if (!claimed.count) throw conflict("Someone just decided this request, or the club withdrew it.");
        await recordLineDecisions(tx, request.id, lines);
        await resolveTasks("funding", request.id, actor.id, tx);
        await logActivity(
          {
            actorId: actor.id,
            action: `funding.${status.toLowerCase()}`,
            entityType: "fundingRequest",
            entityId: request.id,
            clubId: request.clubId,
            data: { title: request.title, requested: request.amountRequestedCents, cents: approved ?? 0, source: fundedSource, reducedLines: reduced },
          },
          tx,
        );
        if (!approved || !fundedBy) return null;
        return openInvoice(tx, { requestId: request.id, clubId: request.clubId, clubName: request.club.name, title: request.title, cents: approved, source: fundedBy, actorId: actor.id, at: now });
      });
      break;
    } catch (e) {
      // Another approval took the invoice number between our read and write: the whole decision rolled back, so try again.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) continue;
      throw e;
    }
  }

  const href = `/clubs/${request.club.slug}/manage/budget/requests/${request.id}`;
  const title =
    status === "APPROVED" ? `Funding approved: ${request.title}` : status === "PARTIALLY_APPROVED" ? `Funding partly approved: ${request.title}` : `Funding not approved: ${request.title}`;
  const lead =
    status === "APPROVED"
      ? `${office.name} approved the full ${fmtMoney(approved!)}, funded by ${fundedBy}.`
      : status === "PARTIALLY_APPROVED"
        ? `${office.name} approved ${fmtMoney(approved!)} of the ${fmtMoney(request.amountRequestedCents)} requested, funded by ${fundedBy}. ${plural(reduced, "line")} got less than asked; ${reduced === 1 ? "it's" : "they're"} free again, so you can ask another source for the rest.`
        : `${office.name} didn't approve the ${fmtMoney(request.amountRequestedCents)} requested.`;
  await notifyClubCapability(request.clubId, "budget", {
    kind: `funding.${status.toLowerCase()}`,
    title,
    body: v.note ? `${lead} ${v.note}` : lead,
    href,
  });
  if (invoice) {
    // In-app only: the club can download the invoice now; the email comes when the money goes through.
    await notifyClubCapability(request.clubId, "budget", {
      kind: "invoice.created",
      title: `Invoice ${invoice.number} is ready`,
      body: `It covers the ${fmtMoney(approved!)} approved for “${request.title}”. ${office.name} is sending it through the university finance system.`,
      href,
    });
  }
  return { status, amountApprovedCents: approved, fundedSource, invoice };
}

/** The money went through in the university finance system: close the invoice and its task, tell the club. */
export async function markInvoiceProcessed(actor: Actor | null, invoiceId: string) {
  assertCan(actor, "admin.funding");
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, include: { request: { select: { id: true, title: true, clubId: true, club: { select: { slug: true, officeId: true } } } } } });
  if (!invoice || !canAdminFunding(actor, invoice.request.club)) throw notFound("Invoice");
  const office = await fundingOfficeForClub(invoice.request.clubId);
  await db.$transaction(async (tx) => {
    const claimed = await tx.invoice.updateMany({ where: { id: invoice.id, status: "OPEN" }, data: { status: "PROCESSED", processedAt: new Date() } });
    if (!claimed.count) throw conflict(`Invoice ${invoice.number} is already marked processed.`);
    await resolveTasks("invoice", invoice.id, actor.id, tx);
    await logActivity({ actorId: actor.id, action: "invoice.processed", entityType: "invoice", entityId: invoice.id, clubId: invoice.request.clubId, data: { number: invoice.number, cents: invoice.amountCents } }, tx);
  });
  await notifyClubCapability(invoice.request.clubId, "budget", {
    kind: "invoice.processed",
    title: `Funding for ${invoice.request.title} went through`,
    body: `${fmtMoney(invoice.amountCents)} was processed in the university finance system (invoice ${invoice.number}). Keep your receipts for ${office.name}.`,
    href: `/clubs/${invoice.request.club.slug}/manage/budget/requests/${invoice.request.id}`,
  });
  return { id: invoice.id };
}

// ─── Admin reads ─────────────────────────────────────────────────────────────

/** Approved requests whose money hasn't gone through yet: an open invoice (or, approved before invoices came with approval, none). */
const INVOICE_PENDING: Prisma.FundingRequestWhereInput = {
  status: { in: ["APPROVED", "PARTIALLY_APPROVED"] },
  OR: [{ invoices: { none: {} } }, { invoices: { some: { status: "OPEN" } } }],
};

export type AdminQueue = "submitted" | "approved" | "all";

/** Requests by source: the one that funded it once WSUSA approves, else the one the club expects. */
const bySource = (source: FundingSource): Prisma.FundingRequestWhereInput => ({ OR: [{ fundedSource: source }, { fundedSource: null, fundingSource: source }] });

/** Open invoices' due dates (their INVOICE tasks'), by invoice id. */
export async function invoiceDueDates(invoiceIds: string[]): Promise<Map<string, Date>> {
  if (!invoiceIds.length) return new Map();
  const tasks = await db.task.findMany({ where: { sourceType: "invoice", sourceId: { in: invoiceIds }, status: "OPEN", dueAt: { not: null } }, select: { sourceId: true, dueAt: true } });
  return new Map(tasks.map((t) => [t.sourceId!, t.dueAt!]));
}

/** The admin funding queue: the clubs whose funding this person decides (lib/authz adminFundingClubWhere). Drafts are the club's own work and never show here. */
export async function adminFundingQueue(actor: Actor | null, opts: { queue: AdminQueue; source?: FundingSource | null; clubId?: string | null; take?: number }) {
  assertCan(actor, "admin.funding");
  const where: Prisma.FundingRequestWhereInput = {
    AND: [
      { club: adminFundingClubWhere(actor) },
      { status: opts.queue === "submitted" ? "SUBMITTED" : opts.queue === "approved" ? { in: ["APPROVED", "PARTIALLY_APPROVED"] } : { not: "DRAFT" } },
      ...(opts.queue === "approved" ? [{ OR: INVOICE_PENDING.OR }] : []),
      ...(opts.source ? [bySource(opts.source)] : []),
      ...(opts.clubId ? [{ clubId: opts.clubId }] : []),
    ],
  };
  const orderBy: Prisma.FundingRequestOrderByWithRelationInput[] =
    opts.queue === "submitted" ? [{ submittedAt: "asc" }] : opts.queue === "approved" ? [{ decidedAt: "asc" }] : [{ submittedAt: { sort: "desc", nulls: "last" } }];
  const [found, total] = await Promise.all([
    db.fundingRequest.findMany({
      where,
      orderBy,
      take: opts.take ?? 100,
      include: {
        club: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            logoColor: true,
            department: { select: { name: true } },
            college: { select: { name: true } },
            office: { select: { decidesFunding: true, reviewDays: true } },
          },
        },
        term: { select: { name: true } },
        invoices: { select: { id: true, number: true, status: true, createdAt: true } },
        _count: { select: { items: true } },
      },
    }),
    db.fundingRequest.count({ where }),
  ]);
  const due = await invoiceDueDates(found.flatMap((r) => r.invoices.filter((i) => i.status === "OPEN").map((i) => i.id)));
  // Each request is late by the review time of the office deciding it (lib/offices/rules fundingOfficeId).
  const umbrellaDays = (await listOffices())[0].reviewDays;
  const rows = found.map((r) => ({
    ...r,
    reviewDays: r.club.office?.decidesFunding ? r.club.office.reviewDays : umbrellaDays,
    invoices: r.invoices.map((i) => ({ ...i, dueAt: due.get(i.id) ?? null })),
  }));
  return { rows, total };
}

/** Counts for the queue tabs, for the clubs whose funding this person decides. */
export async function adminFundingCounts(actor: Actor | null) {
  assertCan(actor, "admin.funding");
  const club = adminFundingClubWhere(actor);
  const [submitted, approved] = await Promise.all([db.fundingRequest.count({ where: { status: "SUBMITTED", club } }), db.fundingRequest.count({ where: { AND: [INVOICE_PENDING, { club }] } })]);
  return { submitted, approved };
}

/**
 * The offices whose funding work this person sees, with each one's review
 * time: every office for WSUSA's admins, else the staffed offices that decide
 * funding. (officeId null = the umbrella.)
 */
async function fundingOffices(actor: Actor) {
  const offices = await listOffices();
  const all = adminScope(actor).all;
  return offices.filter((o) => all || (!o.umbrella && (actor.fundingOfficeIds ?? []).includes(o.id))).map((o) => ({ officeId: storedOfficeId(o), reviewDays: o.reviewDays, umbrella: o.umbrella }));
}

/**
 * The admin funding page's headline numbers, for the clubs whose funding this
 * person decides: what's waiting on a decision (and how much of it is past
 * the office's review time, each office's own), what's approved but not yet
 * through the finance system (and past due), and what was approved for the
 * current budget semester. "Late" is lib/funding/review's rule, the same one
 * the office queue and the follow-up job use.
 */
export async function adminFundingOverview(actor: Actor | null, now = new Date()) {
  assertCan(actor, "admin.funding");
  const terms = await getTerms();
  const term = budgetTermFor(terms, now);
  const club = adminFundingClubWhere(actor);
  const offices = await fundingOffices(actor);
  // The review time the page quotes: WSUSA's for its admins, else the staffer's office's.
  const reviewDays = (offices.find((o) => o.umbrella) ?? offices[0])?.reviewDays ?? 10;
  const openTasks = (kind: "review" | "invoice") =>
    offices.length ? db.task.count({ where: { status: "OPEN", assigneeType: "ADMINS", OR: offices.map((o) => ({ officeId: o.officeId, ...fundingTasks(kind, true, now, o.reviewDays) })) } }) : Promise.resolve(0);
  const [waiting, oldest, pastReview, openInvoices, invoicesPastDue, approvedThisTerm] = await Promise.all([
    db.fundingRequest.aggregate({ where: { status: "SUBMITTED", club }, _count: { _all: true }, _sum: { amountRequestedCents: true } }),
    db.fundingRequest.findFirst({ where: { status: "SUBMITTED", club }, orderBy: { submittedAt: "asc" }, select: { submittedAt: true } }),
    openTasks("review"),
    db.invoice.aggregate({ where: { status: "OPEN", request: { club } }, _count: { _all: true }, _sum: { amountCents: true } }),
    openTasks("invoice"),
    term
      ? db.fundingRequest.aggregate({ where: { termId: term.id, status: { in: ["APPROVED", "PARTIALLY_APPROVED"] }, club }, _count: { _all: true }, _sum: { amountApprovedCents: true } })
      : null,
  ]);
  return {
    reviewDays,
    waiting: { count: waiting._count._all, cents: waiting._sum.amountRequestedCents ?? 0, oldestSubmittedAt: oldest?.submittedAt ?? null, pastReview },
    openInvoices: { count: openInvoices._count._all, cents: openInvoices._sum.amountCents ?? 0, pastDue: invoicesPastDue },
    approvedThisTerm: term ? { termName: term.name, count: approvedThisTerm?._count._all ?? 0, cents: approvedThisTerm?._sum.amountApprovedCents ?? 0 } : null,
  };
}

/** Clubs that have ever sent a request (for the admin club filter), among those whose funding this person decides. */
export async function clubsWithRequests(actor: Actor | null) {
  assertCan(actor, "admin.funding");
  return db.club.findMany({ where: { AND: [adminFundingClubWhere(actor), { fundingRequests: { some: { status: { not: "DRAFT" } } } }] }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** The club's other requests, newest first (the admin detail page's history). */
export async function priorRequests(clubId: string, exceptId: string) {
  return db.fundingRequest.findMany({
    where: { clubId, id: { not: exceptId }, status: { not: "DRAFT" } },
    orderBy: { submittedAt: { sort: "desc", nulls: "last" } },
    take: 12,
    select: { id: true, title: true, status: true, fundingSource: true, fundedSource: true, amountRequestedCents: true, amountApprovedCents: true, submittedAt: true, term: { select: { name: true } } },
  });
}
