import Link from "next/link";
import { Award, BadgeCheck, CalendarCheck, FolderKanban, GraduationCap, LogOut, Star, UserPlus } from "lucide-react";
import { Stars } from "@/components/ui/misc";
import { fmtAgo, fmtLongDate } from "@/lib/time";
import type { ActivityItem, ActivityKind } from "@/lib/profiles/activity";

const ICON: Record<ActivityKind, typeof Star> = {
  joined: UserPlus,
  role: BadgeCheck,
  roleEnded: LogOut,
  election: Award,
  review: Star,
  checkin: CalendarCheck,
  project: FolderKanban,
  graduated: GraduationCap,
};

function when(at: Date, now: Date) {
  return now.getTime() - at.getTime() < 30 * 86_400_000 ? fmtAgo(at) : fmtLongDate(at);
}

/** A person's public activity as a short, linked timeline. */
export function ActivityList({ items, now }: { items: ActivityItem[]; now: Date }) {
  return (
    <ol className="space-y-4">
      {items.map((item) => {
        const Icon = ICON[item.kind];
        return (
          <li key={item.id} className="flex gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">
                {item.parts.map((p, i) =>
                  typeof p === "string" ? (
                    <span key={i}>{p}</span>
                  ) : (
                    <Link key={i} href={p.href} className="font-medium text-ink hover:text-brand-600 hover:underline">
                      {p.label}
                    </Link>
                  ),
                )}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                <time dateTime={item.at.toISOString()}>{when(item.at, now)}</time>
                {item.rating ? <Stars value={item.rating} size={12} /> : null}
                {item.note ? <span>· {item.note}</span> : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
