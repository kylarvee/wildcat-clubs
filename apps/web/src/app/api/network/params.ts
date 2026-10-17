import { invalid } from "@/lib/domain/kit";
import { NETWORK_GROUPS, NETWORK_WINDOWS, parseNetworkGroup, parseNetworkWindow, type NetworkGroup, type NetworkWindow } from "@/lib/analytics/network-model";

/** ?window= and ?group= for the network routes: missing → defaults, unknown → a clear 400. */
export function networkParams(q: URLSearchParams): { window: NetworkWindow; group: NetworkGroup } {
  const w = q.get("window");
  const g = q.get("group");
  if (w && !NETWORK_WINDOWS.some((x) => x.key === w)) throw invalid(`Unknown window "${w}". Use ${NETWORK_WINDOWS.map((x) => x.key).join(", ")}.`);
  if (g && !NETWORK_GROUPS.some((x) => x.key === g)) throw invalid(`Unknown grouping "${g}". Use ${NETWORK_GROUPS.map((x) => x.key).join(", ")}.`);
  return { window: parseNetworkWindow(w), group: parseNetworkGroup(g) };
}

/** Everyone sees the same canvas, but "your clubs" differ per person, so responses are never shared by caches. */
export function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
