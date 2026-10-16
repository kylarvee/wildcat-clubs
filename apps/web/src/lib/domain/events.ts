import "server-only";
import { Prisma, type BudgetItem, type Event, type Term } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { can, getClubAccess, isAdmin } from "@/lib/authz";
import { logActivity } from "@/lib/lake/activity";
import { assertCan, assertClubCap, assertSignedIn, conflict, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { notifyClubCapability } from "@/lib/domain/notify";
import { canViewFile } from "@/lib/domain/files";
import { sanitizeRichHtml } from "@/lib/rich/sanitize";
import { expandOccurrences, MAX_OCCURRENCES, type OccurrenceTimes } from "@/lib/events/recurrence";
import { generateCheckinCode, generateCheckinSecret } from "@/lib/attendance/token";
import { budgetTermFor, getTerms } from "@/lib/terms";
import { defaultFundingSource } from "@/lib/funding/defaults";
import { removeEventFromGoogle, syncEventToGoogle, type GoogleSyncResult } from "@/lib/integrations/google-calendar";
import { isHttpUrl, joinEventLinks, splitEventLinks } from "@/lib/events/links";
import { campusParts, toDateInput } from "@/lib/events/wallclock";
import { campusDate } from "@/lib/time";

/**
 * Events — the Events Builder's write path (club events and university
 * trainings), plus event costs, co-hosting, and the Google Calendar mirror.
 *
 * Who may write: capability "events" on the host club (which must be APPROVED),
 * or `admin.trainings` for university events (clubId = null).
 *
 * Occurrences: an event's schedule is expanded (lib/events/recurrence) into
 * EventOccurrence rows. On every change, past meetings and meetings with
 * check-ins are kept as history; upcoming meetings are matched to the new rule
 * by campus date (so their check-in codes and one-off cancellations survive),
 * the rest are added or removed. Every new occurrence gets a unique check-in
 * code and QR secret.
 *
 * Costs are BudgetItem rows with eventId — entered only here; the Budget tool
 * reads them through eventCostSummary() to request funding.
 */

// ─── Input schemas ───────────────────────────────────────────────────────────

const KIND = z.enum(["MEETING", "SOCIAL", "WORKSHOP", "SERVICE", "COMPETITION", "FUNDRAISER", "TRAINING", "OTHER"]);
const VISIBILITY = z.enum(["PUBLIC", "UNIVERSITY", "MEMBERS"]);
const RECURRENCE = z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY", "SEMESTERLY", "ACADEMIC_YEARLY", "YEARLY"]);
const LOCATION = z.enum(["CAMPUS", "ADDRESS", "VIRTUAL", "TBD"]);
const FUNDING = z.enum(["UNIVERSITY", "WSUSA", "COLLEGE", "DEPARTMENT"]);

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const httpUrl = z.string().trim().max(1000).refine(isHttpUrl, "Enter a full link that starts with https://");

const ScheduleShape = {
  startsAt: z.coerce.date({ error: "Pick a start date and time." }),
  durationMinutes: z.coerce.number().int().min(5, "Events need to last at least 5 minutes.").max(14 * 24 * 60, "Events can last up to two weeks.").default(60),
  allDay: z.boolean().default(false),
  recurrence: RECURRENCE.default("NONE"),
  recurrenceInterval: z.coerce.number().int().min(1).max(52).default(1),
  recurrenceWeekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([]),
  recurrenceUntil: z.coerce.date().nullish(),
  recurrenceCount: z.coerce.number().int().min(1).max(MAX_OCCURRENCES, `Events can repeat up to ${MAX_OCCURRENCES} times.`).nullish(),
};

const LocationShape = {
  locationType: LOCATION.default("TBD"),
  buildingId: z.string().nullish(),
  room: optText(60),
  address: optText(300),
  lat: z.coerce.number().min(-90).max(90).nullish(),
  lng: z.coerce.number().min(-180).max(180).nullish(),
  virtualUrl: z.union([httpUrl, z.literal("")]).nullish(),
  /** Ask Google Calendar for a Meet link (only works while Google Calendar sync is on). */
  createMeetLink: z.boolean().default(false),
};

const CostSchema = z.object({
  id: z.string().optional(),
  description: z.string().trim().min(1, "Describe each cost.").max(200),
  category: z.string().trim().min(1).max(60).default("Supplies"),
  quantity: z.coerce.number().positive("Quantities must be more than zero.").max(100_000),
  /** Dollars (the form's unit); stored as integer cents. */
  unitCost: z.coerce.number().min(0, "Costs can't be negative.").max(1_000_000),
  perOccurrence: z.boolean().default(true),
  fundingSource: FUNDING.nullish(),
});
export type EventCostInput = z.input<typeof CostSchema>;

const DetailsShape = {
  title: z.string().trim().min(1, "Give the event a title.").max(140, "Keep the title under 140 characters."),
  kind: KIND.default("MEETING"),
  descriptionHtml: z.string().max(200_000).nullish(),
  links: z.array(z.object({ label: z.string().trim().max(120).default(""), url: httpUrl })).max(20).default([]),
  visibility: VISIBILITY.default("PUBLIC"),
  allowSelfCheckIn: z.boolean().default(true),
  attachmentFileIds: z.array(z.string()).max(30, "Attach up to 30 files.").default([]),
  cohostClubIds: z.array(z.string()).max(500).default([]),
  cohostAllClubs: z.boolean().default(false),
  /** Omit to leave the event's costs as they are. */
  costs: z.array(CostSchema).max(100).optional(),
};

const EventSchema = z.object({ ...DetailsShape, ...ScheduleShape, ...LocationShape });
const CreateSchema = EventSchema.extend({ clubId: z.string().nullable() });
const ScheduleSchema = z.object(ScheduleShape);
const IdeaSchema = z.object({
  clubId: z.string().nullable(),
  title: z.string().trim().min(1, "Give the idea a title.").max(140),
  notes: z.string().max(5000).nullish(),
});
const MoveSchema = z.object({
  startsAt: z.coerce.date(),
  durationMinutes: z.coerce.number().int().min(5).max(14 * 24 * 60).optional(),
  allDay: z.boolean().optional(),
});

export type EventInput = z.input<typeof EventSchema>;
export type CreateEventInput = z.input<typeof CreateSchema>;
export type ScheduleInput = z.input<typeof ScheduleSchema>;
export type IdeaInput = z.input<typeof IdeaSchema>;

export type EventWriteResult = { id: string; google: Pick<GoogleSyncResult, "status" | "message"> };

// ─── Permissions ─────────────────────────────────────────────────────────────

const HOST_SELECT = { id: true, name: true, slug: true, type: true, status: true, departmentId: true } as const;
type HostClub = Prisma.ClubGetPayload<{ select: typeof HOST_SELECT }>;

/** Club events: "events" on an APPROVED host club. University events: admin.trainings. */
async function assertHost(actor: Actor | null, clubId: string | null): Promise<{ actor: Actor; club: HostClub | null }> {
  assertSignedIn(actor);
  if (clubId === null) {
    assertCan(actor, "admin.trainings");
    return { actor, club: null };
  }
  const club = await db.club.findUnique({ where: { id: clubId }, select: HOST_SELECT });
  if (!club) throw notFound("Club");
  await assertClubCap(actor, clubId, "events");
  if (club.status !== "APPROVED") throw forbidden("Events open up once WSUSA approves the club.");
  return { actor, club };
}

async function loadManaged(actor: Actor | null, eventId: string) {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) throw notFound("Event");
  const host = await assertHost(actor, event.clubId);
  return { event, ...host };
}

