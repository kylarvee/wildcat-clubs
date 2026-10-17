import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { OutboxChannel, OutboxStatus, Prisma } from "@prisma/client";
import { Inbox } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { integrationLive } from "@/lib/config";
import { db } from "@/lib/db";
import { fmtDate, fmtLongDate, fmtTime } from "@/lib/time";
import { Callout, EmptyState, PageHeader, Stat } from "@/components/ui/layout";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterSelect, Pager } from "@/components/admin/Filters";
import { SearchForm } from "@/components/admin/SearchForm";
import { ChannelIcon, OUTBOX_CHANNEL_LABEL, OUTBOX_STATUS_LABEL, OutboxStatusBadge } from "@/components/system/outbox";

export const metadata: Metadata = { title: "Outbox" };

const PAGE_SIZE = 50;
const CHANNELS: OutboxChannel[] = ["EMAIL", "PUSH"];
const STATUSES: OutboxStatus[] = ["MOCKED", "SENT", "FAILED"];

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * The outbox (system.config): every email and push the platform sent or, in
 * mock mode, would have sent. This is where testers read "emails".
 */
export default async function OutboxPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser("/system/outbox");
  if (!can(user, "system.config")) notFound();
  const sp = await searchParams;
  const str = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || null;
  };
  const pick = <T extends string>(list: T[], v: string | null) => (list.includes(v as T) ? (v as T) : null);
  const channel = pick(CHANNELS, str("channel"));
  const status = pick(STATUSES, str("status"));
  const q = str("q")?.trim().slice(0, 100) ?? "";
  const page = Math.max(1, Number.parseInt(str("page") ?? "1", 10) || 1);

  // Push rows are addressed to device tokens; let a search by name or email find those too.
  const tokenMatches = q
    ? await db.pushToken.findMany({ where: { user: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } }, select: { token: true }, take: 200 })
    : [];
  const where: Prisma.OutboxMessageWhereInput = {
    ...(channel ? { channel } : {}),
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { to: { contains: q, mode: "insensitive" } },
            { subject: { contains: q, mode: "insensitive" } },
            ...(tokenMatches.length ? [{ to: { in: tokenMatches.map((t) => t.token) } }] : []),
          ],
        }
      : {}),
  };

  const [total, rows, byStatus, emailLive, pushLive] = await Promise.all([
    db.outboxMessage.count({ where }),
    db.outboxMessage.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, channel: true, to: true, subject: true, body: true, status: true, createdAt: true },
    }),
    db.outboxMessage.groupBy({ by: ["status"], _count: { _all: true } }),
    integrationLive("email"),
    integrationLive("push"),
  ]);
  const pushOwners = new Map(
    (await db.pushToken.findMany({ where: { token: { in: rows.filter((r) => r.channel === "PUSH").map((r) => r.to) } }, select: { token: true, user: { select: { name: true } } } })).map((t) => [t.token, t.user.name]),
  );
  const count = (s: OutboxStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(channel || status || q);
  const qs = new URLSearchParams(Object.entries({ channel, status, q: q || null, page: page > 1 ? String(page) : null }).filter((e): e is [string, string] => Boolean(e[1]))).toString();

  return (
    <div className="space-y-6">
      <PageHeader title="Outbox" description="Every email and push notification Wildcat Clubs sent — or, in mock mode, would have sent. Open one to read it the way the person would." />

      {!emailLive || !pushLive ? (
        <Callout tone="info" icon={<Inbox />} title="Mock mode is on">
          {!emailLive && !pushLive ? "Email and push are" : !emailLive ? "Email is" : "Push is"} switched off or missing credentials, so messages are recorded here instead of being sent. Change that on{" "}
          <Link href="/system/integrations" className="font-medium underline underline-offset-2">
            AI &amp; integrations
          </Link>
          .
        </Callout>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Recorded" value={count("MOCKED").toLocaleString()} hint="mock mode" />
        <Stat label="Sent" value={count("SENT").toLocaleString()} />
        <Stat label="Failed" value={count("FAILED").toLocaleString()} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <SearchForm action="/system/outbox" q={q} keep={{ channel, status }} label="Search the outbox" placeholder="Recipient, name or subject" />
        </div>
        <div className="grid w-full grid-cols-2 gap-3 sm:w-auto">
          <FilterSelect label="Channel" param="channel" value={channel} options={CHANNELS.map((c) => ({ value: c, label: OUTBOX_CHANNEL_LABEL[c] }))} allLabel="Email and push" className="sm:w-40" />
          <FilterSelect label="Status" param="status" value={status} options={STATUSES.map((s) => ({ value: s, label: OUTBOX_STATUS_LABEL[s] }))} allLabel="Any status" className="sm:w-40" />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={filtered ? "No messages match" : "The outbox is empty"}
          description={filtered ? "Try another recipient, or clear the filters." : "Emails and pushes show up here as soon as the platform sends one."}
          action={
            filtered ? (
              <Link href="/system/outbox" className="text-sm font-medium text-brand-600 hover:underline">
                Clear search and filters
              </Link>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          <Table>
            <THead>
              <tr>
                <TH className="w-10">
                  <span className="sr-only">Channel</span>
                </TH>
                <TH>Message</TH>
                <TH className="hidden md:table-cell">To</TH>
                <TH className="hidden sm:table-cell">Status</TH>
                <TH className="hidden sm:table-cell">When</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((m) => {
                const to = m.channel === "PUSH" ? (pushOwners.get(m.to) ? `${pushOwners.get(m.to)}'s phone` : "A phone (token no longer registered)") : m.to;
                const href = `/system/outbox/${m.id}${qs ? `?${qs}` : ""}`;
                return (
                  <TR key={m.id}>
                    <TD className="text-ink-3">
                      <ChannelIcon channel={m.channel} />
                    </TD>
                    <TD className="max-w-0 md:max-w-md">
                      <Link href={href} className="block truncate font-medium text-ink hover:underline">
                        {m.subject || m.body.split("\n")[0] || "(no subject)"}
                      </Link>
                      <p className="truncate text-xs text-ink-3 md:hidden">{to}</p>
                      <p className="truncate text-xs text-ink-3">{m.body.replace(/\s+/g, " ").slice(0, 140)}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3 sm:hidden">
                        <OutboxStatusBadge status={m.status} /> {fmtDate(m.createdAt, "MMM d")} · {fmtTime(m.createdAt)}
                      </p>
                    </TD>
                    <TD className="hidden max-w-[16rem] truncate text-ink-2 md:table-cell">{to}</TD>
                    <TD className="hidden sm:table-cell">
                      <OutboxStatusBadge status={m.status} />
                    </TD>
                    <TD className="hidden whitespace-nowrap text-ink-2 sm:table-cell">
                      <time dateTime={m.createdAt.toISOString()} title={fmtLongDate(m.createdAt)}>
                        {fmtDate(m.createdAt, "MMM d")} · {fmtTime(m.createdAt)}
                      </time>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <Pager page={page} pages={pages} total={total} noun="message" />
        </div>
      )}
    </div>
  );
}
