import { SearchX, TextSearch } from "lucide-react";
import { searchInsights } from "@/lib/search/log";
import { fmtAgo } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { BarList } from "@/components/analytics/BarList";
import { plural } from "@/components/clubs/labels";

const searchHref = (q: string) => `/clubs?q=${encodeURIComponent(q)}`;

/**
 * Admin Club analytics: what students type into the clubs search, and the
 * searches that found nothing — unmet demand WSUSA can act on. The log keeps
 * only the words, how many clubs matched and whether the person was signed
 * in (lib/search/log), never who searched.
 */
export async function SearchInsightsCard({ days = 30 }: { days?: number }) {
  const s = await searchInsights(days);
  const signedIn = s.signedInShare == null ? null : Math.round(s.signedInShare * 100);
  return (
    <Card>
      <CardHeader
        title="What students search for"
        description={`Searches on the clubs page in the last ${days} days. Only the words are kept — never who searched.`}
        action={
          s.searches ? (
            <p className="text-right text-sm text-ink-3">
              <span className="font-semibold tabular-nums text-ink">{s.searches.toLocaleString("en-US")}</span> {s.searches === 1 ? "search" : "searches"}
              {signedIn != null ? <span className="block text-xs">{signedIn}% signed in</span> : null}
            </p>
          ) : null
        }
      />
      <CardBody>
        {s.searches === 0 ? (
          <p className="py-4 text-center text-sm text-ink-3">Nobody has searched the clubs list in the last {days} days.</p>
        ) : (
          <div className="grid gap-8 md:grid-cols-2">
            <section aria-labelledby="top-searches-title">
              <h3 id="top-searches-title" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <TextSearch className="h-4 w-4 text-ink-3" aria-hidden="true" /> Top searches
              </h3>
              <p className="mb-3 mt-0.5 text-xs text-ink-3">How often each was searched, and what it found the last time.</p>
              <BarList
                label="Top searches"
                items={s.top.map((t) => ({
                  key: t.query,
                  label: `“${t.query}”`,
                  value: t.count,
                  hint: t.results ? `Found ${plural(t.results, "club")}` : "Found nothing",
                  href: searchHref(t.query),
                }))}
              />
            </section>
            <section aria-labelledby="unmet-searches-title">
              <h3 id="unmet-searches-title" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <SearchX className="h-4 w-4 text-ink-3" aria-hidden="true" /> Searches with no results
              </h3>
              <p className="mb-3 mt-0.5 text-xs text-ink-3">No club matches these yet — interest a new club could meet.</p>
              {s.unmet.length ? (
                <BarList
                  label="Searches with no results"
                  items={s.unmet.map((u) => ({ key: u.query, label: `“${u.query}”`, value: u.count, hint: `Last searched ${fmtAgo(u.lastAt)}`, href: searchHref(u.query) }))}
                />
              ) : (
                <p className="rounded-lg border border-dashed border-line-2 px-4 py-6 text-center text-sm text-ink-3">Every recent search found at least one club.</p>
              )}
            </section>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
