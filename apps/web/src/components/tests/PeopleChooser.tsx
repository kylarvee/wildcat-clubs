"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search, UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/form";
import { searchTestPeopleAction } from "@/components/tests/actions";
import type { TestPersonOption } from "@/lib/domain/tests";

/**
 * Pick several people for a test ("People I choose"). Searches club members
 * (club tests) or every active Weber State account (university tests) on the
 * server, so it works the same with ten people or ten thousand.
 */
export function PeopleChooser({
  clubId,
  selected,
  onChange,
}: {
  clubId: string | null;
  selected: TestPersonOption[];
  onChange: (people: TestPersonOption[]) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TestPersonOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchId = useId();
  const listId = useId();
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await searchTestPeopleAction(clubId, term).catch(() => null);
      if (mine !== seq.current) return;
      setLoading(false);
      if (!r) return setError("We couldn't search right now. Check your connection and try again.");
      if (!r.ok) return setError(r.error);
      setError(null);
      setResults(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q, clubId]);

  const chosen = new Set(selected.map((p) => p.id));
  const add = (p: TestPersonOption) => {
    if (!chosen.has(p.id)) onChange([...selected, p].sort((a, b) => a.name.localeCompare(b.name)));
  };
  const remove = (id: string) => onChange(selected.filter((p) => p.id !== id));

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={searchId} className="block text-sm font-medium text-ink">
          Add people
        </label>
        <div className="relative mt-1.5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            id={searchId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={clubId ? "Search members by name or email" : "Search by name or Weber State email"}
            className="pl-9"
            autoComplete="off"
            aria-controls={listId}
          />
          {loading ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-3" aria-hidden /> : null}
        </div>
        {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      </div>

      {q.trim().length >= 2 && !loading && !error ? (
        <ul id={listId} className="max-h-60 divide-y divide-line overflow-y-auto rounded-xl border border-line" aria-label="Search results">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-ink-3">{clubId ? "No active members match." : "No active accounts match."}</li>
          ) : (
            results.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                <Avatar name={p.name} src={p.avatarUrl} color={p.avatarColor} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-xs text-ink-3">{p.email}</span>
                </span>
                {chosen.has(p.id) ? (
                  <span className="text-xs text-ink-3">Added</span>
                ) : (
                  <button type="button" onClick={() => add(p)} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-brand-600 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand">
                    <UserPlus className="h-4 w-4" aria-hidden /> Add<span className="sr-only"> {p.name}</span>
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      ) : null}

      <div>
        <p className="text-sm font-medium text-ink">
          {selected.length ? `${selected.length} ${selected.length === 1 ? "person" : "people"} chosen` : "Nobody chosen yet"}
        </p>
        {selected.length ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {selected.map((p) => (
              <li key={p.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-muted/60 py-0.5 pl-1 pr-1 text-sm">
                <Avatar name={p.name} src={p.avatarUrl} color={p.avatarColor} size="xs" />
                <span className="truncate">{p.name}</span>
                {p.detail === "Account not active" ? <span className="text-xs text-warning">(inactive)</span> : null}
                <button type="button" onClick={() => remove(p.id)} className="rounded-full p-0.5 text-ink-3 hover:bg-line hover:text-ink focus-visible:outline-2 focus-visible:outline-brand" aria-label={`Remove ${p.name}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-ink-3">Search above to add the people who should take this test.</p>
        )}
      </div>
    </div>
  );
}
