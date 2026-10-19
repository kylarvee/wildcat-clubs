import type { ClubScope, ClubStatus, ClubType } from "@prisma/client";
import type { RetentionSummary } from "@/lib/metrics/types";
import { CLUB_STATUS_LABEL, CLUB_TYPE_LABEL, CLUB_TYPES, STANDING_HINT, STANDING_LABEL, STANDING_TONE } from "@/lib/labels/clubs";
import { GAP_LABEL } from "@/lib/staffing/rules";

/**
 * The admin club-analytics table: one row per club, with filters, sorting and
 * the CSV columns. Pure and client-safe — the page builds rows on the server
 * (lib/analytics/clubs), the table filters and sorts them in the browser, and
 * the CSV export applies these same functions to the same query string, so
 * the download always matches what's on screen.
 */

/** Where a club stands: the activity standing for approved clubs, else its lifecycle stage. */
export type ClubStage = "active" | "pilot" | "inactive" | "founding" | "retired" | "rejected";

export type ClubAnalyticsRow = {
  id: string;
  name: string;
  slug: string;
  type: ClubType;
  status: ClubStatus;
  stage: ClubStage;
  scope: ClubScope;
  collegeId: string | null;
  collegeName: string | null;
  collegeShort: string | null;
  /** Registered (ACTIVE) members. */
  registered: number;
  /** Attending members: active by attendance (lib/metrics). */
  active: number;
  /** Month RETENTION's rate (lib/metrics clubListMetrics: the latest two full months in a row with check-ins). */
  retention: number | null;
  /** The same figure with its months and label ("Sep → Oct: 62% came back"); null until there's one. */
  retentionSummary: RetentionSummary | null;
  /** Average member attendance rate over this term's held events (same as the Attendance Tracker). */
  avgAttendance: number | null;
  /** Held events this term (≥1 check-in), hosted or co-hosted. */
  heldEvents: number;
  rating: number | null;
  reviews: number;
  /** Clubs it shares cross-club attendance with in the last 12 months, and the total of those lines. */
  connections: number;
  crossCheckins: number;
  /** People in a President seat now, and the club's current advisors. */
  presidents: number;
  advisors: number;
};

/** Type names (lib/labels/clubs), under the name analytics code imports. */
export const CLUB_TYPE_NAMES: Record<ClubType, string> = CLUB_TYPE_LABEL;

/** Approved clubs by standing, then the other recognition stages. Labels come from lib/labels/clubs. */
export const STAGES: { key: ClubStage; label: string; hint: string }[] = [
  { key: "active", label: STANDING_LABEL.active, hint: STANDING_HINT.active },
  { key: "pilot", label: STANDING_LABEL.pilot, hint: STANDING_HINT.pilot },
  { key: "inactive", label: STANDING_LABEL.inactive, hint: STANDING_HINT.inactive },
  { key: "founding", label: "In founding", hint: "Draft, in WSUSA review, or sent back for changes" },
  { key: "retired", label: CLUB_STATUS_LABEL.RETIRED, hint: "Wound down; history kept" },
  { key: "rejected", label: CLUB_STATUS_LABEL.REJECTED, hint: "WSUSA decided not to approve it" },
];

export const STAGE_TONE: Record<ClubStage, "success" | "info" | "warning" | "neutral" | "brand" | "danger"> = {
  ...STANDING_TONE,
  founding: "brand",
  retired: "neutral",
  rejected: "neutral",
};

/** The badge text for a row: "Active", "Pilot period", "Draft", "In WSUSA review"… */
export function stageLabel(row: Pick<ClubAnalyticsRow, "stage" | "status">): string {
  if (row.stage === "founding") return CLUB_STATUS_LABEL[row.status];
  return STAGES.find((s) => s.key === row.stage)!.label;
}

export function stageOf(status: ClubStatus, activity: { active: boolean; inPilot: boolean } | undefined): ClubStage {
  if (status === "APPROVED") return activity?.inPilot ? "pilot" : activity?.active ? "active" : "inactive";
  if (status === "RETIRED") return "retired";
  if (status === "REJECTED") return "rejected";
  return "founding";
}

// ─── Leaders ─────────────────────────────────────────────────────────────────

/** The leaders an approved club can be missing (lib/staffing/rules' first two gaps): the No President and No advisor filters. */
export type MissingLeader = "president" | "advisor";

export const MISSING_FILTERS: { key: MissingLeader; label: string }[] = [
  { key: "president", label: GAP_LABEL.president },
  { key: "advisor", label: GAP_LABEL.advisor },
];

/** What an approved club is missing right now. Founding, retired and rejected clubs aren't counted. */
export function missingLeaders(row: Pick<ClubAnalyticsRow, "status" | "presidents" | "advisors">): MissingLeader[] {
  if (row.status !== "APPROVED") return [];
  const out: MissingLeader[] = [];
  if (row.presidents === 0) out.push("president");
  if (row.advisors === 0) out.push("advisor");
  return out;
}

// ─── Filters & sorting ──────────────────────────────────────────────────────

export type SortKey = "name" | "stage" | "registered" | "active" | "retention" | "attendance" | "events" | "rating" | "connections";
export type SortDir = "asc" | "desc";
/** "approved" = active + pilot + inactive. */
export type StageFilter = ClubStage | "approved";

export type TableFilters = {
  q: string;
  /** A college id, or "none" for clubs that aren't part of a college. */
  college: string | null;
  type: ClubType | null;
  stage: StageFilter | null;
  /** Approved clubs with no President, or with no advisor. */
  missing: MissingLeader | null;
  sort: SortKey;
  dir: SortDir;
};

