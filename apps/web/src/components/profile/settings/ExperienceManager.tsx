"use client";

import { useState } from "react";
import { Briefcase, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { Callout, EmptyState } from "@/components/ui/layout";
import { useRunAction } from "@/components/roles/useRunAction";
import { MonthYearInput, isCompleteMonth } from "@/components/profile/settings/MonthYearInput";
import { addExperienceAction, deleteExperienceAction, updateExperienceAction, type ExperienceForm } from "@/app/settings/actions";
import { fmtExperienceRange, toMonthInput } from "@/lib/profiles/format";

export type ExperienceRow = {
  id: string;
  title: string;
  organization: string;
  location: string | null;
  startDate: Date;
  endDate: Date | null;
  description: string | null;
  source: "MANUAL" | "LINKEDIN_IMPORT";
};

const EMPTY: ExperienceForm = { title: "", organization: "", location: "", startDate: "", endDate: "", description: "" };

/** Jobs, internships and volunteering you add yourself (club roles come from org charts). */
export function ExperienceManager({ rows }: { rows: ExperienceRow[] }) {
  const [editing, setEditing] = useState<ExperienceRow | "new" | null>(null);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Your experience</h2>
          <p className="mt-1 text-sm text-ink-3">Jobs, internships, research and volunteering. Newest first on your profile.</p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" aria-hidden /> Add experience
        </Button>
      </div>
      {rows.length ? (
        <ul className="mt-5 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-3 py-4 first:pt-0 last:pb-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-ink-3">
                <Briefcase className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{r.title}</p>
                <p className="text-sm text-ink-2">
                  {r.organization}
                  {r.location ? <span className="text-ink-3"> · {r.location}</span> : null}
                </p>
                <p className="text-sm text-ink-3">{fmtExperienceRange(r.startDate, r.endDate)}</p>
                {r.source === "LINKEDIN_IMPORT" ? (
                  <Badge tone="info" className="mt-1.5">
                    Imported from LinkedIn
                  </Badge>
                ) : null}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`Edit ${r.title} at ${r.organization}`}>
                  <Pencil className="h-4 w-4" aria-hidden /> Edit
                </Button>
                <DeleteExperience row={r} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          className="mt-5"
          icon={<Briefcase />}
          title="No experience added yet"
          description="Add a job, internship or volunteer role — or import your positions from LinkedIn below."
        />
      )}
      {editing ? <ExperienceDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function DeleteExperience({ row }: { row: ExperienceRow }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon" aria-label={`Delete ${row.title} at ${row.organization}`} disabled={pending} className="text-ink-3 hover:text-danger">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      }
      title={`Delete “${row.title}”?`}
      description="It comes off your profile. You can add it again any time."
      confirmLabel="Delete"
      danger
      onConfirm={() => {
        void run(() => deleteExperienceAction(row.id), { success: "Experience deleted.", toastError: true });
      }}
    />
  );
}

function ExperienceDialog({ row, onClose }: { row: ExperienceRow | null; onClose: () => void }) {
  const [form, setForm] = useState<ExperienceForm>(
    row
      ? { title: row.title, organization: row.organization, location: row.location ?? "", startDate: toMonthInput(row.startDate), endDate: toMonthInput(row.endDate), description: row.description ?? "" }
      : EMPTY,
  );
  const [current, setCurrent] = useState(row ? !row.endDate : false);
  const { pending, error, setError, run } = useRunAction();
  const set = <K extends keyof ExperienceForm>(k: K, v: ExperienceForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!isCompleteMonth(form.startDate)) return setError("Pick the month and year you started.");
    if (!current && form.endDate && !isCompleteMonth(form.endDate)) return setError("Pick both the month and year you finished, or tick “I still work here”.");
    if (!current && !form.endDate) return setError("Pick when you finished, or tick “I still work here”.");
    const input = { ...form, endDate: current ? "" : form.endDate };
    const r = await run(() => (row ? updateExperienceAction(row.id, input) : addExperienceAction(input)), { success: row ? "Experience updated." : "Experience added." });
    if (r.ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent title={row ? "Edit experience" : "Add experience"} description="Shows under Experience on your profile.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Title" required>
            {(id) => <Input id={id} value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={200} required autoFocus placeholder="e.g. Peer Tutor" />}
          </Field>
          <Field label="Company or organization" required>
            {(id) => <Input id={id} value={form.organization} onChange={(e) => set("organization", e.target.value)} maxLength={200} required placeholder="e.g. Weber State Writing Center" />}
          </Field>
          <Field label="Location" hint="Optional, e.g. Ogden, Utah or Remote">
            {(id) => <Input id={id} value={form.location} onChange={(e) => set("location", e.target.value)} maxLength={200} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <MonthYearInput legend="Start" required value={form.startDate} onChange={(v) => set("startDate", v)} />
            <MonthYearInput legend="End" value={current ? "" : form.endDate} onChange={(v) => set("endDate", v)} disabled={current} />
          </div>
          <Checkbox label="I still work here" checked={current} onChange={(e) => setCurrent(e.target.checked)} />
          <Field label="Description" hint="Optional. What you did and what you learned.">
            {(id) => <Textarea id={id} value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} rows={4} />}
          </Field>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {row ? "Save changes" : "Add experience"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
