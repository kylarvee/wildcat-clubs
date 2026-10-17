"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, BadgeCheck, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { SectionFooter } from "@/components/system/RulesSection";
import { confirmConfigAction, saveConfigAction } from "@/app/system/actions";

export type Office = { name: string; location: string; hours: string; email: string; phone: string; reviewDays: number };
export type Reviewer = { name: string; title: string; email: string };

type OfficeDraft = Omit<Office, "reviewDays"> & { reviewDays: string };
type ReviewerDraft = Reviewer & { rid: number };

const MAX_REVIEWERS = 12;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+\d][\d\s().\-x]{6,}$/i;

const toDraft = (o: Office): OfficeDraft => ({ ...o, reviewDays: String(o.reviewDays) });
let nextRid = 1;
const withIds = (list: Reviewer[]): ReviewerDraft[] => list.map((r) => ({ ...r, rid: nextRid++ }));
const strip = (list: ReviewerDraft[]) => list.map(({ name, title, email }) => ({ name: name.trim(), title: title.trim(), email: email.trim() }));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The WSUSA office and reviewers founders and funding requesters see. They
 * ship as placeholders, so the section stays flagged until a sysadmin saves
 * or confirms them.
 */
export function WsusaContactsForm({ office, reviewers, placeholder, lastChanged }: { office: Office; reviewers: Reviewer[]; placeholder: boolean; lastChanged: string | null }) {
  const [savedOffice, setSavedOffice] = useState(() => toDraft(office));
  const [savedReviewers, setSavedReviewers] = useState(() => strip(withIds(reviewers)));
  const [draft, setDraft] = useState(() => toDraft(office));
  const [list, setList] = useState<ReviewerDraft[]>(() => withIds(reviewers));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [flagged, setFlagged] = useState(placeholder);
  const formRef = useRef<HTMLFormElement>(null);

  const officeTrimmed = { ...draft, name: draft.name.trim(), location: draft.location.trim(), hours: draft.hours.trim(), email: draft.email.trim(), phone: draft.phone.trim(), reviewDays: draft.reviewDays.trim() };
  const officeDirty = !same(officeTrimmed, savedOffice);
  const reviewersDirty = !same(strip(list), savedReviewers);
  const dirty = Object.keys(draft).filter((k) => officeTrimmed[k as keyof OfficeDraft] !== savedOffice[k as keyof OfficeDraft]).length + (reviewersDirty ? 1 : 0);

  function setOffice<K extends keyof OfficeDraft>(k: K, v: string) {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors(({ [k]: _drop, ...rest }) => rest);
  }
  function setReviewer(rid: number, k: keyof Reviewer, v: string) {
    setList((l) => l.map((r) => (r.rid === rid ? { ...r, [k]: v } : r)));
    const ek = `r${rid}.${k}`;
    if (errors[ek]) setErrors(({ [ek]: _drop, ...rest }) => rest);
  }
  function move(i: number, by: -1 | 1) {
    setList((l) => {
      const j = i + by;
      if (j < 0 || j >= l.length) return l;
      const copy = [...l];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  function validate() {
    const e: Record<string, string> = {};
    if (officeTrimmed.name.length < 2) e.name = "Enter the office name.";
    if (officeTrimmed.email && !EMAIL.test(officeTrimmed.email)) e.email = "Enter a valid email address, or leave it blank.";
    if (officeTrimmed.phone && !PHONE.test(officeTrimmed.phone)) e.phone = "Enter a phone number like 801-626-0000, or leave it blank.";
    const days = officeTrimmed.reviewDays;
    if (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 90) e.reviewDays = "Enter a whole number of days from 1 to 90.";
    for (const r of list) {
      if (r.name.trim().length < 2) e[`r${r.rid}.name`] = "Enter their name.";
      if (!EMAIL.test(r.email.trim())) e[`r${r.rid}.email`] = "Enter a valid email address.";
    }
    return e;
  }

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    if (!dirty) return;
    setFormError(null);
    setPending(true);
    try {
      const payload: Record<string, unknown> = {};
      if (officeDirty) payload["wsusa.office"] = { ...officeTrimmed, reviewDays: Number(officeTrimmed.reviewDays) };
      if (reviewersDirty) payload["wsusa.reviewers"] = strip(list);
      const r = await saveConfigAction(payload);
      if (!r.ok) {
        setFormError(r.error);
        return;
      }
      setSavedOffice(officeTrimmed);
      setSavedReviewers(strip(list));
      // Saving the section means someone checked all of it, including the part they didn't edit.
      if (flagged) {
        const c = await confirmConfigAction(["wsusa.office", "wsusa.reviewers"]);
        if (c.ok) setFlagged(false);
      }
      toast.success(r.data.changed.length ? "WSUSA contacts saved" : "Nothing changed");
    } catch {
      setFormError("We couldn't reach the server, so nothing was saved. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    setConfirming(true);
    try {
      const r = await confirmConfigAction(["wsusa.office", "wsusa.reviewers"]);
      if (!r.ok) return void toast.error(r.error);
      setFlagged(false);
      toast.success("Marked as confirmed");
    } catch {
      toast.error("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setConfirming(false);
    }
  }

  const err = (k: string) => errors[k];

  return (
    <Card id="wsusa" className="scroll-mt-24">
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            WSUSA contacts
            {flagged ? (
              <Badge tone="warning">
                <TriangleAlert className="h-3 w-3" aria-hidden /> Placeholder
              </Badge>
            ) : (
              <Badge tone="success">
                <BadgeCheck className="h-3 w-3" aria-hidden /> Confirmed
              </Badge>
            )}
          </span>
        }
        description="Shown to founders after they submit a club for review, and to leaders requesting funding: the office, where to find it, how long a review usually takes, and who to contact."
      />
      <form ref={formRef} onSubmit={submit} noValidate aria-busy={pending}>
        <div className="space-y-6 px-5 py-4">
          {flagged ? (
            <Callout tone="warning" title="Placeholder details — confirm them with WSUSA before launch">
              <p>These shipped with the platform and nobody has checked them yet. Confirm the office location, hours, email, phone number and reviewers with WSUSA, then save your corrections.</p>
              {!dirty ? (
                <Button size="sm" variant="outline" className="mt-2 bg-surface" onClick={confirm} disabled={confirming}>
                  {confirming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BadgeCheck className="h-4 w-4" aria-hidden />}
                  These details are correct
                </Button>
              ) : null}
            </Callout>
          ) : null}

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-ink">Review office</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Office name" required error={err("name")}>
                {(id) => <Input id={id} value={draft.name} onChange={(e) => setOffice("name", e.target.value)} maxLength={120} aria-invalid={err("name") ? true : undefined} />}
              </Field>
              <Field label="Where to find it" hint="Building and room, as students would say it.">
                {(id) => <Input id={id} value={draft.location} onChange={(e) => setOffice("location", e.target.value)} maxLength={200} />}
              </Field>
              <Field label="Office hours">{(id) => <Input id={id} value={draft.hours} onChange={(e) => setOffice("hours", e.target.value)} maxLength={120} />}</Field>
              <Field label="Typical review time" required error={err("reviewDays")} hint="Business days founders should expect to wait.">
                {(id) => (
                  <div className="relative">
                    <Input id={id} value={draft.reviewDays} inputMode="numeric" onChange={(e) => setOffice("reviewDays", e.target.value)} className="pr-14 tabular-nums" aria-invalid={err("reviewDays") ? true : undefined} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">days</span>
                  </div>
                )}
              </Field>
              <Field label="Email" error={err("email")}>
                {(id) => <Input id={id} type="email" value={draft.email} onChange={(e) => setOffice("email", e.target.value)} maxLength={200} autoComplete="off" aria-invalid={err("email") ? true : undefined} />}
              </Field>
              <Field label="Phone" error={err("phone")} hint="Optional.">
                {(id) => <Input id={id} type="tel" value={draft.phone} onChange={(e) => setOffice("phone", e.target.value)} maxLength={40} placeholder="801-626-0000" aria-invalid={err("phone") ? true : undefined} />}
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">Reviewers</legend>
            <p className="text-sm text-ink-3">The people founders can contact about a submission, in the order shown.</p>
            {list.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-line-2 px-4 py-5 text-center text-sm text-ink-3">No reviewers listed. Founders will see the office contact only.</p>
            ) : (
              <ol className="mt-3 space-y-3" data-reviewers>
                {list.map((r, i) => (
                  <li key={r.rid} className="rounded-xl border border-line p-3 sm:p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Reviewer {i + 1}</p>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move reviewer ${i + 1} up`}>
                          <ArrowUp className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Move reviewer ${i + 1} down`}>
                          <ArrowDown className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-danger hover:bg-danger-50 hover:text-danger"
                          onClick={() => setList((l) => l.filter((x) => x.rid !== r.rid))}
                          aria-label={`Remove reviewer ${i + 1}${r.name ? ` (${r.name})` : ""}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Name" required error={err(`r${r.rid}.name`)}>
                        {(id) => <Input id={id} value={r.name} onChange={(e) => setReviewer(r.rid, "name", e.target.value)} maxLength={80} aria-invalid={err(`r${r.rid}.name`) ? true : undefined} />}
                      </Field>
                      <Field label="Title">{(id) => <Input id={id} value={r.title} onChange={(e) => setReviewer(r.rid, "title", e.target.value)} maxLength={120} />}</Field>
                      <Field label="Email" required error={err(`r${r.rid}.email`)}>
                        {(id) => <Input id={id} type="email" value={r.email} onChange={(e) => setReviewer(r.rid, "email", e.target.value)} maxLength={200} autoComplete="off" aria-invalid={err(`r${r.rid}.email`) ? true : undefined} />}
                      </Field>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={list.length >= MAX_REVIEWERS}
              onClick={() => {
                setList((l) => [...l, { rid: nextRid++, name: "", title: "", email: "" }]);
                // Focus the new row's name once it renders.
                requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>("[data-reviewers] > li:last-child input")?.focus());
              }}
            >
              <Plus className="h-4 w-4" aria-hidden /> Add reviewer
            </Button>
            {list.length >= MAX_REVIEWERS ? <p className="mt-1 text-xs text-ink-3">Up to {MAX_REVIEWERS} reviewers.</p> : null}
          </fieldset>
        </div>
        {formError ? (
          <div className="px-5 pb-4">
            <Callout tone="danger" title="Not saved">
              {formError}
            </Callout>
          </div>
        ) : null}
        <SectionFooter
          dirty={dirty}
          pending={pending}
          lastChanged={lastChanged}
          onDiscard={() => {
            setDraft(savedOffice);
            setList(withIds(savedReviewers));
            setErrors({});
            setFormError(null);
          }}
        />
      </form>
    </Card>
  );
}
