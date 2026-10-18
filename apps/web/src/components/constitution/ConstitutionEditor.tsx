"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClubStatus, JoinPolicy, SuccessionMethod } from "@prisma/client";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, ExternalLink, Eye, FileText, Gavel, Loader2, Lock, PenLine, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Callout, EmptyState } from "@/components/ui/layout";
import { Switch, toast } from "@/components/ui/misc";

import { ClubLogo } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { DocPreview } from "@/components/constitution/DocPreview";
import {
  DOC_LABEL, draftProblems, joinPolicyOf, SECTIONS, successionOf,
  type ClubFacts, type DocKind, type DraftData, type FieldDef, type SectionDef,
} from "@/lib/constitution/templates";
import { EMPTY_FACTS, renderDoc } from "@/lib/constitution/render";
import { adoptDraftAction, saveDraftAction } from "@/app/constitution/actions";
import { JOIN_LABEL, STATUS_LABEL, SUCCESSION_LABEL } from "@/components/founding/copy";

export type EditorClub = {
  id: string;
  name: string;
  slug: string;
  status: ClubStatus;
  logoUrl: string | null;
  logoColor: string;
  joinPolicy: JoinPolicy;
  successionMethod: SuccessionMethod;
  facts: ClubFacts;
};

type SaveState = "saved" | "dirty" | "saving" | "error";

/** Constitution / Bylaws switch (toggle buttons — the two documents share one editor and preview). */
function DocToggle({ value, onChange, label }: { value: DocKind; onChange: (k: DocKind) => void; label: string }) {
  return (
    <div className="flex gap-1 border-b border-line" role="group" aria-label={label}>
      {(["constitution", "bylaws"] as const).map((k) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand",
            value === k ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink",
          )}
        >
          {DOC_LABEL[k]}
        </button>
      ))}
    </div>
  );
}

// ─── Fields ──────────────────────────────────────────────────────────────────

