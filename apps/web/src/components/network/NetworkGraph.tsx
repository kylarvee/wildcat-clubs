"use client";

/**
 * CONTRACT (owner: network builder). The inter-club activity canvas, fed by
 * GET /api/network. Force-directed: activity → node size, cross-attendance →
 * line weight, interconnection → centrality. Group by club/college/department/
 * major. Viewer's clubs highlighted.
 * STUB.
 */
export type NetworkGraphProps = { height?: number; compact?: boolean; className?: string };

export function NetworkGraph({ height = 480, className }: NetworkGraphProps) {
  return <div className={"rounded-xl border border-dashed border-line-2 " + (className ?? "")} style={{ height }} />;
}
