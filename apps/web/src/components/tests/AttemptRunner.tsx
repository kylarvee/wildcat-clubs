"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { QuestionType } from "@prisma/client";
import { AlertTriangle, Check, CheckCircle2, Clock, CloudOff, Loader2, Send, Timer } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/misc";
import { RichTextEditor } from "@/components/rich/RichTextEditor";
import { saveAnswerAction, submitAttemptAction } from "@/app/tests/actions";
import { describeClock, formatClock, timerState } from "@/lib/tests/deadlines";
import { choiceCorrect, isAnswered } from "@/lib/tests/scoring";
import { isChoice, type QuestionOption } from "@/lib/tests/types";

export type RunnerQuestion = { id: string; type: QuestionType; points: number; options: QuestionOption[]; prompt: ReactNode };
type Answer = { selectedOptionIds: string[]; text: string | null };
type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Taking a test. The clock always runs: it counts down with a time limit and
 * up without one, warns at 5 and 1 minutes, and hands the test in when time
 * runs out. Every answer autosaves; the server is the authority on time and
 * refuses late answers, so the clock here only decides when to submit.
 *
 * mode "preview" is the builder's "preview as taker": nothing is saved.
 *
 * A form (isForm) has no points and no clock unless it has a closing time,
 * and can't be submitted until every question has an answer (the server
 * checks too). When a form closes mid-way it's handed in as-is.
 */