function FieldInput({ f, value, onChange }: { f: FieldDef; value: string; onChange: (v: string) => void }) {
  if (f.type === "choice" && f.options) {
    const cards = f.options.some((o) => o.description);
    if (cards) {
      return (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">
            {f.label}
            {f.required ? <span className="text-danger"> *</span> : null}
          </legend>
          <div className="grid gap-2">
            {f.options.map((o) => (
              <label
                key={o.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand",
                  value === o.value ? "border-brand bg-brand-50/60" : "border-line-2 hover:bg-muted/50",
                )}
              >
                <input type="radio" name={f.id} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-0.5 accent-[var(--color-brand)]" />
                <span>
                  <span className="block font-medium text-ink">{o.label}</span>
                  {o.description ? <span className="block text-ink-3">{o.description}</span> : null}
                </span>
              </label>
            ))}
          </div>
          {f.hint ? <p className="text-xs text-ink-3">{f.hint}</p> : null}
        </fieldset>
      );
    }
    return (
      <Field label={f.label} hint={f.hint} required={f.required}>
        {(id) => (
          <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
            {f.options!.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
    );
  }
  const missing = f.required && !value.trim();
  return (
    <Field label={f.label} hint={f.hint} required={f.required} error={missing ? "Required before you can adopt." : undefined}>
      {(id) =>
        f.type === "textarea" ? (
          <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={2000} placeholder={f.placeholder} aria-invalid={missing || undefined} />
        ) : f.type === "number" ? (
          <Input id={id} type="number" inputMode="numeric" min={f.min} max={f.max} value={value} onChange={(e) => onChange(e.target.value)} className="w-32" aria-invalid={missing || undefined} />
        ) : (
          <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} maxLength={200} placeholder={f.placeholder} aria-invalid={missing || undefined} />
        )
      }
    </Field>
  );
}

function SectionItem({
  s,
  on,
  open,
  data,
  onToggleOpen,
  onToggleModule,
  setField,
}: {
  s: SectionDef;
  on: boolean;
  open: boolean;
  data: DraftData;
  onToggleOpen: () => void;
  onToggleModule: (on: boolean) => void;
  setField: (id: string, v: string) => void;
}) {
  const included = s.core || on;
  const missing = included && s.fields.some((f) => f.required && !(data.fields[f.id] ?? "").trim());
  return (
    <li id={`section-${s.id}`} className={cn("scroll-mt-24 rounded-xl border bg-surface", included ? "border-line" : "border-dashed border-line-2 bg-muted/30")}>
      <div className="flex items-start gap-3 p-4">
        <button type="button" onClick={onToggleOpen} aria-expanded={open} aria-controls={`section-body-${s.id}`} className="flex min-w-0 flex-1 items-start gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-ink-3 transition-transform", open ? "" : "-rotate-90")} aria-hidden />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className={cn("font-medium", included ? "text-ink" : "text-ink-3")}>{s.title}</span>
              {missing ? (
                <Badge tone="warning">
                  <AlertTriangle className="h-3 w-3" aria-hidden /> Needs input
                </Badge>
              ) : null}
            </span>
            <span className="block text-sm text-ink-3">{s.summary}</span>
          </span>
        </button>
        {s.core ? (
          <Badge tone="neutral" title="Core sections are required and can't be removed">
            <Lock className="h-3 w-3" aria-hidden /> Required
          </Badge>
        ) : (
          <Switch checked={on} onCheckedChange={onToggleModule} aria-label={`Include ${s.title}`} />
        )}
      </div>
      {open ? (
        <div id={`section-body-${s.id}`} className="space-y-4 border-t border-line px-4 py-4">
          {!included ? (
            <p className="text-sm text-ink-3">Turn this section on to include it.</p>
          ) : s.fields.length ? (
            s.fields.map((f) => <FieldInput key={f.id} f={f} value={data.fields[f.id] ?? ""} onChange={(v) => setField(f.id, v)} />)
          ) : (
            <p className="text-sm text-ink-3">Standard wording — nothing to fill in. See it in the preview.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

export function ConstitutionEditor({
  draftId,
  initialTitle,
  initialData,
  initialSavedAt,
  clubs,
  focusClubId,
}: {
  draftId: string;
  initialTitle: string;
  initialData: DraftData;
  initialSavedAt: string;
  clubs: EditorClub[];
  focusClubId: string | null;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [data, setData] = useState<DraftData>(initialData);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify({ t: initialTitle, d: initialData }));
  const [savedAt, setSavedAt] = useState(initialSavedAt);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [tab, setTab] = useState<DocKind>("constitution");
  const [open, setOpen] = useState<Set<string>>(() => new Set(["purpose", "membership", "succession"]));
  const [highlight, setHighlight] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");
  const [pdfOpen, setPdfOpen] = useState(false);
  const [adoptOpen, setAdoptOpen] = useState(false);
  const saving = useRef<Promise<boolean> | null>(null);

  const snapshot = JSON.stringify({ t: title, d: data });
  const dirty = snapshot !== savedSnapshot;
  const facts = clubs.find((c) => c.id === data.previewClubId)?.facts ?? EMPTY_FACTS;
  const doc = useMemo(() => renderDoc(tab, data, facts), [tab, data, facts]);
  const problems = useMemo(() => draftProblems(data), [data]);

  const save = useCallback(async (opts: { silent?: boolean } = {}): Promise<boolean> => {
    if (saving.current) await saving.current;
    const snap = JSON.stringify({ t: title, d: data });
    if (snap === savedSnapshot) return true;
    if (!title.trim()) {
      setSaveState("error");
      if (!opts.silent) toast.error("Give the draft a title before saving.");
      return false;
    }
    setSaveState("saving");
    const p = (async () => {
      const r = await saveDraftAction({ draftId, title, data });
      if (!r.ok) {
        setSaveState("error");
        toast.error(r.error);
        return false;
      }
      setSavedSnapshot(snap);
      setSavedAt(r.data.savedAt);
      setSaveState("saved");
      return true;
    })();
    saving.current = p;
    const ok = await p;
    saving.current = null;
    return ok;
  }, [draftId, title, data, savedSnapshot]);

  // Autosave a moment after the last change.
  useEffect(() => {
    if (!dirty) return;
    setSaveState((s) => (s === "saving" ? s : "dirty"));
    const t = setTimeout(() => void save({ silent: true }), 1500);
    return () => clearTimeout(t);
  }, [snapshot, dirty, save]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setField = (id: string, v: string) => setData((d) => ({ ...d, fields: { ...d.fields, [id]: v } }));
  const toggleModule = (kind: DocKind, id: string, on: boolean) => {
    setData((d) => ({ ...d, modules: { ...d.modules, [kind]: on ? [...new Set([...d.modules[kind], id])] : d.modules[kind].filter((x) => x !== id) } }));
    if (on) setOpen((o) => new Set(o).add(id));
  };
  const toggleOpen = (id: string) => {
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setHighlight(id);
    document.getElementById(`preview-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const jumpTo = (kind: DocKind, sectionId: string) => {
    setTab(kind);
    setMobileView("edit");
    setOpen((o) => new Set(o).add(sectionId));
    setTimeout(() => document.getElementById(`section-${sectionId}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  };

  const status =
    saveState === "saving" ? (
      <span className="flex items-center gap-1.5 text-ink-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving…
      </span>
    ) : saveState === "error" ? (
      <span className="text-danger">Not saved</span>
    ) : dirty ? (
      <span className="text-ink-3">Unsaved changes</span>
    ) : (
      <span className="flex items-center gap-1.5 text-success">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Saved
      </span>
    );

  const sections = SECTIONS[tab];
  const onCount = sections.filter((s) => !s.core && data.modules[tab].includes(s.id)).length;
  const optional = sections.filter((s) => !s.core).length;

  return (
    <div className="space-y-4">
      <div className="sticky top-16 z-20 -mx-4 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="draft-title" className="sr-only">
              Draft title
            </label>
            <input
              id="draft-title"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 120))}
              className="w-full min-w-0 truncate rounded-md bg-transparent px-1 py-0.5 text-lg font-semibold text-ink hover:bg-muted focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            <p className="px-1 text-xs" aria-live="polite">
              {status}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {dirty ? (
              <Button variant="ghost" size="sm" onClick={() => void save()} disabled={saveState === "saving"}>
                <Save className="h-4 w-4" aria-hidden /> Save
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (await save()) setPdfOpen(true);
              }}
            >
              <FileText className="h-4 w-4" aria-hidden /> Preview PDF
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                if (await save()) setAdoptOpen(true);
              }}
            >
              <Gavel className="h-4 w-4" aria-hidden /> Adopt for club…
            </Button>
          </div>
        </div>
      </div>

      {problems.length ? (
        <Callout tone="warning" title={`${problems.length} thing${problems.length === 1 ? "" : "s"} to fill in before you can adopt`}>
          <ul className="mt-1 space-y-0.5">
            {problems.slice(0, 6).map((p) => (
              <li key={`${p.doc}-${p.sectionId}-${p.field}`}>
                <button type="button" className="text-left underline underline-offset-2 hover:no-underline" onClick={() => jumpTo(p.doc, p.sectionId)}>
                  {DOC_LABEL[p.doc]} · {p.message}
                </button>
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <div className="flex gap-1 rounded-lg bg-muted p-1 lg:hidden" role="group" aria-label="Editor view">
        {(["edit", "preview"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={mobileView === v}
            onClick={() => setMobileView(v)}
            className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", mobileView === v ? "bg-surface text-ink shadow-sm" : "text-ink-3")}
          >
            {v === "edit" ? <PenLine className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            {v === "edit" ? "Edit" : "Preview"}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={cn("min-w-0 space-y-4", mobileView === "preview" && "hidden lg:block")}>
          <DocToggle value={tab} onChange={setTab} label="Document to edit" />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-sm text-ink-3">
              {tab === "constitution" ? "Who you are and how you're organized." : "How you run day to day: duties, succession, voting."} {onCount} of {optional} optional sections on.
            </p>
            <Field label="Preview as" className="w-full sm:w-64">
              {(id) => (
                <Select id={id} value={data.previewClubId ?? ""} onChange={(e) => setData((d) => ({ ...d, previewClubId: e.target.value || null }))}>
                  <option value="">No club (placeholder name)</option>
                  {clubs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <ul className="space-y-3">
            {sections.map((s) => (
              <SectionItem
                key={s.id}
                s={s}
                on={data.modules[tab].includes(s.id)}
                open={open.has(s.id)}
                data={data}
                onToggleOpen={() => toggleOpen(s.id)}
                onToggleModule={(on) => toggleModule(tab, s.id, on)}
                setField={setField}
              />
            ))}
          </ul>
        </div>

        <div className={cn("min-w-0", mobileView === "edit" && "hidden lg:block")}>
          <Card className="lg:sticky lg:top-36">
            <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
              <p className="text-sm font-medium text-ink">Live preview · {DOC_LABEL[tab]}</p>
              <Badge tone="warning">Draft</Badge>
            </div>
            <div className="max-h-none overflow-y-auto px-5 py-6 sm:px-8 lg:max-h-[calc(100dvh-12rem)]">
              <DocPreview doc={doc} highlight={highlight} />
            </div>
          </Card>
        </div>
      </div>

      <PdfDialog open={pdfOpen} onOpenChange={setPdfOpen} draftId={draftId} clubId={data.previewClubId} version={savedAt} initialKind={tab} />
      <AdoptDialog
        open={adoptOpen}
        onOpenChange={setAdoptOpen}
        draftId={draftId}
        clubs={clubs}
        data={data}
        problemCount={problems.length}
        defaultClubId={focusClubId ?? data.previewClubId}
        beforeAdopt={save}
      />
    </div>
  );
}

// ─── PDF preview ─────────────────────────────────────────────────────────────

function PdfDialog({ open, onOpenChange, draftId, clubId, version, initialKind }: { open: boolean; onOpenChange: (o: boolean) => void; draftId: string; clubId: string | null; version: string; initialKind: DocKind }) {
  const [kind, setKind] = useState<DocKind>(initialKind);
  useEffect(() => {
    if (open) setKind(initialKind);
  }, [open, initialKind]);
  const src = `/api/constitution/${draftId}/pdf?doc=${kind}${clubId ? `&club=${clubId}` : ""}&v=${encodeURIComponent(version)}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide title="PDF preview" description="This is exactly what gets saved to your club's files when you adopt — with the adoption date and version added.">
        <DocToggle value={kind} onChange={setKind} label="Document to preview" />
        <iframe key={src} src={src} title={`${DOC_LABEL[kind]} PDF preview`} className="mt-4 h-[65dvh] w-full rounded-lg border border-line bg-muted" />
        <DialogFooter>
          <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
            Open in a new tab <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          <a href={`${src}&download=1`} className={buttonClasses("outline")}>
            <Download className="h-4 w-4" aria-hidden /> Download {DOC_LABEL[kind].toLowerCase()}
          </a>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Adopt ───────────────────────────────────────────────────────────────────

type AdoptResult = { clubId: string; name: string; slug: string; constitutionVersion: number; bylawsVersion: number };

function AdoptDialog({
  open,
  onOpenChange,
  draftId,
  clubs,
  data,
  problemCount,
  defaultClubId,
  beforeAdopt,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  draftId: string;
  clubs: EditorClub[];
  data: DraftData;
  problemCount: number;
  defaultClubId: string | null;
  beforeAdopt: () => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AdoptResult[] | null>(null);
  // Reset only when the dialog opens. After adopting, the server refresh hands us a
  // new `clubs` array; reacting to that would wipe the "Adopted" confirmation.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setSelected(new Set(defaultClubId && clubs.some((c) => c.id === defaultClubId) ? [defaultClubId] : clubs.length === 1 ? [clubs[0].id] : []));
      setError(null);
      setResults(null);
    }
    wasOpen.current = open;
  }, [open, defaultClubId, clubs]);

  const join = joinPolicyOf(data);
  const succession = successionOf(data);

  async function adopt() {
    setError(null);
    if (!selected.size) return setError("Choose at least one club.");
    setPending(true);
    try {
      if (!(await beforeAdopt())) return;
      const r = await adoptDraftAction({ draftId, clubIds: [...selected] });
      if (!r.ok) return setError(r.error);
      setResults(r.data);
      toast.success(r.data.length === 1 ? `Adopted for ${r.data[0].name}` : `Adopted for ${r.data.length} clubs`);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={results ? "Adopted" : "Adopt for your club"} description={results ? undefined : "Both documents become official for each club you choose."}>
        {results ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">The PDFs are in each club&apos;s files under “Constitution & Bylaws,” and the settings below now apply.</p>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {results.map((r) => (
                <li key={r.clubId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <span>
                    <span className="block font-medium text-ink">{r.name}</span>
                    <span className="block text-ink-3">
                      Constitution v{r.constitutionVersion} · Bylaws v{r.bylawsVersion}
                    </span>
                  </span>
                  <Link href={`/clubs/${r.slug}/manage`} className="font-medium text-brand-600 hover:underline">
                    Go to club
                  </Link>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : clubs.length === 0 ? (
          <EmptyState
            title="You don't lead a club that can adopt documents"
            description="You need the Constitution permission in a club. Founding one? Start it first, then come back to adopt."
            action={<ButtonLink href="/clubs/new">Start a club</ButtonLink>}
          />
        ) : (
          <div className="space-y-4">
            {problemCount ? (
              <Callout tone="warning">
                Fill in the {problemCount} highlighted item{problemCount === 1 ? "" : "s"} first — the documents can&apos;t have blanks.
              </Callout>
            ) : null}
            <fieldset className="space-y-2">
              <legend className="sr-only">Clubs</legend>
              {clubs.map((c) => {
                const changes = [
                  c.joinPolicy !== join ? `Joining: ${JOIN_LABEL[c.joinPolicy].split(" — ")[0]} → ${JOIN_LABEL[join].split(" — ")[0]}` : null,
                  c.successionMethod !== succession ? `Succession: ${SUCCESSION_LABEL[c.successionMethod].split(" — ")[0]} → ${SUCCESSION_LABEL[succession].split(" — ")[0]}` : null,
                ].filter(Boolean);
                return (
                  <div key={c.id} className={cn("rounded-xl border p-3", selected.has(c.id) ? "border-brand bg-brand-50/40" : "border-line")}>
                    <div className="flex items-start gap-3">
                      <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" />
                      <Checkbox
                        className="min-w-0 flex-1"
                        label={c.name}
                        description={changes.length ? changes.join(" · ") : `${STATUS_LABEL[c.status]} · settings stay the same`}
                        checked={selected.has(c.id)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const next = new Set(s);
                            if (e.target.checked) next.add(c.id);
                            else next.delete(c.id);
                            return next;
                          })
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </fieldset>
            <ul className="list-disc space-y-1 pl-5 text-xs text-ink-3">
              <li>Replaces each club&apos;s current constitution and bylaws. Earlier versions stay in its history.</li>
              <li>Withdraws any custom document still waiting for WSUSA.</li>
              <li>
                Sets joining to <span className="font-medium text-ink-2">{JOIN_LABEL[join].split(" — ")[0].toLowerCase()}</span> and the primary way leaders are chosen to{" "}
                <span className="font-medium text-ink-2">{SUCCESSION_LABEL[succession].split(" — ")[0]}</span>.
              </li>
            </ul>
            {error ? <Callout tone="danger">{error}</Callout> : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={adopt} disabled={pending || problemCount > 0 || selected.size === 0}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Gavel className="h-4 w-4" aria-hidden />}
                {pending ? "Adopting…" : selected.size > 1 ? `Adopt for ${selected.size} clubs` : "Adopt"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
