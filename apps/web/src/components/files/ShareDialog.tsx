"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Loader2, Search, Star, UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { Switch, toast } from "@/components/ui/misc";
import { VisIcon } from "@/components/files/FileVisuals";
import { VIS_ORDER, visCopy } from "@/lib/files/visibility";
import type { PersonOption, SharingInfo, VisSetting } from "@/lib/files/types";
import { grantAccessAction, revokeAccessAction, searchPeopleAction, setFeaturedAction, setVisibilityAction, sharingInfoAction } from "@/components/files/actions";

/**
 * "Share & permissions…": who can open an item (inherit / public / members /
 * leaders), whether it shows on the club page, and people added by name with
 * view or edit access. Every change saves right away.
 */
export function ShareDialog({ itemId, open, onOpenChange, onChanged, copyLink }: { itemId: string | null; open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void; copyLink: (id: string) => void }) {
  const [info, setInfo] = useState<SharingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const radioName = useId();

  useEffect(() => {
    if (!open || !itemId) return;
    let live = true;
    setInfo(null);
    setError(null);
    sharingInfoAction(itemId)
      .then((r) => {
        if (!live) return;
        if (r.ok) setInfo(r.data);
        else setError(r.error);
      })
      .catch(() => live && setError("We couldn't reach the server. Check your connection and try again."));
    return () => {
      live = false;
    };
  }, [open, itemId]);

  async function run<T>(key: string, fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, apply: (data: T) => void, success?: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (r.ok) {
        apply(r.data);
        if (success) toast.success(success);
        onChanged();
      } else toast.error(r.error);
    } catch {
      toast.error("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const kind = info?.scopeKind ?? "club";
  const options: { value: VisSetting; label: string; description: string }[] = info
    ? [
        {
          value: "INHERIT",
          label: info.inheritedFrom ? `Same as “${info.inheritedFrom}”` : "Use the default",
          description: `${visCopy(kind, info.inherited).short}. Changes if it moves or the folder's setting changes.`,
        },
        ...VIS_ORDER.map((v) => ({ value: v as VisSetting, label: visCopy(kind, v).label, description: visCopy(kind, v).description })),
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={info ? `Share “${info.name}”` : "Share & permissions"} description={info?.isFolder ? "Settings on a folder apply to everything inside that's set to “Same as folder”." : undefined}>
        {error ? (
          <Callout tone="danger">{error}</Callout>
        ) : !info ? (
          <div className="flex items-center gap-2 py-8 text-sm text-ink-3" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading sharing settings…
          </div>
        ) : (
          <div className="space-y-6">
            <fieldset>
              <legend className="text-sm font-semibold text-ink">Who can open it</legend>
              <div className="mt-2 space-y-1.5">
                {options.map((o) => {
                  const checked = info.visibility === o.value;
                  const shown = o.value === "INHERIT" ? info.inherited : o.value;
                  return (
                    <label
                      key={o.value}
                      className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors", checked ? "border-brand-200 bg-brand-50/60" : "border-line hover:bg-muted/60")}
                    >
                      <input
                        type="radio"
                        name={radioName}
                        value={o.value}
                        checked={checked}
                        disabled={busy !== null}
                        onChange={() =>
                          run(
                            "vis",
                            () => setVisibilityAction(info.id, o.value),
                            () => setInfo({ ...info, visibility: o.value, effective: o.value === "INHERIT" ? info.inherited : o.value }),
                            "Sharing updated",
                          )
                        }
                        className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                      />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="flex items-center gap-1.5 font-medium text-ink">
                          <VisIcon vis={shown} kind={kind} inherited={o.value === "INHERIT"} />
                          {o.label}
                        </span>
                        <span className="block text-ink-3">{o.description}</span>
                      </span>
                      {busy === "vis" && checked ? <Loader2 className="mt-1 h-4 w-4 animate-spin text-ink-3" aria-hidden /> : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {info.canFeature ? (
              <div className="flex items-start justify-between gap-4 rounded-lg border border-line px-3 py-3">
                <span className="text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-ink">
                    <Star className="h-4 w-4 text-amber-500" aria-hidden /> Show on the club page
                  </span>
                  <span className="block text-ink-3">
                    Lists it under Resources.{" "}
                    {info.effective === "PUBLIC" ? "Everyone who visits will see it." : `Only people who can open it (${visCopy(kind, info.effective).short.toLowerCase()}) will see it there.`}
                  </span>
                </span>
                <Switch
                  checked={info.featured}
                  disabled={busy !== null}
                  aria-label="Show on the club page"
                  onCheckedChange={(on) =>
                    run("feature", () => setFeaturedAction(info.id, on), () => setInfo({ ...info, featured: on }), on ? "Now on the club page" : "Removed from the club page")
                  }
                />
              </div>
            ) : null}

            <PeopleSection info={info} busy={busy} setInfo={setInfo} run={run} />
          </div>
        )}
        <DialogFooter className="justify-between">
          {info && !info.isFolder ? (
            <Button variant="outline" onClick={() => copyLink(info.id)}>
              <Copy className="h-4 w-4" aria-hidden /> Copy link
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Run = <T>(key: string, fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, apply: (data: T) => void, success?: string) => Promise<void>;

function PeopleSection({ info, busy, setInfo, run }: { info: SharingInfo; busy: string | null; setInfo: (i: SharingInfo) => void; run: Run }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PersonOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const inputId = useId();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchPeopleAction(info.id, term)
        .then((r) => {
          if (!live) return;
          setResults(r.ok ? r.data : []);
          setActive(0);
          if (!r.ok) toast.error(r.error);
        })
        .catch(() => live && setResults([]))
        .finally(() => live && setSearching(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, info.id]);

  function add(p: PersonOption) {
    void run(
      `add:${p.id}`,
      () => grantAccessAction(info.id, p.id, canEdit),
      () => {
        const rest = info.grants.filter((g) => g.userId !== p.id);
        setInfo({ ...info, grants: [...rest, { userId: p.id, name: p.name, email: p.email, avatarUrl: p.avatarUrl, avatarColor: p.avatarColor, canEdit }].sort((a, b) => a.name.localeCompare(b.name)) });
        setQ("");
        setResults(null);
        inputRef.current?.focus();
      },
      `Shared with ${p.name}`,
    );
  }

  const already = new Set(info.grants.map((g) => g.userId));

  return (
    <section aria-labelledby={`${inputId}-h`} className="space-y-3">
      <div>
        <h3 id={`${inputId}-h`} className="text-sm font-semibold text-ink">
          People with access
        </h3>
        <p className="text-sm text-ink-3">Add someone by name to let them in no matter the setting above{info.isFolder ? " — they get everything inside, too" : ""}.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={inputId} className="sr-only">
            Find a person by name or email
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            ref={inputRef}
            id={inputId}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name or @weber.edu email"
            className="pl-9"
            role="combobox"
            aria-expanded={Boolean(results?.length)}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results?.length ? `${listId}-${active}` : undefined}
            autoComplete="off"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (!results?.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const p = results[active];
                if (p) add(p);
              }
            }}
          />
          {searching ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-3" aria-hidden /> : null}
        </div>
        <Select value={canEdit ? "edit" : "view"} onChange={(e) => setCanEdit(e.target.value === "edit")} className="sm:w-36" aria-label="Access for the person you add">
          <option value="view">Can view</option>
          <option value="edit">Can edit</option>
        </Select>
      </div>
      {results ? (
        results.length ? (
          <ul id={listId} role="listbox" aria-label="Matching people" className="max-h-56 overflow-y-auto rounded-lg border border-line">
            {results.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => add(p)}
                className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm", i === active ? "bg-muted" : "")}
              >
                <Avatar name={p.name} src={p.avatarUrl} color={p.avatarColor} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {p.email}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                </span>
                {already.has(p.id) ? <span className="text-xs text-ink-3">Has access</span> : <UserPlus className="h-4 w-4 text-ink-3" aria-hidden />}
                {busy === `add:${p.id}` ? <Loader2 className="h-4 w-4 animate-spin text-ink-3" aria-hidden /> : null}
              </li>
            ))}
          </ul>
        ) : !searching ? (
          <p className="text-sm text-ink-3" role="status">
            Nobody matches “{q.trim()}”. Try a first or last name, or their full email.
          </p>
        ) : null
      ) : null}

      {info.grants.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {info.grants.map((g) => (
            <li key={g.userId} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <Avatar name={g.name} src={g.avatarUrl} color={g.avatarColor} size="sm" />
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate font-medium text-ink">{g.name}</span>
                <span className="block truncate text-xs text-ink-3">{g.email}</span>
              </span>
              <Select
                value={g.canEdit ? "edit" : "view"}
                disabled={busy !== null}
                className="h-8 w-32 text-xs"
                aria-label={`Access for ${g.name}`}
                onChange={(e) => {
                  const edit = e.target.value === "edit";
                  void run(
                    `role:${g.userId}`,
                    () => grantAccessAction(info.id, g.userId, edit),
                    () => setInfo({ ...info, grants: info.grants.map((x) => (x.userId === g.userId ? { ...x, canEdit: edit } : x)) }),
                    `${g.name} can now ${edit ? "edit" : "view"} it`,
                  );
                }}
              >
                <option value="view">Can view</option>
                <option value="edit">Can edit</option>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Remove ${g.name}`}
                disabled={busy !== null}
                onClick={() =>
                  run(`rm:${g.userId}`, () => revokeAccessAction(info.id, g.userId), () => setInfo({ ...info, grants: info.grants.filter((x) => x.userId !== g.userId) }), `Removed ${g.name}`)
                }
              >
                {busy === `rm:${g.userId}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <Check className="h-4 w-4" aria-hidden /> Nobody has been added by name yet.
        </p>
      )}
    </section>
  );
}
