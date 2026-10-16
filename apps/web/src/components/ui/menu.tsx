"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import * as CM from "@radix-ui/react-context-menu";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

const panel = "z-50 min-w-[12rem] overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]";
const item =
  "relative flex cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export function DropdownMenuContent({ className, align = "end", ...props }: ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content align={align} sideOffset={6} className={cn(panel, className)} {...props} />
    </DM.Portal>
  );
}
export function DropdownMenuItem({ className, danger, ...props }: ComponentProps<typeof DM.Item> & { danger?: boolean }) {
  return <DM.Item className={cn(item, danger && "text-danger data-[highlighted]:bg-danger-50", className)} {...props} />;
}
export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("px-2.5 py-1.5 text-xs font-medium text-ink-3", className)} {...props} />;
}
export const DropdownMenuSeparator = () => <DM.Separator className="my-1 h-px bg-line" />;

export const ContextMenu = CM.Root;
export const ContextMenuTrigger = CM.Trigger;
export function ContextMenuContent({ className, ...props }: ComponentProps<typeof CM.Content>) {
  return (
    <CM.Portal>
      <CM.Content className={cn(panel, className)} {...props} />
    </CM.Portal>
  );
}
export function ContextMenuItem({ className, danger, shortcut, children, ...props }: ComponentProps<typeof CM.Item> & { danger?: boolean; shortcut?: ReactNode }) {
  return (
    <CM.Item className={cn(item, danger && "text-danger data-[highlighted]:bg-danger-50", className)} {...props}>
      {children}
      {shortcut ? <span className="ml-auto pl-4 text-xs text-ink-3">{shortcut}</span> : null}
    </CM.Item>
  );
}
export const ContextMenuSeparator = () => <CM.Separator className="my-1 h-px bg-line" />;
export const ContextMenuSub = CM.Sub;
export function ContextMenuSubTrigger({ className, ...props }: ComponentProps<typeof CM.SubTrigger>) {
  return <CM.SubTrigger className={cn(item, className)} {...props} />;
}
export function ContextMenuSubContent({ className, ...props }: ComponentProps<typeof CM.SubContent>) {
  return (
    <CM.Portal>
      <CM.SubContent className={cn(panel, className)} {...props} />
    </CM.Portal>
  );
}