/** May this person edit the event (Events Builder or admin trainings)? */
export async function canManageEvent(actor: Actor | null, event: { clubId: string | null }): Promise<boolean> {
  if (!actor) return false;
  if (!event.clubId) return can(actor, "admin.trainings");
  const access = await getClubAccess(actor, event.clubId);
  return Boolean(access?.capabilities.has("events"));
}

/**
 * Visibility: PUBLIC anyone · UNIVERSITY signed-in accounts · MEMBERS members and
 * leaders of the host and approved co-host clubs. Ideas (drafts) only for managers.
 * Admins see everything.
 */
export async function canViewEvent(actor: Actor | null, event: { id: string; clubId: string | null; visibility: Event["visibility"]; status: Event["status"] }): Promise<boolean> {
  if (event.status === "DRAFT") return canManageEvent(actor, event);
  if (isAdmin(actor)) return true;
  if (event.clubId) {
    const club = await db.club.findUnique({ where: { id: event.clubId }, select: { status: true } });
    if (!club) return false;
    if (club.status !== "APPROVED" && club.status !== "RETIRED") return canManageEvent(actor, event);
  }
  if (event.visibility === "PUBLIC") return true;
  if (!actor) return false;
  if (event.visibility === "UNIVERSITY" || !event.clubId) return true;
  const host = await getClubAccess(actor, event.clubId);
  if (host?.isMember || host?.isLeader) return true;
  const cohosts = await db.eventCohost.findMany({ where: { eventId: event.id, status: "APPROVED" }, select: { clubId: true } });
  for (const c of cohosts) {
    const a = await getClubAccess(actor, c.clubId);
    if (a?.isMember || a?.isLeader) return true;
  }
  return false;
}

/** May this person see the event's expected costs? (host club budget or events holders, admins) */
export async function canSeeEventCosts(actor: Actor | null, event: { clubId: string | null }): Promise<boolean> {
  if (!actor || !event.clubId) return false;
  const access = await getClubAccess(actor, event.clubId);
  return Boolean(access && (access.capabilities.has("budget") || access.capabilities.has("events")));
}

// ─── Normalizing input ───────────────────────────────────────────────────────

type NormalizedSchedule = {
  startsAt: Date;
  durationMinutes: number;
  allDay: boolean;
  recurrence: Event["recurrence"];
  recurrenceInterval: number;
  recurrenceWeekdays: number[];
  recurrenceUntil: Date | null;
  recurrenceCount: number | null;
};

function normalizeSchedule(s: z.output<typeof ScheduleSchema>): NormalizedSchedule {
  let startsAt = s.startsAt;
  if (Number.isNaN(startsAt.getTime())) throw invalid("Pick a start date and time.");
  if (s.allDay) {
    const p = campusParts(startsAt);
    startsAt = campusDate(p.y, p.m, p.d, 0, 0);
  }
  const repeating = s.recurrence !== "NONE";
  const until = repeating ? (s.recurrenceUntil ?? null) : null;
  if (until && until.getTime() < startsAt.getTime()) throw invalid("The repeat end date needs to be on or after the first meeting.");
  const weekdays = s.recurrence === "WEEKLY" ? (s.recurrenceWeekdays.length ? [...new Set(s.recurrenceWeekdays)].sort() : [campusParts(startsAt).dow]) : [];
  return {
    startsAt,
    durationMinutes: s.allDay ? 24 * 60 : s.durationMinutes,
    allDay: s.allDay,
    recurrence: s.recurrence,
    recurrenceInterval: repeating ? s.recurrenceInterval : 1,
    recurrenceWeekdays: weekdays,
    recurrenceUntil: until,
    // An end date wins over a count when both are sent.
    recurrenceCount: repeating && !until ? (s.recurrenceCount ?? null) : null,
  };
}

function expandSchedule(s: NormalizedSchedule, terms: Term[]): OccurrenceTimes[] {
  const out = expandOccurrences(
    { startsAt: s.startsAt, durationMinutes: s.durationMinutes, allDay: s.allDay, recurrence: s.recurrence, interval: s.recurrenceInterval, weekdays: s.recurrenceWeekdays, until: s.recurrenceUntil, count: s.recurrenceCount },
    terms,
  );
  if (out.length === 0) throw invalid("This repeat rule doesn't land on any dates. Check the start date and the days you picked.");
  return out;
}

type NormalizedLocation = {
  locationType: Event["locationType"];
  buildingId: string | null;
  room: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  virtualUrl: string | null;
};

