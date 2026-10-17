import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Circle, Move, ShieldCheck, Spline } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { INSTITUTION } from "@/lib/institution";
import { loadNetwork } from "@/lib/analytics/network";
import { parseNetworkGroup, parseNetworkWindow, type NetworkPayload } from "@/lib/analytics/network-model";
import { Container, PageHeader } from "@/components/ui/layout";
import { NetworkGraph } from "@/components/network/NetworkGraph";

export const metadata: Metadata = {
  title: "Club network",
  description: `How ${INSTITUTION.shortName} clubs show up for each other: every approved club, sized by check-ins and linked by members visiting each other's events.`,
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The inter-club activity map (public). The first picture is rendered on the
 * server so the canvas paints at once; the client then polls /api/network
 * every minute. ?window= and ?group= make any view shareable.
 */
export default async function NetworkPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const win = parseNetworkWindow(one(sp.window));
  const group = parseNetworkGroup(one(sp.group));
  const actor = await getCurrentUser();
  // A failed first load isn't fatal: the canvas fetches on its own and shows a retry.
  const initial: NetworkPayload | null = await loadNetwork({ window: win, group, actor }).catch(() => null);
  const leadIds = new Set(initial?.viewer.leads ?? []);
  const leads = leadIds.size;
  const otherMember = (initial?.viewer.memberOf ?? []).filter((id) => !leadIds.has(id)).length;

  return (
    <Container size="xl">
      <PageHeader
        title="The club network"
        description={`Every WSUSA-approved club at ${INSTITUTION.shortName}, connected by real check-ins. When a member of one club shows up at another club's event, the line between them gets thicker.`}
      />

      <NetworkGraph initialData={initial} height={600} syncUrl />

      <section aria-labelledby="how-title" className="mt-10">
        <h2 id="how-title" className="text-lg font-semibold text-ink">
          How to read it
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Explainer icon={<Circle />} title="Bigger circles, busier clubs">
            A circle&rsquo;s size is how many check-ins the club&rsquo;s events had in the time window, including events it co-hosted.
          </Explainer>
          <Explainer icon={<Spline />} title="Thicker lines, closer clubs">
            A line means members of one club checked in at the other&rsquo;s events. No shared visits, no line.
          </Explainer>
          <Explainer icon={<Move />} title="Nobody places the clubs">
            Lines pull clubs together and every club pushes the others away, so the most connected clubs drift to the middle and colleges cluster on their own.
          </Explainer>
          <Explainer icon={<ShieldCheck />} title="Counts, never names">
            The map only shows totals. Who attended what stays with the clubs and the people themselves.
          </Explainer>
        </ul>
      </section>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 text-sm">
        {!actor ? (
          <>
            <p className="text-ink-2">Sign in with your Weber State account to see your own clubs outlined on the map.</p>
            <Link href={`/login?next=${encodeURIComponent("/network")}`} className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline">
              Sign in <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </>
        ) : leads || otherMember ? (
          <>
            <p className="text-ink-2">
              {leads ? "Clubs you lead or advise have a purple halo" : "Clubs you belong to are outlined"}
              {leads && otherMember ? "; the other clubs you belong to are outlined" : ""}. Want a thicker line? Co-host an event with another club.
            </p>
            <Link href="/clubs?mine=1" className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline">
              Your clubs <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </>
        ) : (
          <>
            <p className="text-ink-2">You&rsquo;re not in any clubs yet. Register for one and it&rsquo;ll be outlined here.</p>
            <Link href="/clubs" className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline">
              Browse clubs <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </>
        )}
      </div>
    </Container>
  );
}

function Explainer({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">
        {icon}
      </span>
      <h3 className="mt-3 font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">{children}</p>
    </li>
  );
}
