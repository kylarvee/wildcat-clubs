"use client";

import { useId, useState, type FormEvent } from "react";
import { GraduationCap, Loader2, Power, RotateCcw, UserCheck } from "lucide-react";
import type { UserKind, UserStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/form";
import { useRunAction } from "@/components/roles/useRunAction";
import { deactivateAction, markCurrentAction, markGraduatedAction, reactivateAction } from "@/app/admin/users/actions";

type Person = { id: string; name: string; kind: UserKind; status: UserStatus; roleCount: number };

/** Account status changes an admin can make. People are never deleted. */
export function AccountActions({ person, today, blockedReason }: { person: Person; today: string; blockedReason: string | null }) {
  if (blockedReason) return <p className="text-sm text-ink-3">{blockedReason}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {person.kind === "STUDENT" && person.status === "ACTIVE" ? <GraduateDialog person={person} today={today} /> : null}
      {person.status === "ALUMNI" ? <UndoGraduation person={person} /> : null}
      {person.status === "DEACTIVATED" ? <Reactivate person={person} /> : <DeactivateDialog person={person} />}
    </div>
  );
}

const rolesLine = (n: number, how: string) => (n ? `Their ${n} current role${n === 1 ? "" : "s"} end${n === 1 ? "s" : ""} (${how}) and club leaders are told the seat is open.` : "They don't hold any roles right now.");

function GraduateDialog({ person, today }: { person: Person; today: string }) {
  const [open, setOpen] = useState(false);
  const { pending, error, setError, run } = useRunAction();
  const dateId = useId();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const graduatedOn = String(new FormData(e.currentTarget).get("graduatedOn") ?? "") || null;
    void run(() => markGraduatedAction(person.id, graduatedOn), { success: `${person.name} is now an alumnus`, onSuccess: () => setOpen(false) });
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
        <Button variant="outline">
          <GraduationCap className="h-4 w-4" aria-hidden /> Mark graduated
        </Button>
      </DialogTrigger>
      <DialogContent title={`Mark ${person.name} as graduated?`} description="Their profile becomes an alumni profile. Their roles, projects and attendance history stay on it and in their clubs.">
        <form onSubmit={submit} className="space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            <li>{rolesLine(person.roleCount, "graduated")}</li>
            <li>Their memberships become alumni memberships.</li>
            <li>They can still sign in and see their history.</li>
          </ul>
          <div className="space-y-1.5">
            <label htmlFor={dateId} className="block text-sm font-medium text-ink">
              Graduation date
            </label>
            <Input id={dateId} name="graduatedOn" type="date" defaultValue={today} max={today} className="sm:w-48" />
          </div>
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
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <GraduationCap className="h-4 w-4" aria-hidden />}
              Mark graduated
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UndoGraduation({ person }: { person: Person }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
          Mark as current student
        </Button>
      }
      title={`Make ${person.name} a current student again?`}
      description="Use this if they were marked graduated by mistake, or came back. Roles and memberships that ended don't come back on their own — they can register again, and club leaders can reassign roles."
      confirmLabel="Mark as current"
      onConfirm={() => void run(() => markCurrentAction(person.id), { success: `${person.name} is a current student again`, toastError: true })}
    />
  );
}

function DeactivateDialog({ person }: { person: Person }) {
  const [open, setOpen] = useState(false);
  const { pending, error, setError, run } = useRunAction();
  const reasonId = useId();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
    void run(() => deactivateAction(person.id, reason), { success: `${person.name}'s account is deactivated`, onSuccess: () => setOpen(false) });
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
        <Button variant="outline" className="text-danger hover:bg-danger-50 hover:text-danger">
          <Power className="h-4 w-4" aria-hidden /> Deactivate account
        </Button>
      </DialogTrigger>
      <DialogContent title={`Deactivate ${person.name}'s account?`} description="Nothing is deleted, and you can reactivate the account later.">
        <form onSubmit={submit} className="space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            <li>They&rsquo;re signed out everywhere and can&rsquo;t sign in, on the web or the app.</li>
            <li>{rolesLine(person.roleCount, "removed")}</li>
            <li>They stop getting notifications and emails.</li>
          </ul>
          <div className="space-y-1.5">
            <label htmlFor={reasonId} className="block text-sm font-medium text-ink">
              Reason <span className="text-danger">*</span>
            </label>
            <Textarea id={reasonId} name="reason" rows={3} maxLength={500} required aria-invalid={error ? true : undefined} placeholder="For the record — only administrators see this." />
          </div>
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Power className="h-4 w-4" aria-hidden />}
              Deactivate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Reactivate({ person }: { person: Person }) {
  const { pending, run } = useRunAction();
  return (
    <ConfirmDialog
      trigger={
        <Button disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserCheck className="h-4 w-4" aria-hidden />}
          Reactivate account
        </Button>
      }
      title={`Reactivate ${person.name}'s account?`}
      description="They can sign in again (as alumni if they had graduated). Roles that ended when the account was deactivated don't come back on their own."
      confirmLabel="Reactivate"
      onConfirm={() => void run(() => reactivateAction(person.id), { success: `${person.name} can sign in again`, toastError: true })}
    />
  );
}
