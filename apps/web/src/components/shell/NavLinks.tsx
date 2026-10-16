"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/components/ui/cn";

type L = { href: string; label: string };

function isActive(path: string, href: string) {
  return path === href || path.startsWith(href + "/");
}

export function NavLinks({ links }: { links: L[] }) {
  const path = usePathname();
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn("rounded-lg px-3 py-2 text-sm font-medium", isActive(path, l.href) ? "bg-brand-50 text-brand" : "text-ink-2 hover:bg-muted hover:text-ink")}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function MobileNav({ links }: { links: L[] }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  return (
    <div className="md:hidden">
      <button className="rounded-lg p-2 text-ink-2 hover:bg-muted" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open ? (
        <div className="fixed inset-x-0 top-16 z-40 border-b border-line bg-surface p-3 shadow-lg">
          <nav className="flex flex-col" aria-label="Main">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={cn("rounded-lg px-3 py-2.5 font-medium", isActive(path, l.href) ? "bg-brand-50 text-brand" : "text-ink-2 hover:bg-muted")}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
