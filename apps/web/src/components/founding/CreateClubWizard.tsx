"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ClubScope } from "@prisma/client";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, GraduationCap, Handshake, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { cn } from "@/components/ui/cn";
import { SearchSelect, type SearchOption } from "@/components/founding/SearchSelect";
import { SimilarClubs } from "@/components/founding/SimilarClubs";
import { FORMING_NOTE, FOUNDING_TYPES, SCOPES, type FoundingType } from "@/components/founding/copy";
import { createClubAction } from "@/app/clubs/new/actions";

const OTHER = "__other__";
const TYPE_ICON = { SPONSORED: GraduationCap, AFFILIATE: Handshake, REGISTERED: Users } as const;

function previewSlug(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "your-club"
  );
}

export function CreateClubWizard({
  departments,
  colleges,
  majors,
  founderIsStaff,
}: {
  departments: SearchOption[];
  colleges: { id: string; name: string }[];
  majors: SearchOption[];
  founderIsStaff: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<FoundingType | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [otherDept, setOtherDept] = useState("");
  const [name, setName] = useState("");
  const [short, setShort] = useState("");
  const [scope, setScope] = useState<ClubScope>("UNIVERSITY");
  const [collegeId, setCollegeId] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [focusOther, setFocusOther] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [forming, setForming] = useState(false);

  const typeInfo = FOUNDING_TYPES.find((t) => t.value === type) ?? null;
  const steps = useMemo(() => (typeInfo?.department === "none" ? ["Club type", "Profile essentials"] : ["Club type", "Department", "Profile essentials"]), [typeInfo]);
  const current = steps[step];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    // Move focus to the new step's heading so keyboard and screen-reader users land in the right place.
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  function next() {
    setError(null);
    if (current === "Club type" && !type) return setError("Choose the kind of club you're starting.");
    if (current === "Department" && typeInfo?.department === "required") {
      if (!department) return setError("Sponsored clubs need a department. Choose yours, or choose “Other”.");
      if (department === OTHER && otherDept.trim().length < 2) return setError("Type the name of your department.");
    }
    if (current === "Department" && department === OTHER && otherDept.trim().length < 2) return setError("Type the name of your department, or clear the selection.");
    setStep((s) => Math.min(s + 1, steps.length - 1));
  }

  function back() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  function submit() {
    setError(null);
    if (name.trim().length < 3) return setError("Give your club a name (at least 3 characters).");
    if (short.trim().length < 10) return setError("Add a one-sentence description (at least 10 characters).");
    if (scope === "COLLEGE" && !collegeId) return setError("Choose the college your club belongs to.");
    start(async () => {
      const r = await createClubAction({
        type: type!,
        departmentId: typeInfo?.department !== "none" && department && department !== OTHER ? department : null,
        requestedDepartmentName: typeInfo?.department !== "none" && department === OTHER ? otherDept : null,
        name,
        shortDescription: short,
        scope,
        collegeId: scope === "COLLEGE" ? collegeId : null,
        focusMajorId: focus && focus !== OTHER ? focus : null,
        focusOther: focus === OTHER ? focusOther : null,
        contactEmail,
        listedAsForming: forming,
      });
      if (!r.ok) return setError(r.error);
      router.push(`/clubs/${r.data.slug}/manage?created=1`);
    });
  }

  return (
    <Card className="overflow-visible">
      <ol className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line px-5 py-4 text-sm" aria-label="Steps">
        {steps.map((label, i) => (
          <li key={label} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                i < step ? "bg-brand text-white" : i === step ? "bg-brand-50 text-brand ring-2 ring-brand" : "bg-muted text-ink-3",
              )}
            >
              {i < step ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={cn("font-medium", i === step ? "text-ink" : "text-ink-3")}>{label}</span>
          </li>
        ))}
      </ol>

      <div className="space-y-5 px-5 py-6">
        {current === "Club type" ? (
          <section aria-labelledby="step-heading" className="space-y-4">
            <div>
              <h2 id="step-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
                What kind of club are you starting?
              </h2>
              <p className="mt-1 text-sm text-ink-3">WSUSA recognizes three kinds of student clubs. You can change this until your club is approved.</p>
            </div>
            <fieldset className="grid gap-3 md:grid-cols-3">
              <legend className="sr-only">Club type</legend>
              {FOUNDING_TYPES.map((t) => {
                const Icon = TYPE_ICON[t.value];
                const on = type === t.value;
                return (
                  <label
                    key={t.value}
                    className={cn(
                      "flex h-full cursor-pointer flex-col rounded-xl border p-4 text-left transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
                      on ? "border-brand bg-brand-50/60 ring-1 ring-brand" : "border-line-2 bg-surface hover:border-brand-200 hover:bg-muted/50",
                    )}
                  >
                    <input
                      type="radio"
                      name="clubType"
                      value={t.value}
                      checked={on}
                      onChange={() => {
                        setType(t.value);
                        setError(null);
                      }}
                      className="sr-only"
                    />
                    <span className="flex items-center justify-between">
                      <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", on ? "bg-brand text-white" : "bg-brand-50 text-brand")}>
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border", on ? "border-brand bg-brand text-white" : "border-line-2")}>
                        {on ? <Check className="h-3 w-3" aria-hidden /> : null}
                      </span>
                    </span>
                    <span className="mt-3 font-semibold text-ink">{t.label}</span>
                    <span className="text-sm text-ink-2">{t.tagline}</span>
                    <ul className="mt-3 space-y-1.5 text-xs text-ink-3">
                      {t.points.map((p) => (
                        <li key={p} className="flex gap-1.5">
                          <span aria-hidden>·</span>
                          {p}
                        </li>
                      ))}
                    </ul>
                  </label>
                );
              })}
            </fieldset>
          </section>
        ) : null}

        {current === "Department" && typeInfo ? (
          <section aria-labelledby="step-heading" className="space-y-4">
            <div>
              <h2 id="step-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
                {typeInfo.department === "required" ? "Which department sponsors your club?" : "Is your club connected to a department?"}
              </h2>
              <p className="mt-1 text-sm text-ink-3">
                {typeInfo.department === "required"
                  ? "Sponsored clubs belong to an academic department. If yours isn't listed, choose “Other” and WSUSA will add it."
                  : "Optional for Affiliate clubs. Skip this if you're connected to a national organization instead — you can name it in your constitution."}
              </p>
            </div>
            <Field label="Department" required={typeInfo.department === "required"}>
              {(id) => (
                <SearchSelect
                  id={id}
                  options={departments}
                  value={department}
                  onChange={(v) => {
                    setDepartment(v);
                    setError(null);
                  }}
                  placeholder="Search departments…"
                  extraOption={{ value: OTHER, label: "Other — my department isn't listed" }}
                />
              )}
            </Field>
            {department === OTHER ? (
              <Field label="Department name" required hint="WSUSA adds it to the list during review and links your club.">
                {(id) => <Input id={id} value={otherDept} onChange={(e) => setOtherDept(e.target.value)} maxLength={120} placeholder="e.g. Department of Outdoor & Community Recreation" autoFocus />}
              </Field>
            ) : null}
          </section>
        ) : null}

        {current === "Profile essentials" ? (
          <section aria-labelledby="step-heading" className="space-y-4">
            <div>
              <h2 id="step-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
                Tell us the essentials
              </h2>
              <p className="mt-1 text-sm text-ink-3">You can polish all of this later in the profile editor. Nothing is public until WSUSA approves your club.</p>
            </div>
            <Field label="Club name" required hint={name.trim() ? `Your club page will live at /clubs/${previewSlug(name)}` : "Use the name you'd put on a flyer."}>
              {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Wildcat Robotics Club" autoComplete="off" />}
            </Field>
            <Field label="Short description" required hint={`${short.length}/200 · One sentence students see on the clubs list.`}>
              {(id) => <Textarea id={id} value={short} onChange={(e) => setShort(e.target.value.slice(0, 200))} rows={2} placeholder="We build robots, compete regionally, and teach anyone who wants to learn." />}
            </Field>
            <SimilarClubs name={name} description={short} canRevive={!founderIsStaff} />
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink">
                Where does your club sit? <span className="text-danger">*</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {SCOPES.map((s) => (
                  <label
                    key={s.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand",
                      scope === s.value ? "border-brand bg-brand-50/60" : "border-line-2 hover:bg-muted/50",
                    )}
                  >
                    <input type="radio" name="scope" value={s.value} checked={scope === s.value} onChange={() => setScope(s.value)} className="mt-0.5 accent-[var(--color-brand)]" />
                    <span>
                      <span className="block font-medium text-ink">{s.label}</span>
                      <span className="block text-ink-3">{s.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {scope === "COLLEGE" ? (
              <Field label="College" required>
                {(id) => (
                  <Select id={id} value={collegeId} onChange={(e) => setCollegeId(e.target.value)}>
                    <option value="">Choose a college…</option>
                    {colleges.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            <Field label="Focus major or discipline" hint="Helps students find you on the clubs list. Optional.">
              {(id) => (
                <SearchSelect id={id} options={majors} value={focus} onChange={setFocus} placeholder="Search majors…" extraOption={{ value: OTHER, label: "Another discipline — not a WSU major" }} />
              )}
            </Field>
            {focus === OTHER ? (
              <Field label="Discipline">
                {(id) => <Input id={id} value={focusOther} onChange={(e) => setFocusOther(e.target.value)} maxLength={120} placeholder="e.g. Competitive chess" />}
              </Field>
            ) : null}
            <Field label="Club Google account (optional)" hint="The shared account your club uses for Drive, Calendar and Chat. You can add it later in Settings.">
              {(id) => <Input id={id} type="email" inputMode="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="robotics.club@weber.edu" autoComplete="off" />}
            </Field>
            <Checkbox
              checked={forming}
              onChange={(e) => setForming(e.target.checked)}
              label="List this club as forming"
              description={FORMING_NOTE}
              className="rounded-lg border border-line-2 p-3"
            />
            <Callout tone="brand" title={founderIsStaff ? "You'll be the club's advisor" : "You'll be the club's President"}>
              {founderIsStaff
                ? "Faculty and staff can't hold student roles, so you'll start as advisor. Invite a student to be President from the org chart once students join."
                : "You'll start as President. Next you'll invite a faculty or staff advisor and adopt a constitution — your checklist walks you through it."}
            </Callout>
          </section>
        ) : null}

        {error ? (
          <Callout tone="danger" className="mt-2">
            {error}
          </Callout>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-4">
        {step > 0 ? (
          <Button variant="ghost" onClick={back} disabled={pending}>
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </Button>
        ) : (
          <span />
        )}
        {current === "Profile essentials" ? (
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {pending ? "Creating your club…" : "Create club draft"}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            {current === "Department" && typeInfo?.department === "optional" && !department ? (
              <Button variant="outline" onClick={() => setStep((s) => s + 1)}>
                Skip
              </Button>
            ) : null}
            <Button onClick={next}>
              Continue <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
