"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Check, Clock, ExternalLink, Loader2, Search, UserPlus } from "lucide-react";
import { ClubLogo } from "@/components/ui/avatar";
import { Badge, type Tone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { AskToReviveDialog } from "@/components/founding/AskToReviveDialog";
import type { SimilarClub, SimilarStanding } from "@/lib/search/similar-rules";
import { findSimilarClubsAction } from "@/app/clubs/new/actions";

const TONE: Record<SimilarStanding, Tone> = { active: "success", pilot: "info", inactive: "warning", retired: "neutral" };

/** Names shorter than this aren't checked yet. */
const MIN_NAME = 3;
/** Wait for a pause in typing before asking the server. */
const DEBOUNCE_MS = 450;

/** One similar club: who it is, its standing in plain words, and what to do instead of starting over. Shared by the wizard and the office's review. */
export function SimilarClubRow({ club, action }: { club: SimilarClub; action?: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/clubs/${club.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-ink hover:text-brand hover:underline">
              {club.name}
              <ExternalLink className="h-3 w-3 shrink-0 text-ink-3" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </Link>
            <Badge tone={TONE[club.standing]}>{club.standingLabel}</Badge>
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            {club.facts.join(" · ")}
            <span aria-hidden> · </span>
            <span>{club.reason === "name" ? "Similar name" : "Similar purpose"}</span>
          </p>
          {club.shortDescription ? <p className="mt-1 line-clamp-2 text-sm text-ink-2">{club.shortDescription}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0 sm:pl-2">{action}</div> : null}
    </li>
  );
}

function WizardAction({ club, canRevive, onAsked }: { club: SimilarClub; canRevive: boolean; onAsked: () => void }) {
  if (club.status === "APPROVED") {
    if (club.viewer?.member)
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
          <Check className="h-4 w-4" aria-hidden /> You&apos;re a member
        </span>
      );
    if (club.viewer?.pending)
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-warning">
          <Clock className="h-4 w-4" aria-hidden /> Request pending
        </span>
      );
    return (
      <ButtonLink href={`/clubs/${club.slug}?register=1`} size="sm" variant="outline" aria-label={`Join ${club.name} instead`}>
        <UserPlus className="h-4 w-4" aria-hidden /> Join instead
      </ButtonLink>
    );
  }
  if (club.revival?.mine) return <span className="text-sm font-medium text-ink-2">You asked to bring it back</span>;
  if (club.revival?.open) return <span className="text-sm text-ink-3">Someone already asked to bring it back</span>;
  if (!canRevive) return <span className="text-sm text-ink-3">A student can ask to bring it back</span>;
  return <AskToReviveDialog clubId={club.id} clubName={club.name} office={club.office} onSent={onAsked} />;
}

/**
 * "Similar clubs already exist", live in the Start a club wizard: the club
 * search (lib/search/similar) on the name and short description as the
 * founder types. Approved clubs offer Join instead; retired ones Ask to
 * revive it. Nothing here blocks creating the club: the office decides.
 */
export function SimilarClubs({ name, description, canRevive }: { name: string; description: string; canRevive: boolean }) {
  const [result, setResult] = useState<{ for: string; clubs: SimilarClub[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const trimmed = name.trim();
  const key = `${trimmed}\n${description.trim()}`;
  const ready = trimmed.length >= MIN_NAME;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await findSimilarClubsAction({ name: trimmed, description: description.trim() });
      if (cancelled) return;
      setLoading(false);
      if (r.ok) setResult({ for: key, clubs: r.data });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // The key holds both inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  const clubs = ready ? (result?.clubs ?? []) : [];
  const markAsked = (id: string) =>
    setResult((r) => (r ? { ...r, clubs: r.clubs.map((c) => (c.id === id && c.revival ? { ...c, revival: { open: true, mine: true } } : c)) } : r));
  const status = !ready ? "" : loading ? "Checking for similar clubs…" : !result ? "" : clubs.length ? `${clubs.length} similar ${clubs.length === 1 ? "club" : "clubs"} found.` : "No similar clubs found.";

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {ready && clubs.length ? (
        <section aria-labelledby="similar-clubs-heading" className={cn("rounded-xl border border-brand-100 bg-brand-50/40 px-4 py-3 transition-opacity", loading && "opacity-60")}>
          <div className="flex items-start gap-2">
            <Search className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
            <div className="min-w-0">
              <h3 id="similar-clubs-heading" className="font-semibold text-ink">
                Similar clubs already exist
              </h3>
              <p className="text-sm text-ink-2">Joining one might be quicker than starting from scratch. If yours is different, carry on: whoever reviews new clubs sees this list too and makes the call.</p>
            </div>
          </div>
          <ul className="mt-1 divide-y divide-brand-100" aria-label="Similar clubs">
            {clubs.map((c) => (
              <SimilarClubRow key={c.id} club={c} action={<WizardAction club={c} canRevive={canRevive} onAsked={() => markAsked(c.id)} />} />
            ))}
          </ul>
        </section>
      ) : ready && loading && !result ? (
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking for similar clubs…
        </p>
      ) : ready && result && !clubs.length && result.for === key ? (
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <Check className="h-4 w-4 text-success" aria-hidden /> No similar clubs on Wildcat Clubs yet.
        </p>
      ) : null}
    </div>
  );
}
