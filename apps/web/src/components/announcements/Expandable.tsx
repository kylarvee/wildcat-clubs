"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/components/ui/cn";

/**
 * Shows `preview` with a "Read more" button that swaps in `children`. The
 * full content is rendered on the server and passed in, so expanding is instant.
 */
export function Expandable({
  preview,
  children,
  moreLabel = "Read more",
  lessLabel = "Show less",
  className,
}: {
  preview?: ReactNode;
  children: ReactNode;
  moreLabel?: string;
  lessLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      {open ? <div id={id}>{children}</div> : preview ? <div>{preview}</div> : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={cn("mt-2 inline-flex items-center gap-1 rounded text-sm font-medium text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand", open && "mt-3")}
      >
        {open ? lessLabel : moreLabel}
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
    </div>
  );
}
