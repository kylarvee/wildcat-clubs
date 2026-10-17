import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, CircleDashed, Inbox, KeyRound, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { authMode, googleConfigured } from "@/lib/auth/google";
import { can } from "@/lib/authz";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { DAY_MS } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Callout, PageHeader } from "@/components/ui/layout";
import { CONFIG_COPY } from "@/components/system/config-copy";
import { CredentialList, IntegrationSwitch, type Credential } from "@/components/system/IntegrationSwitch";

export const metadata: Metadata = { title: "AI & integrations" };

/** Presence only — the values of keys and secrets never reach the page. */
const has = (name: string) => Boolean(process.env[name]?.trim());

const MODE_COPY = {
  both: { label: "Test personas and Google", text: "People can sign in with Google or pick a test persona. Fine for pilots; switch to Google only before launch." },
  mock: { label: "Test personas only", text: "Only the seeded test personas can sign in. Google sign-in is hidden." },
  google: { label: "Google only", text: "Everyone signs in with their Weber State Google account. Test personas are off." },
} as const;

/**
 * AI & integrations (system.config): the Claude switches, Google Workspace
 * and push switches with whether their credentials are present, and how
 * sign-in is set up. Everything works with all of these off (mock mode).
 */
export default async function IntegrationsPage() {
  const user = await requireUser("/system/integrations");
  if (!can(user, "system.config")) notFound();

  const cfg = await getConfig();
  const since = new Date(Date.now() - 7 * DAY_MS);
  const outboxWeek = await db.outboxMessage.groupBy({ by: ["channel", "status"], where: { createdAt: { gte: since } }, _count: { _all: true } });
  const weekCount = (channel: "EMAIL" | "PUSH", status: "MOCKED" | "SENT" | "FAILED") => outboxWeek.find((r) => r.channel === channel && r.status === status)?._count._all ?? 0;

  const anthropic: Credential = { name: "ANTHROPIC_API_KEY", present: has("ANTHROPIC_API_KEY") };
  const serviceAccount: Credential = { name: "GOOGLE_SERVICE_ACCOUNT_JSON", present: has("GOOGLE_SERVICE_ACCOUNT_JSON") };
  const mode = authMode();
  const googleReady = googleConfigured();
  const mockedEmails = weekCount("EMAIL", "MOCKED");
  const mockedPushes = weekCount("PUSH", "MOCKED");
  const failed = weekCount("EMAIL", "FAILED") + weekCount("PUSH", "FAILED");
  const signInCredentials: Credential[] = [
    { name: "GOOGLE_CLIENT_ID", present: has("GOOGLE_CLIENT_ID") },
    { name: "GOOGLE_CLIENT_SECRET", present: has("GOOGLE_CLIENT_SECRET") },
    { name: "GOOGLE_IOS_CLIENT_ID", present: has("GOOGLE_IOS_CLIENT_ID"), note: "iPhone app" },
    { name: "GOOGLE_ANDROID_CLIENT_ID", present: has("GOOGLE_ANDROID_CLIENT_ID"), note: "Android app" },
  ];

  const google = (key: "integrations.googleCalendar" | "integrations.googleDrive" | "integrations.googleChat", offText: string) => (
    <IntegrationSwitch
      configKey={key}
      title={CONFIG_COPY[key].label}
      help={CONFIG_COPY[key].help}
      checked={cfg[key]}
      credentials={[serviceAccount]}
      offText={offText}
      missingText="Still in mock mode: add the Workspace service account key to the server's environment."
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI & integrations"
        description="Everything on Wildcat Clubs works with these off — that's mock mode. A feature goes live only when its switch is on and its credentials are set on the server."
      />

      <Callout tone="info" icon={<KeyRound />}>
        Keys and secrets live in the server&rsquo;s environment, never in the database. This page only shows whether each one is set.
      </Callout>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand" aria-hidden /> Claude
            </span>
          }
          description="Claude features stay hidden everywhere until this is on and ANTHROPIC_API_KEY is set. Claude never sees reports from Report a concern."
        />
        <div className="divide-y divide-line">
          <IntegrationSwitch
            configKey="ai.assistantEnabled"
            title={CONFIG_COPY["ai.assistantEnabled"].label}
            help={CONFIG_COPY["ai.assistantEnabled"].help}
            checked={cfg["ai.assistantEnabled"]}
            credentials={[anthropic]}
            offText="Hidden everywhere. Nobody sees an assistant button."
            missingText="Still hidden: add ANTHROPIC_API_KEY to the server's environment."
          />
          <IntegrationSwitch
            configKey="ai.gradingEnabled"
            title={CONFIG_COPY["ai.gradingEnabled"].label}
            help={CONFIG_COPY["ai.gradingEnabled"].help}
            checked={cfg["ai.gradingEnabled"]}
            credentials={[anthropic]}
            offText="Hidden. Graders read open answers and grade them by hand."
            missingText="Still hidden: add ANTHROPIC_API_KEY to the server's environment."
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Google Workspace" description="One service account with domain-wide delegation, set up once by WSU's Workspace administrators, covers Calendar, Drive, Chat and Gmail." />
        <div className="divide-y divide-line">
          {google("integrations.googleCalendar", "Events live on Wildcat Clubs and its calendar feeds (ICS). Nothing is copied to Google Calendar.")}
          {google("integrations.googleDrive", "Club files are stored on Wildcat Clubs only.")}
          {google("integrations.googleChat", "Club and leader chats run in the app only.")}
        </div>
      </Card>

      <Card>
        <CardHeader title="Email and push" description="While these are off, every email and push is recorded in the outbox instead of being sent — that's how testers read them." />
        <div className="divide-y divide-line">
          <IntegrationSwitch
            configKey="integrations.email"
            title={CONFIG_COPY["integrations.email"].label}
            help={CONFIG_COPY["integrations.email"].help}
            checked={cfg["integrations.email"]}
            credentials={[serviceAccount, { name: "PLATFORM_SENDER_EMAIL", present: has("PLATFORM_SENDER_EMAIL"), optional: true, note: has("PLATFORM_SENDER_EMAIL") ? undefined : "sends as clubs@weber.edu" }]}
            offText={`Recorded in the outbox instead of sent${mockedEmails ? ` — ${mockedEmails.toLocaleString()} in the last 7 days` : ""}.`}
            missingText="Still recorded in the outbox: add the Workspace service account key to send through Gmail."
          />
          <IntegrationSwitch
            configKey="integrations.push"
            title={CONFIG_COPY["integrations.push"].label}
            help={CONFIG_COPY["integrations.push"].help}
            checked={cfg["integrations.push"]}
            credentials={[]}
            offText={`Recorded in the outbox instead of sent${mockedPushes ? ` — ${mockedPushes.toLocaleString()} in the last 7 days` : ""}. Expo's push service needs no key.`}
            missingText=""
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
          <span className="text-ink-3">{failed ? `${failed.toLocaleString()} failed in the last 7 days.` : "No failed sends in the last 7 days."}</span>
          <Link href="/system/outbox" className="inline-flex items-center gap-1.5 font-medium text-brand-600 hover:underline">
            <Inbox className="h-4 w-4" aria-hidden /> Open the outbox
          </Link>
        </div>
      </Card>

      <Card>
        <CardHeader title="Sign-in" description="Set in the server's environment rather than with a switch, so a wrong click here can't lock everyone out." />
        <dl className="divide-y divide-line text-sm">
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
            <dt className="font-medium text-ink">Google sign-in</dt>
            <dd className="space-y-2">
              <p className="flex flex-wrap items-center gap-2">
                {googleReady ? (
                  <Badge tone="success">
                    <CircleCheck className="h-3 w-3" aria-hidden /> Ready
                  </Badge>
                ) : (
                  <Badge>
                    <CircleDashed className="h-3 w-3" aria-hidden /> Not set up
                  </Badge>
                )}
                <span className="text-ink-2">
                  {googleReady ? "Weber State Google accounts (@mail.weber.edu and @weber.edu) can sign in." : "Add the OAuth client ID and secret for the Weber State Workspace to turn on Google sign-in."}
                </span>
              </p>
              <CredentialList items={signInCredentials} />
            </dd>
          </div>
          <div className="grid gap-1 px-5 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
            <dt className="font-medium text-ink">Test personas</dt>
            <dd className="space-y-1">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={mode === "google" ? "neutral" : "warning"}>{MODE_COPY[mode].label}</Badge>
                <span className="text-ink-2">{MODE_COPY[mode].text}</span>
              </p>
              <p className="text-xs text-ink-3">
                Set with <code className="font-mono">AUTH_MODE</code> = <code className="font-mono">mock</code>, <code className="font-mono">google</code> or <code className="font-mono">both</code>. Without it, production uses Google only.
              </p>
              {mode !== "mock" && !googleReady ? <p className="text-xs text-warning">Google sign-in is allowed but not set up, so only test personas can sign in right now.</p> : null}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
