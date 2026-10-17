"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, EyeOff, Loader2, Send, UserRound } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { SearchSelect, type SearchOption } from "@/components/founding/SearchSelect";
import { COMPLAINT_CATEGORIES } from "@/components/admin/complaint-copy";
import { CaseCode } from "@/app/report/_components/CaseCode";
import { submitComplaintAction } from "@/app/report/actions";

const MAX_BODY = 5000;

type Receipt = { caseCode: string; isAnonymous: boolean };
type Errors = Partial<Record<"category" | "subject" | "body" | "anonymous" | "form", string>>;

/**
 * The one input tool for reports. Anonymous reports are stored with no link
 * to the person; the case code shown afterwards is their only receipt.
 */
export function ReportForm({ clubs, today, reporter }: { clubs: SearchOption[]; today: string; reporter: { name: string; email: string } }) {
  const [category, setCategory] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState<boolean | null>(null);
  const [clubId, setClubId] = useState<string | null>(null);
  const [bodyLength, setBodyLength] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const ids = { category: useId(), anon: useId(), body: useId(), form: useId(), club: useId() };

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const subject = String(fd.get("subject") ?? "").trim();
    const body = String(fd.get("body") ?? "").trim();
    const incidentDate = String(fd.get("incidentDate") ?? "") || null;
    const next: Errors = {};
    if (!category) next.category = "Pick the kind of concern.";
    if (subject.length < 5) next.subject = "Give your report a short subject (at least 5 characters).";
    if (body.length < 20) next.body = "Tell us a little more about what happened (at least 20 characters).";
    if (anonymous === null) next.anonymous = "Choose whether to report anonymously or with your name.";
    setErrors(next);
    if (Object.keys(next).length) {
      const first = formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']");
      first?.focus();
      return;
    }
    start(async () => {
      try {
        const r = await submitComplaintAction({ category: category!, subject, body, clubId, incidentDate, anonymous: anonymous! });
        if (!r.ok) return setErrors({ form: r.error });
        setReceipt(r.data);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        setErrors({ form: "We couldn't reach the server, so your report wasn't sent. Check your connection and try again." });
      }
    });
  }

  function startOver() {
    setReceipt(null);
    setCategory(null);
    setAnonymous(null);
    setClubId(null);
    setBodyLength(0);
    setErrors({});
  }

  if (receipt) return <SentReceipt receipt={receipt} onAnother={startOver} />;

  return (
    <form ref={formRef} onSubmit={submit} noValidate aria-busy={pending} aria-describedby={errors.form ? ids.form : undefined} className="space-y-6">
      <fieldset aria-describedby={errors.category ? ids.category : undefined}>
        <legend className="text-sm font-medium text-ink">
          What kind of concern is it?<span className="text-danger"> *</span>
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {COMPLAINT_CATEGORIES.map((c, i) => (
            <label
              key={c.value}
              className={cn(
                "flex cursor-pointer gap-3 rounded-xl border bg-surface p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-brand-100",
                category === c.value ? "border-brand bg-brand-50/60" : "border-line-2 hover:bg-muted/60",
              )}
            >
              <input
                type="radio"
                name="category"
                value={c.value}
                checked={category === c.value}
                onChange={() => {
                  setCategory(c.value);
                  setErrors((e) => ({ ...e, category: undefined }));
                }}
                aria-invalid={i === 0 && errors.category ? true : undefined}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
              />
              <span>
                <span className="block font-medium text-ink">{c.value}</span>
                <span className="block text-ink-3">{c.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.category ? (
          <p id={ids.category} className="mt-1.5 text-xs text-danger">
            {errors.category}
          </p>
        ) : null}
      </fieldset>

      <Field label="Subject" required error={errors.subject} hint="A few words, like “Pressure to drink at the initiation night”.">
        {(id) => <Input id={id} name="subject" maxLength={140} autoComplete="off" aria-invalid={errors.subject ? true : undefined} onChange={() => errors.subject && setErrors((e) => ({ ...e, subject: undefined }))} />}
      </Field>

      <div className="space-y-1.5">
        <label htmlFor={ids.body} className="block text-sm font-medium text-ink">
          What happened?<span className="text-danger"> *</span>
        </label>
        <Textarea
          id={ids.body}
          name="body"
          rows={8}
          maxLength={MAX_BODY}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={`${ids.body}-hint`}
          onChange={(e) => {
            setBodyLength(e.target.value.length);
            if (errors.body) setErrors((x) => ({ ...x, body: undefined }));
          }}
        />
        <div id={`${ids.body}-hint`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs">
          {errors.body ? (
            <span className="text-danger">{errors.body}</span>
          ) : (
            <span className="text-ink-3">What happened, when and where, and who was involved if you know. If you're reporting anonymously, leave out details that would identify you.</span>
          )}
          <span className={cn("tabular-nums", bodyLength > MAX_BODY - 200 ? "text-warning" : "text-ink-3")}>
            {bodyLength.toLocaleString()} / {MAX_BODY.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={ids.club} className="block text-sm font-medium text-ink">
            Club involved <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <SearchSelect id={ids.club} options={clubs} value={clubId} onChange={setClubId} placeholder="Search clubs…" describedBy={`${ids.club}-hint`} />
          <p id={`${ids.club}-hint`} className="text-xs text-ink-3">
            Leave blank if it isn&rsquo;t about one club.
          </p>
        </div>
        <Field label={<>When did it happen? <span className="font-normal text-ink-3">(optional)</span></>} hint="Your best guess is fine.">
          {(id) => <Input id={id} name="incidentDate" type="date" max={today} min="2000-01-01" />}
        </Field>
      </div>

      <fieldset aria-describedby={errors.anonymous ? ids.anon : undefined}>
        <legend className="text-sm font-medium text-ink">
          How do you want to report?<span className="text-danger"> *</span>
        </legend>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <ChoiceCard
            checked={anonymous === true}
            onSelect={() => {
              setAnonymous(true);
              setErrors((e) => ({ ...e, anonymous: undefined }));
            }}
            invalid={Boolean(errors.anonymous)}
            icon={<EyeOff className="h-5 w-5" aria-hidden />}
            title="Anonymous"
            value="anonymous"
          >
            We don&rsquo;t store who you are — not even administrators can see it. Save your case code to check the status.
          </ChoiceCard>
          <ChoiceCard
            checked={anonymous === false}
            onSelect={() => {
              setAnonymous(false);
              setErrors((e) => ({ ...e, anonymous: undefined }));
            }}
            icon={<UserRound className="h-5 w-5" aria-hidden />}
            title="With my name"
            value="named"
          >
            Administrators can follow up with you. You&rsquo;ll see its status under My reports.
            <span className="mt-1 block text-xs text-ink-3">
              Sent as {reporter.name} ({reporter.email})
            </span>
          </ChoiceCard>
        </div>
        {errors.anonymous ? (
          <p id={ids.anon} className="mt-1.5 text-xs text-danger">
            {errors.anonymous}
          </p>
        ) : null}
      </fieldset>

      {errors.form ? (
        <div id={ids.form}>
          <Callout tone="danger" title="Your report wasn't sent">
            {errors.form}
          </Callout>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          {pending ? "Sending…" : "Send report"}
        </Button>
        <p className="text-sm text-ink-3">Only WSUSA administrators can read reports.</p>
      </div>
    </form>
  );
}

function ChoiceCard({
  checked,
  onSelect,
  invalid,
  icon,
  title,
  value,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  invalid?: boolean;
  icon: React.ReactNode;
  title: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-xl border bg-surface p-4 text-sm transition-colors focus-within:ring-2 focus-within:ring-brand-100",
        checked ? "border-brand bg-brand-50/60" : invalid ? "border-red-300" : "border-line-2 hover:bg-muted/60",
      )}
    >
      <input type="radio" name="anonymity" value={value} checked={checked} onChange={onSelect} aria-invalid={invalid ? true : undefined} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand)]" />
      <span className="min-w-0">
        <span className="flex items-center gap-2 font-semibold text-ink">
          <span className="text-brand">{icon}</span>
          {title}
        </span>
        <span className="mt-1 block text-ink-2">{children}</span>
      </span>
    </label>
  );
}

function SentReceipt({ receipt, onAnother }: { receipt: Receipt; onAnother: () => void }) {
  return (
    <Card className="p-5 sm:p-6" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">Your report was sent</h2>
          <p className="mt-1 text-sm text-ink-2">
            {receipt.isAnonymous
              ? "WSUSA administrators will review it. Nothing about who sent it was stored."
              : "WSUSA administrators will review it and may follow up with you. You can follow its status under My reports."}
          </p>
        </div>
      </div>
      <div className="mt-5">
        <CaseCode code={receipt.caseCode} />
      </div>
      {receipt.isAnonymous ? (
        <Callout tone="warning" title="Save this code now" className="mt-4">
          Because your report is anonymous, it isn&rsquo;t linked to you. We can&rsquo;t show this code again or look it up for you — it&rsquo;s the only way to check the status.
        </Callout>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/report/status" className={buttonClasses("primary")}>
          Check a report&rsquo;s status
        </Link>
        <Button variant="outline" onClick={onAnother}>
          Report something else
        </Button>
      </div>
    </Card>
  );
}