async function normalizeLocation(l: {
  locationType: Event["locationType"];
  buildingId?: string | null;
  room: string | null;
  address: string | null;
  lat?: number | null;
  lng?: number | null;
  virtualUrl?: string | null;
  createMeetLink: boolean;
}): Promise<NormalizedLocation> {
  const none: NormalizedLocation = { locationType: l.locationType, buildingId: null, room: null, address: null, lat: null, lng: null, virtualUrl: null };
  switch (l.locationType) {
    case "CAMPUS": {
      if (!l.buildingId) throw invalid("Pick the campus building.");
      const b = await db.building.findUnique({ where: { id: l.buildingId }, select: { id: true } });
      if (!b) throw invalid("That building isn't on the campus list.");
      return { ...none, buildingId: b.id, room: l.room };
    }
    case "ADDRESS":
      if (!l.address) throw invalid("Add the address so people can find it.");
      return { ...none, address: l.address, lat: l.lat ?? null, lng: l.lng ?? null };
    case "VIRTUAL":
      if (!l.virtualUrl && !l.createMeetLink) throw invalid("Add the link people use to join, or ask for a Google Meet link.");
      return { ...none, virtualUrl: l.virtualUrl || null };
    default:
      return none;
  }
}

function buildDescription(html: string | null | undefined, links: { label: string; url: string }[]): string | null {
  // Strip any links block that came back in the HTML, then re-attach the current list.
  const body = sanitizeRichHtml(splitEventLinks(html ?? "").body);
  const joined = sanitizeRichHtml(joinEventLinks(body, links));
  return joined.trim() ? joined : null;
}

function notesToHtml(notes: string | null | undefined): string | null {
  const text = (notes ?? "").trim();
  if (!text) return null;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return sanitizeRichHtml(
    text
      .split(/\n{2,}/)
      .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
      .join(""),
  );
}

/** Files must exist and be visible to the person attaching them. */
async function assertAttachable(actor: Actor, fileIds: string[], already: string[]) {
  const added = [...new Set(fileIds)].filter((id) => !already.includes(id));
  if (added.length === 0) return;
  const files = await db.fileItem.findMany({ where: { id: { in: added } } });
  if (files.length !== added.length) throw invalid("One of the attached files no longer exists.");
  for (const f of files) {
    if (f.isFolder) throw invalid(`"${f.name}" is a folder. Attach files instead.`);
    if (f.trashedAt) throw invalid(`"${f.name}" is in the trash.`);
    if (!(await canViewFile(actor, f))) throw forbidden(`You don't have access to "${f.name}".`);
  }
}

function requireBudgetTerm(terms: Term[], at: Date): string {
  const t = budgetTermFor(terms, at);
  if (!t) throw invalid("The academic calendar isn't set up yet, so costs can't be filed under a semester. Ask a system administrator to add terms.");
  return t.id;
}

const toCents = (dollars: number) => Math.round(dollars * 100);

// ─── Occurrences ─────────────────────────────────────────────────────────────

async function freshCodes(tx: Tx, n: number): Promise<string[]> {
  const codes = new Set<string>();
  for (let attempt = 0; codes.size < n && attempt < 8; attempt++) {
    const batch = new Set<string>();
    while (batch.size < n - codes.size) {
      const c = generateCheckinCode();
      if (!codes.has(c)) batch.add(c);
    }
    const taken = await tx.eventOccurrence.findMany({ where: { checkinCode: { in: [...batch] } }, select: { checkinCode: true } });
    const takenSet = new Set(taken.map((t) => t.checkinCode));
    for (const c of batch) if (!takenSet.has(c)) codes.add(c);
  }
  if (codes.size < n) throw new Error("Couldn't generate unique check-in codes.");
  return [...codes];
}

/** Retries a write whose check-in codes collided with a concurrent write (unique index). */
async function withCodeRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const collision = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && JSON.stringify(e.meta ?? {}).includes("checkinCode");
      if (!collision || i >= 2) throw e;
    }
  }
}

/**
 * Brings an event's occurrences in line with `desired`. See the module comment:
 * history (past or attended) stays; upcoming meetings are matched by campus date.
 */
