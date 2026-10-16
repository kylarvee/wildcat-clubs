"use client";

/**
 * CONTRACT (owner: events builder). Read-only calendar fed by
 * GET /api/calendar?scope=club&clubId=…  |  scope=me  |  scope=university
 * (JSON events built from EventOccurrence). Google-Calendar-like month/week/list
 * views; clicking an event opens its details. The Events Builder has its own
 * editable calendar.
 * STUB.
 */
export type CalendarSource = { scope: "club"; clubId: string } | { scope: "me" } | { scope: "university" };

export type CalendarViewProps = {
  source: CalendarSource;
  initialView?: "dayGridMonth" | "timeGridWeek" | "listMonth";
  /** Smaller toolbar and list-first layout for sidebars and the club hero. */
  compact?: boolean;
  height?: number | "auto";
  className?: string;
};

export function CalendarView({ className }: CalendarViewProps) {
  return <div className={"rounded-xl border border-dashed border-line-2 p-6 text-center text-sm text-ink-3 " + (className ?? "")}>Calendar loading…</div>;
}
