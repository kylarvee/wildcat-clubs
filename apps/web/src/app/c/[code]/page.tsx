import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Ban, CalendarX2, Clock, KeyRound, Lock, QrCode, SearchX } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { reviewEligibility } from "@/lib/metrics";
import { checkinPreview } from "@/lib/domain/attendance";
import { normalizeCode } from "@/lib/attendance/rules";
import { CHECKIN_PASS_MAX_AGE_MS } from "@/lib/attendance/token";
import { Card } from "@/components/ui/card";
import { Callout } from "@/components/ui/layout";
import { buttonClasses } from "@/components/ui/button";
import { EventHeading } from "@/components/attendance/EventHeading";
import { CheckInPanel } from "@/components/attendance/CheckInPanel";
import { CheckInSuccess } from "@/components/attendance/CheckInSuccess";

export const metadata: Metadata = { title: "Check in", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/**
 * /c/<code> — the URL inside every check-in QR code (phone cameras open it
 * directly) and where typed codes land. Viewing it never records anything;
 * the "Check in" button does.
 */
export default async function CheckInPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: SearchParams }) {
  const { code: raw } = await params;
  const sp = await searchParams;
  const token = one(sp.t);
  const go = one(sp.go) === "1";

  // Typed URLs ("/c/abc-234") land on the canonical one.
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {}
  const norm = normalizeCode(decoded);
  if (norm.ok && norm.code !== raw) {
    const q = new URLSearchParams();
    if (token) q.set("t", token);
    if (go) q.set("go", "1");
    const qs = q.toString();
    redirect(`/c/${norm.code}${qs ? `?${qs}` : ""}`);
  }

  const actor = await getCurrentUser();
  const preview = await checkinPreview(actor, decoded, token);

  // ── A real code for an event this viewer can't see: no details, just the way in. ──
  if (!preview.found && preview.hidden) {
    const code = norm.ok ? norm.code : raw;
    return (
      <Frame code={code}>
        <Card className="p-5 sm:p-7">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand">
            {actor ? <QrCode className="h-6 w-6" aria-hidden /> : <Lock className="h-6 w-6" aria-hidden />}
          </div>
          <h1 className="mt-4 text-xl font-bold tracking-tight">{actor ? "Scan the QR code shown at the event" : "Log in to check in"}</h1>
          <p className="mt-1.5 text-ink-2">{preview.message}</p>
          {actor ? null : (
            <div className="mt-6">
              <LoginToCheckIn next={`/c/${code}?go=1`} />
            </div>
          )}
        </Card>
      </Frame>
    );
  }

  if (!preview.found) {
    return (
      <Frame footer={false}>
        <Card className="p-6 text-center sm:p-8">
          <SearchX className="mx-auto h-10 w-10 text-ink-3" aria-hidden />
          <h1 className="mt-3 text-xl font-bold tracking-tight">{norm.ok ? "We couldn't find that event" : "That code doesn't look right"}</h1>
          {norm.ok ? (
            <p className="mt-2 font-mono text-lg font-semibold tracking-widest text-ink">{norm.code}</p>
          ) : null}
          <p className="mt-2 text-ink-2">{preview.message}</p>
          <Link href="/checkin" className={buttonClasses("primary", "lg", "mt-6 w-full")}>
            <KeyRound className="h-5 w-5" aria-hidden /> Type the code
          </Link>
        </Card>
      </Frame>
    );
  }

  const { occurrence } = preview;
  const cfg = await getConfig();
  const rotate = cfg["checkin.qrRotateSeconds"];
  const passMinutes = Math.round(CHECKIN_PASS_MAX_AGE_MS / 60_000);

  // ── Signed out: log in, then land back here and finish automatically. ──
  if (!actor) {
    const next = `/c/${occurrence.code}?${preview.pass ? `t=${encodeURIComponent(preview.pass)}&` : ""}go=1`;
    return (
      <Frame code={occurrence.code}>
        <Card className="p-5 sm:p-7">
          <EventHeading occurrence={occurrence} />
          <div className="mt-6 space-y-3">
            {occurrence.cancelled ? (
              <Callout tone="warning" icon={<Ban />} title="This event was cancelled">
                Check-in is closed.
              </Callout>
            ) : (
              <>
                <p className="text-ink-2">Log in with your {INSTITUTION.shortName} account to check in.</p>
                <LoginToCheckIn next={next} />
                {preview.scan === "LIVE" ? (
                  <Callout tone="success" icon={<QrCode />}>
                    Your scan is saved for {passMinutes} minutes while you log in — you&apos;ll be checked in as soon as you&apos;re back.
                  </Callout>
                ) : preview.scan === "EXPIRED" ? (
                  <Callout tone="warning" icon={<QrCode />}>
                    This QR code has expired (it changes every {rotate} seconds). After you log in, scan the code on the screen again.
                  </Callout>
                ) : null}
              </>
            )}
          </div>
        </Card>
      </Frame>
    );
  }

  const me = await db.user.findUnique({ where: { id: actor.id }, select: { hasMobileApp: true } });
  const showGetApp = !me?.hasMobileApp;

  // ── Already on the list. ──
  if (preview.existing) {
    const review = occurrence.club ? await reviewEligibility(actor.id, occurrence.club.id) : null;
    return (
      <Frame code={occurrence.code}>
        <Card className="p-5 sm:p-7">
          <EventHeading occurrence={occurrence} />
          <div className="mt-6 border-t border-line pt-6">
            <CheckInSuccess
              result={{
                status: "ALREADY",
                method: preview.existing.method,
                checkedInAt: preview.existing.checkedInAt,
                occurrence,
                club: occurrence.club,
                membership: preview.membership,
                // Alumni and faculty/staff can't review, so they see no progress toward one.
                reviewProgress: review?.canReview ? review : null,
                requirementsMet: [],
              }}
              showGetApp={showGetApp}
            />
          </div>
        </Card>
      </Frame>
    );
  }

  // ── Can't check in (yet): say exactly why and what to do. ──
  if (!preview.ready) {
    const s = occurrence.windowState;
    const kind = occurrence.cancelled ? "cancelled" : s === "NOT_OPEN" ? "early" : s === "CLOSED" ? "closed" : "scan";
    const icon = { cancelled: <Ban />, early: <Clock />, closed: <CalendarX2 />, scan: <QrCode /> }[kind];
    const title = { cancelled: "This event was cancelled", early: "You're early!", closed: "Check-in is closed", scan: "Scan the QR code shown at the event" }[kind];
    return (
      <Frame code={occurrence.code}>
        <Card className="p-5 sm:p-7">
          <EventHeading occurrence={occurrence} />
          <div className="mt-6 space-y-4">
            <Callout tone={kind === "closed" || kind === "cancelled" ? "warning" : "info"} icon={icon} title={title}>
              {preview.blocker}
            </Callout>
            {kind === "scan" ? (
              <p className="text-sm text-ink-2">
                Point your phone&apos;s camera at the QR code on the screen at the event — it opens this page and checks you in with one tap.
              </p>
            ) : null}
            {occurrence.club ? (
              <Link href={`/clubs/${occurrence.club.slug}`} className={buttonClasses("outline", "lg", "w-full")}>
                Go to {occurrence.club.name}
              </Link>
            ) : null}
          </div>
        </Card>
      </Frame>
    );
  }

  // ── Ready: one big button. ──
  let note: string | null = null;
  if (occurrence.club && preview.membership === "NONE" && actor.kind === "STUDENT") {
    const club = await db.club.findUnique({ where: { id: occurrence.club.id }, select: { joinPolicy: true } });
    note =
      club?.joinPolicy === "APPROVAL"
        ? `Checking in also asks ${occurrence.club.name}'s leaders to add you as a member.`
        : `Checking in also makes you a member of ${occurrence.club.name}.`;
  }
  return (
    <Frame code={occurrence.code}>
      <Card className="p-5 sm:p-7">
        <EventHeading occurrence={occurrence} />
        <div className="mt-6">
          <p className="mb-3 text-sm text-ink-2">
            Checking in as <span className="font-medium text-ink">{actor.name}</span>{" "}
            <Link href={`/login?switch=1&next=${encodeURIComponent(`/c/${occurrence.code}${preview.pass ? `?t=${encodeURIComponent(preview.pass)}` : ""}`)}`} className="text-brand-600 underline-offset-2 hover:underline">
              Not you?
            </Link>
          </p>
          <CheckInPanel code={occurrence.code} pass={preview.pass} autoSubmit={go} showGetApp={showGetApp} note={note} />
        </div>
      </Card>
    </Frame>
  );
}

/** The big log-in button; `next` brings them back here to finish. */
function LoginToCheckIn({ next }: { next: string }) {
  return (
    <div className="space-y-3">
      <Link
        href={`/login?next=${encodeURIComponent(next)}`}
        className="flex h-16 w-full items-center justify-center rounded-2xl bg-brand text-lg font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        Log in to check in
      </Link>
      <p className="text-center text-sm text-ink-3">
        Use your @{INSTITUTION.studentEmailDomain} account. First time on {PLATFORM.name}? Logging in creates your account.
      </p>
    </div>
  );
}

function Frame({ children, code, footer = true }: { children: React.ReactNode; code?: string; footer?: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-8 sm:py-14">
      {children}
      {footer ? (
        <p className="mt-5 text-center text-sm text-ink-3">
          {code ? (
            <>
              Event code <span className="font-mono font-semibold tracking-widest text-ink-2">{code}</span> ·{" "}
            </>
          ) : null}
          <Link href="/checkin" className="font-medium text-brand-600 underline-offset-2 hover:underline">
            Wrong event? Enter a different code
          </Link>
        </p>
      ) : null}
    </div>
  );
}
