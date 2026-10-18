"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { Clock, Maximize, Minimize, RefreshCw, UserPlus, Users, WifiOff, X } from "lucide-react";
import { sameCampusDay, whenLabel, type WindowState } from "@/lib/attendance/rules";
import { fmtRange, fmtTime } from "@/lib/time";
import { Avatar, ClubLogo } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { LogoMark } from "@/components/shell/Logo";
import { ManualAdd } from "@/components/attendance/ManualAdd";

export type LiveToken = { token: string; code: string; url: string; rotateSeconds: number; expiresInMs: number; windowState: WindowState; opensAt: string; closesAt: string };
export type LiveFeed = { count: number; windowState: WindowState; latest: { id: string; name: string; avatarUrl: string | null; avatarColor: string; method: string; checkedInAt: string }[] };

type Props = {
  occurrenceId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  place: string | null;
  club: { name: string; logoUrl: string | null; logoColor: string } | null;
  initialToken: LiveToken;
  initialFeed: LiveFeed;
  initialSvg: string;
  /** "clubs.weber.edu/checkin" — where members can type the code. */
  typeAt: string;
  /**
   * Whose members may type the code ("Chess Club or SWE", rules.codeClubsPhrase).
   * Null for university events: no host club, so only the QR code works and the
   * screen doesn't show the code.
   */
  codeClubs: string | null;
  backHref: string;
};

const FEED_MS = 3000;

async function getJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.ok) return { ok: true, data: body.data as T };
    return { ok: false, status: res.status, error: body?.error ?? "Something went wrong." };
  } catch {
    return { ok: false, status: 0, error: "No connection." };
  }
}

function qrSvg(url: string) {
  return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#17131c", light: "#ffffff" } });
}

/**
 * The leader's check-in screen: a giant rotating QR, the code members of the
 * host and co-host clubs can type, the live head count and the latest
 * arrivals. Built for a projector and for a
 * phone held up at the door. Polls the token and feed APIs; the QR changes
 * every `rotateSeconds` so photos of it stop working.
 */
