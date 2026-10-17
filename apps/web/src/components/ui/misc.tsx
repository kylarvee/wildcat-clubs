"use client";

import * as Sw from "@radix-ui/react-switch";
import * as Tt from "@radix-ui/react-tooltip";
import { Star } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Toaster as Sonner } from "sonner";
import { cn } from "@/components/ui/cn";

export { toast } from "sonner";

export function Toaster() {
  return <Sonner position="bottom-right" richColors closeButton toastOptions={{ style: { fontFamily: "var(--font-sans)" } }} />;
}

export function Switch({ className, ...props }: React.ComponentProps<typeof Sw.Root>) {
  return (
    <Sw.Root
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-line-2 transition-colors data-[state=checked]:bg-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <Sw.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </Sw.Root>
  );
}

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <Tt.Provider delayDuration={200}>
      <Tt.Root>
        <Tt.Trigger asChild>{children}</Tt.Trigger>
        <Tt.Portal>
          <Tt.Content sideOffset={6} className="z-50 max-w-xs rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white shadow-lg">
            {content}
            <Tt.Arrow className="fill-ink" />
          </Tt.Content>
        </Tt.Portal>
      </Tt.Root>
    </Tt.Provider>
  );
}

/** Read-only stars (supports halves via rounding to nearest .5). role="img" so screen readers announce the label. */
export function Stars({ value, size = 16, className }: { value: number; size?: number; className?: string }) {
  return (
    <span role="img" className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = value >= i ? 1 : value >= i - 0.5 ? 0.5 : 0;
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star className="absolute inset-0 text-line-2" style={{ width: size, height: size }} fill="currentColor" strokeWidth={0} />
            {fill > 0 ? (
              <span className="absolute inset-0 overflow-hidden" style={{ width: fill === 1 ? size : size / 2 }}>
                <Star className="text-amber-400" style={{ width: size, height: size }} fill="currentColor" strokeWidth={0} />
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** Star picker for review forms. Renders a hidden input named `name`. */
export function StarInput({ name = "rating", defaultValue = 0, onChange }: { name?: string; defaultValue?: number; onChange?: (v: number) => void }) {
  const [value, setValue] = useState(defaultValue);
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
      <input type="hidden" name={name} value={value} />
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} star${i > 1 ? "s" : ""}`}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(0)}
          onClick={() => {
            setValue(i);
            onChange?.(i);
          }}
          className="rounded p-0.5 focus-visible:outline-2 focus-visible:outline-brand"
        >
          <Star className={cn("h-7 w-7", i <= shown ? "text-amber-400" : "text-line-2")} fill="currentColor" strokeWidth={0} />
        </button>
      ))}
    </div>
  );
}
