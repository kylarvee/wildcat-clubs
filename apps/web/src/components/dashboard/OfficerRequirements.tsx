import Link from "next/link";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import type { ClubLeaderCompliance } from "@/lib/domain/requirements";
import { fmtDate } from "@/lib/time";
import { Panel } from "@/components/dashboard/Panel";

const officers = (n: number) => `${n} officer${n === 1 ? "" : "s"}`;

/**
 * Advisors: where the student leaders of each club they advise stand on
 * WSUSA's requirements (clubLeaderCompliance — the same rule that pauses
 * permissions). Each club links to its org chart, where the detail lives.
 */
export function OfficerRequirements({ clubs }: { clubs: ClubLeaderCompliance[] }) {
  return (
    <Panel id="dash-officers" title="WSUSA requirements" icon={<ShieldCheck />}>
      <ul className="space-y-3">
        {clubs.map((c) => (
          <li key={c.club.id}>
            <Link href={`/clubs/${c.club.slug}/manage/org-chart`} className="font-semibold text-ink hover:text-brand-600 hover:underline">
              {c.club.name}
            </Link>
            {c.leaders === 0 ? (
              <p className="mt-0.5 text-[13px] text-ink-3">No student leaders yet.</p>
            ) : c.paused ? (
              <p className="mt-0.5 text-[13px] font-medium text-danger">
                {officers(c.paused)} {c.paused === 1 ? "has" : "have"} permissions paused until an overdue requirement is done.
              </p>
            ) : c.due ? (
              <p className="mt-0.5 text-[13px] font-medium text-warning">
                {officers(c.due.people)} still {c.due.people === 1 ? "needs" : "need"} {c.due.name} · due {fmtDate(c.due.dueAt, "MMM d")}
              </p>
            ) : (
              <p className="mt-0.5 flex items-center gap-1 text-[13px] text-success">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> All {officers(c.leaders)} are up to date.
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
