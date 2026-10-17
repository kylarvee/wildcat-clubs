import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { notFound } from "@/lib/domain/kit";
import { clubListMetrics, networkData } from "@/lib/metrics";
import { academicYearAt, currentOrLastTerm, getTerms } from "@/lib/terms";
import {
  buildView,
  NETWORK_GROUPS,
  NETWORK_WINDOWS,
  topConnections,
  viewTotals,
  type NetworkClub,
  type NetworkCollege,
  type NetworkGroup,
  type NetworkLine,
  type NetworkPayload,
  type NetworkViewer,
  type NetworkViewNode,
  type NetworkWindow,
} from "./network-model";

/**
 * Read side of the inter-club network canvas (GET /api/network and
 * /api/network/details). Node sizes and line weights come straight from
 * lib/metrics networkData(); this module adds what the canvas needs on top:
 * the time windows, grouping, the viewer's own clubs, and the breakdown of a
 * single line (which direction the visits went, co-hosted events) that
 * metrics doesn't provide. Nothing here writes.
 */

/** Same comparison as lib/metrics: our timestamp columns hold UTC wall-clock time. */
const ts = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** Before the platform's first term: "all time" for the canvas. */
const ALL_TIME_START = new Date(Date.UTC(2000, 0, 1));

type Base = { clubs: NetworkClub[]; lines: NetworkLine[]; colleges: NetworkCollege[]; since: Date; until: Date; windowLabel: string; windowPhrase: string; builtAt: Date };

/**
 * The public part of the canvas is the same for every visitor, so each
 * window is built once a minute and shared (the client polls every 60 s).
 * The default window reuses metrics' own shared build.
 */
const SHARED_MS = 60_000;
const shared = new Map<NetworkWindow, { expires: number; data: Promise<Base> }>();

async function windowBounds(window: NetworkWindow, now: Date): Promise<{ since?: Date; until?: Date; label: string; phrase: string }> {
  const twelve = { label: NETWORK_WINDOWS[2].label, phrase: NETWORK_WINDOWS[2].short };
  if (window === "12m") return twelve;
  if (window === "all") return { since: ALL_TIME_START, until: now, label: NETWORK_WINDOWS[3].label, phrase: NETWORK_WINDOWS[3].short };
  // Term and year windows fall back to the last 12 months when the academic calendar is empty.
  const terms = await getTerms();
  if (window === "term") {
    const t = currentOrLastTerm(terms, now);
    return t ? { since: t.startsOn, until: now, label: t.name, phrase: `in ${t.name}` } : twelve;
  }
  const ay = academicYearAt(terms, now);
  return ay ? { since: ay.start, until: now, label: `${ay.label} academic year`, phrase: `in the ${ay.label} academic year` } : twelve;
}

async function buildBase(window: NetworkWindow): Promise<Base> {
  const now = new Date();
  const bounds = await windowBounds(window, now);
  const [net, extra, colleges] = await Promise.all([
    bounds.since ? networkData({ since: bounds.since, until: bounds.until }) : networkData(),
    db.club.findMany({ where: { status: "APPROVED" }, select: { id: true, scope: true } }),
    db.college.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, shortName: true } }),
  ]);
  const scopeOf = new Map(extra.map((c) => [c.id, c.scope]));
  const clubs: NetworkClub[] = net.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    slug: n.slug,
    type: n.type,
    scope: scopeOf.get(n.id) ?? (n.collegeId ? "COLLEGE" : "INDEPENDENT"),
    collegeId: n.collegeId,
    collegeName: n.collegeName,
    departmentName: n.departmentName,
    majorName: n.majorName,
    size: n.size,
    members: n.members,
  }));
  return { clubs, lines: net.edges, colleges, since: net.since, until: net.until, windowLabel: bounds.label, windowPhrase: bounds.phrase, builtAt: now };
}

function baseFor(window: NetworkWindow): Promise<Base> {
  const now = Date.now();
  const hit = shared.get(window);
  if (hit && hit.expires > now) return hit.data;
  const data = buildBase(window);
  shared.set(window, { expires: now + SHARED_MS, data });
  data.catch(() => {
    if (shared.get(window)?.data === data) shared.delete(window);
  });
  return data;
}

