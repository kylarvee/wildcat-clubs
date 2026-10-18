import type { Metadata } from "next";
import { Plus, SearchX, Sparkles } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { listClubs, shouldPromptForApp } from "@/lib/clubs/queries";
import { INSTITUTION } from "@/lib/institution";
import { ButtonLink } from "@/components/ui/button";
import { Container, EmptyState, PageHeader } from "@/components/ui/layout";
import { AppPromptProvider } from "@/components/clubs/AppPrompt";
import { ClubBrowser } from "@/components/clubs/ClubBrowser";
import { ClubCard } from "@/components/clubs/ClubCard";
import { ClubTable } from "@/components/clubs/ClubTable";
import { clubListHref, hasActiveFilters, parseClubListParams } from "@/components/clubs/list-params";

export const metadata: Metadata = {
  title: "Clubs",
  description: `Browse every WSUSA-approved student club at ${INSTITUTION.name}. Sort by rating, activity and membership, and register in a click.`,
};

/** Clubs shown per step; "Show more" adds another step (the count and filters cover them all). */
const STEP = 48;

export default async function ClubsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  const sp = await searchParams;
  const parsed = parseClubListParams(sp);
  const showParam = Number(Array.isArray(sp.show) ? sp.show[0] : sp.show);
  const limit = Number.isFinite(showParam) && showParam > STEP ? Math.min(Math.ceil(showParam / STEP) * STEP, 2000) : STEP;
  // "My clubs" means nothing to a signed-out visitor.
  const params = user ? parsed : { ...parsed, mine: false };
  const [result, promptForApp] = await Promise.all([listClubs(params, user), user ? shouldPromptForApp(user.id) : Promise.resolve(false)]);
  const shownItems = result.items.slice(0, limit);
  const signedIn = Boolean(user);
  const startHref = user ? "/clubs/new" : `/login?next=${encodeURIComponent("/clubs/new")}`;
  const canStart = !user || can(user, "club.create");

  return (
    <Container size="xl">
      <PageHeader
        title={params.archived ? "Archived clubs" : `Clubs at ${INSTITUTION.shortName}`}
        description={
          params.archived
            ? "Clubs that have wound down. Their history, officers and documents stay on record — handy if you want to bring one back."
            : `Every ${INSTITUTION.studentGovernment}-approved club in one place. Search, sort by what matters to you, and register in a click.`
        }
        actions={
          canStart ? (
            <ButtonLink href={startHref}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Start a club
            </ButtonLink>
          ) : null
        }
      />

      <AppPromptProvider enabled={promptForApp}>
        <ClubBrowser params={params} colleges={result.colleges} signedIn={signedIn} archivedCount={result.archivedCount} shown={result.items.length} total={result.total}>
          {result.items.length === 0 ? (
            result.total === 0 ? (
              <EmptyState
                icon={<Sparkles />}
                title={params.archived ? "No archived clubs" : "No clubs here yet"}
                description={params.archived ? "No club has been retired so far." : `Be the first — start a club and ${INSTITUTION.studentGovernment} will help you get it approved.`}
                action={
                  params.archived ? (
                    <ButtonLink href="/clubs" variant="outline">
                      Back to current clubs
                    </ButtonLink>
                  ) : canStart ? (
                    <ButtonLink href={startHref}>Start a club</ButtonLink>
                  ) : null
                }
              />
            ) : (
              <EmptyState
                icon={<SearchX />}
                title="No clubs match those filters"
                description={params.mine ? "You haven't joined a club that matches. Try clearing a filter or browse everything." : "Try a different search or clear a filter or two."}
                action={
                  hasActiveFilters(params) ? (
                    <ButtonLink href={clubListHref(params, { q: "", type: null, college: null, scope: null, status: null, mine: false })} variant="outline">
                      Clear filters
                    </ButtonLink>
                  ) : null
                }
              />
            )
          ) : params.view === "list" ? (
            <ClubTable clubs={shownItems} states={result.states} signedIn={signedIn} />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Clubs">
              {shownItems.map((club) => (
                <li key={club.id} className="flex min-w-0">
                  <ClubCard club={club} state={result.states.get(club.id)} signedIn={signedIn} />
                </li>
              ))}
            </ul>
          )}
          {result.items.length > shownItems.length ? (
            <div className="mt-6 flex flex-col items-center gap-2">
              <p className="text-sm text-ink-3">
                Showing {shownItems.length} of {result.items.length}
              </p>
              <ButtonLink href={`${clubListHref(params)}${clubListHref(params).includes("?") ? "&" : "?"}show=${limit + STEP}`} variant="outline" scroll={false}>
                Show more clubs
              </ButtonLink>
            </div>
          ) : null}
        </ClubBrowser>
      </AppPromptProvider>
    </Container>
  );
}