export function AttemptRunner({
  mode,
  attemptId,
  isForm = false,
  title,
  startedAt,
  deadlineAt,
  serverNow,
  questions,
  initialAnswers,
  resultsHref,
  exitHref,
  previewKey,
}: {
  mode: "live" | "preview";
  attemptId: string | null;
  isForm?: boolean;
  title: string;
  startedAt: string;
  deadlineAt: string | null;
  serverNow: string;
  questions: RunnerQuestion[];
  initialAnswers: Record<string, Answer>;
  resultsHref: string;
  exitHref: string;
  /** Preview only: correct choices, to show what the instant score would be. */
  previewKey?: Record<string, string[]>;
}) {
  const router = useRouter();
  const live = mode === "live" && attemptId !== null;
  const [answers, setAnswers] = useState<Record<string, Answer>>(initialAnswers);
  // Latest answers for saves that run after a delay (updated together with state in setAnswer).
  const answersRef = useRef(answers);

  // ── Clock: server time is the reference, corrected for this device's clock. ──
  const serverNowMs = useMemo(() => new Date(serverNow).getTime(), [serverNow]);
  const offset = useRef<number | null>(null);
  const [nowMs, setNowMs] = useState(serverNowMs);
  useEffect(() => {
    offset.current ??= serverNowMs - Date.now();
    const tick = () => setNowMs(Date.now() + (offset.current ?? 0));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [serverNowMs]);
  const startedMs = new Date(startedAt).getTime();
  const deadlineMs = deadlineAt ? new Date(deadlineAt).getTime() : null;
  const clock = timerState(nowMs, startedMs, deadlineMs);
  // A form only shows a clock when it closes at a set time.
  const showClock = !isForm || deadlineMs !== null;
  const noun = isForm ? "form" : "test";
  const submitLabel = isForm ? "Submit form" : "Submit test";
  const [announcement, setAnnouncement] = useState("");
  const warned = useRef<string | null>(null);
  useEffect(() => {
    if (!clock.warning || warned.current === clock.warning) return;
    warned.current = clock.warning;
    const msg = clock.warning === "five" ? `5 minutes left. Finish up and press ${submitLabel}.` : `1 minute left. Your ${noun} hands itself in when time runs out.`;
    setAnnouncement(msg);
    toast.warning(msg);
  }, [clock.warning, submitLabel, noun]);

  // ── Autosave: one queue per question so saves arrive in order. ──
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queues = useRef(new Map<string, Promise<void>>());
  const dirty = useRef(new Set<string>());
  const finished = useRef(false);
  const [submitting, setSubmitting] = useState<null | "manual" | "auto">(null);

  const leaveForResults = useCallback(
    (message?: string) => {
      if (finished.current) return;
      finished.current = true;
      if (message) toast.info(message);
      router.replace(resultsHref);
    },
    [router, resultsHref],
  );

  const send = useCallback(
    (qid: string): Promise<void> => {
      if (!live || finished.current) return Promise.resolve();
      const prev = queues.current.get(qid) ?? Promise.resolve();
      const next = prev.then(async () => {
        if (!dirty.current.has(qid) || finished.current) return;
        dirty.current.delete(qid);
        const a = answersRef.current[qid] ?? { selectedOptionIds: [], text: null };
        setSaveState((s) => ({ ...s, [qid]: "saving" }));
        const r = await saveAnswerAction(attemptId!, { questionId: qid, selectedOptionIds: a.selectedOptionIds, text: a.text }).catch(() => null);
        if (r?.ok) {
          setSaveState((s) => ({ ...s, [qid]: dirty.current.has(qid) ? "saving" : "saved" }));
          setLastSaved(new Date());
          return;
        }
        if (r && r.code === "CONFLICT") return leaveForResults(r.error);
        // Offline or a hiccup: keep the change and try again shortly.
        dirty.current.add(qid);
        setSaveState((s) => ({ ...s, [qid]: "error" }));
        if (r && !r.ok && r.code !== "ERROR") toast.error(r.error);
        const t = setTimeout(() => void send(qid), 4000);
        timers.current.set(qid, t);
      });
      queues.current.set(qid, next);
      return next;
    },
    [live, attemptId, leaveForResults],
  );

  const schedule = (qid: string, delay: number) => {
    dirty.current.add(qid);
    const t = timers.current.get(qid);
    if (t) clearTimeout(t);
    timers.current.set(qid, setTimeout(() => void send(qid), delay));
  };

  const flushAll = useCallback(async () => {
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    await Promise.all([...dirty.current].map((qid) => send(qid)));
    await Promise.all([...queues.current.values()]);
  }, [send]);

  const setAnswer = (q: RunnerQuestion, a: Answer) => {
    setAnswers((prev) => ({ ...prev, [q.id]: a }));
    answersRef.current = { ...answersRef.current, [q.id]: a };
    if (live) schedule(q.id, isChoice(q.type) ? 250 : 1200);
  };

  // Leaving with an unsaved answer: the browser asks first. (The clock keeps running either way.)
  useEffect(() => {
    if (!live) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!finished.current && dirty.current.size) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [live]);

  // ── Hand in ──
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewDone, setPreviewDone] = useState<null | { earned: number; possible: number; open: number }>(null);
  const unansweredIds = questions.filter((q) => !isAnswered(q, answers[q.id])).map((q) => q.id);
  const unanswered = unansweredIds.length;
  // Forms: after a refused submit, unanswered questions are marked until they're answered.
  const [showMissing, setShowMissing] = useState(false);

  const submit = useCallback(
    async (auto: boolean) => {
      if (finished.current) return;
      if (!live) {
        let earned = 0;
        let possible = 0;
        let open = 0;
        for (const q of questions) {
          if (!isChoice(q.type)) {
            open++;
            continue;
          }
          possible += q.points;
          if (choiceCorrect(previewKey?.[q.id] ?? [], answersRef.current[q.id]?.selectedOptionIds ?? [])) earned += q.points;
        }
        setPreviewDone({ earned, possible, open });
        return;
      }
      setSubmitting(auto ? "auto" : "manual");
      setError(null);
      await flushAll();
      if (dirty.current.size) await flushAll(); // one more try for anything that failed to save
      if (dirty.current.size && !auto) {
        setSubmitting(null);
        setError(`Some answers haven't saved yet, so we didn't hand in your ${noun}. Check your connection, then press ${submitLabel} again.`);
        return;
      }
      const r = await submitAttemptAction(attemptId!, { auto }).catch(() => null);
      if (r?.ok || (r && r.code === "CONFLICT")) return leaveForResults();
      setSubmitting(null);
      setError(r ? r.error : `We couldn't reach the server to hand in your ${noun}. Your answers are saved — check your connection and press ${submitLabel} again.`);
    },
    [live, questions, previewKey, flushAll, attemptId, leaveForResults, noun, submitLabel],
  );

  // Time's up: hand it in automatically (the server would also accept nothing new after the deadline).
  const autoFired = useRef(false);
  useEffect(() => {
    if (!clock.expired || autoFired.current) return;
    autoFired.current = true;
    if (live) {
      setAnnouncement(isForm ? "This form has closed. Handing in your answers." : "Time's up. Handing in your test.");
      void submit(true);
    } else {
      toast.info("Time's up. In a real attempt, the answers would be handed in now.");
    }
  }, [clock.expired, live, submit, isForm]);

  const onSubmitClick = () => {
    setError(null);
    if (isForm && unanswered > 0) {
      // Every question on a form needs an answer: point at the first one still blank.
      setShowMissing(true);
      document.getElementById(`q-${unansweredIds[0]}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (unanswered > 0) setConfirmOpen(true);
    else void submit(false);
  };

  const missingMessage =
    isForm && showMissing && unanswered > 0 ? `Answer every question before you submit. ${unanswered === 1 ? "1 question still needs" : `${unanswered} questions still need`} an answer.` : null;
  const saving = Object.values(saveState).some((s) => s === "saving");
  const saveError = Object.values(saveState).some((s) => s === "error");
  const answeredCount = questions.length - unanswered;

  return (
    <div className="space-y-6">
      {/* The clock bar sits just under the site header and stays in view. */}
      <div className="sticky top-16 z-30 -mx-4 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {showClock ? (
            <>
              <div
                role="timer"
                aria-label={describeClock(clock.ms, clock.mode)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-1 font-mono text-lg font-semibold tabular-nums",
                  clock.warning === "one" || clock.expired ? "bg-danger-50 text-danger" : clock.warning === "five" ? "bg-warning-50 text-warning" : "bg-muted text-ink",
                )}
              >
                {clock.mode === "down" ? <Timer className="h-4 w-4" aria-hidden /> : <Clock className="h-4 w-4" aria-hidden />}
                {formatClock(clock.ms)}
              </div>
              <span className="text-xs text-ink-3">{clock.mode === "down" ? (isForm ? "until it closes" : "left") : "No time limit — the clock still runs"}</span>
            </>
          ) : null}
          <span className="ml-auto text-sm text-ink-2">
            {answeredCount} of {questions.length} answered
          </span>
          {live ? (
            <span className="flex items-center gap-1 text-xs text-ink-3" aria-live="polite">
              {saveError ? (
                <>
                  <CloudOff className="h-3.5 w-3.5 text-warning" aria-hidden /> Not saved yet — retrying
                </>
              ) : saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving…
                </>
              ) : lastSaved ? (
                <>
                  <Check className="h-3.5 w-3.5 text-success" aria-hidden /> All answers saved
                </>
              ) : (
                "Answers save as you go"
              )}
            </span>
          ) : (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand">Preview — nothing is saved</span>
          )}
        </div>
        <p className="sr-only" aria-live="assertive">
          {announcement}
        </p>
      </div>

      <nav aria-label="Jump to a question" className="flex flex-wrap gap-1.5">
        {questions.map((q, i) => {
          const done = isAnswered(q, answers[q.id]);
          return (
            <a
              key={q.id}
              href={`#q-${q.id}`}
              className={cn(
                "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand",
                done ? "border-brand bg-brand text-white" : showMissing ? "border-danger bg-danger-50 text-danger" : "border-line-2 bg-surface text-ink-2 hover:bg-muted",
              )}
              aria-label={`Question ${i + 1}${done ? ", answered" : ", not answered yet"}`}
            >
              {i + 1}
            </a>
          );
        })}
      </nav>

      <ol className="space-y-5">
        {questions.map((q, i) => (
          <li key={q.id} id={`q-${q.id}`} className="scroll-mt-36">
            <QuestionBlock
              q={q}
              n={i + 1}
              isForm={isForm}
              missing={showMissing && !isAnswered(q, answers[q.id])}
              answer={answers[q.id]}
              onAnswer={(a) => setAnswer(q, a)}
              disabled={Boolean(submitting)}
              saveState={live ? saveState[q.id] : undefined}
            />
          </li>
        ))}
      </ol>

      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <p className="font-medium text-ink">
          {unanswered
            ? isForm
              ? `${unanswered} ${unanswered === 1 ? "question still needs" : "questions still need"} an answer.`
              : `${unanswered} ${unanswered === 1 ? "question is" : "questions are"} still unanswered.`
            : "Every question has an answer."}
        </p>
        <p className="mt-1 text-sm text-ink-3">
          {isForm
            ? live
              ? "Every question needs an answer. Once you submit, you can't change your answers."
              : "This is how people will see the form. Submitting here checks every question is answered, without saving anything."
            : live
              ? "Once you hand it in you can't change your answers. Multiple choice is scored right away; written answers go to a reviewer."
              : "This is how people will see the test. Submitting here shows the multiple-choice score without saving anything."}
        </p>
        {error || missingMessage ? (
          <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error ?? missingMessage}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="lg" onClick={onSubmitClick} disabled={Boolean(submitting)}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} {submitLabel}
          </Button>
          {!live ? (
            <ButtonLink href={exitHref} variant="outline" size="lg">
              Back to the editor
            </ButtonLink>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Submit with ${unanswered} unanswered ${unanswered === 1 ? "question" : "questions"}?`}
        description="Unanswered questions score zero. You can't come back to change anything after you hand it in."
        confirmLabel="Submit test"
        cancelLabel="Keep working"
        onConfirm={() => {
          setConfirmOpen(false);
          void submit(false);
        }}
      />

      {submitting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]" role="status" aria-live="assertive">
          <div className="flex max-w-sm items-center gap-3 rounded-2xl bg-surface px-5 py-4 shadow-[var(--shadow-pop)]">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand" aria-hidden />
            <p className="text-sm text-ink">{submitting === "auto" ? (isForm ? "This form has closed — handing in your answers…" : "Time's up — handing in your answers…") : isForm ? "Submitting your form…" : "Handing in your test…"}</p>
          </div>
        </div>
      ) : null}

      <Dialog open={previewDone !== null} onOpenChange={(o) => !o && setPreviewDone(null)}>
        <DialogContent title="Preview finished" description="Nothing was saved.">
          {previewDone && isForm ? (
            <p className="flex items-center gap-2 text-sm text-ink-2">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> Every question is answered. In a real response, this would be submitted and the person&apos;s task would close.
            </p>
          ) : previewDone ? (
            <div className="space-y-2 text-sm text-ink-2">
              <p className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> Multiple choice: {previewDone.earned} of {previewDone.possible} {previewDone.possible === 1 ? "point" : "points"}.
              </p>
              {previewDone.open ? (
                <p>
                  {previewDone.open} written {previewDone.open === 1 ? "answer" : "answers"} would go to a reviewer before the final score.
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDone(null)}>
              Keep previewing
            </Button>
            <ButtonLink href={exitHref}>Back to the editor</ButtonLink>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QuestionBlock({
  q,
  n,
  isForm,
  missing,
  answer,
  onAnswer,
  disabled,
  saveState,
}: {
  q: RunnerQuestion;
  n: number;
  isForm: boolean;
  /** A form question left blank after a refused submit. */
  missing: boolean;
  answer: Answer | undefined;
  onAnswer: (a: Answer) => void;
  disabled: boolean;
  saveState?: SaveState;
}) {
  const promptId = `q-${q.id}-prompt`;
  const selected = answer?.selectedOptionIds ?? [];
  const pts = `${q.points} ${q.points === 1 ? "point" : "points"}`;
  return (
    <section aria-labelledby={promptId} className={cn("rounded-[var(--radius-card)] border bg-surface p-5 shadow-[var(--shadow-card)]", missing ? "border-danger" : "border-line")}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-3">
        <span>Question {n}</span>
        <span aria-hidden>·</span>
        <span>{isForm ? "Required" : pts}</span>
        {q.type === "MULTI_CHOICE" ? (
          <>
            <span aria-hidden>·</span>
            <span className="normal-case tracking-normal text-brand-600">Choose all that apply</span>
          </>
        ) : null}
        {missing ? <span className="normal-case tracking-normal text-danger">Needs an answer</span> : null}
        {saveState === "saved" ? <span className="ml-auto normal-case tracking-normal text-success">Saved</span> : saveState === "error" ? <span className="ml-auto normal-case tracking-normal text-warning">Not saved yet</span> : null}
      </div>
      <div id={promptId} className="text-ink">
        {q.prompt}
      </div>

      {isChoice(q.type) ? (
        <div role={q.type === "SINGLE_CHOICE" ? "radiogroup" : "group"} aria-labelledby={promptId} className="mt-4 space-y-2">
          {q.options.map((o) => {
            const checked = selected.includes(o.id);
            return (
              <label
                key={o.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors",
                  checked ? "border-brand bg-brand-50/60" : "border-line hover:bg-muted/50",
                  disabled && "cursor-not-allowed opacity-70",
                )}
              >
                <input
                  type={q.type === "SINGLE_CHOICE" ? "radio" : "checkbox"}
                  name={`answer-${q.id}`}
                  value={o.id}
                  checked={checked}
                  disabled={disabled}
                  onChange={() =>
                    onAnswer({
                      selectedOptionIds: q.type === "SINGLE_CHOICE" ? [o.id] : checked ? selected.filter((x) => x !== o.id) : [...selected, o.id],
                      text: null,
                    })
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                />
                <span className="text-ink">{o.text}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="mt-4">
          <RichTextEditor
            variant="basic"
            defaultValue={answer?.text ?? ""}
            onChange={(html) => onAnswer({ selectedOptionIds: [], text: html })}
            minHeight={q.type === "LONG_ANSWER" ? 220 : 90}
            disabled={disabled}
            ariaLabel={`Your answer to question ${n}`}
            placeholder={q.type === "LONG_ANSWER" ? "Write your answer…" : "A sentence or two…"}
            stickyToolbarTop={124}
          />
        </div>
      )}
    </section>
  );
}
