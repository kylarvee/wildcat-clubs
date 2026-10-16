"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ClubScope } from "@prisma/client";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { ClubLogo } from "@/components/ui/avatar";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { cn } from "@/components/ui/cn";
import { RichTextEditor } from "@/components/rich/RichTextEditor";
import { SearchSelect, type SearchOption } from "@/components/founding/SearchSelect";
import { LogoField } from "@/components/founding/LogoField";
import { CLUB_TYPES, SCOPES, TYPE_LABEL, type FoundingType } from "@/components/founding/copy";
import { saveProfileAction } from "@/app/clubs/[slug]/manage/profile/actions";

const OTHER = "__other__";

export type ProfileFormClub = {
  id: string;
  name: string;
  type: FoundingType | "COLLEGE_AMBASSADORS";
  shortDescription: string;
  descriptionHtml: string | null;
  scope: ClubScope;
  collegeId: string | null;
  departmentId: string | null;
  requestedDepartmentName: string | null;
  focusMajorId: string | null;
  focusOther: string | null;
  logoUrl: string | null;
  logoColor: string;
  contactEmail: string | null;
};

/** The Club Profile editor — the one input tool for a club's profile (ARCHITECTURE §4). */
export function ProfileForm({
  club,
  departments,
  colleges,
  majors,
  canChangeType,
  settingsHref,
}: {
  club: ProfileFormClub;
  departments: SearchOption[];
  colleges: { id: string; name: string }[];
  majors: SearchOption[];
  canChangeType: boolean;
  settingsHref: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(club.name);
  const [short, setShort] = useState(club.shortDescription);
  const [type, setType] = useState(club.type);
  const [department, setDepartment] = useState<string | null>(club.departmentId ?? (club.requestedDepartmentName ? OTHER : null));
  const [otherDept, setOtherDept] = useState(club.requestedDepartmentName ?? "");
  const [scope, setScope] = useState<ClubScope>(club.scope);
  const [collegeId, setCollegeId] = useState(club.collegeId ?? "");
  const [focus, setFocus] = useState<string | null>(club.focusMajorId ?? (club.focusOther ? OTHER : null));
  const [focusOther, setFocusOther] = useState(club.focusOther ?? "");
  const [logoUrl, setLogoUrl] = useState<string | null>(club.logoUrl);
  const [logoColor, setLogoColor] = useState(club.logoColor);

  const deptRule = type === "SPONSORED" ? "required" : type === "AFFILIATE" ? "optional" : "none";
  const [pending, start] = useTransition();

  // onSubmit (not <form action>) so React doesn't reset the editor's uncontrolled input after saving.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(() => save(fd));
  }

  async function save(fd: FormData) {
    setError(null);
    const r = await saveProfileAction({
      clubId: club.id,
      name,
      shortDescription: short,
      descriptionHtml: String(fd.get("descriptionHtml") ?? ""),
      type: type === "COLLEGE_AMBASSADORS" ? undefined : type,
      scope,
      collegeId: scope === "COLLEGE" ? collegeId : null,
      departmentId: deptRule !== "none" && department && department !== OTHER ? department : null,
      requestedDepartmentName: deptRule !== "none" && department === OTHER ? otherDept : null,
      focusMajorId: focus && focus !== OTHER ? focus : null,
      focusOther: focus === OTHER ? focusOther : null,
      logoUrl,
      logoColor,
    });
    if (!r.ok) {
      setError(r.error);
      toast.error("Your profile wasn't saved — see the message above the Save button.");
      return;
    }
    toast.success("Profile saved");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 xl:grid-cols-[1fr_300px]" noValidate aria-busy={pending}>
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader title="Basics" description="What students see first on the clubs list and your club page." />
          <CardBody className="space-y-4">
            <Field label="Club name" required>
              {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="off" />}
            </Field>
            <Field label="Short description" required hint={`${short.length}/200 · One sentence for the clubs list and search.`}>
              {(id) => <Textarea id={id} value={short} onChange={(e) => setShort(e.target.value.slice(0, 200))} rows={2} />}
            </Field>
            <div className="space-y-1.5" role="group" aria-labelledby="full-description-label">
              <p id="full-description-label" className="text-sm font-medium text-ink">
                Full description <span className="text-danger">*</span>
              </p>
              <RichTextEditor name="descriptionHtml" defaultValue={club.descriptionHtml} clubId={club.id} placeholder="Tell students what your club is about…" minHeight={220} />
              <p className="text-xs text-ink-3">What you do, when you meet, and who should join. Add photos, video or documents if you like.</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Where your club fits" description="Used for sorting and grouping on the clubs list and the network map." />
          <CardBody className="space-y-5">
            {canChangeType && type !== "COLLEGE_AMBASSADORS" ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-ink">Club type</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {CLUB_TYPES.map((t) => (
                    <label key={t.value} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand", type === t.value ? "border-brand bg-brand-50/60" : "border-line-2 hover:bg-muted/50")}>
                      <input type="radio" name="type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} className="mt-0.5 accent-[var(--color-brand)]" />
                      <span>
                        <span className="block font-medium text-ink">{t.label}</span>
                        <span className="block text-xs text-ink-3">{t.tagline}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <p className="text-sm text-ink-2">
                <span className="font-medium text-ink">{TYPE_LABEL[type]} club.</span> The type is set when a club is founded — contact WSUSA if it needs to change.
              </p>
            )}

            {deptRule !== "none" ? (
              <div className="space-y-3">
                <Field label="Department" required={deptRule === "required"} hint={deptRule === "optional" ? "Optional for Affiliate clubs." : undefined}>
                  {(id) => <SearchSelect id={id} options={departments} value={department} onChange={setDepartment} placeholder="Search departments…" extraOption={{ value: OTHER, label: "Other — my department isn't listed" }} />}
                </Field>
                {department === OTHER ? (
                  <Field label="Department name" required hint="WSUSA adds it to the list and links your club.">
                    {(id) => <Input id={id} value={otherDept} onChange={(e) => setOtherDept(e.target.value)} maxLength={120} />}
                  </Field>
                ) : null}
              </div>
            ) : null}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink">Where does your club sit?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {SCOPES.map((s) => (
                  <label key={s.value} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand", scope === s.value ? "border-brand bg-brand-50/60" : "border-line-2 hover:bg-muted/50")}>
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

            <Field label="Focus major or discipline" hint="Optional. Helps students filter the clubs list.">
              {(id) => <SearchSelect id={id} options={majors} value={focus} onChange={setFocus} placeholder="Search majors…" extraOption={{ value: OTHER, label: "Another discipline — not a WSU major" }} />}
            </Field>
            {focus === OTHER ? (
              <Field label="Discipline">
                {(id) => <Input id={id} value={focusOther} onChange={(e) => setFocusOther(e.target.value)} maxLength={120} />}
              </Field>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Logo & color" />
          <CardBody>
            <LogoField clubId={club.id} clubName={name} logoUrl={logoUrl} logoColor={logoColor} onLogoChange={setLogoUrl} onColorChange={setLogoColor} />
          </CardBody>
          <CardFooter className="justify-start text-sm text-ink-3">
            Club Google account: <span className="font-medium text-ink">{club.contactEmail ?? "not set"}</span> ·{" "}
            <Link href={settingsHref} className="font-medium text-brand-600 hover:underline">
              Change in Settings
            </Link>
          </CardFooter>
        </Card>

        {error ? <Callout tone="danger">{error}</Callout> : null}
        <div className="sticky bottom-3 z-10 flex justify-end">
          <Button type="submit" disabled={pending} className="shadow-[var(--shadow-pop)]">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </div>

      <aside className="xl:sticky xl:top-20 xl:self-start" aria-label="Preview">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Clubs list preview</p>
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-3">
              <ClubLogo name={name || "Club"} src={logoUrl} color={logoColor} size="md" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{name || "Your club name"}</p>
                <p className="text-xs text-ink-3">
                  {TYPE_LABEL[type]} · {SCOPES.find((s) => s.value === scope)?.label}
                </p>
              </div>
            </div>
            <p className="line-clamp-3 text-sm text-ink-2">{short || "Your one-sentence description shows here."}</p>
          </CardBody>
        </Card>
      </aside>
    </form>
  );
}
