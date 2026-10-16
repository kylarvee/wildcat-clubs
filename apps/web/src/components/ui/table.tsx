import type { ComponentProps } from "react";
import { cn } from "@/components/ui/cn";

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}
export const THead = (p: ComponentProps<"thead">) => <thead className={cn("bg-muted/60 text-left text-xs uppercase tracking-wide text-ink-3", p.className)} {...p} />;
export const TBody = (p: ComponentProps<"tbody">) => <tbody className={cn("divide-y divide-line", p.className)} {...p} />;
export const TR = ({ className, ...p }: ComponentProps<"tr">) => <tr className={cn("hover:bg-muted/40", className)} {...p} />;
export const TH = ({ className, ...p }: ComponentProps<"th">) => <th className={cn("whitespace-nowrap px-4 py-2.5 font-medium", className)} {...p} />;
export const TD = ({ className, ...p }: ComponentProps<"td">) => <td className={cn("px-4 py-2.5 align-middle text-ink", className)} {...p} />;
