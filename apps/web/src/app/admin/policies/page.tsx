import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Plus, ScrollText } from "lucide-react";
import { listPoliciesForAdmin } from "@/lib/domain/policies";
import { fmtAgo, fmtLongDate } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { PLACEMENT_LABEL, POLICY_STATUS_LABEL, POLICY_STATUS_TONE } from "@/components/policies/placements";
import { requirePolicyAdmin } from "./guard";

export const metadata: Metadata = { title: "Policies" };

const ORDER = { PUBLISHED: 0, DRAFT: 1, ARCHIVED: 2 } as const;

/** Every policy, with where it shows. The policy editor is the one place policy text is entered. */
export default async function AdminPoliciesPage() {
  await requirePolicyAdmin("/admin/policies");
  const policies = (await listPoliciesForAdmin()).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.title.localeCompare(b.title));
  const counts = { PUBLISHED: 0, DRAFT: 0, ARCHIVED: 0 };
  for (const p of policies) counts[p.status]++;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Policies"
        description="Write or upload WSUSA and university policy once; it shows in the policy library and in each part of the app you place it, so students see the rule where it applies."
        actions={
          <>
            <ButtonLink href="/policies" variant="outline">
              Open the library
            </ButtonLink>
            <ButtonLink href="/admin/policies/new">
              <Plus className="h-4 w-4" aria-hidden /> New policy
            </ButtonLink>
          </>
        }
      />

      {policies.length === 0 ? (
        <EmptyState icon={<ScrollText />} title="No policies yet" description="Add the first policy — for example, event safety or review integrity — and choose where it shows." action={<ButtonLink href="/admin/policies/new">New policy</ButtonLink>} />
      ) : (
        <>
          <p className="text-sm text-ink-3">
            {counts.PUBLISHED} published · {counts.DRAFT} {counts.DRAFT === 1 ? "draft" : "drafts"} · {counts.ARCHIVED} archived
          </p>
          <Card>
            <ul className="divide-y divide-line">
              {policies.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start gap-3 px-4 py-4">
                  <span className="mt-0.5 text-ink-3" aria-hidden>
                    {p.documentFile ? <FileText className="h-5 w-5" /> : <ScrollText className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/policies/${p.id}`} className="font-semibold text-ink hover:text-brand-600 hover:underline">
                        {p.title}
                      </Link>
                      <Badge tone={POLICY_STATUS_TONE[p.status]}>{POLICY_STATUS_LABEL[p.status]}</Badge>
                      <span className="text-xs text-ink-3">v{p.version}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">{p.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.placements.map((pl) => (
                        <Badge key={pl}>{PLACEMENT_LABEL[pl]}</Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-ink-3">
                      /policies/{p.slug}
                      {p.effectiveAt ? ` · effective ${fmtLongDate(p.effectiveAt)}` : ""} · edited {fmtAgo(p.updatedAt)} · {p.author.name}
                      {p.documentFile ? " · uploaded document" : ""}
                    </p>
                  </div>
                  <ButtonLink href={`/admin/policies/${p.id}`} size="sm" variant="outline">
                    Edit
                  </ButtonLink>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
