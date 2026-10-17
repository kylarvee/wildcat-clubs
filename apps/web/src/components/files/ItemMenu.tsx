"use client";

import { Check, type LucideIcon } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/menu";
import { cn } from "@/components/ui/cn";

/**
 * One list of actions, rendered into the explorer's right-click menu. The
 * row "⋯" buttons and Shift+F10 open the same menu, so mouse, touch
 * (long-press) and keyboard users all get identical choices.
 */
export type MenuEntry =
  | {
      kind: "item";
      key: string;
      label: string;
      icon?: LucideIcon;
      onSelect: () => void;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      /** A toggle (rendered as a checkable item). */
      checked?: boolean;
    }
  | { kind: "separator"; key: string }
  | { kind: "label"; key: string; label: string };

export function MenuEntries({ entries }: { entries: MenuEntry[] }) {
  // Drop separators at the edges or next to each other (some actions are conditional).
  const tidy = entries.filter((e, i, all) => {
    if (e.kind !== "separator") return true;
    const prev = all.slice(0, i).reverse().find((x) => x.kind !== "label");
    const next = all.slice(i + 1).find(() => true);
    return Boolean(prev && prev.kind !== "separator" && next && next.kind !== "separator");
  });
  return (
    <>
      {tidy.map((e) => {
        if (e.kind === "separator") return <ContextMenuSeparator key={e.key} />;
        if (e.kind === "label")
          return (
            <p key={e.key} className="truncate px-2.5 pb-1 pt-1.5 text-xs font-medium text-ink-3" title={e.label}>
              {e.label}
            </p>
          );
        const Icon = e.icon;
        const toggle = e.checked !== undefined;
        return (
          <ContextMenuItem
            key={e.key}
            danger={e.danger}
            disabled={e.disabled}
            shortcut={e.shortcut}
            onSelect={e.onSelect}
            role={toggle ? "menuitemcheckbox" : undefined}
            aria-checked={toggle ? e.checked : undefined}
          >
            {toggle ? (
              <Check className={cn("h-4 w-4", e.checked ? "opacity-100" : "opacity-0")} aria-hidden />
            ) : Icon ? (
              <Icon className="h-4 w-4 text-ink-3" aria-hidden />
            ) : (
              <span className="h-4 w-4" aria-hidden />
            )}
            {e.label}
          </ContextMenuItem>
        );
      })}
    </>
  );
}

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "⌘A" on a Mac, "Ctrl+A" elsewhere. */
export function modKey(key: string) {
  return IS_MAC ? `⌘${key}` : `Ctrl+${key}`;
}
