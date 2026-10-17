import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { policyForEditor } from "@/lib/domain/policies";
import { fmtDate } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/layout";
import { PolicyEditor } from "@/components/policies/PolicyEditor";
import { POLICY_STATUS_LABEL, POLICY_STATUS_TONE } from "@/components/policies/placements";
import { requirePolicyAdmin } from "../guard";

export const metadata: Metadata = { title: "Edit policy" };

export default async function EditPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePolicyAdmin(`/admin/policies/${id}`);
  const data = await policyForEditor(id);
  if (!data) notFound();
  const { policy: p, published } = data;
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ href: "/admin/policies", label: "Policies" }, { label: p.title }]}
        title={p.title}
        actions={
          <>
            <Badge tone={POLICY_STATUS_TONE[p.status]}>{POLICY_STATUS_LABEL[p.status]}</Badge>
            <span className="text-sm text-ink-3">Version {p.version}</span>
          </>
        }
      />
      <PolicyEditor
        key={`${p.id}:${p.updatedAt.getTime()}`}
        initial={{
          id: p.id,
          title: p.title,
          slug: p.slug,
          summary: p.summary,
          bodyHtml: p.bodyHtml ?? "",
          document: p.documentFile ? { id: p.documentFile.id, name: p.documentFile.name, mimeType: p.documentFile.mimeType, sizeBytes: p.documentFile.sizeBytes } : null,
          placements: p.placements,
          status: p.status,
          effectiveOn: p.effectiveAt ? fmtDate(p.effectiveAt, "yyyy-MM-dd") : "",
          version: p.version,
          published,
        }}
      />
    </div>
  );
}
