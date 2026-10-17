"use client";

/**
 * CONTRACT (owner: network builder). The inter-club activity canvas, fed by
 * GET /api/network. Force-directed: activity → node size, cross-attendance →
 * line weight, interconnection → centrality. Group by club/college/department/
 * major. Viewer's clubs highlighted.
 *
 * <NetworkGraph height? compact? className? initialData? syncUrl? />
 *   compact     — the landing-page embed: canvas, zoom buttons, a mini legend
 *                 and "Explore the full network"; tapping a club shows its card.
 *   initialData — a server-rendered NetworkPayload so the canvas paints at once.
 *   syncUrl     — keep ?window= and ?group= in the address bar (/network).
 * Polls every 60 s and updates in place: clubs keep their positions.
 */

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, BarChart3, Expand, Minus, Network as NetworkIcon, Plus, RefreshCw, Table2 } from "lucide-react";
import {
  DEFAULT_NETWORK_GROUP,
  DEFAULT_NETWORK_WINDOW,
  NETWORK_GROUPS,
  NETWORK_WINDOWS,
  type NetworkGroup,
  type NetworkPayload,
  type NetworkWindow,
} from "@/lib/analytics/network-model";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { collegeColors } from "./colors";
import { NetworkCanvas, type Adjacency, type CanvasHandle, type NetworkSelection } from "./NetworkCanvas";
import { NetworkLegend } from "./NetworkLegend";
import { NetworkPanel } from "./NetworkPanel";
import { NetworkSearch } from "./NetworkSearch";
import { NetworkTable } from "./NetworkTable";

export type NetworkGraphProps = {
  height?: number;
  compact?: boolean;
  className?: string;
  /** Server-rendered first payload (the /network page), so the canvas paints without waiting for a fetch. */
  initialData?: NetworkPayload | null;
  /** Keep ?window= and ?group= in the address bar so a view can be shared. */
  syncUrl?: boolean;
};

const POLL_MS = 60_000;
const PANEL_INSET = 336; // lg panel width (320) + its margin
type LineFilter = "all" | "stronger" | "strongest";
const fmt = (n: number) => n.toLocaleString("en-US");

