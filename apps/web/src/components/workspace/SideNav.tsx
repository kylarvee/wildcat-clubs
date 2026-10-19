"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

/** Generic left nav for admin and system areas. A link's `count` (what's waiting there) shows as a badge when it's above zero. */
export function SideNav({ links, label }: { links: { href: string; label: string; exact?: boolean; count?: number }[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
      {links.map((l) => {
        const active = l.exact ? path === l.href : path === l.href || path.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn("flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-brand-50 text-brand" : "text-ink-2 hover:bg-muted hover:text-ink")}
          >
            {l.label}
            {l.count ? (
              <span className="ml-auto rounded-full bg-warning-50 px-1.5 text-xs font-semibold tabular-nums text-warning">
                {l.count}
                <span className="sr-only"> waiting</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