/** The viewer's clubs, for "your clubs" highlighting. Signed-out visitors get none. */
async function viewerOf(actor: Actor | null): Promise<NetworkViewer> {
  if (!actor) return { signedIn: false, memberOf: [], leads: [] };
  const [memberships, roles] = await Promise.all([
    db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE", club: { status: "APPROVED" } }, select: { clubId: true } }),
    db.roleAssignment.findMany({ where: { userId: actor.id, endedAt: null, role: { not: "MEMBER" }, club: { status: "APPROVED" } }, select: { clubId: true } }),
  ]);
  return { signedIn: true, memberOf: [...new Set(memberships.map((m) => m.clubId))], leads: [...new Set(roles.map((r) => r.clubId))] };
}

/** Everything the canvas draws for one window and grouping. */
export async function loadNetwork(opts: { window: NetworkWindow; group: NetworkGroup; actor: Actor | null }): Promise<NetworkPayload> {
  const [base, viewer] = await Promise.all([baseFor(opts.window), viewerOf(opts.actor)]);
  const view = buildView(base.clubs, base.lines, opts.group, base.colleges);
  return {
    window: opts.window,
    group: opts.group,
    windowLabel: base.windowLabel,
    windowPhrase: base.windowPhrase,
    since: base.since.toISOString(),
    until: base.until.toISOString(),
    nodes: view.nodes,
    edges: view.edges,
    colleges: base.colleges,
    viewer,
    totals: viewTotals(base.clubs, base.lines),
    generatedAt: base.builtAt.toISOString(),
  };
}

// ─── Details for the side panel ──────────────────────────────────────────────

export type ClubStanding = "active" | "pilot" | "inactive";

export type NetworkNodeDetails =
  | {
      kind: "club";
      key: string;
      label: string;
      href: string;
      detail: string;
      members: number;
      activeMembers: number;
      checkins: number;
      /** Last complete month vs. the one before (lib/metrics clubListMetrics). */
      retentionRate: number | null;
      standing: ClubStanding;
      windowLabel: string;
    }
  | {
      kind: "group";
      key: string;
      label: string;
      groupNoun: string;
      members: number;
      activeMembers: number;
      checkins: number;
      clubs: { id: string; name: string; href: string; checkins: number; members: number; activeMembers: number }[];
      windowLabel: string;
    };

/**
 * Panel numbers are public and the same for everyone, so each answer is
 * shared for a minute (like the canvas itself): repeat clicks — or a script
 * hammering the endpoint — reuse it instead of re-running the SQL.
 */
const detailCache = new Map<string, { expires: number; data: Promise<unknown> }>();
const DETAIL_CACHE_MAX = 500;

function sharedDetail<T>(key: string, build: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = detailCache.get(key);
  if (hit && hit.expires > now) return hit.data as Promise<T>;
  if (detailCache.size >= DETAIL_CACHE_MAX) {
    for (const [k, v] of detailCache) if (v.expires <= now) detailCache.delete(k);
    if (detailCache.size >= DETAIL_CACHE_MAX) detailCache.delete(detailCache.keys().next().value!);
  }
  const data = build();
  detailCache.set(key, { expires: now + SHARED_MS, data });
  data.catch(() => {
    if (detailCache.get(key)?.data === data) detailCache.delete(key);
  });
  return data;
}

export function networkNodeDetails(opts: { window: NetworkWindow; group: NetworkGroup; key: string }): Promise<NetworkNodeDetails> {
  return sharedDetail(`node|${opts.window}|${opts.group}|${opts.key}`, () => buildNodeDetails(opts));
}

async function buildNodeDetails(opts: { window: NetworkWindow; group: NetworkGroup; key: string }): Promise<NetworkNodeDetails> {
  const base = await baseFor(opts.window);
  const view = buildView(base.clubs, base.lines, opts.group, base.colleges);
  const node = view.nodes.find((n) => n.key === opts.key);
  if (!node) throw notFound("That club or group");
  const metrics = await clubListMetrics(node.clubIds);
  if (node.kind === "club") {
    const m = metrics.get(node.key);
    return {
      kind: "club",
      key: node.key,
      label: node.label,
      href: node.href!,
      detail: node.detail,
      members: m?.registeredMembers ?? node.members,
      activeMembers: m?.activeMembers ?? 0,
      checkins: node.size,
      retentionRate: m?.retentionRate ?? null,
      standing: !m ? "inactive" : m.inPilot ? "pilot" : m.isActive ? "active" : "inactive",
      windowLabel: base.windowLabel,
    };
  }
  const byId = new Map(base.clubs.map((c) => [c.id, c]));
  const clubs = node.clubIds
    .map((id) => {
      const c = byId.get(id)!;
      return { id, name: c.name, href: `/clubs/${c.slug}`, checkins: c.size, members: c.members, activeMembers: metrics.get(id)?.activeMembers ?? 0 };
    })
    .sort((a, b) => b.checkins - a.checkins || a.name.localeCompare(b.name));
  return {
    kind: "group",
    key: node.key,
    label: node.label,
    groupNoun: NETWORK_GROUPS.find((g) => g.key === opts.group)!.noun,
    members: node.members,
    activeMembers: clubs.reduce((s, c) => s + c.activeMembers, 0),
    checkins: node.size,
    clubs,
    windowLabel: base.windowLabel,
  };
}

