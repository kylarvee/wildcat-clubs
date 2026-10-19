import type { ClubCategory, ClubScope, ClubType } from "@prisma/client";
import { CLUB_CATEGORIES, CLUB_SCOPES, CLUB_TYPES, STANDING_LABEL } from "@/lib/labels/clubs";
import { ACTIVITY_SCORE_LABEL } from "@/lib/metrics/pure";

/**
 * The clubs list lives in the URL (?q=&type=&sort=…), so every view is a
 * shareable link. Server pages and the client filter bar both parse it here.
 */

export const CLUB_SORTS = ["recommended", "relevance", "name", "rating", "members", "retention", "activity", "college", "major", "type"] as const;
export type ClubSort = (typeof CLUB_SORTS)[number];

export const SORT_LABEL: Record<ClubSort, string> = {
  recommended: "Recommended",
  relevance: "Best match",
  name: "Name",
  rating: "Student rating",
  members: "Attending members",
  retention: "Retention",
  /** lib/metrics ACTIVITY SCORE: held events in the last 30 days. */
  activity: ACTIVITY_SCORE_LABEL,
  college: "College",
  major: "Major or discipline",
  type: "Club type",
};

/** Numbers read best high → low; words read best A → Z. */
export const SORT_DEFAULT_DIR: Record<ClubSort, "asc" | "desc"> = {
  recommended: "desc",
  relevance: "desc",
  name: "asc",
  rating: "desc",
  members: "desc",
  retention: "desc",
  activity: "desc",
  college: "asc",
  major: "asc",
  type: "asc",
};

/** Ranked sorts (lib/search/rank) always list the best first, so they take no direction. */
export function isRankedSort(sort: ClubSort): sort is "recommended" | "relevance" {
  return sort === "recommended" || sort === "relevance";
}

/** The order a list gets when the URL doesn't name one: Best match while searching, Recommended otherwise. */
export function defaultSort(q: string): ClubSort {
  return q ? "relevance" : "recommended";
}

export const STATUS_FILTERS = ["active", "pilot", "inactive"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
/** Standing filters (lib/labels/clubs). "Active" includes clubs in their pilot period, which count as active. */
export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = STANDING_LABEL;

export type ClubListParams = {
  q: string;
  type: ClubType | null;
  category: ClubCategory | null;
  college: string | null; // college slug
  scope: ClubScope | null;
  status: StatusFilter | null;
  mine: boolean;
  archived: boolean;
  sort: ClubSort;
  dir: "asc" | "desc";
  view: "grid" | "list";
};

type Raw = Record<string, string | string[] | undefined> | URLSearchParams;

function get(raw: Raw, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const v = raw[key];
  return Array.isArray(v) ? v[0] : v;
}

function oneOf<T extends string>(value: string | undefined, options: readonly T[]): T | null {
  return value && (options as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseClubListParams(raw: Raw): ClubListParams {
  const q = (get(raw, "q") ?? "").trim().slice(0, 100);
  const askedDir = oneOf(get(raw, "dir"), ["asc", "desc"] as const);
  // Links from before Recommended existed: a direction without a sort meant the A–Z list.
  let sort: ClubSort = oneOf(get(raw, "sort"), CLUB_SORTS) ?? (askedDir ? "name" : defaultSort(q));
  // Best match needs something to match.
  if (sort === "relevance" && !q) sort = "recommended";
  const dir = isRankedSort(sort) ? "desc" : (askedDir ?? SORT_DEFAULT_DIR[sort]);
  const college = get(raw, "college");
  return {
    q,
    type: oneOf(get(raw, "type"), CLUB_TYPES),
    category: oneOf(get(raw, "category"), CLUB_CATEGORIES),
    college: college && /^[a-z0-9-]{1,80}$/.test(college) ? college : null,
    scope: oneOf(get(raw, "scope"), CLUB_SCOPES),
    status: oneOf(get(raw, "status"), STATUS_FILTERS),
    mine: get(raw, "mine") === "1",
    archived: get(raw, "archived") === "1",
    sort,
    dir,
    view: get(raw, "view") === "list" ? "list" : "grid",
  };
}

/** Builds a /clubs URL, leaving defaults out so links stay short. */
export function clubListHref(p: ClubListParams, patch: Partial<ClubListParams> = {}): string {
  const n = { ...p, ...patch };
  // A new search (or clearing it) moves a list that was in its default order to the new default: Best match ⇄ Recommended.
  if (patch.q !== undefined && !patch.sort && p.sort === defaultSort(p.q)) n.sort = defaultSort(n.q);
  if (n.sort === "relevance" && !n.q) n.sort = "recommended";
  // Changing the sort resets the direction to that sort's natural one unless one was given.
  if (patch.sort && !patch.dir) n.dir = SORT_DEFAULT_DIR[n.sort];
  if (isRankedSort(n.sort)) n.dir = "desc";
  const s = new URLSearchParams();
  if (n.q) s.set("q", n.q);
  if (n.type) s.set("type", n.type);
  if (n.category) s.set("category", n.category);
  if (n.college) s.set("college", n.college);
  if (n.scope) s.set("scope", n.scope);
  if (n.status) s.set("status", n.status);
  if (n.mine) s.set("mine", "1");
  if (n.archived) s.set("archived", "1");
  if (n.sort !== defaultSort(n.q)) s.set("sort", n.sort);
  if (n.dir !== SORT_DEFAULT_DIR[n.sort]) s.set("dir", n.dir);
  if (n.view !== "grid") s.set("view", n.view);
  const qs = s.toString();
  return qs ? `/clubs?${qs}` : "/clubs";
}

export function hasActiveFilters(p: ClubListParams) {
  return Boolean(p.q || p.type || p.category || p.college || p.scope || p.status || p.mine);
}
