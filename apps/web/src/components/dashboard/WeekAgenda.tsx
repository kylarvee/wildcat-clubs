import Link from "next/link";
import { CalendarDays, CalendarClock } from "lucide-react";
import { fmtDate } from "@/lib/time";
import { Panel } from "@/components/dashboard/Panel";
import { agendaDayLabel, dayKey } from "@/components/dashboard/format";
import type { AgendaItem } from "@/app/dashboard/data";

/**
 * "Coming up": the next two weeks of your calendar, grouped by day, with the
 * clubs you lead marked. The Events page has the rest, so this stays a
 * short list. Admins see university events and requirement deadlines for
 * the same two weeks.
 */
export function WeekAgenda({ items, now, admin = false }: { items: AgendaItem[]; now: Date; admin?: boolean }) {
  const days: { key: string; label: string; items: AgendaItem[] }[] = [];
  for (const it of items) {
    const key = dayKey(it.at);
    const day = days.find((d) => d.key === key);
    if (day) day.items.push(it);
    else days.push({ key, label: agendaDayLabel(it.at, now), items: [it] });
  }
  return (
    <Panel id="dash-week" title="Coming up" icon={<CalendarDays />} link={{ href: "/events", label: "Events" }}>
      {days.length ? (
        <div className="space-y-4">
          {days.map((d) => (
            <section key={d.key} aria-label={d.label}>
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-3">{d.label}</h3>
              <ul className="space-y-2.5">
                {d.items.map((it) => (
                  <li key={it.key} className="flex gap-2.5">
                    {it.kind === "deadline" ? (
                      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                    ) : (
                      <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: it.color }} aria-hidden />
                    )}
                    <div className="min-w-0">
                      <Link href={it.href} className="block font-semibold leading-snug text-ink hover:text-brand-600 hover:underline">
                        {it.title}
                      </Link>
                      <p className="mt-0.5 text-[13px] text-ink-3">
                        {it.allDay ? (it.kind === "deadline" ? "" : "All day · ") : `${fmtDate(it.at, "h:mm a")} · `}
                        {it.detail}
                      </p>
                      {it.leading ? <span className="mt-1 inline-block rounded-full bg-brand px-2 text-[11px] font-semibold leading-5 text-white">You lead</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-3">{admin ? "No university events or requirement deadlines in the next two weeks." : "Nothing on your calendar in the next two weeks. Follow a club and its events show up here."}</p>
      )}
    </Panel>
  );
}
