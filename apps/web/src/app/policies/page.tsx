import type { Metadata } from "next";
import Link from "next/link";
import { FileText, ScrollText, Search } from "lucide-react";
import { publishedPolicies } from "@/lib/domain/policies";
import { fmtLongDate } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Container, EmptyState, PageHeader } from "@/components/ui/layout";
import { PLACEMENT_LABEL, PLACEMENTS, primaryPlacement } from "@/components/policies/placements";

export const metadata: Metadata = {
  title: "Policy library",
  description: "The WSUSA and Weber State policies every student club follows, in plain language.",
};

type Policy = Awaited<ReturnType<typeof publishedPolicies>>[number];

/**
 * The public policy library: every published policy, grouped by the part of
 * club life it covers, with a search. Each policy is listed once, under its
 * first placement; its other placements show as tags.
 */
export default async function PolicyLibraryPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";
  const policies = await publishedPolicies(q);
  const groups = PLACEMENTS.map((p) => ({ ...p, items: policies.filter((x) => primaryPlacement(x.placements) === p.value) })).filter((g) => g.items.length);

  return (
    <Container size="md">
      <PageHeader
        title="Policy library"
        description="The rules every Weber State club follows, set by WSUSA and the university. You'll also see the ones that apply right where you need them — when you plan an event, request funding or leave a review."
      />

      <form action="/policies" method="get" role="search" className="mb-8 flex gap-2">
        <label htmlFor="policy-search" className="sr-only">
          Search policies
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input id="policy-search" name="q" type="search" defaultValue={q} placeholder="Search policies (for example, alcohol, travel, funding)" className="pl-9" />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {q ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-2" aria-live="polite">
            {policies.length} {policies.length === 1 ? "policy matches" : "policies match"} “{q}”.{" "}
            <Link href="/policies" className="font-medium text-brand-600 hover:underline">
              Show all
            </Link>
          </p>
          {policies.length ? (
            <ul className="space-y-3">
              {policies.map((p) => (
                <li key={p.id}>
                  <PolicyCard p={p} showAll />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Search />} title="No policies match" description="Try a shorter word, or browse everything." action={<ButtonLink href="/policies" variant="outline">Browse all policies</ButtonLink>} />
          )}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={<ScrollText />} title="No policies published yet" description="WSUSA publishes club policies here. Check back soon." />
      ) : (
        <div className="space-y-10">
          {groups.length > 2 ? (
            <nav aria-label="Policy topics" className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <a key={g.value} href={`#${g.value.toLowerCase()}`} className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink-2 hover:border-brand hover:text-brand">
                  {g.label}
                </a>
              ))}
            </nav>
          ) : null}
          {groups.map((g) => (
            <section key={g.value} id={g.value.toLowerCase()} aria-labelledby={`h-${g.value}`} className="scroll-mt-24 space-y-3">
              <div>
                <h2 id={`h-${g.value}`} className="text-lg font-semibold text-ink">
                  {g.label}
                </h2>
                {g.value !== "GENERAL" ? <p className="text-sm text-ink-3">Also shown in: {g.where.charAt(0).toLowerCase() + g.where.slice(1)}</p> : null}
              </div>
              <ul className="space-y-3">
                {g.items.map((p) => (
                  <li key={p.id}>
                    <PolicyCard p={p} primary={g.value} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Container>
  );
}

function PolicyCard({ p, primary, showAll }: { p: Policy; primary?: string; showAll?: boolean }) {
  const tags = p.placements.filter((x) => x !== "GENERAL" && (showAll || x !== primary));
  return (
    <Card className="p-4 transition-colors hover:border-brand-200">
      <div className="flex gap-3">
        <span className="mt-0.5 text-brand" aria-hidden>
          {p.documentFileId ? <FileText className="h-5 w-5" /> : <ScrollText className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <Link href={`/policies/${p.slug}`} className="font-semibold text-ink hover:text-brand-600 hover:underline">
            {p.title}
          </Link>
          <p className="mt-1 text-sm text-ink-2">{p.summary}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            {tags.map((t) => (
              <Badge key={t}>{PLACEMENT_LABEL[t]}</Badge>
            ))}
            <span>
              Version {p.version}
              {p.effectiveAt ? ` · effective ${fmtLongDate(p.effectiveAt)}` : ""}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
