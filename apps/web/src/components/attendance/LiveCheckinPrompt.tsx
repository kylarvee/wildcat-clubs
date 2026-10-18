"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { CheckInResult } from "@/lib/domain/attendance";
import type { OccurrenceSummary } from "@/lib/attendance/queries";
import { fmtTime } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { checkInAction } from "@/components/attendance/actions";
import { CheckInSuccess } from "@/components/attendance/CheckInSuccess";

const DISMISSED_KEY = "wc.checkin.dismissed";

function readDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/**
 * "Check-in is open — are you here?" for members during their club's online
 * event (the web twin of the mobile app's pop-up). One tap checks in (method
 * TAP, "One-tap (online)"); "Not now" hides it for this browser session so
 * people can just use the page. Feed it liveOccurrencesForUser(actor), and
 * render it even when that list is empty (it shows nothing then): after a
 * check-in the page refreshes with nothing live, and staying mounted keeps
 * the "You're checked in!" card on screen.
 */
export function LiveCheckinPrompt({ occurrences, className }: { occurrences: OccurrenceSummary[]; className?: string }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [done, setDone] = useState<CheckInResult[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setDismissed(readDismissed()), []);

  const dismiss = (id: string) => {
    const next = [...new Set([...dismissed, id])];
    setDismissed(next);
    try {
      sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {}
  };

  const checkIn = (o: OccurrenceSummary) => {
    setBusyId(o.id);
    setErrors((e) => ({ ...e, [o.id]: "" }));
    startTransition(async () => {
      const res = await checkInAction({ code: o.code, via: "web-popup" });
      setBusyId(null);
      if (res.ok) {
        setDone((d) => [...d.filter((r) => r.occurrence.id !== o.id), res.data]);
        router.refresh();
      } else setErrors((e) => ({ ...e, [o.id]: res.error }));
    });
  };

  const doneIds = new Set(done.map((r) => r.occurrence.id));
  const open = occurrences.filter((o) => !dismissed.includes(o.id) && !doneIds.has(o.id));
  if (open.length === 0 && done.length === 0) return null;

  return (
    <section aria-label="Check-in open now" className={cn("space-y-3", className)}>
      {done.map((r) => (
        <Card key={r.occurrence.id} className="p-4">
          <CheckInSuccess result={r} compact />
        </Card>
      ))}
      {open.map((o) => (
        <div key={o.id} className="rounded-2xl border border-brand-200 bg-brand-50 p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-3">
            <span className="relative mt-1.5 flex h-3 w-3 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-50" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-success" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand">Check-in is open</p>
              <p className="font-semibold text-ink">{o.title}</p>
              <p className="text-sm text-ink-2">
                {o.club ? `${o.club.name} · ` : ""}
                {fmtTime(o.startsAt)} – {fmtTime(o.endsAt)}
                {o.place ? ` · ${o.place}` : ""}
              </p>
              <p className="mt-2 text-sm font-medium text-ink">Are you here?</p>
            </div>
          </div>
          {errors[o.id] ? (
            <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger" role="alert">
              {errors[o.id]}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2 sm:pl-6">
            <Button onClick={() => checkIn(o)} disabled={busyId !== null} size="lg" className="flex-1 sm:flex-none">
              {busyId === o.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {busyId === o.id ? "Checking in…" : "Check in"}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => dismiss(o.id)} disabled={busyId === o.id}>
              Not now
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
