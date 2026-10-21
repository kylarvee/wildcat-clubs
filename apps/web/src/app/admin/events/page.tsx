import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Car, CircleCheck, Mail, MessageSquareWarning, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { eventReviewQueue, type ReviewItem } from "@/lib/events/reviews";
import { RISK_SHORT } from "@/lib/events/review";
import { fmtDate } from "@/lib/time";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Section } from "@/components/ui/layout";
import { ReviewDecision } from "./ReviewDecision";

export const metadata: Metadata = { title: "Event reviews" };

/**
 * Event reviews: club events whose "Does this event involve…" answers sent
 * them to the viewer's office before they're posted (lib/events/review), and
 * the ones sent back to their clubs. The office's queue (its APPROVAL tasks)
 * is the to-do list; this is where each one is decided. WSUSA's admins see
 * every office's, an office's staff their own (lib/events/reviews).
 */
export default async function EventReviewsPage() {
  const user = await requireUser("/admin/events");
  if (!can(user, "admin.events")) notFound();
  const { toReview, sentBack, umbrella } = await eventReviewQueue(user);
  // WSUSA's admins also see other offices' reviews; their own queue comes first (and matches its count).
  const mine = toReview.filter((i) => i.ownQueue);
  const others = toReview.filter((i) => !i.ownQueue);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Event reviews"
        description="Club events that involve an outdoor common space, people under 18, travel, a large crowd, collecting money or alcohol wait here before they're posted. Until you approve one, only its club's leaders and your office can see it, and nobody gets notices or reminders."
      />

      <Section title={`To review${mine.length ? ` (${mine.length})` : ""}`} description={mine.length ? "Soonest first." : undefined}>
        {mine.length === 0 ? (
          <EmptyState icon={<CircleCheck />} title="Nothing to review" description="When a club checks something under “Does this event involve…” in the Events Builder, the event waits here." />
        ) : (
          <ReviewList items={mine} umbrella={umbrella} />
        )}
      </Section>

      {others.length ? (
        <Section title={`Other offices' reviews (${others.length})`} description="Each office reviews its own clubs' events, and these are in their queues. As a WSUSA admin you can decide them too.">
          <ReviewList items={others} umbrella={umbrella} />
        </Section>
      ) : null}

      {sentBack.length ? (
        <Section title={`Sent back (${sentBack.length})`} description="Waiting on the club. Their next save sends it back here.">
          <Card className="divide-y divide-line">
            {sentBack.map((item) => (
              <div key={item.id} id={item.id} className="flex scroll-mt-24 flex-wrap items-start gap-3 px-4 py-3">
                <ClubLogo name={item.club.name} src={item.club.logoUrl} color={item.club.logoColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link href={`/events/${item.id}`} className="font-medium text-ink hover:underline">
                    {item.title}
                  </Link>
                  <p className="text-sm text-ink-3">
                    {item.club.name} · {item.when}
                  </p>
                  {item.note ? (
                    <p className="mt-1 flex gap-1.5 text-sm text-ink-2">
                      <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                      <span>
                        {item.reviewedBy ? `${item.reviewedBy}` : "Your office"}
                        {item.reviewedAt ? ` on ${fmtDate(item.reviewedAt, "MMM d")}` : ""}: “{item.note}”
                      </span>
                    </p>
                  ) : null}
                </div>
                {umbrella ? <Badge tone="info">{item.office}</Badge> : null}
              </div>
            ))}
          </Card>
        </Section>
      ) : null}
    </div>
  );
}

function ReviewList({ items, umbrella }: { items: ReviewItem[]; umbrella: boolean }) {
  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <li key={item.id} id={item.id} className="scroll-mt-24">
          <ReviewCard item={item} umbrella={umbrella} />
        </li>
      ))}
    </ul>
  );
}

/** One event to decide: what it involves, the trip, when and where, who to contact, and the decision. */
function ReviewCard({ item, umbrella }: { item: ReviewItem; umbrella: boolean }) {
  const t = item.travel;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <ClubLogo name={item.club.name} src={item.club.logoUrl} color={item.club.logoColor} size="md" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-snug text-ink">
            <Link href={`/events/${item.id}`} className="hover:underline">
              {item.title}
            </Link>
          </h3>
          <p className="text-sm text-ink-3">
            {item.club.name}
            {item.cohosts.length ? ` with ${item.cohosts.join(", ")}` : ""} · sent {fmtDate(item.sentAt, "MMM d")}
            {item.sentBy ? ` by ${item.sentBy}` : ""}
          </p>
        </div>
        {umbrella ? <Badge tone="info">{item.office}</Badge> : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="What it involves">
        {item.flags.map((f) => (
          <Badge key={f} tone="warning">
            <ShieldCheck className="h-3 w-3" aria-hidden /> {RISK_SHORT[f]}
          </Badge>
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 [&>div]:min-w-0">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">When</dt>
          <dd className="text-ink">
            {item.when}
            {item.meetings > 1 ? <span className="text-ink-3"> · {item.meetings} dates</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">Where</dt>
          <dd className="text-ink">{item.place}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">Who can see it once posted</dt>
          <dd className="text-ink">{item.visibility}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">Contacts</dt>
          <dd>
            <ul className="space-y-0.5">
              {item.contacts.map((c) => (
                <li key={c.email} className="text-ink [overflow-wrap:anywhere]">
                  {c.name} <span className="text-ink-3">· {c.role} ·</span>{" "}
                  <a href={`mailto:${c.email}`} className="text-brand-600 hover:underline">
                    {c.email}
                  </a>
                </li>
              ))}
              {item.club.contactEmail ? (
                <li className="flex flex-wrap items-center gap-1 text-ink-3 [overflow-wrap:anywhere]">
                  <Mail className="h-3.5 w-3.5" aria-hidden /> Club:{" "}
                  <a href={`mailto:${item.club.contactEmail}`} className="text-brand-600 hover:underline">
                    {item.club.contactEmail}
                  </a>
                </li>
              ) : null}
            </ul>
          </dd>
        </div>
      </dl>

      {t ? (
        <div className="mt-4 rounded-xl bg-muted/60 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-semibold text-ink">
            <Car className="h-4 w-4 text-ink-3" aria-hidden /> Trip to {t.destination}
          </p>
          <p className="mt-1 text-ink-2">
            Leaves {fmtDate(t.departsAt, "EEE, MMM d, h:mm a")} · back {fmtDate(t.returnsAt, "EEE, MMM d, h:mm a")} · {t.overnight ? "overnight" : "same day"}
          </p>
          <p className="mt-1 text-ink-2">{t.drivers.length ? `Drivers: ${t.drivers.map((d) => d.name).join(", ")}` : "No club drivers listed (a bus or a flight)."}</p>
          {t.notes ? <p className="mt-1 whitespace-pre-line text-ink-2">Notes: {t.notes}</p> : null}
        </div>
      ) : null}

      {item.description ? <p className="mt-3 line-clamp-3 text-sm text-ink-2">{item.description}</p> : null}
      {item.note ? (
        <p className="mt-3 text-sm text-ink-3">
          Last note to the club{item.reviewedAt ? ` (${fmtDate(item.reviewedAt, "MMM d")})` : ""}: “{item.note}”
        </p>
      ) : null}

      <div className="mt-4 border-t border-line pt-4">
        <ReviewDecision eventId={item.id} title={item.title} clubName={item.club.name} />
      </div>
    </Card>
  );
}
