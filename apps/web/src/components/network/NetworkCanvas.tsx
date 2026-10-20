"use client";

import Link from "next/link";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ArrowRight } from "lucide-react";
import type { NetworkPayload, NetworkViewNode } from "@/lib/analytics/network-model";
import { cn } from "@/components/ui/cn";
import { applyForces, buildLinks, createSimulation, FLOAT_ALPHA, floatForce, lineAlpha, lineWidthScale, radiusScale, seedPositions, type SimLink, type SimNode } from "./layout";
import { CANVAS_THEMES, colorOf, withAlpha, type CanvasThemeName } from "./colors";

/**
 * The drawing surface of the network: a <canvas> fed by a live d3-force
 * simulation. Canvas rather than SVG so a few hundred clubs and a dense web
 * of lines stay smooth while the layout moves. Everything a pointer can do
 * here is also reachable without one: the search box focuses any club, the
 * zoom buttons and arrow keys move the view, and "View as a table" lists it all.
 */

export type NetworkSelection = { type: "node"; key: string } | { type: "link"; a: string; b: string } | null;

export type CanvasHandle = {
  /** Centers and zooms on a node. */
  focus: (key: string) => void;
  zoom: (factor: number) => void;
  /** Fits every node in view (and keeps following the layout until someone pans or zooms). */
  fit: () => void;
};

export type Adjacency = Map<string, { key: string; weight: number }[]>;

type Transform = { k: number; x: number; y: number };
type Tip = { kind: "node"; key: string; x: number; y: number } | { kind: "link"; a: string; b: string; weight: number; x: number; y: number };

const MIN_K = 0.15;
const MAX_K = 6;
const DRAG_SLOP = 5;
/** How far a line bows to one side, as a share of its length. */
const BOW = 0.12;
/** The landing embed's spotlight: a new club every few seconds, crossfading in and out. */
const SPOT_EVERY_MS = 6500;
const SPOT_FADE_MS = 800;
const SPOT_HUBS = 8;
/** On first paint the map fades and settles in over this long. */
const APPEAR_MS = 900;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmt = (n: number) => n.toLocaleString("en-US");
const ease = (u: number) => 1 - Math.pow(1 - clamp(u, 0, 1), 3);

/**
 * A line's control point: the midpoint pushed sideways by BOW of its length,
 * always to the same side for a given pair, so a dense web reads as strands.
 */
function bend(s: SimNode, t: SimNode) {
  const sign = s.key < t.key ? 1 : -1;
  const dx = t.x! - s.x!;
  const dy = t.y! - s.y!;
  return { x: (s.x! + t.x!) / 2 - dy * BOW * sign, y: (s.y! + t.y!) / 2 + dx * BOW * sign };
}

function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  const u = clamp(((px - x0) * dx + (py - y0) * dy) / len2, 0, 1);
  return Math.hypot(px - (x0 + u * dx), py - (y0 + u * dy));
}

/** Distance from a point to a bowed line, measured along a dozen short segments of the curve. */
function distToCurve(px: number, py: number, s: SimNode, t: SimNode) {
  const c = bend(s, t);
  let best = Infinity;
  let x0 = s.x!;
  let y0 = s.y!;
  for (let i = 1; i <= 12; i++) {
    const u = i / 12;
    const v = 1 - u;
    const x1 = v * v * s.x! + 2 * v * u * c.x + u * u * t.x!;
    const y1 = v * v * s.y! + 2 * v * u * c.y + u * u * t.y!;
    best = Math.min(best, distToSegment(px, py, x0, y0, x1, y1));
    x0 = x1;
    y0 = y1;
  }
  return best;
}

