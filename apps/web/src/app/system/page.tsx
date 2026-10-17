import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Info } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { CONFIG_DEFAULTS, getConfig, type ConfigKey } from "@/lib/config";
import { db } from "@/lib/db";
import { fmtLongDate } from "@/lib/time";
import { Callout, PageHeader } from "@/components/ui/layout";
import { CONFIG_COPY } from "@/components/system/config-copy";
import { RulesSection, type RuleField, type RuleSummary } from "@/components/system/RulesSection";
import { WsusaContactsForm } from "@/components/system/WsusaContactsForm";

export const metadata: Metadata = { title: "Platform rules" };

type IntKey = { [K in ConfigKey]: (typeof CONFIG_DEFAULTS)[K] extends number ? K : never }[ConfigKey];
type StringKey = { [K in ConfigKey]: (typeof CONFIG_DEFAULTS)[K] extends string ? K : never }[ConfigKey];

const SECTIONS: { id: string; title: string; description: string; summary: RuleSummary; keys: IntKey[] }[] = [
  {
    id: "activity",
    title: "Activity rules",
    description: "Who counts as an active student and which clubs count as active. These drive the clubs list, club pages, analytics, elections and the network map.",
    summary: "activity",
    keys: ["activity.studentWindowDays", "activity.studentRecentEvents", "activity.clubMinEvents", "activity.clubMinMembers"],
  },
  {
    id: "reviews",
    title: "Reviews",
    description: "When students can review a club, and when the platform asks an administrator to look for review bombing.",
    summary: "reviews",
    keys: ["reviews.minAttendance", "reviews.bombingCount", "reviews.bombingMaxRating", "reviews.bombingWindowHours", "reviews.flagThreshold"],
  },
  {
    id: "checkin",
    title: "Check-in",
    description: "When the attendance QR code and self check-in work for an event.",
    summary: "checkin",
    keys: ["checkin.opensMinutesBefore", "checkin.closesMinutesAfter", "checkin.qrRotateSeconds"],
  },
];

const APP_KEYS: StringKey[] = ["app.iosUrl", "app.androidUrl"];

/**
 * Platform rules (system.config): every system setting except the AI and
 * integration switches, which live on their own page. Defaults come from
 * lib/config; saving goes through lib/domain/system.setConfigs.
 */
export default async function PlatformRulesPage() {
  const user = await requireUser("/system");
  if (!can(user, "system.config")) notFound();

  const [cfg, rows] = await Promise.all([getConfig(), db.systemConfig.findMany({ select: { key: true, updatedAt: true, updatedById: true } })]);
  const editors = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.updatedById).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } });
  const nameOf = new Map(editors.map((u) => [u.id, u.name]));
  const stored = new Map(rows.map((r) => [r.key, r]));

  /** "Last changed by Sydney Park on Oct 3, 2026" for the newest saved key in a section. */
  const lastChanged = (keys: ConfigKey[]) => {
    const latest = keys
      .map((k) => stored.get(k))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    if (!latest) return null;
    const who = latest.updatedById ? nameOf.get(latest.updatedById) : null;
    return `Last saved${who ? ` by ${who}` : ""} on ${fmtLongDate(latest.updatedAt)}`;
  };

  const intField = (key: IntKey): RuleField => {
    const c = CONFIG_COPY[key];
    return { kind: "int", key, label: c.label, help: c.help, unit: c.unit ?? "", min: c.min ?? 0, max: c.max ?? 1000, value: cfg[key], defaultValue: CONFIG_DEFAULTS[key] };
  };
  const urlField = (key: StringKey, placeholder: string): RuleField => {
    const c = CONFIG_COPY[key];
    return { kind: "url", key, label: c.label, help: c.help, placeholder, value: cfg[key], defaultValue: CONFIG_DEFAULTS[key] };
  };

  const jump = [...SECTIONS.map((s) => ({ id: s.id, label: s.title })), { id: "wsusa", label: "WSUSA contacts" }, { id: "app", label: "Mobile app links" }];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform rules"
        description="The rules every club, page and report on Wildcat Clubs follows. Changes apply right away — numbers like activity and review eligibility are recomputed from attendance, so nothing needs re-running."
      />

      <nav aria-label="Sections on this page" className="flex gap-1.5 overflow-x-auto pb-1">
        {jump.map((j) => (
          <a key={j.id} href={`#${j.id}`} className="shrink-0 rounded-full bg-surface px-3 py-1 text-sm font-medium text-ink-2 ring-1 ring-inset ring-line-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand">
            {j.label}
          </a>
        ))}
      </nav>

      <Callout tone="info" icon={<Info />}>
        Claude and Google switches are on{" "}
        <Link href="/system/integrations" className="font-medium underline underline-offset-2">
          AI &amp; integrations
        </Link>
        . Term dates are on{" "}
        <Link href="/system/terms" className="font-medium underline underline-offset-2">
          Academic calendar
        </Link>
        .
      </Callout>

      {SECTIONS.map((s) => (
        <RulesSection key={s.id} id={s.id} title={s.title} description={s.description} summary={s.summary} fields={s.keys.map(intField)} lastChanged={lastChanged(s.keys)} />
      ))}

      <WsusaContactsForm
        office={cfg["wsusa.office"]}
        reviewers={cfg["wsusa.reviewers"]}
        placeholder={!stored.has("wsusa.office") || !stored.has("wsusa.reviewers")}
        lastChanged={lastChanged(["wsusa.office", "wsusa.reviewers"])}
      />

      <RulesSection
        id="app"
        title="Mobile app links"
        description="Store links for the “Get the app” prompt students see after registering for a club and on the Get the app page."
        fields={[urlField("app.iosUrl", "https://apps.apple.com/…"), urlField("app.androidUrl", "https://play.google.com/store/apps/…")]}
        lastChanged={lastChanged(APP_KEYS)}
      />
    </div>
  );
}
