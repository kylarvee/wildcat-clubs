import type { EventReview, EventRisk } from "@prisma/client";
import { z } from "zod";
import { toDateInput } from "@/lib/events/wallclock";

/**
 * Risk-based event review: the pure rules (client-safe, so the Events
 * Builder, the domain, the seed checks and the tests share them).
 *
 * The Events Builder asks "Does this event involve…" (RISK_FLAGS). With
 * review on (System settings `events.riskReview`), a club event with anything
 * checked waits for its club's office (lib/offices) before it's posted:
 * PENDING, an APPROVAL task in the office's queue. Until the office approves
 * it, only the club's leaders and that office see it (lib/authz/events), and
 * no notices, reminders or Google copies go out. The office approves it or
 * asks for changes with a note (CHANGES_REQUESTED, still hidden; the next
 * save sends it back for review). Re-review: an APPROVED (or NONE) event goes
 * back to PENDING when a save adds a flag or changes the travel details;
 * removing flags never needs review. University events (no club) are never
 * reviewed. With review off the answers are still saved, but nothing waits.
 */

export const RISK_FLAGS: readonly EventRisk[] = ["OUTDOOR_SPACE", "MINORS", "TRAVEL", "LARGE_CROWD", "MONEY", "ALCOHOL"];

/** The checklist's words ("Does this event involve…"), with the crowd threshold from System settings. */
export function riskLabel(flag: EventRisk, largeCrowd: number): string {
  switch (flag) {
    case "OUTDOOR_SPACE":
      return "An outdoor common space on campus";
    case "MINORS":
      return "People under 18";
    case "TRAVEL":
      return "Travel or an overnight stay";
    case "LARGE_CROWD":
      return `More than ${largeCrowd.toLocaleString("en-US")} people`;
    case "MONEY":
      return "Collecting money";
    case "ALCOHOL":
      return "Alcohol";
  }
}

/** Short words for badges and the review queue. */
export const RISK_SHORT: Record<EventRisk, string> = {
  OUTDOOR_SPACE: "Outdoor space",
  MINORS: "Under 18",
  TRAVEL: "Travel",
  LARGE_CROWD: "Large crowd",
  MONEY: "Collecting money",
  ALCOHOL: "Alcohol",
};

const RISK_PHRASE: Record<EventRisk, string> = {
  OUTDOOR_SPACE: "an outdoor common space",
  MINORS: "people under 18",
  TRAVEL: "travel",
  LARGE_CROWD: "a large crowd",
  MONEY: "collecting money",
  ALCOHOL: "alcohol",
};

