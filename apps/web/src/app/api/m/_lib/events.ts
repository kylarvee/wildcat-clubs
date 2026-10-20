import "server-only";
import type { Actor } from "@/lib/auth/session";
import { assertSignedIn, invalid } from "@/lib/domain/kit";
import { feedOccurrences, viewerContext, type FeedScope } from "@/lib/events/feed";
import { eventFilterWhere } from "@/lib/events/browse-where";
import { fromInputs, toDateInput } from "@/lib/events/wallclock";
import { DAY_MS } from "@/lib/time";
import { feedToMEvent } from "./serialize";
import type { MCalendar, MEventFilter } from "../_types";

const FILTERS: MEventFilter[] = ["all", "free-food", "service", "following"];
const DEFAULT_DAYS = 42;
const MAX_DAYS = 400;

/**
 * The mobile Events tab (GET /api/m/events): the web Events page's feed and
 * filters (lib/events/feed, lib/events/browse-where), one filter at a time.
 * "following" is the web's Mine; the rest look across everything the caller
 * may see.
 */
export async function eventsTabView(actor: Actor | null, input: { filter?: string | null; from?: string | null; to?: string | null }): Promise<MCalendar> {
  const filter = FILTERS.find((f) => f === (input.filter || "all"));
  if (!filter) throw invalid("Unknown events filter.");
  if (filter === "following") assertSignedIn(actor);
  const now = new Date();
  const from = input.from ? new Date(input.from) : fromInputs(toDateInput(now))!;
  const to = input.to ? new Date(input.to) : new Date(from.getTime() + DEFAULT_DAYS * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw invalid("That date range doesn't work. Pull to refresh and try again.");
  if (to.getTime() - from.getTime() > MAX_DAYS * DAY_MS) throw invalid("Ask for about a year at a time at most.");
  const ctx = await viewerContext(actor);
  const scope: FeedScope = filter === "following" ? { scope: "me" } : { scope: "all" };
  const where = eventFilterWhere(
    { type: null, category: null, food: filter === "free-food", stuff: false, service: filter === "service", online: false, following: false },
    { followedClubIds: ctx.subscribedClubIds },
  );
  const rows = await feedOccurrences(ctx, scope, { start: from, end: to }, { take: 1000, filter: where });
  return { from: from.toISOString(), to: to.toISOString(), events: rows.map((o) => feedToMEvent(o, now)) };
}
