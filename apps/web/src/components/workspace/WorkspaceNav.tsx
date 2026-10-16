"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, CalendarDays, ClipboardCheck, FileText, FolderOpen, Gavel, Home, Megaphone, Network, Palette, Settings, Users, Vote, Wallet, BadgeCheck,
} from "lucide-react";
import { cn } from "@/components/ui/cn";

const ICONS = {
  overview: Home, profile: Palette, members: Users, "org-chart": Network, events: CalendarDays, attendance: ClipboardCheck, budget: Wallet,
  files: FolderOpen, announcements: Megaphone, elections: Vote, tests: BadgeCheck, constitution: Gavel, settings: Settings, ambassadors: BarChart3, history: FileText,
} as const;

export type WorkspaceLink = { key: keyof typeof ICONS; label: string; href: string; locked?: boolean };

export function WorkspaceNav({ links }: { links: WorkspaceLink[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Club tools" className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
      {links.map((l) => {
        const Icon = ICONS[l.key];
        const active = l.key === "overview" ? path === l.href : path === l.href || path.startsWith(l.href + "/");
        return (
          <Link
            key={l.key}
            href={l.href}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium",
              active ? "bg-brand-50 text-brand" : "text-ink-2 hover:bg-muted hover:text-ink",
              l.locked && "opacity-55",
            )}
          >
            <Icon className="h-4 w-4" />
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
