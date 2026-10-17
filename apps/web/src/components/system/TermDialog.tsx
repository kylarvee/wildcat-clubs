"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import type { TermKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/misc";
import { useRunAction } from "@/components/roles/useRunAction";
import { deleteTermAction, saveTermAction } from "@/app/system/terms/actions";

/** A term as the forms see it: dates are campus-calendar days ("2026-08-31"). */
export type TermRow = { id: string; name: string; kind: TermKind; academicYear: string; startsOn: string; endsOn: string; countsForActivity: boolean };

export const TERM_KIND_LABEL: Record<TermKind, string> = { FALL: "Fall", SPRING: "Spring", SUMMER: "Summer" };

type Draft = Omit<TermRow, "id">;
const EMPTY: Draft = { name: "", kind: "FALL", academicYear: "", startsOn: "", endsOn: "", countsForActivity: true };

/** "2027-2028" for a first day in Aug 2027 or Jan 2028 (academic years start July 1). */
function academicYearFor(day: string) {
  const [y, m] = day.split("-").map(Number);
  if (!y || !m) return "";
  return m >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

function problems(d: Draft, others: TermRow[]): Partial<Record<keyof Draft, string>> {
  const e: Partial<Record<keyof Draft, string>> = {};
  if (d.name.trim().length < 3) e.name = "Enter the term name, like “Fall 2027”.";
  else if (others.some((t) => t.name.toLowerCase() === d.name.trim().toLowerCase())) e.name = "Another term already has this name.";
  const ay = d.academicYear.trim();
  if (!/^\d{4}-\d{4}$/.test(ay)) e.academicYear = "Write it like 2027-2028.";
  else if (Number(ay.slice(5)) !== Number(ay.slice(0, 4)) + 1) e.academicYear = "The second year must follow the first, like 2027-2028.";
  if (!d.startsOn) e.startsOn = "Pick the first day.";
  if (!d.endsOn) e.endsOn = "Pick the last day.";
  else if (d.startsOn && d.endsOn <= d.startsOn) e.endsOn = "The last day must come after the first day.";
  if (!e.startsOn && !e.endsOn) {
    // ISO day strings compare correctly as text.
    const clash = others.find((t) => t.startsOn <= d.endsOn && d.startsOn <= t.endsOn);
    if (clash) e.endsOn = `These dates overlap ${clash.name}. Terms can't overlap.`;
  }
  return e;
}

/**
 * Add or edit a term. Pass `term` to edit. Either give it a trigger (the
 * default buttons) or control it with open/onOpenChange (the timeline does).
 */
export function TermDialog({ term, others, open: controlledOpen, onOpenChange, trigger }: { term: TermRow | null; others: TermRow[]; open?: boolean; onOpenChange?: (o: boolean) => void; trigger?: ReactNode }) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const [draft, setDraft] = useState<Draft>(term ?? EMPTY);
  const [touchedCounts, setTouchedCounts] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const { pending, error, setError, run } = useRunAction();

  function setOpen(o: boolean) {
    if (o) {
      setDraft(term ?? EMPTY);
      setErrors({});
      setTouchedCounts(false);
      setError(null);
    }
    (onOpenChange ?? setOwnOpen)(o);
  }
  function set<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => {
      const next = { ...d, [k]: v };
      // Helpful fill-ins for a new term; never overwrite what someone typed.
      if (!term) {
        if (k === "kind" && !touchedCounts) next.countsForActivity = v !== "SUMMER";
        if (k === "startsOn" && typeof v === "string" && v) {
          if (!d.academicYear) next.academicYear = academicYearFor(v);
          if (!d.name) next.name = `${TERM_KIND_LABEL[next.kind]} ${v.slice(0, 4)}`;
        }
      }
      return next;
    });
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = problems(draft, others);
    setErrors(p);
    if (Object.values(p).some(Boolean)) return;
    void run(() => saveTermAction(term?.id ?? null, { ...draft, name: draft.name.trim(), academicYear: draft.academicYear.trim() }), {
      success: term ? `${draft.name.trim()} saved` : `${draft.name.trim()} added`,
      onSuccess: () => setOpen(false),
    });
  }

  const weeks = draft.startsOn && draft.endsOn && draft.endsOn > draft.startsOn ? Math.round((Date.parse(draft.endsOn) - Date.parse(draft.startsOn)) / (7 * 86_400_000)) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined ? (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button size="sm">
              <Plus className="h-4 w-4" aria-hidden /> Add term
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent title={term ? `Edit ${term.name}` : "Add a term"} description="Dates are campus days. A term runs from the start of its first day to the end of its last.">
        <form onSubmit={submit} noValidate className="space-y-4" aria-busy={pending}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kind" required>
              {(id) => (
                <Select id={id} value={draft.kind} onChange={(e) => set("kind", e.target.value as TermKind)}>
                  {(Object.keys(TERM_KIND_LABEL) as TermKind[]).map((k) => (
                    <option key={k} value={k}>
                      {TERM_KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Name" required error={errors.name}>
              {(id) => <Input id={id} value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={40} placeholder="Fall 2027" aria-invalid={errors.name ? true : undefined} />}
            </Field>
            <Field label="First day" required error={errors.startsOn}>
              {(id) => <Input id={id} type="date" value={draft.startsOn} onChange={(e) => set("startsOn", e.target.value)} aria-invalid={errors.startsOn ? true : undefined} />}
            </Field>
            <Field label="Last day" required error={errors.endsOn} hint={weeks ? `About ${weeks} week${weeks === 1 ? "" : "s"}, finals included.` : "Include finals week."}>
              {(id) => <Input id={id} type="date" value={draft.endsOn} min={draft.startsOn || undefined} onChange={(e) => set("endsOn", e.target.value)} aria-invalid={errors.endsOn ? true : undefined} />}
            </Field>
            <Field label="Academic year" required error={errors.academicYear} hint="Fall through summer, like 2027-2028.">
              {(id) => <Input id={id} value={draft.academicYear} onChange={(e) => set("academicYear", e.target.value)} maxLength={9} placeholder="2027-2028" inputMode="numeric" aria-invalid={errors.academicYear ? true : undefined} />}
            </Field>
          </div>
          <Checkbox
            checked={draft.countsForActivity}
            onChange={(e) => {
              setTouchedCounts(true);
              set("countsForActivity", e.target.checked);
            }}
            label="Counts for activity"
            description="Clubs need their minimum held events within a counting term, and pilot periods end at the end of one. Summer usually doesn't count."
          />
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {term ? "Save term" : "Add term"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditTermButton({ term, others }: { term: TermRow; others: TermRow[] }) {
  return (
    <TermDialog
      term={term}
      others={others}
      trigger={
        <Button size="sm" variant="ghost" aria-label={`Edit ${term.name}`}>
          <Pencil className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Edit</span>
        </Button>
      }
    />
  );
}

/** Delete a term nothing points to; otherwise explain why it has to stay. */
export function DeleteTermButton({ id, name, inUse }: { id: string; name: string; inUse: string | null }) {
  const { pending, run } = useRunAction();
  if (inUse) {
    return (
      <Tooltip content={`This term has ${inUse}, so it can't be deleted. Edit its dates instead.`}>
        <span tabIndex={0} className="inline-flex rounded-lg focus-visible:outline-2 focus-visible:outline-brand" aria-label={`${name} can't be deleted: it has ${inUse}`}>
          <Button size="sm" variant="ghost" disabled aria-hidden tabIndex={-1}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </span>
      </Tooltip>
    );
  }
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-50 hover:text-danger" disabled={pending} aria-label={`Delete ${name}`}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
        </Button>
      }
      title={`Delete ${name}?`}
      description="Activity, pilot periods, retention and semester-long recurring events are measured against the calendar, so they'll be recomputed without this term. This can't be undone."
      confirmLabel="Delete term"
      danger
      onConfirm={() => void run(() => deleteTermAction(id), { success: `${name} deleted`, toastError: true })}
    />
  );
}
