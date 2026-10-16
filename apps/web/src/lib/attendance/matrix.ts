import type { CheckInMethod, MembershipStatus } from "@prisma/client";

/**
 * The attendance tracker's table: people × occurrences, with per-row and
 * per-column totals. Pure so it can be tested; the definitions mirror
 * lib/metrics (pure.ts) exactly:
 *
 *  • member at time t  — joinedAt ≤ t, not ended at or before t, and not a
 *                        pending/declined request (metrics wasMemberAt)
 *  • held occurrence   — has ≥1 check-in (callers pass only started occurrences)
 *  • column rate       — members who checked in ÷ members at the time, ≤ 100%
 *  • row rate          — check-ins ÷ held events since they got involved (the
 *                        earlier of joining and their first check-in), ≤ 100%
 *                        — the same rule as memberClubSummary, within the range
 *
 * Rows are current ACTIVE members; everyone else who checked in is a guest
 * (FORMER if they used to be a member).
 */

export type MxOccurrence = { id: string; startsAt: Date };
export type MxCheckin = { id: string; occurrenceId: string; userId: string; method: CheckInMethod; checkedInAt: Date; recordedById?: string | null };
export type MxMembership = { userId: string; status: MembershipStatus; joinedAt: Date | null; endedAt: Date | null };

export type MxCell = { attendanceId: string; method: CheckInMethod; checkedInAt: Date; recordedById: string | null; asMember: boolean };

export type MxColumn<O extends MxOccurrence = MxOccurrence> = {
  occurrence: O;
  held: boolean;
  total: number;
  memberAttendees: number;
  guests: number;
  membersAtTime: number;
  rate: number | null;
};

export type MxRow = {
  userId: string;
  kind: "MEMBER" | "FORMER" | "GUEST";
  cells: Map<string, MxCell>;
  attended: number;
  attendedAsMember: number;
  /** Held occurrences since they got involved (the rate's denominator). */
  eligible: number;
  rate: number | null;
  lastAttendedAt: Date | null;
};

export type Matrix<O extends MxOccurrence = MxOccurrence> = {
  columns: MxColumn<O>[];
  members: MxRow[];
  guests: MxRow[];
  summary: { events: number; held: number; checkins: number; memberCheckins: number; guestCheckins: number; uniqueAttendees: number; uniqueGuests: number; avgRate: number | null };
};

export function memberAt(m: (Pick<MxMembership, "joinedAt" | "endedAt"> & { status?: string }) | null | undefined, at: Date): boolean {
  if (!m?.joinedAt || m.status === "PENDING" || m.status === "DECLINED") return false;
  const t = at.getTime();
  return m.joinedAt.getTime() <= t && (!m.endedAt || m.endedAt.getTime() > t);
}

/** Column numbers from lib/metrics (clubAttendanceByOccurrence), when the caller has them. */
export type ColumnStats = { memberAttendees: number; guests: number; membersAtTime: number; rate: number | null };

