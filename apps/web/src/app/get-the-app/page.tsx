import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { BellRing, CalendarDays, CheckCircle2, FlaskConical, Hand, QrCode, ScanLine, Smartphone } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { buttonClasses } from "@/components/ui/button";
import { Callout } from "@/components/ui/layout";

export const metadata: Metadata = {
  title: "Get the app",
  description: `Check in to club meetings with a scan, get event reminders, and keep your ${INSTITUTION.shortName} clubs in your pocket.`,
};

const EXPO_GO_IOS = "https://apps.apple.com/app/expo-go/id982107779";
const EXPO_GO_ANDROID = "https://play.google.com/store/apps/details?id=host.exp.exponent";

/** Absolute URL of this page, so a phone can open it from the QR code. */
async function pageUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}/get-the-app`;
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
      <path d="M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.39-.92-2.41-3.65zM14.1 5.86c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.66 1.37-.58.67-1.09 1.76-.96 2.8 1.02.08 2.05-.52 2.68-1.28z" />
    </svg>
  );
}

function PlayLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path fill="#34A853" d="M3.6 2.3 13.4 12l-9.8 9.7c-.3-.2-.6-.6-.6-1.1V3.4c0-.5.3-.9.6-1.1z" />
      <path fill="#FBBC04" d="m16.8 15.4-3.4-3.4 3.4-3.4 3.9 2.2c1.1.6 1.1 1.8 0 2.4l-3.9 2.2z" />
      <path fill="#EA4335" d="M16.8 15.4 13.4 12l-9.8 9.7c.4.3 1 .3 1.6 0l11.6-6.3z" />
      <path fill="#4285F4" d="M16.8 8.6 5.2 2.3c-.6-.3-1.2-.3-1.6 0L13.4 12l3.4-3.4z" />
    </svg>
  );
}

function StoreButton({ href, store, label }: { href: string; store: "ios" | "android"; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-14 min-w-[12rem] items-center gap-3 rounded-xl bg-ink px-4 text-left text-white shadow-sm transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {store === "ios" ? <AppleLogo /> : <PlayLogo />}
      <span className="leading-tight">
        <span className="block text-[11px] text-white/70">{store === "ios" ? "Download on the" : "Get it on"}</span>
        <span className="block text-base font-semibold">{label}</span>
      </span>
    </a>
  );
}

const FEATURES = [
  {
    icon: ScanLine,
    title: "Scan in at meetings",
    body: "Leaders put a QR code on screen. Point your phone at it and you're checked in — no sign-in sheet, no lines. New to the club? Your first scan registers you.",
  },
  {
    icon: Hand,
    title: "Check in from the club page",
    body: "During an event, open the club in the app and tap the check-in prompt. Just browsing? Skip it — nothing is recorded unless you tap.",
  },
  {
    icon: BellRing,
    title: "Reminders and announcements",
    body: "Get a heads-up before your clubs meet, and see announcements, join approvals and tasks the moment they're posted.",
  },
  {
    icon: CalendarDays,
    title: "Your clubs and calendar",
    body: "Every club you're in and every event you're subscribed to, in one list — plus your attendance record.",
  },
];

export default async function GetTheAppPage() {
  const [user, cfg, url] = await Promise.all([getCurrentUser(), getConfig(), pageUrl()]);
  const iosUrl = cfg["app.iosUrl"].trim();
  const androidUrl = cfg["app.androidUrl"].trim();
  const inStores = Boolean(iosUrl || androidUrl);
  const hasApp = user ? Boolean((await db.user.findUnique({ where: { id: user.id }, select: { hasMobileApp: true } }))?.hasMobileApp) : false;

  // Plain SVG from the qrcode library, shown as an image (never injected as HTML).
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#17131cff", light: "#ffffffff" } });
  const qrSrc = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;

  return (
    <div>
      <section className="relative overflow-hidden bg-brand-700 text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{ backgroundImage: "radial-gradient(600px 300px at 85% 20%, #8b5fbf, transparent 70%), radial-gradient(500px 260px at 10% 110%, #5b2d7e, transparent 70%)" }}
          aria-hidden="true"
        />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:py-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-100 ring-1 ring-inset ring-white/15">
              <Smartphone className="h-3.5 w-3.5" aria-hidden="true" /> {PLATFORM.name} for iPhone and Android
            </p>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-balance sm:text-5xl">Your clubs, in your pocket.</h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-brand-100 text-pretty">
              Check in to meetings with a two-second scan, get reminders before events, and never miss an announcement. Sign in with the same {INSTITUTION.shortName} account you use here.
            </p>
            {inStores ? (
              <div className="mt-7 flex flex-wrap gap-3">
                {iosUrl ? <StoreButton href={iosUrl} store="ios" label="App Store" /> : null}
                {androidUrl ? <StoreButton href={androidUrl} store="android" label="Google Play" /> : null}
              </div>
            ) : (
              <p className="mt-7 inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-white ring-1 ring-inset ring-white/15">
                <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" /> The app is in testing — see below for how to try it today.
              </p>
            )}
            {user && hasApp ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-brand-100">
                <CheckCircle2 className="h-4 w-4 text-green-300" aria-hidden="true" /> You&rsquo;ve already signed in on the app, {user.name.split(" ")[0]}. You&rsquo;re all set.
              </p>
            ) : null}
          </div>

          {/* Only useful on a computer: a phone can't scan its own screen. */}
          <div className="hidden w-64 rounded-2xl bg-white p-5 text-center text-ink shadow-[var(--shadow-pop)] md:block lg:w-72">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="QR code that opens this page on your phone" width={224} height={224} className="mx-auto h-auto w-full max-w-[224px]" />
            <p className="mt-3 flex items-center justify-center gap-1.5 text-sm font-semibold">
              <QrCode className="h-4 w-4 text-brand" aria-hidden="true" /> On your computer?
            </p>
            <p className="mt-1 text-xs leading-snug text-ink-3">Point your phone&rsquo;s camera here to open this page there{inStores ? " and download the app" : ""}.</p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight">What the app does</h2>
        <p className="mt-1 text-ink-2">The app is the quick, on-the-go side of {PLATFORM.name}. Bigger jobs — running a club, budgets, the constitution builder — stay on the web.</p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand" aria-hidden="true">
                <f.icon className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-semibold text-ink">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">{f.body}</p>
              </div>
            </li>
          ))}
        </ul>

        {!inStores ? (
          <section aria-labelledby="try-it" className="mt-12 rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-8">
            <div className="flex items-start gap-3">
              <FlaskConical className="mt-1 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
              <div>
                <h2 id="try-it" className="text-xl font-bold tracking-tight">
                  Try it now with Expo Go
                </h2>
                <p className="mt-1 text-ink-2">
                  The app isn&rsquo;t in the App Store or Google Play yet. While it&rsquo;s in testing, you can run it through Expo Go, a free app for trying apps before they launch.
                </p>
              </div>
            </div>
            <ol className="mt-6 grid gap-4 md:grid-cols-3">
              <li className="rounded-xl bg-muted/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand">Step 1</p>
                <p className="mt-1 font-semibold text-ink">Install Expo Go</p>
                <p className="mt-1 text-sm text-ink-2">It&rsquo;s free on both stores.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href={EXPO_GO_IOS} target="_blank" rel="noopener noreferrer" className={buttonClasses("outline", "sm")}>
                    iPhone
                  </a>
                  <a href={EXPO_GO_ANDROID} target="_blank" rel="noopener noreferrer" className={buttonClasses("outline", "sm")}>
                    Android
                  </a>
                </div>
              </li>
              <li className="rounded-xl bg-muted/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand">Step 2</p>
                <p className="mt-1 font-semibold text-ink">Open the test link</p>
                <p className="mt-1 text-sm text-ink-2">
                  Ask the {PLATFORM.name} team at{" "}
                  <a href={`mailto:${PLATFORM.supportEmail}?subject=${encodeURIComponent("Wildcat Clubs app test link")}`} className="font-medium text-brand-600 hover:underline">
                    {PLATFORM.supportEmail}
                  </a>{" "}
                  for the current test link or QR code. Opening it on your phone launches the app in Expo Go.
                </p>
              </li>
              <li className="rounded-xl bg-muted/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand">Step 3</p>
                <p className="mt-1 font-semibold text-ink">Sign in</p>
                <p className="mt-1 text-sm text-ink-2">
                  Use your <span className="font-medium">@{INSTITUTION.studentEmailDomain}</span> (or <span className="font-medium">@{INSTITUTION.staffEmailDomain}</span>) account. Your clubs and calendar are already there.
                </p>
              </li>
            </ol>
            <details className="mt-6 rounded-xl border border-line px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium text-ink">Running the app yourself (for developers)</summary>
              <div className="mt-3 space-y-2 text-ink-2">
                <p>From the repository, start the Expo dev server and scan the QR code it prints with Expo Go (your phone and computer need to be on the same network):</p>
                <pre className="overflow-x-auto rounded-lg bg-[#1d1923] px-3 py-2 font-mono text-xs text-[#f4f2f7]">
                  <code>{"cd apps/mobile\nnpm install\nnpx expo start"}</code>
                </pre>
              </div>
            </details>
          </section>
        ) : null}

        <Callout tone="brand" className="mt-10" icon={<Smartphone />} title="No phone handy?">
          Everything in the app also works on the web. Leaders can add you to a meeting&rsquo;s attendance by hand, and you can follow your clubs from{" "}
          <Link href={user ? "/dashboard" : "/clubs"} className="font-medium underline underline-offset-2">
            {user ? "your dashboard" : "the clubs list"}
          </Link>
          .
        </Callout>
      </div>
    </div>
  );
}
