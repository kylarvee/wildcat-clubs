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
  /** "" = every leader permission; else the one permission it's about (a Capability). */
  gatesCapability: string;
  /** "" = WSUSA's, for every club; else the office whose clubs it reaches. */
  officeId: string;
};

type TestOption = { id: string; title: string; status: string; audience: string; isForm: boolean; officeId: string | null };
type EventOption = { id: string; title: string; kind: string };
type OfficeOption = { id: string; name: string };
/** The club permissions a requirement can be about (lib/authz CAPABILITIES). */
export type PermissionOption = { value: string; label: string };

const ROLE_CHOICES: { value: ClubRole; label: string }[] = [
  { value: "MEMBER", label: "Every club member" },
  { value: "PRESIDENT", label: "Presidents" },
  { value: "VP", label: "Vice presidents" },
  { value: "OFFICER", label: "Officers" },
  { value: "AMBASSADOR", label: "Ambassadors" },
];

const RENEWALS: RenewalPeriod[] = ["ACADEMIC_YEAR", "SEMESTER", "ANNUAL", "NONE"];

/**
 * Create or edit a requirement: a test to pass, a form to fill out or a
 * training to attend, for members and/or leader roles (optionally only those
 * holding one permission), with a grace period. WSUSA's admins choose whose
 * it is (WSUSA's for every club, or an office's for its clubs); an office's
 * staff always file their own office's, using its own tests and forms.
 */
