import Link from "next/link";
import { ArrowRight, BellRing, CheckCircle2, Handshake, UserPlus } from "lucide-react";
import { ClubLogo } from "@/components/ui/avatar";
import { Panel } from "@/components/dashboard/Panel";
import type { LedClub } from "@/app/dashboard/data";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Leaders: what's waiting in each club you lead — join requests and co-host
 * requests — with a way into each club's workspace.
 */
export function NeedsAttention({ clubs }: { clubs: LedClub[] }) {
  const waiting = clubs.reduce((n, c) => n + c.joinRequests + c.cohostRequests + c.otherApprovals, 0);
  return (
    <Panel
      id="dash-attention"
      title="Needs your attention"
      icon={<BellRing />}
      description={waiting ? `${plural(waiting, "request is", "requests are")} waiting on a leader in your clubs.` : "Nothing is waiting in the clubs you lead."}
      bodyClassName="p-0 sm:p-0"
    >
      <ul className="divide-y divide-line">
        {clubs.map((c) => {
          const items = [
            c.joinRequests ? { href: `/clubs/${c.slug}/manage/members`, icon: UserPlus, label: plural(c.joinRequests, "join request", "join requests") } : null,
            c.cohostRequests ? { href: `/clubs/${c.slug}/manage/events?tab=cohosts`, icon: Handshake, label: plural(c.cohostRequests, "co-host request", "co-host requests") } : null,
            c.otherApprovals ? { href: `/tasks?club=${c.slug}&kind=APPROVAL`, icon: BellRing, label: plural(c.otherApprovals, "other approval", "other approvals") } : null,
          ].filter((x) => x !== null);
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
              <ClubLogo name={c.name} src={c.logoUrl} color={c.logoColor} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                {items.length ? (
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {items.map((it) => (
                      <li key={it.href}>
                        <Link href={it.href} className="inline-flex items-center gap-1 text-sm font-medium text-warning hover:underline">
                          <it.icon className="h-3.5 w-3.5" aria-hidden /> {it.label}
                          <span className="sr-only"> in {c.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-3">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden /> All caught up
                  </p>
                )}
              </div>
              <Link
                href={`/clubs/${c.slug}/manage`}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line-2 px-2.5 text-xs font-medium text-ink hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand"
              >
                Workspace<span className="sr-only"> for {c.name}</span> <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
