"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClubRole, RenewalPeriod, RequirementKind } from "@prisma/client";
import { AlertCircle, Loader2, Save } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Switch, toast } from "@/components/ui/misc";
import { NumberInput } from "@/components/tests/NumberInput";
import { RENEWAL_LABEL } from "@/lib/tests/types";
import { saveRequirementAction } from "./actions";

export type RequirementFormValues = {
  name: string;
  description: string;
  kind: RequirementKind;
  testId: string;
  trainingEventId: string;
  appliesTo: ClubRole[];
  renewal: RenewalPeriod;
  graceDays: number;
  active: boolean;
};

type TestOption = { id: string; title: string; status: string; audience: string; isForm: boolean };
type EventOption = { id: string; title: string; kind: string };

const ROLE_CHOICES: { value: ClubRole; label: string }[] = [
  { value: "MEMBER", label: "Every club member" },
  { value: "PRESIDENT", label: "Presidents" },
  { value: "VP", label: "Vice presidents" },
  { value: "OFFICER", label: "Officers" },
  { value: "AMBASSADOR", label: "Ambassadors" },
];

const RENEWALS: RenewalPeriod[] = ["ACADEMIC_YEAR", "SEMESTER", "ANNUAL", "NONE"];

/** Create or edit a requirement: a test to pass, a form to fill out or a training to attend, for members and/or leader roles, with a grace period. */
export function RequirementForm({ id, initial, tests, events }: { id: string | null; initial: RequirementFormValues; tests: TestOption[]; events: EventOption[] }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const kindName = useId();
  const set = <K extends keyof RequirementFormValues>(k: K, val: RequirementFormValues[K]) => setV((s) => ({ ...s, [k]: val }));

  const usableTests = tests.filter((t) => t.status === "PUBLISHED" && t.audience === "ROLE_REQUIREMENT");
  const otherTests = tests.filter((t) => !usableTests.includes(t));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await saveRequirementAction(id, {
        ...v,
        testId: v.kind === "TEST" ? v.testId || null : null,
        trainingEventId: v.kind === "TRAINING" ? v.trainingEventId || null : null,
      }).catch(() => null);
      if (!r) return setError("We couldn't reach the server. Try again.");
      if (!r.ok) return setError(r.error);
      toast.success(id ? "Saved. Everyone's tasks are being updated." : "Requirement added. Everyone it applies to is getting a required task.");
      router.push("/admin/requirements");
    });
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <CardHeader title="What's required" />
        <CardBody className="space-y-4">
          <Field label="Name" required hint="Shown in people's tasks, marked Required by WSUSA.">
            {(fid) => <Input id={fid} value={v.name} maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Club Officer Policy Test" />}
          </Field>
          <Field label="Description" hint="Optional. What it covers and why it matters.">
            {(fid) => <Textarea id={fid} rows={3} maxLength={1000} value={v.description} onChange={(e) => set("description", e.target.value)} />}
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink">Kind</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["TEST", "Pass a test or fill out a form", "Met by passing a university test, or by submitting a university form."],
                  ["TRAINING", "Attend a training", "Met by a check-in at any session of a university training."],
                ] as const
              ).map(([value, label, detail]) => (
                <label key={value} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3", v.kind === value ? "border-brand bg-brand-50/60" : "border-line hover:bg-muted/50")}>
                  <input type="radio" name={kindName} checked={v.kind === value} onChange={() => set("kind", value)} className="mt-1 accent-[var(--color-brand)]" />
                  <span>
                    <span className="block text-sm font-medium text-ink">{label}</span>
                    <span className="block text-xs text-ink-3">{detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {v.kind === "TEST" ? (
            <Field
              label="Test or form"
              required
              hint={
                <>
                  Published university tests and forms whose audience is “WSUSA requirement”. Build or change one in{" "}
                  <Link href="/admin/tests" className="font-medium text-brand-600 hover:underline">
                    Tests
                  </Link>
                  .
                </>
              }
            >
              {(fid) => (
                <Select id={fid} value={v.testId} onChange={(e) => set("testId", e.target.value)}>
                  <option value="">Choose a test or form…</option>
                  {usableTests.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                      {t.isForm ? " (form)" : ""}
                    </option>
                  ))}
                  {otherTests.length ? (
                    <optgroup label="Not ready yet">
                      {otherTests.map((t) => (
                        <option key={t.id} value={t.id} disabled>
                          {t.title}
                          {t.isForm ? " (form)" : ""} — {t.status !== "PUBLISHED" ? "not published" : "audience isn't WSUSA requirement"}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </Select>
              )}
            </Field>
          ) : (
            <Field
              label="Training"
              required
              hint={
                <>
                  Scheduled university events. Add sessions in{" "}
                  <Link href="/admin/trainings" className="font-medium text-brand-600 hover:underline">
                    Trainings &amp; events
                  </Link>
                  ; attending any session counts.
                </>
              }
            >
              {(fid) => (
                <Select id={fid} value={v.trainingEventId} onChange={(e) => set("trainingEventId", e.target.value)}>
                  <option value="">Choose a training…</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title}
                      {ev.kind !== "TRAINING" ? " (not marked as a training)" : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Who and when" />
        <CardBody className="space-y-5">
          <fieldset>
            <legend className="text-sm font-medium text-ink">Applies to</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {ROLE_CHOICES.map((r) => (
                <Checkbox
                  key={r.value}
                  label={r.label}
                  checked={v.appliesTo.includes(r.value)}
                  onChange={() => set("appliesTo", v.appliesTo.includes(r.value) ? v.appliesTo.filter((x) => x !== r.value) : [...v.appliesTo, r.value])}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-3">
              Students in approved clubs only; advisors are never asked. When it&apos;s overdue, leaders&apos; permissions pause. Members have nothing to pause, so it stays on their task list marked overdue.
            </p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Renews" hint="When everyone has to do it again.">
              {(fid) => (
                <Select id={fid} value={v.renewal} onChange={(e) => set("renewal", e.target.value as RenewalPeriod)}>
                  {RENEWALS.map((r) => (
                    <option key={r} value={r}>
                      {RENEWAL_LABEL[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Grace period (days)" hint="0 = must be done before the role's permissions start.">
              {(fid) => (
                <NumberInput id={fid} value={v.graceDays} onValue={(n) => set("graceDays", n)} min={0} max={365} className="w-32" />
              )}
            </Field>
          </div>
          <p className="text-sm text-ink-2">
            {v.graceDays === 0
              ? "Leaders' permissions stay paused until this is done (their title stays)."
              : `People have ${v.graceDays} ${v.graceDays === 1 ? "day" : "days"} from the latest of joining the club or taking the role, the club's approval, and the start of each renewal period. After that, leaders' permissions pause until it's done.`}
          </p>
          <label className="flex items-center gap-3">
            <Switch checked={v.active} onCheckedChange={(c) => set("active", c)} aria-label="Requirement is on" />
            <span className="text-sm">
              <span className="font-medium text-ink">{v.active ? "On" : "Off"}</span>
              <span className="block text-xs text-ink-3">{v.active ? "Everyone it applies to is asked to complete it." : "Nobody is asked; open tasks for it close."}</span>
            </span>
          </label>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {error ? (
          <p role="alert" className="mr-auto flex items-start gap-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
          </p>
        ) : null}
        <ButtonLink href="/admin/requirements" variant="outline">
          Cancel
        </ButtonLink>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} {id ? "Save requirement" : "Add requirement"}
        </Button>
      </div>
    </form>
  );
}
