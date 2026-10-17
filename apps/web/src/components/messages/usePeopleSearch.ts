"use client";

import { useEffect, useState } from "react";
import type { PersonResult } from "@/lib/domain/messaging";

export type PeopleSearchState = { status: "idle" | "loading" | "done" | "error"; results: PersonResult[]; error: string | null; term: string };

const IDLE: PeopleSearchState = { status: "idle", results: [], error: null, term: "" };

/**
 * Searches GET /api/messages/people as you type (debounced, cancels stale
 * requests). The server applies the messaging rules, so every result can
 * actually be messaged (scope "dm") or added to a leader group ("leaders").
 */
export function usePeopleSearch(query: string, scope: "dm" | "leaders", conversationId?: string | null): PeopleSearchState {
  const [state, setState] = useState<PeopleSearchState>(IDLE);
  const term = query.trim().replace(/\s+/g, " ");

  useEffect(() => {
    if (term.length < 2) {
      setState(IDLE);
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: "loading", error: null, term }));
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: term, scope });
        if (conversationId) params.set("conversationId", conversationId);
        const res = await fetch(`/api/messages/people?${params}`, { signal: ctrl.signal, cache: "no-store" });
        const json = (await res.json()) as { ok: boolean; data?: { people: PersonResult[] }; error?: string };
        if (ctrl.signal.aborted) return;
        if (json.ok && json.data) setState({ status: "done", results: json.data.people, error: null, term });
        else setState({ status: "error", results: [], error: json.error ?? "Search didn't work. Please try again.", term });
      } catch (e) {
        if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setState({ status: "error", results: [], error: "We couldn't reach the server. Check your connection and try again.", term });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [term, scope, conversationId]);

  return state;
}
