import Link from "next/link";
import type { OutboxChannel, OutboxStatus } from "@prisma/client";
import { Bell, Mail } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";

/** Shared bits for the outbox list and message pages. Server-safe (no hooks). */

export const OUTBOX_STATUS_LABEL: Record<OutboxStatus, string> = { MOCKED: "Recorded (mock)", SENT: "Sent", FAILED: "Failed" };
const STATUS_TONE: Record<OutboxStatus, Tone> = { MOCKED: "neutral", SENT: "success", FAILED: "danger" };
export const OUTBOX_CHANNEL_LABEL: Record<OutboxChannel, string> = { EMAIL: "Email", PUSH: "Push" };

export function OutboxStatusBadge({ status }: { status: OutboxStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{OUTBOX_STATUS_LABEL[status]}</Badge>;
}

export function ChannelIcon({ channel, className }: { channel: OutboxChannel; className?: string }) {
  const Icon = channel === "EMAIL" ? Mail : Bell;
  return <Icon className={className ?? "h-4 w-4"} aria-label={OUTBOX_CHANNEL_LABEL[channel]} />;
}

/**
 * Message text with its links clickable. Links to this platform become
 * relative, so a tester on another host (or port) stays where they are.
 */
export function LinkedText({ text, appUrl }: { text: string; appUrl: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"')]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part;
        const local = toLocalPath(part, appUrl);
        return local ? (
          <Link key={i} href={local} className="break-all text-brand-600 underline underline-offset-2">
            {part}
          </Link>
        ) : (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-600 underline underline-offset-2">
            {part}
          </a>
        );
      })}
    </>
  );
}

/** "/clubs/x" for a link to this platform, else null. */
export function toLocalPath(url: string, appUrl: string): string | null {
  try {
    const u = new URL(url);
    const app = new URL(appUrl);
    if (u.host !== app.host) return null;
    return `${u.pathname}${u.search}${u.hash}` || "/";
  } catch {
    return null;
  }
}
