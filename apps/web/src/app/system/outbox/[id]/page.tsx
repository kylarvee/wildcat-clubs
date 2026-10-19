import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { PLATFORM } from "@/lib/institution";
import { fmtLongDate, fmtTime } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { Callout, KeyValue, PageHeader } from "@/components/ui/layout";
import { ChannelIcon, LinkedText, OUTBOX_CHANNEL_LABEL, OutboxStatusBadge, outboxKindLabel, toLocalPath } from "@/components/system/outbox";

export const metadata: Metadata = { title: "Outbox message" };

type Params = Promise<{ id: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

/** One outbox message, shown the way its recipient would read it. */
export default async function OutboxMessagePage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { id } = await params;
  const user = await requireUser(`/system/outbox/${id}`);
  if (!can(user, "system.config")) notFound();
  const sp = await searchParams;

  const m = await db.outboxMessage.findUnique({ where: { id } });
  if (!m) notFound();
  const device = m.channel === "PUSH" ? await db.pushToken.findUnique({ where: { token: m.to }, select: { platform: true, user: { select: { id: true, name: true, email: true } } } }) : null;
  const emailOwner = m.channel === "EMAIL" ? await db.user.findUnique({ where: { email: m.to }, select: { id: true, name: true } }) : null;

  // Keep the list's filters when going back.
  const back = new URLSearchParams();
  for (const k of ["channel", "status", "q", "page"]) {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (s) back.set(k, s);
  }
  const backHref = back.size ? `/system/outbox?${back}` : "/system/outbox";
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const sender = process.env.PLATFORM_SENDER_EMAIL ?? "clubs@weber.edu";
  const localLink = m.href ? (m.href.startsWith("/") ? m.href : toLocalPath(m.href, appUrl)) : null;
  const when = (d: Date) => `${fmtLongDate(d)} at ${fmtTime(d)}`;
  const queued = m.status === "QUEUED";
  // A queued message went out with a later run; others went out as they were made.
  const sentAt = when(!queued && m.sentAt ? m.sentAt : m.createdAt);
  const waited = !queued && m.sentAt && m.sentAt.getTime() - m.createdAt.getTime() > 60_000;
  const kind = outboxKindLabel(m.kind);

  return (
    <div className="space-y-6">
      <PageHeader
        title={m.subject || "(no subject)"}
        breadcrumbs={[
          { href: backHref, label: "Outbox" },
          { label: OUTBOX_CHANNEL_LABEL[m.channel] },
        ]}
        actions={
          <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the outbox
          </Link>
        }
        className="[&_h1]:[overflow-wrap:anywhere]"
      />

      {m.status === "FAILED" ? (
        <Callout tone="danger" title="This message wasn't delivered">
          <span className="break-all font-mono text-xs">{m.error ?? "No error details were recorded."}</span>
        </Callout>
      ) : m.status === "MOCKED" ? (
        <Callout tone="info" title="Recorded, not sent">
          {m.channel === "EMAIL" ? "Email" : "Push"} was in mock mode when this went out, so nobody received it. This is exactly what they would have received.
        </Callout>
      ) : queued ? (
        <Callout tone="info" title="Waiting to send">
          This is part of a big send, so it waits for the <span className="font-medium">Send queued messages</span> job, which sends the oldest waiting messages first, about 200 a run.{" "}
          <Link href="/system/jobs" className="font-medium underline underline-offset-2">
            Run the jobs now
          </Link>
          .
        </Callout>
      ) : null}

      <Card className="p-4 sm:p-5">
        <KeyValue
          items={[
            {
              label: "To",
              value:
                m.channel === "PUSH" ? (
                  device ? (
                    <>
                      <Link href={`/admin/users/${device.user.id}`} className="font-medium text-brand-600 hover:underline">
                        {device.user.name}
                      </Link>
                      <span className="text-ink-3"> · {device.platform === "ios" ? "iPhone" : device.platform === "android" ? "Android" : device.platform} app</span>
                    </>
                  ) : (
                    <span className="text-ink-3">A device that's no longer registered</span>
                  )
                ) : (
                  <span className="break-all">
                    {emailOwner ? (
                      <Link href={`/admin/users/${emailOwner.id}`} className="font-medium text-brand-600 hover:underline">
                        {emailOwner.name}
                      </Link>
                    ) : null}
                    {emailOwner ? <span className="text-ink-3"> · </span> : null}
                    {m.to}
                  </span>
                ),
            },
            { label: "Status", value: <OutboxStatusBadge status={m.status} /> },
            { label: queued ? "Queued" : m.status === "MOCKED" ? "Recorded" : m.status === "FAILED" ? "Tried" : "Sent", value: sentAt },
            ...(waited ? [{ label: "Queued", value: when(m.createdAt) }] : []),
            ...(kind ? [{ label: "Notification", value: <span className="break-all font-mono text-xs text-ink-2">{kind}</span> }] : []),
            {
              label: "Opens",
              value: localLink ? (
                <Link href={localLink} className="break-all text-brand-600 hover:underline">
                  {localLink}
                </Link>
              ) : m.href ? (
                <a href={m.href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all text-brand-600 hover:underline">
                  {m.href} <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </a>
              ) : (
                <span className="text-ink-3">No link</span>
              ),
            },
          ]}
        />
      </Card>

      {m.channel === "EMAIL" ? (
        <Card className="overflow-hidden">
          <div className="space-y-1 border-b border-line bg-muted/50 px-4 py-3 text-sm sm:px-5">
            <p className="break-all">
              <span className="text-ink-3">From </span>
              <span className="font-medium text-ink">
                {PLATFORM.name} &lt;{sender}&gt;
              </span>
            </p>
            <p className="break-all">
              <span className="text-ink-3">To </span>
              <span className="text-ink">{m.to}</span>
            </p>
            <p className="text-ink-3">{sentAt}</p>
            <p className="pt-1 text-base font-semibold text-ink [overflow-wrap:anywhere]">{m.subject}</p>
          </div>
          <div className="whitespace-pre-wrap px-4 py-5 text-sm leading-relaxed text-ink [overflow-wrap:anywhere] sm:px-5">
            <LinkedText text={m.body} appUrl={appUrl} />
          </div>
        </Card>
      ) : (
        <div className="max-w-sm rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
              <ChannelIcon channel="PUSH" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="flex items-baseline justify-between gap-2 text-xs text-ink-3">
                <span className="font-medium uppercase tracking-wide">{PLATFORM.name}</span>
                <span>{fmtTime(m.createdAt)}</span>
              </p>
              <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{m.subject}</p>
              {m.body ? <p className="text-sm text-ink-2 [overflow-wrap:anywhere]">{m.body}</p> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
