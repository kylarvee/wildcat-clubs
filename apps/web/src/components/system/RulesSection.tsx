"use client";

import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import type { ConfigKey } from "@/lib/config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { withUnit } from "@/components/system/config-copy";
import { saveConfigAction } from "@/app/system/actions";

export type RuleField =
  | { kind: "int"; key: ConfigKey; label: string; help: string; unit: string; min: number; max: number; value: number; defaultValue: number }
  | { kind: "url"; key: ConfigKey; label: string; help: string; placeholder: string; value: string; defaultValue: string };

/** Which plain-words summary to show above the fields (computed from what's typed, so edits preview live). */
export type RuleSummary = "activity" | "reviews" | "checkin" | null;

type Values = Record<string, string>;

function fieldError(f: RuleField, raw: string): string | null {
  const v = raw.trim();
  if (f.kind === "url") {
    if (v === "") return null;
    return /^https:\/\/[^\s]+\.[^\s]+$/i.test(v) ? null : "Paste the full link, starting with https://";
  }
  if (v === "") return `Enter a number of ${f.unit}.`;
  if (!/^-?\d+$/.test(v)) return `Enter a whole number of ${f.unit}.`;
  const n = Number(v);
  if (n < f.min) return `Use at least ${withUnit(f.min, f.unit)}.`;
  if (n > f.max) return `Use at most ${withUnit(f.max, f.unit)}.`;
  return null;
}

/**
 * One group of platform rules, saved together. Validated here for quick
 * feedback and again on the server (lib/domain/system) before anything is written.
 */