async function materialize(tx: Tx, eventId: string, desired: OccurrenceTimes[], opts: { status?: "SCHEDULED" | "CANCELLED"; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const status = opts.status ?? "SCHEDULED";
  const existing = await tx.eventOccurrence.findMany({
    where: { eventId },
    orderBy: { startsAt: "asc" },
    select: { id: true, startsAt: true, endsAt: true, _count: { select: { attendances: true } } },
  });

  const toCreate: OccurrenceTimes[] = [];
  const toUpdate: { id: string; startsAt: Date; endsAt: Date }[] = [];
  let toDelete: string[] = [];

  if (existing.length === 0) {
    toCreate.push(...desired);
  } else if (existing.length === 1 && desired.length === 1) {
    // A one-time event that moved: keep its id and check-in code.
    const [o] = existing;
    const [d] = desired;
    if (o.startsAt.getTime() !== d.startsAt.getTime() || o.endsAt.getTime() !== d.endsAt.getTime()) toUpdate.push({ id: o.id, ...d });
  } else {
    const locked = existing.filter((o) => o.startsAt < now || o._count.attendances > 0);
    const free = existing.filter((o) => !(o.startsAt < now || o._count.attendances > 0));
    const lockedDays = new Set(locked.map((o) => toDateInput(o.startsAt)));
    const freeByDay = new Map<string, typeof free>();
    for (const o of free) {
      const k = toDateInput(o.startsAt);
      freeByDay.set(k, [...(freeByDay.get(k) ?? []), o]);
    }
    const used = new Set<string>();
    for (const d of desired) {
      if (d.startsAt < now) continue; // the past isn't rewritten
      const day = toDateInput(d.startsAt);
      if (lockedDays.has(day)) continue;
      const match = freeByDay.get(day)?.shift();
      if (match) {
        used.add(match.id);
        if (match.startsAt.getTime() !== d.startsAt.getTime() || match.endsAt.getTime() !== d.endsAt.getTime()) toUpdate.push({ id: match.id, ...d });
      } else {
        toCreate.push(d);
      }
    }
    toDelete = free.filter((o) => !used.has(o.id)).map((o) => o.id);
  }

  if (toDelete.length) await tx.eventOccurrence.deleteMany({ where: { id: { in: toDelete } } });
  for (const u of toUpdate) await tx.eventOccurrence.update({ where: { id: u.id }, data: { startsAt: u.startsAt, endsAt: u.endsAt } });
  if (toCreate.length) {
    const codes = await freshCodes(tx, toCreate.length);
    await tx.eventOccurrence.createMany({
      data: toCreate.map((o, i) => ({ eventId, startsAt: o.startsAt, endsAt: o.endsAt, status, checkinCode: codes[i], checkinSecret: generateCheckinSecret() })),
    });
  }
  return { created: toCreate.length, updated: toUpdate.length, deleted: toDelete.length };
}

// ─── Co-hosts ────────────────────────────────────────────────────────────────

type CohostChange = { cohostId: string; clubId: string; clubName: string; clubSlug: string; status: "PENDING" | "APPROVED" };

/**
 * Makes the event's co-host invitations match the wanted clubs. New invitations
 * are PENDING (with an approval task for the club's "events" holders) unless
 * the club auto-approves co-hosts. Removed clubs' invitations are withdrawn.
 */
async function syncCohosts(tx: Tx, event: { id: string; title: string; clubId: string }, host: HostClub, actor: Actor, wanted: { all: boolean; clubIds: string[] }): Promise<CohostChange[]> {
  const existing = await tx.eventCohost.findMany({ where: { eventId: event.id } });
  const have = new Set(existing.map((c) => c.clubId));
  const targetIds = wanted.all ? null : [...new Set(wanted.clubIds)].filter((id) => id !== event.clubId);
  // Only new invitations need an active club; existing ones (even of a club that since retired) stay as they are.
  const newIds = targetIds?.filter((id) => !have.has(id)) ?? null;
  const clubs = await tx.club.findMany({
    where: { status: "APPROVED", id: newIds ? { in: newIds } : { notIn: [event.clubId, ...have] } },
    select: { id: true, name: true, slug: true, autoApproveCohosts: true },
  });
  if (newIds && clubs.length !== newIds.length) throw invalid("One of the clubs you tagged isn't active right now. Remove it and try again.");

  // "All clubs" never withdraws invitations; an explicit list withdraws clubs that were removed from it.
  const keep = new Set(targetIds ?? []);
  const removed = targetIds ? existing.filter((c) => !keep.has(c.clubId)) : [];
  if (removed.length) {
    await tx.eventCohost.deleteMany({ where: { id: { in: removed.map((c) => c.id) } } });
    for (const c of removed) await resolveTasks("cohost", c.id, actor.id, tx, "CANCELLED");
  }

  const changes: CohostChange[] = [];
  const now = new Date();
  for (const club of clubs) {
    const auto = club.autoApproveCohosts;
    const row = await tx.eventCohost.create({
      data: { eventId: event.id, clubId: club.id, status: auto ? "APPROVED" : "PENDING", requestedById: actor.id, ...(auto ? { decidedAt: now } : {}) },
    });
    if (!auto) {
      await createTask(
        {
          kind: "APPROVAL",
          title: `${host.name} invited ${club.name} to co-host “${event.title}”`,
          description: "Approve it to put the event on your club's calendar, or decline.",
          assignee: { type: "CLUB", clubId: club.id, capability: "events" },
          href: `/clubs/${club.slug}/manage/events?tab=cohosts`,
          source: { type: "cohost", id: row.id },
          createdById: actor.id,
        },
        tx,
      );
    }
    changes.push({ cohostId: row.id, clubId: club.id, clubName: club.name, clubSlug: club.slug, status: auto ? "APPROVED" : "PENDING" });
  }
  return changes;
}

async function announceCohostChanges(changes: CohostChange[], host: HostClub, eventTitle: string, actor: Actor, bulk: boolean) {
  for (const c of changes) {
    await notifyClubCapability(c.clubId, "events", {
      kind: c.status === "PENDING" ? "event.cohost_request" : "event.cohost_added",
      title: c.status === "PENDING" ? `${host.name} wants to co-host with ${c.clubName}` : `${c.clubName} is now co-hosting “${eventTitle}”`,
      body: c.status === "PENDING" ? `“${eventTitle}” — approve it to put it on your club's calendar.` : `${host.name} added you, and your club approves co-hosts automatically.`,
      href: `/clubs/${c.clubSlug}/manage/events?tab=cohosts`,
      exceptUserId: actor.id,
      // Inviting every club at once stays in-app so nobody's inbox floods.
      email: !bulk && c.status === "PENDING",
    });
  }
}

// ─── Costs ───────────────────────────────────────────────────────────────────

type CostRow = z.output<typeof CostSchema>;

function costData(c: CostRow, host: HostClub) {
  return {
    description: c.description,
    category: c.category,
    quantity: c.quantity,
    unitCostCents: toCents(c.unitCost),
    perOccurrence: c.perOccurrence,
    fundingSource: c.fundingSource ?? defaultFundingSource(host),
  };
}

async function syncCosts(tx: Tx, eventId: string, host: HostClub, actor: Actor, costs: CostRow[], termId: string | null) {
  const existing = await tx.budgetItem.findMany({ where: { eventId } });
  const byId = new Map(existing.map((b) => [b.id, b]));
  for (const c of costs) if (c.id && !byId.has(c.id)) throw invalid("One of the cost lines was removed by someone else. Reload and try again.");
  const keep = new Set(costs.map((c) => c.id).filter(Boolean) as string[]);
  const removed = existing.filter((b) => !keep.has(b.id));
  if (removed.length) await tx.budgetItem.deleteMany({ where: { id: { in: removed.map((b) => b.id) } } });
  for (const c of costs) {
    if (c.id) await tx.budgetItem.update({ where: { id: c.id }, data: { ...costData(c, host), ...(termId ? { termId } : {}) } });
    else {
      if (!termId) throw invalid("The academic calendar isn't set up yet, so costs can't be filed under a semester.");
      await tx.budgetItem.create({ data: { ...costData(c, host), clubId: host.id, eventId, termId, createdById: actor.id } });
    }
  }
}

export type EventCostSummary = {
  eventId: string;
  items: number;
  /** One meeting's cost (lines marked "each meeting"). */
  perOccurrenceCents: number;
  /** Lines paid once for the whole event. */
  oneTimeCents: number;
  /** Scheduled (not cancelled) meetings. */
  occurrences: number;
  occurrencesByTerm: { termId: string | null; termName: string; occurrences: number; totalCents: number }[];
  totalCents: number;
};

const lineCents = (b: Pick<BudgetItem, "quantity" | "unitCostCents">) => Math.round(b.quantity * b.unitCostCents);

/**
 * Expected cost of events (read-only; callers check who may see it). Per-meeting
 * lines multiply by the scheduled meetings in each term; one-time lines count
 * once, in their own term. The Budget tool and calendars read costs here.
 */
export async function eventCostSummaries(eventIds: string[]): Promise<Map<string, EventCostSummary>> {
  const ids = [...new Set(eventIds)];
  const out = new Map<string, EventCostSummary>();
  if (ids.length === 0) return out;
  const [items, occurrences, terms] = await Promise.all([
    db.budgetItem.findMany({ where: { eventId: { in: ids } }, select: { eventId: true, quantity: true, unitCostCents: true, perOccurrence: true, termId: true } }),
    db.eventOccurrence.findMany({ where: { eventId: { in: ids }, status: "SCHEDULED", event: { status: { not: "DRAFT" } } }, select: { eventId: true, startsAt: true } }),
    getTerms(),
  ]);
  const termName = new Map(terms.map((t) => [t.id, t.name]));
  for (const id of ids) {
    const mine = items.filter((i) => i.eventId === id);
    const occ = occurrences.filter((o) => o.eventId === id);
    const per = mine.filter((i) => i.perOccurrence).reduce((s, i) => s + lineCents(i), 0);
    const once = mine.filter((i) => !i.perOccurrence);
    const buckets = new Map<string, { termId: string | null; termName: string; occurrences: number; totalCents: number }>();
    const bucket = (termId: string | null) => {
      const key = termId ?? "none";
      if (!buckets.has(key)) buckets.set(key, { termId, termName: termId ? (termName.get(termId) ?? "Term") : "No term", occurrences: 0, totalCents: 0 });
      return buckets.get(key)!;
    };
    for (const o of occ) {
      const b = bucket(budgetTermFor(terms, o.startsAt)?.id ?? null);
      b.occurrences += 1;
      b.totalCents += per;
    }
    for (const i of once) bucket(i.termId).totalCents += lineCents(i);
    const oneTime = once.reduce((s, i) => s + lineCents(i), 0);
    out.set(id, {
      eventId: id,
      items: mine.length,
      perOccurrenceCents: per,
      oneTimeCents: oneTime,
      occurrences: occ.length,
      occurrencesByTerm: [...buckets.values()],
      totalCents: per * occ.length + oneTime,
    });
  }
  return out;
}

export async function eventCostSummary(eventId: string): Promise<EventCostSummary> {
  return (await eventCostSummaries([eventId])).get(eventId)!;
}

// ─── Writing events ──────────────────────────────────────────────────────────

type EventFields = {
  title: string;
  kind: Event["kind"];
  visibility: Event["visibility"];
  allowSelfCheckIn: boolean;
  descriptionHtml: string | null;
  schedule: NormalizedSchedule;
  location: NormalizedLocation;
  createMeetLink: boolean;
  /** Undefined = leave as they are. */
  cohosts?: { all: boolean; clubIds: string[] };
  attachmentFileIds?: string[];
  costs?: CostRow[];
};

function sameSchedule(a: Event, s: NormalizedSchedule) {
  return (
    a.startsAt?.getTime() === s.startsAt.getTime() &&
    a.durationMinutes === s.durationMinutes &&
    a.allDay === s.allDay &&
    a.recurrence === s.recurrence &&
    a.recurrenceInterval === s.recurrenceInterval &&
    a.recurrenceWeekdays.join() === s.recurrenceWeekdays.join() &&
    (a.recurrenceUntil?.getTime() ?? null) === (s.recurrenceUntil?.getTime() ?? null) &&
    (a.recurrenceCount ?? null) === (s.recurrenceCount ?? null)
  );
}

/** The one place events are written. Create (existing = null), update, schedule an idea, or move. */
async function writeEvent(actor: Actor, club: HostClub | null, existing: Event | null, f: EventFields, action: string): Promise<EventWriteResult> {
  const terms = await getTerms();
  const desired = expandSchedule(f.schedule, terms);
  if (!club && f.costs?.length) throw invalid("University events don't carry club costs.");
  // University events have no members list, so "members only" means signed-in accounts.
  const visibility = !club && f.visibility === "MEMBERS" ? "UNIVERSITY" : f.visibility;
  const costTermId = club && f.costs !== undefined ? (f.costs.some((c) => !c.id) ? requireBudgetTerm(terms, desired[0].startsAt) : (budgetTermFor(terms, desired[0].startsAt)?.id ?? null)) : null;
  if (f.attachmentFileIds) {
    const already = existing ? (await db.eventAttachment.findMany({ where: { eventId: existing.id }, select: { fileId: true } })).map((a) => a.fileId) : [];
    await assertAttachable(actor, f.attachmentFileIds, already);
  }
  const scheduleChanged = existing ? existing.status === "DRAFT" || !sameSchedule(existing, f.schedule) : true;
  const status: Event["status"] = existing && existing.status === "CANCELLED" ? "CANCELLED" : "SCHEDULED";

  const { event, cohostChanges } = await withCodeRetry(() =>
    db.$transaction(
      async (tx) => {
        const data = {
          title: f.title,
          kind: f.kind,
          visibility,
          allowSelfCheckIn: f.allowSelfCheckIn,
          descriptionHtml: f.descriptionHtml,
          status,
          ...f.schedule,
          ...f.location,
          ...(f.cohosts && club ? { cohostAllClubs: f.cohosts.all } : {}),
        };
        const event = existing
          ? await tx.event.update({ where: { id: existing.id }, data })
          : await tx.event.create({ data: { ...data, clubId: club?.id ?? null, createdById: actor.id } });

        await materialize(tx, event.id, desired, { status: status === "CANCELLED" ? "CANCELLED" : "SCHEDULED" });

        if (f.attachmentFileIds) {
          const want = [...new Set(f.attachmentFileIds)];
          await tx.eventAttachment.deleteMany({ where: { eventId: event.id, fileId: { notIn: want } } });
          if (want.length) await tx.eventAttachment.createMany({ data: want.map((fileId) => ({ eventId: event.id, fileId })), skipDuplicates: true });
        }

        let cohostChanges: CohostChange[] = [];
        if (club && f.cohosts) cohostChanges = await syncCohosts(tx, { id: event.id, title: event.title, clubId: club.id }, club, actor, f.cohosts);

        if (club && f.costs !== undefined) await syncCosts(tx, event.id, club, actor, f.costs, costTermId);
        else if (club && scheduleChanged) {
          // Keep existing cost lines filed under the term of the (new) first meeting.
          const t = budgetTermFor(terms, desired[0].startsAt);
          if (t) await tx.budgetItem.updateMany({ where: { eventId: event.id }, data: { termId: t.id } });
        }

        await logActivity(
          {
            actorId: actor.id,
            action,
            entityType: "event",
            entityId: event.id,
            clubId: club?.id ?? null,
            data: { title: event.title, recurrence: event.recurrence, startsAt: event.startsAt?.toISOString() ?? null },
            // A public event appearing on the calendar is safe to show on the club's feed.
            isPublic: (!existing || existing.status === "DRAFT") && visibility === "PUBLIC",
          },
          tx,
        );
        return { event, cohostChanges };
      },
      { timeout: 30_000, maxWait: 10_000 },
    ),
  );

  if (club && cohostChanges.length) await announceCohostChanges(cohostChanges, club, event.title, actor, Boolean(f.cohosts?.all));
  if (club && existing && existing.status !== "DRAFT" && scheduleChanged) await tellCohostsAboutChange(event, club, actor, "moved");
  const google = await mirror(event.id, actor, f.createMeetLink);
  return { id: event.id, google: { status: google.status, message: google.message } };
}

/** Mirrors to Google Calendar and stores a newly created Meet link. */
async function mirror(eventId: string, actor: Actor, createMeet = false): Promise<GoogleSyncResult> {
  const r = await syncEventToGoogle(eventId, { createMeet });
  if (r.meetUrl) {
    const e = await db.event.update({ where: { id: eventId }, data: { virtualUrl: r.meetUrl }, select: { clubId: true } });
    await logActivity({ actorId: actor.id, action: "event.meet_created", entityType: "event", entityId: eventId, clubId: e.clubId });
  }
  return r;
}

async function tellCohostsAboutChange(event: Pick<Event, "id" | "title">, host: HostClub, actor: Actor, what: "moved" | "cancelled") {
  const cohosts = await db.eventCohost.findMany({ where: { eventId: event.id, status: "APPROVED" }, select: { clubId: true } });
  for (const c of cohosts) {
    await notifyClubCapability(c.clubId, "events", {
      kind: what === "moved" ? "event.cohost_changed" : "event.cohost_cancelled",
      title: what === "moved" ? `“${event.title}” has a new schedule` : `“${event.title}” was cancelled`,
      body: `${host.name} ${what === "moved" ? "changed the time of" : "cancelled"} an event you co-host.`,
      href: `/events/${event.id}`,
      exceptUserId: actor.id,
      email: what === "cancelled",
    });
  }
}

function fieldsFromInput(d: z.output<typeof EventSchema>, schedule: NormalizedSchedule, location: NormalizedLocation): EventFields {
  return {
    title: d.title,
    kind: d.kind,
    visibility: d.visibility,
    allowSelfCheckIn: d.allowSelfCheckIn,
    descriptionHtml: buildDescription(d.descriptionHtml, d.links),
    schedule,
    location,
    createMeetLink: d.createMeetLink,
    cohosts: { all: d.cohostAllClubs, clubIds: d.cohostClubIds },
    attachmentFileIds: d.attachmentFileIds,
    costs: d.costs,
  };
}

function fieldsFromEvent(e: Event, schedule: NormalizedSchedule): EventFields {
  return {
    title: e.title,
    kind: e.kind,
    visibility: e.visibility,
    allowSelfCheckIn: e.allowSelfCheckIn,
    descriptionHtml: e.descriptionHtml,
    schedule,
    location: { locationType: e.locationType, buildingId: e.buildingId, room: e.room, address: e.address, lat: e.lat, lng: e.lng, virtualUrl: e.virtualUrl },
    createMeetLink: false,
  };
}

/** Create a scheduled event (club, or university when clubId is null). */
export async function createEvent(actor: Actor | null, input: unknown): Promise<EventWriteResult> {
  const d = parse(CreateSchema, input);
  const { actor: a, club } = await assertHost(actor, d.clubId);
  const schedule = normalizeSchedule(d);
  const location = await normalizeLocation(d);
  return writeEvent(a, club, null, fieldsFromInput(d, schedule, location), club ? "event.created" : "event.university_created");
}

/** Save the full editor. Saving an idea (draft) with a time puts it on the calendar. */
export async function updateEvent(actor: Actor | null, eventId: string, input: unknown): Promise<EventWriteResult> {
  const d = parse(EventSchema, input);
  const { actor: a, club, event } = await loadManaged(actor, eventId);
  const schedule = normalizeSchedule(d);
  const location = await normalizeLocation(d);
  return writeEvent(a, club, event, fieldsFromInput(d, schedule, location), event.status === "DRAFT" ? "event.scheduled" : "event.updated");
}

/** Drag-and-drop / resize on the Events Builder calendar (one-time events only). */
export async function moveEvent(actor: Actor | null, eventId: string, input: unknown): Promise<EventWriteResult> {
  const d = parse(MoveSchema, input);
  const { actor: a, club, event } = await loadManaged(actor, eventId);
  if (event.status === "DRAFT") throw invalid("Put the idea on the calendar first.");
  if (event.recurrence !== "NONE") throw invalid("Repeating events can't be dragged. Open the event to change its schedule.");
  const allDay = d.allDay ?? event.allDay;
  const schedule = normalizeSchedule({
    startsAt: d.startsAt,
    durationMinutes: allDay ? 24 * 60 : (d.durationMinutes ?? (event.allDay ? 60 : event.durationMinutes)),
    allDay,
    recurrence: "NONE",
    recurrenceInterval: 1,
    recurrenceWeekdays: [],
    recurrenceUntil: null,
    recurrenceCount: null,
  });
  return writeEvent(a, club, event, fieldsFromEvent(event, schedule), "event.moved");
}

/** Jot down an idea (a draft with no date) on the club's — or the university's — idea list. */
export async function addIdea(actor: Actor | null, input: unknown) {
  const d = parse(IdeaSchema, input);
  const { actor: a, club } = await assertHost(actor, d.clubId);
  const event = await db.event.create({
    data: {
      clubId: club?.id ?? null,
      title: d.title,
      descriptionHtml: notesToHtml(d.notes),
      status: "DRAFT",
      kind: club ? "MEETING" : "TRAINING",
      visibility: club ? "PUBLIC" : "UNIVERSITY",
      createdById: a.id,
    },
  });
  await logActivity({ actorId: a.id, action: "event.idea_added", entityType: "event", entityId: event.id, clubId: club?.id ?? null, data: { title: event.title } });
  return { id: event.id };
}

export async function updateIdea(actor: Actor | null, eventId: string, input: unknown) {
  const d = parse(IdeaSchema.omit({ clubId: true }), input);
  const { actor: a, event } = await loadManaged(actor, eventId);
  if (event.status !== "DRAFT") throw conflict("This idea is already on the calendar. Edit the event instead.");
  await db.event.update({ where: { id: event.id }, data: { title: d.title, descriptionHtml: notesToHtml(d.notes) } });
  await logActivity({ actorId: a.id, action: "event.idea_updated", entityType: "event", entityId: event.id, clubId: event.clubId });
  return { id: event.id };
}

/** Put an idea on the calendar: DRAFT → SCHEDULED with a time and repeat rule. */
export async function scheduleIdea(actor: Actor | null, eventId: string, input: unknown): Promise<EventWriteResult> {
  const d = parse(ScheduleSchema, input);
  const { actor: a, club, event } = await loadManaged(actor, eventId);
  if (event.status !== "DRAFT") throw conflict("This idea is already on the calendar.");
  return writeEvent(a, club, event, fieldsFromEvent(event, normalizeSchedule(d)), "event.scheduled");
}

/** Cancel the whole event: every upcoming meeting is marked cancelled (history stays). */
export async function cancelEvent(actor: Actor | null, eventId: string, reason?: string | null) {
  const { actor: a, club, event } = await loadManaged(actor, eventId);
  if (event.status === "DRAFT") throw invalid("Ideas aren't on the calendar. Delete the idea instead.");
  if (event.status === "CANCELLED") return { id: event.id };
  const note = reason?.trim().slice(0, 300) || null;
  const now = new Date();
  const pending = await db.eventCohost.findMany({ where: { eventId, status: "PENDING" }, select: { id: true } });
  await db.$transaction(async (tx) => {
    await tx.event.update({ where: { id: eventId }, data: { status: "CANCELLED" } });
    await tx.eventOccurrence.updateMany({ where: { eventId, status: "SCHEDULED", startsAt: { gte: now } }, data: { status: "CANCELLED", note } });
    for (const p of pending) await resolveTasks("cohost", p.id, a.id, tx, "CANCELLED");
    await logActivity({ actorId: a.id, action: "event.cancelled", entityType: "event", entityId: eventId, clubId: event.clubId, data: { title: event.title, reason: note } }, tx);
  });
  if (club) await tellCohostsAboutChange(event, club, a, "cancelled");
  await mirror(eventId, a);
  return { id: event.id };
}

/** Undo a cancellation: upcoming meetings go back on the calendar. */
export async function restoreEvent(actor: Actor | null, eventId: string) {
  const { actor: a, event } = await loadManaged(actor, eventId);
  if (event.status !== "CANCELLED") return { id: event.id };
  await db.$transaction(async (tx) => {
    await tx.event.update({ where: { id: eventId }, data: { status: "SCHEDULED" } });
    await tx.eventOccurrence.updateMany({ where: { eventId, status: "CANCELLED", startsAt: { gte: new Date() } }, data: { status: "SCHEDULED", note: null } });
    await logActivity({ actorId: a.id, action: "event.restored", entityType: "event", entityId: eventId, clubId: event.clubId }, tx);
  });
  await mirror(eventId, a);
  return { id: event.id };
}

async function loadManagedOccurrence(actor: Actor | null, occurrenceId: string) {
  const occ = await db.eventOccurrence.findUnique({ where: { id: occurrenceId }, include: { event: true } });
  if (!occ) throw notFound("Meeting");
  const host = await assertHost(actor, occ.event.clubId);
  return { occ, ...host };
}

/** Cancel one meeting of an event (others stay). */
export async function cancelOccurrence(actor: Actor | null, occurrenceId: string, note?: string | null) {
  const { actor: a, occ } = await loadManagedOccurrence(actor, occurrenceId);
  if (occ.status === "CANCELLED") return { id: occ.id };
  await db.eventOccurrence.update({ where: { id: occ.id }, data: { status: "CANCELLED", note: note?.trim().slice(0, 300) || null } });
  await logActivity({ actorId: a.id, action: "event.occurrence_cancelled", entityType: "occurrence", entityId: occ.id, clubId: occ.event.clubId, data: { eventId: occ.eventId, startsAt: occ.startsAt.toISOString() } });
  await mirror(occ.eventId, a);
  return { id: occ.id };
}

export async function restoreOccurrence(actor: Actor | null, occurrenceId: string) {
  const { actor: a, occ } = await loadManagedOccurrence(actor, occurrenceId);
  if (occ.status === "SCHEDULED") return { id: occ.id };
  await db.$transaction(async (tx) => {
    await tx.eventOccurrence.update({ where: { id: occ.id }, data: { status: "SCHEDULED", note: null } });
    // Bringing back a meeting of a cancelled event brings the event back too.
    if (occ.event.status === "CANCELLED") await tx.event.update({ where: { id: occ.eventId }, data: { status: "SCHEDULED" } });
    await logActivity({ actorId: a.id, action: "event.occurrence_restored", entityType: "occurrence", entityId: occ.id, clubId: occ.event.clubId, data: { eventId: occ.eventId } }, tx);
  });
  await mirror(occ.eventId, a);
  return { id: occ.id };
}

/** A different room for one meeting (null = the event's usual room). */
export async function setOccurrenceRoom(actor: Actor | null, occurrenceId: string, room: string | null) {
  const { actor: a, occ } = await loadManagedOccurrence(actor, occurrenceId);
  const clean = room?.trim().slice(0, 60) || null;
  await db.eventOccurrence.update({ where: { id: occ.id }, data: { roomOverride: clean } });
  await logActivity({ actorId: a.id, action: "event.room_changed", entityType: "occurrence", entityId: occ.id, clubId: occ.event.clubId, data: { room: clean } });
  return { id: occ.id };
}

/** Delete an event or idea. Events with check-ins can only be cancelled, so attendance history stays. */
export async function deleteEvent(actor: Actor | null, eventId: string) {
  const { actor: a, event } = await loadManaged(actor, eventId);
  const [attended, requirement] = await Promise.all([
    db.attendance.count({ where: { occurrence: { eventId } } }),
    db.roleRequirement.findFirst({ where: { trainingEventId: eventId, active: true }, select: { name: true } }),
  ]);
  if (attended > 0) throw conflict("People already checked in to this event, so it can't be deleted. Cancel it instead — its history stays.");
  if (requirement) throw conflict(`This training is the officer requirement “${requirement.name}”. Change that requirement first, or cancel the event instead.`);
  const cohosts = await db.eventCohost.findMany({ where: { eventId }, select: { id: true } });
  await db.$transaction(async (tx) => {
    for (const c of cohosts) await resolveTasks("cohost", c.id, a.id, tx, "CANCELLED");
    await tx.event.delete({ where: { id: eventId } });
    await logActivity({ actorId: a.id, action: event.status === "DRAFT" ? "event.idea_deleted" : "event.deleted", entityType: "event", entityId: eventId, clubId: event.clubId, data: { title: event.title } }, tx);
  });
  await removeEventFromGoogle({ googleEventId: event.googleEventId, clubId: event.clubId });
  return { id: eventId };
}

// ─── Co-host decisions ───────────────────────────────────────────────────────

/**
 * The invited club's "events" holders accept or decline. An accepted club may
 * later decline to take the event off its calendar.
 */
export async function decideCohost(actor: Actor | null, cohostId: string, approve: boolean) {
  const c = await db.eventCohost.findUnique({
    where: { id: cohostId },
    include: { club: { select: { id: true, name: true } }, event: { select: { id: true, title: true, clubId: true, club: { select: { slug: true } } } } },
  });
  if (!c) throw notFound("Co-host request");
  await assertClubCap(actor, c.clubId, "events");
  const leaving = c.status === "APPROVED" && !approve;
  if (c.status !== "PENDING" && !leaving) throw conflict("This request was already decided.");
  const updated = await db.eventCohost.update({ where: { id: c.id }, data: { status: approve ? "APPROVED" : "DECLINED", decidedById: actor!.id, decidedAt: new Date() } });
  await resolveTasks("cohost", c.id, actor!.id);
  await logActivity({
    actorId: actor!.id,
    action: approve ? "event.cohost_approved" : leaving ? "event.cohost_left" : "event.cohost_declined",
    entityType: "cohost",
    entityId: c.id,
    clubId: c.clubId,
    data: { eventId: c.eventId, title: c.event.title },
    isPublic: approve,
  });
  if (c.event.clubId) {
    await notifyClubCapability(c.event.clubId, "events", {
      kind: approve ? "event.cohost_approved" : "event.cohost_declined",
      title: approve ? `${c.club.name} will co-host “${c.event.title}”` : leaving ? `${c.club.name} stepped back from co-hosting “${c.event.title}”` : `${c.club.name} declined to co-host “${c.event.title}”`,
      href: c.event.club ? `/clubs/${c.event.club.slug}/manage/events?tab=cohosts` : `/events/${c.eventId}`,
      exceptUserId: actor!.id,
      email: false,
    });
  }
  return updated;
}

// ─── Event costs (one line at a time) ────────────────────────────────────────

async function loadCostHost(actor: Actor | null, eventId: string) {
  const { actor: a, club, event } = await loadManaged(actor, eventId);
  if (!club) throw invalid("University events don't carry club costs.");
  return { a, club, event };
}

async function costTermFor(eventId: string) {
  const [first, terms] = await Promise.all([
    db.eventOccurrence.findFirst({ where: { eventId, status: "SCHEDULED" }, orderBy: { startsAt: "asc" }, select: { startsAt: true } }),
    getTerms(),
  ]);
  return requireBudgetTerm(terms, first?.startsAt ?? new Date());
}

export async function addEventCost(actor: Actor | null, eventId: string, input: unknown) {
  const c = parse(CostSchema, input);
  const { a, club } = await loadCostHost(actor, eventId);
  const item = await db.budgetItem.create({ data: { ...costData(c, club), clubId: club.id, eventId, termId: await costTermFor(eventId), createdById: a.id } });
  await logActivity({ actorId: a.id, action: "event.cost_added", entityType: "budgetItem", entityId: item.id, clubId: club.id, data: { eventId, cents: lineCents(item) } });
  return item;
}

export async function updateEventCost(actor: Actor | null, itemId: string, input: unknown) {
  const c = parse(CostSchema, input);
  const item = await db.budgetItem.findUnique({ where: { id: itemId } });
  if (!item?.eventId) throw notFound("Cost line");
  const { a, club } = await loadCostHost(actor, item.eventId);
  const updated = await db.budgetItem.update({ where: { id: item.id }, data: costData(c, club) });
  await logActivity({ actorId: a.id, action: "event.cost_updated", entityType: "budgetItem", entityId: item.id, clubId: club.id, data: { eventId: item.eventId, cents: lineCents(updated) } });
  return updated;
}

export async function removeEventCost(actor: Actor | null, itemId: string) {
  const item = await db.budgetItem.findUnique({ where: { id: itemId } });
  if (!item?.eventId) throw notFound("Cost line");
  const { a, club } = await loadCostHost(actor, item.eventId);
  await db.budgetItem.delete({ where: { id: item.id } });
  await logActivity({ actorId: a.id, action: "event.cost_removed", entityType: "budgetItem", entityId: item.id, clubId: club.id, data: { eventId: item.eventId } });
  return { id: item.id };
}