export type NetworkLinkDetails = {
  a: { key: string; label: string; href: string | null };
  b: { key: string; label: string; href: string | null };
  /** The line's weight from lib/metrics (= aToB + bToA − both). */
  weight: number;
  /** Check-ins by members of A at events B hosted or co-hosted. */
  aToB: number;
  bToA: number;
  /** Check-ins by people in both, at events both took part in — counted once in the weight. */
  both: number;
  /** Events with a meeting in the window that a club on each side hosted or co-hosted together. */
  cohostedEvents: number;
  /** For groups: the club pairs that make up the line, heaviest first. */
  pairs: { a: string; b: string; weight: number }[];
  windowLabel: string;
};

export async function networkLinkDetails(opts: { window: NetworkWindow; group: NetworkGroup; a: string; b: string }): Promise<NetworkLinkDetails> {
  // A line is the same either way round: share one answer, then face it the way it was asked.
  const flipped = opts.a > opts.b;
  const [a, b] = flipped ? [opts.b, opts.a] : [opts.a, opts.b];
  const d = await sharedDetail(`link|${opts.window}|${opts.group}|${a}|${b}`, () => buildLinkDetails({ ...opts, a, b }));
  if (!flipped) return d;
  return { ...d, a: d.b, b: d.a, aToB: d.bToA, bToA: d.aToB, pairs: d.pairs.map((p) => ({ a: p.b, b: p.a, weight: p.weight })) };
}

async function buildLinkDetails(opts: { window: NetworkWindow; group: NetworkGroup; a: string; b: string }): Promise<NetworkLinkDetails> {
  const base = await baseFor(opts.window);
  const view = buildView(base.clubs, base.lines, opts.group, base.colleges);
  const find = (k: string) => view.nodes.find((n) => n.key === k);
  const na = find(opts.a);
  const nb = find(opts.b);
  if (!na || !nb || na.key === nb.key) throw notFound("That connection");
  const line = view.edges.find((e) => (e.source === na.key && e.target === nb.key) || (e.source === nb.key && e.target === na.key));
  const counts = await directedCounts(na.clubIds, nb.clubIds, base.since, base.until);

  let pairs: NetworkLinkDetails["pairs"] = [];
  if (opts.group !== "club") {
    const A = new Set(na.clubIds);
    const B = new Set(nb.clubIds);
    const name = new Map(base.clubs.map((c) => [c.id, c.name]));
    pairs = base.lines
      .filter((l) => (A.has(l.source) && B.has(l.target)) || (B.has(l.source) && A.has(l.target)))
      .map((l) => (A.has(l.source) ? { a: name.get(l.source)!, b: name.get(l.target)!, weight: l.weight } : { a: name.get(l.target)!, b: name.get(l.source)!, weight: l.weight }))
      .slice(0, 6);
  }

  return {
    a: { key: na.key, label: na.label, href: na.href },
    b: { key: nb.key, label: nb.label, href: nb.href },
    weight: line?.weight ?? 0,
    ...counts,
    pairs,
    windowLabel: base.windowLabel,
  };
}

/**
 * The two directions of a line, mirroring the network SQL in lib/metrics
 * (one row per check-in with its event's participating clubs; membership
 * judged at the event's start). For sets of clubs A and B:
 *   aToB = Σ directed(a→b), bToA = Σ directed(b→a), both = Σ overlaps{a,b}
 * so aToB + bToA − both equals the line weight metrics reports.
 */
