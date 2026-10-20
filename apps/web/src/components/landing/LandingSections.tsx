import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  CalendarCheck2,
  ClipboardCheck,
  Compass,
  FileSignature,
  GraduationCap,
  Landmark,
  Network,
  ScanLine,
  Sprout,
  Star,
  UsersRound,
  Archive,
  Rocket,
} from "lucide-react";
import type { PlatformSummary } from "@/lib/metrics";
import type { ClubListItem, UpcomingEvent } from "@/lib/clubs/queries";
import { INSTITUTION, PLATFORM } from "@/lib/institution";
import { fmtDate, fmtTime } from "@/lib/time";
import { ClubLogo } from "@/components/ui/avatar";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { NetworkGraph } from "@/components/network/NetworkGraph";
import { safeHex } from "@/components/clubs/labels";
import { HeroPattern } from "@/components/landing/HeroPattern";
import { CheckinsChart } from "@/components/landing/CheckinsChart";

/* ─── Hero ────────────────────────────────────────────────────────────────── */

export function LandingHero({ firstName, events, clubs }: { firstName: string | null; events: UpcomingEvent[]; clubs: ClubListItem[] }) {
  const signedIn = firstName !== null;
  const side = events.length ? <UpNextCard events={events.slice(0, 3)} /> : clubs.length >= 4 ? <ClubMosaic clubs={clubs.slice(0, 6)} /> : null;
  return (
    <section className="relative isolate overflow-hidden bg-brand-700 text-white" aria-labelledby="hero-title">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(900px_500px_at_15%_-10%,#5b2d7e,transparent_70%),radial-gradient(700px_420px_at_100%_110%,#2a1340,transparent_70%)]" aria-hidden="true" />
      <HeroPattern className="absolute inset-y-0 right-0 -z-10 h-full w-full opacity-60 lg:w-2/3" />
      <div className={cn("mx-auto grid max-w-7xl gap-12 px-4 py-14 sm:px-6 sm:py-20", side ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center" : "")}>
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-100 ring-1 ring-inset ring-white/15 backdrop-blur">
            <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
            {INSTITUTION.name} · with {INSTITUTION.studentGovernment}
          </p>
          <h1 id="hero-title" className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight text-balance sm:text-6xl">
            {signedIn ? (
              <>
                Welcome back, {firstName}.
                <span className="mt-2 block text-brand-200">What are we joining today?</span>
              </>
            ) : (
              <>
                Find your people.
                <span className="block text-brand-200">Start something.</span>
                <span className="block">Keep it going.</span>
              </>
            )}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-brand-100 text-pretty">
            {PLATFORM.name} is home base for every student club at {INSTITUTION.shortName}. Browse clubs, join in a click, check in with your phone — and if you lead one, run the whole thing in one place.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {signedIn ? (
              <>
                <Link href="/dashboard" className={buttonClasses("primary", "lg", "bg-white text-brand-700 hover:bg-brand-50 active:bg-brand-100")}>
                  Go to your dashboard <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link href="/clubs" className={buttonClasses("outline", "lg", "border-white/30 bg-white/5 text-white hover:bg-white/15")}>
                  Browse clubs
                </Link>
              </>
            ) : (
              <>
                <Link href="/clubs" className={buttonClasses("primary", "lg", "bg-white text-brand-700 hover:bg-brand-50 active:bg-brand-100")}>
                  Browse clubs <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link href="/login" className={buttonClasses("outline", "lg", "border-white/30 bg-white/5 text-white hover:bg-white/15")}>
                  Sign in
                </Link>
              </>
            )}
          </div>
          {!signedIn ? (
            <p className="mt-4 text-sm text-brand-200">
              Sign in with your Weber State Google account — @{INSTITUTION.studentEmailDomain} for students, @{INSTITUTION.staffEmailDomain} for faculty and staff.
            </p>
          ) : null}
        </div>
        {side}
      </div>
    </section>
  );
}

function UpNextCard({ events }: { events: UpcomingEvent[] }) {
  return (
    <div className="rounded-2xl bg-white p-2 text-ink shadow-[0_30px_60px_-20px_rgb(0_0_0/0.5)] ring-1 ring-white/20">
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <p className="text-sm font-semibold">Up next on campus</p>
        <a href="#events" className="text-xs font-medium text-brand-600 hover:underline">
          See more
        </a>
      </div>
      <ul>
        {events.map((e) => (
          <li key={e.occurrenceId} className="relative flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/60">
            <span className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-line py-1 leading-none" aria-hidden="true">
              <span className="text-[10px] font-semibold uppercase" style={{ color: safeHex(e.host?.logoColor) }}>
                {fmtDate(e.startsAt, "MMM")}
              </span>
              <span className="mt-0.5 text-lg font-bold">{fmtDate(e.startsAt, "d")}</span>
            </span>
            <span className="min-w-0 flex-1">
              <Link
                href={`/events/${e.eventId}?o=${e.occurrenceId}`}
                className="block truncate text-sm font-semibold after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand"
              >
                {e.title}
              </Link>
              <span className="block truncate text-xs text-ink-3">
                <span className="sr-only">{fmtDate(e.startsAt, "EEEE, MMMM d")}, </span>
                {e.happeningNow ? "Happening now" : e.allDay ? "All day" : fmtTime(e.startsAt)} · {e.host ? e.host.name : INSTITUTION.shortName}
              </span>
            </span>
            {e.host ? (
              <Link href={`/clubs/${e.host.slug}`} className="relative shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-brand" aria-label={`Open ${e.host.name}`}>
                <ClubLogo name={e.host.name} src={e.host.logoUrl} color={e.host.logoColor} size="sm" />
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClubMosaic({ clubs }: { clubs: ClubListItem[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Some of the clubs on Wildcat Clubs">
      {clubs.map((c, i) => (
        <li key={c.id} className={cn(i % 2 ? "sm:translate-y-6" : "")}>
          <Link
            href={`/clubs/${c.slug}`}
            className="flex h-full flex-col items-start gap-3 rounded-2xl bg-white/10 p-4 ring-1 ring-inset ring-white/15 backdrop-blur transition hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
          >
            <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="md" />
            <span className="line-clamp-2 text-sm font-semibold leading-snug">{c.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ─── Live numbers ────────────────────────────────────────────────────────── */

export function hasNumbers(s: PlatformSummary) {
  return (s.clubsByStatus.APPROVED ?? 0) > 0 || s.activeStudents > 0 || s.checkinsThisTerm > 0;
}

export function LiveNumbers({ summary }: { summary: PlatformSummary }) {
  const tiles = [
    { label: "Approved clubs", value: summary.clubsByStatus.APPROVED ?? 0, hint: `${summary.activeClubs.toLocaleString("en-US")} active this term` },
    { label: "Students showing up", value: summary.activeStudents, hint: "Active in at least one club" },
    {
      label: "Check-ins this term",
      value: summary.checkinsThisTerm,
      hint: `Across ${summary.eventsThisTerm.toLocaleString("en-US")} events${summary.termName ? ` in ${summary.termName}` : ""}`,
    },
    { label: "Cross-club visits", value: summary.crossClubCheckinsThisTerm, hint: "Members showing up for another club this term" },
  ];
  const months = summary.monthlyCheckins.slice(-8);
  // The newest month is usually still running; draw it lighter so a half-month doesn't read as a drop.
  const thisMonth = fmtDate(new Date(), "MMM yyyy");
  const lastIsPartial = months.length > 0 && (months[months.length - 1].month === thisMonth || months[months.length - 1].month === fmtDate(new Date(), "yyyy-MM"));
  return (
    <section aria-labelledby="numbers-title" className="relative z-10 mx-auto -mt-10 max-w-7xl px-4 sm:px-6">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-pop)] sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="numbers-title" className="text-sm font-semibold uppercase tracking-wide text-ink-3">
            Live on campus
          </h2>
          <p className="text-xs text-ink-3">Counted from real check-ins, updated as they happen</p>
        </div>
        <div className={cn("mt-4 grid gap-6", months.length >= 3 ? "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" : "")}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="min-w-0">
                <dt className="text-sm text-ink-2">{t.label}</dt>
                <dd className="mt-1 text-3xl font-bold tracking-tight text-ink sm:text-4xl">{t.value.toLocaleString("en-US")}</dd>
                <dd className="mt-0.5 text-xs leading-snug text-ink-3">{t.hint}</dd>
              </div>
            ))}
          </dl>
          {months.length >= 3 ? (
            <div className="min-w-0 border-t border-line pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <p className="text-sm font-semibold text-ink">Check-ins per month</p>
              <CheckinsChart months={months} lastIsPartial={lastIsPartial} />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/* ─── Find · Found · Run · Retire ─────────────────────────────────────────── */

const LIFECYCLE = [
  { icon: Compass, title: "Find", body: "Browse every approved club, sort by rating, activity or major, and register in one click. Their events land on your calendar." },
  { icon: Sprout, title: "Found", body: "Pick a club type, invite a faculty advisor, build your constitution from a template, and send it to WSUSA — all from one checklist." },
  { icon: Rocket, title: "Run", body: "Plan events, take attendance with a QR code, request funding, post announcements and grow your officer team." },
  { icon: Archive, title: "Retire", body: "When a club winds down, its history, officers and files stay on record — ready for whoever brings it back." },
];

export function Lifecycle() {
  return (
    <section aria-labelledby="lifecycle-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold text-brand">One place for a club&rsquo;s whole life</p>
        <h2 id="lifecycle-title" className="mt-2 text-3xl font-bold tracking-tight text-ink text-balance sm:text-4xl">
          Find it, found it, run it, retire it.
        </h2>
        <p className="mt-3 text-lg text-ink-2">No more scattered forms and spreadsheets. Every step of a Weber State club happens here, and nothing gets lost between leaders.</p>
      </div>
      <div className="relative mt-12">
        <div className="absolute left-6 right-6 top-6 hidden h-px bg-gradient-to-r from-brand-200 via-brand-200 to-transparent lg:block" aria-hidden="true" />
      <ol className="relative grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
        {LIFECYCLE.map((s, i) => (
          <li key={s.title} className="relative">
            <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-white shadow-md ring-4 ring-canvas" aria-hidden="true">
              <s.icon className="h-5 w-5" />
            </span>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-3">Step {i + 1}</p>
            <h3 className="mt-0.5 text-xl font-bold text-ink">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
      </div>
    </section>
  );
}

/* ─── How it works for each audience ──────────────────────────────────────── */

export function Audiences({ reviewThreshold }: { reviewThreshold: number }) {
  const cards: { icon: typeof UsersRound; who: string; title: string; points: string[]; cta?: { href: string; label: string } }[] = [
    {
      icon: UsersRound,
      who: "Students",
      title: "Find clubs that fit — and show up",
      points: [
        "Search by major, college or interest, and see how active each club really is.",
        "Register in a click, or just follow a club's calendar.",
        "Scan the QR code at meetings to check in, and keep your attendance on record.",
        `Leave a review after you've been to ${reviewThreshold} events.`,
      ],
      cta: { href: "/clubs", label: "Browse clubs" },
    },
    {
      icon: ClipboardCheck,
      who: "Club leaders",
      title: "Run your club without the paperwork chase",
      points: [
        "Events, attendance, budget, files, announcements and your org chart in one workspace.",
        "Give each officer exactly the permissions their seat needs.",
        "Co-host with other clubs and see who crosses over.",
        "Hand off to the next president cleanly — history stays put.",
      ],
    },
    {
      icon: Building2,
      who: "Faculty & staff advisors",
      title: "Advise without the email ping-pong",
      points: [
        "Accept an advisor invite straight from your Tasks.",
        "See everything your club does, and step in when it matters.",
        "Approve requests from your task list, not a stack of forms.",
      ],
    },
    {
      icon: Landmark,
      who: "WSUSA admins",
      title: "Oversight that keeps itself up to date",
      points: [
        "Review new clubs, constitutions and funding requests in one queue.",
        "Publish policies and officer trainings once — they show up where they apply.",
        "See activity, retention and cross-club connections across campus.",
      ],
    },
  ];
  return (
    <section aria-labelledby="audiences-title" className="border-y border-line bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-brand">How it works for you</p>
          <h2 id="audiences-title" className="mt-2 text-3xl font-bold tracking-tight text-ink text-balance sm:text-4xl">
            Built for everyone who makes a club happen.
          </h2>
        </div>
        <ul className="mt-10 grid gap-5 md:grid-cols-2">
          {cards.map((c, i) => (
            <li
              key={c.who}
              className={cn(
                "flex flex-col rounded-[var(--radius-card)] border p-6 sm:p-7",
                i === 0 ? "border-brand-100 bg-gradient-to-br from-brand-50 to-surface" : "border-line bg-canvas/60",
              )}
            >
              <div className="flex items-center gap-3">
                <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", i === 0 ? "bg-brand text-white" : "bg-brand-50 text-brand")} aria-hidden="true">
                  <c.icon className="h-5 w-5" />
                </span>
                <p className="text-sm font-semibold text-brand">{c.who}</p>
              </div>
              <h3 className="mt-4 text-xl font-bold text-ink">{c.title}</h3>
              <ul className="mt-3 flex-1 space-y-2">
                {c.points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-sm leading-relaxed text-ink-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-200" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
              {c.cta ? (
                <Link href={c.cta.href} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
                  {c.cta.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ─── Section shell ───────────────────────────────────────────────────────── */

export function LandingSection({ id, eyebrow, title, action, children, className }: { id: string; eyebrow: string; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6", className)}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-brand">{eyebrow}</p>
          <h2 id={`${id}-title`} className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {title}
          </h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ─── Network preview ─────────────────────────────────────────────────────── */

export function NetworkPreview() {
  return (
    <section aria-labelledby="network-title" className="bg-ink text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-brand-200">
            <Network className="h-4 w-4" aria-hidden="true" /> The club network
          </p>
          <h2 id="network-title" className="mt-2 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Clubs that show up for each other.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-white/75">
            Every time a member of one club checks in at another club&rsquo;s event, the line between them gets a little thicker. Busy clubs grow bigger, and the most connected ones drift to the middle — nobody arranges it by hand.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-white/75">
            <li className="flex items-center gap-2.5">
              <ScanLine className="h-4 w-4 text-brand-200" aria-hidden="true" /> Built only from real check-ins
            </li>
            <li className="flex items-center gap-2.5">
              <CalendarCheck2 className="h-4 w-4 text-brand-200" aria-hidden="true" /> Group by club, college, department or major
            </li>
            <li className="flex items-center gap-2.5">
              <Star className="h-4 w-4 text-brand-200" aria-hidden="true" /> Click any club for its numbers and page
            </li>
          </ul>
          <ButtonLink href="/network" size="lg" className="mt-8 bg-white text-ink hover:bg-brand-50 active:bg-brand-100">
            Explore the network <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
        </div>
        <div className="min-w-0 overflow-hidden rounded-2xl shadow-2xl shadow-black/50 ring-1 ring-white/10">
          <NetworkGraph compact height={440} />
        </div>
      </div>
    </section>
  );
}

/* ─── Start a club ────────────────────────────────────────────────────────── */

export function StartClubCta({ href, reviewDays, office }: { href: string; reviewDays: number; office: string }) {
  const steps = [
    { icon: Compass, label: "Pick a club type" },
    { icon: UsersRound, label: "Invite a faculty advisor" },
    { icon: FileSignature, label: "Build your constitution" },
    { icon: Landmark, label: "Send it to WSUSA" },
  ];
  return (
    <section aria-labelledby="start-title" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
      <div className="relative isolate overflow-hidden rounded-3xl bg-brand px-6 py-12 text-white sm:px-12 sm:py-14">
        <HeroPattern className="absolute inset-0 -z-10 h-full w-full opacity-40" />
        <div className="max-w-2xl">
          <h2 id="start-title" className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Have an idea for a club?
          </h2>
          <p className="mt-3 text-lg text-brand-100">
            Start it here. We&rsquo;ll walk you through everything {INSTITUTION.studentGovernment} needs, and you can save your progress and come back anytime.
          </p>
        </div>
        <ol className="mt-8 flex flex-wrap gap-2">
          {steps.map((s, i) => (
            <li key={s.label} className="inline-flex items-center gap-2 rounded-full bg-white/10 py-1.5 pl-1.5 pr-3.5 text-sm ring-1 ring-inset ring-white/15">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-brand" aria-hidden="true">
                {i + 1}
              </span>
              {s.label}
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link href={href} className={buttonClasses("primary", "lg", "bg-white text-brand-700 hover:bg-brand-50 active:bg-brand-100")}>
            Start a club <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <p className="text-sm text-brand-100">
            {office} usually reviews new clubs within {reviewDays} days.
          </p>
        </div>
      </div>
    </section>
  );
}
