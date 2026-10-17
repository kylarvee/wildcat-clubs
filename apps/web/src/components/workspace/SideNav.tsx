"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

/** Generic left nav for admin and system areas. */
export function SideNav({ links, label }: { links: { href: string; label: string; exact?: boolean }[]; label: string }) {
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
            className={cn("shrink-0 rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-brand-50 text-brand" : "text-ink-2 hover:bg-muted hover:text-ink")}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
