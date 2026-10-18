/**
 * The network canvas's data model — pure and client-safe, shared by the
 * /api/network route (which builds it) and the NetworkGraph component (which
 * draws it). Numbers come from lib/metrics networkData(); this module only
 * groups them. Grouping sums node sizes and line weights; a line inside one
 * group (two clubs in the same college) disappears, since it doesn't connect
 * two different groups.
 */

import { CLUB_TYPE_LABEL } from "@/lib/labels/clubs";

export type NetworkWindow = "term" | "year" | "12m" | "all";
export type NetworkGroup = "club" | "college" | "department" | "major";

export const NETWORK_WINDOWS: { key: NetworkWindow; label: string; short: string }[] = [
  { key: "term", label: "This term", short: "this term" },
  { key: "year", label: "This academic year", short: "this academic year" },
  { key: "12m", label: "Last 12 months", short: "in the last 12 months" },
  { key: "all", label: "All time", short: "since the platform started" },
];

export const NETWORK_GROUPS: { key: NetworkGroup; label: string; noun: string; plural: string }[] = [
  { key: "club", label: "Club", noun: "club", plural: "clubs" },
  { key: "college", label: "College", noun: "college", plural: "colleges" },
  { key: "department", label: "Department", noun: "department", plural: "departments" },
  { key: "major", label: "Major", noun: "major or discipline", plural: "majors and disciplines" },
];

export const DEFAULT_NETWORK_WINDOW: NetworkWindow = "12m";
export const DEFAULT_NETWORK_GROUP: NetworkGroup = "club";

export function parseNetworkWindow(v: unknown): NetworkWindow {
  return NETWORK_WINDOWS.some((w) => w.key === v) ? (v as NetworkWindow) : DEFAULT_NETWORK_WINDOW;
}

export function parseNetworkGroup(v: unknown): NetworkGroup {
  return NETWORK_GROUPS.some((g) => g.key === v) ? (v as NetworkGroup) : DEFAULT_NETWORK_GROUP;
}

/** One approved club, as the canvas needs it (lib/metrics NetworkNode plus scope and college short name). */
export type NetworkClub = {
  id: string;
  name: string;
  slug: string;
  type: string;
  scope: "COLLEGE" | "UNIVERSITY" | "INDEPENDENT" | "SPORTS";
  collegeId: string | null;
  collegeName: string | null;
  departmentName: string | null;
  majorName: string | null;
  size: number; // check-ins at the club's events in the window
  members: number; // registered (ACTIVE) members
};

export type NetworkLine = { source: string; target: string; weight: number };

/** A node on the canvas: one club, or a group of clubs. */
export type NetworkViewNode = {
  key: string;
  kind: "club" | "group";
  label: string;
  /** Shorter label for the canvas ("EAST" for a college). */
  short: string;
  /** Club page, for club nodes. */
  href: string | null;
  clubIds: string[];
  /** Colors the node: the club's college, or the college most of a group's clubs belong to. */
  collegeId: string | null;
  /** "Sponsored · College of Science" for a club, "6 clubs" for a group. */
  detail: string;
  size: number;
  members: number;
};

export type NetworkCollege = { id: string; name: string; shortName: string };

export type NetworkViewer = {
  signedIn: boolean;
  /** Clubs the viewer is an active member of. */
  memberOf: string[];
  /** Clubs the viewer leads (ambassador and up) or advises. */
  leads: string[];
};

export type NetworkPayload = {
  window: NetworkWindow;
  group: NetworkGroup;
  windowLabel: string;
  /** The window as a phrase: "in Fall 2026", "in the last 12 months", "since the platform started". */
  windowPhrase: string;
  since: string; // ISO
  until: string; // ISO
  nodes: NetworkViewNode[];
  edges: NetworkLine[];
  /** Colleges in legend order (alphabetical), which is also the color order. */
  colleges: NetworkCollege[];
  viewer: NetworkViewer;
  totals: { clubs: number; lines: number; crossWeight: number };
  generatedAt: string; // ISO
};

const TYPE_LABEL: Record<string, string> = CLUB_TYPE_LABEL;
const SCOPE_GROUP_LABEL: Record<NetworkClub["scope"], string> = {
  COLLEGE: "No college listed",
  UNIVERSITY: "University-wide clubs",
  INDEPENDENT: "Independent clubs",
  SPORTS: "Club sports",
};

/** Which group a club belongs to under a grouping (key + label). */
export function groupOf(club: NetworkClub, group: NetworkGroup, colleges: Map<string, NetworkCollege>): { key: string; label: string; short: string } {
  switch (group) {
    case "club":
      return { key: club.id, label: club.name, short: club.name };
    case "college": {
      if (club.collegeId) {
        const c = colleges.get(club.collegeId);
        return { key: `college:${club.collegeId}`, label: c?.name ?? club.collegeName ?? "College", short: c?.shortName ?? club.collegeName ?? "College" };
      }
      const label = SCOPE_GROUP_LABEL[club.scope];
      return { key: `scope:${club.scope}`, label, short: label };
    }
    case "department": {
      const name = club.departmentName?.trim();
      return name ? { key: `department:${name.toLowerCase()}`, label: name, short: name } : { key: "department:none", label: "No department", short: "No department" };
    }
    case "major": {
      const name = club.majorName?.trim();
      return name ? { key: `major:${name.toLowerCase()}`, label: name, short: name } : { key: "major:none", label: "No focus major", short: "No focus major" };
    }
  }
}