async function directedCounts(A: string[], B: string[], since: Date, until: Date) {
  const all = [...A, ...B];
  const memberAt = Prisma.sql`m."joinedAt" IS NOT NULL AND m."joinedAt" <= rel.starts_at AND (m."endedAt" IS NULL OR m."endedAt" > rel.starts_at) AND m.status NOT IN ('PENDING', 'DECLINED')`;
  const [row] = await db.$queryRaw<{ a_to_b: number; b_to_a: number; both: number; cohosted: number }[]>`
    WITH rel AS (
      SELECT a.id AS checkin_id, a."userId" AS user_id, o."startsAt" AS starts_at,
             array_remove(ARRAY[e."clubId"] || COALESCE(co.ids, ARRAY[]::text[]), NULL) AS clubs
        FROM "Attendance" a
        JOIN "EventOccurrence" o ON o.id = a."occurrenceId"
        JOIN "Event" e ON e.id = o."eventId"
        LEFT JOIN LATERAL (
          SELECT array_agg(c."clubId") AS ids FROM "EventCohost" c
           WHERE c."eventId" = e.id AND c.status = 'APPROVED' AND c."clubId" IS DISTINCT FROM e."clubId"
        ) co ON TRUE
       WHERE o.status = 'SCHEDULED' AND e.status <> 'DRAFT' AND o."startsAt" >= ${ts(since)} AND o."startsAt" <= ${ts(until)}
         AND array_remove(ARRAY[e."clubId"] || COALESCE(co.ids, ARRAY[]::text[]), NULL) && ${all}::text[]
    ),
    mem AS (
      SELECT rel.checkin_id, rel.clubs, m."clubId" AS m_club
        FROM rel JOIN "Membership" m ON m."userId" = rel.user_id AND ${memberAt}
       WHERE m."clubId" = ANY(${all}::text[])
    ),
    ev AS (
      SELECT array_remove(ARRAY[e."clubId"] || COALESCE(
               (SELECT array_agg(c."clubId") FROM "EventCohost" c WHERE c."eventId" = e.id AND c.status = 'APPROVED'), ARRAY[]::text[]), NULL) AS clubs
        FROM "Event" e
       WHERE e.status <> 'DRAFT'
         AND EXISTS (SELECT 1 FROM "EventOccurrence" o WHERE o."eventId" = e.id AND o.status = 'SCHEDULED' AND o."startsAt" >= ${ts(since)} AND o."startsAt" <= ${ts(until)})
    )
    SELECT
      (SELECT count(*) FROM mem, unnest(mem.clubs) AS x(club) WHERE mem.m_club = ANY(${A}::text[]) AND x.club = ANY(${B}::text[]) AND x.club <> mem.m_club)::int AS a_to_b,
      (SELECT count(*) FROM mem, unnest(mem.clubs) AS x(club) WHERE mem.m_club = ANY(${B}::text[]) AND x.club = ANY(${A}::text[]) AND x.club <> mem.m_club)::int AS b_to_a,
      (SELECT COALESCE(sum(t.na * t.nb), 0) FROM (
         SELECT count(*) FILTER (WHERE mem.m_club = ANY(${A}::text[]) AND mem.m_club = ANY(mem.clubs)) AS na,
                count(*) FILTER (WHERE mem.m_club = ANY(${B}::text[]) AND mem.m_club = ANY(mem.clubs)) AS nb
           FROM mem GROUP BY mem.checkin_id) t)::int AS both,
      (SELECT count(*) FROM ev WHERE ev.clubs && ${A}::text[] AND ev.clubs && ${B}::text[])::int AS cohosted`;
  return { aToB: row?.a_to_b ?? 0, bToA: row?.b_to_a ?? 0, both: row?.both ?? 0, cohostedEvents: row?.cohosted ?? 0 };
}

/** A club's strongest connections over the last 12 months (admin drill-down). */
export async function clubConnections(clubId: string, limit = 8): Promise<{ id: string; name: string; weight: number }[]> {
  const base = await baseFor("12m");
  const name = new Map(base.clubs.map((c) => [c.id, c.name]));
  return topConnections(clubId, base.lines, limit).map((t) => ({ id: t.key, name: name.get(t.key) ?? "Club", weight: t.weight }));
}

/** Per club: how many other clubs it shares a line with, and the total weight (last 12 months). */
export async function connectionCounts(): Promise<Map<string, { clubs: number; weight: number }>> {
  const base = await baseFor("12m");
  const out = new Map<string, { clubs: number; weight: number }>();
  for (const l of base.lines) {
    for (const id of [l.source, l.target]) {
      const e = out.get(id) ?? { clubs: 0, weight: 0 };
      e.clubs += 1;
      e.weight += l.weight;
      out.set(id, e);
    }
  }
  return out;
}

export type { NetworkViewNode };