export function LiveCheckinScreen(props: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState(props.initialToken);
  const [receivedAt, setReceivedAt] = useState(() => Date.now());
  const [svg, setSvg] = useState(props.initialSvg);
  const [feed, setFeed] = useState(props.initialFeed);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [adding, setAdding] = useState(false);
  const seen = useRef(new Set(props.initialFeed.latest.map((l) => l.id)));

  // ── Rotate the QR when the current token's window ends. ──
  useEffect(() => {
    if (fatal) return;
    let cancelled = false;
    const wait = problem ? 5000 : Math.max(token.expiresInMs + 250, 1000);
    const timer = window.setTimeout(async () => {
      const res = await getJson<LiveToken>(`/api/checkin/${props.occurrenceId}/token`);
      if (cancelled) return;
      if (res.ok) {
        const nextSvg = await qrSvg(res.data.url).catch(() => null);
        if (cancelled) return;
        if (nextSvg) setSvg(nextSvg);
        setToken(res.data);
        setReceivedAt(Date.now());
        setProblem(null);
      } else if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 400) {
        setFatal(res.status === 401 ? "You were signed out. Sign in again to keep running check-in." : res.error);
      } else {
        setProblem("Connection lost — retrying. The last code keeps working for about a minute.");
      }
      // Bump even when nothing else changed, so a repeat failure still schedules a retry.
      setAttempt((n) => n + 1);
    }, wait);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attempt, token, problem, fatal, props.occurrenceId]);

  // ── Live count and latest arrivals. ──
  const pollFeed = useCallback(async () => {
    if (document.hidden) return;
    const res = await getJson<LiveFeed>(`/api/checkin/${props.occurrenceId}/feed`);
    if (!res.ok) return;
    const incoming = res.data.latest.filter((l) => !seen.current.has(l.id)).map((l) => l.id);
    incoming.forEach((id) => seen.current.add(id));
    setFresh(new Set(incoming));
    setFeed(res.data);
  }, [props.occurrenceId]);

  useEffect(() => {
    if (fatal) return;
    const id = window.setInterval(pollFeed, FEED_MS);
    const onVisible = () => !document.hidden && void pollFeed();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollFeed, fatal]);

  // ── Keep the screen awake (phones at the door), and track fullscreen. ──
  useEffect(() => {
    setCanFullscreen(Boolean(document.fullscreenEnabled));
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const acquire = async () => {
      try {
        if (nav.wakeLock && !document.hidden) lock = await nav.wakeLock.request("screen");
      } catch {}
    };
    void acquire();
    const onVisible = () => !document.hidden && void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {}
  };

  // Escape closes the add panel (the browser already uses it to leave full screen).
  useEffect(() => {
    if (!adding) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAdding(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding]);

  const state = feed.windowState ?? token.windowState;
  const code = token.code;
  // "at 5:00 PM" today, "Wed, Oct 28 at 5:00 PM" on another day, so a screen opened early doesn't read as today.
  const now = new Date();
  const opensAt = new Date(token.opensAt);
  const closesAt = new Date(token.closesAt);

  return (
    <div ref={rootRef} className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-white text-ink">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
        {props.club ? <ClubLogo name={props.club.name} src={props.club.logoUrl} color={props.club.logoColor} size="sm" /> : <LogoMark size={32} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-brand">{props.club?.name ?? "Weber State · WSUSA"}</p>
          <h1 className="truncate font-semibold leading-tight">{props.title}</h1>
        </div>
        {state !== "NOT_OPEN" && !fatal ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-expanded={adding}
            aria-controls="live-add-panel"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-2 px-3 text-sm font-medium text-ink-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Add someone</span>
            <span className="sr-only sm:hidden">Add someone by hand</span>
          </button>
        ) : null}
        {canFullscreen ? (
          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-2 px-3 text-sm font-medium text-ink-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand"
          >
            {isFullscreen ? <Minimize className="h-4 w-4" aria-hidden /> : <Maximize className="h-4 w-4" aria-hidden />}
            <span className="hidden sm:inline">{isFullscreen ? "Exit full screen" : "Full screen"}</span>
            <span className="sr-only sm:hidden">{isFullscreen ? "Exit full screen" : "Full screen"}</span>
          </button>
        ) : null}
        <Link
          href={props.backHref}
          className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-ink-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand"
        >
          <X className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Done</span>
          <span className="sr-only sm:hidden">Close check-in screen</span>
        </Link>
      </header>

      {fatal ? (
        <Banner tone="danger" icon={<WifiOff />}>
          {fatal}
        </Banner>
      ) : problem ? (
        <Banner tone="warning" icon={<RefreshCw className="animate-spin" />}>
          {problem}
        </Banner>
      ) : state === "NOT_OPEN" ? (
        <Banner tone="info" icon={<Clock />}>
          Check-in opens {sameCampusDay(opensAt, now) ? "at " : ""}
          {whenLabel(opensAt, now)}. Until then, scans will say it hasn&apos;t opened yet.
        </Banner>
      ) : state === "CLOSED" ? (
        <Banner tone="warning" icon={<Clock />}>
          Check-in closed {sameCampusDay(closesAt, now) ? "at " : "on "}
          {whenLabel(closesAt, now)}.{" "}
          <Link href={props.backHref} className="font-semibold underline underline-offset-2">
            Add late arrivals by hand
          </Link>
        </Banner>
      ) : null}

      {adding ? (
        // Inside this element (not a portal) so it still shows in full screen.
        <section
          id="live-add-panel"
          aria-label="Add someone by hand"
          className="fixed inset-x-0 bottom-0 z-[70] max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-line bg-white p-5 shadow-[var(--shadow-pop)] sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-20 sm:w-[380px] sm:rounded-2xl"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-ink">Add someone by hand</h2>
              <p className="text-sm text-ink-3">For people who can&apos;t scan — no phone, dead battery.</p>
            </div>
            <button type="button" onClick={() => setAdding(false)} className="rounded-md p-1 text-ink-3 hover:bg-muted hover:text-ink" aria-label="Close">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <ManualAdd occurrenceId={props.occurrenceId} autoFocus onAdded={() => void pollFeed()} />
        </section>
      ) : null}

      <main className="grid flex-1 content-center items-center gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)] lg:gap-12 lg:py-8">
        <section className="flex flex-col items-center" aria-label="Check-in QR code">
          <div
            className={cn(
              "aspect-square w-full max-w-[min(88vw,62vh)] rounded-3xl border-2 border-line bg-white p-3 shadow-[var(--shadow-card)] transition-opacity sm:p-5 [&>svg]:h-full [&>svg]:w-full",
              (fatal || state === "CLOSED") && "opacity-30",
            )}
            role="img"
            aria-label={`QR code for checking in to ${props.title}`}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <div className="mt-4 flex items-center gap-3 text-ink-2">
            <Countdown receivedAt={receivedAt} expiresInMs={token.expiresInMs} rotateSeconds={token.rotateSeconds} paused={Boolean(fatal || problem)} />
            <p className="text-base sm:text-lg">Scan with your phone&apos;s camera</p>
          </div>
        </section>

        <aside className="min-w-0 space-y-5 text-center lg:text-left">
          <div>
            {/* Typed codes only work for members of the host and co-host clubs, so only they are told to type it. */}
            {props.codeClubs ? (
              <>
                <p className="text-sm text-ink-3 sm:text-base">
                  Members of <span className="font-semibold text-ink-2">{props.codeClubs}</span>: no camera? Go to <span className="font-semibold text-ink-2">{props.typeAt}</span> and type
                </p>
                <p
                  className="mt-1 select-all whitespace-nowrap font-mono font-bold leading-none tracking-[0.14em] text-ink"
                  // Scales with the screen so it's huge on a projector and still fits a phone.
                  style={{ fontSize: "clamp(2.75rem, 5.2vw, 4.75rem)" }}
                  aria-label={`Code ${code.split("").join(" ")}`}
                >
                  {code.slice(0, 3)}
                  <span className="text-ink-3">·</span>
                  {code.slice(3)}
                </p>
              </>
            ) : null}
            <p className={cn("text-sm text-ink-3", props.codeClubs && "mt-2")}>
              {fmtRange(props.startsAt, props.endsAt, props.allDay)}
              {props.place ? ` · ${props.place}` : ""}
            </p>
          </div>

          <div className="flex items-center justify-center gap-4 rounded-2xl bg-brand px-5 py-4 text-white lg:justify-start">
            <Users className="h-8 w-8 shrink-0 opacity-80" aria-hidden />
            <p aria-live="polite">
              <span className="block text-5xl font-bold leading-none sm:text-6xl">{feed.count}</span>
              <span className="text-sm font-medium text-white/80">checked in</span>
            </p>
          </div>

          <div className="text-left">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Latest arrivals</p>
            {feed.latest.length ? (
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1 lg:[&>li:nth-child(n+6)]:hidden">
                {feed.latest.map((a) => (
                  <li
                    key={a.id}
                    className={cn("flex items-center gap-3 rounded-xl px-3 py-1.5 transition-colors duration-1000", fresh.has(a.id) ? "bg-success-50" : "bg-muted/60")}
                  >
                    <Avatar name={a.name} src={a.avatarUrl} color={a.avatarColor} size="sm" />
                    <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-3">{fmtTime(a.checkedInAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-line-2 px-4 py-6 text-center text-sm text-ink-3">The first person to check in shows up here.</p>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

function Banner({ tone, icon, children }: { tone: "info" | "warning" | "danger"; icon: React.ReactNode; children: React.ReactNode }) {
  const tones = { info: "bg-info-50 text-blue-900 border-blue-200", warning: "bg-warning-50 text-amber-900 border-amber-200", danger: "bg-danger-50 text-red-900 border-red-200" };
  return (
    <div className={cn("flex items-center justify-center gap-2 border-b px-4 py-2.5 text-center text-sm font-medium", tones[tone])} role={tone === "info" ? "status" : "alert"}>
      <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
        {icon}
      </span>
      <span>{children}</span>
    </div>
  );
}

/** A small ring that empties until the QR changes. */
function Countdown({ receivedAt, expiresInMs, rotateSeconds, paused }: { receivedAt: number; expiresInMs: number; rotateSeconds: number; paused: boolean }) {
  const [now, setNow] = useState(receivedAt);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const total = rotateSeconds * 1000;
  const left = paused ? 0 : Math.max(0, Math.min(total, receivedAt + expiresInMs - now));
  const r = 10;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex h-7 w-7 items-center justify-center" title={`New code in ${Math.ceil(left / 1000)}s`}>
      <svg viewBox="0 0 24 24" className="h-7 w-7 -rotate-90" aria-hidden>
        <circle cx="12" cy="12" r={r} fill="none" stroke="var(--color-line)" strokeWidth="2.5" />
        <circle cx="12" cy="12" r={r} fill="none" stroke="var(--color-brand)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - left / total)} />
      </svg>
      <span className="sr-only">The QR code changes every {rotateSeconds} seconds.</span>
    </span>
  );
}
