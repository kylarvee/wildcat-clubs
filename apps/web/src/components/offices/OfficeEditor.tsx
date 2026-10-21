"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Pencil, Trash2, UserPlus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { useRunAction } from "@/components/roles/useRunAction";
import { addOfficeStaffAction, removeOfficeStaffAction, updateOfficeAction } from "@/app/admin/offices/actions";

export type EditableOffice = {
  id: string;
  name: string;
  shortName: string;
  umbrella: boolean;
  decidesFunding: boolean;
  location: string | null;
  hours: string | null;
  email: string | null;
  phone: string | null;
  reviewDays: number;
};

/** Edit an office's name, contacts, review time and funding (lib/domain/offices updateOffice). Saving unchanged details confirms them. */
export function OfficeDetailsDialog({ office }: { office: EditableOffice }) {
  const [open, setOpen] = useState(false);
  const { pending, error, setError, run } = useRunAction();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "");
    void run(
      () =>
        updateOfficeAction({
          officeId: office.id,
          name: text("name"),
          shortName: text("shortName"),
          location: text("location"),
          hours: text("hours"),
          email: text("email"),
          phone: text("phone"),
          reviewDays: text("reviewDays"),
          decidesFunding: office.umbrella ? true : f.get("decidesFunding") === "on",
        }),
      { success: `Saved ${text("name") || office.name}`, onSuccess: () => setOpen(false) },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil className="h-4 w-4" aria-hidden /> Edit details
        </Button>
      </DialogTrigger>
      <DialogContent title={`Edit ${office.name}`} description="Students see the name and contacts on the pages of the clubs this office oversees." wide>
        <form onSubmit={submit} noValidate className="space-y-4" aria-busy={pending}>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="Name" required>
              {(id) => <Input id={id} name="name" defaultValue={office.name} maxLength={100} required autoComplete="off" />}
            </Field>
            <Field label="Short name" required hint="For tight spots, like the queue filter.">
              {(id) => <Input id={id} name="shortName" defaultValue={office.shortName} maxLength={30} required autoComplete="off" />}
            </Field>
          </div>
          <Field label="Location" hint="Building and room, like “Wildcat Center, Room 101”.">
            {(id) => <Input id={id} name="location" defaultValue={office.location ?? ""} maxLength={200} autoComplete="off" />}
          </Field>
          <Field label="Hours">{(id) => <Input id={id} name="hours" defaultValue={office.hours ?? ""} maxLength={300} autoComplete="off" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" hint="A shared office address, not a person's.">
              {(id) => <Input id={id} name="email" type="email" inputMode="email" defaultValue={office.email ?? ""} maxLength={200} autoComplete="off" />}
            </Field>
            <Field label="Phone">{(id) => <Input id={id} name="phone" type="tel" defaultValue={office.phone ?? ""} maxLength={40} autoComplete="off" />}</Field>
          </div>
          <Field label="Review time" required hint="How many days a review usually takes. Founders see it, and funding requests count business days against it.">
            {(id) => (
              <div className="flex items-center gap-2">
                <Input id={id} name="reviewDays" type="number" inputMode="numeric" min={1} max={60} defaultValue={office.reviewDays} required className="w-24" />
                <span className="text-sm text-ink-2">days</span>
              </div>
            )}
          </Field>
          {office.umbrella ? (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-ink-2">{office.name} decides every funding request no other office decides, so it always decides funding.</p>
          ) : (
            <Checkbox
              name="decidesFunding"
              defaultChecked={office.decidesFunding}
              label="Decides its clubs' funding"
              description="On: its staff decide funding requests and process invoices for its clubs. Off: those go to WSUSA. Open requests move when you change it."
            />
          )}
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type StaffRow = { userId: string; name: string; email: string; avatarUrl: string | null; avatarColor: string; addedAt: string };

/** An office's staff: add a faculty or staff member by email, or take someone off (lib/domain/offices). */
export function OfficeStaff({ officeId, officeName, staff }: { officeId: string; officeName: string; staff: StaffRow[] }) {
  const { pending, error, setError, run } = useRunAction();
  const [email, setEmail] = useState("");

  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void run(() => addOfficeStaffAction({ officeId, email }), {
      success: `Added to ${officeName}'s staff`,
      onSuccess: () => setEmail(""),
    });
  }

  return (
    <div className="space-y-3">
      {staff.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {staff.map((s) => (
            <li key={s.userId} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar name={s.name} src={s.avatarUrl} color={s.avatarColor} size="sm" />
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-medium text-ink">{s.name}</span>
                <a href={`mailto:${s.email}`} className="block truncate text-ink-3 hover:text-brand-600">
                  {s.email}
                </a>
              </span>
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="ghost" aria-label={`Take ${s.name} off ${officeName}'s staff`} disabled={pending}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                    <span className="hidden sm:inline">Remove</span>
                  </Button>
                }
                title={`Take ${s.name} off ${officeName}'s staff?`}
                description={`They lose the admin console for ${officeName}'s clubs. If nobody's left on the staff, the office's work goes to WSUSA's administrators.`}
                confirmLabel="Remove"
                danger
                onConfirm={() => void run(() => removeOfficeStaffAction({ officeId, userId: s.userId }), { success: `${s.name} is off ${officeName}'s staff`, toastError: true })}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line-2 px-3 py-3 text-sm text-ink-2">No staff yet. Until someone's added, {officeName}'s queue goes to WSUSA's administrators, so nothing waits unseen.</p>
      )}
      <form onSubmit={add} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-end" aria-busy={pending}>
        <Field label="Add a staff member" hint="Their faculty or staff (@weber.edu) email. They need to have signed in once." className="min-w-0 flex-1">
          {(id) => (
            <Input
              id={id}
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="jane.doe@weber.edu"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="outline" disabled={pending || !email.trim()}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />} Add
        </Button>
      </form>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
