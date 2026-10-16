"use client";

import * as T from "@radix-ui/react-tabs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { cn } from "@/components/ui/cn";

export const Tabs = T.Root;
export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return <T.List className={cn("flex gap-1 overflow-x-auto border-b border-line", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-ink-3 hover:text-ink data-[state=active]:border-brand data-[state=active]:text-brand",
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = T.Content;

/** Route-based tabs: each tab is a link; the active one matches the current path. */
export function LinkTabs({ tabs, className }: { tabs: { href: string; label: string; exact?: boolean; count?: number }[]; className?: string }) {
  const path = usePathname();
  return (
    <nav className={cn("flex gap-1 overflow-x-auto border-b border-line", className)}>
      {tabs.map((t) => {
        const active = t.exact ? path === t.href : path === t.href || path.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              active ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {t.label}
            {t.count ? <span className="rounded-full bg-brand-50 px-1.5 text-xs text-brand">{t.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