function clubDetail(club: NetworkClub) {
  const type = TYPE_LABEL[club.type] ?? "Club";
  return club.collegeName ? `${type} · ${club.collegeName}` : `${type} · ${SCOPE_GROUP_LABEL[club.scope].replace(/ clubs$/, "")}`;
}

/**
 * Nodes and lines for a grouping. Club view passes everything through; other
 * views sum sizes, members and line weights per group and drop lines inside a
 * group. Output is sorted (nodes by label, lines heaviest first) so polling
 * never reshuffles anything that didn't change.
 */
export function buildView(clubs: NetworkClub[], lines: NetworkLine[], group: NetworkGroup, colleges: NetworkCollege[]): { nodes: NetworkViewNode[]; edges: NetworkLine[] } {
  const collegeMap = new Map(colleges.map((c) => [c.id, c]));
  if (group === "club") {
    const ids = new Set(clubs.map((c) => c.id));
    return {
      nodes: clubs
        .map((c) => ({
          key: c.id,
          kind: "club" as const,
          label: c.name,
          short: c.name,
          href: `/clubs/${c.slug}`,
          clubIds: [c.id],
          collegeId: c.collegeId,
          detail: clubDetail(c),
          size: c.size,
          members: c.members,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      edges: lines.filter((l) => l.weight > 0 && ids.has(l.source) && ids.has(l.target)).sort(byWeight),
    };
  }

  const keyOf = new Map<string, string>();
  const groups = new Map<string, { key: string; label: string; short: string; clubIds: string[]; size: number; members: number; colleges: Map<string, number> }>();
  for (const c of clubs) {
    const g = groupOf(c, group, collegeMap);
    keyOf.set(c.id, g.key);
    const entry = groups.get(g.key) ?? { ...g, clubIds: [], size: 0, members: 0, colleges: new Map<string, number>() };
    entry.clubIds.push(c.id);
    entry.size += c.size;
    entry.members += c.members;
    if (c.collegeId) entry.colleges.set(c.collegeId, (entry.colleges.get(c.collegeId) ?? 0) + 1);
    groups.set(g.key, entry);
  }

  const nodes: NetworkViewNode[] = [...groups.values()].map((g) => ({
    key: g.key,
    kind: "group",
    label: g.label,
    short: g.short,
    href: null,
    clubIds: g.clubIds,
    collegeId: dominant(g.colleges),
    detail: `${g.clubIds.length} ${g.clubIds.length === 1 ? "club" : "clubs"}`,
    size: g.size,
    members: g.members,
  }));
  nodes.sort((a, b) => a.label.localeCompare(b.label));

  const weights = new Map<string, NetworkLine>();
  for (const l of lines) {
    const ga = keyOf.get(l.source);
    const gb = keyOf.get(l.target);
    if (!ga || !gb || ga === gb || l.weight <= 0) continue;
    const [s, t] = ga < gb ? [ga, gb] : [gb, ga];
    const k = `${s}|${t}`;
    const e = weights.get(k);
    if (e) e.weight += l.weight;
    else weights.set(k, { source: s, target: t, weight: l.weight });
  }
  return { nodes, edges: [...weights.values()].sort(byWeight) };
}

/** The most common college among a group's clubs (ties go to the lower id, so colors never flicker). */
function dominant(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [id, c] of counts) if (c > n || (c === n && best !== null && id < best)) [best, n] = [id, c];
  return best;
}

function byWeight(a: NetworkLine, b: NetworkLine) {
  return b.weight - a.weight || a.source.localeCompare(b.source) || a.target.localeCompare(b.target);
}

/** A node's strongest lines, heaviest first. */
export function topConnections(key: string, edges: NetworkLine[], limit = 5): { key: string; weight: number }[] {
  const out: { key: string; weight: number }[] = [];
  for (const e of edges) {
    if (e.source === key) out.push({ key: e.target, weight: e.weight });
    else if (e.target === key) out.push({ key: e.source, weight: e.weight });
  }
  return out.sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key)).slice(0, limit);
}

/**
 * Totals for the summary line. (No check-in total: a co-hosted event's
 * check-ins count toward every host, so summing node sizes would overcount.)
 */
export function viewTotals(clubs: NetworkClub[], edges: NetworkLine[]) {
  return { clubs: clubs.length, lines: edges.length, crossWeight: edges.reduce((s, e) => s + e.weight, 0) };
}
