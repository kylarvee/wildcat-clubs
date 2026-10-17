import Link from "next/link";
import { cn } from "@/components/ui/cn";

export type BarItem = { key: string; label: string; value: number; hint?: string; href?: string };

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * A ranked list with a bar behind each value — one hue, values printed, so
 * nothing depends on reading the bar. Bars share one scale (the largest
 * value, or `max`) so lists side by side compare honestly.
 */
export function BarList({ items, max, label, className }: { items: BarItem[]; max?: number; label: string; className?: string }) {
  const top = Math.max(1, max ?? Math.max(0, ...items.map((i) => i.value)));
  return (
    <ul className={cn("space-y-2.5", className)} aria-label={label}>
      {items.map((item) => {
        const width = item.value > 0 ? Math.max(2, (item.value / top) * 100) : 0;
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className={cn("min-w-0 truncate", item.href ? "font-medium text-ink group-hover:text-brand-600 group-hover:underline" : "text-ink")}>{item.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-ink">{fmt(item.value)}</span>
            </span>
            <span className="mt-1 block h-1.5 rounded-full bg-muted" aria-hidden="true">
              {width ? <span className="block h-1.5 rounded-full bg-brand/80" style={{ width: `${width}%` }} /> : null}
            </span>
            {item.hint ? <span className="mt-1 block text-xs text-ink-3">{item.hint}</span> : null}
          </>
        );
        return (
          <li key={item.key}>
            {item.href ? (
              <Link href={item.href} className="group -mx-2 block rounded-lg px-2 py-1 focus-visible:outline-2 focus-visible:outline-brand">
                {body}
              </Link>
            ) : (
              <div className="py-1">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
