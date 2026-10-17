import { Search } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

/** A plain GET search box that keeps the page's other filters. Works without JavaScript. */
export function SearchForm({ action, q, keep = {}, label, placeholder }: { action: string; q: string; keep?: Record<string, string | null | undefined>; label: string; placeholder?: string }) {
  return (
    <form action={action} method="get" role="search" className="flex w-full min-w-0 gap-2 sm:w-auto">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="sr-only" htmlFor={`search-${action}`}>
        {label}
      </label>
      <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          id={`search-${action}`}
          type="search"
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          maxLength={100}
          className="h-9 w-full rounded-lg border border-line-2 bg-surface pl-9 pr-3 text-sm text-ink shadow-sm placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </div>
      <button type="submit" className={buttonClasses("outline", "sm", "h-9")}>
        Search
      </button>
    </form>
  );
}
