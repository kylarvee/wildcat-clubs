"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/components/ui/cn";

/**
 * An announcement body held to a few lines, fading out, with "Show more" to
 * open it in place. The button appears only when the body really overflows
 * (measured, so short posts never get one). The full body is server-rendered
 * and passed in, so expanding is instant.
 */
export function ClampedBody({ lines = 3, children, className }: { lines?: number; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const id = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      if (!openRef.current) setOverflows(el.scrollHeight > el.clientHeight + 2);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clamped = !open;
  return (
    <div className={className}>
      <div
        id={id}
        ref={ref}
        className={cn(clamped && "overflow-hidden", clamped && overflows && "[mask-image:linear-gradient(to_bottom,#000_55%,transparent)]")}
        // prose-wc sets line-height 1.65, so this is `lines` lines of body text.
        style={clamped ? { maxHeight: `${lines * 1.65}em` } : undefined}
      >
        {children}
      </div>
      {overflows || open ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          className="mt-1.5 inline-flex min-h-9 items-center gap-1 rounded text-sm font-medium text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {open ? "Show less" : "Show more"}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