export function RulesSection({
  id,
  title,
  description,
  fields,
  summary = null,
  lastChanged,
}: {
  id: string;
  title: string;
  description: ReactNode;
  fields: RuleField[];
  summary?: RuleSummary;
  lastChanged?: string | null;
}) {
  const initial = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, String(f.value)])) as Values, [fields]);
  const [saved, setSaved] = useState<Values>(initial);
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();
  const dirtyKeys = fields.filter((f) => values[f.key].trim() !== saved[f.key].trim()).map((f) => f.key);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: Record<string, string | null> = {};
    for (const f of fields) next[f.key] = fieldError(f, values[f.key]);
    setErrors(next);
    if (Object.values(next).some(Boolean)) {
      formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    if (!dirtyKeys.length) return;
    setFormError(null);
    setPending(true);
    try {
      const payload = Object.fromEntries(dirtyKeys.map((k) => [k, values[k].trim()]));
      const r = await saveConfigAction(payload);
      if (!r.ok) {
        setFormError(r.error);
        return;
      }
      setSaved({ ...values });
      toast.success(r.data.changed.length ? `${title} saved` : "Nothing changed");
    } catch {
      setFormError("We couldn't reach the server, so nothing was saved. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader title={title} description={description} />
      <form ref={formRef} onSubmit={submit} noValidate aria-busy={pending}>
        {summary ? <Summary kind={summary} values={values} /> : null}
        <div className="divide-y divide-line">
          {fields.map((f) => {
            const fid = `${uid}-${f.key}`;
            const err = errors[f.key];
            const isDefault = values[f.key].trim() === String(f.defaultValue);
            const savedDefault = saved[f.key].trim() === String(f.defaultValue);
            return (
              <div key={f.key} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_15rem] md:gap-6">
                <div className="min-w-0">
                  <label htmlFor={fid} className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {f.label}
                    {!savedDefault ? <Badge tone="brand">Changed from default</Badge> : null}
                  </label>
                  <p id={`${fid}-help`} className="mt-0.5 text-sm text-ink-3">
                    {f.help}
                  </p>
                </div>
                <div className="min-w-0">
                  <div className="relative">
                    <Input
                      id={fid}
                      name={f.key}
                      value={values[f.key]}
                      onChange={(e) => {
                        const v = e.target.value;
                        setValues((s) => ({ ...s, [f.key]: v }));
                        if (err) setErrors((s) => ({ ...s, [f.key]: null }));
                      }}
                      inputMode={f.kind === "int" ? "numeric" : "url"}
                      type={f.kind === "int" ? "text" : "url"}
                      placeholder={f.kind === "url" ? f.placeholder : undefined}
                      autoComplete="off"
                      aria-invalid={err ? true : undefined}
                      aria-describedby={`${fid}-help ${fid}-meta`}
                      className={cn(f.kind === "int" && "pr-20 tabular-nums")}
                    />
                    {f.kind === "int" ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">{f.unit}</span> : null}
                  </div>
                  <div id={`${fid}-meta`} className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                    {err ? (
                      <span className="text-danger">{err}</span>
                    ) : (
                      <span className="text-ink-3">
                        Default: {f.kind === "int" ? withUnit(f.defaultValue, f.unit) : f.defaultValue === "" ? "blank" : f.defaultValue}
                        {f.kind === "int" ? ` · allowed ${f.min}–${f.max}` : ""}
                      </span>
                    )}
                    {!isDefault ? (
                      <button
                        type="button"
                        onClick={() => {
                          setValues((s) => ({ ...s, [f.key]: String(f.defaultValue) }));
                          setErrors((s) => ({ ...s, [f.key]: null }));
                        }}
                        className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden /> Use default
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {formError ? (
          <div className="px-5 pb-1">
            <Callout tone="danger" title="Not saved">
              {formError}
            </Callout>
          </div>
        ) : null}
        <SectionFooter
          dirty={dirtyKeys.length}
          pending={pending}
          onDiscard={() => {
            setValues(saved);
            setErrors({});
            setFormError(null);
          }}
          lastChanged={lastChanged}
        />
      </form>
    </Card>
  );
}

export function SectionFooter({ dirty, pending, onDiscard, lastChanged, saveLabel = "Save changes" }: { dirty: number; pending: boolean; onDiscard: () => void; lastChanged?: string | null; saveLabel?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-muted/40 px-5 py-3">
      <p className="text-xs text-ink-3" aria-live="polite">
        {dirty ? <span className="font-medium text-warning">{`${dirty} unsaved change${dirty === 1 ? "" : "s"}`}</span> : (lastChanged ?? "Using the shipped defaults")}
      </p>
      <div className="flex gap-2">
        {dirty ? (
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={pending}>
            Discard
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={pending || !dirty}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {pending ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}

/** The section's rules in one sentence, from the values being edited. */
function Summary({ kind, values }: { kind: Exclude<RuleSummary, null>; values: Values }) {
  const n = (k: string) => {
    const v = values[k]?.trim();
    return v && /^\d+$/.test(v) ? Number(v) : null;
  };
  const u = (k: string, unit: string) => {
    const v = n(k);
    return v === null ? "…" : withUnit(v, unit);
  };
  let text: ReactNode = null;
  if (kind === "activity") {
    text = (
      <>
        A student is active in a club if they checked in within <b>{u("activity.studentWindowDays", "days")}</b> or came to one of its last <b>{u("activity.studentRecentEvents", "events")}</b>. A club is active with at
        least <b>{u("activity.clubMinEvents", "held events")}</b> in the current or previous term and <b>{u("activity.clubMinMembers", "registered members")}</b> (new clubs are exempt during their pilot period).
      </>
    );
  } else if (kind === "reviews") {
    const stars = n("reviews.bombingMaxRating");
    text = (
      <>
        Students can review a club after <b>{u("reviews.minAttendance", "events")}</b>. A review-bombing check opens when a club gets <b>{u("reviews.bombingCount", "ratings")}</b> of{" "}
        <b>{stars === null ? "…" : `${stars}★`}</b> or lower within <b>{u("reviews.bombingWindowHours", "hours")}</b>. A review reported by <b>{u("reviews.flagThreshold", "students")}</b> becomes an admin task.
      </>
    );
  } else {
    text = (
      <>
        Check-in runs from <b>{u("checkin.opensMinutesBefore", "minutes")}</b> before each event starts until <b>{u("checkin.closesMinutesAfter", "minutes")}</b> after it ends. The QR code changes every{" "}
        <b>{u("checkin.qrRotateSeconds", "seconds")}</b>.
      </>
    );
  }
  return (
    <p className="mx-5 mt-4 rounded-lg bg-brand-50/70 px-3 py-2.5 text-sm text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
      {text}
    </p>
  );
}
