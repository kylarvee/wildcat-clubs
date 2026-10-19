"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, RefreshCw, X } from "lucide-react";
import type { NetworkLinkDetails, NetworkNodeDetails } from "@/lib/analytics/network";
import type { NetworkPayload, NetworkViewNode } from "@/lib/analytics/network-model";
import { STANDING_LABEL, STANDING_TONE } from "@/lib/labels/clubs";
import { noRetentionText } from "@/lib/metrics/pure";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";
import { colorOf } from "./colors";
import type { Adjacency, NetworkSelection } from "./NetworkCanvas";

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);

type Details = { kind: "node"; data: NetworkNodeDetails } | { kind: "link"; data: NetworkLinkDetails };

/** Details for the selected club, group or line. A side panel on wide screens, a bottom sheet on phones. */
export function NetworkPanel({
  selection,
  data,
  colors,
  adjacency,
  onClose,
  onSelect,
  autoFocus,
}: {
  selection: Exclude<NetworkSelection, null>;
  data: NetworkPayload;
  colors: Map<string, string>;
  adjacency: Adjacency;
  onClose: () => void;
  onSelect: (s: NetworkSelection, focus?: boolean) => void;
  /** Move focus into the panel (when it was opened from the keyboard). */
  autoFocus: boolean;
}) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cache = useRef(new Map<string, Details>());
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const nodes = new Map(data.nodes.map((n) => [n.key, n]));

  const query =
    selection.type === "node"
      ? `node=${encodeURIComponent(selection.key)}`
      : `a=${encodeURIComponent(selection.a)}&b=${encodeURIComponent(selection.b)}`;
  const cacheKey = `${data.window}|${data.group}|${query}|${data.generatedAt}`;

  useEffect(() => {
    const hit = cache.current.get(cacheKey);
    if (hit) {
      setDetails(hit);
      setError(null);
      return;
    }
    setDetails(null);
    setError(null);
    const ctrl = new AbortController();
    fetch(`/api/network/details?window=${data.window}&group=${data.group}&${query}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? "We couldn't load these numbers.");
        const d: Details = selection.type === "node" ? { kind: "node", data: json.data } : { kind: "link", data: json.data };
        cache.current.set(cacheKey, d);
        setDetails(d);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : "We couldn't load these numbers.");
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, attempt]);

  useEffect(() => {
    if (autoFocus) headingRef.current?.focus();
  }, [autoFocus, cacheKey]);

  const node = selection.type === "node" ? nodes.get(selection.key) : null;
  const a = selection.type === "link" ? nodes.get(selection.a) : null;
  const b = selection.type === "link" ? nodes.get(selection.b) : null;
  if (selection.type === "node" ? !node : !a || !b) return null;

  const title = node ? node.label : `${a!.label} and ${b!.label}`;
  const subtitle = node ? node.detail : `Shared attendance ${data.windowPhrase}`;

  return (
    <aside
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className={cn(
        // Phones: a bottom sheet over the page. Wide screens: a panel inside the canvas.
        "fixed inset-x-0 bottom-0 z-40 flex max-h-[72vh] flex-col rounded-t-2xl border border-line bg-surface shadow-[0_-12px_40px_-12px_rgb(23_19_28/0.35)]",
        "lg:absolute lg:inset-x-auto lg:bottom-3 lg:right-3 lg:top-3 lg:z-20 lg:max-h-none lg:w-80 lg:rounded-2xl lg:shadow-[var(--shadow-pop)]",
      )}
    >
      <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-2 lg:hidden" aria-hidden="true" />
      <div className="flex items-start gap-3 border-b border-line px-4 pb-3 pt-3">
        {node ? (
          <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colorOf(colors, node.collegeId) }} aria-hidden="true" />
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className="font-semibold leading-snug text-ink outline-none">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 rounded-lg p-1.5 text-ink-3 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
          aria-label="Close details"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error ? (
          <div className="rounded-xl bg-danger-50 px-3 py-3 text-sm text-danger" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-2 inline-flex items-center gap-1.5 font-medium underline-offset-2 hover:underline">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
            </button>
          </div>
        ) : null}

        {node ? (
          <NodeBody node={node} details={details?.kind === "node" ? details.data : null} loading={!details && !error} data={data} nodes={nodes} adjacency={adjacency} onSelect={onSelect} />
        ) : (
          <LinkBody a={a!} b={b!} details={details?.kind === "link" ? details.data : null} loading={!details && !error} data={data} />
        )}
      </div>
    </aside>
  );
}

function StatBox({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-canvas px-3 py-2">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-ink">{value}</dd>
      {hint ? <dd className="text-[11px] leading-snug text-ink-3">{hint}</dd> : null}
    </div>
  );
}


function NodeBody({
  node,
  details,
  loading,
  data,
  nodes,
  adjacency,
  onSelect,
}: {
  node: NetworkViewNode;
  details: NetworkNodeDetails | null;
  loading: boolean;
  data: NetworkPayload;
  nodes: Map<string, NetworkViewNode>;
  adjacency: Adjacency;
  onSelect: (s: NetworkSelection, focus?: boolean) => void;
}) {
  const top = (adjacency.get(node.key) ?? []).slice(0, 5);
  const maxW = top[0]?.weight ?? 1;
  const isClub = node.kind === "club";
  const club = details?.kind === "club" ? details : null;
  const group = details?.kind === "group" ? details : null;

  return (
    <div className="space-y-5">
      {club ? (
        <Badge tone={STANDING_TONE[club.standing]}>{STANDING_LABEL[club.standing]}</Badge>
      ) : null}
      <dl className="grid grid-cols-2 gap-2">
        <StatBox label={isClub ? "Members" : "Memberships"} value={fmt(details ? details.members : node.members)} hint={isClub ? "registered" : `across ${node.clubIds.length} ${node.clubIds.length === 1 ? "club" : "clubs"}`} />
        <StatBox label="Attending members" value={loading ? <Skeleton className="mt-1 h-5 w-10" /> : details ? fmt(details.activeMembers) : "—"} hint="came to an event lately" />
        <StatBox label="Check-ins" value={fmt(node.size)} hint={data.windowPhrase} />
        {isClub ? (
          <StatBox
            label="Retention"
            value={loading ? <Skeleton className="mt-1 h-5 w-10" /> : pct(club?.retentionRate ?? null)}
            hint={loading ? undefined : (club?.retentionLabel ?? (club ? noRetentionText() : undefined))}
          />
        ) : (
          <StatBox label="Clubs" value={fmt(node.clubIds.length)} />
        )}
      </dl>

      <section aria-labelledby={`${node.key}-top`}>
        <h3 id={`${node.key}-top`} className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Most connected with
        </h3>
        {top.length ? (
          <ol className="mt-2 space-y-1">
            {top.map((t) => {
              const other = nodes.get(t.key);
              return (
                <li key={t.key}>
                  <button
                    type="button"
                    onClick={() => onSelect({ type: "link", a: node.key < t.key ? node.key : t.key, b: node.key < t.key ? t.key : node.key }, true)}
                    className="group w-full rounded-lg px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <span className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-ink group-hover:text-brand-600">{other?.label ?? "—"}</span>
                      <span className="shrink-0 tabular-nums font-semibold text-ink">{fmt(t.weight)}</span>
                    </span>
                    <span className="mt-1 block h-1 rounded-full bg-muted" aria-hidden="true">
                      <span className="block h-1 rounded-full bg-brand/70" style={{ width: `${Math.max(4, (t.weight / maxW) * 100)}%` }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-1.5 text-sm text-ink-3">No cross-club check-ins {data.windowPhrase} yet.</p>
        )}
        {top.length ? <p className="mt-1.5 text-xs text-ink-3">Cross-club check-ins. Pick one for the breakdown.</p> : null}
      </section>

      {group ? (
        <section aria-labelledby={`${node.key}-clubs`}>
          <h3 id={`${node.key}-clubs`} className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            Clubs in this {group.groupNoun}
          </h3>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {group.clubs.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <a href={c.href} className="min-w-0 truncate font-medium text-ink hover:text-brand-600 hover:underline">
                  {c.name}
                </a>
                <span className="shrink-0 text-xs tabular-nums text-ink-3">{fmt(c.checkins)} check-ins</span>
              </li>
            ))}
          </ul>
        </section>
      ) : loading && !isClub ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {node.href ? (
        <ButtonLink href={node.href} className="w-full">
          Open club page <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </ButtonLink>
      ) : null}
    </div>
  );
}

function LinkBody({ a, b, details, loading, data }: { a: NetworkViewNode; b: NetworkViewNode; details: NetworkLinkDetails | null; loading: boolean; data: NetworkPayload }) {
  const line = data.edges.find((e) => (e.source === a.key && e.target === b.key) || (e.source === b.key && e.target === a.key));
  const memberWord = data.group === "club" ? "Members of" : "Members of clubs in";
  const eventsWord = data.group === "club" ? "events" : "clubs' events";
  const rows = details
    ? [
        { label: `${memberWord} ${a.label} at ${b.label}'s ${eventsWord}`, value: details.aToB },
        { label: `${memberWord} ${b.label} at ${a.label}'s ${eventsWord}`, value: details.bToA },
        ...(details.both > 0 ? [{ label: "In both, at events they shared (counted once)", value: details.both }] : []),
      ]
    : [];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-3xl font-semibold text-ink">{fmt(line?.weight ?? details?.weight ?? 0)}</p>
        <p className="text-sm text-ink-3">cross-club check-ins {data.windowPhrase}</p>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : details ? (
        <>
          <dl className="divide-y divide-line rounded-xl border border-line">
            {rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-3 px-3 py-2.5">
                <dt className="text-sm text-ink-2">{r.label}</dt>
                <dd className="shrink-0 tabular-nums font-semibold text-ink">{fmt(r.value)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
              <dt className="text-sm text-ink-2">Events they co-hosted</dt>
              <dd className="shrink-0 tabular-nums font-semibold text-ink">{fmt(details.cohostedEvents)}</dd>
            </div>
          </dl>
          {details.pairs.length ? (
            <section aria-labelledby="link-pairs">
              <h3 id="link-pairs" className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                Strongest club links
              </h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {details.pairs.map((p) => (
                  <li key={`${p.a}|${p.b}`} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-ink-2">
                      {p.a} <span className="text-ink-3">&amp;</span> {p.b}
                    </span>
                    <span className="shrink-0 tabular-nums font-medium text-ink">{fmt(p.weight)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {a.href && b.href ? (
        <div className="grid gap-2">
          <ButtonLink href={a.href} variant="outline" className="w-full justify-between">
            <span className="truncate">{a.label}</span> <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </ButtonLink>
          <ButtonLink href={b.href} variant="outline" className="w-full justify-between">
            <span className="truncate">{b.label}</span> <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </ButtonLink>
        </div>
      ) : null}
    </div>
  );
}
