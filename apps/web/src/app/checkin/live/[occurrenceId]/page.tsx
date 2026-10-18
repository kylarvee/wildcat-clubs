import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Ban, Lock } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { DomainError } from "@/lib/domain/kit";
import { appUrl, checkinScreen } from "@/lib/domain/attendance";
import { codeClubsPhrase } from "@/lib/attendance/rules";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/layout";
import { LiveCheckinScreen, type LiveFeed, type LiveToken } from "@/components/attendance/LiveCheckinScreen";

export const metadata: Metadata = { title: "Live check-in", robots: { index: false } };

/**
 * The QR screen leaders put on a projector or hold up at the door. Requires
 * "attendance" on the host club (admins for university events) — the same
 * check the token and feed APIs make on every poll.
 */
export default async function LiveCheckinPage({ params }: { params: Promise<{ occurrenceId: string }> }) {
  const { occurrenceId } = await params;
  const user = await requireUser(`/checkin/live/${occurrenceId}`);

  let screen: Awaited<ReturnType<typeof checkinScreen>>;
  try {
    screen = await checkinScreen(user, occurrenceId);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    if (e.code === "NOT_FOUND") notFound();
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState
          icon={e.code === "FORBIDDEN" ? <Lock /> : <Ban />}
          title={e.code === "FORBIDDEN" ? "You can't run check-in for this event" : "Check-in isn't available"}
          description={e.code === "FORBIDDEN" ? `${e.message} Running check-in takes the Attendance permission in the host club.` : e.message}
          action={
            <Link href="/dashboard" className={buttonClasses("outline")}>
              Back to your dashboard
            </Link>
          }
        />
      </div>
    );
  }

  const { occurrence, token, feed } = screen;
  const svg = await QRCode.toString(token.url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#17131c", light: "#ffffff" } });
  const host = new URL(appUrl()).host;
  const backHref = occurrence.club ? `/clubs/${occurrence.club.slug}/manage/attendance/${occurrence.id}` : `/admin/trainings/occurrences/${occurrence.id}`;
  // Dates cross to the client as strings (the polling APIs send JSON too).
  const asJson = <T,>(v: unknown) => JSON.parse(JSON.stringify(v)) as T;

  return (
    <LiveCheckinScreen
      occurrenceId={occurrence.id}
      title={occurrence.title}
      startsAt={occurrence.startsAt.toISOString()}
      endsAt={occurrence.endsAt.toISOString()}
      allDay={occurrence.allDay}
      place={occurrence.place}
      club={occurrence.club ? { name: occurrence.club.name, logoUrl: occurrence.club.logoUrl, logoColor: occurrence.club.logoColor } : null}
      initialToken={asJson<LiveToken>(token)}
      initialFeed={asJson<LiveFeed>(feed)}
      initialSvg={svg}
      typeAt={`${host}/checkin`}
      codeClubs={codeClubsPhrase(occurrence.club?.name ?? null, occurrence.cohosts.map((c) => c.name))}
      backHref={backHref}
    />
  );
}
