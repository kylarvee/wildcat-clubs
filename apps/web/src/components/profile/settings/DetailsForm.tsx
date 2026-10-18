"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserKind } from "@prisma/client";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { useRunAction } from "@/components/roles/useRunAction";
import { confirmDetailsAction, saveDetailsAction } from "@/app/settings/actions";
import { GENDER_LABEL, RELATIONSHIP_LABEL, US_STATES, YEAR_LABEL } from "@/lib/details/rules";

type Values = {
  studentId: string;
  birthDate: string;
  gender: string;
  phone: string;
  contactEmail: string;
  yearInSchool: string;
  addressLine: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  emergencyEmail: string;
};

/**
 * The one form for member details. Saving a complete set confirms it for the
 * year; "Everything's still right" confirms without changes.
 */
export function DetailsForm({ kind, weberEmail, initial, canConfirm }: { kind: UserKind; weberEmail: string; initial: Values; canConfirm: boolean }) {
  const [v, setV] = useState(initial);
  const { pending, error, run } = useRunAction();
  const router = useRouter();
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const student = kind === "STUDENT";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(() =>
      saveDetailsAction({
        ...v,
        gender: (v.gender || null) as never,
        yearInSchool: (v.yearInSchool || null) as never,
        emergencyRelationship: (v.emergencyRelationship || null) as never,
      }),
    );
    if (r.ok) {
      toast.success(r.data.complete ? "Saved and confirmed for this year." : `Saved. Still needed: ${r.data.missing.join(", ")}.`);
      router.refresh();
    }
  }

  async function confirm() {
    const r = await run(() => confirmDetailsAction());
    if (r.ok) {
      toast.success("Confirmed for this year. Thanks!");
      router.refresh();
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink">About you</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {student ? (
            <Field label="Student ID (W-number)" required hint="A W and eight digits.">
              {(id) => <Input id={id} value={v.studentId} onChange={set("studentId")} placeholder="W01234567" autoComplete="off" />}
            </Field>
          ) : null}
          {student ? (
            <Field label="Date of birth" required>
              {(id) => <Input id={id} type="date" value={v.birthDate} onChange={set("birthDate")} autoComplete="bday" />}
            </Field>
          ) : null}
          <Field label="Gender" required hint="Used only for WSUSA's anonymous totals.">
            {(id) => (
              <Select id={id} value={v.gender} onChange={set("gender")}>
                <option value="">Choose…</option>
                {Object.entries(GENDER_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {student ? (
            <Field label="Year in school" required>
              {(id) => (
                <Select id={id} value={v.yearInSchool} onChange={set("yearInSchool")}>
                  <option value="">Choose…</option>
                  {Object.entries(YEAR_LABEL).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink">How clubs reach you</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Weber email" hint="From your sign-in. Clubs use this one.">
            {(id) => <Input id={id} value={weberEmail} readOnly disabled />}
          </Field>
          <Field label="Phone" required>
            {(id) => <Input id={id} type="tel" value={v.phone} onChange={set("phone")} placeholder="801-555-0123" autoComplete="tel" />}
          </Field>
          <Field label="Personal email" hint="Optional, if you'd rather hear from clubs there too.">
            {(id) => <Input id={id} type="email" value={v.contactEmail} onChange={set("contactEmail")} autoComplete="email" />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink">Mailing address</legend>
        <Field label="Street address" required>
          {(id) => <Input id={id} value={v.addressLine} onChange={set("addressLine")} autoComplete="street-address" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem_9rem]">
          <Field label="City" required>
            {(id) => <Input id={id} value={v.addressCity} onChange={set("addressCity")} autoComplete="address-level2" />}
          </Field>
          <Field label="State" required>
            {(id) => (
              <Select id={id} value={v.addressState} onChange={set("addressState")} autoComplete="address-level1">
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="ZIP code" required>
            {(id) => <Input id={id} value={v.addressZip} onChange={set("addressZip")} inputMode="numeric" autoComplete="postal-code" />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink">Emergency contact</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            {(id) => <Input id={id} value={v.emergencyName} onChange={set("emergencyName")} autoComplete="off" />}
          </Field>
          <Field label="Relationship to you" required>
            {(id) => (
              <Select id={id} value={v.emergencyRelationship} onChange={set("emergencyRelationship")}>
                <option value="">Choose…</option>
                {Object.entries(RELATIONSHIP_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Phone" required hint="Outside the US? Start with + and the country code.">
            {(id) => <Input id={id} type="tel" value={v.emergencyPhone} onChange={set("emergencyPhone")} autoComplete="off" />}
          </Field>
          <Field label="Email" required>
            {(id) => <Input id={id} type="email" value={v.emergencyEmail} onChange={set("emergencyEmail")} autoComplete="off" />}
          </Field>
        </div>
      </fieldset>

      {error ? <Callout tone="danger">{error}</Callout> : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} Save and confirm
        </Button>
        {canConfirm ? (
          <Button type="button" variant="outline" disabled={pending} onClick={confirm}>
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Everything&apos;s still right
          </Button>
        ) : null}
      </div>
    </form>
  );
}
