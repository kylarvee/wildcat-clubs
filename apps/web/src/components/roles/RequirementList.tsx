import { BookOpenCheck, CalendarCheck } from "lucide-react";

export type RequirementLike = { id: string; name: string; description: string | null; kind: "TEST" | "TRAINING"; graceDays: number };

/** What a role asks of whoever takes it: officer tests and trainings with their grace period. */
export function RequirementList({ requirements, roleLabel }: { requirements: RequirementLike[]; roleLabel: string }) {
  if (requirements.length === 0) {
    return <p className="text-sm text-ink-3">WSUSA doesn&apos;t require any tests or trainings for the {roleLabel} role right now.</p>;
  }
  return (
    <ul className="space-y-2">
      {requirements.map((r) => {
        const Icon = r.kind === "TEST" ? BookOpenCheck : CalendarCheck;
        return (
          <li key={r.id} className="flex gap-3 rounded-lg border border-line bg-surface px-3 py-2">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-ink">
                {r.kind === "TEST" ? "Pass" : "Attend"}: {r.name}
              </p>
              {r.description ? <p className="text-ink-3">{r.description}</p> : null}
              <p className={r.graceDays === 0 ? "text-danger" : "text-ink-2"}>
                {r.graceDays === 0
                  ? "Required before their permissions turn on."
                  : `Due within ${r.graceDays} day${r.graceDays === 1 ? "" : "s"} of starting — permissions pause if it's late.`}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
