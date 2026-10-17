"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Camera, Loader2, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Label, Select } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { RichTextEditor } from "@/components/rich/RichTextEditor";
import { SearchSelect } from "@/components/founding/SearchSelect";
import { useRunAction } from "@/components/roles/useRunAction";
import { updateProfileAction } from "@/app/settings/actions";
import type { MajorOption, SettingsUser } from "@/lib/profiles/queries";

const MAX_PHOTO_MB = 8;

/**
 * The profile basics: photo, name, pronouns, headline, majors & minors,
 * class year (or title for faculty and staff), LinkedIn link and About.
 */
export function ProfileForm({ user, majors }: { user: SettingsUser; majors: MajorOption[] }) {
  const student = user.kind === "STUDENT";
  const [name, setName] = useState(user.name);
  const [pronouns, setPronouns] = useState(user.pronouns ?? "");
  const [headline, setHeadline] = useState(user.headline ?? "");
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? "");
  const [classYear, setClassYear] = useState(user.classYear ? String(user.classYear) : "");
  const [linkedin, setLinkedin] = useState(user.linkedinUrl ?? "");
  const [about, setAbout] = useState(user.aboutHtml ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [picked, setPicked] = useState(user.majors.map((m) => ({ majorId: m.majorId, isMinor: m.isMinor })));
  const [choice, setChoice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { pending, error, run } = useRunAction();

  const byId = useMemo(() => new Map(majors.map((m) => [m.id, m])), [majors]);
  const available = useMemo(() => majors.filter((m) => !picked.some((p) => p.majorId === m.id)).map((m) => ({ value: m.id, label: m.name, hint: m.college })), [majors, picked]);
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => {
    const ys = Array.from({ length: 13 }, (_, i) => thisYear - 6 + i);
    if (user.classYear && !ys.includes(user.classYear)) ys.push(user.classYear);
    return ys.sort((a, b) => a - b);
  }, [thisYear, user.classYear]);

  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file (JPG, PNG, GIF or WebP).");
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) return toast.error(`Photos can be up to ${MAX_PHOTO_MB} MB.`);
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("scope", "user");
      // Your photo shows wherever your name does, so it's public.
      body.set("visibility", "PUBLIC");
      const res = await fetch("/api/files/upload", { method: "POST", body });
      const json = (await res.json()) as { ok: boolean; data?: { url: string }; error?: string };
      if (json.ok && json.data) {
        setAvatarUrl(json.data.url);
        toast.success("Photo uploaded — save to use it.");
      } else toast.error(json.error ?? "That photo didn't upload. Try again.");
    } catch {
      toast.error("That photo didn't upload. Check your connection and try again.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function addMajor(id: string | null, isMinor: boolean) {
    if (!id) return;
    setPicked((cur) => (cur.some((p) => p.majorId === id) ? cur : [...cur, { majorId: id, isMinor }]));
    setChoice(null);
  }

  async function save() {
    await run(
      () =>
        updateProfileAction({
          name,
          pronouns,
          headline,
          aboutHtml: about,
          jobTitle,
          classYear: classYear || null,
          linkedinUrl: linkedin,
          avatarUrl,
          majors: student ? picked : [],
        }),
      { success: "Profile saved." },
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-ink">Photo and name</h2>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Avatar name={name || user.name} src={avatarUrl} color={user.avatarColor} size="xl" className="ring-line" />
          <div className="space-y-2">
            <input ref={fileInput} id="avatar-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={(e) => void uploadPhoto(e.target.files?.[0])} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
                {uploading ? "Uploading…" : avatarUrl ? "Change photo" : "Upload a photo"}
              </Button>
              {avatarUrl ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setAvatarUrl(null)}>
                  <Trash2 className="h-4 w-4" aria-hidden /> Remove
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-ink-3">A square photo works best. Up to {MAX_PHOTO_MB} MB. Anyone can see it.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <Field label="Name" required hint="The name other students and your clubs see.">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoComplete="name" />}
          </Field>
          <Field label="Pronouns" hint="Optional, e.g. she/her">
            {(id) => <Input id={id} value={pronouns} onChange={(e) => setPronouns(e.target.value)} maxLength={30} />}
          </Field>
        </div>
        <Field label="Headline" className="mt-4" hint="One line under your name, like “Psychology student · aspiring clinical researcher”.">
          {(id) => <Input id={id} value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={120} />}
        </Field>
        {!student ? (
          <Field label="Title" className="mt-4" hint="Your role at Weber State, e.g. Associate Professor of Biology.">
            {(id) => <Input id={id} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={120} />}
          </Field>
        ) : null}
      </Card>

      {student ? (
        <Card className="p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-ink">What you study</h2>
          <p className="mt-1 text-sm text-ink-3">Your majors and minors at Weber State. They show on your profile under Education.</p>
          {picked.length ? (
            <ul className="mt-4 space-y-2" aria-label="Your majors and minors">
              {picked.map((p) => {
                const m = byId.get(p.majorId);
                return (
                  <li key={p.majorId} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
                    <span className="min-w-0 flex-1 text-sm font-medium text-ink">{m?.name ?? "Unknown major"}</span>
                    <label className="sr-only" htmlFor={`kind-${p.majorId}`}>
                      Major or minor for {m?.name}
                    </label>
                    <Select
                      id={`kind-${p.majorId}`}
                      className="h-8 w-28"
                      value={p.isMinor ? "minor" : "major"}
                      onChange={(e) => setPicked((cur) => cur.map((x) => (x.majorId === p.majorId ? { ...x, isMinor: e.target.value === "minor" } : x)))}
                    >
                      <option value="major">Major</option>
                      <option value="minor">Minor</option>
                    </Select>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove ${m?.name}`} onClick={() => setPicked((cur) => cur.filter((x) => x.majorId !== p.majorId))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {picked.length < 8 ? (
            <div className="mt-4 space-y-2">
              <Label htmlFor="add-major">Add a major or minor</Label>
              <SearchSelect id="add-major" options={available} value={choice} onChange={setChoice} placeholder="Type to search Weber State programs…" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" disabled={!choice} onClick={() => addMajor(choice, false)}>
                  Add as a major
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={!choice} onClick={() => addMajor(choice, true)}>
                  Add as a minor
                </Button>
              </div>
            </div>
          ) : null}
          <Field label="Expected graduation year" className="mt-5 max-w-xs">
            {(id) => (
              <Select id={id} value={classYear} onChange={(e) => setClassYear(e.target.value)}>
                <option value="">Not set</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    Class of {y}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p className="mt-2 text-xs text-ink-3">
            Already graduated?{" "}
            <Link href="/settings/graduation" className="font-medium text-brand-600 hover:underline">
              Mark yourself as graduated
            </Link>
            .
          </p>
        </Card>
      ) : null}

      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-ink">About</h2>
        <p className="mt-1 text-sm text-ink-3">A few sentences about you: what you study, what you&apos;re into, what you want to build.</p>
        <div className="mt-4">
          <RichTextEditor defaultValue={user.aboutHtml} onChange={setAbout} variant="basic" minHeight={140} fileScope="user" ariaLabel="About you" placeholder="I'm a sophomore studying…" maxLength={5000} />
        </div>
        <Field label="LinkedIn profile" className="mt-5" hint="Optional. Your public LinkedIn link, like https://www.linkedin.com/in/your-name.">
          {(id) => <Input id={id} type="url" inputMode="url" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://www.linkedin.com/in/" maxLength={300} />}
        </Field>
      </Card>

      {error ? <Callout tone="danger">{error}</Callout> : null}
      <div className="sticky bottom-0 z-10 -mx-4 flex justify-end gap-2 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-surface/95">
        <Button type="submit" disabled={pending || uploading}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Save profile
        </Button>
      </div>
    </form>
  );
}
