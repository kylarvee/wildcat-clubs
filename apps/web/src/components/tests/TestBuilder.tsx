"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { QuestionType, TestAudience, TestRecurrence, TestStatus } from "@prisma/client";
import { AlertCircle, Archive, Copy, Eye, Loader2, Plus, Rocket, Save, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { RichTextEditor } from "@/components/rich/RichTextEditor";
import { NumberInput } from "@/components/tests/NumberInput";
import { PeopleChooser } from "@/components/tests/PeopleChooser";
import { QuestionCard, type BuilderQuestion } from "@/components/tests/QuestionCard";
import { archiveTestAction, deleteTestAction, duplicateTestAction, publishTestAction, saveTestAction } from "@/components/tests/actions";
import { scopeKind, type TestScope } from "@/components/tests/scope";
import type { TestPersonOption } from "@/lib/domain/tests";
import { blankQuestion, LIMITS, testProblems, totalPoints, type EditorTest, type Problem } from "@/lib/tests/editor";
import {
  actionLabel,
  audienceDescription,
  audienceLabel,
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  CLUB_AUDIENCES,
  RECURRENCE_LABEL,
  TRIGGER_LABEL,
  UNIVERSITY_AUDIENCES,
  type Automation,
} from "@/lib/tests/types";
import { parseCampusLocal, toCampusLocal } from "@/lib/roles/datetime";

type Settings = Omit<EditorTest, "questions">;

const ADD_TYPES: { type: QuestionType; label: string }[] = [
  { type: "SINGLE_CHOICE", label: "One answer" },
  { type: "MULTI_CHOICE", label: "Several answers" },
  { type: "SHORT_ANSWER", label: "Short answer" },
  { type: "LONG_ANSWER", label: "Long answer" },
];

const RECURRENCES: TestRecurrence[] = ["ONE_OFF", "WEEKLY", "MONTHLY", "SEMESTER", "ACADEMIC_YEAR", "ANNUAL"];

const ROUND_WORD: Record<TestRecurrence, string> = {
  ONE_OFF: "",
  WEEKLY: "each week",
  MONTHLY: "each month",
  SEMESTER: "each semester",
  ACADEMIC_YEAR: "each academic year",
  ANNUAL: "each calendar year",
};

let tempCounter = 0;
function tempId() {
  tempCounter += 1;
  return `new-${Date.now().toString(36)}${tempCounter}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The Test Tool builder: one editor for WSUSA's university tests and clubs'
 * own tests. Everything saves together; the problems list mirrors the checks
 * the server runs before publishing (lib/tests/editor.testProblems).
 */
export function TestBuilder({
  scope,
  testId,
  status,
  initial,
  initialPeople,
  requirementNames,
  renewalLabel,
  attemptCount,
  aiOn,
}: {
  scope: TestScope;
  testId: string;
  status: TestStatus;
  initial: EditorTest;
  initialPeople: TestPersonOption[];
  /** Active officer requirements that use this test. */
  requirementNames: string[];
  /** For officer-requirement tests: how the requirement renews, in words. */
  renewalLabel: string | null;
  attemptCount: number;
  aiOn: boolean;
}) {
  const router = useRouter();
  const kind = scopeKind(scope);
  const { questions: initialQuestions, ...initialSettings } = initial;
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [questions, setQuestions] = useState<BuilderQuestion[]>(() => initialQuestions.map((q) => ({ ...q, key: q.id })));
  const [people, setPeople] = useState<TestPersonOption[]>(initialPeople);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<null | "save" | "publish" | "preview" | "archive" | "duplicate" | "delete">(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);
  const questionsEnd = useRef<HTMLDivElement>(null);

  const payload: EditorTest = useMemo(
    () => ({ ...settings, selectedUserIds: people.map((p) => p.id), questions: questions.map(({ key: _key, ...q }) => q) }),
    [settings, people, questions],
  );
  const problems = useMemo(() => testProblems(payload, kind), [payload, kind]);
  const generalProblems = problems.filter((p) => !p.questionId);
  const audiences = kind === "club" ? CLUB_AUDIENCES : UNIVERSITY_AUDIENCES;
  const requirementLocked = requirementNames.length > 0;
  const live = status === "PUBLISHED";

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setDirty(true);
  }, []);

  const changeQuestions = useCallback((fn: (qs: BuilderQuestion[]) => BuilderQuestion[]) => {
    setQuestions(fn);
    setDirty(true);
  }, []);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = useCallback(async (): Promise<boolean> => {
    setServerError(null);
    const r = await saveTestAction(testId, payload).catch(() => null);
    if (!r) {
      setServerError("We couldn't reach the server. Your changes are still here — try saving again.");
      return false;
    }
    if (!r.ok) {
      setServerError(r.error);
      return false;
    }
    const ids = r.data.questionIds;
    setQuestions((qs) => qs.map((q) => ({ ...q, id: ids[q.id] ?? q.id })));
    setDirty(false);
    return true;
  }, [payload, testId]);

  const run = (what: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(what);
    startTransition(async () => {
      try {
        await fn();
      } finally {
        setBusy(null);
      }
    });
  };

  const onSave = () =>
    run("save", async () => {
      if (await save()) toast.success(live ? "Saved. Changes are live for anyone who starts the test from now on." : "Draft saved.");
    });

  // Ctrl/Cmd+S saves.
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onPublish = () => {
    if (problems.length) {
      setShowProblems(true);
      toast.error(`Fix ${problems.length === 1 ? "1 thing" : `${problems.length} things`} before publishing.`);
      return;
    }
    run("publish", async () => {
      if (dirty && !(await save())) return;
      const r = await publishTestAction(testId).catch(() => null);
      if (!r) return setServerError("We couldn't reach the server. Try publishing again.");
      if (!r.ok) return setServerError(r.error);
      toast.success(
        r.data.assigned
          ? `Published. ${r.data.assigned} ${r.data.assigned === 1 ? "person was" : "people were"} assigned and notified.`
          : status === "ARCHIVED"
            ? "Reopened. People can take it again."
            : "Published. People can take it now.",
      );
      router.refresh();
    });
  };

  const onPreview = () =>
    run("preview", async () => {
      if (dirty && !(await save())) return;
      router.push(`${scope.basePath}/${testId}/preview`);
    });

  const onArchive = () =>
    run("archive", async () => {
      if (dirty && !(await save())) return;
      const r = await archiveTestAction(testId);
      if (!r.ok) return setServerError(r.error);
      toast.success("Archived. Open assignments were excused; results stay available.");
      router.refresh();
    });

  const onDuplicate = () =>
    run("duplicate", async () => {
      if (dirty && !(await save())) return;
      const r = await duplicateTestAction(testId);
      if (!r.ok) return setServerError(r.error);
      toast.success("Copy created as a draft.");
      router.push(`${scope.basePath}/${r.data.id}`);
    });

  const onDelete = () =>
    run("delete", async () => {
      const r = await deleteTestAction(testId);
      if (!r.ok) return setServerError(r.error);
      setDirty(false);
      toast.success("Draft deleted.");
      router.push(scope.basePath);
    });

  const addQuestion = (type: QuestionType) => {
    const id = tempId();
    changeQuestions((qs) => [...qs, { ...blankQuestion(type, id), key: id }]);
    // Bring the new question into view once it renders.
    setTimeout(() => questionsEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
  };

  const timeLimited = settings.timeLimitMinutes !== null;
  const assigned = settings.audience === "CLUB_MEMBERS" || settings.audience === "ALL_STUDENTS" || settings.audience === "SELECTED_USERS";
  const isRequirement = settings.audience === "ROLE_REQUIREMENT";
  const oneOff = settings.recurrence === "ONE_OFF";
  const closes = settings.closesAt ? new Date(settings.closesAt) : null;

  return (
    <div className="space-y-6 pb-4">
      {live && attemptCount > 0 ? (
        <Callout tone="info" title="This test is live">
          {attemptCount} {attemptCount === 1 ? "attempt has" : "attempts have"} been taken. Edits apply to anyone who starts it from now on. Questions people have answered can be reworded but not deleted — make a copy for bigger changes.
        </Callout>
      ) : null}

      <Card>
        <CardHeader title="Basics" description="The title people see in their tasks and on the test page." />
        <CardBody>
          <Field label="Title" required error={generalProblems.find((p) => p.field === "title")?.message}>
            {(id) => <Input id={id} value={settings.title} maxLength={LIMITS.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Event Safety Quiz" />}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Intro page" description="What people read before they start: instructions, the policy they're tested on, a video. Paste a YouTube or Google Drive link to embed it." />
        <CardBody>
          <RichTextEditor
            defaultValue={initial.introHtml}
            onChange={(html) => update("introHtml", html)}
            clubId={scope.clubId}
            fileScope={kind === "club" ? "club" : "university"}
            variant="full"
            minHeight={200}
            ariaLabel="Intro page"
            placeholder="Explain what this test covers and anything people should read or watch first…"
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Timing & scoring" />
        <CardBody className="grid gap-6 md:grid-cols-3">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink">Time limit</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="time-limit" className="accent-[var(--color-brand)]" checked={!timeLimited} onChange={() => update("timeLimitMinutes", null)} />
              No time limit
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="time-limit" className="accent-[var(--color-brand)]" checked={timeLimited} onChange={() => update("timeLimitMinutes", settings.timeLimitMinutes ?? 30)} />
              Limit to
            </label>
            {timeLimited ? (
              <div className="flex items-center gap-2 pl-6">
                <NumberInput value={settings.timeLimitMinutes ?? 30} onValue={(n) => update("timeLimitMinutes", n)} min={1} max={LIMITS.timeLimit} className="w-24" aria-label="Time limit in minutes" />
                <span className="text-sm text-ink-2">minutes</span>
              </div>
            ) : (
              <p className="pl-6 text-xs text-ink-3">The clock still runs, so you'll see how long people took.</p>
            )}
            <ProblemText problems={generalProblems} field="timeLimit" />
          </fieldset>

          <div className="space-y-2">
            <Field label="Passing score" hint="Out of all points on the test.">
              {(id) => (
                <div className="flex items-center gap-2">
                  <NumberInput id={id} value={settings.passingPercent} onValue={(n) => update("passingPercent", n)} min={1} max={100} className="w-24" />
                  <span className="text-sm text-ink-2">%</span>
                </div>
              )}
            </Field>
            <ProblemText problems={generalProblems} field="passing" />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink">Attempts{oneOff ? "" : " per round"}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="attempts" className="accent-[var(--color-brand)]" checked={settings.maxAttempts === null} onChange={() => update("maxAttempts", null)} />
              Unlimited
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="attempts" className="accent-[var(--color-brand)]" checked={settings.maxAttempts !== null} onChange={() => update("maxAttempts", settings.maxAttempts ?? 3)} />
              Up to
            </label>
            {settings.maxAttempts !== null ? (
              <div className="flex items-center gap-2 pl-6">
                <NumberInput value={settings.maxAttempts} onValue={(n) => update("maxAttempts", n)} min={1} max={LIMITS.attempts} className="w-24" aria-label="Maximum attempts" />
                <span className="text-sm text-ink-2">{settings.maxAttempts === 1 ? "attempt" : "attempts"}</span>
              </div>
            ) : null}
            <ProblemText problems={generalProblems} field="attempts" />
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Who takes it" description={kind === "club" ? "Club tests are for your members, or anyone with the link." : "University tests can be officer requirements, campus-wide, or for people you pick."} />
        <CardBody className="space-y-4">
          {requirementLocked ? (
            <Callout tone="brand" title="Used by an officer requirement">
              {requirementNames.join(", ")} {requirementNames.length === 1 ? "uses" : "use"} this test, so its audience stays “Student leaders”. Turn the requirement off in Officer requirements to change it.
            </Callout>
          ) : null}
          <fieldset>
            <legend className="sr-only">Audience</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {audiences.map((a) => {
                const disabled = requirementLocked && a !== "ROLE_REQUIREMENT";
                const checked = settings.audience === a;
                return (
                  <label
                    key={a}
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors",
                      checked ? "border-brand bg-brand-50/60 ring-1 ring-brand" : "border-line hover:bg-muted/50",
                      disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <input type="radio" name="audience" className="mt-1 accent-[var(--color-brand)]" checked={checked} disabled={disabled} onChange={() => update("audience", a as TestAudience)} />
                    <span>
                      <span className="block text-sm font-medium text-ink">{audienceLabel(a, kind)}</span>
                      <span className="block text-xs leading-relaxed text-ink-3">{audienceDescription(a, kind)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <ProblemText problems={generalProblems} field="audience" />
          {settings.audience === "SELECTED_USERS" ? (
            <div className="rounded-xl border border-line p-4">
              <PeopleChooser
                clubId={scope.clubId}
                selected={people}
                onChange={(p) => {
                  setPeople(p);
                  setDirty(true);
                }}
              />
            </div>
          ) : null}
          {isRequirement && !requirementLocked ? (
            <p className="text-sm text-ink-3">
              Next, attach this test to a role in{" "}
              <Link href="/admin/requirements" className="font-medium text-brand-600 underline-offset-2 hover:underline">
                Officer requirements
              </Link>{" "}
              once it&apos;s published. Until then nobody is asked to take it.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Schedule" description={isRequirement ? undefined : "One time, or a fresh round on a schedule. Each round, people take it again."} />
        <CardBody className="space-y-4">
          {isRequirement ? (
            <p className="text-sm text-ink-2">
              Renews with the officer requirement{renewalLabel ? <> ({renewalLabel.toLowerCase()})</> : null}. Deadlines come from the requirement&apos;s grace period, counted from when someone takes their role.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="How often">
                  {(id) => (
                    <Select id={id} value={settings.recurrence} onChange={(e) => update("recurrence", e.target.value as TestRecurrence)}>
                      {RECURRENCES.map((r) => (
                        <option key={r} value={r}>
                          {RECURRENCE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {assigned && !(oneOff && closes) ? (
                  <Field label={oneOff ? "Days to finish" : "Days to finish each round"} hint={oneOff ? "Counted from when each person is assigned." : `Counted from when the round starts or the person joins, never past the end of the round.`}>
                    {(id) => (
                      <div className="flex items-center gap-2">
                        <NumberInput id={id} value={settings.dueDays} onValue={(n) => update("dueDays", n)} min={1} max={LIMITS.dueDays} className="w-24" />
                        <span className="text-sm text-ink-2">{settings.dueDays === 1 ? "day" : "days"}</span>
                      </div>
                    )}
                  </Field>
                ) : null}
              </div>
              <ProblemText problems={generalProblems} field="due" />
              {oneOff ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-ink">Closing time</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" name="closes" className="accent-[var(--color-brand)]" checked={!closes} onChange={() => update("closesAt", null)} />
                    Stays open
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="closes"
                      className="accent-[var(--color-brand)]"
                      checked={Boolean(closes)}
                      onChange={() => update("closesAt", new Date(Date.now() + 14 * 86_400_000).toISOString())}
                    />
                    Closes on a date (everyone&apos;s deadline)
                  </label>
                  {closes ? (
                    <div className="pl-6">
                      <Input
                        type="datetime-local"
                        aria-label="Closing date and time (campus time)"
                        className="w-auto"
                        value={toCampusLocal(closes)}
                        onChange={(e) => {
                          const d = parseCampusLocal(e.target.value);
                          if (d) update("closesAt", d.toISOString());
                        }}
                      />
                      <p className="mt-1 text-xs text-ink-3">Campus time (Ogden). After this, nobody can start the test.</p>
                    </div>
                  ) : null}
                </fieldset>
              ) : (
                <p className="text-sm text-ink-3">
                  A new round starts {ROUND_WORD[settings.recurrence]}.{" "}
                  {assigned ? "Everyone in the audience is assigned again, and anyone who doesn't finish in time is marked as missed." : "Anyone can take it once more each round."}
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <AutomationsCard
        automations={settings.automations}
        onChange={(a) => update("automations", a)}
        kind={kind}
        showGate={kind === "university"}
        showMissed={assigned || isRequirement}
      />

      <section aria-labelledby="questions-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="questions-heading" className="text-lg font-semibold text-ink">
              Questions
            </h2>
            <p className="text-sm text-ink-3">
              {questions.length} {questions.length === 1 ? "question" : "questions"} · {totalPoints(payload)} {totalPoints(payload) === 1 ? "point" : "points"} · multiple choice is scored instantly; written answers wait for a reviewer.
            </p>
          </div>
        </div>
        <ProblemText problems={generalProblems} field="questions" />
        {questions.map((q, i) => (
          <QuestionCard
            key={q.key}
            question={q}
            index={i}
            total={questions.length}
            clubId={scope.clubId}
            aiOn={aiOn}
            problems={problems.filter((p) => p.questionId === q.id)}
            onChange={(next) => changeQuestions((qs) => qs.map((x) => (x.key === q.key ? next : x)))}
            onMove={(dir) =>
              changeQuestions((qs) => {
                const j = i + dir;
                if (j < 0 || j >= qs.length) return qs;
                const copy = [...qs];
                [copy[i], copy[j]] = [copy[j], copy[i]];
                return copy;
              })
            }
            onDuplicate={() => {
              const id = tempId();
              changeQuestions((qs) => {
                const copy = [...qs];
                copy.splice(i + 1, 0, { ...q, id, key: id, answerCount: 0, options: q.options.map((o) => ({ ...o })), correctOptionIds: [...q.correctOptionIds] });
                return copy;
              });
            }}
            onDelete={() => changeQuestions((qs) => qs.filter((x) => x.key !== q.key))}
          />
        ))}
        <div ref={questionsEnd} className="rounded-xl border border-dashed border-line-2 bg-surface p-4">
          <p className="mb-2 text-sm font-medium text-ink">Add a question</p>
          <div className="flex flex-wrap gap-2">
            {ADD_TYPES.map((a) => (
              <Button key={a.type} variant="outline" size="sm" onClick={() => addQuestion(a.type)} disabled={questions.length >= LIMITS.questions}>
                <Plus className="h-4 w-4" aria-hidden /> {a.label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      {/* Sticky action bar at the bottom, so it never covers the editors' sticky toolbars. */}
      <div className="sticky bottom-0 z-20 -mx-1 rounded-t-2xl border border-line bg-surface/95 px-4 py-3 shadow-[var(--shadow-pop)] backdrop-blur">
        {serverError ? (
          <p role="alert" className="mb-2 flex items-start gap-2 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {serverError}
          </p>
        ) : null}
        {showProblems && problems.length ? (
          <div className="mb-3 max-h-40 overflow-y-auto rounded-lg bg-warning-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-medium">Before this can be published:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-ink-3" aria-live="polite">
            {busy === "save" ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
            {problems.length ? (
              <>
                {" · "}
                <button type="button" className="font-medium text-warning underline-offset-2 hover:underline" onClick={() => setShowProblems((v) => !v)} aria-expanded={showProblems}>
                  {problems.length} {problems.length === 1 ? "thing" : "things"} to finish
                </button>
              </>
            ) : null}
          </p>
          <Button variant="ghost" size="sm" onClick={onDuplicate} disabled={pending}>
            {busy === "duplicate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" aria-hidden />} Copy
          </Button>
          {status === "DRAFT" ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirm("delete")} disabled={pending} className="text-danger hover:text-danger">
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </Button>
          ) : status === "PUBLISHED" ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirm("archive")} disabled={pending}>
              <Archive className="h-4 w-4" aria-hidden /> Archive
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onPreview} disabled={pending}>
            {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" aria-hidden />} Preview
          </Button>
          <Button variant={live ? "primary" : "outline"} size="sm" onClick={onSave} disabled={pending || !dirty}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" aria-hidden />} Save
          </Button>
          {!live ? (
            <Button size="sm" onClick={onPublish} disabled={pending}>
              {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" aria-hidden />} {status === "ARCHIVED" ? "Reopen" : "Publish"}
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Archive this test?"
        description="Nobody can start it anymore, and anyone who still owes it is excused. Results and grading stay available, and you can reopen it later."
        confirmLabel="Archive test"
        onConfirm={() => {
          setConfirm(null);
          onArchive();
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this draft?"
        description="The test and its questions are removed for good. This can't be undone."
        confirmLabel="Delete draft"
        danger
        onConfirm={() => {
          setConfirm(null);
          onDelete();
        }}
      />
    </div>
  );
}

function ProblemText({ problems, field }: { problems: Problem[]; field: string }) {
  const p = problems.find((x) => x.field === field);
  return p ? <p className="text-xs text-danger">{p.message}</p> : null;
}

function AutomationsCard({
  automations,
  onChange,
  kind,
  showGate,
  showMissed,
}: {
  automations: Automation[];
  onChange: (a: Automation[]) => void;
  kind: "club" | "university";
  showGate: boolean;
  showMissed: boolean;
}) {
  const triggers = AUTOMATION_TRIGGERS.filter((t) => t !== "MISSED_DEADLINE" || showMissed || automations.some((a) => a.trigger === t));
  const used = new Set(automations.map((a) => `${a.trigger}:${a.action}`));
  const nextFree = (): Automation | null => {
    for (const trigger of triggers) for (const action of AUTOMATION_ACTIONS) if (!used.has(`${trigger}:${action}`)) return { trigger, action };
    return null;
  };
  const set = (i: number, a: Automation) => onChange(automations.map((x, j) => (j === i ? a : x)));
  return (
    <Card>
      <CardHeader title="Automations" description="What happens on its own after a result. Taking the step yourself is always still an option." />
      <CardBody className="space-y-3">
        {showGate ? (
          <div className="flex gap-3 rounded-xl bg-brand-50/70 px-3 py-2.5 text-sm text-brand-700">
            <Zap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              Built in for officer requirements: passing meets the requirement right away, and missing the deadline pauses that person&apos;s leadership permissions until they pass.
            </p>
          </div>
        ) : null}
        {automations.length === 0 ? <p className="text-sm text-ink-3">No automations. Results still show on the results page.</p> : null}
        <ul className="space-y-2">
          {automations.map((a, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-xl border border-line p-3 sm:flex-row sm:items-center">
              <Select aria-label={`Automation ${i + 1}: when`} value={a.trigger} onChange={(e) => set(i, { ...a, trigger: e.target.value as Automation["trigger"] })} className="sm:w-64">
                {triggers.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABEL[t]}
                  </option>
                ))}
              </Select>
              <span className="hidden text-ink-3 sm:inline" aria-hidden>
                →
              </span>
              <Select aria-label={`Automation ${i + 1}: then`} value={a.action} onChange={(e) => set(i, { ...a, action: e.target.value as Automation["action"] })} className="sm:flex-1">
                {AUTOMATION_ACTIONS.map((x) => (
                  <option key={x} value={x}>
                    {actionLabel(x, kind)}
                  </option>
                ))}
              </Select>
              <Button variant="ghost" size="icon" aria-label={`Remove automation ${i + 1}`} onClick={() => onChange(automations.filter((_, j) => j !== i))} className="self-end sm:self-auto">
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        {automations.some((a, i) => automations.findIndex((b) => b.trigger === a.trigger && b.action === a.action) !== i) ? (
          <p className="text-xs text-warning">Two rows do the same thing; only one will run.</p>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const next = nextFree();
            if (next) onChange([...automations, next]);
          }}
          disabled={!nextFree() || automations.length >= 12}
        >
          <Plus className="h-4 w-4" aria-hidden /> Add an automation
        </Button>
      </CardBody>
    </Card>
  );
}