export const SORT_KEYS: SortKey[] = ["name", "stage", "registered", "active", "retention", "attendance", "events", "rating", "connections"];
const WORD_SORTS: SortKey[] = ["name", "stage"];
const TYPES: ClubType[] = CLUB_TYPES;
const STAGE_FILTERS: StageFilter[] = ["approved", "active", "pilot", "inactive", "founding", "retired", "rejected"];

/** Words sort A–Z first, numbers high-to-low first (the clubs list does the same). */
export function defaultDir(sort: SortKey): SortDir {
  return WORD_SORTS.includes(sort) ? "asc" : "desc";
}

export const DEFAULT_FILTERS: TableFilters = { q: "", college: null, type: null, stage: null, missing: null, sort: "name", dir: "asc" };

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;
function read(src: ParamSource, key: string): string | null {
  if (src instanceof URLSearchParams) return src.get(key);
  const v = src[key];
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

export function parseTableFilters(src: ParamSource): TableFilters {
  const sort = SORT_KEYS.find((k) => k === read(src, "sort")) ?? DEFAULT_FILTERS.sort;
  const dirRaw = read(src, "dir");
  return {
    q: (read(src, "q") ?? "").trim().slice(0, 100),
    college: read(src, "college") || null,
    type: TYPES.find((t) => t === read(src, "type")) ?? null,
    stage: STAGE_FILTERS.find((s) => s === read(src, "status")) ?? null,
    missing: MISSING_FILTERS.find((m) => m.key === read(src, "missing"))?.key ?? null,
    sort,
    dir: dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaultDir(sort),
  };
}

/** The query string for a set of filters (defaults left out, so URLs stay short). */
export function filtersToQuery(f: TableFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.college) p.set("college", f.college);
  if (f.type) p.set("type", f.type);
  if (f.stage) p.set("status", f.stage);
  if (f.missing) p.set("missing", f.missing);
  if (f.sort !== DEFAULT_FILTERS.sort) p.set("sort", f.sort);
  if (f.dir !== defaultDir(f.sort)) p.set("dir", f.dir);
  return p.toString();
}

export function hasFilters(f: TableFilters) {
  return Boolean(f.q || f.college || f.type || f.stage || f.missing);
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filterRows(rows: ClubAnalyticsRow[], f: TableFilters): ClubAnalyticsRow[] {
  const q = fold(f.q.trim());
  return rows.filter((r) => {
    if (q && !fold(r.name).includes(q)) return false;
    if (f.college && (f.college === "none" ? r.collegeId !== null : r.collegeId !== f.college)) return false;
    if (f.type && r.type !== f.type) return false;
    if (f.stage === "approved" ? r.status !== "APPROVED" : f.stage && r.stage !== f.stage) return false;
    if (f.missing && !missingLeaders(r).includes(f.missing)) return false;
    return true;
  });
}

const STAGE_ORDER: Record<ClubStage, number> = { active: 0, pilot: 1, inactive: 2, founding: 3, retired: 4, rejected: 5 };

function value(r: ClubAnalyticsRow, key: SortKey): string | number | null {
  switch (key) {
    case "name":
      return r.name;
    case "stage":
      return STAGE_ORDER[r.stage];
    case "registered":
      return r.registered;
    case "active":
      return r.active;
    case "retention":
      return r.retention;
    case "attendance":
      return r.avgAttendance;
    case "events":
      return r.heldEvents;
    case "rating":
      return r.rating;
    case "connections":
      return r.crossCheckins;
  }
}

/** Sorted copy. Missing values always go last, whichever way the column is sorted; ties fall back to the name. */
export function sortRows(rows: ClubAnalyticsRow[], sort: SortKey, dir: SortDir): ClubAnalyticsRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a, sort);
    const vb = value(b, sort);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) {
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      if (c !== 0) return c * sign;
    }
    return a.name.localeCompare(b.name);
  });
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

const pctCell = (r: number | null) => (r === null ? "" : Math.round(r * 1000) / 10);

/** Header + one line per club. Rates are percentages (one decimal); blanks mean "no data yet". `link` turns a path into a full URL. */
export function csvRows(rows: ClubAnalyticsRow[], termName: string | null, link: (path: string) => string = (p) => p): (string | number | null)[][] {
  const term = termName ? ` (${termName})` : " (this term)";
  return [
    [
      "Club",
      "Type",
      "College",
      "Status",
      "Registered members",
      "Attending members",
      "Retention (%)",
      "Retention months",
      `Average attendance rate${term} (%)`,
      `Events held${term}`,
      "Average rating",
      "Reviews",
      "Connected clubs (12 months)",
      "Cross-club check-ins (12 months)",
      "Presidents",
      "Advisors",
      "Club page",
    ],
    ...rows.map((r) => [
      r.name,
      CLUB_TYPE_NAMES[r.type],
      r.collegeName ?? "",
      stageLabel(r),
      r.registered,
      r.active,
      pctCell(r.retention),
      r.retentionSummary ? `${r.retentionSummary.from} → ${r.retentionSummary.to}` : "",
      pctCell(r.avgAttendance),
      r.heldEvents,
      r.rating === null ? "" : Math.round(r.rating * 10) / 10,
      r.reviews,
      r.connections,
      r.crossCheckins,
      r.presidents,
      r.advisors,
      link(`/clubs/${r.slug}`),
    ]),
  ];
}
