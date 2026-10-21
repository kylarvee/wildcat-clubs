import type { ClubRole } from "@prisma/client";
import type { ComplianceRow, ComplianceState } from "@/lib/domain/requirements";

/** Compliance filters, read from the URL so the page, its links and the CSV all agree. */
export type ComplianceFilter = { club: string; state: "" | ComplianceState | "paused"; req: string; role: "" | ClubRole; q: string };

const STATES = ["met", "due", "review", "overdue", "paused"] as const;
const ROLES = ["AMBASSADOR", "OFFICER", "VP", "PRESIDENT"] as const;

export function parseFilter(sp: Record<string, string | string[] | undefined>): ComplianceFilter {
  const one = (k: string) => {
    const v = sp[k];
    return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
  };
  const state = one("state");
  const role = one("role");
  return {
    club: one("club"),
    state: (STATES as readonly string[]).includes(state) ? (state as ComplianceFilter["state"]) : "",
    req: one("req"),
    role: (ROLES as readonly string[]).includes(role) ? (role as ClubRole) : "",
    q: one("q").slice(0, 80),
  };
}

export function filterQuery(f: ComplianceFilter): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function applyFilter(rows: ComplianceRow[], f: ComplianceFilter): ComplianceRow[] {
  const q = f.q.toLowerCase();
  return rows.filter((r) => {
    if (f.club && r.club.id !== f.club) return false;
    if (f.role && r.role !== f.role) return false;
    if (q && !r.person.name.toLowerCase().includes(q) && !r.person.email.toLowerCase().includes(q)) return false;
    const cells = f.req ? (r.cells[f.req] ? [r.cells[f.req]] : []) : Object.values(r.cells);
    if (f.req && cells.length === 0) return false;
    if (f.state === "paused") return r.paused || Boolean(r.pausedCapabilities?.length);
    if (f.state === "met") return cells.length > 0 && cells.every((c) => c.state === "met");
    if (f.state) return cells.some((c) => c.state === f.state);
    return true;
  });
}
