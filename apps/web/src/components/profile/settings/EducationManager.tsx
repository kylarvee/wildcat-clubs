"use client";

import { useState } from "react";
import { GraduationCap, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Callout, EmptyState } from "@/components/ui/layout";
import { useRunAction } from "@/components/roles/useRunAction";
import { addEducationAction, deleteEducationAction, updateEducationAction, type EducationForm } from "@/app/settings/actions";
import { fmtYearSpan } from "@/lib/profiles/format";

export type EducationRow = { id: string; school: string; degree: string | null; field: string | null; startYear: number | null; endYear: number | null; description: string | null };

const EMPTY: EducationForm = { school: "", degree: "", field: "", startYear: "", endYear: "", description: "" };

/** Schools besides your Weber State majors (high school, transfer schools, other degrees). */
export function EducationManager({ rows }: { rows: EducationRow[] }) {
  const [editing, setEditing] = useState<EducationRow | "new" | null>(null);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Other education</h2>
          <p className="mt-1 text-sm text-ink-3">High school, transfer schools, certificates and other degrees.</p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" aria-hidden /> Add education
        </Button>
      </div>
      {rows.length ? (
        <ul className="mt-5 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-3 py-4 first:pt-0 last:pb-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-ink-3">
                <GraduationCap className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{r.school}</p>
                {r.degree || r.field ? <p className="text-sm text-ink-2">{[r.degree, r.field].filter(Boolean).join(", ")}</p> : null}
                {fmtYearSpan(r.startYear, r.endYear) ? <p className="text-sm text-ink-3">{fmtYearSpan(r.startYear, r.endYear)}</p> : null}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`Edit ${r.school}`}>
                  <Pencil className="h-4 w-4" aria-hidden /> Edit
                </Button>
                <DeleteEducation row={r} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState className="mt-5" icon={<GraduationCap />} title="Nothing here yet" description="Add your high school or another college if you'd like it on your profile." />
      )}
      {editing ? <EducationDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function DeleteEducation({ row }: { row: EducationRow }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon" aria-label={`Delete ${row.school}`} disabled={pending} className="text-ink-3 hover:text-danger">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      }
      title={`Delete ${row.school}?`}
      description="It comes off your profile."
      confirmLabel="Delete"
      danger
      onConfirm={() => {
        void run(() => deleteEducationAction(row.id), { success: "Education deleted.", toastError: true });
      }}
    />
  );
}

function EducationDialog({ row, onClose }: { row: EducationRow | null; onClose: () => void }) {
  const [form, setForm] = useState<EducationForm>(
    row
      ? { school: row.school, degree: row.degree ?? "", field: row.field ?? "", startYear: row.startYear ? String(row.startYear) : "", endYear: row.endYear ? String(row.endYear) : "", description: row.description ?? "" }
      : EMPTY,
  );
  const { pending, error, run } = useRunAction();
  const set = <K extends keyof EducationForm>(k: K, v: EducationForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    const r = await run(() => (row ? updateEducationAction(row.id, form) : addEducationAction(form)), { success: row ? "Education updated." : "Education added." });
    if (r.ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent title={row ? "Edit education" : "Add education"} description="Shows under Education on your profile, after Weber State.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="School" required>
            {(id) => <Input id={id} value={form.school} onChange={(e) => set("school", e.target.value)} maxLength={200} required autoFocus placeholder="e.g. Bonneville High School" />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Degree" hint="Optional, e.g. High School Diploma">
              {(id) => <Input id={id} value={form.degree} onChange={(e) => set("degree", e.target.value)} maxLength={120} />}
            </Field>
            <Field label="Field of study" hint="Optional">
              {(id) => <Input id={id} value={form.field} onChange={(e) => set("field", e.target.value)} maxLength={120} />}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start year">
              {(id) => <Input id={id} type="number" inputMode="numeric" min={1950} max={2100} value={form.startYear} onChange={(e) => set("startYear", e.target.value)} />}
            </Field>
            <Field label="End year" hint="Or expected">
              {(id) => <Input id={id} type="number" inputMode="numeric" min={1950} max={2100} value={form.endYear} onChange={(e) => set("endYear", e.target.value)} />}
            </Field>
          </div>
          <Field label="Description" hint="Optional. Activities, honors, concurrent enrollment…">
            {(id) => <Textarea id={id} value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} rows={3} />}
          </Field>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {row ? "Save changes" : "Add education"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
