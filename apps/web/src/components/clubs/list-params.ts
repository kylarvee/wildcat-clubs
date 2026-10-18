import type { ClubCategory, ClubScope, ClubType } from "@prisma/client";
import { CLUB_CATEGORIES, CLUB_SCOPES, CLUB_TYPES } from "@/components/clubs/labels";

/**
 * The clubs list lives in the URL (?q=&type=&sort=…), so every view is a
 * shareable link. Server pages and the client filter bar both parse it here.
 */

export const CLUB_SORTS = ["name", "rating", "members", "retention", "activity", "college", "major", "type"] as const;
export type ClubSort = (typeof CLUB_SORTS)[number];

export const SORT_LABEL: Record<ClubSort, string> = {
  name: "Name",
  rating: "Student rating",
  members: "Active members",
  retention: "Retention",
  activity: "Activity",
  college: "College",
  major: "Major or discipline",
  type: "Club type",
};

/** Numbers read best high → low; words read best A → Z. */
export const SORT_DEFAULT_DIR: Record<ClubSort, "asc" | "desc"> = {
  name: "asc",
  rating: "desc",
  members: "desc",
  retention: "desc",
  activity: "desc",
  college: "asc",
  major: "asc",
  type: "asc",
};

export const STATUS_FILTERS = ["active", "pilot", "inactive"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  active: "Active",
  pilot: "In pilot period",
  inactive: "Not active right now",
};

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
  const sort = oneOf(get(raw, "sort"), CLUB_SORTS) ?? "name";
  const dir = oneOf(get(raw, "dir"), ["asc", "desc"] as const) ?? SORT_DEFAULT_DIR[sort];
  const college = get(raw, "college");
  return {
    q: (get(raw, "q") ?? "").trim().slice(0, 100),
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
  // Changing the sort resets the direction to that sort's natural one unless one was given.
  if (patch.sort && !patch.dir) n.dir = SORT_DEFAULT_DIR[patch.sort];
  const s = new URLSearchParams();
  if (n.q) s.set("q", n.q);
  if (n.type) s.set("type", n.type);
  if (n.category) s.set("category", n.category);
  if (n.college) s.set("college", n.college);
  if (n.scope) s.set("scope", n.scope);
  if (n.status) s.set("status", n.status);
  if (n.mine) s.set("mine", "1");
  if (n.archived) s.set("archived", "1");
  if (n.sort !== "name") s.set("sort", n.sort);
  if (n.dir !== SORT_DEFAULT_DIR[n.sort]) s.set("dir", n.dir);
  if (n.view !== "grid") s.set("view", n.view);
  const qs = s.toString();
  return qs ? `/clubs?${qs}` : "/clubs";
}

export function hasActiveFilters(p: ClubListParams) {
  return Boolean(p.q || p.type || p.category || p.college || p.scope || p.status || p.mine);
}
