import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import type { NetworkLine, NetworkViewNode } from "@/lib/analytics/network-model";

/**
 * The live force layout behind the network canvas. Nothing is placed by hand:
 *   - every line pulls its two nodes together by its weight relative to the
 *     two clubs' cross-club traffic (w ÷ √(total A × total B)), so lines that
 *     matter to both clubs are short and stiff and faint ones barely pull.
 *     Using raw weights instead let the busiest clubs' many heavy lines pull
 *     everything into one ball; on the seeded data this sharing rule keeps
 *     clubs of the same college measurably closer (same-college distance
 *     ÷ average distance 0.79 → 0.73) while busy clubs still sit in the middle,
 *   - every node pushes the others away (bigger nodes push harder),
 *   - nodes never overlap (collision by radius),
 *   - a gentle pull toward the middle keeps everything on screen — weaker
 *     sideways than up-down, so loosely tied clubs settle on the flanks of a
 *     wide canvas.
 * Clubs with many heavy lines end up in the middle and college ecosystems
 * cluster on their own because that's where their members' check-ins go.
 */

export type SimNode = SimulationNodeDatum & {
  key: string;
  r: number;
  node: NetworkViewNode;
  /** Sum of this node's line weights. */
  strength: number;
};

export type SimLink = SimulationLinkDatum<SimNode> & { weight: number; key: string };

export type LayoutOptions = { width: number; height: number; compact?: boolean };

/** Area grows with activity, so radius grows with its square root. */
export function radiusScale(nodes: NetworkViewNode[], opts: { grouped: boolean; compact?: boolean; count: number }) {
  const max = Math.max(1, ...nodes.map((n) => n.size));
  // Fewer nodes get more room; many nodes stay small enough not to swamp the canvas.
  const crowd = Math.min(1, Math.sqrt(40 / Math.max(opts.count, 1)));
  const base = opts.grouped ? { min: 9, max: 46 } : { min: 5, max: 26 };
  const k = (opts.compact ? 0.82 : 1) * Math.max(0.55, crowd);
  const min = base.min * Math.max(0.8, k);
  const span = (base.max - base.min) * k;
  return (size: number) => min + span * Math.sqrt(Math.max(0, size) / max);
}

/**
 * Line width in canvas units: a hairline for a single check-in, 8px for the
 * heaviest line. Close to linear (power 0.75) so a typical line stays thin
 * and the strongest connections stand out in a dense web.
 */
export function lineWidthScale(edges: NetworkLine[]) {
  const max = Math.max(1, ...edges.map((e) => e.weight));
  return (w: number) => 0.5 + 7.5 * Math.pow(Math.max(0, w) / max, 0.75);
}

/** Line opacity on the same curve: faint lines recede, heavy ones read first. */
export function lineAlpha(w: number, max: number) {
  return 0.05 + 0.45 * Math.pow(Math.max(0, w) / Math.max(1, max), 0.75);
}

export function buildLinks(nodes: SimNode[], edges: NetworkLine[]): SimLink[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const out: SimLink[] = [];
  for (const e of edges) {
    const s = byKey.get(e.source);
    const t = byKey.get(e.target);
    if (s && t) out.push({ source: s, target: t, weight: e.weight, key: `${e.source}|${e.target}` });
  }
  return out;
}

/**
 * Applies the forces for the current nodes, lines and canvas size. Called on
 * first load, after every poll and when the canvas resizes; positions are
 * never reset here.
 */
export function applyForces(sim: Simulation<SimNode, SimLink>, nodes: SimNode[], links: SimLink[], opts: LayoutOptions) {
  // A line's share of its two ends' cross-club traffic (node.strength = sum of its line weights).
  const share = new Map<SimLink, number>();
  for (const l of links) {
    const s = l.source as SimNode;
    const t = l.target as SimNode;
    share.set(l, l.weight / Math.sqrt(Math.max(1, s.strength) * Math.max(1, t.strength)));
  }
  const maxShare = Math.max(1e-9, ...share.values());
  const relOf = (l: SimLink) => (share.get(l) ?? 0) / maxShare;
  // Normalize so the most-pulled node's lines sum to a stable pull (keeps dense graphs from oscillating).
  const pull = new Map<SimNode, number>();
  for (const l of links) {
    const s = l.source as SimNode;
    const t = l.target as SimNode;
    pull.set(s, (pull.get(s) ?? 0) + relOf(l));
    pull.set(t, (pull.get(t) ?? 0) + relOf(l));
  }
  const maxPull = Math.max(1, ...pull.values());
  const spread = Math.sqrt((opts.width * opts.height) / Math.max(nodes.length, 1));
  const aspect = Math.max(0.6, Math.min(2.4, opts.width / Math.max(opts.height, 1)));

  sim
    .nodes(nodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((n) => n.key)
        .strength((l) => (1.6 * relOf(l)) / maxPull)
        .distance((l) => (l.source as SimNode).r + (l.target as SimNode).r + spread * (0.9 - 0.65 * relOf(l))),
    )
    .force(
      "charge",
      forceManyBody<SimNode>()
        .strength((n) => -(spread * 0.9 + n.r * 6))
        .distanceMax(spread * 7),
    )
    .force(
      "collide",
      forceCollide<SimNode>((n) => n.r + (opts.compact ? 2.5 : 4)).strength(0.9).iterations(2),
    )
    .force("x", forceX<SimNode>(0).strength(0.035 / aspect))
    .force("y", forceY<SimNode>(0).strength(0.035 * aspect));
}

export function createSimulation(): Simulation<SimNode, SimLink> {
  return forceSimulation<SimNode, SimLink>().alphaDecay(0.028).velocityDecay(0.42).stop();
}

/**
 * Starting spots for nodes without one: the middle of the clubs they contain
 * (when switching grouping), else beside a node they're linked to, else a
 * sunflower spiral (deterministic, so every visitor starts the same way).
 */
export function seedPositions(nodes: SimNode[], links: SimLink[], known: Map<string, { x: number; y: number }>) {
  const placed = new Map<string, SimNode>();
  for (const n of nodes) if (n.x != null && n.y != null) placed.set(n.key, n);
  const missing = nodes.filter((n) => !placed.has(n.key));
  missing.forEach((n, i) => {
    const inside = n.node.clubIds.map((id) => known.get(id)).filter((p): p is { x: number; y: number } => Boolean(p));
    const own = known.get(n.key);
    if (own) {
      n.x = own.x;
      n.y = own.y;
    } else if (inside.length) {
      n.x = inside.reduce((s, p) => s + p.x, 0) / inside.length;
      n.y = inside.reduce((s, p) => s + p.y, 0) / inside.length;
    } else {
      const neighbor = links.find((l) => (l.source as SimNode).key === n.key || (l.target as SimNode).key === n.key);
      const other = neighbor ? ((neighbor.source as SimNode).key === n.key ? (neighbor.target as SimNode) : (neighbor.source as SimNode)) : null;
      if (other?.x != null && other.y != null) {
        const a = (i + 1) * 2.399963;
        n.x = other.x + Math.cos(a) * (other.r + n.r + 20);
        n.y = other.y + Math.sin(a) * (other.r + n.r + 20);
      } else {
        const a = (i + placed.size) * 2.399963;
        const d = 18 * Math.sqrt(i + placed.size + 0.5);
        n.x = Math.cos(a) * d;
        n.y = Math.sin(a) * d;
      }
    }
    // Several group members can share a centroid; nudge them apart so collision can do its job.
    n.x! += ((i % 7) - 3) * 0.7;
    n.y! += ((i % 5) - 2) * 0.7;
  });
}
