"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Search, UserPlus } from "lucide-react";
import type { searchCheckinCandidates } from "@/lib/domain/attendance";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/misc";
import { addManualAction, searchCandidatesAction } from "@/components/attendance/actions";

type Candidate = Awaited<ReturnType<typeof searchCheckinCandidates>>[number];

/**
 * Add someone who was there but couldn't scan. Searches the club's members
 * first, then any Weber State account by name or email.
 */
export function ManualAdd({ occurrenceId, autoFocus, onAdded }: { occurrenceId: string; autoFocus?: boolean; onAdded?: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const latest = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    const id = ++latest.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const res = await searchCandidatesAction(occurrenceId, term);
      if (id !== latest.current) return; // a newer search is on its way
      setSearching(false);
      if (res.ok) {
        setResults(res.data);
        setError(null);
      } else setError(res.error);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, occurrenceId]);

  const add = (c: Candidate) => {
    setAddingId(c.id);
    startTransition(async () => {
      const res = await addManualAction(occurrenceId, c.id);
      setAddingId(null);
      if (res.ok) {
        toast.success(`${res.data.name} is checked in`);
        setResults((list) => list?.map((x) => (x.id === c.id ? { ...x, alreadyIn: true } : x)) ?? null);
        if (onAdded) onAdded();
        else router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <div>
      <label htmlFor="manual-add-search" className="block text-sm font-medium text-ink">
        Find a person
      </label>
      <div className="relative mt-1.5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          id="manual-add-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or @mail.weber.edu email"
          autoComplete="off"
          autoFocus={autoFocus}
          aria-describedby="manual-add-hint"
          className="h-10 w-full rounded-lg border border-line-2 bg-surface pl-9 pr-9 text-sm text-ink shadow-sm placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        {searching ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-3" aria-label="Searching" /> : null}
      </div>
      <p id="manual-add-hint" className="mt-1.5 text-xs text-ink-3">
        Members show first. Anyone with a Weber State account can be added.
      </p>
      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div aria-live="polite">
        {results && results.length === 0 && !searching ? <p className="mt-3 text-sm text-ink-3">Nobody matches “{q.trim()}”. Try part of their name or email.</p> : null}
        {results && results.length ? (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
            {results.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar name={c.name} src={c.avatarUrl} color={c.avatarColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-ink">
                    <span className="truncate">{c.name}</span>
                    {c.isMember ? <Badge tone="brand">Member</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-ink-3">{c.email}</p>
                </div>
                {c.alreadyIn ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                    <Check className="h-3.5 w-3.5" aria-hidden /> Checked in
                  </span>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => add(c)} disabled={addingId !== null} aria-label={`Add ${c.name}`}>
                    {addingId === c.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />}
                    Add
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