export function RequirementForm({
  id,
  initial,
  tests,
  events,
  offices,
  umbrella,
  permissions,
}: {
  id: string | null;
  initial: RequirementFormValues;
  tests: TestOption[];
  events: EventOption[];
  /** Offices this person can file a requirement under (besides WSUSA, for WSUSA's admins). */
  offices: OfficeOption[];
  /** WSUSA's admins (every office's requirements); false for an office's staff. */
  umbrella: boolean;
  permissions: PermissionOption[];
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const kindName = useId();
  const permId = useId();
  const set = <K extends keyof RequirementFormValues>(k: K, val: RequirementFormValues[K]) => setV((s) => ({ ...s, [k]: val }));

  const office = offices.find((o) => o.id === v.officeId) ?? null;
  const owner = office?.name ?? "WSUSA";
  // A requirement uses its own office's tests and forms; an office's is always a test or form.
  const mine = tests.filter((t) => (t.officeId ?? "") === v.officeId);
  const usableTests = mine.filter((t) => t.status === "PUBLISHED" && t.audience === "ROLE_REQUIREMENT");
  const otherTests = mine.filter((t) => !usableTests.includes(t));
  const kinds = (
    [
      ["TEST", "Pass a test or fill out a form", "Met by passing a university test, or by submitting a university form."],
      ["TRAINING", "Attend a training", "Met by a check-in at any session of a university training."],
      ["PROFILE", "Confirm member details", "Met when someone's member details (Settings → Member details) are complete and confirmed this period."],
    ] as const
  ).filter(([value]) => !v.officeId || value === "TEST");
  const gated = v.gatesCapability !== "";
  const permissionLabel = permissions.find((p) => p.value === v.gatesCapability)?.label ?? "that";

  const chooseOffice = (officeId: string) =>
    setV((s) => ({ ...s, officeId, testId: tests.some((t) => t.id === s.testId && (t.officeId ?? "") === officeId) ? s.testId : "", kind: officeId ? "TEST" : s.kind }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await saveRequirementAction(id, {
        ...v,
        testId: v.kind === "TEST" ? v.testId || null : null,
        trainingEventId: v.kind === "TRAINING" ? v.trainingEventId || null : null,
        gatesCapability: v.gatesCapability || null,
        officeId: v.officeId || null,
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
          {umbrella && offices.length ? (
            <Field label="Whose requirement" hint={v.officeId ? `It reaches only ${owner}'s clubs, and uses ${owner}'s own tests and forms.` : "WSUSA's requirements reach every approved club."}>
              {(fid) => (
                <Select id={fid} value={v.officeId} onChange={(e) => chooseOffice(e.target.value)}>
                  <option value="">WSUSA (every club)</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} (its clubs only)
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : !umbrella && offices.length > 1 ? (
            <Field label="Whose requirement" hint="It reaches only that office's clubs.">
              {(fid) => (
                <Select id={fid} value={v.officeId} onChange={(e) => chooseOffice(e.target.value)}>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : !umbrella && office ? (
            <p className="rounded-xl bg-muted/70 px-3.5 py-3 text-sm text-ink-2">
              A {office.name} requirement: it reaches only {office.name}&apos;s clubs and uses your office&apos;s own tests and forms.
            </p>
          ) : null}
          <Field label="Name" required hint={`Shown in people's tasks, marked Required (it's ${owner}'s).`}>
            {(fid) => <Input id={fid} value={v.name} maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Club Officer Policy Test" />}
          </Field>
          <Field label="Description" hint="Optional. What it covers and why it matters.">
            {(fid) => <Textarea id={fid} rows={3} maxLength={1000} value={v.description} onChange={(e) => set("description", e.target.value)} />}
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink">Kind</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {kinds.map(([value, label, detail]) => (
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
          {v.kind === "PROFILE" ? (
            <p className="rounded-xl bg-muted/70 px-3.5 py-3 text-sm text-ink-2">
              People confirm their student ID, date of birth, contact details, address and emergency contact once, in Settings → Member details. Every club reuses them, so nobody types them twice.
            </p>
          ) : v.kind === "TEST" ? (
            <Field
              label="Test or form"
              required
              hint={
                <>
                  Published {v.officeId ? `${owner} ` : "WSUSA "}tests and forms whose audience is “WSUSA requirement”. Build or change one in{" "}
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
                  // Members hold no club permissions, so a one-permission requirement is for leaders only.
                  disabled={r.value === "MEMBER" && gated}
                  checked={v.appliesTo.includes(r.value) && !(r.value === "MEMBER" && gated)}
                  onChange={() => set("appliesTo", v.appliesTo.includes(r.value) ? v.appliesTo.filter((x) => x !== r.value) : [...v.appliesTo, r.value])}
                />
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-line p-3">
              <Checkbox
                label="Only people with one permission"
                description="Narrows the leader roles above to people who hold it (presidents and vice presidents hold every permission). When it's overdue, only that permission pauses."
                checked={gated}
                onChange={() => setV((s) => ({ ...s, gatesCapability: s.gatesCapability ? "" : (permissions[0]?.value ?? ""), appliesTo: s.gatesCapability ? s.appliesTo : s.appliesTo.filter((x) => x !== "MEMBER") }))}
              />
              {gated ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 pl-7 text-sm text-ink-2">
                  <label htmlFor={permId}>Only people with the</label>
                  <Select id={permId} value={v.gatesCapability} onChange={(e) => set("gatesCapability", e.target.value)} className="w-auto min-w-[12rem]">
                    {permissions.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                  <span>permission</span>
                </div>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-ink-3">
              {v.officeId ? `Students in ${owner}'s approved clubs only` : "Students in approved clubs only"}; advisors are never asked.{" "}
              {gated
                ? `When it's overdue, only ${permissionLabel} pauses; the rest of their role keeps working.`
                : "When it's overdue, leaders' permissions pause. Members have nothing to pause, so it stays on their task list marked overdue."}
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
              ? gated
                ? `${permissionLabel} stays paused until this is done (their title and other permissions stay).`
                : "Leaders' permissions stay paused until this is done (their title stays)."
              : `People have ${v.graceDays} ${v.graceDays === 1 ? "day" : "days"} from the latest of joining the club or taking the role, the club's approval, and the start of each renewal period. After that, ${gated ? `${permissionLabel} pauses` : "leaders' permissions pause"} until it's done.`}
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
