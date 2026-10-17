"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, TriangleAlert, X } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { ProgressBar } from "@/components/ui/layout";
import { formatBytes } from "@/lib/rich/embeds";
import type { UploadedFile } from "@/lib/files/types";
import { uploadProblem, uploadWithProgress, type UploadTarget } from "@/components/files/client";

/**
 * Uploads with progress, a few at a time, plus the floating panel that shows
 * them (like a desktop file manager's transfer window). Shared by the
 * explorer and the picker.
 */

export type UploadStatus = "queued" | "uploading" | "done" | "error" | "cancelled";

export type UploadItem = {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: UploadStatus;
  error: string | null;
  /** Where it's going ("Flyers", "My files"). */
  destination: string;
  result: UploadedFile | null;
};

type Job = { item: UploadItem; file: File; target: UploadTarget; ctrl: AbortController };

let seq = 0;

export function useUploadQueue({ concurrency = 3, onUploaded }: { concurrency?: number; onUploaded?: (file: UploadedFile, target: UploadTarget) => void } = {}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const jobs = useRef(new Map<string, Job>());
  const running = useRef(0);
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => {
    onUploadedRef.current = onUploaded;
  });

  const patch = useCallback((id: string, p: Partial<UploadItem>) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }, []);

  const pump = useCallback(() => {
    for (const job of jobs.current.values()) {
      if (running.current >= concurrency) return;
      if (job.item.status !== "queued") continue;
      job.item.status = "uploading";
      running.current++;
      patch(job.item.id, { status: "uploading" });
      let last = 0;
      uploadWithProgress(
        job.file,
        job.target,
        (f) => {
          // Re-render at most every few percent; progress events fire very often.
          if (f - last >= 0.03 || f === 1) {
            last = f;
            patch(job.item.id, { progress: f });
          }
        },
        job.ctrl.signal,
      )
        .then((result) => {
          job.item.status = "done";
          patch(job.item.id, { status: "done", progress: 1, result });
          onUploadedRef.current?.(result, job.target);
        })
        .catch((e: Error) => {
          const cancelled = e?.name === "AbortError";
          job.item.status = cancelled ? "cancelled" : "error";
          patch(job.item.id, { status: job.item.status, error: cancelled ? null : e.message });
        })
        .finally(() => {
          running.current--;
          jobs.current.delete(job.item.id);
          pump();
        });
    }
  }, [concurrency, patch]);

  const enqueue = useCallback(
    (files: File[], target: UploadTarget, destination: string) => {
      const added: UploadItem[] = [];
      for (const file of files) {
        const problem = uploadProblem(file);
        const item: UploadItem = { id: `u${++seq}`, name: file.name, size: file.size, progress: 0, status: problem ? "error" : "queued", error: problem, destination, result: null };
        added.push(item);
        if (!problem) jobs.current.set(item.id, { item: { ...item }, file, target, ctrl: new AbortController() });
      }
      setItems((list) => [...list.filter((i) => i.status === "queued" || i.status === "uploading" || i.status === "error"), ...added]);
      // Let state land first so progress patches find their rows.
      queueMicrotask(pump);
      return added.length;
    },
    [pump],
  );

  const cancel = useCallback(
    (id: string) => {
      const job = jobs.current.get(id);
      if (!job) return;
      if (job.item.status === "queued") {
        jobs.current.delete(id);
        patch(id, { status: "cancelled" });
      } else job.ctrl.abort();
    },
    [patch],
  );

  const dismiss = useCallback(() => {
    setItems((list) => list.filter((i) => i.status === "queued" || i.status === "uploading"));
  }, []);

  // Leaving the page cancels uploads still in flight.
  useEffect(() => {
    const all = jobs.current;
    return () => {
      for (const job of all.values()) job.ctrl.abort();
    };
  }, []);

  const active = items.filter((i) => i.status === "queued" || i.status === "uploading").length;
  return { items, enqueue, cancel, dismiss, active };
}

/** The floating "Uploads" panel. Renders nothing when there's nothing to show. */
export function UploadPanel({ items, onCancel, onDismiss, className }: { items: UploadItem[]; onCancel: (id: string) => void; onDismiss: () => void; className?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;
  const active = items.filter((i) => i.status === "queued" || i.status === "uploading").length;
  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "error").length;
  const title = active
    ? `Uploading ${active} ${active === 1 ? "file" : "files"}…`
    : failed
      ? `${done} uploaded, ${failed} didn't go through`
      : `${done} ${done === 1 ? "upload" : "uploads"} complete`;

  return (
    <section
      aria-label="Uploads"
      className={cn(
        "fixed inset-x-4 bottom-4 z-40 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-pop)] sm:left-auto sm:right-6 sm:w-96",
        className,
      )}
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        {active ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" aria-hidden /> : failed ? <TriangleAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />}
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" role="status" aria-live="polite">
          {title}
        </p>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded-md p-1 text-ink-3 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
          aria-label={collapsed ? "Show uploads" : "Hide upload details"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>
        {!active ? (
          <button type="button" onClick={onDismiss} className="rounded-md p-1 text-ink-3 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand" aria-label="Close uploads">
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </header>
      {collapsed ? null : (
        <ul className="max-h-72 divide-y divide-line overflow-y-auto">
          {items.map((i) => (
            <li key={i.id} className="px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink" title={i.name}>
                    {i.result?.name ?? i.name}
                  </span>
                  <span className={cn("block truncate text-xs", i.status === "error" ? "text-danger" : "text-ink-3")}>
                    {i.status === "error"
                      ? i.error
                      : i.status === "cancelled"
                        ? "Cancelled"
                        : i.status === "done"
                          ? `Added to ${i.destination}`
                          : i.status === "queued"
                            ? `Waiting · ${formatBytes(i.size)}`
                            : `${Math.round(i.progress * 100)}% of ${formatBytes(i.size)} · to ${i.destination}`}
                  </span>
                </span>
                {i.status === "done" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Uploaded" /> : null}
                {i.status === "error" ? <TriangleAlert className="h-4 w-4 shrink-0 text-danger" aria-hidden /> : null}
                {i.status === "queued" || i.status === "uploading" ? (
                  <button
                    type="button"
                    onClick={() => onCancel(i.id)}
                    className="rounded-md p-1 text-ink-3 hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
                    aria-label={`Cancel uploading ${i.name}`}
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                ) : null}
              </div>
              {i.status === "uploading" || i.status === "queued" ? <ProgressBar value={i.progress * 100} className="mt-1.5 h-1.5" /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
