"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Select } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";

/**
 * Semester picker for budget pages. Navigates to `${basePath}?term=<id>` (plus
 * any `keep` params), so every term has its own shareable URL.
 */
export function TermSelect({
  terms,
  value,
  currentId,
  basePath,
  keep,
  label = "Semester",
  className,
}: {
  terms: { id: string; name: string }[];
  value: string;
  currentId?: string | null;
  basePath: string;
  keep?: Record<string, string | undefined>;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <label htmlFor="budget-term" className="text-sm font-medium text-ink-2">
        {label}
      </label>
      <Select
        id="budget-term"
        value={value}
        className="w-auto min-w-40"
        disabled={pending}
        onChange={(e) => {
          const qs = new URLSearchParams();
          for (const [k, v] of Object.entries(keep ?? {})) if (v) qs.set(k, v);
          qs.set("term", e.target.value);
          start(() => router.push(`${basePath}?${qs.toString()}`, { scroll: false }));
        }}
      >
        {terms.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.id === currentId ? " (current)" : ""}
          </option>
        ))}
      </Select>
      {pending ? <Loader2 className="h-4 w-4 animate-spin text-ink-3" aria-label="Loading semester" /> : null}
    </div>
  );
}