/** "people under 18 and travel": what an event involves, for sentences. */
export function riskPhrase(flags: readonly EventRisk[]): string {
  const words = normalizeFlags(flags).map((f) => RISK_PHRASE[f]);
  return words.length <= 2 ? words.join(" and ") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The flags in checklist order, without repeats or unknown values. */
export function normalizeFlags(flags: readonly string[]): EventRisk[] {
  return RISK_FLAGS.filter((f) => flags.includes(f));
}

/** Waiting on the office (or on the club, after a request for changes): hidden from everyone but the club's leaders and the office. */
export const UNDER_REVIEW: readonly EventReview[] = ["PENDING", "CHANGES_REQUESTED"];

export function underReview(e: { reviewStatus?: EventReview | null }): boolean {
  return Boolean(e.reviewStatus && UNDER_REVIEW.includes(e.reviewStatus));
}

// ─── Travel ──────────────────────────────────────────────────────────────────

export type TravelDriver = { userId: string | null; name: string };

/** Event.travel, as stored (times are ISO strings). */
export type TravelPlan = { destination: string; departsAt: string; returnsAt: string; overnight: boolean; drivers: TravelDriver[]; notes: string | null };

const MAX_TRIP_DAYS = 21;

/** What the Events Builder sends with Travel checked. Times are instants (ISO, or Dates). */
export const TravelInput = z
  .object({
    destination: z.string({ error: "Add where you're going." }).trim().min(2, "Add where you're going.").max(200, "Keep the destination under 200 characters."),
    departsAt: z.coerce.date({ error: "Add when you leave." }),
    returnsAt: z.coerce.date({ error: "Add when you're back." }),
    overnight: z.boolean({ error: "Say whether the trip is overnight." }),
    drivers: z
      .array(
        z.object({
          userId: z.string().trim().min(1).nullish(),
          name: z.string({ error: "Each driver needs a name." }).trim().min(2, "Each driver needs a name.").max(80, "Keep driver names under 80 characters."),
        }),
      )
      .max(20, "List up to 20 drivers.")
      .default([]),
    notes: z
      .string()
      .trim()
      .max(1000, "Keep the trip notes under 1,000 characters.")
      .nullish()
      .transform((v) => v || null),
  })
  .superRefine((t, ctx) => {
    if (Number.isNaN(t.departsAt.getTime())) return void ctx.addIssue({ code: "custom", path: ["departsAt"], message: "Add when you leave." });
    if (Number.isNaN(t.returnsAt.getTime())) return void ctx.addIssue({ code: "custom", path: ["returnsAt"], message: "Add when you're back." });
    if (t.returnsAt.getTime() <= t.departsAt.getTime()) ctx.addIssue({ code: "custom", path: ["returnsAt"], message: "The trip has to come back after it leaves." });
    else if (t.returnsAt.getTime() - t.departsAt.getTime() > MAX_TRIP_DAYS * 86_400_000) ctx.addIssue({ code: "custom", path: ["returnsAt"], message: `Trips can last up to ${MAX_TRIP_DAYS} days.` });
    else if (t.overnight && toDateInput(t.returnsAt) === toDateInput(t.departsAt)) ctx.addIssue({ code: "custom", path: ["overnight"], message: "An overnight trip comes back on a later day. Check the dates, or choose “No” for overnight." });
  });

export type TravelInputValue = z.input<typeof TravelInput>;

/**
 * The parsed trip as it's stored: drivers without repeats (by person, else by
 * name). Checks that the trip covers a one-time event's date (it can't come
 * back before the event starts or leave after it ends). Returns the plan or
 * the first problem, worded for the builder.
 */
export function travelPlan(input: unknown, event: { startsAt: Date; endsAt: Date; repeats: boolean }): { ok: true; plan: TravelPlan } | { ok: false; error: string } {
  const r = TravelInput.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "Check the trip details." };
  const t = r.data;
  if (!event.repeats && (t.returnsAt.getTime() < event.startsAt.getTime() || t.departsAt.getTime() > event.endsAt.getTime())) {
    return { ok: false, error: "The trip should cover the event: leave before it ends and come back after it starts." };
  }
  const seen = new Set<string>();
  const drivers: TravelDriver[] = [];
  for (const d of t.drivers) {
    const key = d.userId ? `u:${d.userId}` : `n:${d.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    drivers.push({ userId: d.userId ?? null, name: d.name });
  }
  return { ok: true, plan: { destination: t.destination, departsAt: t.departsAt.toISOString(), returnsAt: t.returnsAt.toISOString(), overnight: t.overnight, drivers, notes: t.notes } };
}

/** A stored Event.travel value read back (anything malformed reads as no trip). */
export function readTravel(json: unknown): TravelPlan | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const v = json as Record<string, unknown>;
  if (typeof v.destination !== "string" || typeof v.departsAt !== "string" || typeof v.returnsAt !== "string") return null;
  const drivers = Array.isArray(v.drivers)
    ? v.drivers.flatMap((d) => (d && typeof d === "object" && typeof (d as Record<string, unknown>).name === "string" ? [{ userId: typeof (d as Record<string, unknown>).userId === "string" ? ((d as Record<string, unknown>).userId as string) : null, name: (d as Record<string, unknown>).name as string }] : []))
    : [];
  return { destination: v.destination, departsAt: v.departsAt, returnsAt: v.returnsAt, overnight: v.overnight === true, drivers, notes: typeof v.notes === "string" && v.notes ? v.notes : null };
}

/** Same trip? (Any change to where, when, overnight, who drives or the notes counts.) */
export function sameTravel(a: TravelPlan | null, b: TravelPlan | null): boolean {
  if (!a || !b) return a === b;
  const norm = (t: TravelPlan) => JSON.stringify([t.destination.trim(), new Date(t.departsAt).getTime(), new Date(t.returnsAt).getTime(), t.overnight, t.drivers.map((d) => [d.userId ?? null, d.name.trim()]), t.notes?.trim() || null]);
  return norm(a) === norm(b);
}

// ─── What a save does to the review ──────────────────────────────────────────

export type ReviewBefore = { status: EventReview; flags: readonly EventRisk[]; travel: TravelPlan | null };

/**
 * After a save: the event's review status, and what happens to the office's
 * review task ("ensure": exactly one open, opened if missing and kept up to
 * date in place; "close": cancelled; "none"). `submitted` is true when the
 * save sends it to the office (new, or back for review), which is when the
 * office hears about it.
 */
export type ReviewOutcome = { status: EventReview; task: "ensure" | "close" | "none"; submitted: boolean };

export function reviewAfterSave(v: { club: boolean; reviewOn: boolean; before: ReviewBefore | null; flags: readonly EventRisk[]; travel: TravelPlan | null }): ReviewOutcome {
  const { before, flags } = v;
  // University events are WSUSA's own: never reviewed.
  if (!v.club) return { status: "NONE", task: before && UNDER_REVIEW.includes(before.status) ? "close" : "none", submitted: false };
  const waiting = before ? UNDER_REVIEW.includes(before.status) : false;
  // Review off: answers are saved, nothing waits (and nothing still waiting keeps waiting on a save).
  if (!v.reviewOn) return { status: waiting ? "NONE" : (before?.status ?? "NONE"), task: waiting ? "close" : "none", submitted: false };
  if (!before) return flags.length ? { status: "PENDING", task: "ensure", submitted: true } : { status: "NONE", task: "none", submitted: false };
  // Nothing left to review: removing flags never needs review.
  if (!flags.length) return { status: waiting ? "NONE" : before.status, task: waiting ? "close" : "none", submitted: false };
  if (before.status === "PENDING") return { status: "PENDING", task: "ensure", submitted: false };
  // Changes were asked for: saving sends it back.
  if (before.status === "CHANGES_REQUESTED") return { status: "PENDING", task: "ensure", submitted: true };
  // Published (approved, or never reviewed): a new flag or a different trip goes back to the office.
  const added = flags.some((f) => !before.flags.includes(f));
  const tripChanged = flags.includes("TRAVEL") && before.flags.includes("TRAVEL") && !sameTravel(before.travel, v.travel);
  if (added || tripChanged) return { status: "PENDING", task: "ensure", submitted: true };
  return { status: before.status, task: "none", submitted: false };
}

/** "Campus Recreation reviews events like this before they're posted. That usually takes 3 days." */
export function reviewLine(office: { name: string; reviewDays: number }): string {
  return `${office.name} reviews events like this before they're posted. That usually takes ${office.reviewDays} ${office.reviewDays === 1 ? "day" : "days"}.`;
}

/** What leaders see while it waits: "Waiting for Campus Recreation's review". */
export function waitingLabel(office: { name: string }): string {
  return `Waiting for ${office.name}'s review`;
}
