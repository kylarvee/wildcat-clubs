import type { FileScopeKind, Vis, VisSetting } from "@/lib/files/types";

/**
 * The visibility rules for Club Files, as pure functions so the domain
 * (one file or a whole folder at once), the explorer and the tests agree.
 * Client-safe. lib/domain/files.ts is still the only place that decides —
 * it calls these with facts it loaded through lib/authz.
 *
 *   Club files       PUBLIC anyone · MEMBERS club members · LEADERS officers+, advisors
 *   Personal files   PUBLIC anyone · MEMBERS any signed-in account · LEADERS owner only
 *   University files PUBLIC anyone · MEMBERS any signed-in account · LEADERS admins only
 *
 * INHERIT takes the folder's setting; at the top level it means MEMBERS.
 * Admins see everything, people always see what they uploaded, and a
 * FileGrant on an item or any folder above it lets that person in.
 */

export const TOP_LEVEL_DEFAULT: Vis = "MEMBERS";

export type VisNode = { parentId: string | null; visibility: VisSetting };

/**
 * Resolves INHERIT by walking up through `lookup`. Memoized per call site, so
 * a whole folder tree resolves in one pass. Unknown parents (outside the
 * loaded set) fall back to the top-level default.
 */
export function resolveVisibility(id: string, lookup: (id: string) => VisNode | undefined, memo: Map<string, Vis> = new Map()): Vis {
  const seen: string[] = [];
  let current: string | null = id;
  let result: Vis = TOP_LEVEL_DEFAULT;
  for (let depth = 0; current && depth < 64; depth++) {
    const cached = memo.get(current);
    if (cached) {
      result = cached;
      break;
    }
    const node = lookup(current);
    if (!node) break;
    seen.push(current);
    if (node.visibility !== "INHERIT") {
      result = node.visibility;
      break;
    }
    current = node.parentId;
  }
  for (const s of seen) memo.set(s, result);
  return result;
}

/** Ids from an item up to the top level (the item first). Stops on loops. */
export function ancestry(id: string, parentOf: (id: string) => string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let current: string | null | undefined = id;
  while (current && !seen.has(current) && out.length < 64) {
    seen.add(current);
    out.push(current);
    current = parentOf(current);
  }
  return out;
}

export type ViewerFacts = {
  userId: string | null;
  admin: boolean;
  /** Club scope: an active member (or anyone holding a role). */
  member: boolean;
  /** Club scope: ambassador and up, advisors. */
  leader: boolean;
};

/** Whether the audience an item is shared with includes this viewer (before uploader/grant exceptions). */
export function audienceIncludes(vis: Vis, kind: FileScopeKind, viewer: ViewerFacts, scopeOwnerId?: string | null): boolean {
  if (viewer.admin || vis === "PUBLIC") return true;
  if (!viewer.userId) return false;
  if (kind === "club") return vis === "MEMBERS" ? viewer.member || viewer.leader : viewer.leader;
  if (kind === "user") return vis === "MEMBERS" || viewer.userId === scopeOwnerId;
  return vis === "MEMBERS"; // university LEADERS = admins only
}

/** The full rule for one item, given what the caller already resolved. */
export function canSee(input: { vis: Vis; kind: FileScopeKind; viewer: ViewerFacts; scopeOwnerId?: string | null; createdById: string; granted: boolean }): boolean {
  if (audienceIncludes(input.vis, input.kind, input.viewer, input.scopeOwnerId)) return true;
  if (!input.viewer.userId) return false;
  return input.createdById === input.viewer.userId || input.granted;
}

// ─── Words ───────────────────────────────────────────────────────────────────

type VisCopy = { label: string; short: string; description: string };

/** How each setting reads in each kind of space, so "Members" never means two things on one screen. */
export const VIS_COPY: Record<FileScopeKind, Record<Vis, VisCopy>> = {
  club: {
    PUBLIC: { label: "Public", short: "Anyone", description: "Anyone can open it, even without signing in. Featured files show on the club page." },
    MEMBERS: { label: "Members", short: "Club members", description: "Registered members of the club and its leaders." },
    LEADERS: { label: "Leaders", short: "Club leaders", description: "Officers, ambassadors, the president, VP and advisors only." },
  },
  user: {
    PUBLIC: { label: "Public", short: "Anyone", description: "Anyone with the link can open it, even without signing in." },
    MEMBERS: { label: "Weber State", short: "Weber State accounts", description: "Anyone signed in with a Weber State account who has the link." },
    LEADERS: { label: "Only me", short: "Only you", description: "Only you, plus anyone you add below." },
  },
  university: {
    PUBLIC: { label: "Public", short: "Anyone", description: "Anyone can open it, even without signing in." },
    MEMBERS: { label: "Weber State", short: "Weber State accounts", description: "Anyone signed in with a Weber State account." },
    LEADERS: { label: "Administrators", short: "Administrators", description: "WSUSA administrators only." },
  },
};

export function visCopy(kind: FileScopeKind, vis: Vis): VisCopy {
  return VIS_COPY[kind][vis];
}

/** Ordered from most open to most private, for pickers. */
export const VIS_ORDER: Vis[] = ["PUBLIC", "MEMBERS", "LEADERS"];

/** True when moving into a folder would make an INHERIT item more private or more open. */
export function visibilityChanges(before: Vis, after: Vis) {
  return before !== after;
}
