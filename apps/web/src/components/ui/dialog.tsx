"use client";

import * as D from "@radix-ui/react-dialog";
import * as A from "@radix-ui/react-alert-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { buttonClasses } from "@/components/ui/button";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  wide,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-pop)] focus:outline-none",
          wide ? "max-w-3xl" : "max-w-lg",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <D.Title className="text-lg font-semibold text-ink">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-ink-3">{description}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
          </div>
          <D.Close className="rounded-md p-1 text-ink-3 hover:bg-muted hover:text-ink" aria-label="Close">
            <X className="h-5 w-5" />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mt-6 flex flex-wrap items-center justify-end gap-2", className)}>{children}</div>;
}

/**
 * "Are you sure?" dialog. Controlled: pass open/onOpenChange, or a trigger.
 */
export function ConfirmDialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  children,
}: {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  children?: ReactNode;
}) {
  return (
    <A.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <A.Trigger asChild>{trigger}</A.Trigger> : null}
      <A.Portal>
        <A.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px]" />
        <A.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-pop)]">
          <A.Title className="text-lg font-semibold text-ink">{title}</A.Title>
          {description ? <A.Description className="mt-2 text-sm text-ink-2">{description}</A.Description> : <A.Description className="sr-only">{String(title)}</A.Description>}
          {children}
          <div className="mt-6 flex justify-end gap-2">
            <A.Cancel className={buttonClasses("outline")}>{cancelLabel}</A.Cancel>
            <A.Action className={buttonClasses(danger ? "danger" : "primary")} onClick={() => void onConfirm()}>
              {confirmLabel}
            </A.Action>
          </div>
        </A.Content>
      </A.Portal>
    </A.Root>
  );
}