export function buildMatrix<O extends MxOccurrence>(input: {
  occurrences: O[];
  checkins: MxCheckin[];
  memberships: MxMembership[];
  /** People with check-ins at this club before the range (their involvement started earlier). */
  involvedBefore?: ReadonlySet<string>;
  /** Overrides per-column numbers so the table matches every other screen exactly. */
  columnStats?: ReadonlyMap<string, ColumnStats>;
}): Matrix<O> {
  const occurrences = [...input.occurrences].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const occById = new Map(occurrences.map((o) => [o.id, o]));
  const membershipOf = new Map(input.memberships.map((m) => [m.userId, m]));
  const checkins = input.checkins.filter((c) => occById.has(c.occurrenceId));

  // Cells, keyed by person.
  const cellsByUser = new Map<string, Map<string, MxCell>>();
  const byOccurrence = new Map<string, MxCheckin[]>();
  for (const c of checkins) {
    const occ = occById.get(c.occurrenceId)!;
    const asMember = memberAt(membershipOf.get(c.userId), occ.startsAt);
    let cells = cellsByUser.get(c.userId);
    if (!cells) cellsByUser.set(c.userId, (cells = new Map()));
    cells.set(c.occurrenceId, { attendanceId: c.id, method: c.method, checkedInAt: c.checkedInAt, recordedById: c.recordedById ?? null, asMember });
    const list = byOccurrence.get(c.occurrenceId) ?? [];
    list.push(c);
    byOccurrence.set(c.occurrenceId, list);
  }

  const columns: MxColumn<O>[] = occurrences.map((occurrence) => {
    const list = byOccurrence.get(occurrence.id) ?? [];
    const held = list.length > 0;
    const given = input.columnStats?.get(occurrence.id);
    if (given) return { occurrence, held, total: list.length, ...given, rate: held ? given.rate : null };
    const memberAttendees = list.filter((c) => memberAt(membershipOf.get(c.userId), occurrence.startsAt)).length;
    const membersAtTime = input.memberships.filter((m) => memberAt(m, occurrence.startsAt)).length;
    return {
      occurrence,
      held,
      total: list.length,
      memberAttendees,
      guests: list.length - memberAttendees,
      membersAtTime,
      rate: held && membersAtTime > 0 ? Math.min(1, memberAttendees / membersAtTime) : null,
    };
  });
  const heldColumns = columns.filter((c) => c.held);

  const rowFor = (userId: string, kind: MxRow["kind"]): MxRow => {
    const cells = cellsByUser.get(userId) ?? new Map<string, MxCell>();
    const m = membershipOf.get(userId);
    let attendedAsMember = 0;
    let last: Date | null = null;
    let first = Infinity;
    for (const [occId, cell] of cells) {
      if (cell.asMember) attendedAsMember++;
      if (!last || cell.checkedInAt > last) last = cell.checkedInAt;
      first = Math.min(first, occById.get(occId)!.startsAt.getTime());
    }
    let eligible = 0;
    if (kind === "MEMBER") {
      const joined = m?.joinedAt && m.status !== "PENDING" && m.status !== "DECLINED" ? m.joinedAt.getTime() : Infinity;
      const since = input.involvedBefore?.has(userId) ? -Infinity : Math.min(joined, first);
      eligible = heldColumns.filter((c) => c.occurrence.startsAt.getTime() >= since).length;
    }
    return {
      userId,
      kind,
      cells,
      attended: cells.size,
      attendedAsMember,
      eligible,
      rate: kind === "MEMBER" && eligible > 0 ? Math.min(1, cells.size / eligible) : null,
      lastAttendedAt: last,
    };
  };

  const activeIds = new Set(input.memberships.filter((m) => m.status === "ACTIVE").map((m) => m.userId));
  const members = [...activeIds].map((id) => rowFor(id, "MEMBER"));
  const guests = [...cellsByUser.keys()].filter((id) => !activeIds.has(id)).map((id) => rowFor(id, membershipOf.get(id)?.joinedAt ? "FORMER" : "GUEST"));

  const rates = heldColumns.map((c) => c.rate).filter((r): r is number => r !== null);
  const memberCheckins = columns.reduce((n, c) => n + c.memberAttendees, 0);
  return {
    columns,
    members,
    guests,
    summary: {
      events: columns.length,
      held: heldColumns.length,
      checkins: checkins.length,
      memberCheckins,
      guestCheckins: checkins.length - memberCheckins,
      uniqueAttendees: cellsByUser.size,
      uniqueGuests: guests.length,
      avgRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    },
  };
}

export type RowSort = "name" | "attended" | "rate" | "recent";

/** Sorts rows for display. `nameOf` supplies names (the matrix only knows ids). */
export function sortRows(rows: MxRow[], by: RowSort, nameOf: (userId: string) => string): MxRow[] {
  const byName = (a: MxRow, b: MxRow) => nameOf(a.userId).localeCompare(nameOf(b.userId));
  const list = [...rows];
  switch (by) {
    case "attended":
      return list.sort((a, b) => b.attended - a.attended || byName(a, b));
    case "rate":
      // People with no rate yet (joined after every held event) sink to the bottom.
      return list.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.attended - a.attended || byName(a, b));
    case "recent":
      return list.sort((a, b) => (b.lastAttendedAt?.getTime() ?? 0) - (a.lastAttendedAt?.getTime() ?? 0) || byName(a, b));
    default:
      return list.sort(byName);
  }
}

// ─── CSV ────────────────────────────────────────────────────────────────────

/**
 * RFC 4180 CSV. Cells that a spreadsheet would run as a formula (=, +, -, @)
 * get a leading apostrophe, so a name like "=HYPERLINK(…)" stays text.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** 0.6667 → "67%"; null → "—". */
export function pct(rate: number | null | undefined, empty = "—") {
  return rate === null || rate === undefined || !Number.isFinite(rate) ? empty : `${Math.round(rate * 100)}%`;
}
