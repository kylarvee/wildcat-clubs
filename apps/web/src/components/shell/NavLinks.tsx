"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
      {links.map((l) => {
        const active = isActive(path, l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn("rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-brand-50 text-brand" : "text-ink-2 hover:bg-muted hover:text-ink")}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav({ links }: { links: L[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  // The header persists across pages, so any navigation (the logo, a header icon,
  // back/forward) must close the menu. Adjusting state while rendering (React's
  // "storing information from previous renders" pattern) does it without an effect.
  const [shownOn, setShownOn] = useState(path);
  if (shownOn !== path) {
    setShownOn(path);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={toggle}
        className="rounded-lg p-2 text-ink-2 hover:bg-muted"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open ? (
        <>
          {/* Tapping outside the panel closes it. An explicit height, not bottom-0: the
              header's backdrop-blur makes it the containing block for fixed children. */}
          <div className="fixed inset-x-0 top-16 z-30 h-dvh" aria-hidden="true" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-0 top-16 z-40 border-b border-line bg-surface p-3 shadow-lg">
            <nav className="flex flex-col" aria-label="Main">
              {links.map((l) => {
                const active = isActive(path, l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn("rounded-lg px-3 py-2.5 font-medium", active ? "bg-brand-50 text-brand" : "text-ink-2 hover:bg-muted")}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </>
      ) : null}
    </div>
  );
}
