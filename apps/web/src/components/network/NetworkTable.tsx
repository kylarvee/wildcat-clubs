"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import type { NetworkPayload, NetworkViewNode } from "@/lib/analytics/network-model";
import { colorOf } from "./colors";
import type { Adjacency } from "./NetworkCanvas";

const fmt = (n: number) => n.toLocaleString("en-US");

/** The canvas as a table: every club (or group), busiest first, with its strongest connections. */
export function NetworkTable({
  data,
  rows,
  colors,
  adjacency,
  onShow,
}: {
  data: NetworkPayload;
  /** Nodes to list (already filtered by the college spotlight, if any). */
  rows: NetworkViewNode[];
  colors: Map<string, string>;
  adjacency: Adjacency;
  onShow: (key: string) => void;
}) {
  const label = new Map(data.nodes.map((n) => [n.key, n.label]));
  const grouped = data.group !== "club";
  const sorted = [...rows].sort((a, b) => b.size - a.size || a.label.localeCompare(b.label));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">
          {grouped ? "Groups" : "Clubs"} by check-ins {data.windowPhrase}, with the {grouped ? "groups" : "clubs"} they share the most attendance with
        </caption>
        <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-ink-3">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              {grouped ? "Group" : "Club"}
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              {grouped ? "Memberships" : "Members"}
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Check-ins
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Strongest connections <span className="normal-case tracking-normal">(cross-club check-ins)</span>
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              <span className="sr-only">Map</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((n) => {
            const top = (adjacency.get(n.key) ?? []).slice(0, 3);
            return (
              <tr key={n.key} className="align-top hover:bg-muted/40">
                <th scope="row" className="px-4 py-2.5 text-left font-normal">
                  <span className="flex items-start gap-2">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(colors, n.collegeId) }} aria-hidden="true" />
                    <span className="min-w-0">
                      {n.href ? (
                        <Link href={n.href} className="font-medium text-ink hover:text-brand-600 hover:underline">
                          {n.label}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink">{n.label}</span>
                      )}
                      <span className="block text-xs text-ink-3">{n.detail}</span>
                    </span>
                  </span>
                </th>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">{fmt(n.members)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">{fmt(n.size)}</td>
                <td className="px-4 py-2.5 text-ink-2">
                  {top.length ? (
                    <ul className="space-y-0.5">
                      {top.map((t) => (
                        <li key={t.key}>
                          {label.get(t.key) ?? "—"} <span className="tabular-nums text-ink-3">· {fmt(t.weight)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-ink-3">None yet</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => onShow(n.key)}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Show on map<span className="sr-only">: {n.label}</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
