"use client";

import { useId, useState, type FormEvent } from "react";
import { KeyRound, Loader2, ShieldMinus, ShieldPlus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { toast } from "@/components/ui/misc";
import { useRunAction } from "@/components/roles/useRunAction";
import { grantAdminAction, grantSysadminAction, revokeAdminAction, revokeSysadminAction } from "@/app/system/admins/actions";

const STAFF_DOMAIN = "@weber.edu";

/** Grant administrator access by email. The account must exist and be faculty or staff. */
export function GrantAdminForm() {
  const [email, setEmail] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const { pending, error, setError, run } = useRunAction();
  const id = useId();
  const shown = localError ?? error;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setLocalError("Enter their full email address, like jane.doe@weber.edu.");
    if (v.endsWith("@mail.weber.edu")) return setLocalError("That's a student address. Administrators need a faculty or staff (@weber.edu) account.");
    if (!v.endsWith(STAFF_DOMAIN)) return setLocalError("Administrators need a Weber State faculty or staff (@weber.edu) account.");
    setLocalError(null);
    void run(() => grantAdminAction(v), {
      onSuccess: (d) => {
        setEmail("");
        toast.success(`${d.name} is now an administrator`);
      },
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-2" aria-busy={pending}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        Faculty or staff email
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (shown) {
              setLocalError(null);
              setError(null);
            }
          }}
          placeholder="jane.doe@weber.edu"
          autoComplete="off"
          className="sm:max-w-sm"
          aria-invalid={shown ? true : undefined}
          aria-describedby={`${id}-msg`}
        />
        <Button type="submit" disabled={pending || !email.trim()}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />}
          Make administrator
        </Button>
      </div>
      <p id={`${id}-msg`} className={shown ? "text-sm text-danger" : "text-xs text-ink-3"} role={shown ? "alert" : undefined}>
        {shown ?? "They must have signed in to Wildcat Clubs once. They'll get a notification and an email."}
      </p>
    </form>
  );
}

/** What a sysadmin can do to one administrator's platform role. */
export function AdminRowActions({ person }: { person: { id: string; name: string; role: "ADMIN" | "SYSADMIN" } }) {
  const { pending, run } = useRunAction();
  const [busy, setBusy] = useState<"up" | "down" | "remove" | null>(null);
  const go = (which: "up" | "down" | "remove", fn: () => ReturnType<typeof revokeAdminAction>, success: string) => {
    setBusy(which);
    void run(fn, { success, toastError: true }).finally(() => setBusy(null));
  };
  const spinner = (which: typeof busy) => (pending && busy === which ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null);

  if (person.role === "SYSADMIN") {
    return (
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="outline" disabled={pending}>
            {spinner("down") ?? <ShieldMinus className="h-4 w-4" aria-hidden />}
            Remove system admin role
          </Button>
        }
        title={`Make ${person.name} a regular administrator?`}
        description={`${person.name} keeps every admin tool but can no longer change system settings, switch integrations or manage administrators.`}
        confirmLabel="Remove system admin role"
        onConfirm={() => go("down", () => revokeSysadminAction(person.id), `${person.name} is now an administrator`)}
      />
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="outline" disabled={pending}>
            {spinner("up") ?? <ShieldPlus className="h-4 w-4" aria-hidden />}
            Make system admin
          </Button>
        }
        title={`Make ${person.name} a system administrator?`}
        description={`System administrators can change every platform rule, switch Claude and Google integrations on or off, and add or remove administrators — including other system administrators. Only give this to people who run the platform.`}
        confirmLabel="Make system administrator"
        onConfirm={() => go("up", () => grantSysadminAction(person.id), `${person.name} is now a system administrator`)}
      >
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning-50 px-3 py-2 text-sm text-amber-900">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Only another system administrator can undo this.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-50 hover:text-danger" disabled={pending}>
            {spinner("remove") ?? <ShieldMinus className="h-4 w-4" aria-hidden />}
            Remove admin access
          </Button>
        }
        title={`Remove ${person.name}'s administrator access?`}
        description={`${person.name} loses the admin tools right away, including reports, reviews and funding. Their own account, clubs and history stay as they are.`}
        confirmLabel="Remove access"
        danger
        onConfirm={() => go("remove", () => revokeAdminAction(person.id), `${person.name} is no longer an administrator`)}
      />
    </div>
  );
}
