"use client";

import { useMemo, useRef, useState } from "react";
import { Download, FileUp, Loader2, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Callout } from "@/components/ui/layout";
import { toast } from "@/components/ui/misc";
import { useRunAction } from "@/components/roles/useRunAction";
import { importLinkedInAction } from "@/app/settings/actions";
import { parseLinkedInPositions, positionKey, type LinkedInParseResult, type ParsedPosition, type YearMonth } from "@/lib/profiles/linkedin";

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ym = (v: YearMonth | null) => (v ? `${MONTH[v.month - 1]} ${v.year}` : "Present");
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Import from LinkedIn. LinkedIn has no open profile API, so this reads the
 * Positions.csv from LinkedIn's "Get a copy of your data" export — right here
 * in the browser — and shows a preview to pick from before anything is saved.
 * Positions already on your profile are unticked and skipped.
 */
export function LinkedInImport({ existingKeys }: { existingKeys: string[] }) {
  const [result, setResult] = useState<LinkedInParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const { pending, error, setError, run } = useRunAction();
  const existing = useMemo(() => new Set(existingKeys), [existingKeys]);
  const isDup = (p: ParsedPosition) => existing.has(positionKey(p));

  async function read(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) return setError("Choose the Positions.csv file from your LinkedIn export (not the .zip itself).");
    if (file.size > MAX_FILE_BYTES) return setError("That file is bigger than a Positions.csv should be. Make sure you picked Positions.csv.");
    const text = await file.text();
    const r = parseLinkedInPositions(text);
    setFileName(file.name);
    setResult(r);
    setSelected(new Set(r.positions.filter((p) => !isDup(p)).map((p) => p.row)));
    if (input.current) input.current.value = "";
  }

  function reset() {
    setResult(null);
    setFileName("");
    setSelected(new Set());
    setError(null);
  }

  async function importSelected() {
    if (!result) return;
    const positions = result.positions
      .filter((p) => selected.has(p.row))
      .map((p) => ({ company: p.company, title: p.title, description: p.description, location: p.location, startedOn: p.startedOn!, finishedOn: p.finishedOn }));
    if (!positions.length) return setError("Tick at least one position to import.");
    const r = await run(() => importLinkedInAction(positions));
    if (r.ok) {
      const { imported, duplicates } = r.data;
      toast.success(imported ? `Imported ${imported} position${imported === 1 ? "" : "s"}${duplicates ? ` (${duplicates} already on your profile)` : ""}.` : "Those positions are already on your profile.");
      reset();
    }
  }

  const all = result?.positions ?? [];
  const allChecked = all.length > 0 && all.every((p) => selected.has(p.row));

  return (
    <Card className="p-5 sm:p-6" id="linkedin">
      <h2 className="text-lg font-semibold text-ink">Import from LinkedIn</h2>
      <p className="mt-1 text-sm text-ink-2">
        LinkedIn doesn&apos;t let other sites read your profile, so import a copy of your own data instead. It takes a few minutes, and you choose what gets added.
      </p>
      <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
        <li>
          On LinkedIn, open <span className="font-medium text-ink">Settings &amp; Privacy → Data privacy → Get a copy of your data</span>.
        </li>
        <li>
          Choose <span className="font-medium text-ink">Want something in particular?</span>, tick <span className="font-medium text-ink">Positions</span>, then <span className="font-medium text-ink">Request archive</span>.
        </li>
        <li>LinkedIn emails you a download link (usually within minutes). Download the .zip and open it.</li>
        <li>
          Upload <span className="font-medium text-ink">Positions.csv</span> here. It&apos;s read in your browser; only the positions you pick are saved.
        </li>
      </ol>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input ref={input} id="linkedin-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void read(e.target.files?.[0])} />
        <Button type="button" variant={result ? "outline" : "primary"} onClick={() => input.current?.click()}>
          <FileUp className="h-4 w-4" aria-hidden /> {result ? "Choose a different file" : "Upload Positions.csv"}
        </Button>
        <a href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
          <Download className="h-4 w-4" aria-hidden /> Open LinkedIn&apos;s data export<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>

      {error ? (
        <Callout tone="danger" className="mt-4">
          {error}
        </Callout>
      ) : null}

      {result ? (
        <div className="mt-5" aria-live="polite">
          {result.error ? (
            <Callout tone="warning" title={`We couldn't read ${fileName}`}>
              {result.error}
            </Callout>
          ) : !all.length ? (
            <Callout tone="warning" title="No positions found">
              {fileName} doesn&apos;t have any positions we can import{result.skipped.length ? " — see the notes below" : ""}.
            </Callout>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink-2">
                  Found <span className="font-medium text-ink">{all.length}</span> position{all.length === 1 ? "" : "s"} in {fileName}. {selected.size} selected.
                </p>
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--color-brand)]"
                    checked={allChecked}
                    onChange={(e) => setSelected(e.target.checked ? new Set(all.map((p) => p.row)) : new Set())}
                  />
                  Select all
                </label>
              </div>
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                {all.map((p) => {
                  const dup = isDup(p);
                  const id = `li-pos-${p.row}`;
                  return (
                    <li key={p.row} className="flex gap-3 px-3 py-3 sm:px-4">
                      <input
                        id={id}
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                        checked={selected.has(p.row)}
                        onChange={(e) =>
                          setSelected((cur) => {
                            const next = new Set(cur);
                            if (e.target.checked) next.add(p.row);
                            else next.delete(p.row);
                            return next;
                          })
                        }
                      />
                      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink">{p.title}</span>
                          {dup ? <Badge tone="neutral">Already on your profile</Badge> : null}
                        </span>
                        <span className="block text-sm text-ink-2">
                          {p.company}
                          {p.location ? <span className="text-ink-3"> · {p.location}</span> : null}
                        </span>
                        <span className="block text-sm text-ink-3">
                          {ym(p.startedOn)} – {ym(p.finishedOn)}
                        </span>
                        {p.description ? <span className="mt-1 line-clamp-2 block text-xs text-ink-3">{p.description}</span> : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
                  <RotateCcw className="h-4 w-4" aria-hidden /> Start over
                </Button>
                <Button type="button" onClick={() => void importSelected()} disabled={pending || selected.size === 0}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Import {selected.size || ""} position{selected.size === 1 ? "" : "s"}
                </Button>
              </div>
            </>
          )}
          {result.skipped.length ? (
            <details className="mt-4 text-sm text-ink-3">
              <summary className="cursor-pointer font-medium text-ink-2">
                {result.skipped.length} row{result.skipped.length === 1 ? "" : "s"} couldn&apos;t be imported
              </summary>
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                {result.skipped.map((s) => (
                  <li key={s.row}>
                    Row {s.row}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