export function NetworkGraph({ height = 480, compact = false, className, initialData = null, syncUrl = false }: NetworkGraphProps) {
  const [win, setWin] = useState<NetworkWindow>(initialData?.window ?? DEFAULT_NETWORK_WINDOW);
  const [group, setGroup] = useState<NetworkGroup>(initialData?.group ?? DEFAULT_NETWORK_GROUP);
  const [data, setData] = useState<NetworkPayload | null>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialData);
  const [selection, setSelection] = useState<NetworkSelection>(null);
  const [focusPanel, setFocusPanel] = useState(false);
  const [collegeFocus, setCollegeFocus] = useState<string | null>(null);
  const [lineFilter, setLineFilter] = useState<LineFilter>("all");
  const [asTable, setAsTable] = useState(false);
  const [wide, setWide] = useState(false);
  const canvas = useRef<CanvasHandle>(null);
  const lastFetch = useRef(initialData ? Date.now() : 0);
  const reqId = useRef(0);
  const ids = useId();

  const load = useCallback(async (w: NetworkWindow, g: NetworkGroup, quiet: boolean) => {
    const id = ++reqId.current;
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`/api/network?window=${w}&group=${g}`, { cache: "no-store", headers: { accept: "application/json" } });
      const json = await res.json().catch(() => null);
      if (id !== reqId.current) return;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "The club network didn't load.");
      setData(json.data as NetworkPayload);
      setError(null);
      lastFetch.current = Date.now();
    } catch (e) {
      if (id !== reqId.current) return;
      // A failed background refresh keeps the last good picture; a failed switch says so.
      if (!quiet) setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "The club network didn't load. Check your connection and try again.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  // Fetch whenever the window or grouping changes (the server-rendered payload covers the first view).
  useEffect(() => {
    if (data && data.window === win && data.group === group) return;
    load(win, group, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, group, load]);

  // Live: refresh every minute while the tab is visible, and on return after a minute away.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") load(win, group, true);
    };
    const timer = setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastFetch.current > POLL_MS) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [win, group, load]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!syncUrl) return;
    const url = new URL(window.location.href);
    if (win === DEFAULT_NETWORK_WINDOW) url.searchParams.delete("window");
    else url.searchParams.set("window", win);
    if (group === DEFAULT_NETWORK_GROUP) url.searchParams.delete("group");
    else url.searchParams.set("group", group);
    window.history.replaceState(window.history.state, "", url);
  }, [win, group, syncUrl]);

  // Drop a selection that no longer exists (a new grouping, or a club that left).
  useEffect(() => {
    if (!data || !selection) return;
    const keys = new Set(data.nodes.map((n) => n.key));
    if (selection.type === "node" ? !keys.has(selection.key) : !keys.has(selection.a) || !keys.has(selection.b)) setSelection(null);
  }, [data, selection]);

  const collegeKey = data?.colleges.map((c) => c.id).join(",") ?? "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const colors = useMemo(() => collegeColors(data?.colleges ?? []), [collegeKey]);

  const adjacency: Adjacency = useMemo(() => {
    const out: Adjacency = new Map();
    for (const e of data?.edges ?? []) {
      (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push({ key: e.target, weight: e.weight });
      (out.get(e.target) ?? out.set(e.target, []).get(e.target)!).push({ key: e.source, weight: e.weight });
    }
    for (const list of out.values()) list.sort((a, b) => b.weight - a.weight);
    return out;
  }, [data?.edges]);

  const thresholds = useMemo(() => {
    const ws = (data?.edges ?? []).map((e) => e.weight).sort((a, b) => a - b);
    const q = (p: number) => (ws.length ? ws[Math.min(ws.length - 1, Math.floor(p * ws.length))] : 0);
    return { stronger: q(0.5), strongest: q(0.9) };
  }, [data?.edges]);
  const minWeight = lineFilter === "all" ? 0 : thresholds[lineFilter];

  const select = useCallback((s: NetworkSelection, focus = false) => {
    setSelection(s);
    setFocusPanel(focus);
  }, []);

  const pickNode = (key: string) => {
    setAsTable(false);
    select({ type: "node", key }, true);
    // Give the canvas a moment to re-measure if it was hidden behind the table.
    setTimeout(() => canvas.current?.focus(key), asTable ? 80 : 0);
  };

  const groupMeta = NETWORK_GROUPS.find((g) => g.key === group)!;
  const refreshing = loading && Boolean(data);
  const ariaLabel = data
    ? `Club network ${data.windowPhrase}: ${data.nodes.length} ${data.group === "club" ? "clubs" : `groups by ${groupMeta.noun}`}, ${data.edges.length} connections. Bigger circles had more check-ins; thicker lines mean more members visiting each other's events.`
    : "Club network";

  // ─── compact (landing page) ──────────────────────────────────────────────
  if (compact) {
    return (
      <div className={cn("relative overflow-hidden rounded-xl bg-surface", className)} style={{ height }}>
        {data && data.nodes.length ? (
          <>
            <NetworkCanvas
              data={data}
              compact
              height={height}
              selection={null}
              onSelect={() => {}}
              collegeFocus={null}
              minWeight={0}
              colors={colors}
              adjacency={adjacency}
              handleRef={canvas}
              ariaLabel={ariaLabel}
            />
            <div className="pointer-events-none absolute left-2.5 top-2.5 max-w-[62%] rounded-lg bg-surface/85 px-2.5 py-1.5 text-[11px] leading-snug text-ink-2 backdrop-blur-sm">
              <p>
                <span className="font-semibold text-ink">Bigger</span> = more check-ins
              </p>
              <p>
                <span className="font-semibold text-ink">Thicker line</span> = more members visiting
              </p>
            </div>
            <ZoomControls onZoom={(f) => canvas.current?.zoom(f)} onFit={() => canvas.current?.fit()} className="right-2.5 top-2.5" small />
            <Link
              href="/network"
              className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white shadow-lg hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Explore the full network <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </>
        ) : (
          <CanvasState loading={loading} error={error} empty={Boolean(data && !data.nodes.length)} onRetry={() => load(win, group, false)} />
        )}
      </div>
    );
  }

  // ─── full (/network) ─────────────────────────────────────────────────────
  const visibleRows = data ? data.nodes.filter((n) => !collegeFocus || (collegeFocus === "none" ? !n.collegeId : n.collegeId === collegeFocus)) : [];
  const panelOpen = Boolean(selection && data && !asTable);
  const helpId = `${ids}-help`;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="min-w-0">
          <label htmlFor={`${ids}-window`} className="mb-1 block text-xs font-medium text-ink-3">
            Time window
          </label>
          <Select id={`${ids}-window`} value={win} onChange={(e) => setWin(e.target.value as NetworkWindow)} className="h-9 w-auto min-w-40 py-0 text-sm">
            {NETWORK_WINDOWS.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-0">
          <p id={`${ids}-group`} className="mb-1 text-xs font-medium text-ink-3">
            Group by
          </p>
          <div role="radiogroup" aria-labelledby={`${ids}-group`} className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-0.5 [scrollbar-width:none]">
            {NETWORK_GROUPS.map((g) => (
              <button
                key={g.key}
                type="button"
                role="radio"
                aria-checked={group === g.key}
                onClick={() => {
                  if (g.key === group) return;
                  setSelection(null);
                  setGroup(g.key);
                }}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                  group === g.key ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${ids}-lines`} className="mb-1 block text-xs font-medium text-ink-3">
            Lines
          </label>
          <Select id={`${ids}-lines`} value={lineFilter} onChange={(e) => setLineFilter(e.target.value as LineFilter)} className="h-9 w-auto py-0 text-sm" disabled={!data?.edges.length}>
            <option value="all">All connections</option>
            <option value="stronger">Stronger half{thresholds.stronger > 1 ? ` (${fmt(thresholds.stronger)}+)` : ""}</option>
            <option value="strongest">Strongest 10%{thresholds.strongest > 1 ? ` (${fmt(thresholds.strongest)}+)` : ""}</option>
          </Select>
        </div>
        <NetworkSearch nodes={data?.nodes ?? []} colors={colors} noun={groupMeta.noun} onPick={pickNode} className="w-full min-w-0 sm:w-64 lg:ml-auto" />
        <Button variant="outline" size="sm" className="h-9" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} disabled={!data?.nodes.length}>
          {asTable ? <NetworkIcon className="h-4 w-4" aria-hidden="true" /> : <Table2 className="h-4 w-4" aria-hidden="true" />}
          {asTable ? "View as a map" : "View as a table"}
        </Button>
      </div>

      {data ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3" aria-live="polite">
          <span>
            <span className="font-semibold text-ink">{fmt(data.nodes.length)}</span>{" "}
            {data.group === "club" ? (data.nodes.length === 1 ? "club" : "clubs") : `${data.nodes.length === 1 ? "group" : "groups"} by ${groupMeta.noun}`}
            {" · "}
            <span className="font-semibold text-ink">{fmt(data.edges.length)}</span> {data.edges.length === 1 ? "connection" : "connections"} {data.windowPhrase}
          </span>
          <span className="inline-flex items-center gap-1.5">
            {refreshing ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updating…
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" /> Live — refreshes every minute
              </>
            )}
          </span>
        </p>
      ) : null}

      <div
        className={cn("relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", asTable && "hidden")}
        // Shorter on phones, where the canvas takes touch drags for panning: page scrolling stays within reach.
        style={{ height: `clamp(340px, 62vh, ${height}px)` }}
      >
        {data && data.nodes.length ? (
          <>
            <NetworkCanvas
              data={data}
              compact={false}
              height={height}
              selection={selection}
              onSelect={(s) => select(s)}
              collegeFocus={collegeFocus}
              minWeight={minWeight}
              colors={colors}
              adjacency={adjacency}
              rightInset={panelOpen && wide ? PANEL_INSET : 0}
              handleRef={canvas}
              refreshing={refreshing}
              ariaLabel={ariaLabel}
              describedBy={helpId}
            />
            <ZoomControls onZoom={(f) => canvas.current?.zoom(f)} onFit={() => canvas.current?.fit()} className="left-3 top-3" />
            {data.edges.length === 0 ? (
              <p className="pointer-events-none absolute inset-x-3 bottom-3 mx-auto max-w-md rounded-lg bg-surface/90 px-3 py-2 text-center text-sm text-ink-2 shadow-sm">
                No cross-club check-ins {data.windowPhrase} yet. Lines appear when members of one club check in at another club&rsquo;s events.
              </p>
            ) : null}
            {panelOpen && selection ? (
              <NetworkPanel
                selection={selection}
                data={data}
                colors={colors}
                adjacency={adjacency}
                autoFocus={focusPanel}
                onClose={() => select(null)}
                onSelect={(s, focus) => {
                  select(s, focus);
                  if (s?.type === "node") canvas.current?.focus(s.key);
                }}
              />
            ) : null}
          </>
        ) : (
          <CanvasState loading={loading} error={error} empty={Boolean(data && !data.nodes.length)} onRetry={() => load(win, group, false)} />
        )}
      </div>
      {error && data ? (
        <p className="text-sm text-danger" role="alert">
          {error}{" "}
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => load(win, group, false)}>
            Try again
          </button>
        </p>
      ) : null}
      <p id={helpId} className={cn("text-xs text-ink-3", asTable && "hidden")}>
        Drag to move around, pinch or click the map and scroll to zoom, and drag a circle to pull it. With the keyboard: arrow keys pan, + and − zoom, 0 fits everything, Esc closes details.
      </p>

      {asTable && data ? (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
          {collegeFocus ? (
            <p className="border-b border-line bg-brand-50/50 px-4 py-2 text-sm text-ink-2">
              Showing {visibleRows.length} of {data.nodes.length}.{" "}
              <button type="button" className="font-medium text-brand-600 underline-offset-2 hover:underline" onClick={() => setCollegeFocus(null)}>
                Show everything
              </button>
            </p>
          ) : null}
          <NetworkTable data={data} rows={visibleRows} colors={colors} adjacency={adjacency} onShow={pickNode} />
        </div>
      ) : null}

      {data && data.nodes.length ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4 sm:px-5">
          <NetworkLegend data={data} colors={colors} collegeFocus={collegeFocus} onCollegeFocus={setCollegeFocus} />
        </div>
      ) : null}
    </div>
  );
}

function ZoomControls({ onZoom, onFit, className, small }: { onZoom: (f: number) => void; onFit: () => void; className?: string; small?: boolean }) {
  const btn = cn(
    "flex items-center justify-center bg-surface text-ink-2 hover:bg-muted hover:text-ink focus-visible:relative focus-visible:outline-2 focus-visible:outline-brand",
    small ? "h-8 w-8" : "h-9 w-9",
  );
  return (
    <div className={cn("absolute z-10 flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line shadow-sm", className)} role="group" aria-label="Zoom">
      <button type="button" className={btn} onClick={() => onZoom(1.35)} aria-label="Zoom in">
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" className={btn} onClick={() => onZoom(1 / 1.35)} aria-label="Zoom out">
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" className={btn} onClick={onFit} aria-label="Fit everything in view">
        <Expand className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function CanvasState({ loading, error, empty, onRetry }: { loading: boolean; error: string | null; empty: boolean; onRetry: () => void }) {
  if (loading)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-ink-3" role="status">
        <NetworkIcon className="h-8 w-8 animate-pulse text-brand-200" aria-hidden="true" />
        Loading the club network…
      </div>
    );
  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
        <p className="text-sm text-ink-2">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
        </Button>
      </div>
    );
  if (empty)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <BarChart3 className="h-8 w-8 text-ink-3" aria-hidden="true" />
        <p className="font-medium text-ink">No clubs on the map yet</p>
        <p className="max-w-sm text-sm text-ink-3">Clubs appear here once WSUSA approves them, and lines appear as members visit each other&rsquo;s events.</p>
      </div>
    );
  return null;
}