export function NetworkCanvas({
  data,
  compact,
  height,
  selection,
  onSelect,
  collegeFocus,
  minWeight,
  colors,
  adjacency,
  rightInset = 0,
  handleRef,
  refreshing,
  ariaLabel,
  describedBy,
  theme = "light",
}: {
  data: NetworkPayload;
  compact: boolean;
  height: number;
  selection: NetworkSelection;
  onSelect: (s: NetworkSelection) => void;
  /** A college id (or "none") whose clubs stay bright while the rest fade. */
  collegeFocus: string | null;
  /** Lines lighter than this aren't drawn (the layout still uses them). */
  minWeight: number;
  colors: Map<string, string>;
  adjacency: Adjacency;
  rightInset?: number;
  handleRef?: Ref<CanvasHandle>;
  refreshing?: boolean;
  ariaLabel: string;
  describedBy?: string;
  /** "night" for the landing page's dark band. */
  theme?: CanvasThemeName;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<ReturnType<typeof createSimulation> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const byKeyRef = useRef(new Map<string, SimNode>());
  const knownRef = useRef(new Map<string, { x: number; y: number }>());
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const tRef = useRef<Transform>({ k: 1, x: 0, y: 0 });
  const autoFitRef = useRef(true);
  const structureRef = useRef("");
  const keysRef = useRef("");
  const hoverRef = useRef<Tip | null>(null);
  const frameRef = useRef(0);
  const animRef = useRef(0);
  const widthsRef = useRef(new Map<string, number>());
  const fontRef = useRef("ui-sans-serif, system-ui, sans-serif");
  const reducedRef = useRef(false);
  /** False while the canvas is scrolled out of view: the floating layout pauses to save battery. */
  const visibleRef = useRef(true);
  const lineWidthRef = useRef<(w: number) => number>(() => 1);
  const maxWeightRef = useRef(1);
  /** The spotlight's current and previous club (they crossfade from `since`). */
  const spotRef = useRef<{ key: string | null; prev: string | null; since: number }>({ key: null, prev: null, since: 0 });
  /** When the map first painted, for the fade-in. */
  const bornRef = useRef(0);
  /** One glow image per color, drawn once and reused every frame. */
  const glowsRef = useRef(new Map<string, HTMLCanvasElement>());
  const [tip, setTip] = useState<Tip | null>(null);
  const [pinned, setPinned] = useState<Tip | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest props for the draw loop, which runs outside React renders.
  const propsRef = useRef({ selection, collegeFocus, minWeight, colors, data, compact, rightInset, theme, adjacency });
  propsRef.current = { selection, collegeFocus, minWeight, colors, data, compact, rightInset, theme, adjacency };

  const leads = useRef(new Set<string>());
  const member = useRef(new Set<string>());
  leads.current = new Set(data.viewer.leads);
  member.current = new Set(data.viewer.memberOf);

  // ─── drawing ─────────────────────────────────────────────────────────────

  const glowFor = (color: string) => {
    let g = glowsRef.current.get(color);
    if (!g) {
      g = document.createElement("canvas");
      g.width = g.height = 128;
      const c = g.getContext("2d")!;
      const grad = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, withAlpha(color, 0.42));
      grad.addColorStop(0.3, withAlpha(color, 0.15));
      grad.addColorStop(1, withAlpha(color, 0));
      c.fillStyle = grad;
      c.fillRect(0, 0, 128, 128);
      glowsRef.current.set(color, g);
    }
    return g;
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h, dpr } = sizeRef.current;
    if (!w || !h) return;
    const p = propsRef.current;
    const th = CANVAS_THEMES[p.theme];
    const t = tRef.current;
    const nodes = nodesRef.current;
    const links = linksRef.current;
    const hover = hoverRef.current;
    const now = performance.now();
    const appear = reducedRef.current || !bornRef.current ? 1 : ease((now - bornRef.current) / APPEAR_MS);

    // What's in focus: a hovered/selected node and its neighbors, or a line and its two ends.
    const activeNode = hover?.kind === "node" ? hover.key : p.selection?.type === "node" ? p.selection.key : null;
    const activeLink = hover?.kind === "link" ? `${hover.a}|${hover.b}` : p.selection?.type === "link" ? `${p.selection.a}|${p.selection.b}` : null;
    let lit: Set<string> | null = null;
    if (activeNode) {
      lit = new Set([activeNode]);
      for (const l of links) {
        const s = (l.source as SimNode).key;
        const tt = (l.target as SimNode).key;
        if (l.weight < p.minWeight) continue;
        if (s === activeNode) lit.add(tt);
        else if (tt === activeNode) lit.add(s);
      }
    } else if (activeLink) {
      lit = new Set(activeLink.split("|"));
    }

    // The spotlight (landing embed): its club and the previous one crossfade; pointing at the map wins.
    const spot = spotRef.current;
    const spotOn = !lit && spot.key !== null;
    const spotLevel = spotOn ? ease((now - spot.since) / SPOT_FADE_MS) : 0;
    const prevLevel = spotOn && spot.prev && spot.prev !== spot.key ? 1 - spotLevel : 0;
    const around = (key: string | null) => new Set(key ? [key, ...(p.adjacency.get(key) ?? []).map((a) => a.key)] : []);
    const spotSet = spotOn ? around(spot.key) : null;
    const prevSet = prevLevel > 0 ? around(spot.prev) : null;
    const dimBySpot = Math.max(spotLevel, prevLevel) * 0.55;
    const spotGlowOf = (key: string) => (spotSet?.has(key) ? spotLevel : 0) + (prevSet?.has(key) ? prevLevel : 0);

    const inCollege = (n: SimNode) => !p.collegeFocus || (p.collegeFocus === "none" ? !n.node.collegeId : n.node.collegeId === p.collegeFocus);
    const isLead = (n: SimNode) => n.node.clubIds.some((id) => leads.current.has(id));
    const isMember = (n: SimNode) => n.node.clubIds.some((id) => member.current.has(id));

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);
    ctx.lineCap = "round";

    // Lines, lightest first so heavy ones sit on top. Each bows gently to one side.
    const maxW = maxWeightRef.current;
    const hair = 0.7 / t.k;
    const widthScale = p.compact ? 0.75 : 1;
    for (const l of links) {
      if (l.weight < p.minWeight) continue;
      const s = l.source as SimNode;
      const tt = l.target as SimNode;
      if (s.x == null || tt.x == null) continue;
      const base = lineAlpha(l.weight, maxW) * th.lineAlpha;
      const touches = activeNode ? s.key === activeNode || tt.key === activeNode : activeLink ? l.key === activeLink || `${tt.key}|${s.key}` === activeLink : false;
      let alpha = base;
      let color = th.line;
      let spotGlow = 0;
      if (lit) {
        if (touches) {
          alpha = Math.min(1, 0.35 + 1.4 * base);
          color = th.highlight;
        } else alpha *= 0.14;
      } else if (spotOn) {
        spotGlow = (s.key === spot.key || tt.key === spot.key ? spotLevel : 0) + (spot.prev && (s.key === spot.prev || tt.key === spot.prev) ? prevLevel : 0);
        if (spotGlow < 0.01) alpha *= 1 - dimBySpot;
      }
      if (p.collegeFocus && !(inCollege(s) && inCollege(tt))) alpha *= 0.2;
      const c = bend(s, tt);
      const width = Math.max(hair, lineWidthRef.current(l.weight) * widthScale) * (touches ? 1.15 : 1);
      ctx.globalAlpha = alpha * appear;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y!);
      ctx.quadraticCurveTo(c.x, c.y, tt.x, tt.y!);
      ctx.stroke();
      if (spotGlow > 0.01) {
        // The spotlight's lines brighten in place rather than snapping to a new color.
        ctx.globalAlpha = Math.min(1, 0.3 + 1.4 * base) * spotGlow * appear;
        ctx.strokeStyle = th.highlight;
        ctx.lineWidth = width * 1.1;
        ctx.stroke();
      }
    }

    const ring = 1.25 / t.k;
    const quietR = (n: SimNode) => Math.max(1.5 / t.k, n.r * 0.5);
    const special = (n: SimNode) =>
      (lit?.has(n.key) ?? false) || isLead(n) || isMember(n) || (p.selection?.type === "node" && p.selection.key === n.key) || (hover?.kind === "node" && hover.key === n.key);

    // Clubs with no lines yet: a quiet field of small dots behind the network.
    for (const n of nodes) {
      if (n.strength > 0 || n.x == null || n.y == null || special(n)) continue;
      const faded = Boolean(lit) || !inCollege(n);
      ctx.globalAlpha = (faded ? 0.1 : th.quietAlpha * (1 - dimBySpot * 0.5)) * appear;
      ctx.fillStyle = p.collegeFocus && inCollege(n) ? colorOf(p.colors, n.node.collegeId) : th.quiet;
      ctx.beginPath();
      ctx.arc(n.x, n.y, quietR(n), 0, Math.PI * 2);
      ctx.fill();
    }

    // A soft glow behind the busiest clubs (dark map only).
    if (th.glow) {
      let glows = 0;
      for (const n of nodes) {
        if (glows >= 28) break;
        // College clubs glow in their color; university-wide ones don't, or the middle turns to haze.
        if (n.strength <= 0 || n.x == null || n.y == null || !n.node.collegeId) continue;
        glows++;
        const faded = (lit && !lit.has(n.key)) || !inCollege(n);
        const boost = spotGlowOf(n.key);
        const a = (faded ? 0.15 : 0.7 + 0.3 * boost) * (1 - (faded ? 0 : dimBySpot * (1 - boost))) * appear;
        const size = n.r * (4.2 + boost * 1.2);
        ctx.globalAlpha = a;
        ctx.drawImage(glowFor(colorOf(p.colors, n.node.collegeId)), n.x - size, n.y - size, size * 2, size * 2);
      }
    }

    // Clubs with lines (and anything you point at or belong to): biggest first, so small clubs stay visible on top.
    for (const n of nodes) {
      if (n.x == null || n.y == null) continue;
      if (n.strength <= 0 && !special(n)) continue;
      const faded = (lit && !lit.has(n.key)) || !inCollege(n);
      const lead = isLead(n);
      const mine = lead || isMember(n);
      const boost = spotGlowOf(n.key);
      if (faded) {
        // An opaque surface disc first, so faded clubs read as pale circles instead of
        // showing the lines that meet at their centers through a see-through fill.
        ctx.globalAlpha = appear;
        ctx.fillStyle = th.surface;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = (faded ? 0.24 : 1 - dimBySpot * (1 - boost) * 0.6) * appear;
      const selected = p.selection?.type === "node" && p.selection.key === n.key;
      const hovered = hover?.kind === "node" && hover.key === n.key;
      if (selected) {
        // The picked club alone gets the glow, so a highlight never reads as a leftover selection.
        ctx.fillStyle = th.selectGlow;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 10 / t.k, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = colorOf(p.colors, n.node.collegeId);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      // Surface ring keeps touching nodes apart.
      ctx.lineWidth = ring;
      ctx.strokeStyle = th.surface;
      ctx.stroke();
      // Rings: solid = what you're pointing at, picked, or in the spotlight; dashed = your clubs (always on, per the spec:
      // leaders and advisors see their clubs highlighted — purple for clubs you lead, gray for clubs you're in).
      if (selected || hovered) {
        const width = (selected ? 3 : 2) / t.k;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + ring + width / 2, 0, Math.PI * 2);
        ctx.lineWidth = width;
        ctx.strokeStyle = selected ? th.highlight : th.ink;
        ctx.stroke();
      } else if (mine) {
        const width = (lead ? 2.25 : 1.75) / t.k;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + ring + width / 2 + 1 / t.k, 0, Math.PI * 2);
        ctx.lineWidth = width;
        ctx.strokeStyle = lead ? th.highlight : th.mineGray;
        ctx.setLineDash([4 / t.k, 3 / t.k]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (n.key === spot.key || n.key === spot.prev) {
        const level = n.key === spot.key ? spotLevel : prevLevel;
        if (level > 0.01) {
          const width = 1.75 / t.k;
          ctx.globalAlpha = level * appear;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + ring + width / 2 + 1.5 / t.k, 0, Math.PI * 2);
          ctx.lineWidth = width;
          ctx.strokeStyle = th.highlight;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    // Names, in screen space.
    //  - The full map: whatever's in focus and your clubs, then the biggest clubs that fit,
    //    more of them as you zoom in. Dots with no lines stay unnamed until you're close.
    //  - The landing embed: no resting names at all, only what you point at (and its closest
    //    neighbors) or the spotlight's club, so the picture stays calm.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const size = p.compact ? 11 : 11.5;
    const font = (weight: number, px = size) => `${weight} ${px}px ${fontRef.current}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const priority = (n: SimNode) => {
      if (n.key === activeNode || (p.selection?.type === "node" && p.selection.key === n.key)) return 0;
      if (lit?.has(n.key)) return 1;
      if (isLead(n)) return 2;
      if (isMember(n)) return 3;
      return 4;
    };
    const measure = (text: string, weight: number, px = size) => {
      const k = `${weight}|${px}|${text}`;
      let tw = widthsRef.current.get(k);
      if (tw == null) {
        ctx.font = font(weight, px);
        tw = ctx.measureText(text).width;
        widthsRef.current.set(k, tw);
      }
      return tw;
    };
    const shorten = (text: string) => (text.length > 28 ? `${text.slice(0, 26)}…` : text);
    const label = (n: SimNode, alpha: number, strong: boolean, caption?: string) => {
      const text = shorten(n.node.short);
      const weight = strong ? 600 : 500;
      const tw = measure(text, weight);
      const cw = caption ? measure(caption, 500, size - 1.5) : 0;
      const padX = th.pill ? 7 : 3;
      const boxW = Math.max(tw, cw) + padX * 2;
      const boxH = caption ? 34 : th.pill ? 20 : 15;
      const sr = n.r * t.k;
      let cx = n.x! * t.k + t.x;
      const top = n.y! * t.k + t.y + sr + 5;
      if (cx < -60 || cx > w + 60 || top < -30 || top > h + 10) return false;
      cx = clamp(cx, boxW / 2 + 6, w - boxW / 2 - 6);
      const box = { x0: cx - boxW / 2, y0: top, x1: cx + boxW / 2, y1: top + boxH };
      if (placed.some((b) => !(box.x1 + 2 < b.x0 || box.x0 > b.x1 + 2 || box.y1 + 2 < b.y0 || box.y0 > b.y1 + 2))) return false;
      placed.push(box);
      ctx.globalAlpha = alpha * appear;
      if (th.pill) {
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(box.x0, box.y0, boxW, boxH, 7);
        else ctx.rect(box.x0, box.y0, boxW, boxH);
        ctx.fillStyle = th.pill.fill;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = th.pill.stroke;
        ctx.stroke();
      }
      const ty = caption ? top + 12 : top + boxH / 2;
      ctx.font = font(weight);
      if (!th.pill) {
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.strokeStyle = th.halo;
        ctx.strokeText(text, cx, ty);
      }
      ctx.fillStyle = strong ? th.ink : th.inkSoft;
      ctx.fillText(text, cx, ty);
      if (caption) {
        ctx.font = font(500, size - 1.5);
        ctx.fillStyle = th.inkSoft;
        ctx.fillText(caption, cx, top + 25);
      }
      return true;
    };

    const ranked = [...nodes].filter((n) => n.x != null && n.y != null).sort((a, b) => priority(a) - priority(b) || b.r - a.r);
    if (p.compact) {
      let neighbors = 0;
      for (const n of ranked) {
        const pr = priority(n);
        // The card beside the pointer already names the club you're on; its neighbors get the labels.
        if (pr === 0) continue;
        if (pr === 1 && neighbors < 5) {
          if (label(n, 0.92, false)) neighbors++;
        }
      }
      if (spotOn) {
        for (const [key, level] of [
          [spot.key, spotLevel],
          [spot.prev, prevLevel],
        ] as const) {
          if (!key || level < 0.02) continue;
          const n = byKeyRef.current.get(key);
          if (!n || n.x == null) continue;
          const links = p.adjacency.get(key)?.length ?? 0;
          label(n, level, true, `Connected to ${links} ${links === 1 ? "club" : "clubs"}`);
        }
      }
    } else {
      const budget = Math.round(clamp(4 + 7 * t.k, 6, 50));
      let count = 0;
      for (const n of ranked) {
        const pr = priority(n);
        if (pr === 4 && ((lit && !lit.has(n.key)) || !inCollege(n))) continue;
        if (pr >= 3) {
          if (count >= budget) continue;
          if (n.strength <= 0 && t.k < 1.8) continue;
          if (n.r * t.k < 6) continue;
        }
        if (label(n, 1, pr <= 2)) count++;
      }
    }
    ctx.globalAlpha = 1;
  };

  const requestDraw = () => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      draw();
    });
  };

  // ─── view transform ──────────────────────────────────────────────────────

  const fitTransform = (): Transform => {
    const { w, h } = sizeRef.current;
    const all = nodesRef.current.filter((n) => n.x != null && n.y != null);
    // Frame the connected clubs; the quiet dots beyond them become the backdrop (zoom out to see them all).
    const core = all.filter((n) => n.strength > 0);
    const nodes = core.length >= 3 ? core : all;
    const inset = propsRef.current.rightInset;
    if (!nodes.length) return { k: 1, x: (w - inset) / 2, y: h / 2 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      x0 = Math.min(x0, n.x! - n.r);
      x1 = Math.max(x1, n.x! + n.r);
      y0 = Math.min(y0, n.y! - n.r);
      y1 = Math.max(y1, n.y! + n.r + 14); // room for the label under the lowest node
    }
    const pad = propsRef.current.compact ? 14 : 28;
    const aw = Math.max(80, w - inset - pad * 2);
    const ah = Math.max(80, h - pad * 2);
    const k = clamp(Math.min(aw / Math.max(1, x1 - x0), ah / Math.max(1, y1 - y0)), MIN_K, 2.4);
    return { k, x: pad + aw / 2 - ((x0 + x1) / 2) * k, y: pad + ah / 2 - ((y0 + y1) / 2) * k };
  };

  const animateTo = (target: Transform, ms = 420) => {
    cancelAnimationFrame(animRef.current);
    if (reducedRef.current) {
      tRef.current = target;
      requestDraw();
      return;
    }
    const from = { ...tRef.current };
    const start = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - u, 3);
      tRef.current = { k: from.k + (target.k - from.k) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
      draw();
      if (u < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
  };

  const zoomAt = (factor: number, sx: number, sy: number, animate = false) => {
    const t = tRef.current;
    const k = clamp(t.k * factor, MIN_K, MAX_K);
    const target = { k, x: sx - ((sx - t.x) / t.k) * k, y: sy - ((sy - t.y) / t.k) * k };
    autoFitRef.current = false;
    if (animate) animateTo(target, 220);
    else {
      tRef.current = target;
      requestDraw();
    }
  };

  useImperativeHandle(handleRef, () => ({
    focus(key: string) {
      const n = byKeyRef.current.get(key);
      if (!n || n.x == null || n.y == null) return;
      const { w, h } = sizeRef.current;
      const k = clamp(Math.max(tRef.current.k, 1.1), MIN_K, MAX_K);
      autoFitRef.current = false;
      animateTo({ k, x: (w - propsRef.current.rightInset) / 2 - n.x * k, y: h / 2 - n.y * k });
    },
    zoom(factor: number) {
      const { w, h } = sizeRef.current;
      zoomAt(factor, (w - propsRef.current.rightInset) / 2, h / 2, true);
    },
    fit() {
      autoFitRef.current = true;
      animateTo(fitTransform());
    },
  }));

  // ─── simulation lifecycle ────────────────────────────────────────────────

  /** Where the layout rests: gently floating, or fully still for reduced motion. */
  const restTarget = () => (reducedRef.current ? 0 : FLOAT_ALPHA);

  /** Heats the layout up to `alpha` and runs it — unless the canvas is out of view, where it resumes when seen. */
  const kick = (alpha: number) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.alpha(alpha);
    if (visibleRef.current) sim.restart();
  };

  useEffect(() => {
    reducedRef.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const family = canvasRef.current ? getComputedStyle(canvasRef.current).fontFamily : "";
    if (family) fontRef.current = family;
    const sim = createSimulation();
    if (!reducedRef.current) sim.force("float", floatForce());
    sim.alphaTarget(restTarget());
    sim.on("tick", () => {
      // Follow the settling layout until someone takes the controls — but not the
      // gentle float afterwards, or the whole view would keep breathing.
      if (autoFitRef.current && sim.alpha() > FLOAT_ALPHA * 3) {
        const target = fitTransform();
        const t = tRef.current;
        tRef.current = { k: t.k + (target.k - t.k) * 0.12, x: t.x + (target.x - t.x) * 0.12, y: t.y + (target.y - t.y) * 0.12 };
      }
      draw();
    });
    simRef.current = sim;
    return () => {
      sim.stop();
      sim.on("tick", null);
      // Reset the ids too: requestDraw skips while frameRef is non-zero, so a
      // cancelled-but-remembered frame would silently block every later redraw
      // (hover, selection, pan, wheel zoom) once the layout stopped ticking.
      cancelAnimationFrame(frameRef.current);
      cancelAnimationFrame(animRef.current);
      frameRef.current = 0;
      animRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause the floating layout while the canvas is out of view (e.g. scrolled past on the landing page).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      const sim = simRef.current;
      visibleRef.current = entry.isIntersecting;
      if (!sim || reducedRef.current) return;
      if (entry.isIntersecting) sim.restart();
      else sim.stop();
    });
    io.observe(wrap);
    return () => io.disconnect();
  }, []);

  // The landing embed's spotlight: every few seconds one of the busiest clubs lights up its
  // connections and shows its name, so the map explains itself without a wall of labels. It
  // waits while someone points at the map or it's off screen, and never runs with reduced motion.
  useEffect(() => {
    if (!compact || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    let fade = 0;
    const advance = () => {
      if (hoverRef.current || !visibleRef.current || document.visibilityState !== "visible") return;
      const hubs = nodesRef.current.filter((n) => n.strength > 0).sort((a, b) => b.strength - a.strength).slice(0, SPOT_HUBS);
      if (!hubs.length) return;
      const next = hubs[i % hubs.length].key;
      i++;
      spotRef.current = { key: next, prev: spotRef.current.key, since: performance.now() };
      // Keep drawing through the crossfade, even if the layout happens to be still.
      const until = performance.now() + SPOT_FADE_MS + 50;
      cancelAnimationFrame(fade);
      const step = () => {
        draw();
        if (performance.now() < until) fade = requestAnimationFrame(step);
      };
      fade = requestAnimationFrame(step);
    };
    const first = setTimeout(advance, APPEAR_MS + 900);
    const timer = setInterval(advance, SPOT_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      cancelAnimationFrame(fade);
      spotRef.current = { key: null, prev: null, since: 0 };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  // Canvas size follows its box (and the screen's pixel density).
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const prev = sizeRef.current;
      if (Math.abs(prev.w - rect.width) < 1 && Math.abs(prev.h - rect.height) < 1 && prev.dpr === dpr) return;
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      if (prev.w === 0 || autoFitRef.current) tRef.current = fitTransform();
      else tRef.current = { ...tRef.current, x: tRef.current.x + (rect.width - prev.w) / 2, y: tRef.current.y + (rect.height - prev.h) / 2 };
      draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New data: keep every node that's still there exactly where it is, seed the rest, re-run forces.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    for (const n of nodesRef.current) if (n.x != null && n.y != null) knownRef.current.set(n.key, { x: n.x, y: n.y });

    const grouped = data.group !== "club";
    const r = radiusScale(data.nodes, { grouped, compact, count: data.nodes.length });
    const old = byKeyRef.current;
    const nodes: SimNode[] = data.nodes
      .map((node) => {
        const prev = old.get(node.key);
        if (prev) {
          prev.node = node;
          prev.r = r(node.size);
          prev.strength = 0;
          return prev;
        }
        return { key: node.key, node, r: r(node.size), strength: 0 } as SimNode;
      })
      .sort((a, b) => b.r - a.r);
    const links = buildLinks(nodes, data.edges).sort((a, b) => a.weight - b.weight);
    for (const l of links) {
      (l.source as SimNode).strength += l.weight;
      (l.target as SimNode).strength += l.weight;
    }
    seedPositions(nodes, links, knownRef.current);
    nodesRef.current = nodes;
    linksRef.current = links;
    byKeyRef.current = new Map(nodes.map((n) => [n.key, n]));
    lineWidthRef.current = lineWidthScale(data.edges);
    maxWeightRef.current = Math.max(1, ...data.edges.map((e) => e.weight));

    const { w, h } = sizeRef.current;
    applyForces(sim, nodes, links, { width: w || 800, height: h || height, compact });

    const view = `${data.window}|${data.group}`;
    const keys = data.nodes.map((n) => n.key).join(",");
    const firstLoad = structureRef.current === "";
    const viewChanged = view !== structureRef.current;
    const keysChanged = keys !== keysRef.current;
    structureRef.current = view;
    keysRef.current = keys;

    if (firstLoad || reducedRef.current) {
      // Settle before the first paint (bounded, so a big network never blocks the page).
      sim.alpha(firstLoad ? 1 : 0.5);
      if (firstLoad) bornRef.current = performance.now();
      const start = performance.now();
      for (let i = 0; i < 300 && performance.now() - start < 140; i++) sim.tick();
      if (firstLoad) tRef.current = fitTransform();
      if (reducedRef.current) {
        for (let i = 0; i < 300 && sim.alpha() > sim.alphaMin(); i++) sim.tick();
        if (autoFitRef.current) tRef.current = fitTransform();
        draw();
        return;
      }
      kick(0.25);
    } else if (viewChanged) {
      // New window or grouping: let the layout travel to its new shape.
      kick(0.6);
    } else if (keysChanged) {
      // A club was approved or retired since the last poll.
      kick(0.3);
    } else {
      // A poll with the same clubs: sizes and weights drift and the map eases into them.
      kick(0.12);
    }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Grouping changes always start with a fresh fit.
  const groupRef = useRef(data.group);
  useEffect(() => {
    if (groupRef.current !== data.group) {
      groupRef.current = data.group;
      autoFitRef.current = true;
    }
  }, [data.group]);

  useEffect(() => {
    requestDraw();
    if (!compact) setPinned(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, collegeFocus, minWeight, colors, rightInset]);

  // ─── hit testing ─────────────────────────────────────────────────────────

  const toWorld = (sx: number, sy: number) => {
    const t = tRef.current;
    return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k };
  };

  const nodeAt = (sx: number, sy: number): SimNode | null => {
    const { x, y } = toWorld(sx, sy);
    const slop = 6 / tRef.current.k;
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of nodesRef.current) {
      if (n.x == null || n.y == null) continue;
      const d = Math.hypot(n.x - x, n.y - y) - n.r;
      if (d <= slop && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };

  const linkAt = (sx: number, sy: number): SimLink | null => {
    const { x, y } = toWorld(sx, sy);
    const min = propsRef.current.minWeight;
    let best: SimLink | null = null;
    let bestD = Infinity;
    for (const l of linksRef.current) {
      if (l.weight < min) continue;
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      if (s.x == null || t.x == null) continue;
      const d = distToCurve(x, y, s, t);
      const tol = Math.max(lineWidthRef.current(l.weight) / 2, 5 / tRef.current.k);
      if (d <= tol && (d < bestD - 0.5 || (Math.abs(d - bestD) <= 0.5 && l.weight > (best?.weight ?? 0)))) {
        best = l;
        bestD = d;
      }
    }
    return best;
  };

  const tipFor = (sx: number, sy: number): Tip | null => {
    const n = nodeAt(sx, sy);
    if (n) return { kind: "node", key: n.key, x: sx, y: sy };
    const l = linkAt(sx, sy);
    if (l) return { kind: "link", a: (l.source as SimNode).key, b: (l.target as SimNode).key, weight: l.weight, x: sx, y: sy };
    return null;
  };

  // ─── pointer, wheel and keyboard ─────────────────────────────────────────

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { mode: "pan"; sx: number; sy: number; tx: number; ty: number; moved: boolean; t0: number; target: Tip | null }
    | { mode: "drag"; node: SimNode; sx: number; sy: number; moved: boolean; t0: number }
    | { mode: "pinch"; d0: number; k0: number; mx: number; my: number; tx: number; ty: number }
    | null
  >(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const setHover = (next: Tip | null) => {
    const prev = hoverRef.current;
    const same =
      (prev === null && next === null) ||
      (prev?.kind === "node" && next?.kind === "node" && prev.key === next.key) ||
      (prev?.kind === "link" && next?.kind === "link" && prev.a === next.a && prev.b === next.b);
    hoverRef.current = next;
    setTip(next);
    if (!same) requestDraw();
  };

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    const t = tRef.current;
    const g = gesture.current;
    if (g?.mode === "drag") {
      g.node.fx = null;
      g.node.fy = null;
      simRef.current?.alphaTarget(restTarget());
    }
    gesture.current = { mode: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: t.k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx: t.x, ty: t.y };
    autoFitRef.current = false;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    canvasRef.current?.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) return startPinch();
    if (pointers.current.size > 2) return;
    const n = nodeAt(p.x, p.y);
    if (n && !(compact && e.pointerType === "touch")) {
      gesture.current = { mode: "drag", node: n, sx: p.x, sy: p.y, moved: false, t0: performance.now() };
    } else {
      const t = tRef.current;
      gesture.current = { mode: "pan", sx: p.x, sy: p.y, tx: t.x, ty: t.y, moved: false, t0: performance.now(), target: n ? { kind: "node", key: n.key, x: p.x, y: p.y } : null };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) {
      if (e.pointerType === "mouse") {
        const next = tipFor(p.x, p.y);
        setHover(next);
        canvasRef.current!.style.cursor = next ? "pointer" : "grab";
      }
      return;
    }
    if (g.mode === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const k = clamp(g.k0 * (d / g.d0), MIN_K, MAX_K);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      // Keep the world point under the starting midpoint under the fingers' midpoint.
      const wx = (g.mx - g.tx) / g.k0;
      const wy = (g.my - g.ty) / g.k0;
      tRef.current = { k, x: mx - wx * k, y: my - wy * k };
      requestDraw();
      return;
    }
    const dx = p.x - g.sx;
    const dy = p.y - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!g.moved) {
      g.moved = true;
      setHover(null);
      if (g.mode === "drag") simRef.current?.alphaTarget(0.25).restart();
    }
    autoFitRef.current = false;
    if (g.mode === "drag") {
      const w = toWorld(p.x, p.y);
      g.node.fx = w.x;
      g.node.fy = w.y;
      canvasRef.current!.style.cursor = "grabbing";
    } else {
      tRef.current = { ...tRef.current, x: g.tx + dx, y: g.ty + dy };
      canvasRef.current!.style.cursor = "grabbing";
      requestDraw();
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.mode === "pinch") {
      if (pointers.current.size === 0) gesture.current = null;
      else {
        // One finger left: carry on as a pan from here.
        const [rest] = [...pointers.current.values()];
        const t = tRef.current;
        gesture.current = { mode: "pan", sx: rest.x, sy: rest.y, tx: t.x, ty: t.y, moved: true, t0: 0, target: null };
      }
      return;
    }
    gesture.current = null;
    if (g.mode === "drag") {
      g.node.fx = null;
      g.node.fy = null;
      simRef.current?.alphaTarget(restTarget());
    }
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
    if (cancelled || g.moved) return;
    // A click or tap.
    const p = local(e);
    const hit = tipFor(p.x, p.y);
    if (compact) {
      setPinned(hit);
      hoverRef.current = hit;
      requestDraw();
      return;
    }
    if (hit?.kind === "node") onSelect({ type: "node", key: hit.key });
    else if (hit?.kind === "link") onSelect({ type: "link", a: hit.a, b: hit.b });
    else onSelect(null);
  };

  // Wheel zoom needs a non-passive listener. The wheel only zooms once someone
  // has engaged the map (clicked or tabbed into it — not on the landing embed),
  // or with Ctrl/⌘ held, which is also how trackpad pinches arrive. Otherwise
  // scrolling the page past a tall canvas would get stuck zooming it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      const engaged = e.ctrlKey || e.metaKey || (!compact && document.activeElement === canvas);
      if (!engaged) {
        setHint(compact ? "Hold Ctrl (or ⌘) and scroll to zoom" : "Click the map first to zoom with scroll, or hold Ctrl (⌘)");
        if (hintTimer.current) clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => setHint(null), 1600);
        return;
      }
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      zoomAt(Math.exp(-e.deltaY * scale * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const { w, h } = sizeRef.current;
    const pan = (dx: number, dy: number) => {
      autoFitRef.current = false;
      animateTo({ ...tRef.current, x: tRef.current.x + dx, y: tRef.current.y + dy }, 160);
    };
    switch (e.key) {
      case "ArrowLeft":
        pan(60, 0);
        break;
      case "ArrowRight":
        pan(-60, 0);
        break;
      case "ArrowUp":
        pan(0, 60);
        break;
      case "ArrowDown":
        pan(0, -60);
        break;
      case "+":
      case "=":
        zoomAt(1.3, w / 2, h / 2, true);
        break;
      case "-":
      case "_":
        zoomAt(1 / 1.3, w / 2, h / 2, true);
        break;
      case "0":
        autoFitRef.current = true;
        animateTo(fitTransform());
        break;
      case "Escape":
        if (compact) setPinned(null);
        else onSelect(null);
        hoverRef.current = null;
        requestDraw();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const shown = compact ? (pinned ?? tip) : tip;
  const nodeByKey = new Map(data.nodes.map((n) => [n.key, n]));

  return (
    // Fills its container, which sets the height (fixed on the landing embed, viewport-aware on /network).
    <div ref={wrapRef} className="relative h-full w-full select-none">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        className={cn(
          "absolute inset-0 h-full w-full cursor-grab rounded-[inherit] outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset",
          refreshing && "opacity-70",
        )}
        style={{ touchAction: compact ? "pan-y" : "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e, false)}
        onPointerCancel={(e) => endPointer(e, true)}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse" && !gesture.current) setHover(compact && pinned ? pinned : null);
        }}
        onKeyDown={onKeyDown}
      />
      {shown ? (
        <TipCard tip={shown} nodes={nodeByKey} adjacency={adjacency} pinned={compact && pinned !== null} compact={compact} dark={theme === "night"} width={sizeRef.current.w} height={sizeRef.current.h} />
      ) : null}
      {hint ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center" aria-hidden="true">
          <span className={cn("rounded-full px-3 py-1.5 text-xs font-medium shadow-lg", theme === "night" ? "bg-white/90 text-ink" : "bg-ink/85 text-white")}>{hint}</span>
        </div>
      ) : null}
    </div>
  );
}

function TipCard({
  tip,
  nodes,
  adjacency,
  pinned,
  compact,
  dark,
  width,
  height,
}: {
  tip: Tip;
  nodes: Map<string, NetworkViewNode>;
  adjacency: Adjacency;
  pinned: boolean;
  compact: boolean;
  /** On the landing page's dark band the card is dark glass. */
  dark: boolean;
  width: number;
  height: number;
}) {
  const c = dark
    ? { card: "border-white/10 bg-[#1a1322]/95 shadow-2xl shadow-black/40 backdrop-blur-sm", ink: "text-white", soft: "text-white/75", faint: "text-white/55", rule: "border-white/10", link: "text-brand-200" }
    : { card: "border-line bg-surface shadow-[var(--shadow-pop)]", ink: "text-ink", soft: "text-ink-2", faint: "text-ink-3", rule: "border-line", link: "text-brand-600" };
  // Flip to the other side of the pointer near the right and bottom edges, so the card never leaves the canvas.
  const style: React.CSSProperties = {};
  if (tip.x > width / 2) style.right = Math.max(8, width - tip.x + 14);
  else style.left = Math.max(8, tip.x + 14);
  if (tip.y > height / 2) style.bottom = Math.max(8, height - tip.y + 14);
  else style.top = Math.max(8, tip.y + 14);

  if (tip.kind === "link") {
    const a = nodes.get(tip.a);
    const b = nodes.get(tip.b);
    if (!a || !b) return null;
    return (
      <div className={cn("pointer-events-none absolute z-10 w-max max-w-[15rem] rounded-xl border px-3 py-2 text-xs", c.card)} style={style} role="tooltip">
        <p className={cn("font-semibold", c.ink)}>
          {a.label} <span className={cn("font-normal", c.faint)}>and</span> {b.label}
        </p>
        <p className="mt-1">
          <span className={cn("text-sm font-semibold", c.ink)}>{fmt(tip.weight)}</span> <span className={c.faint}>cross-club check-ins</span>
        </p>
        {!compact ? <p className={cn("mt-1", c.faint)}>Click the line for the breakdown</p> : null}
      </div>
    );
  }

  const n = nodes.get(tip.key);
  if (!n) return null;
  const top = (adjacency.get(n.key) ?? []).slice(0, 3);
  return (
    <div
      className={cn("absolute z-10 w-max max-w-[16rem] rounded-xl border px-3 py-2 text-xs", c.card, pinned ? "pointer-events-auto" : "pointer-events-none")}
      style={style}
      role={pinned ? "dialog" : "tooltip"}
      aria-label={pinned ? n.label : undefined}
    >
      <p className={cn("text-sm font-semibold", c.ink)}>{n.label}</p>
      <p className={c.faint}>{n.detail}</p>
      <p className={cn("mt-1.5", c.soft)}>
        <span className={cn("font-semibold", c.ink)}>{fmt(n.members)}</span> {n.kind === "club" ? "members" : "memberships"} · <span className={cn("font-semibold", c.ink)}>{fmt(n.size)}</span> check-ins
      </p>
      {top.length ? (
        <div className={cn("mt-1.5 border-t pt-1.5", c.rule)}>
          <p className={c.faint}>Most connected with</p>
          <ul className="mt-0.5 space-y-0.5">
            {top.map((t) => (
              <li key={t.key} className="flex justify-between gap-3">
                <span className={cn("truncate", c.soft)}>{nodes.get(t.key)?.label ?? "—"}</span>
                <span className={cn("tabular-nums font-medium", c.ink)}>{fmt(t.weight)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={cn("mt-1.5", c.faint)}>No cross-club check-ins yet</p>
      )}
      {pinned && n.href ? (
        <Link href={n.href} className={cn("mt-2 inline-flex items-center gap-1 font-semibold hover:underline", c.link)}>
          Open club page <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}
